import { describe, expect, it, vi } from "vitest";

import {
  fetchSource,
  isPublicIpAddress,
  type FetchImplementation,
} from "../src/core/fetcher.js";

describe("fetchSource SSRF controls", () => {
  it.each([
    "http://127.0.0.1/admin",
    "http://127.1/admin",
    "http://2130706433/admin",
    "http://0177.0.0.1/admin",
    "http://0x7f000001/admin",
    "http://10.0.0.1/admin",
    "http://100.64.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://192.168.1.1/admin",
    "http://[::1]/admin",
    "http://[fc00::1]/admin",
    "http://[fe80::1]/admin",
    "http://[::ffff:127.0.0.1]/admin",
    "http://[64:ff9b::7f00:1]/admin",
  ])("rejects non-public destination %s before making a request", async (url) => {
    const fetchImpl = vi.fn<FetchImplementation>();

    const result = await fetchSource(url, { fetchImpl });

    expect(result.status.ok).toBe(false);
    expect(result.status.error).toMatch(/non-public IP address/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects URL credentials before making a request", async () => {
    const fetchImpl = vi.fn<FetchImplementation>();

    const result = await fetchSource("https://user:pass@example.com/article", {
      fetchImpl,
    });

    expect(result.status.error).toMatch(/must not contain credentials/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-HTTP protocols before making a request", async () => {
    const fetchImpl = vi.fn<FetchImplementation>();

    const result = await fetchSource("file:///etc/passwd", { fetchImpl });

    expect(result.status.ok).toBe(false);
    expect(result.status.error).toMatch(/only HTTP and HTTPS/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("revalidates every redirect and blocks a redirect to metadata", async () => {
    const fetchImpl = vi.fn<FetchImplementation>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );

    const result = await fetchSource("https://public.example.com/start", { fetchImpl });

    expect(result.status.ok).toBe(false);
    expect(result.status.error).toMatch(/non-public IP address/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves legitimate public redirects and response bodies", async () => {
    const fetchImpl = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/article" } }),
      )
      .mockResolvedValueOnce(
        new Response("public article", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );

    const result = await fetchSource("https://public.example.com/start", { fetchImpl });

    expect(result.status.ok).toBe(true);
    expect(result.status.resolvedUrl).toBe("https://public.example.com/article");
    expect(new TextDecoder().decode(result.body)).toBe("public article");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([, init]) => init.redirect === "manual")).toBe(true);
  });

  it("stops after five redirects", async () => {
    const fetchImpl = vi.fn<FetchImplementation>().mockImplementation(async (url) => {
      const current = new URL(url);
      if (current.hostname === "archive.org") return new Response(null, { status: 404 });
      const step = Number(current.searchParams.get("step") ?? "0");
      return new Response(null, {
        status: 302,
        headers: { location: `/?step=${step + 1}` },
      });
    });

    const result = await fetchSource("https://example.com/?step=0", { fetchImpl });

    expect(result.status.ok).toBe(false);
    expect(result.status.error).toMatch(/exceeded 5 redirects/i);
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(
      fetchImpl.mock.calls.slice(0, 6).every(([url]) => new URL(url).hostname === "example.com"),
    ).toBe(true);
  });

  it("does not follow an unsafe Wayback snapshot URL", async () => {
    const fetchImpl = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            archived_snapshots: {
              closest: { available: true, url: "http://127.0.0.1/archive" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const result = await fetchSource("https://example.com/missing", { fetchImpl });

    expect(result.status.httpStatus).toBe(404);
    expect(result.status.fromArchive).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("classifies private, mapped-private, and public IPs", () => {
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });
});
