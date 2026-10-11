// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off -- Fork module (FORK.md): a native key poller, a temporary capture file and Electron window callbacks, all outside Effect fibers.
//
// Quick entry (macOS): pressing both Command keys anywhere opens a floating prompt box that starts a new
// thread; with Shift too, the window under the keyboard is captured first and attached. A port of the
// ag-dash Mac app's quick entry.
//
// The box is a popup the main window's renderer opens with window.open, so it is drawn by the same React
// app (T3's components, stores and environment connection) through a portal. Its code is
// apps/web/src/ag/quickEntry. This side owns what a page can't do:
//   - the key chord: an osascript poller reads the modifier flags (like upstream's SnapShot pair shortcut,
//     which needs no Accessibility permission) and reports both Commands, with or without Shift;
//   - the screenshot (upstream's SnapShot capture of the frontmost window; needs Screen Recording);
//   - the popup's native shape: a non-activating floating panel, so typing in it leaves the app you were
//     in active and the main window where it was;
//   - showing, hiding, sizing and placing it.
// Main → renderer: the existing menu-action channel, action `ag.quickEntry:<json>`.
// Renderer → main: the `ag:quick-entry` IPC channel, exposed by ./preload.ts as window.agDesktop.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Electron from "electron";

import * as DesktopWindow from "../window/DesktopWindow.ts";
import { MENU_ACTION_CHANNEL } from "../ipc/channels.ts";
import { activeWindow } from "../snapShot/ActiveWindow.ts";
import { captureMacWindowSnapshot } from "../snapShot/MacSnapShot.ts";
import {
  AG_QUICK_ENTRY_FRAME_NAME,
  AG_QUICK_ENTRY_IPC_CHANNEL,
  QUICK_ENTRY_WIDTH as WIDTH,
} from "./quickEntryWindow.ts";

const ACTION_PREFIX = "ag.quickEntry:";
const MAX_HEIGHT = 640;
const CAPTURE_MAX_SIZE = { width: 2_560, height: 1_600 };
// What it did, for debugging over SSH: ~/.t3/userdata/logs/quick-entry.log (kept small). `kill -USR1 <pid>`
// also writes the box as it looks right now to quick-entry.png beside it.
const LOG_DIR = NodePath.join(NodeOS.homedir(), ".t3", "userdata", "logs");
const LOG_FILE = NodePath.join(LOG_DIR, "quick-entry.log");
function log(message: string) {
  void (async () => {
    try {
      const stat = await NodeFSP.stat(LOG_FILE).catch(() => null);
      if (stat && stat.size > 256 * 1024) await NodeFSP.rename(LOG_FILE, `${LOG_FILE}.1`);
      await NodeFSP.appendFile(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
    } catch {}
  })();
}

// CGEventFlags: device-dependent left/right Command bits, and the device-independent masks.
const LEFT_COMMAND = 0x8;
const RIGHT_COMMAND = 0x10;
const SHIFT = 0x20000;
const CONTROL = 0x40000;
const OPTION = 0x80000;

// Upstream's modifier-pair poller (snapShot/MacModifierPairShortcutProcess.ts), extended to say whether
// Shift was held and to ignore the chord while Control or Option is down.
const POLLER_SCRIPT = `
ObjC.import("AppKit");
$.NSApplication.sharedApplication.setActivationPolicy($.NSApplicationActivationPolicyProhibited);
ObjC.import("CoreGraphics");
ObjC.import("unistd");
function run() {
  const both = ${LEFT_COMMAND} | ${RIGHT_COMMAND};
  let active = false;
  console.log("ready");
  while ($.getppid() !== 1) {
    const flags = $.CGEventSourceFlagsState(0);
    const pressed = (flags & both) === both && (flags & (${CONTROL} | ${OPTION})) === 0;
    if (pressed && !active) console.log((flags & ${SHIFT}) ? "trigger-shift" : "trigger");
    active = pressed;
    delay(0.03);
  }
  return "orphaned";
}`;

/** What the renderer gets with each open (parsed by apps/web/src/ag/quickEntry/protocol.ts). */
export interface QuickEntryOpenPayload {
  readonly shot?: {
    readonly dataUrl: string;
    readonly appName: string;
    readonly windowTitle: string;
    readonly appIdentifier?: string;
    readonly capturedAt: string;
  };
  readonly shotError?: string;
}

type RendererMessage =
  | { readonly type: "ready" }
  | { readonly type: "resize"; readonly height: number }
  | { readonly type: "show" }
  | { readonly type: "hide" }
  | { readonly type: "reveal-main" };

function parseRendererMessage(value: unknown): RendererMessage | null {
  if (typeof value !== "object" || value === null || !("type" in value)) return null;
  const message = value as { type: unknown; height?: unknown };
  switch (message.type) {
    case "ready":
    case "show":
    case "hide":
    case "reveal-main":
      return { type: message.type };
    case "resize":
      return typeof message.height === "number" && Number.isFinite(message.height)
        ? { type: "resize", height: message.height }
        : null;
    default:
      return null;
  }
}

async function captureFrontWindow(): Promise<QuickEntryOpenPayload> {
  const active = await activeWindow("darwin").catch(() => undefined);
  if (!active) return { shotError: "No window to capture" };
  const file = NodePath.join(NodeOS.tmpdir(), `t3-quick-entry-${process.pid}-${Date.now()}.png`);
  try {
    const { png } = await captureMacWindowSnapshot(active, file, CAPTURE_MAX_SIZE);
    return {
      shot: {
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
        appName: active.owner.name.trim() || "Window",
        windowTitle: active.title.trim(),
        ...(active.owner.bundleId ? { appIdentifier: active.owner.bundleId } : {}),
        capturedAt: new Date().toISOString(),
      },
    };
  } catch {
    return {
      shotError: "Screenshot failed: allow Screen Recording for this app in System Settings",
    };
  } finally {
    void NodeFSP.rm(file, { force: true });
  }
}

function startChordPoller(onTrigger: (withShot: boolean) => void): () => void {
  let stopped = false;
  let poller: NodeChildProcess.ChildProcess | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  const spawn = () => {
    const child = NodeChildProcess.spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", POLLER_SCRIPT],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    poller = child;
    let buffered = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const message = line.trim();
        if (message === "trigger" || message === "trigger-shift")
          onTrigger(message === "trigger-shift");
      }
    });
    child.once("error", () => {});
    child.once("exit", () => {
      if (stopped) return;
      // The helper died (killed, macOS update): bring it back after a pause.
      restartTimer = setTimeout(spawn, 5_000);
    });
  };
  spawn();
  return () => {
    stopped = true;
    if (restartTimer) clearTimeout(restartTimer);
    poller?.kill();
  };
}

