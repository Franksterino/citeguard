/** Content extraction: turn a fetched body into judge-ready plain text. */

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import type { ExtractedContent } from "../types.js";

const MAX_TEXT_CHARS = 40_000;

function decode(buffer: ArrayBuffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

function cap(text: string): { text: string; truncated: boolean } {
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= MAX_TEXT_CHARS) return { text: clean, truncated: false };
  return { text: clean.slice(0, MAX_TEXT_CHARS), truncated: true };
}

export async function extractContent(
  body: ArrayBuffer,
  contentType: string,
): Promise<ExtractedContent> {
  if (contentType.includes("pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(body));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged: string = Array.isArray(text) ? (text as string[]).join("\n") : (text as string);
    const capped = cap(merged);
    return { title: "", text: capped.text, truncated: capped.truncated };
  }

  if (contentType.includes("html") || contentType === "") {
    const html = decode(body);
    const { document } = parseHTML(html);
    let title = document.querySelector("title")?.textContent?.trim() ?? "";
    try {
      const article = new Readability(document as unknown as Document).parse();
      if (article?.textContent && article.textContent.trim().length > 200) {
        const capped = cap(article.textContent);
        return {
          title: article.title || title,
          text: capped.text,
          truncated: capped.truncated,
        };
      }
    } catch {
      // Readability can throw on exotic documents; fall back to body text.
    }
    const capped = cap(document.body?.textContent ?? "");
    return { title, text: capped.text, truncated: capped.truncated };
  }

  // Plain text and anything else textual.
  const capped = cap(decode(body));
  return { title: "", text: capped.text, truncated: capped.truncated };
}
