# AI Citation Auditor

**Verify every citation in AI-generated text against the source it actually cites.**

LLMs routinely produce citations that *look* real — the URL resolves, the paper exists — but the source doesn't say what the text claims it says. In June 2026 KPMG had to pull a flagship report after most of its citations turned out to be fabricated or misattributed. This Actor catches that before you publish.

## What it does

For every citation in your document, the Auditor:

1. **Extracts** claim + source pairs (markdown links, footnotes, DOIs, bare URLs)
2. **Fetches** the cited source — dead links get an automatic archive.org fallback
3. **Reads** the actual page content (boilerplate stripped, PDFs supported)
4. **Judges** whether the source supports the claim, using an LLM that sees *only the fetched source text* — never its own world knowledge

## Output

One row per claim:

| Field | Meaning |
|---|---|
| `verdict` | `supported` / `partially_supported` / `contradicted` / `unsupported` / `uncertain` / `could_not_fetch` |
| `evidence` | **Verbatim quote** from the source backing the verdict — verify it yourself in seconds |
| `confidence` | Judge confidence 0–1 |
| `reasoning` | One-sentence explanation |
| `httpStatus`, `resolvedUrl`, `fromArchive` | Source liveness details |

Plus a `REPORT` in the key-value store with a **citation integrity score (0–100)** and per-verdict summary.

## Input

Three ways to use it:

```json
{ "documentText": "Your markdown or plain text with citations..." }
```

```json
{ "documentUrl": "https://example.com/report.html" }
```

```json
{ "claims": [{ "text": "The Eiffel Tower is 330 m tall.", "source": "https://en.wikipedia.org/wiki/Eiffel_Tower" }] }
```

## What it is not

- **Not an AI-text detector** — it doesn't care who wrote the text.
- **Not a truth oracle** — `supported` means *the cited source says this*, not *this is true*.
- **Never guesses** — unreachable sources are reported as `could_not_fetch`, not judged blind.

## Use cases

- Pre-publish gate for AI-drafted reports, blog posts, whitepapers
- CI check for docs and marketing content
- Auditing research summaries and literature reviews
- Due diligence on any citation-heavy document

Open-source core: [github.com/Franksterino/citeguard](https://github.com/Franksterino/citeguard)
