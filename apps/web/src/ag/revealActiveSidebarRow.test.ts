import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { revealSidebarRow } from "./revealActiveSidebarRow";

describe("revealSidebarRow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("scrolls a connected row into view on the next frame", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 0));
    const scrollIntoView = vi.fn();
    revealSidebarRow({ isConnected: true, scrollIntoView } as unknown as HTMLElement);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("skips a row that unmounted before the frame", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 0));
    const scrollIntoView = vi.fn();
    revealSidebarRow({ isConnected: false, scrollIntoView } as unknown as HTMLElement);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
