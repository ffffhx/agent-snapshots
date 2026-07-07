import hljs from "highlight.js";
import { escapeHtml, sanitizeRenderedHtml, stripAppDirectives } from "../shared/sanitize.js";
import type { SnapshotFileChange, SnapshotImage, SnapshotTurn } from "../core/snapshot.js";

export type { SnapshotImage, SnapshotTurn } from "../core/snapshot.js";

export type TurnItem = {
  kind: "turn";
  turn: SnapshotTurn;
  durationTurns?: SnapshotTurn[];
};

export type ProcessItem = {
  kind: "process";
  turns: SnapshotTurn[];
  durationTurns: SnapshotTurn[];
};

export type TranscriptItem = TurnItem | ProcessItem;

export type TranscriptRenderLabels = {
  assistant?: string;
  message?: string;
  processed?: string;
  tool?: string;
  user?: string;
  interrupted?: string;
  imageUnavailable?: string;
  imageAltPrefix?: string;
};

export type TranscriptRenderOptions = {
  bodyWrapper?: boolean;
  contentClassName?: string;
  emptyHtml?: string;
  includeProcessMessageMeta?: boolean;
  includeTopLevelToolMeta?: boolean;
  roleClassMode?: "space" | "prefixed";
  bodyClassName?: string;
  labels?: TranscriptRenderLabels;
};

type NormalizedTranscriptRenderOptions = {
  bodyWrapper: boolean;
  emptyHtml: string;
  bodyClassName: string;
  contentClassName: string;
  includeProcessMessageMeta: boolean;
  includeTopLevelToolMeta: boolean;
  roleClassMode: "space" | "prefixed";
  labels: Required<TranscriptRenderLabels>;
};

