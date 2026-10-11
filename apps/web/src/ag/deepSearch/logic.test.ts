import { describe, expect, it } from "vite-plus/test";

import { parseDeepSearchResponse } from "./logic";

describe("parseDeepSearchResponse", () => {
  it("keeps threads and tabs and drops malformed rows", () => {
    const parsed = parseDeepSearchResponse({
      indexed: 12,
      progress: "embedding 4/10",
      results: [
        {
          kind: "thread",
          id: "t1",
          title: "Consent",
          project: "arcade",
          snippet: "loop",
          score: 0.71,
          role: "user",
        },
        {
          kind: "tab",
          id: "s1",
          tab: "t1EB",
          link: "http://ag:7376/s1",
          title: "",
          snippet: "x",
          score: 0.5,
        },
        { kind: "file", id: "f" },
        { kind: "thread" },
      ],
    });
    expect(parsed.indexed).toBe(12);
    expect(parsed.progress).toBe("embedding 4/10");
    expect(parsed.results.map((r) => [r.kind, r.id, r.title])).toEqual([
      ["thread", "t1", "Consent"],
      ["tab", "s1", "Untitled"],
    ]);
  });

  it("surfaces the service's error", () => {
    expect(() => parseDeepSearchResponse({ error: "Deep search is unavailable" })).toThrow(
      "Deep search is unavailable",
    );
  });
});
