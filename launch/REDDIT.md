# Reddit posts — instructions + texts

**Rules:** 1 subreddit per day max (spreading avoids spam filters + lets us adapt from feedback). Post from your account, honest voice. If comments come, paste them to me — I draft replies, you review and post.

**Order:** r/ClaudeAI (day 1) → r/SideProject (day 2) → r/artificial (day 3, only if the first two got any traction).

---

## 1. r/ClaudeAI — angle: new MCP server for Claude users

**Title:**
```
I made an MCP server that checks whether cited sources actually support the claims in AI text
```

**Body:**
```
After the KPMG "vibe citing" fiasco (only 5/45 citations in their AI report held up),
I built CiteGuard — an MCP server that audits citations mechanically.

Give Claude the `check_document` tool and it can audit any draft: each citation gets
fetched, boilerplate-stripped, and judged for entailment — does the source text
actually contain the claim? Every verdict comes back with a verbatim quote from the
source, so you can verify the verdict itself in seconds.

Six verdict types: supported / partially_supported / contradicted / unsupported /
uncertain / could_not_fetch. Dead links get an archive.org fallback. Unfetchable
sources are never judged blind.

Setup (stdio):
    npx citeguard-mcp
    (env: CITEGUARD_JUDGE_PRESET=anthropic, CITEGUARD_JUDGE_KEY=sk-...)

Or the hosted remote MCP endpoint — it's in the official MCP registry as
io.github.Franksterino/citeguard.

Also has a check_links tool that needs no LLM key at all (pure dead-link checker).

Open source (MIT): https://github.com/Franksterino/citeguard
Web demo without any setup: https://citeguard.boundy.workers.dev/demo

Disclosure: built AI-assisted (Claude Code) under my direction — details in the repo.
Feedback very welcome, especially on what verdict granularity you'd actually want
in a writing workflow.
```

---

## 2. r/SideProject — angle: build story

**Title:**
```
Built a citation-checker for AI text in 4 days — live on 6 channels, $0 infrastructure
```

**Body:**
```
The hook: KPMG had to pull a flagship AI report in June because investigators found
most citations didn't support the claims. That failure mode ("vibe citing") is
everywhere AI writes with citations.

So I shipped CiteGuard: it fetches every cited source and returns a verdict per
claim, with a verbatim evidence quote. Not an AI detector — a source-vs-claim
entailment checker.

What made this fun as a side project:
- One core engine, six distribution surfaces: npm package, MCP registry, hosted API,
  web demo, Apify actor, open-source repo. Build once, list everywhere.
- $0 infra: Cloudflare Workers free tier + KV cache. The LLM judge runs on free-tier
  Qwen credits with a Workers AI fallback.
- The whole demo video was generated headlessly with Playwright + ffmpeg.

Honest numbers so far: 265 npm downloads on day one (mostly mirrors, let's be real),
0 paying users yet, submitted to a hackathon for the prize lottery.

Demo: https://citeguard.boundy.workers.dev/demo
Repo: https://github.com/Franksterino/citeguard

Disclosure: heavily AI-assisted build (Claude wrote most of the code, Qwen runs the
verification) — which feels fitting for a tool that polices AI output.
```