export function buildTranscriptItems(turns: SnapshotTurn[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let index = 0;
  let previousUserTurn: SnapshotTurn | null = null;

  while (index < turns.length) {
    const turn = turns[index];
    if (isUserMessageTurn(turn)) {
      items.push({ kind: "turn", turn });
      previousUserTurn = turn;
      index += 1;
      continue;
    }

    const segment: SnapshotTurn[] = [];
    while (index < turns.length && !isUserMessageTurn(turns[index])) {
      segment.push(turns[index]);
      index += 1;
    }

    const finalIndex = segment.map(isAssistantMessageTurn).lastIndexOf(true);
    if (finalIndex === -1) {
      if (segment.length) {
        items.push({
          kind: "process",
          turns: segment,
          durationTurns: buildProcessDurationTurns(previousUserTurn, segment),
        });
      }
      continue;
    }

    if (finalIndex === segment.length - 1) {
      const processTurns = segment.slice(0, finalIndex);
      const finalTurn = segment[finalIndex];
      if (processTurns.length) {
        items.push({
          kind: "process",
          turns: processTurns,
          durationTurns: buildProcessDurationTurns(previousUserTurn, processTurns.concat(finalTurn)),
        });
      }
      items.push({
        kind: "turn",
        turn: finalTurn,
        durationTurns: buildProcessDurationTurns(previousUserTurn, segment),
      });
      continue;
    }

    items.push({
      kind: "process",
      turns: segment,
      durationTurns: buildProcessDurationTurns(previousUserTurn, segment),
    });
  }

  return items;
}

export function processLabel(turns: SnapshotTurn[], label = "已处理"): string {
  const duration = processDurationLabel(turns);
  return duration ? `${label} ${duration}` : label;
}

export function processDurationLabel(turns: SnapshotTurn[]): string {
  const times = turns.map((turn) => new Date(turn.timestamp || "").getTime()).filter(Number.isFinite);
  if (times.length < 2) {
    return "";
  }

  const seconds = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

export function renderTranscriptHtml(
  turns: SnapshotTurn[],
  emptyHtmlOrOptions: string | TranscriptRenderOptions = "<div class='empty'>没有可分享的对话记录。</div>",
  options: TranscriptRenderOptions = {},
): string {
  const renderOptions = normalizeTranscriptRenderOptions(emptyHtmlOrOptions, options);
  const html = buildTranscriptItems(turns).map((item, index) => renderTranscriptItemHtml(item, index, renderOptions)).join("");
  return html || renderOptions.emptyHtml;
}

function normalizeTranscriptRenderOptions(
  emptyHtmlOrOptions: string | TranscriptRenderOptions,
  options: TranscriptRenderOptions,
): NormalizedTranscriptRenderOptions {
  const base = typeof emptyHtmlOrOptions === "string" ? { ...options, emptyHtml: emptyHtmlOrOptions } : emptyHtmlOrOptions;

  return {
    bodyWrapper: base.bodyWrapper !== false,
    emptyHtml: base.emptyHtml || "<div class='empty'>没有可分享的对话记录。</div>",
    bodyClassName: base.bodyClassName || "body",
    contentClassName: base.contentClassName || "",
    includeProcessMessageMeta: Boolean(base.includeProcessMessageMeta),
    includeTopLevelToolMeta: Boolean(base.includeTopLevelToolMeta),
    roleClassMode: base.roleClassMode || "space",
    labels: {
      assistant: base.labels?.assistant || "Assistant",
      message: base.labels?.message || "Message",
      processed: base.labels?.processed || "已处理",
      tool: base.labels?.tool || "工具",
      user: base.labels?.user || "User",
      interrupted: base.labels?.interrupted || "用户中断了此轮回复",
      imageUnavailable: base.labels?.imageUnavailable || "图片暂不可用",
      imageAltPrefix: base.labels?.imageAltPrefix || "图片附件",
    },
  };
}

function buildProcessDurationTurns(startTurn: SnapshotTurn | null, turns: SnapshotTurn[]): SnapshotTurn[] {
  return [startTurn, ...turns].filter(Boolean) as SnapshotTurn[];
}

const INTERRUPTION_MARKER_PATTERNS = [
  // Codex CLI 在用户按 Esc 中断时注入的 user 角色标记
  /^<turn_aborted>[\s\S]*<\/turn_aborted>$/,
  // Claude Code 中断时记录的占位用户消息
  /^\[Request interrupted by user(?: for tool use)?\]$/,
];

export function isInterruptionMarker(text: unknown): boolean {
  const value = String(text ?? "").trim();
  if (!value) {
    return false;
  }
  return INTERRUPTION_MARKER_PATTERNS.some((pattern) => pattern.test(value));
}

function isInterruptionTurn(turn: SnapshotTurn): boolean {
  return turn.kind !== "tool" && turn.role === "user" && !(turn.images || []).length && isInterruptionMarker(turn.text);
}

function isUserMessageTurn(turn: SnapshotTurn | undefined): boolean {
  return Boolean(turn && turn.kind !== "tool" && turn.role === "user");
}

function isAssistantMessageTurn(turn: SnapshotTurn | undefined): boolean {
  return Boolean(turn && turn.kind !== "tool" && turn.role === "assistant");
}

function renderTranscriptItemHtml(
  item: TranscriptItem,
  index: number,
  options: NormalizedTranscriptRenderOptions,
): string {
  if (item.kind === "process") {
    return renderProcessGroupHtml(item, index, options);
  }
  return renderTurnHtml(item.turn, options, item.durationTurns || []);
}

function renderTurnHtml(turn: SnapshotTurn, options: NormalizedTranscriptRenderOptions, durationTurns: SnapshotTurn[] = []): string {
  if (isInterruptionTurn(turn)) {
    return renderInterruptionNoticeHtml(options);
  }
  const role = turnRole(turn);
  const meta = options.includeTopLevelToolMeta && role === "tool"
    ? `<div class="turn-meta">${escapeHtml(turnLabel(role, turn, options))}</div>`
    : "";
  const assistantMeta = role === "assistant" ? renderAssistantTurnMetaHtml(turn, durationTurns) : "";
  return `<article class="${escapeHtml(turnClassName(role, options))}"${turnAnchorAttrs(turn)}><div class="message-card">${meta}${assistantMeta}${renderBodyContainerHtml(turn, options)}</div></article>`;
}

function renderInterruptionNoticeHtml(options: NormalizedTranscriptRenderOptions): string {
  return `<article class="${escapeHtml(turnClassName("interrupt", options))}"><div class="turn-notice"><span aria-hidden="true">⏹</span><span>${escapeHtml(options.labels.interrupted)}</span></div></article>`;
}

function renderProcessGroupHtml(
  item: ProcessItem,
  index: number,
  options: NormalizedTranscriptRenderOptions,
): string {
  const turns = item.turns || [];
  if (!turns.length) {
    return "";
  }

  const files = fileChangeLabelHtml(processFileChanges(turns));
  const fileHtml = files ? `<span class="process-files">${files}</span>` : "";
  return `<article class="${escapeHtml(processClassName(options))}"><details class="process-details" data-process-index="${escapeHtml(index)}"><summary class="process-summary"><span>${escapeHtml(processLabel(item.durationTurns || turns, options.labels.processed))}</span>${fileHtml}</summary><div class="process-body">${turns.map((turn) => renderProcessEntryHtml(turn, options)).join("")}</div></details></article>`;
}

function renderProcessEntryHtml(turn: SnapshotTurn, options: NormalizedTranscriptRenderOptions): string {
  const role = turnRole(turn);
  const meta = options.includeProcessMessageMeta && role !== "tool"
    ? `<div class="turn-meta">${escapeHtml(turnLabel(role, turn, options))}</div>`
    : "";
  return `<section class="process-entry process-${escapeHtml(role)}"${turnAnchorAttrs(turn)}>${meta}${renderBodyContainerHtml(turn, options)}</section>`;
}

function renderAssistantTurnMetaHtml(turn: SnapshotTurn, durationTurns: SnapshotTurn[]): string {
  const tokenLabel = turnTokenUsageLabel(turn.tokenUsage);
  const duration = processDurationLabel(durationTurns);
  const parts = [tokenLabel, duration].filter(Boolean);
  if (!parts.length) {
    return "";
  }
  return `<div class="turn-meta-badge">${escapeHtml(parts.join(" · "))}</div>`;
}

function turnTokenUsageLabel(usage: SnapshotTurn["tokenUsage"]): string {
  if (!usage) {
    return "";
  }
  const total = tokenUsageNumber(usage.totalTokens);
  const input = tokenUsageNumber(usage.inputTokens);
  const output = tokenUsageNumber(usage.outputTokens);
  const tokens = total || input + output;
  return tokens ? `${formatTokenShort(tokens)} tok` : "";
}

function tokenUsageNumber(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function formatTokenShort(value: number): string {
  if (value >= 1000000000) {
    return `${(value / 1000000000).toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(value);
}

function turnAnchorAttrs(turn: SnapshotTurn): string {
  const turnNumber = Number(turn.turn || 0);
  if (!Number.isFinite(turnNumber) || turnNumber <= 0) {
    return "";
  }
  const value = String(Math.round(turnNumber));
  return ` data-turn-number="${escapeHtml(value)}"`;
}

function turnRole(turn: SnapshotTurn): "tool" | "user" | "assistant" {
  if (turn.kind === "tool") {
    return "tool";
  }
  return turn.role === "user" ? "user" : "assistant";
}

function renderTurnBodyHtml(turn: SnapshotTurn, options: NormalizedTranscriptRenderOptions): string {
  if (turn.kind === "tool") {
    const files = fileChangeLabelHtml(turn.fileChanges || []);
    const fileSuffix = files ? ` · ${files}` : "";
    const body = (turn.fileChanges || []).length ? renderFileChangesHtml(turn.fileChanges || []) : `<pre>${escapeHtml(turn.text || "")}</pre>`;
    return `<details class="tool-details"><summary>${escapeHtml(options.labels.tool)}${turn.name ? ` / ${escapeHtml(turn.name)}` : ""}${fileSuffix}</summary>${body}</details>`;
  }
  const content = `${sanitizeRenderedHtml(turn.html || "") || renderPlainTextHtml(turn.text)}${renderImagesHtml(turn.images || [], options)}`;
  return options.contentClassName ? `<div class="${escapeHtml(options.contentClassName)}">${content}</div>` : content;
}

function renderFileChangesHtml(fileChanges: SnapshotFileChange[]): string {
  const groups = uniqueFileChangeGroups(fileChanges);
  return groups.map((group) => {
    const label = group.paths.length ? `<div class="file-change-path">${renderFilePathListHtml(group.paths, ", ")}</div>` : "";
    return `<div class="file-change">${label}${renderDiffPreHtml(group.diffText)}</div>`;
  }).join("");
}

function renderDiffPreHtml(diffText: string): string {
  const code = String(diffText || "");
  let html = "";
  if (hljs.getLanguage("diff")) {
    html = hljs.highlight(code, { language: "diff", ignoreIllegals: true }).value;
  } else {
    html = escapeHtml(code);
  }
  return `<pre data-language="diff"><code class="hljs language-diff">${html}</code></pre>`;
}

function uniqueFileChangeGroups(fileChanges: SnapshotFileChange[]): Array<{ diffText: string; paths: string[] }> {
  const groups = new Map<string, { diffText: string; paths: string[] }>();
  for (const change of fileChanges || []) {
    const diffText = String(change.diffText || "");
    if (!diffText) {
      continue;
    }
    const current = groups.get(diffText) || { diffText, paths: [] };
    const path = String(change.path || "").trim();
    if (path && !current.paths.includes(path)) {
      current.paths.push(path);
    }
    groups.set(diffText, current);
  }
  return Array.from(groups.values());
}

function processFileChanges(turns: SnapshotTurn[]): SnapshotFileChange[] {
  return (turns || []).flatMap((turn) => Array.isArray(turn.fileChanges) ? turn.fileChanges : []);
}

function fileChangeLabel(fileChanges: SnapshotFileChange[]): string {
  const paths = uniqueFilePaths(fileChanges);
  if (!paths.length) {
    return "";
  }
  const visible = paths.slice(0, 3);
  const rest = paths.length - visible.length;
  return visible.join(" · ") + (rest > 0 ? ` 等 ${rest} 个文件` : "");
}

function fileChangeLabelHtml(fileChanges: SnapshotFileChange[]): string {
  const paths = uniqueFilePaths(fileChanges);
  if (!paths.length) {
    return "";
  }
  const visible = paths.slice(0, 3);
  const rest = paths.length - visible.length;
  return renderFilePathListHtml(visible, " · ") + (rest > 0 ? ` 等 ${escapeHtml(rest)} 个文件` : "");
}

function renderFilePathListHtml(paths: string[], separator: string): string {
  return paths.map((path) => renderFilePathHtml(path)).join(separator);
}

function renderFilePathHtml(path: string): string {
  const value = String(path || "").trim();
  if (!value) {
    return "";
  }
  if (!isAbsoluteFilePath(value)) {
    return escapeHtml(value);
  }
  const escaped = escapeHtml(value);
  return `<span class="file-path-action" role="button" tabindex="0" data-file-path="${escaped}" title="点击复制路径，⌘点击在 Finder 中显示">${escaped}</span>`;
}

function isAbsoluteFilePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function uniqueFilePaths(fileChanges: SnapshotFileChange[]): string[] {
  const paths: string[] = [];
  for (const change of fileChanges || []) {
    const path = String(change.path || "").trim();
    if (path && !paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}

function renderBodyContainerHtml(turn: SnapshotTurn, options: NormalizedTranscriptRenderOptions): string {
  const body = renderTurnBodyHtml(turn, options);
  return options.bodyWrapper ? `<div class="${escapeHtml(options.bodyClassName)}">${body}</div>` : body;
}

function turnClassName(role: string, options: NormalizedTranscriptRenderOptions): string {
  return options.roleClassMode === "prefixed" ? `turn turn-${role}` : `turn ${role}`;
}

function processClassName(options: NormalizedTranscriptRenderOptions): string {
  return options.roleClassMode === "prefixed" ? "turn turn-process" : "turn process";
}

function turnLabel(role: string, turn: SnapshotTurn, options: NormalizedTranscriptRenderOptions): string {
  if (role === "tool") {
    return `${options.labels.tool}${turn.name ? ` / ${turn.name}` : ""}`;
  }
  if (role === "user") {
    return options.labels.user;
  }
  if (role === "assistant") {
    return options.labels.assistant;
  }
  return role || options.labels.message;
}

function renderPlainTextHtml(value: string | undefined): string {
  const visibleText = stripAppDirectives(value);
  if (!visibleText) {
    return "";
  }

  return visibleText
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function renderImagesHtml(images: SnapshotImage[], options: NormalizedTranscriptRenderOptions): string {
  if (!Array.isArray(images) || !images.length) {
    return "";
  }

  return `<div class="attachment-grid">${images
    .map((image, index) => {
      // Only inline data: images are rendered. A remote http(s) src would make
      // the viewer's browser fetch it on render — a tracking beacon / blind SSRF
      // — so it is shown as unavailable instead, regardless of the source data.
      if (!image.src || !isInlineImageSrc(image.src)) {
        return `<figure class="image-attachment image-unavailable"><div>${escapeHtml(image.unavailableReason || options.labels.imageUnavailable)}</div></figure>`;
      }
      return `<figure class="image-attachment"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || `${options.labels.imageAltPrefix} ${index + 1}`)}" decoding="async"></figure>`;
    })
    .join("")}</div>`;
}

function isInlineImageSrc(src: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(src);
}

export function sanitizeTranscriptHtml(value: unknown): string {
  return sanitizeRenderedHtml(value);
}
