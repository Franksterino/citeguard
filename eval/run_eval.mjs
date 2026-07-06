/** CiteGuard calibration eval: run the labeled claim set through the real
 * pipeline (fetch + extract + judge) and score verdicts against ground truth.
 *
 * Usage: CITEGUARD_JUDGE_PRESET=qwen CITEGUARD_JUDGE_KEY=... node eval/run_eval.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { verifyClaims } from "../dist/core/verify.js";
import { judgeFromEnv } from "../dist/judge/providers.js";

const LABELS = ["supported", "partially_supported", "contradicted", "unsupported"];
const { items } = JSON.parse(readFileSync(new URL("./claims.json", import.meta.url), "utf-8"));

const judge = judgeFromEnv();
console.error(`Evaluating ${items.length} claims with judge model: ${judge.model}`);

const claims = items.map((it) => ({ id: it.id, text: it.claim, source: it.source }));
const verdicts = await verifyClaims(judge, claims);

const byId = new Map(verdicts.map((v) => [v.claimId, v]));
const rows = items.map((it) => ({
  id: it.id,
  expected: it.expected,
  got: byId.get(it.id)?.verdict ?? "missing",
  confidence: byId.get(it.id)?.confidence ?? 0,
  evidence: byId.get(it.id)?.evidence ?? "",
}));

// Confusion matrix over judgeable rows (exclude could_not_fetch/uncertain from strict accuracy,
// but report them separately — they are honesty outcomes, not classification errors).
const judgeable = rows.filter((r) => LABELS.includes(r.got));
const exact = judgeable.filter((r) => r.got === r.expected).length;

// Binary gate accuracy: pass = supported|partially_supported, fail = contradicted|unsupported
const toGate = (l) => (l === "supported" || l === "partially_supported" ? "pass" : "fail");
const gateCorrect = judgeable.filter((r) => toGate(r.got) === toGate(r.expected)).length;

const matrix = {};
for (const e of LABELS) {
  matrix[e] = {};
  for (const g of [...LABELS, "uncertain", "could_not_fetch"]) {
    matrix[e][g] = rows.filter((r) => r.expected === e && r.got === g).length;
  }
}

const summary = {
  judgeModel: judge.model,
  total: rows.length,
  judgeable: judgeable.length,
  couldNotFetch: rows.filter((r) => r.got === "could_not_fetch").length,
  uncertain: rows.filter((r) => r.got === "uncertain").length,
  exactAccuracy: +(exact / judgeable.length).toFixed(3),
  gateAccuracy: +(gateCorrect / judgeable.length).toFixed(3),
  confusionMatrix: matrix,
};

console.log(JSON.stringify(summary, null, 1));
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ summary, rows }, null, 1));
console.error("Wrong verdicts:");
for (const r of judgeable.filter((x) => x.got !== x.expected)) {
  console.error(` ${r.id}: expected ${r.expected}, got ${r.got} (conf ${r.confidence})`);
}
