#!/usr/bin/env node
/** CiteGuard MCP server (stdio).
 *
 * Tools:
 *  - verify_claims: explicit claim+source pairs -> per-claim verdicts
 *  - check_document: raw markdown/text -> extract citations -> full report
 *  - check_links: liveness-only pass (no LLM needed)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { verifyClaims, checkDocument, buildReport } from "../core/verify.js";
import { fetchSource } from "../core/fetcher.js";
import { extractCitations } from "../extract/citations.js";
import { judgeFromEnv } from "../judge/providers.js";
import type { JudgeClient } from "../types.js";

let judge: JudgeClient | undefined;
function getJudge(): JudgeClient {
  judge ??= judgeFromEnv();
  return judge;
}

const server = new McpServer({
  name: "citeguard",
  version: "0.1.2",
});

server.tool(
  "verify_claims",
  "Verify claim+source pairs: fetches each cited URL and returns a per-claim verdict (supported / partially_supported / contradicted / unsupported / uncertain / could_not_fetch) with a quoted evidence span from the source.",
  {
    claims: z
      .array(
        z.object({
          text: z.string().describe("The claim to verify"),
          source: z.string().url().describe("URL (or DOI URL) the claim cites"),
          context: z.string().optional().describe("Optional surrounding context"),
        }),
      )
      .min(1)
      .max(50),
  },
  async ({ claims }) => {
    const withIds = claims.map((c, i) => ({ id: `c${i + 1}`, ...c }));
    const verdicts = await verifyClaims(getJudge(), withIds);
    const report = buildReport(verdicts);
    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  },
);

server.tool(
  "check_document",
  "Audit every citation in a markdown/plain-text document: extracts claim+source pairs (markdown links, footnotes, DOIs, bare URLs), verifies each against the fetched source, and returns a full report with a citation integrity score (0-100).",
  {
    document: z.string().min(1).describe("The document text (markdown or plain text)"),
  },
  async ({ document }) => {
    const report = await checkDocument(getJudge(), document);
    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  },
);

server.tool(
  "check_links",
  "Liveness-only check (no LLM required): extracts all cited URLs from a document and reports dead links, redirects to homepages, and archive.org availability.",
  {
    document: z.string().min(1).describe("The document text (markdown or plain text)"),
  },
  async ({ document }) => {
    const claims = extractCitations(document);
    const unique = [...new Map(claims.map((c) => [c.source, c])).values()];
    const results = await Promise.all(
      unique.map(async (c) => {
        const { status } = await fetchSource(c.source);
        return { source: c.source, ...status };
      }),
    );
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
