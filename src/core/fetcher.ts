/** Source fetching with liveness checks and archive.org fallback.
 *
 * Design rules:
 *  - Never guess: if content cannot be fetched, report could_not_fetch
 *    rather than judging against nothing.
 *  - Detect "soft 404s": redirects that land on a site root usually mean
 *    the cited deep link is dead even though HTTP says 200.
 */

import type { SourceStatus } from "../types.js";

export interface FetchResult {
  status: SourceStatus;
  /** Raw body when the fetch succeeded and content is textual/PDF. */
  body?: ArrayBuffer;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB cap per source

const UA =
  "Mozilla/5.0 (compatible; CiteGuard/0.1; +https://github.com/Franksterino/citeguard)";

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/pdf,text/plain,*/*;q=0.8",
        "accept-language": "en",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function isRootPath(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.pathname === "/" || u.pathname === "") && !u.search;
  } catch {
    return false;
  }
}

async function readCapped(res: Response): Promise<ArrayBuffer> {
  const reader = res.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= MAX_BODY_BYTES) {
      await reader.cancel();
      break;
    }
  }
  const out = new Uint8Array(Math.min(total, MAX_BODY_BYTES));
  let offset = 0;
  for (const c of chunks) {
    const slice = c.subarray(0, Math.min(c.byteLength, out.byteLength - offset));
    out.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= out.byteLength) break;
  }
  return out.buffer;
}

/** Fetch a source URL; on failure, try the latest archive.org snapshot. */
export async function fetchSource(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const originalDeepLink = !isRootPath(url);

  let direct: FetchResult | undefined;
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    const contentType = res.headers.get("content-type") ?? "";
    const redirectedToRoot =
      originalDeepLink && res.url !== url && isRootPath(res.url);
    const status: SourceStatus = {
      resolvedUrl: res.url,
      httpStatus: res.status,
      ok: res.ok && !redirectedToRoot,
      fromArchive: false,
      redirectedToRoot,
      contentType,
    };
    if (res.ok) {
      direct = { status, body: await readCapped(res) };
      if (!redirectedToRoot) return direct;
    } else {
      direct = { status };
    }
  } catch (err) {
    direct = {
      status: {
        resolvedUrl: url,
        httpStatus: 0,
        ok: false,
        fromArchive: false,
        redirectedToRoot: false,
        contentType: "",
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // Archive.org fallback for dead or soft-404 links.
  try {
    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const api = await fetchWithTimeout(apiUrl, timeoutMs);
    if (api.ok) {
      const data = (await api.json()) as {
        archived_snapshots?: { closest?: { available?: boolean; url?: string } };
      };
      const snapshot = data.archived_snapshots?.closest;
      if (snapshot?.available && snapshot.url) {
        const snapRes = await fetchWithTimeout(
          snapshot.url.replace(/^http:/, "https:"),
          timeoutMs,
        );
        if (snapRes.ok) {
          return {
            status: {
              resolvedUrl: snapRes.url,
              httpStatus: snapRes.status,
              ok: true,
              fromArchive: true,
              redirectedToRoot: false,
              contentType: snapRes.headers.get("content-type") ?? "",
              error: direct.status.error,
            },
            body: await readCapped(snapRes),
          };
        }
      }
    }
  } catch {
    // fall through to the direct result
  }

  return direct;
}
