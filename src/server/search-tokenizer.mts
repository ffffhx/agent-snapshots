import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

const assets = new URL("./hanlp/", import.meta.url);
export const tokenizerVersion = createHash("sha256").update("hanlp-2.1.3-fine-electra-small-v1")
  .update(readFileSync(new URL("terms.json", assets))).update(readFileSync(new URL("worker.py", assets))).digest("hex");
// Encode each token as one ASCII word so SQLite cannot split code punctuation
// or reinterpret token text as MATCH syntax. Original text stays in the document.
export const indexToken = (term: string) => "t" + Buffer.from(term, "utf8").toString("hex");
let worker: ChildProcessWithoutNullStreams | undefined;
let nextId = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, { resolve: (value: string[][]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const queries = new Map<string, string[]>();

function refWorker(active: boolean) {
  if (!worker) return;
  active ? worker.ref() : worker.unref();
  for (const stream of [worker.stdin, worker.stdout, worker.stderr]) (stream as any)[active ? "ref" : "unref"]?.();
}
export function closeSearchTokenizer(error = new Error("HanLP 分词进程已停止，请重试。")) {
  clearTimeout(idle);
  const child = worker;
  worker = undefined;
  child?.kill();
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
  pending.clear();
}
process.once("exit", () => worker?.kill());

function startWorker() {
  if (worker) return worker;
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const local = path.join(root, ".venv-hanlp", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.AGENT_SNAPSHOTS_HANLP_PYTHON || (existsSync(local) ? local : process.platform === "win32" ? "python" : "python3");
  const child = spawn(python, ["-u", fileURLToPath(new URL("worker.py", assets))], {
    windowsHide: true, stdio: "pipe", env: { ...process.env, PYTHONIOENCODING: "utf-8", TOKENIZERS_PARALLELISM: "false", TRANSFORMERS_OFFLINE: "1", HF_HUB_OFFLINE: "1" },
  });
  worker = child;
  let diagnostic = "";
  child.stderr.on("data", (data) => { diagnostic = (diagnostic + String(data)).slice(-2000); });
  const fail = () => {
    if (worker !== child) return;
    closeSearchTokenizer(new Error("HanLP 分词器不可用，请先运行 pnpm setup:hanlp，或设置 AGENT_SNAPSHOTS_HANLP_PYTHON。"));
    console.error("[hanlp] 分词器启动或运行失败；请运行 pnpm setup:hanlp。", diagnostic);
  };
  child.on("error", fail); child.on("exit", fail); child.stdin.on("error", fail);
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const reply = JSON.parse(line);
      const entry = pending.get(reply.id);
      if (!entry) return;
      pending.delete(reply.id); clearTimeout(entry.timer);
      if (reply.error) entry.reject(new Error("HanLP 分词失败：" + reply.error));
      else if (!Array.isArray(reply.tokens) || reply.tokens.some((row: unknown) => !Array.isArray(row) || row.some((t: unknown) => typeof t !== "string"))) entry.reject(new Error("HanLP 返回无效分词结果。"));
      else entry.resolve(reply.tokens);
      if (!pending.size) {
        refWorker(false);
        idle = setTimeout(closeSearchTokenizer, 300_000); idle.unref();
      }
    } catch { fail(); }
  });
  return child;
}

export async function tokenizeTexts(texts: string[], query = false): Promise<string[][]> {
  if (!texts.length) return [];
  clearTimeout(idle);
  const child = startWorker();
  refWorker(true);
  const id = ++nextId;
  const result = await new Promise<string[][]>((resolve, reject) => {
    const timer = setTimeout(() => { closeSearchTokenizer(); }, 180_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, texts, query }) + "\n");
  });
  if (result.length !== texts.length) throw new Error("HanLP 分词结果数量不匹配。");
  return result;
}

export async function searchQueryTerms(text: string): Promise<string[]> {
  const key = text.normalize("NFKC").trim();
  if (!key) return [];
  const cached = queries.get(key);
  if (cached) return [...cached];
  const [terms] = await tokenizeTexts([key], true);
  queries.set(key, terms);
  if (queries.size > 256) queries.delete(queries.keys().next().value!);
  return [...terms];
}
