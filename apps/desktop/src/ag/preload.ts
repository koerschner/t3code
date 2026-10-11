// Fork preload hook (FORK.md): the renderer's side of quick entry's IPC (./QuickEntry.ts).
import { contextBridge, ipcRenderer } from "electron";

import { AG_QUICK_ENTRY_IPC_CHANNEL } from "./quickEntryWindow.ts";

contextBridge.exposeInMainWorld("agDesktop", {
  quickEntry: (message: unknown) => ipcRenderer.send(AG_QUICK_ENTRY_IPC_CHANNEL, message),
});
