import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("paperclip", {
  updater: {
    onStatus: (cb: (data: { status: string; version?: string; percent?: number }) => void) => {
      const listener = (_e: unknown, data: { status: string; version?: string; percent?: number }) =>
        cb(data);
      ipcRenderer.on("update-status", listener);
      // Return an unsubscribe so repeated registration can't leak listeners.
      return () => ipcRenderer.removeListener("update-status", listener);
    },
  },
});
