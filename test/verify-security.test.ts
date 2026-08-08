import { describe, expect, it, vi } from "vitest";

import { fetchSource } from "../src/core/fetcher.js";
import { verifyClaims } from "../src/core/verify.js";
import type { JudgeClient } from "../src/types.js";

describe("verification security boundary", () => {
  it("returns could_not_fetch for an unsafe claim without invoking the judge", async () => {
    const complete = vi.fn<JudgeClient["complete"]>();
    const judge: JudgeClient = { model: "test", complete };

    const [verdict] = await verifyClaims(
      judge,
      [{ id: "c1", text: "private claim", source: "http://127.0.0.1/secret" }],
      fetchSource,
    );

    expect(verdict.verdict).toBe("could_not_fetch");
    expect(verdict.confidence).toBe(0);
    expect(verdict.evidence).toBe("");
    expect(verdict.reasoning).toMatch(/non-public IP address/i);
    expect(complete).not.toHaveBeenCalled();
  });
});
