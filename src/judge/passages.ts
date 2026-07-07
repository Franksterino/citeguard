/** Relevant-passage selection: shrink judge input ~10x without losing the
 * evidence. BM25-lite scoring of source paragraphs against the claim; the
 * top passages (plus their neighbours for context) are concatenated in
 * document order. Pure local computation - no LLM cost.
 */

import type { ExtractedContent } from "../types.js";

const TARGET_CHARS = 6_000;
const MIN_PARAGRAPH_CHARS = 40;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
}

const STOP = new Set(
  "the a an and or of to in on for with by at from as is are was were be been that this it its their his her they which".split(" "),
);

export function selectPassages(claim: string, content: ExtractedContent): ExtractedContent {
  if (content.text.length <= TARGET_CHARS) return content;

  const paragraphs = content.text
    .split(/\n{2,}|(?<=\.)\s{2,}/)
    .flatMap((p) => (p.length > 2_000 ? p.match(/.{1,2000}(?:\s|$)/gs) ?? [p] : [p]))
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_PARAGRAPH_CHARS);
  if (paragraphs.length <= 3) return { ...content, text: content.text.slice(0, TARGET_CHARS), truncated: true };

  const claimTerms = tokenize(claim).filter((t) => !STOP.has(t));
  const termSet = new Set(claimTerms);

  // document frequency for idf
  const df = new Map<string, number>();
  const paraTokens: string[][] = paragraphs.map((p) => tokenize(p));
  for (const tokens of paraTokens) {
    for (const t of new Set(tokens)) {
      if (termSet.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const n = paragraphs.length;
  const avgLen = paraTokens.reduce((s, t) => s + t.length, 0) / n;

  const scores = paraTokens.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) if (termSet.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const [t, f] of tf) {
      const idf = Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (tokens.length / avgLen))));
    }
    return score;
  });

  // pick top paragraphs + neighbours until budget
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const chosen = new Set<number>();
  let budget = 0;
  for (const [score, i] of order) {
    if (budget >= TARGET_CHARS) break;
    if (score <= 0) break;
    for (const j of [i - 1, i, i + 1]) {
      if (j >= 0 && j < n && !chosen.has(j) && budget < TARGET_CHARS) {
        chosen.add(j);
        budget += paragraphs[j].length;
      }
    }
  }
  // fallback: nothing matched (claim terms absent) -> lead of document
  if (chosen.size === 0) {
    return { ...content, text: content.text.slice(0, TARGET_CHARS), truncated: true };
  }

  const parts = [...chosen].sort((a, b) => a - b).map((i) => paragraphs[i]);
  // Always include the document lead - titles/definitions often live there.
  if (!chosen.has(0)) parts.unshift(paragraphs[0]);

  return {
    title: content.title,
    text: parts.join("\n\n[...]\n\n").slice(0, TARGET_CHARS + 2_000),
    truncated: true,
  };
}
