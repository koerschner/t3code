import { describe, expect, it } from "vite-plus/test";

import { singleWorkspaceEnabled } from "./singleWorkspace";

describe("singleWorkspaceEnabled", () => {
  it("is on by default and only off when turned off", () => {
    expect(singleWorkspaceEnabled({ getItem: () => null })).toBe(true);
    expect(singleWorkspaceEnabled({ getItem: () => "on" })).toBe(true);
    expect(singleWorkspaceEnabled({ getItem: () => "off" })).toBe(false);
  });
});
