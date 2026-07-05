/** CiteGuard hosted API + remote MCP endpoint (Cloudflare Worker).
 *
 * Routes:
 *   GET  /            service info
 *   POST /api/verify  { claims: [{text, source, context?}] } -> report
 *   POST /api/check   { document } -> full audit report
 *   POST /api/links   { document } -> liveness-only results
 *   POST /mcp         stateless MCP (streamable HTTP, JSON responses)
 *
 * Judge: Workers AI (free tier) by default; DashScope/Qwen when
 * DASHSCOPE_API_KEY secret is set (used for the Qwen hackathon deployment).
 */

import { verifyClaims, buildReport } from "../../src/core/verify.js";
import { fetchSource } from "../../src/core/fetcher.js";
import { extractCitations } from "../../src/extract/citations.js";
import { OpenAICompatibleJudge } from "../../src/judge/providers.js";
import type { JudgeClient } from "../../src/types.js";
import { DEMO_HTML } from "./demo.js";

interface Env {
  CACHE: KVNamespace;
  AI: Ai;
  FREE_DAILY_LIMIT: string;
  DASHSCOPE_API_KEY?: string;
  DASHSCOPE_MODEL?: string;
}

const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

class WorkersAiJudge implements JudgeClient {
  readonly model = WORKERS_AI_MODEL;
  constructor(private readonly ai: Ai) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const result = (await this.ai.run(WORKERS_AI_MODEL as never, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 512,
    } as never)) as Record<string, unknown>;
    // Workers AI response shape varies by model/runtime version.
    const raw =
      result?.response ??
      (result?.result as Record<string, unknown> | undefined)?.response ??
      (result?.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message
        ?.content ??
      "";
    return typeof raw === "string" ? raw : JSON.stringify(raw);
  }
}

function buildJudge(env: Env): JudgeClient {
  if (env.DASHSCOPE_API_KEY) {
    return new OpenAICompatibleJudge({
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      apiKey: env.DASHSCOPE_API_KEY,
      model: env.DASHSCOPE_MODEL ?? "qwen3.7-plus",
    });
  }
  return new WorkersAiJudge(env.AI);
}

/** Verdict cache: repeated audits of the same claim+source are near-free.
 * Definitive verdicts cached 7 days; could_not_fetch is never cached (transient). */
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function cachedVerifyClaims(
  env: Env,
  judge: JudgeClient,
  claims: { id: string; text: string; source: string; context?: string }[],
) {
  const keys = await Promise.all(claims.map((c) => sha256(`${c.text}|${c.source}`)));
  const cached = await Promise.all(keys.map((k) => env.CACHE.get(`v1:${k}`, "json")));
  const misses = claims.filter((_, i) => !cached[i]);
  const fresh = misses.length ? await verifyClaims(judge, misses) : [];
  const freshById = new Map(fresh.map((v) => [v.claimId, v]));
  const results = claims.map((c, i) => {
    const hit = cached[i] as Awaited<ReturnType<typeof verifyClaims>>[number] | null;
    return hit ? { ...hit, claimId: c.id } : freshById.get(c.id)!;
  });
  await Promise.all(
    fresh
      .filter((v) => v.verdict !== "could_not_fetch")
      .map((v, ) => {
        const idx = claims.findIndex((c) => c.id === v.claimId);
        return env.CACHE.put(`v1:${keys[idx]}`, JSON.stringify(v), { expirationTtl: 604800 });
      }),
  );
  return results;
}

async function auditDocument(env: Env, judge: JudgeClient, documentText: string) {
  const claims = extractCitations(documentText);
  const verdicts = await cachedVerifyClaims(env, judge, claims);
  return buildReport(verdicts);
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      ...extra,
    },
  });
}

