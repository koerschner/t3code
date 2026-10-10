// Ag fork (FORK.md): "Single workspace" mode. Nathan runs one project, one environment and one harness, so the
// labels that tell projects, environments, providers and models apart are noise. When on (the default),
// <html data-ag-single> is set and singleWorkspace.css hides them. Stored per device in localStorage; toggled in
// Settings › General. Nothing is removed from upstream: turn it off and the app is stock T3 Code.
import { useSyncExternalStore } from "react";

import "./singleWorkspace.css";

const KEY = "ag.singleWorkspace";
const listeners = new Set<() => void>();

export function singleWorkspaceEnabled(
  storage: Pick<Storage, "getItem"> | null = globalThis.localStorage ?? null,
) {
  return storage?.getItem(KEY) !== "off";
}

function apply() {
  document.documentElement.toggleAttribute("data-ag-single", singleWorkspaceEnabled());
}

export function setSingleWorkspace(on: boolean) {
  localStorage.setItem(KEY, on ? "on" : "off");
  apply();
  for (const l of listeners) l();
}

export function useSingleWorkspace(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => singleWorkspaceEnabled(),
    () => true,
  );
}

export function installSingleWorkspace() {
  apply();
  addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    apply();
    for (const l of listeners) l();
  });
}
