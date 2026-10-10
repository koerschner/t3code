import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { revealSidebarRow } from "./revealActiveSidebarRow";

describe("revealSidebarRow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("scrolls a connected row into view on the next frame", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 0));
    const scrollIntoView = vi.fn();
    revealSidebarRow({ isConnected: true, scrollIntoView } as unknown as HTMLElement);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
    vi.advanceTimersByTime(250);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("skips a row that unmounted before the frame", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 0));
    const scrollIntoView = vi.fn();
    revealSidebarRow({ isConnected: false, scrollIntoView } as unknown as HTMLElement);
    vi.advanceTimersByTime(250);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
