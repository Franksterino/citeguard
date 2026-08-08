import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertPublicDnsAddresses,
  createNodeSafeFetch,
  type NodeSafeFetchClient,
} from "../src/core/node-safe-fetch.js";
import { fetchSource } from "../src/core/fetcher.js";

const clients: NodeSafeFetchClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("Node DNS connection guard", () => {
  it("rejects mixed public/private DNS answers and private IPv6", () => {
    expect(() =>
      assertPublicDnsAddresses("mixed.example.com", [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
    ).toThrow(/non-public IP address/i);
    expect(() =>
      assertPublicDnsAddresses("private-v6.example.com", [
        { address: "fd00::1", family: 6 },
      ]),
    ).toThrow(/non-public IP address/i);
  });

  it("accepts only-public DNS answers", () => {
    expect(() =>
      assertPublicDnsAddresses("public.example.com", [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ]),
    ).not.toThrow();
  });

  it("blocks a hostname that resolves to loopback before the server is reached", async () => {
    let reached = false;
    const server = createServer((_req, res) => {
      reached = true;
      res.end("private service");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const client = createNodeSafeFetch(async () => [
      { address: "127.0.0.1", family: 4 },
    ]);
    clients.push(client);

    try {
      const result = await fetchSource(`http://public.example.com:${address.port}/secret`, {
        fetchImpl: client.fetch,
      });
      expect(result.status.ok).toBe(false);
      expect(result.status.error).toMatch(/resolves to a non-public IP address/i);
      expect(reached).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