function install(options: { readonly ensureMain: () => Promise<Electron.BrowserWindow> }) {
  let panel: Electron.BrowserWindow | null = null;
  let mainContents: Electron.WebContents | null = null;
  let rendererReady = false;
  let pendingAction: string | null = null;
  let returnToMain = false;
  let centerY: number | null = null;
  let opening = false;

  const mainWindow = () =>
    mainContents && !mainContents.isDestroyed()
      ? Electron.BrowserWindow.fromWebContents(mainContents)
      : null;

  const place = (height: number) => {
    if (!panel || panel.isDestroyed()) return;
    const area = Electron.screen.getDisplayNearestPoint(
      Electron.screen.getCursorScreenPoint(),
    ).workArea;
    const h = Math.round(Math.min(Math.max(height, 80), MAX_HEIGHT));
    centerY = area.y + area.height / 2;
    panel.setBounds({
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(centerY - h / 2),
      width: WIDTH,
      height: h,
    });
  };

  const showPanel = () => {
    if (!panel || panel.isDestroyed()) return;
    place(panel.getBounds().height);
    panel.show();
    panel.focus();
    panel.webContents.focus();
  };

  const hidePanel = () => {
    if (!panel || panel.isDestroyed() || !panel.isVisible()) return;
    panel.hide();
    // Back where you were: T3's window if you came from it; otherwise the panel never activated
    // the app, so the previous app still has the keyboard.
    if (returnToMain) mainWindow()?.focus();
  };

  const sendAction = (action: string) => {
    if (!mainContents || mainContents.isDestroyed() || !rendererReady) {
      log("renderer not ready: open queued");
      pendingAction = action;
      return;
    }
    mainContents.send(MENU_ACTION_CHANNEL, action);
  };

  const adoptMain = (window: Electron.BrowserWindow) => {
    if (mainContents === window.webContents) return;
    mainContents = window.webContents;
    rendererReady = false;
    const contents = window.webContents;
    // The renderer reloaded or navigated away: the popup's React tree went with it.
    contents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      rendererReady = false;
      if (panel && !panel.isDestroyed()) panel.destroy();
      panel = null;
    });
    contents.on("did-create-window", (popup, details) => {
      if (details.frameName !== AG_QUICK_ENTRY_FRAME_NAME) return;
      if (panel && !panel.isDestroyed() && panel !== popup) panel.destroy();
      panel = popup;
      log("popup created");
      popup.setAlwaysOnTop(true, "floating");
      // skipTransformProcessType: otherwise Electron hides the app from the Dock and ⌘Tab.
      popup.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      // Closing (⌘W, window.close) hides it: the renderer keeps drawing into the same window.
      popup.on("close", (event) => {
        if (!mainContents || mainContents.isDestroyed()) return;
        event.preventDefault();
        hidePanel();
      });
      popup.on("closed", () => {
        if (panel === popup) panel = null;
      });
      if (opening) showPanel();
    });
  };

  const open = async (withShot: boolean) => {
    log(
      `chord${withShot ? " with shot" : ""}; panel ${panel && !panel.isDestroyed() ? (panel.isVisible() ? "visible" : "hidden") : "none"}`,
    );
    if (panel && !panel.isDestroyed() && panel.isVisible()) {
      hidePanel(); // the chord again closes it
      return;
    }
    const main = await options.ensureMain();
    adoptMain(main);
    returnToMain = main.isFocused();
    const payload: QuickEntryOpenPayload = withShot ? await captureFrontWindow() : {};
    if (payload.shotError) log(payload.shotError);
    opening = true;
    sendAction(`${ACTION_PREFIX}${JSON.stringify(payload)}`);
    // Once created, the popup is reused: show it now (the renderer has already cleared it).
    // The first time, did-create-window shows it.
    if (panel && !panel.isDestroyed()) showPanel();
  };

  let busy = false;
  const trigger = (withShot: boolean) => {
    if (busy) return;
    busy = true;
    open(withShot)
      .catch((error: unknown) => log(`open failed: ${String(error)}`))
      .finally(() => {
        busy = false;
      });
  };

  Electron.ipcMain.on(AG_QUICK_ENTRY_IPC_CHANNEL, (event, raw: unknown) => {
    const message = parseRendererMessage(raw);
    if (!message) return;
    // Only the app's main renderer mounts the quick entry host, so its "ready" names the main window.
    if (message.type === "ready") {
      const window = Electron.BrowserWindow.fromWebContents(event.sender);
      if (window) adoptMain(window);
    }
    if (!mainContents || event.sender !== mainContents) return;
    if (message.type !== "resize") log(`renderer: ${message.type}`);
    switch (message.type) {
      case "ready":
        rendererReady = true;
        if (pendingAction) {
          const action = pendingAction;
          pendingAction = null;
          mainContents.send(MENU_ACTION_CHANNEL, action);
        }
        return;
      case "resize": {
        if (!panel || panel.isDestroyed()) return;
        const h = Math.round(Math.min(Math.max(message.height, 80), MAX_HEIGHT));
        const bounds = panel.getBounds();
        if (bounds.height === h) return;
        panel.setBounds({
          ...bounds,
          y: centerY === null ? bounds.y : Math.round(centerY - h / 2),
          height: h,
        });
        return;
      }
      case "show":
        opening = true;
        showPanel();
        return;
      case "hide":
        opening = false;
        hidePanel();
        return;
      case "reveal-main": {
        opening = false;
        if (panel && !panel.isDestroyed()) panel.hide();
        const main = mainWindow();
        if (!main) return;
        if (main.isMinimized()) main.restore();
        main.show();
        Electron.app.focus({ steal: true });
        main.focus();
        return;
      }
    }
  });

  const stop = startChordPoller(trigger);
  Electron.app.on("will-quit", stop);
  // `kill -USR2 <pid>` opens it without the chord (handy over SSH).
  process.on("SIGUSR2", () => trigger(false));
  process.on("SIGUSR1", () => {
    if (!panel || panel.isDestroyed()) return log("capture: no panel");
    void panel.webContents
      .capturePage()
      .then((image) => NodeFSP.writeFile(NodePath.join(LOG_DIR, "quick-entry.png"), image.toPNG()))
      .then(() =>
        log(`capture: ${JSON.stringify(panel?.getBounds())} visible=${panel?.isVisible()}`),
      )
      .catch((error: unknown) => log(`capture failed: ${String(error)}`));
  });
}

/** Starts quick entry on macOS; elsewhere a no-op. Hooked into DesktopApp's bootstrap. */
export const start = Effect.fn("desktop.ag.quickEntry.start")(function* (
  platform: NodeJS.Platform,
) {
  if (platform !== "darwin") return;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  install({ ensureMain: () => runPromise(desktopWindow.ensureMain) });
});
