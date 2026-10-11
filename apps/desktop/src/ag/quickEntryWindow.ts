// Quick entry's popup window (./QuickEntry.ts), kept apart so DesktopWindow can import it without a cycle.
import type * as Electron from "electron";

export const AG_QUICK_ENTRY_FRAME_NAME = "ag-quick-entry";
export const AG_QUICK_ENTRY_IPC_CHANNEL = "ag:quick-entry";
export const QUICK_ENTRY_WIDTH = 760;
const INITIAL_HEIGHT = 168;

/** The popup window's native options, applied when the renderer opens it (DesktopWindow's open handler). */
export function quickEntryWindowOpenResponse(
  details: Electron.HandlerDetails,
): Electron.WindowOpenHandlerResponse | null {
  if (details.frameName !== AG_QUICK_ENTRY_FRAME_NAME || details.url !== "about:blank") return null;
  return {
    action: "allow",
    overrideBrowserWindowOptions: {
      width: QUICK_ENTRY_WIDTH,
      height: INITIAL_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: true,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: true,
      roundedCorners: true,
      alwaysOnTop: true,
      // A panel takes the keyboard without activating the app (Spotlight-style).
      type: "panel",
    },
  };
}
