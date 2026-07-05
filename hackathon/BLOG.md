# I built an AI agent that catches other AI agents' fake citations — in 4 days, on Qwen Cloud

*How "vibe citing" became a product, and what I learned making one LLM police another.*

---

In June 2026, KPMG pulled a flagship report on agentic AI after investigators found that only **5 of its 45 citations** pointed to real, supporting sources. The rest were paraphrased fragments, misattributed papers, or links that simply didn't contain the claims they were supposed to back. GPTZero, who ran the investigation, coined a name for it: **vibe citing**.

Here's the uncomfortable part: this isn't a KPMG problem. Every team shipping AI-drafted reports, research summaries, or documentation is one unchecked draft away from the same headline. Hallucination benchmarks in 2026 still show inline-citation factuality failing at rates between 22% and 94% depending on the model and task.

And prompting won't fix it. You can beg a model to "only cite real sources" all day; it will nod and fabricate. What works is **grounding** — actually fetching the source and checking the claim against it. That's not a prompt. That's a tool.

So during the Global AI Hackathon with Qwen Cloud, I built the tool.

## CiteGuard: verification as an agent, not a dashboard

CiteGuard does one thing: given a claim and the source it cites, it decides whether the source **actually supports the claim** — and shows its work.

The pipeline, per citation:

1. **Extract** — pull claim+source pairs out of raw text: markdown links, footnotes, DOIs, bare URLs. The sentence containing the citation is the claim the source must support.
2. **Fetch** — download the source with real-world armor: timeouts, size caps, redirect tracking. Dead link? Automatic archive.org fallback. Redirect that lands on a homepage? Flagged as a "soft 404" — the deep link is gone even though HTTP says 200.
3. **Distill** — strip navigation and boilerplate (Mozilla Readability), extract PDF text, cap the size.
4. **Judge** — qwen3.7-plus reads the claim and *only the fetched source text*, and returns a verdict:

```
supported | partially_supported | contradicted | unsupported | uncertain | could_not_fetch
```

Every verdict ships with a **verbatim quote** from the source. That's the trust anchor: you don't have to believe the model — you can read the quote and check in five seconds.

## The one rule that makes it work

The judge must not know things.

My first prompt let Qwen use its own knowledge, and it happily marked "the Eiffel Tower is 330 m tall" as supported **regardless of what the cited page said** — because it knows the tower's height. That's exactly backwards. A citation checker that trusts its own memory is just vibe citing with extra steps.

The fix is a hard contract in the system prompt:

> Judge ONLY against the provided source text. Never use your own knowledge of the world to fill gaps. "evidence" MUST be a verbatim quote copied from the source text.

With that constraint, the whole system inverts: the model becomes a reading comprehension engine instead of an oracle. Qwen turned out to be very good at this — precise quote extraction, willing to say "unsupported" — with temperature 0 and a JSON-only response format.

Two more honesty rules matter:

- **Never judge blind.** If a source can't be fetched (paywall, bot-block, link rot beyond archive.org's reach), the verdict is `could_not_fetch` — not a guess.
- **Admit uncertainty.** Garbled or fragmentary source text yields `uncertain`. A verifier that overclaims is worse than no verifier.

## The Agent Society demo: writer vs. verifier

For the hackathon's Agent Society track I wired two agents into a pipeline you can run live:

1. A **writer agent** (qwen3.7-plus) drafts a paragraph on your topic with inline citations — exactly like every AI writing tool you've used.
2. The **verifier agent** (CiteGuard, judged by Qwen) fetches every cited source and audits every claim.
3. A **gate** approves or blocks the draft: any `contradicted` or `unsupported` citation kills it.

Watching it run is the whole pitch. The writer produces a beautiful, confident paragraph about the Prague astronomical clock with three citations. The verifier comes back: one supported, one partially supported (right fact, wrong century), one where the cited page doesn't mention the claim at all. **BLOCKED.** With quotes.

Try it: **[citeguard.boundy.workers.dev/demo](https://citeguard.boundy.workers.dev/demo)**

## The build, honestly

Stack: TypeScript everywhere. Cloudflare Worker at the edge for the API, web demo, and a **remote MCP endpoint** — so Claude, IDEs, and agent frameworks can call `verify_claims` as a native tool. Qwen via the OpenAI-compatible DashScope International endpoint, which made integration trivial (swap `base_url`, done). Open-source core on GitHub (MIT), plus an Apify Actor for batch audits.

Things that fought back:

- **The web is hostile.** Britannica bot-blocks. Paywalls everywhere. archive.org rescued more dead links than I expected; the rest are honest `could_not_fetch`s.
- **Reasoning models leak.** qwen3.7's thinking traces are great for quality but you must parse the final JSON out of the response robustly, with a retry contract.
- **Sentence splitting is a minefield** when sentences contain URLs full of periods. My splitter only breaks on punctuation followed by whitespace — dots inside `10.48550/arXiv.1706.03762` stay put.

Full disclosure, because a citation-integrity project should model integrity: this was built with heavy AI assistance (Claude wrote most of the code) under human direction, and this post was AI-drafted and human-reviewed. Every technical claim in it is checkable against the repo.

## What a verifier agent is really for

The agent economy's missing primitive isn't another writer — it's **trust infrastructure**. Agents that generate need agents that check. The pattern generalizes:

- Pre-publish gates for AI-drafted reports and docs
- CI checks that block PRs adding unsupported citations
- Middleware for agent frameworks: no write-then-publish pipeline should ship without a verification pass

Verification is tractable when you constrain the verifier: fetched text only, quotable evidence, honest uncertainty. That's the whole trick. Steal it.

---

*CiteGuard is open source (MIT): [github.com/Franksterino/citeguard](https://github.com/Franksterino/citeguard). Live demo: [citeguard.boundy.workers.dev/demo](https://citeguard.boundy.workers.dev/demo). Built for the Global AI Hackathon Series with Qwen Cloud, July 2026.*
