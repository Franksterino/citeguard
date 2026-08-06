# Apify MCP citation agent demo

This example shows a real Qwen agent calling the public CiteGuard Apify Actor through the hosted Apify MCP server and then retrieving the verdict rows from the run dataset.

## Requirements

- Node.js 18 or later
- an Apify API token in `APIFY_TOKEN`
- a Qwen API key in `QWEN_API_KEY`

## Run

From the CiteGuard repository root:

```bash
npm install
node examples/apify-mcp-citation-agent.mjs
```

The script exposes only the CiteGuard Actor and its storage helper tools. It asks the model to check two Eiffel Tower claims, prints the selected tool sequence, and returns the final evidence-backed review.

Never commit either API key to the repository.
