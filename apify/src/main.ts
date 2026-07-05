/** AI Citation Auditor — Apify Actor wrapper around the CiteGuard core.
 *
 * Input: documentText | documentUrl | explicit claims[].
 * Output: dataset rows (one per claim verdict) + REPORT in the key-value store.
 *
 * Charging: pay-per-event. Events are charged defensively — when the actor
 * is not monetized (local runs, free accounts) charge() failures are ignored.
 */

import { Actor } from "apify";

import { verifyClaims, buildReport } from "../../src/core/verify.js";
import { extractCitations } from "../../src/extract/citations.js";
import { fetchSource } from "../../src/core/fetcher.js";
import { extractContent } from "../../src/extract/content.js";
import { judgeFromEnv } from "../../src/judge/providers.js";
import type { Claim } from "../../src/types.js";

interface ActorInput {
  documentText?: string;
  documentUrl?: string;
  claims?: { text: string; source: string; context?: string }[];
  maxClaims?: number;
}

async function charge(eventName: string, count = 1): Promise<void> {
  try {
    await Actor.charge({ eventName, count });
  } catch {
    // Not monetized yet / local run - proceed without charging.
  }
}

await Actor.init();

const input = (await Actor.getInput<ActorInput>()) ?? {};
const maxClaims = Math.min(Math.max(input.maxClaims ?? 50, 1), 200);

await charge("run-start");

let claims: Claim[] = [];

if (input.claims?.length) {
  claims = input.claims.map((c, i) => ({ id: `c${i + 1}`, ...c }));
} else if (input.documentText?.trim()) {
  claims = extractCitations(input.documentText);
} else if (input.documentUrl?.trim()) {
  const { status, body } = await fetchSource(input.documentUrl);
  if (!body) {
    await Actor.fail(`Could not fetch documentUrl (HTTP ${status.httpStatus}${status.error ? `, ${status.error}` : ""}).`);
    process.exit(1);
  }
  const content = await extractContent(body, status.contentType);
  claims = extractCitations(content.text);
} else {
  await Actor.fail("Provide documentText, documentUrl, or claims in the input.");
  process.exit(1);
}

if (claims.length === 0) {
  await Actor.setValue("REPORT", {
    message: "No citations found in the document.",
    verdicts: [],
    integrityScore: 100,
  });
  await Actor.exit("No citations found - nothing to verify.");
  process.exit(0);
}

if (claims.length > maxClaims) {
  console.log(`Capping ${claims.length} extracted claims to maxClaims=${maxClaims}.`);
  claims = claims.slice(0, maxClaims);
}

console.log(`Verifying ${claims.length} claims...`);
const judge = judgeFromEnv();
const verdicts = await verifyClaims(judge, claims);
const report = buildReport(verdicts);

await charge("claim-verified", verdicts.length);

await Actor.pushData(
  verdicts.map((v) => ({
    claim: v.claim,
    source: v.source,
    verdict: v.verdict,
    confidence: v.confidence,
    evidence: v.evidence,
    reasoning: v.reasoning,
    httpStatus: v.sourceStatus.httpStatus,
    fromArchive: v.sourceStatus.fromArchive,
    resolvedUrl: v.sourceStatus.resolvedUrl,
  })),
);
await Actor.setValue("REPORT", report);

console.log(
  `Done. Integrity score: ${report.integrityScore}/100 ` +
    `(${report.summary.supported}/${report.summary.total} supported, ` +
    `${report.summary.contradicted} contradicted, ${report.summary.unsupported} unsupported, ` +
    `${report.summary.couldNotFetch} unfetchable).`,
);

await Actor.exit();
