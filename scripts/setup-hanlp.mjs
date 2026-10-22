import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const envDir = path.join(root, ".venv-hanlp");
const python = process.env.AGENT_SNAPSHOTS_HANLP_PYTHON || path.join(envDir, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
async function run(executable, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`HanLP setup exited with ${code}`)));
  });
}
if (!process.env.AGENT_SNAPSHOTS_HANLP_PYTHON && !existsSync(python)) {
  await run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", envDir]);
}
await run(python, ["-m", "pip", "install", "-r", "src/server/hanlp/requirements.txt"]);
await run(python, ["src/server/hanlp/worker.py", "--check"]);
console.log("HanLP 模型已准备好。会话分词在本机执行，无需联网。");
