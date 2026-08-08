export * from "./types.js";
export { extractCitations } from "./extract/citations.js";
export { extractContent } from "./extract/content.js";
export { fetchSourceWithNodeSafety as fetchSource } from "./core/node-safe-fetch.js";
export { buildReport } from "./core/verify.js";
export { judgeClaim } from "./judge/entailment.js";
export { OpenAICompatibleJudge, judgeFromEnv } from "./judge/providers.js";

import { fetchSourceWithNodeSafety } from "./core/node-safe-fetch.js";
import {
  checkDocument as checkDocumentCore,
  verifyClaims as verifyClaimsCore,
} from "./core/verify.js";
import type { Claim, ClaimVerdict, DocumentReport, JudgeClient } from "./types.js";

/** Node-safe public API: DNS is validated in the socket connection path. */
export function verifyClaims(
  judge: JudgeClient,
  claims: Claim[],
): Promise<ClaimVerdict[]> {
  return verifyClaimsCore(judge, claims, fetchSourceWithNodeSafety);
}

/** Node-safe public API: DNS is validated in the socket connection path. */
export function checkDocument(
  judge: JudgeClient,
  documentText: string,
): Promise<DocumentReport> {
  return checkDocumentCore(judge, documentText, fetchSourceWithNodeSafety);
}
