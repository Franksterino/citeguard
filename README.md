# CiteGuard

**Per-claim citation verification for AI-generated text.** CiteGuard fetches every cited source and tells you whether it actually supports the claim — with a quoted evidence span, so you can verify the verdict yourself in seconds.

Built for the age of [vibe citing](https://gptzero.me/news/investigations-kpmg/): AI-drafted reports full of citations that resolve to real URLs but don't say what the text claims they say.

## What it does

Give CiteGuard a document (markdown or plain text) or explicit claim+URL pairs. For each claim it:

1. **Fetches the cited source** — with timeout handling, redirect tracking, a 5 MB cap, and an automatic [archive.org](https://archive.org) fallback for dead links.
2. **Checks source liveness** — dead URLs, DOI redirects, and "soft 404s" (redirects that land on a homepage) are flagged explicitly.
3. **Extracts the real content** — boilerplate-stripped article text via Readability; PDFs supported.
4. **Judges entailment** — an LLM reads *only the fetched source text* (never its own world knowledge) and returns one of six verdicts.

| Verdict | Meaning |
|---|---|
| `supported` | Source clearly states or directly entails the claim |
| `partially_supported` | Part of the claim is there, but a material element differs or is absent |
| `contradicted` | Source states the opposite |
| `unsupported` | Source is real but does not contain the claim |
| `uncertain` | Source text too fragmentary/ambiguous to decide |
| `could_not_fetch` | Source unreachable and no archive snapshot — never guessed |

Every verdict ships with a **verbatim evidence quote**, a confidence score, and full source status. Document audits also return a **citation integrity score (0–100)**.

CiteGuard never overclaims: if it can't fetch a source, it says so instead of judging blind, and borderline cases land in `uncertain` — the goal is to make human verification 10× faster, not to replace it.

## Quick start (MCP)

Add to Claude Code / Claude Desktop / any MCP client:

```json
{
  "mcpServers": {
    "citeguard": {
      "command": "npx",
      "args": ["-y", "citeguard-mcp"],
      "env": {
        "CITEGUARD_JUDGE_PRESET": "qwen",
        "CITEGUARD_JUDGE_KEY": "sk-..."
      }
    }
  }
}
```

Tools exposed: `verify_claims`, `check_document`, `check_links` (liveness-only, needs no LLM key).

## Quick start (CLI)

```bash
npm install -g citeguard

citeguard extract report.md   # show extracted claim/source pairs (no network)
citeguard links report.md     # dead-link check (no LLM needed)
citeguard check report.md     # full audit (needs judge configured)
```

## Judge configuration

CiteGuard is model-agnostic — anything with an OpenAI-compatible chat endpoint works:

```bash
# Preset providers
export CITEGUARD_JUDGE_PRESET=qwen        # or: openai, anthropic
export CITEGUARD_JUDGE_KEY=sk-...

# Or any OpenAI-compatible endpoint
export CITEGUARD_JUDGE_URL=https://your-endpoint/v1
export CITEGUARD_JUDGE_MODEL=your-model
export CITEGUARD_JUDGE_KEY=sk-...
```

## Hosted API

A free hosted endpoint (50 requests/day/IP) runs on Cloudflare Workers:

```bash
curl -X POST https://citeguard.YOUR-SUBDOMAIN.workers.dev/api/verify \
  -H "content-type: application/json" \
  -d '{"claims":[{"text":"The Eiffel Tower is 330 m tall.","source":"https://en.wikipedia.org/wiki/Eiffel_Tower"}]}'
```

Remote MCP endpoint: `POST /mcp` (streamable HTTP, stateless).

## What CiteGuard is not

- **Not an AI-text detector.** It doesn't care who wrote the text — it checks whether cited sources support claims.
- **Not a truth oracle.** A `supported` verdict means *the cited source says this*, not *this is true*. Garbage source in, garbage support out.
- **Not a search engine.** It verifies the citations you have; it doesn't find better ones (yet).

## Extraction formats

Markdown inline links, reference-style links, footnotes, bare DOIs (resolved via doi.org), bare URLs. APA-style parsing and PDF *input* documents are on the roadmap.

## Development

```bash
git clone https://github.com/Franksterino/citeguard
cd citeguard
npm install
npm run typecheck
npx tsx src/cli.ts extract test/fixtures/sample.md
```

## License

MIT
