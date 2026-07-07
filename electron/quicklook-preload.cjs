const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quicklook", {
  openSession(ref) {
    return ipcRenderer.invoke("quicklook:open-session", String(ref || ""));
  },
  openLauncher() {
    return ipcRenderer.invoke("quicklook:open-launcher");
  },
  openViewer() {
    return ipcRenderer.invoke("quicklook:open-viewer");
  },
});