async function rateLimit(env: Env, request: Request): Promise<Response | undefined> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${ip}:${day}`;
  const limit = Number(env.FREE_DAILY_LIMIT || "50");
  const current = Number((await env.CACHE.get(key)) ?? "0");
  if (current >= limit) {
    return json(
      {
        error: "free_tier_limit",
        message: `Free tier is ${limit} requests/day. Self-host (github.com/Franksterino/citeguard) or come back tomorrow.`,
      },
      429,
    );
  }
  // KV is eventually consistent; good enough for a soft limit.
  await env.CACHE.put(key, String(current + 1), { expirationTtl: 172800 });
  return undefined;
}

/* ------------------------------ MCP (stateless) ------------------------------ */

const TOOLS = [
  {
    name: "verify_claims",
    description:
      "Verify claim+source pairs: fetches each cited URL and returns a per-claim verdict (supported / partially_supported / contradicted / unsupported / uncertain / could_not_fetch) with a quoted evidence span from the source.",
    inputSchema: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "The claim to verify" },
              source: { type: "string", description: "URL (or DOI URL) the claim cites" },
              context: { type: "string", description: "Optional surrounding context" },
            },
            required: ["text", "source"],
          },
        },
      },
      required: ["claims"],
    },
  },
  {
    name: "check_document",
    description:
      "Audit every citation in a markdown/plain-text document: extracts claim+source pairs (markdown links, footnotes, DOIs, bare URLs), verifies each against the fetched source, and returns a report with a citation integrity score (0-100).",
    inputSchema: {
      type: "object",
      properties: {
        document: { type: "string", description: "Document text (markdown or plain text)" },
      },
      required: ["document"],
    },
  },
  {
    name: "check_links",
    description:
      "Liveness-only check (no LLM): extracts all cited URLs and reports dead links, homepage redirects, and archive.org availability.",
    inputSchema: {
      type: "object",
      properties: {
        document: { type: "string", description: "Document text (markdown or plain text)" },
      },
      required: ["document"],
    },
  },
];

async function callTool(env: Env, name: string, args: Record<string, unknown>): Promise<string> {
  const judge = buildJudge(env);
  if (name === "verify_claims") {
    const claims = (args.claims as { text: string; source: string; context?: string }[]).map(
      (c, i) => ({ id: `c${i + 1}`, ...c }),
    );
    const verdicts = await cachedVerifyClaims(env, judge, claims);
    return JSON.stringify(buildReport(verdicts), null, 2);
  }
  if (name === "check_document") {
    const report = await auditDocument(env, judge, String(args.document ?? ""));
    return JSON.stringify(report, null, 2);
  }
  if (name === "check_links") {
    const claims = extractCitations(String(args.document ?? ""));
    const unique = [...new Map(claims.map((c) => [c.source, c])).values()];
    const results = await Promise.all(
      unique.map(async (c) => {
        const { status } = await fetchSource(c.source);
        return { source: c.source, ...status };
      }),
    );
    return JSON.stringify(results, null, 2);
  }
  throw new Error(`unknown tool: ${name}`);
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

async function handleMcp(env: Env, request: Request): Promise<Response> {
  const body = (await request.json()) as JsonRpcRequest | JsonRpcRequest[];
  const messages = Array.isArray(body) ? body : [body];
  const responses: unknown[] = [];

  for (const msg of messages) {
    if (msg.id === undefined || msg.id === null) continue; // notification
    if (msg.method === "initialize") {
      responses.push({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion:
            (msg.params?.protocolVersion as string) ?? "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "citeguard", version: "0.1.0" },
        },
      });
    } else if (msg.method === "tools/list") {
      responses.push({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
    } else if (msg.method === "tools/call") {
      const name = msg.params?.name as string;
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await callTool(env, name, args);
        responses.push({
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text }] },
        });
      } catch (err) {
        responses.push({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [
              { type: "text", text: `Error: ${err instanceof Error ? err.message : err}` },
            ],
            isError: true,
          },
        });
      }
    } else if (msg.method === "ping") {
      responses.push({ jsonrpc: "2.0", id: msg.id, result: {} });
    } else {
      responses.push({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `method not found: ${msg.method}` },
      });
    }
  }

  if (responses.length === 0) return new Response(null, { status: 202 });
  return json(responses.length === 1 ? responses[0] : responses);
}

/* ---------------------------------- router ---------------------------------- */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
        },
      });
    }

    if (request.method === "GET" && (url.pathname === "/demo" || url.pathname === "/demo/")) {
      return new Response(DEMO_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        name: "CiteGuard",
        description:
          "Per-claim citation verification for AI-generated text. Fetches every cited source and returns supported/contradicted/unsupported verdicts with quoted evidence spans.",
        endpoints: {
          "POST /api/verify": "{ claims: [{ text, source }] }",
          "POST /api/check": "{ document }",
          "POST /api/links": "{ document }",
          "POST /mcp": "Model Context Protocol (streamable HTTP)",
        },
        source: "https://github.com/Franksterino/citeguard",
        freeTier: `${env.FREE_DAILY_LIMIT || "50"} requests/day per IP`,
      });
    }

    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    try {
      if (url.pathname === "/mcp") {
        // MCP tool calls do their own work; rate-limit the expensive ones inside callTool via the same counter.
        const limited = await rateLimit(env, request);
        if (limited) return limited;
        return await handleMcp(env, request);
      }

      const limited = await rateLimit(env, request);
      if (limited) return limited;

      const body = (await request.json()) as Record<string, unknown>;

      if (url.pathname === "/api/verify") {
        const claims = (body.claims as { text: string; source: string }[]).map((c, i) => ({
          id: `c${i + 1}`,
          ...c,
        }));
        if (!claims.length || claims.length > 25) {
          return json({ error: "claims must contain 1-25 items" }, 400);
        }
        const verdicts = await cachedVerifyClaims(env, buildJudge(env), claims);
        return json(buildReport(verdicts));
      }

      if (url.pathname === "/api/check") {
        const report = await auditDocument(env, buildJudge(env), String(body.document ?? ""));
        return json(report);
      }

      if (url.pathname === "/api/agent-demo") {
        if (!env.DASHSCOPE_API_KEY) {
          return json({ error: "demo_unavailable", message: "Writer agent requires the Qwen judge to be configured." }, 503);
        }
        const topic = String(body.topic ?? "").slice(0, 200).trim();
        if (!topic) return json({ error: "topic required" }, 400);

        const writer = new OpenAICompatibleJudge({
          baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
          apiKey: env.DASHSCOPE_API_KEY,
          model: "qwen3.7-plus",
        });
        const draft = await writer.complete(
          "You are a research writer. Write factual, citation-dense prose. Every citation MUST be a markdown inline link in the exact form [anchor text](https://full-url) placed inside the sentence it supports. Never use numbered references like [1] or footnotes.",
          `Write a single 3-5 sentence paragraph about: ${topic}. Include exactly 3 citations as markdown inline links [anchor](https://...) to specific web pages.`,
        );
        const report = await auditDocument(env, buildJudge(env), draft);
        const bad =
          report.summary.contradicted + report.summary.unsupported;
        const approved = bad === 0 && report.summary.total > 0;
        return json({ draft, report, approved });
      }

      if (url.pathname === "/api/links") {
        const claims = extractCitations(String(body.document ?? ""));
        const unique = [...new Map(claims.map((c) => [c.source, c])).values()];
        const results = await Promise.all(
          unique.map(async (c) => {
            const { status } = await fetchSource(c.source);
            return { source: c.source, ...status };
          }),
        );
        return json(results);
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      return json(
        { error: "internal", message: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  },
};
