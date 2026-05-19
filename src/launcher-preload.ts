import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("paperclipLauncher", {
  bootstrap: () => ipcRenderer.invoke("launcher:bootstrap"),
  setChooserMode: (mode: "local_embedded" | "remote_existing") =>
    ipcRenderer.invoke("launcher:set-chooser-mode", mode),
  saveRemoteProfile: (payload: { profileId?: string; name?: string; remoteUrl: string; allowInsecureHttp?: boolean }) =>
    ipcRenderer.invoke("launcher:save-remote-profile", payload),
  duplicateProfile: (profileId: string) => ipcRenderer.invoke("launcher:duplicate-profile", profileId),
  deleteProfile: (profileId: string) => ipcRenderer.invoke("launcher:delete-profile", profileId),
  verifyRemote: (payload: { remoteUrl: string }) => ipcRenderer.invoke("launcher:verify-remote", payload),
  connectLocal: (payload: { rememberChoice: boolean; exposeOnLocalNetwork?: boolean }) =>
    ipcRenderer.invoke("launcher:connect-local", payload),
  connectRemote: (payload: {
    profileId?: string;
    remoteUrl: string;
    displayName?: string;
    saveProfile: boolean;
    rememberChoice: boolean;
    allowInsecureHttp?: boolean;
  }) => ipcRenderer.invoke("launcher:connect-remote", payload),
  connectSavedProfile: (payload: { profileId: string; rememberChoice: boolean }) =>
    ipcRenderer.invoke("launcher:connect-saved-profile", payload),
  openCurrentRemote: () => ipcRenderer.invoke("launcher:open-current-remote"),
  returnToCurrentSession: () => ipcRenderer.invoke("launcher:return-to-current-session"),
  closeSheet: () => ipcRenderer.invoke("launcher:close-sheet"),
  reportContentHeight: (height: number) => ipcRenderer.invoke("launcher:report-content-height", height),
  showChooser: () => ipcRenderer.invoke("launcher:show-chooser"),
  onStateChanged: (callback: (snapshot: unknown) => void) => {
    ipcRenderer.on("launcher:state-changed", (_event, snapshot) => callback(snapshot));
  },
  onRequestContentHeightSync: (callback: () => void) => {
    ipcRenderer.on("launcher:request-content-height-sync", () => callback());
  },
  onNavigate: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("launcher:navigate", (_event, payload) => callback(payload));
  },
  onBootStatus: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("launcher:boot-status", (_event, payload) => callback(payload));
  },
  onConnectionError: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("launcher:connection-error", (_event, payload) => callback(payload));
  },
});
