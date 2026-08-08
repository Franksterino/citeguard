/** Source fetching with liveness checks and archive.org fallback.
 *
 * Design rules:
 *  - Never guess: if content cannot be fetched, report could_not_fetch
 *    rather than judging against nothing.
 *  - Detect "soft 404s": redirects that land on a site root usually mean
 *    the cited deep link is dead even though HTTP says 200.
 */

import ipaddr from "ipaddr.js";

import type { SourceStatus } from "../types.js";

export interface FetchResult {
  status: SourceStatus;
  /** Raw body when the fetch succeeded and content is textual/PDF. */
  body?: ArrayBuffer;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB cap per source
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const UA =
  "Mozilla/5.0 (compatible; CiteGuard/0.1; +https://github.com/Franksterino/citeguard)";

export type FetchImplementation = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface FetchSourceOptions {
  timeoutMs?: number;
  fetchImpl?: FetchImplementation;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".lan",
  ".home.arpa",
  ".test",
  ".invalid",
  ".example",
];

function bareHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

/** True only for globally routable unicast IP addresses. */
export function isPublicIpAddress(value: string): boolean {
  const candidate = bareHostname(value);
  if (!ipaddr.isValid(candidate)) return false;
  let address = ipaddr.parse(candidate);
  if (address.kind() === "ipv6") {
    const ipv6 = address as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) address = ipv6.toIPv4Address();
  }
  return address.range() === "unicast";
}

/** Parse a source URL and reject destinations that can reach local/private services. */
export function assertSafeRemoteUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new UnsafeUrlError("Source must be a valid absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only HTTP and HTTPS source URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Source URLs must not contain credentials.");
  }

  const hostname = bareHostname(url.hostname);
  if (!hostname || hostname === "localhost") {
    throw new UnsafeUrlError("Localhost source URLs are not allowed.");
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new UnsafeUrlError(`Non-public hostname is not allowed: ${hostname}`);
  }

  if (ipaddr.isValid(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new UnsafeUrlError(`Non-public IP address is not allowed: ${hostname}`);
    }
  } else if (!hostname.includes(".")) {
    throw new UnsafeUrlError(`Single-label hostname is not allowed: ${hostname}`);
  }

  return url;
}

interface FetchedResponse {
  response: Response;
  resolvedUrl: string;
}

async function fetchWithTimeout(
  rawUrl: string,
  timeoutMs: number,
  fetchImpl: FetchImplementation,
): Promise<FetchedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = assertSafeRemoteUrl(rawUrl);
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetchImpl(current.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/pdf,text/plain,*/*;q=0.8",
          "accept-language": "en",
        },
      });

      const location = response.headers.get("location");
      const isRedirect = REDIRECT_STATUSES.has(response.status) && location;
      if (!isRedirect) {
        return { response, resolvedUrl: current.href };
      }
      if (redirects >= MAX_REDIRECTS) {
        await response.body?.cancel();
        throw new Error(`Source exceeded ${MAX_REDIRECTS} redirects.`);
      }
      await response.body?.cancel();
      current = assertSafeRemoteUrl(new URL(location, current));
    }
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
  opts: FetchSourceOptions = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl: FetchImplementation =
    opts.fetchImpl ?? ((input, init) => fetch(input, init));

  let safeOriginal: URL;
  try {
    safeOriginal = assertSafeRemoteUrl(url);
  } catch (err) {
    return {
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
  const originalDeepLink = !isRootPath(safeOriginal.href);

  let direct: FetchResult | undefined;
  try {
    const { response: res, resolvedUrl } = await fetchWithTimeout(
      safeOriginal.href,
      timeoutMs,
      fetchImpl,
    );
    const contentType = res.headers.get("content-type") ?? "";
    const redirectedToRoot =
      originalDeepLink && resolvedUrl !== safeOriginal.href && isRootPath(resolvedUrl);
    const status: SourceStatus = {
      resolvedUrl,
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
    if (err instanceof UnsafeUrlError) return direct;
  }

  // Archive.org fallback for dead or soft-404 links.
  try {
    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const { response: api } = await fetchWithTimeout(apiUrl, timeoutMs, fetchImpl);
    if (api.ok) {
      const data = (await api.json()) as {
        archived_snapshots?: { closest?: { available?: boolean; url?: string } };
      };
      const snapshot = data.archived_snapshots?.closest;
      if (snapshot?.available && snapshot.url) {
        const { response: snapRes, resolvedUrl } = await fetchWithTimeout(
          snapshot.url.replace(/^http:/, "https:"),
          timeoutMs,
          fetchImpl,
        );
        if (snapRes.ok) {
          return {
            status: {
              resolvedUrl,
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
