# Devpost submission — Global AI Hackathon Series with Qwen Cloud

**Project name:** CiteGuard — an agent that catches other agents' fake citations

**Track:** Agent Society (multi-agent collaboration)

**Elevator pitch (200 chars):**
Writer agent drafts, verifier agent audits: CiteGuard fetches every cited source and blocks claims the source doesn't support — with verbatim evidence quotes. The API-shaped fix for "vibe citing."

---

## Inspiration

In June 2026, KPMG pulled a flagship AI report after investigators found that only 5 of its 45 citations pointed to real, supporting sources. The industry named the failure mode "vibe citing": AI text whose citations *look* real — the URLs resolve, the papers exist — but don't say what the text claims they say.

Prompting can't fix this; grounding can. Verification is a *tool-shaped* problem: someone has to actually fetch the source and read it. So we built the tool — and made it an agent that other agents can call.

## What it does

CiteGuard is a verification agent with one job: given claims and the sources they cite, decide whether each source actually supports each claim.

For every citation it:
1. **Extracts** claim+source pairs from raw text (markdown links, footnotes, DOIs, bare URLs)
2. **Fetches** the cited source — dead links fall back to archive.org automatically; redirects to homepages are flagged as "soft 404s"
3. **Distills** the real content (Readability boilerplate-stripping, PDF text extraction)
4. **Judges** entailment with Qwen: the model reads *only the fetched source text* — never its own world knowledge — and returns one of six verdicts with a **verbatim evidence quote**
5. **Gates** the document: contradicted or unsupported citations block approval; the report carries a 0–100 citation integrity score

The Agent Society demo shows the full loop live: a **writer agent** (qwen3.7-plus) drafts a cited paragraph on any topic, the **verifier agent** (CiteGuard + Qwen judge) audits every citation in real time, and the gate approves or blocks the draft. One AI catches another AI's fabrications, live, with receipts.

**Try it now (no signup):** https://citeguard.boundy.workers.dev/demo

## How we built it

- **Core** (TypeScript): citation parser, hardened fetcher (timeouts, size caps, soft-404 detection, archive.org fallback), Readability+linkedom content extraction, unpdf for PDFs, provider-agnostic entailment judge
- **Qwen Cloud**: qwen3.7-plus powers both agents via the OpenAI-compatible DashScope International endpoint — the writer generates citation-dense prose; the judge performs strict entailment with a JSON-only contract and quote-extraction requirement
- **Edge deployment**: Cloudflare Worker serves the REST API, the web demo, and a **remote MCP endpoint** (streamable HTTP) so any MCP client — Claude, IDEs, agent frameworks — can call `verify_claims` / `check_document` / `check_links` as tools
- **Distribution**: open-source core (MIT) on GitHub; also published as a monetized Apify Actor ("AI Citation Auditor")

## Challenges we ran into

- **The judge must not "know things."** Early prompts let the model use world knowledge, which defeats the purpose — a judge that "knows" the Eiffel Tower is in Paris will approve the claim even if the cited source is about pastry recipes. The final prompt contract forces verdicts derived only from the provided source text, with a mandatory verbatim quote that makes every verdict human-checkable.
- **The web fights back.** Paywalls, bot-blocking, JS-only pages, link rot. The pipeline never judges blind: unfetchable sources return an honest `could_not_fetch` instead of a hallucinated verdict, and archive.org rescues a surprising share of dead links.
- **Calibration over confidence.** A verifier that overclaims is worse than none. Borderline cases land in `uncertain`, and "partially_supported" exists because most real-world citation failures are subtle — the right number, the wrong year.

## Accomplishments we're proud of

- End-to-end live product in days, not weeks — and every layer is real: real fetches, real entailment, real evidence quotes
- The gate demo: watching the writer agent get *blocked* because its Britannica citation doesn't actually contain the claimed fact is genuinely satisfying
- Zero-cost, globally distributed deployment that anyone can use right now

## What we learned

Citation verification is tractable *if* you refuse to let the LLM freelance. Constrain the judge to fetched text, require quotable evidence, admit uncertainty honestly — and the verdicts become something a human can trust and check in seconds.

## What's next

- Calibration benchmark: published accuracy numbers on a hand-labeled claim set
- APA/BibTeX-style citation parsing and PDF *input* documents
- CI integration (GitHub Action): block PRs that add unsupported citations
- Verifier-as-middleware for agent frameworks — every write-then-publish pipeline needs a gate

## Built with

TypeScript · Qwen Cloud (qwen3.7-plus, DashScope Intl) · Cloudflare Workers + KV · Model Context Protocol SDK · Mozilla Readability · linkedom · unpdf · Apify SDK

## Links

- **Live demo:** https://citeguard.boundy.workers.dev/demo
- **Open-source repo (MIT):** https://github.com/Franksterino/citeguard
- **Hosted API + remote MCP:** https://citeguard.boundy.workers.dev
- **Apify Actor:** https://apify.com/franksterino/ai-citation-auditor

---

## Submission checklist (Devpost form)

- [ ] Track: **Agent Society**
- [ ] Public repo URL: https://github.com/Franksterino/citeguard (MIT license visible)
- [ ] Text description: paste sections above
- [ ] Architecture diagram: `architecture.svg` (convert to PNG for upload)
- [ ] Proof of Alibaba Cloud deployment: `worker/src/index.ts` + `src/judge/providers.ts` (DashScope Intl API integration) — include file link + screenshot of Qwen Cloud console usage
- [ ] Demo video: < 3 min, YouTube link
- [ ] Optional blog post link (Blog Post Award)
- [ ] AI-use disclosure: project built with AI assistance (Claude) under human direction — disclosed in repo README
