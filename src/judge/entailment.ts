/** LLM entailment judge: does the fetched source support the claim?
 *
 * Provider-agnostic: anything that speaks the OpenAI chat-completions
 * protocol works (Qwen via DashScope compatible-mode, Cloudflare Workers AI,
 * OpenAI, local). The judge NEVER sees the network - it only reads the
 * extracted source text, so verdicts are grounded by construction.
 */

import type { Claim, ExtractedContent, JudgeClient, Verdict } from "../types.js";

export interface JudgeOutcome {
  verdict: Verdict;
  confidence: number;
  evidence: string;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a strict citation verifier. You receive a CLAIM and the TEXT of the source it cites. Decide whether the source text supports the claim.

Verdicts:
- "supported": the source clearly states or directly entails the claim.
- "partially_supported": the source supports part of the claim, but a material element (number, date, actor, causality, scope) is absent or different.
- "contradicted": the source states the opposite or an incompatible fact.
- "unsupported": the source is about the topic but does not contain the claim, OR is about something else entirely.
- "uncertain": the text is too fragmentary, garbled, or ambiguous to decide.

Rules:
- Judge ONLY against the provided source text. Never use your own knowledge of the world to fill gaps.
- "evidence" MUST be a verbatim quote (<= 60 words) copied from the source text. Empty string only when no relevant passage exists.
- Be conservative: when torn between supported and partially_supported, choose partially_supported.
- Respond with ONLY a JSON object, no markdown fences, matching:
{"verdict": "...", "confidence": 0.0, "evidence": "...", "reasoning": "one sentence"}`;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function parseJudgeResponse(raw: string): JudgeOutcome | undefined {
  // Tolerate accidental markdown fences or prose around the JSON.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<JudgeOutcome>;
    const verdicts: Verdict[] = [
      "supported",
      "partially_supported",
      "contradicted",
      "unsupported",
      "uncertain",
    ];
    if (!parsed.verdict || !verdicts.includes(parsed.verdict as Verdict)) return undefined;
    return {
      verdict: parsed.verdict as Verdict,
      confidence: clamp(Number(parsed.confidence ?? 0.5), 0, 1),
      evidence: String(parsed.evidence ?? "").slice(0, 800),
      reasoning: String(parsed.reasoning ?? "").slice(0, 500),
    };
  } catch {
    return undefined;
  }
}

export async function judgeClaim(
  client: JudgeClient,
  claim: Claim,
  content: ExtractedContent,
): Promise<JudgeOutcome> {
  const userPrompt = [
    `CLAIM: ${claim.text}`,
    claim.context ? `CLAIM CONTEXT: ${claim.context}` : "",
    content.title ? `SOURCE TITLE: ${content.title}` : "",
    `SOURCE TEXT${content.truncated ? " (truncated)" : ""}:`,
    content.text,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await client.complete(SYSTEM_PROMPT, userPrompt);
  const parsed = parseJudgeResponse(raw);
  if (parsed) return parsed;

  // One retry with an explicit format reminder, then give up honestly.
  const retry = await client.complete(
    SYSTEM_PROMPT,
    `${userPrompt}\n\nREMINDER: respond with ONLY the JSON object.`,
  );
  return (
    parseJudgeResponse(retry) ?? {
      verdict: "uncertain",
      confidence: 0,
      evidence: "",
      reasoning: "Judge returned an unparseable response twice.",
    }
  );
}
