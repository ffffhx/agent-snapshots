import sanitizeHtml from "sanitize-html";

const APP_DIRECTIVE_PATTERN =
  /^[ \t]*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\{[^\n]*\}[ \t]*$/gm;
const APP_DIRECTIVE_HTML_PATTERN =
  /<p>\s*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\{[\s\S]*?\}\s*<\/p>/g;

// Codex 在助手回复末尾追加的记忆引用元数据，纯内部记账，对用户无意义。
const MEMORY_CITATION_PATTERN = /\s*<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>\s*/gi;
// Codex 注入的子代理完成通知信封，内层 JSON 的 status 才是真正的报告内容。
const SUBAGENT_NOTIFICATION_PATTERN = /<subagent_notification>([\s\S]*?)<\/subagent_notification>/gi;
// 纯系统噪音信封：整条消息只是内部指令/告诫，对阅读对话毫无意义，直接清除。
const NOISE_ENVELOPE_PATTERNS = [
  // Codex 注入的目标续跑指令（真正的 objective 已单独展示在元信息里）
  /<codex_internal_context\b[\s\S]*?<\/codex_internal_context>\s*/gi,
  // Claude Code 在本地命令前注入的告诫语
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*/gi,
];
// Claude Code 斜杠命令调用块：命令名 + 冗余的 message + 可选 args，合并成一个简洁的行内代码。
const SLASH_COMMAND_PATTERN =
  /<command-name>([\s\S]*?)<\/command-name>\s*(?:<command-message>[\s\S]*?<\/command-message>\s*)?(?:<command-args>([\s\S]*?)<\/command-args>\s*)?/gi;
// 终端 ANSI 颜色/样式转义码，渲染成网页时是不可见的乱码。
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;
// Codex 注入的上下文前言（# Files mentioned / # In app browser / # Review findings 等）：
// 整段去掉、只保留 “## My request for Codex:” 之后用户真正的请求（图片仍由附件区单独展示）。
const CODEX_FILES_PREAMBLE_PATTERN = /^\s*#[\s\S]*?##\s*My request for Codex:\s*/i;
// Codex 插入的内联图片引用标记，图片已通过附件区呈现，这里只剩冗余文本。
const IMAGE_REF_PATTERN = /<image\b[^>]*>(?:\s*<\/image>)?|<\/image>/gi;

export function stripAppDirectives(value: unknown): string {
  let text = String(value ?? "").replace(/\r\n/g, "\n");
  for (const pattern of NOISE_ENVELOPE_PATTERNS) {
    text = text.replace(pattern, "");
  }
  return text
    .replace(CODEX_FILES_PREAMBLE_PATTERN, "")
    .replace(IMAGE_REF_PATTERN, "")
    .replace(APP_DIRECTIVE_PATTERN, "")
    .replace(MEMORY_CITATION_PATTERN, "\n")
    .replace(SUBAGENT_NOTIFICATION_PATTERN, (_match, inner) => unwrapSubagentNotification(inner))
    .replace(SLASH_COMMAND_PATTERN, (_match, name, args) => formatSlashCommand(name, args))
    .replace(/<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/gi, (_match, body) => String(body ?? "").trim())
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 把 Claude Code 斜杠命令调用渲染成单个简洁的行内代码，例如 `/model` 或 `/review --fix`。
function formatSlashCommand(name: unknown, args: unknown): string {
  const command = String(name ?? "").trim();
  if (!command) {
    return "";
  }
  const extra = String(args ?? "").trim();
  return "`" + (extra ? command + " " + extra : command) + "`";
}

// 把 <subagent_notification>{...}</subagent_notification> 解包成人类可读的报告文本，
// 丢弃 agent_path 等内部字段；解析失败时回退到原始内层文本。
function unwrapSubagentNotification(inner: string): string {
  const raw = String(inner ?? "").trim();
  if (!raw) {
    return "";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  const status = (parsed as { status?: unknown })?.status;
  const text = collectStatusText(status);
  return text || raw;
}

function collectStatusText(status: unknown): string {
  if (typeof status === "string") {
    return status.trim();
  }
  if (!status || typeof status !== "object") {
    return "";
  }
  const record = status as Record<string, unknown>;
  // 优先取语义明确的字段；否则把所有字符串值拼起来（含 JSON 序列化时被拆成 "0"/"1" 的字符串）。
  const preferred = ["completed", "failed", "error", "result", "summary", "message"]
    .map((key) => record[key])
    .find((value) => typeof value === "string" && value.trim());
  if (typeof preferred === "string") {
    return preferred.trim();
  }
  const stringValues = Object.values(record).filter((value): value is string => typeof value === "string");
  if (stringValues.length && Object.keys(record).every((key) => /^\d+$/.test(key))) {
    return stringValues.join("").trim();
  }
  return stringValues.join("\n").trim();
}

export function stripAppDirectiveHtml(value: unknown): string {
  return String(value ?? "").replace(APP_DIRECTIVE_HTML_PATTERN, "").trim();
}

export function sanitizeRenderedHtml(value: unknown): string {
  return sanitizeHtml(stripAppDirectiveHtml(value), {
    allowedTags: [
      "a",
      "b",
      "blockquote",
      "br",
      "code",
      "del",
      "details",
      "div",
      "em",
      "figcaption",
      "figure",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "li",
      "ol",
      "p",
      "pre",
      "section",
      "span",
      "strong",
      "summary",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
      "ul",
    ],
    allowedAttributes: {
      a: ["href", "name", "rel", "target", "title"],
      blockquote: ["class"],
      code: ["class"],
      details: ["class", "open"],
      div: ["class"],
      figure: ["class"],
      pre: ["class", "data-language"],
      section: ["class"],
      span: ["class"],
      summary: ["class"],
      table: ["class"],
    },
    allowedClasses: {
      blockquote: ["contains-task-list"],
      code: ["hljs", /^language-[A-Za-z0-9_-]+$/],
      details: ["tool-details"],
      div: [
        "attachment-grid",
        "body",
        "empty",
        "image-unavailable",
        "message-card",
        "process-body",
      ],
      figure: ["image-attachment", "image-unavailable"],
      pre: ["hljs"],
      section: [/^process-entry$/, /^process-(?:tool|user|assistant)$/],
      span: [/^hljs-[A-Za-z0-9_-]+$/],
      summary: ["process-summary"],
      table: ["table"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          rel: mergeLinkRel(attribs.rel),
          target: "_blank",
        },
      }),
    },
  }).trim();
}

export function sanitizeSnapshotHtml<T extends { turns?: Array<{ html?: unknown; text?: unknown }> }>(snapshot: T): T {
  const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : [];

  for (const turn of turns) {
    if (!turn || typeof turn !== "object") {
      continue;
    }
    if (typeof turn.text === "string") {
      turn.text = stripAppDirectives(turn.text);
    }
    if (typeof turn.html === "string") {
      turn.html = sanitizeRenderedHtml(turn.html);
    }
  }

  return snapshot;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function mergeLinkRel(value: unknown): string {
  const rel = new Set(String(value || "").split(/\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  return Array.from(rel).join(" ");
}
