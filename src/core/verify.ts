/** Orchestration: claims -> fetch -> extract -> judge -> verdicts. */

import type {
  Claim,
  ClaimVerdict,
  DocumentReport,
  JudgeClient,
  SourceStatus,
} from "../types.js";
import { fetchSource } from "./fetcher.js";
import { extractContent } from "../extract/content.js";
import { extractCitations } from "../extract/citations.js";
import { judgeClaim } from "../judge/entailment.js";

const CONCURRENCY = 4;

async function verifyOne(judge: JudgeClient, claim: Claim): Promise<ClaimVerdict> {
  const { status, body } = await fetchSource(claim.source);

  if (!body || (!status.ok && !status.fromArchive)) {
    return {
      claimId: claim.id,
      claim: claim.text,
      source: claim.source,
      verdict: "could_not_fetch",
      confidence: 0,
      evidence: "",
      reasoning: status.error
        ? `Fetch failed: ${status.error}`
        : `Source returned HTTP ${status.httpStatus}${status.redirectedToRoot ? " (redirected to site root - deep link likely dead)" : ""} and no archive.org snapshot was usable.`,
      sourceStatus: status,
    };
  }

  const content = await extractContent(body, status.contentType);
  if (content.text.length < 80) {
    return {
      claimId: claim.id,
      claim: claim.text,
      source: claim.source,
      verdict: "could_not_fetch",
      confidence: 0,
      evidence: "",
      reasoning:
        "Source fetched but no meaningful text could be extracted (likely bot-blocked, JS-only, or empty page).",
      sourceStatus: status,
    };
  }

  const outcome = await judgeClaim(judge, claim, content);
  return {
    claimId: claim.id,
    claim: claim.text,
    source: claim.source,
    ...outcome,
    sourceStatus: status,
  };
}

/** Verify an explicit list of claims with bounded concurrency. */
export async function verifyClaims(
  judge: JudgeClient,
  claims: Claim[],
): Promise<ClaimVerdict[]> {
  const results: ClaimVerdict[] = new Array(claims.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, claims.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= claims.length) return;
      try {
        results[i] = await verifyOne(judge, claims[i]);
      } catch (err) {
        const status: SourceStatus = {
          resolvedUrl: claims[i].source,
          httpStatus: 0,
          ok: false,
          fromArchive: false,
          redirectedToRoot: false,
          contentType: "",
          error: err instanceof Error ? err.message : String(err),
        };
        results[i] = {
          claimId: claims[i].id,
          claim: claims[i].text,
          source: claims[i].source,
          verdict: "uncertain",
          confidence: 0,
          evidence: "",
          reasoning: `Verification errored: ${status.error}`,
          sourceStatus: status,
        };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

const SCORE_WEIGHTS: Record<string, number> = {
  supported: 1,
  partially_supported: 0.5,
  uncertain: 0.25,
  could_not_fetch: 0.25,
  unsupported: 0,
  contradicted: 0,
};

export function buildReport(verdicts: ClaimVerdict[]): DocumentReport {
  const summary = {
    total: verdicts.length,
    supported: 0,
    partiallySupported: 0,
    contradicted: 0,
    unsupported: 0,
    uncertain: 0,
    couldNotFetch: 0,
  };
  let score = 0;
  for (const v of verdicts) {
    score += SCORE_WEIGHTS[v.verdict] ?? 0;
    switch (v.verdict) {
      case "supported": summary.supported += 1; break;
      case "partially_supported": summary.partiallySupported += 1; break;
      case "contradicted": summary.contradicted += 1; break;
      case "unsupported": summary.unsupported += 1; break;
      case "uncertain": summary.uncertain += 1; break;
      case "could_not_fetch": summary.couldNotFetch += 1; break;
    }
  }
  return {
    verdicts,
    integrityScore: verdicts.length === 0 ? 100 : Math.round((score / verdicts.length) * 100),
    summary,
  };
}

/** Full-document audit: extract citations from text, verify each. */
export async function checkDocument(
  judge: JudgeClient,
  documentText: string,
): Promise<DocumentReport> {
  const claims = extractCitations(documentText);
  const verdicts = await verifyClaims(judge, claims);
  return buildReport(verdicts);
}
