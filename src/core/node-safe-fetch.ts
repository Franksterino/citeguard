/** Node.js network adapter that prevents DNS-based SSRF and DNS rebinding. */

import { lookup } from "node:dns";
import type { LookupAddress, LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

import {
  UnsafeUrlError,
  fetchSource,
  isPublicIpAddress,
  type FetchImplementation,
  type FetchResult,
  type FetchSourceOptions,
} from "./fetcher.js";

export type ResolveAll = (hostname: string) => Promise<LookupAddress[]>;

const resolveAll: ResolveAll = (hostname) =>
  new Promise((resolve, reject) => {
    lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });

export function assertPublicDnsAddresses(
  hostname: string,
  addresses: readonly LookupAddress[],
): void {
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Hostname did not resolve: ${hostname}`);
  }
  const unsafe = addresses.find(({ address }) => !isPublicIpAddress(address));
  if (unsafe) {
    throw new UnsafeUrlError("Hostname resolves to a non-public IP address.");
  }
}

export function createSafeLookup(resolver: ResolveAll = resolveAll): LookupFunction {
  return (hostname, options: LookupOptions, callback) => {
    resolver(hostname)
      .then((addresses) => {
        assertPublicDnsAddresses(hostname, addresses);
        const family = options.family ?? 0;
        const matching = family
          ? addresses.filter((entry) => entry.family === family)
          : [...addresses];
        if (matching.length === 0) {
          throw new UnsafeUrlError(
            `Hostname has no public IPv${family} address: ${hostname}`,
          );
        }
        if (options.all) callback(null, matching);
        else callback(null, matching[0].address, matching[0].family);
      })
      .catch((err: unknown) =>
        callback(err instanceof Error ? err : new Error(String(err)), "", 0),
      );
  };
}

export interface NodeSafeFetchClient {
  fetch: FetchImplementation;
  close(): Promise<void>;
}

/**
 * The resolver runs inside the socket connection path, so the exact IP used by
 * the request is checked immediately before connection rather than in a
 * separate, DNS-rebinding-prone preflight.
 */
export function createNodeSafeFetch(
  resolver: ResolveAll = resolveAll,
): NodeSafeFetchClient {
  const dispatcher = new Agent({ connect: { lookup: createSafeLookup(resolver) } });
  const safeFetch: FetchImplementation = async (url, init) => {
    try {
      const response = await undiciFetch(url, {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher,
      });
      return response as unknown as Response;
    } catch (err) {
      const cause = (err as { cause?: unknown })?.cause;
      if (cause instanceof UnsafeUrlError) throw cause;
      throw err;
    }
  };
  return {
    fetch: safeFetch,
    close: () => dispatcher.close(),
  };
}

const defaultClient = createNodeSafeFetch();
export const nodeSafeFetch = defaultClient.fetch;

export function fetchSourceWithNodeSafety(
  url: string,
  opts: Omit<FetchSourceOptions, "fetchImpl"> = {},
): Promise<FetchResult> {
  return fetchSource(url, { ...opts, fetchImpl: nodeSafeFetch });
}
