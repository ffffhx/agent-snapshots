const { contextBridge, ipcRenderer } = require("electron");

const GET_CHANNEL = "session-recovery:get";
const RESTORE_CHANNEL = "session-recovery:restore";
const CHANGED_CHANNEL = "session-recovery:changed";

contextBridge.exposeInMainWorld("agentSnapshotsDesktop", Object.freeze({
  getSessionRecovery: () => ipcRenderer.invoke(GET_CHANNEL),
  restoreInterruptedSessions: () => ipcRenderer.invoke(RESTORE_CHANNEL),
  onSessionRecoveryChanged: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(CHANGED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(CHANGED_CHANNEL, listener);
  },
}));
