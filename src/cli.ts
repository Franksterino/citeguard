#!/usr/bin/env node
/** CiteGuard CLI.
 *
 * Usage:
 *   citeguard check <file.md>          full audit (needs judge env vars)
 *   citeguard links <file.md>          liveness-only, no LLM
 *   citeguard extract <file.md>        show extracted claim/source pairs
 */

import { readFileSync } from "node:fs";

import { checkDocument } from "./core/verify.js";
import { fetchSource } from "./core/fetcher.js";
import { extractCitations } from "./extract/citations.js";
import { judgeFromEnv } from "./judge/providers.js";

function usage(): never {
  console.error("usage: citeguard <check|links|extract> <file>");
  process.exit(2);
}

const [, , command, file] = process.argv;
if (!command || !file) usage();

const text = readFileSync(file, "utf-8");

switch (command) {
  case "extract": {
    console.log(JSON.stringify(extractCitations(text), null, 2));
    break;
  }
  case "links": {
    const claims = extractCitations(text);
    const unique = [...new Map(claims.map((c) => [c.source, c])).values()];
    const results = await Promise.all(
      unique.map(async (c) => {
        const { status } = await fetchSource(c.source);
        return { source: c.source, ...status };
      }),
    );
    console.log(JSON.stringify(results, null, 2));
    const dead = results.filter((r) => !r.ok && !r.fromArchive);
    console.error(`\n${results.length} sources checked, ${dead.length} dead/unreachable`);
    break;
  }
  case "check": {
    const judge = judgeFromEnv();
    const report = await checkDocument(judge, text);
    console.log(JSON.stringify(report, null, 2));
    console.error(
      `\nIntegrity score: ${report.integrityScore}/100 ` +
        `(${report.summary.supported}/${report.summary.total} supported, ` +
        `${report.summary.contradicted} contradicted, ` +
        `${report.summary.unsupported} unsupported, ` +
        `${report.summary.couldNotFetch} unfetchable)`,
    );
    break;
  }
  default:
    usage();
}
