// Read-only real-log benchmark. Output contains sizes/timings, never transcript text.
import { discoverSessionFiles, parseSessionFile } from "agent-session-core";
import { SessionParseCache } from "../dist/sources/session-parse-cache.mjs";

const files = discoverSessionFiles().filter((file) => file.sizeBytes < 256 * 1024 * 1024);
const cache = new SessionParseCache();
async function timed(run) {
  let last = performance.now(), maxDelayMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxDelayMs = Math.max(maxDelayMs, now - last - 5);
    last = now;
  }, 5);
  const start = performance.now();
  const value = await run();
  const ms = performance.now() - start;
  await new Promise((resolve) => setTimeout(resolve, 10));
  clearInterval(timer);
  return { ms, maxDelayMs, events: value?.events?.length };
}
try {
  for (const engine of ["codex", "claude"]) {
    const group = files.filter((file) => file.engine === engine).sort((a, b) => a.sizeBytes - b.sizeBytes);
    for (const file of [...new Set([group[Math.floor(group.length / 2)], group.at(-1)])].filter(Boolean)) {
      const before = cache.stats();
      const synchronous = await timed(() => parseSessionFile(file));
      const workerFirst = await timed(() => cache.load(file));
      const cached = await timed(() => cache.load(file));
      console.log(JSON.stringify({ engine, sizeMiB: file.sizeBytes / 1048576, synchronous, workerFirst, cached,
        parses: cache.stats().parses - before.parses, hits: cache.stats().hits - before.hits }));
    }
  }
} finally { await cache.close(); }
