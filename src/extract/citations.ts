/** Citation extraction: pull claim+source pairs out of a document.
 *
 * Supported formats (v0.1):
 *  - Markdown inline links:  ... claim sentence [text](https://url) ...
 *  - Markdown reference links + footnotes: [text][ref] / [^1] with definitions
 *  - Bare DOIs: 10.xxxx/yyyy  (resolved via doi.org)
 *  - Bare URLs in prose
 *
 * The extraction unit is a sentence: the sentence containing the citation is
 * treated as the claim the source must support.
 */

import type { Claim } from "../types.js";

const MD_INLINE_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const MD_REF_DEF = /^\s*\[([^\]]+)\]:\s*(https?:\/\/\S+)/gm;
const MD_REF_USE = /\[([^\]]+)\]\[([^\]]+)\]/g;
const FOOTNOTE_DEF = /^\s*\[\^([^\]]+)\]:\s*(.+)$/gm;
const FOOTNOTE_USE = /\[\^([^\]]+)\]/g;
const DOI = /\b(10\.\d{4,9}\/[-._;()/:a-zA-Z0-9]+)\b/g;
const BARE_URL = /(?<![("\[])\bhttps?:\/\/[^\s<>")\]]+/g;

/** Split text into sentences. A sentence ends at [.!?] only when followed by
 * whitespace or end-of-text, so dots inside URLs/DOIs never split. */
function sentences(text: string): { sentence: string; start: number }[] {
  const out: { sentence: string; start: number }[] = [];
  let start = 0;
  const flush = (end: number) => {
    const s = text.slice(start, end).trim();
    if (s.length > 0) out.push({ sentence: s, start });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : undefined;
    if (ch === "\n") {
      flush(i + 1);
    } else if (
      (ch === "." || ch === "!" || ch === "?") &&
      (next === undefined || next === " " || next === "\n" || next === "\t")
    ) {
      flush(i + 1);
    }
  }
  flush(text.length);
  return out;
}

function sentenceAt(text: string, index: number): string {
  const all = sentences(text);
  let best = all[0]?.sentence ?? text.slice(0, 200);
  for (const s of all) {
    if (s.start <= index) best = s.sentence;
    else break;
  }
  return best;
}

function cleanUrl(url: string): string {
  // strip common trailing punctuation picked up by regexes
  return url.replace(/[.,;:!?'"»)\]]+$/, "");
}

/** Extract claim/source pairs from markdown or plain text. */
export function extractCitations(text: string): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();
  let counter = 0;

  const push = (claimText: string, source: string) => {
    const key = `${claimText}::${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    counter += 1;
    const readable = claimText
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1") // inline links -> anchor text
      .replace(/\[\^?[^\]]*\]/g, "") // leftover ref/footnote markers
      .replace(/\s+/g, " ")
      .trim();
    claims.push({
      id: `c${counter}`,
      text: readable,
      source: cleanUrl(source),
    });
  };

  // Markdown inline links
  for (const m of text.matchAll(MD_INLINE_LINK)) {
    push(sentenceAt(text, m.index), m[2]);
  }

  // Reference-style links
  const refDefs = new Map<string, string>();
  for (const m of text.matchAll(MD_REF_DEF)) {
    refDefs.set(m[1].toLowerCase(), m[2]);
  }
  if (refDefs.size > 0) {
    for (const m of text.matchAll(MD_REF_USE)) {
      const target = refDefs.get(m[2].toLowerCase());
      if (target) push(sentenceAt(text, m.index), target);
    }
  }

  // Footnotes whose definition contains a URL or DOI
  const footDefs = new Map<string, string>();
  for (const m of text.matchAll(FOOTNOTE_DEF)) {
    const urlMatch = m[2].match(/https?:\/\/\S+/) ?? m[2].match(DOI);
    if (urlMatch) footDefs.set(m[1], cleanUrl(urlMatch[0]));
  }
  if (footDefs.size > 0) {
    for (const m of text.matchAll(FOOTNOTE_USE)) {
      // skip the definition lines themselves
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      if (text.slice(lineStart, m.index).trim() === "" && text[m.index + m[0].length] === ":") continue;
      const target = footDefs.get(m[1]);
      if (target) push(sentenceAt(text, m.index), target);
    }
  }

  // Bare DOIs
  for (const m of text.matchAll(DOI)) {
    push(sentenceAt(text, m.index), `https://doi.org/${m[1]}`);
  }

  // Bare URLs (not already captured as markdown)
  for (const m of text.matchAll(BARE_URL)) {
    const url = cleanUrl(m[0]);
    if ([...seen].some((k) => k.endsWith(`::${url}`))) continue;
    push(sentenceAt(text, m.index ?? 0), url);
  }

  return claims;
}
