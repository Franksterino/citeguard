# CiteGuard calibration benchmark

Honest numbers on a labeled test set, because a verifier that overclaims is worse than no verifier.

## Method

- **45 claim/source pairs**, hand-crafted against stable Wikipedia articles across 5 domains (science, history, tech, geography, economics).
- Ground-truth labels: `supported` (14), `partially_supported` (12), `contradicted` (12), `unsupported` (7).
  - *supported* — close paraphrase of a sentence actually on the page
  - *partially_supported* — core fact on the page, exactly one material detail altered (wrong year, inflated number)
  - *contradicted* — negation of a clearly stated fact
  - *unsupported* — on-topic, plausible, absent from the page
- Every item was independently **adversarially label-checked** (label kept only when unambiguous under the definitions); 15 of 60 drafted items were dropped in that audit.
- Eval runs the **full production pipeline** — live fetch, content extraction, LLM judge — not just the judge.
- Judge model: `qwen3.7-plus`, temperature 0.

Dataset: [`claims.json`](./claims.json) · Runner: [`run_eval.mjs`](./run_eval.mjs) · Raw output: [`results.json`](./results.json)

## Results (2026-07-06, v0.1.2)

| Metric | Value |
|---|---|
| Exact verdict accuracy | **93.3%** (42/45) |
| Binary gate accuracy (pass/fail) | **93.3%** |
| False passes (bad claim judged supported) | **0** |
| Fetch failures on the set | 0 |
| `uncertain` cop-outs | 0 |

Confusion (expected → got), errors only:

| id | expected | got |
|---|---|---|
| history-5 | contradicted | partially_supported |
| history-8 | partially_supported | contradicted |
| tech-6 | partially_supported | contradicted |

All three residual errors sit on the `partially_supported` / `contradicted` boundary — cases where "one detail differs" vs "states the opposite" is genuinely arguable (e.g. splashdown in the Atlantic vs Pacific: wrong ocean as a detail, or opposite of the stated fact?). **No error crosses the safety boundary**: nothing false was ever judged `supported`.

## What changed to get here

v0.1.1 scored 80%: the judge collapsed altered-detail claims (`partially_supported`) into `contradicted` — strictly conservative but taxonomically wrong. v0.1.2 sharpened the label boundary in the judge contract (wrong detail with central assertion intact → partial; opposite central assertion → contradicted). +13 points, all from that one fix.

## Caveats

- 45 items is a calibration set, not a benchmark suite. It measures the pipeline's behavior on clean, unambiguous cases; real-world citations are messier.
- Sources here are Wikipedia (fetchable, well-structured). Paywalled/bot-blocked sources degrade to honest `could_not_fetch` in production.
- A `supported` verdict means *the cited source says this* — not that it's true.
