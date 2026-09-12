import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { digest } from "./lib/rag-eval.mjs";
const [selectionFile, outputFile = ".agent-snapshots/rag-eval/new-dataset.json"] = process.argv.slice(2);
if (!selectionFile) throw new Error("Usage: node scripts/export-rag-eval.mjs selection.json [private-output.json]");
const selection = JSON.parse(await readFile(selectionFile, "utf8"));
const sessions = [], snapshots = {}, hashes = [];
for (const item of selection) {
  if (!item.ref || !item.group || !["dev", "test"].includes(item.split)) throw new Error("Selection needs ref/group/split");
  const response = await fetch(`http://127.0.0.1:4321/api/snapshot?id=${encodeURIComponent(item.ref)}&redact=1`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Snapshot unavailable (HTTP ${response.status})`);
  const source = await response.json();
  if (!source.redacted || !source.turns?.length) throw new Error("Only redacted snapshots with messages can be exported");
  if (sessions.some((s) => s.ref.split(":").at(-1) === source.ref.split(":").at(-1))) throw new Error("Duplicate session UUID (including alternate home copies)");
  const group = item.group;
  sessions.push({ ref: source.ref, title: source.title, cwd: `/projects/${group}`, mtime: source.mtime, engine: source.engine, group, split: item.split });
  snapshots[source.ref] = { ref: source.ref, title: source.title, redacted: true, turns: source.turns.map((t) => ({ turn: t.turn, role: t.role, kind: t.kind, text: t.text, timestamp: t.timestamp })) };
  hashes.push({ ref: source.ref, hash: digest(source) });
}
const data = { version: 2, createdAt: new Date().toISOString(), provenance: { kind: "real-history-curated", annotationType: "unreviewed", sourceHashes: hashes, selection: "Explicitly selected sessions; redacted dialogue only, no tools/images/subagents" }, sessions, snapshots, questions: [] };
await mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
await writeFile(outputFile, JSON.stringify(data, null, 2), { flag: "wx" });
console.log(JSON.stringify({ output: outputFile, sessions: sessions.length, next: "Add reviewed gold quote anchors and key points before evaluation" }));
