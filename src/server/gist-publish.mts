import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitHubGistPublishErrorCode =
  | "gh_not_installed"
  | "gh_not_authenticated"
  | "network_failure"
  | "gist_publish_failed";

export class GitHubGistPublishError extends Error {
  code: GitHubGistPublishErrorCode;

  constructor(code: GitHubGistPublishErrorCode, message: string) {
    super(message);
    this.name = "GitHubGistPublishError";
    this.code = code;
  }
}

export interface GitHubGistPublishResult {
  gistUrl: string;
  previewUrl: string;
}

export function isGitHubGistPublishError(error: unknown): error is GitHubGistPublishError {
  return error instanceof GitHubGistPublishError;
}

export async function createGitHubGist(html: string, { publicGist = false } = {}): Promise<GitHubGistPublishResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-snapshot-gist-"));
  const filePath = path.join(tempDir, "index.html");
  try {
    await writeFile(filePath, html, "utf8");
    return await createGitHubGistFromFile(filePath, { publicGist });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function createGitHubGistFromFile(filePath: string, { publicGist = false } = {}): Promise<GitHubGistPublishResult> {
  const ghBin = process.env.AGENT_SNAPSHOT_GH_BIN || "gh";
  const args = ["gist", "create", "--filename", "index.html"];
  if (publicGist) {
    args.push("--public");
  }
  args.push(filePath);

  let result;
  try {
    result = await execFileAsync(ghBin, args, { maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    throw formatGitHubGistError(error);
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const gistUrl = parseGistUrl(output);
  const gistId = gistIdFromUrl(gistUrl);
  if (!gistUrl || !gistId) {
    throw new GitHubGistPublishError(
      "gist_publish_failed",
      "gh gist create 未返回可识别的 Gist 地址，请确认 GitHub CLI 可用并重试。",
    );
  }

  return {
    gistUrl,
    previewUrl: "https://gistpreview.github.io/?" + gistId + "/index.html",
  };
}

function formatGitHubGistError(error: unknown): GitHubGistPublishError {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = record.cause && typeof record.cause === "object" ? record.cause as Record<string, unknown> : {};
  const code = String(record.code || cause.code || "");
  const message = [record.stderr, record.stdout, record.message].filter(Boolean).join("\n").trim();
  const hint = "请先运行：brew install gh && gh auth login";
  if (code === "ENOENT") {
    return new GitHubGistPublishError("gh_not_installed", "未找到 GitHub CLI（gh）。" + hint);
  }
  if (/not logged in|authentication|auth login|gh auth/i.test(message)) {
    return new GitHubGistPublishError(
      "gh_not_authenticated",
      "GitHub CLI 未登录或认证失败。" + hint + (message ? "\n" + message : ""),
    );
  }
  if (isNetworkFailureMessage(message)) {
    return new GitHubGistPublishError(
      "network_failure",
      "创建 GitHub Gist 失败。" + hint + (message ? "\n" + message : ""),
    );
  }
  return new GitHubGistPublishError(
    "gist_publish_failed",
    "创建 GitHub Gist 失败。" + hint + (message ? "\n" + message : ""),
  );
}

function isNetworkFailureMessage(message: string): boolean {
  return /network|timed?\s*out|timeout|could not resolve|no such host|failed to connect|connection refused|connection reset|econnreset|enotfound|eai_again|tls|proxy|dial tcp|i\/o timeout|temporary failure/i.test(message);
}

function parseGistUrl(output: string): string {
  const match = String(output || "").match(/https:\/\/gist\.github\.com\/[^\s]+/);
  return match ? match[0].replace(/[),.;]+$/, "") : "";
}

function gistIdFromUrl(url: string): string {
  if (!url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    const parts = String(url).split(/[/?#]/).filter(Boolean);
    return parts[parts.length - 1] || "";
  }
}
