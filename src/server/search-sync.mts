// @ts-nocheck
import { Worker } from "node:worker_threads";

// Parsing and synchronous SQLite writes never run on the HTTP event loop.
export function startSearchSync(options, { onMessage = (event) => {
  if (event.type === "warning") console.error("[search-sync]", event.error);
}, restartMs = 5000 } = {}) {
  let worker;
  let stopped = false;
  let restartTimer;
  function start() {
    if (stopped) return;
    worker = new Worker(new URL("./search-sync-worker.mjs", import.meta.url), { workerData: options });
    worker.on("message", onMessage);
    worker.on("error", (error) => console.error("[search-sync]", error.message));
    worker.on("exit", () => {
      if (!stopped) restartTimer = setTimeout(start, restartMs);
    });
  }
  start();
  return {
    reconcile() { worker?.postMessage({ type: "reconcile" }); },
    async stop() {
      stopped = true;
      clearTimeout(restartTimer);
      await worker?.terminate();
    },
  };
}
