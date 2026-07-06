# Show HN post — instructions + text

**When to post:** Tuesday–Thursday, 14:00–16:00 CEST (= 8-10am ET, best HN window). Never weekend.
**Where:** https://news.ycombinator.com/submit
**Important:** post from your own account, in your own name. Reply to comments personally (I'll draft replies if you paste comments to me). HN bans undisclosed astroturfing — we are fully transparent that the product is AI-built under human direction; it's in the README and the linked blog post.

---

**Title (max 80 chars):**

```
Show HN: CiteGuard – check whether cited sources actually support the claims
```

**URL:**

```
https://citeguard.boundy.workers.dev/demo
```

**First comment (post immediately after submitting — this is the "author's note"):**

```
Hi HN. In June, KPMG pulled a flagship AI report after only 5 of its 45 citations
turned out to point at real, supporting sources. The failure mode has a name now —
"vibe citing": the URL resolves, the paper exists, but the source doesn't say what
the text claims it says.

CiteGuard is a small tool that checks this mechanically. For each citation in a
document it: extracts the claim sentence, fetches the cited URL (archive.org
fallback for dead links), strips boilerplate, and has an LLM judge decide whether
the source text entails the claim. The judge is constrained to the fetched text
only — it never gets to "know" anything — and every verdict must include a verbatim
quote from the source, so you can check the checker in seconds.

Verdicts: supported / partially_supported / contradicted / unsupported / uncertain /
could_not_fetch. Unreachable sources are reported honestly, never guessed.

It runs as: an MCP server (npm: citeguard, or the hosted remote endpoint), a REST
API, an Apify actor for batch audits, and the web demo above. Open source, MIT.

Honest limitations: entailment judging is probabilistic — treat it as a 10x faster
human review, not an oracle; paywalled/bot-blocked sources come back as
could_not_fetch (Britannica blocks us, for example); and a "supported" verdict means
the source says it, not that it's true. Calibration numbers on a labeled test set
are in the repo.

Disclosure: I directed the project; the code was largely written by an AI assistant
(Claude), and the product itself runs on Qwen. Feels appropriate for a tool whose
whole job is checking AI output.

Repo: https://github.com/Franksterino/citeguard
```

---

**If it gets traction, expect these questions (drafts):**

- *"Isn't this just RAG?"* — Reverse direction. RAG retrieves sources to write text; this audits existing text against its own cited sources. The judge never retrieves anything new.
- *"LLM judging LLM = turtles all the way down?"* — The judge does reading comprehension on a fetched document, not open-ended generation. Constrained task, verbatim evidence required, calibration published. It replaces the *mechanical* part of review, the click-read-search loop, not the judgment.
- *"What about paywalls?"* — could_not_fetch, honestly reported. Archive.org rescues a chunk. The Apify actor (with browser+proxies) is the heavy path.
