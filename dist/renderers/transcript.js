import hljs from "highlight.js";
import { escapeHtml, sanitizeRenderedHtml, stripAppDirectives } from "../shared/sanitize.js";
export function buildTranscriptItems(turns) {
    const items = [];
    let index = 0;
    let previousUserTurn = null;
    while (index < turns.length) {
        const turn = turns[index];
        if (isUserMessageTurn(turn)) {
            items.push({ kind: "turn", turn });
            previousUserTurn = turn;
            index += 1;
            continue;
        }
        const segment = [];
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
export function processLabel(turns, label = "已处理") {
    const duration = processDurationLabel(turns);
    return duration ? `${label} ${duration}` : label;
}
export function processDurationLabel(turns) {
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
export function buildTranscriptOutlineItems(turns, options = {}) {
    const prefix = options.anchorPrefix || "";
    return buildTranscriptItems(turns)
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.kind === "turn" && isUserMessageTurn(item.turn) && !isInterruptionTurn(item.turn))
        .map(({ item, index }) => {
        const turn = item.kind === "turn" ? item.turn : null;
        const turnNumber = Number(turn?.turn || 0);
        return {
            id: turnAnchorId(turn, index, prefix),
            turn: Number.isFinite(turnNumber) && turnNumber > 0 ? Math.round(turnNumber) : index + 1,
            label: outlineLabel(turn),
        };
    });
}
export function renderTranscriptHtml(turns, emptyHtmlOrOptions = "<div class='empty'>没有可分享的对话记录。</div>", options = {}) {
    const renderOptions = normalizeTranscriptRenderOptions(emptyHtmlOrOptions, options);
    const html = buildTranscriptItems(turns).map((item, index) => renderTranscriptItemHtml(item, index, renderOptions)).join("");
    return html || renderOptions.emptyHtml;
}
function normalizeTranscriptRenderOptions(emptyHtmlOrOptions, options) {
    const base = typeof emptyHtmlOrOptions === "string" ? { ...options, emptyHtml: emptyHtmlOrOptions } : emptyHtmlOrOptions;
    return {
        bodyWrapper: base.bodyWrapper !== false,
        emptyHtml: base.emptyHtml || "<div class='empty'>没有可分享的对话记录。</div>",
        bodyClassName: base.bodyClassName || "body",
        contentClassName: base.contentClassName || "",
        includeProcessMessageMeta: Boolean(base.includeProcessMessageMeta),
        includeTopLevelToolMeta: Boolean(base.includeTopLevelToolMeta),
        roleClassMode: base.roleClassMode || "space",
        turnAnchorPrefix: base.turnAnchorPrefix || "",
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
function buildProcessDurationTurns(startTurn, turns) {
    return [startTurn, ...turns].filter(Boolean);
}
const INTERRUPTION_MARKER_PATTERNS = [
    // Codex CLI 在用户按 Esc 中断时注入的 user 角色标记
    /^<turn_aborted>[\s\S]*<\/turn_aborted>$/,
    // Claude Code 中断时记录的占位用户消息
    /^\[Request interrupted by user(?: for tool use)?\]$/,
];
export function isInterruptionMarker(text) {
    const value = String(text ?? "").trim();
    if (!value) {
        return false;
    }
    return INTERRUPTION_MARKER_PATTERNS.some((pattern) => pattern.test(value));
}
function isInterruptionTurn(turn) {
    return turn.kind !== "tool" && turn.role === "user" && !(turn.images || []).length && isInterruptionMarker(turn.text);
}
function isUserMessageTurn(turn) {
    return Boolean(turn && turn.kind !== "tool" && turn.role === "user");
}
function isAssistantMessageTurn(turn) {
    return Boolean(turn && turn.kind !== "tool" && turn.role === "assistant");
}
function renderTranscriptItemHtml(item, index, options) {
    if (item.kind === "process") {
        return renderProcessGroupHtml(item, index, options);
    }
    return renderTurnHtml(item.turn, options, item.durationTurns || [], index);
}
function renderTurnHtml(turn, options, durationTurns = [], itemIndex = 0) {
    if (isInterruptionTurn(turn)) {
        return renderInterruptionNoticeHtml(options);
    }
    const role = turnRole(turn);
    const meta = options.includeTopLevelToolMeta && role === "tool"
        ? `<div class="turn-meta">${escapeHtml(turnLabel(role, turn, options))}</div>`
        : "";
    const assistantMeta = role === "assistant" ? renderAssistantTurnMetaHtml(turn, durationTurns) : "";
    return `<article class="${escapeHtml(turnClassName(role, options))}"${turnAnchorAttrs(turn, options, itemIndex)}><div class="message-card">${meta}${assistantMeta}${renderBodyContainerHtml(turn, options)}</div></article>`;
}
function renderInterruptionNoticeHtml(options) {
    return `<article class="${escapeHtml(turnClassName("interrupt", options))}"><div class="turn-notice"><span aria-hidden="true">⏹</span><span>${escapeHtml(options.labels.interrupted)}</span></div></article>`;
}
function renderProcessGroupHtml(item, index, options) {
    const turns = item.turns || [];
    if (!turns.length) {
        return "";
    }
    const files = fileChangeLabelHtml(processFileChanges(turns));
    const fileHtml = files ? `<span class="process-files">${files}</span>` : "";
    return `<article class="${escapeHtml(processClassName(options))}"><details class="process-details" data-process-index="${escapeHtml(index)}"><summary class="process-summary"><span>${escapeHtml(processLabel(item.durationTurns || turns, options.labels.processed))}</span>${fileHtml}</summary><div class="process-body">${turns.map((turn) => renderProcessEntryHtml(turn, options)).join("")}</div></details></article>`;
}
function renderProcessEntryHtml(turn, options) {
    const role = turnRole(turn);
    const meta = options.includeProcessMessageMeta && role !== "tool"
        ? `<div class="turn-meta">${escapeHtml(turnLabel(role, turn, options))}</div>`
        : "";
    return `<section class="process-entry process-${escapeHtml(role)}"${turnAnchorAttrs(turn, options)}>${meta}${renderBodyContainerHtml(turn, options)}</section>`;
}
function renderAssistantTurnMetaHtml(turn, durationTurns) {
    const tokenLabel = turnTokenUsageLabel(turn.tokenUsage);
    const duration = processDurationLabel(durationTurns);
    const parts = [tokenLabel, duration].filter(Boolean);
    if (!parts.length) {
        return "";
    }
    return `<div class="turn-meta-badge">${escapeHtml(parts.join(" · "))}</div>`;
}
function turnTokenUsageLabel(usage) {
    if (!usage) {
        return "";
    }
    const total = tokenUsageNumber(usage.totalTokens);
    const input = tokenUsageNumber(usage.inputTokens);
    const output = tokenUsageNumber(usage.outputTokens);
    const tokens = total || input + output;
    return tokens ? `${formatTokenShort(tokens)} tok` : "";
}
function tokenUsageNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}
function formatTokenShort(value) {
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
function turnAnchorAttrs(turn, options, itemIndex) {
    const turnNumber = Number(turn.turn || 0);
    const attrs = [];
    if (!Number.isFinite(turnNumber) || turnNumber <= 0) {
        if (!options.turnAnchorPrefix || itemIndex === undefined) {
            return "";
        }
    }
    else {
        attrs.push(`data-turn-number="${escapeHtml(String(Math.round(turnNumber)))}"`);
    }
    if (options.turnAnchorPrefix && itemIndex !== undefined) {
        attrs.push(`id="${escapeHtml(turnAnchorId(turn, itemIndex, options.turnAnchorPrefix))}"`);
    }
    return attrs.length ? ` ${attrs.join(" ")}` : "";
}
function turnAnchorId(turn, itemIndex, prefix) {
    const turnNumber = Number(turn?.turn || 0);
    const itemSuffix = itemIndex === undefined ? "" : `item-${itemIndex + 1}`;
    const turnSuffix = Number.isFinite(turnNumber) && turnNumber > 0 ? `turn-${Math.round(turnNumber)}` : "";
    const suffix = [itemSuffix, turnSuffix].filter(Boolean).join("-");
    return `${prefix}${suffix}`;
}
function outlineLabel(turn) {
    const text = stripAppDirectives(turn?.text || "") || htmlText(turn?.html || "");
    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact) {
        return "用户消息";
    }
    return compact.length > 60 ? `${compact.slice(0, 60)}...` : compact;
}
function htmlText(value) {
    return String(value || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
function turnRole(turn) {
    if (turn.kind === "tool") {
        return "tool";
    }
    return turn.role === "user" ? "user" : "assistant";
}
function renderTurnBodyHtml(turn, options) {
    if (turn.kind === "tool") {
        const files = fileChangeLabelHtml(turn.fileChanges || []);
        const fileSuffix = files ? ` · ${files}` : "";
        const body = (turn.fileChanges || []).length ? renderFileChangesHtml(turn.fileChanges || []) : `<pre>${escapeHtml(turn.text || "")}</pre>`;
        return `<details class="tool-details"><summary>${escapeHtml(options.labels.tool)}${turn.name ? ` / ${escapeHtml(turn.name)}` : ""}${fileSuffix}</summary>${body}</details>`;
    }
    const content = `${sanitizeRenderedHtml(turn.html || "") || renderPlainTextHtml(turn.text)}${renderImagesHtml(turn.images || [], options)}`;
    return options.contentClassName ? `<div class="${escapeHtml(options.contentClassName)}">${content}</div>` : content;
}
function renderFileChangesHtml(fileChanges) {
    const groups = uniqueFileChangeGroups(fileChanges);
    return groups.map((group) => {
        const label = group.paths.length ? `<div class="file-change-path">${renderFilePathListHtml(group.paths, ", ")}</div>` : "";
        return `<div class="file-change">${label}${renderDiffPreHtml(group.diffText)}</div>`;
    }).join("");
}
function renderDiffPreHtml(diffText) {
    const code = String(diffText || "");
    let html = "";
    if (hljs.getLanguage("diff")) {
        html = hljs.highlight(code, { language: "diff", ignoreIllegals: true }).value;
    }
    else {
        html = escapeHtml(code);
    }
    return `<pre data-language="diff"><code class="hljs language-diff">${html}</code></pre>`;
}
function uniqueFileChangeGroups(fileChanges) {
    const groups = new Map();
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
function processFileChanges(turns) {
    return (turns || []).flatMap((turn) => Array.isArray(turn.fileChanges) ? turn.fileChanges : []);
}
function fileChangeLabel(fileChanges) {
    const paths = uniqueFilePaths(fileChanges);
    if (!paths.length) {
        return "";
    }
    const visible = paths.slice(0, 3);
    const rest = paths.length - visible.length;
    return visible.join(" · ") + (rest > 0 ? ` 等 ${rest} 个文件` : "");
}
function fileChangeLabelHtml(fileChanges) {
    const paths = uniqueFilePaths(fileChanges);
    if (!paths.length) {
        return "";
    }
    const visible = paths.slice(0, 3);
    const rest = paths.length - visible.length;
    return renderFilePathListHtml(visible, " · ") + (rest > 0 ? ` 等 ${escapeHtml(rest)} 个文件` : "");
}
function renderFilePathListHtml(paths, separator) {
    return paths.map((path) => renderFilePathHtml(path)).join(separator);
}
function renderFilePathHtml(path) {
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
function isAbsoluteFilePath(value) {
    return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
function uniqueFilePaths(fileChanges) {
    const paths = [];
    for (const change of fileChanges || []) {
        const path = String(change.path || "").trim();
        if (path && !paths.includes(path)) {
            paths.push(path);
        }
    }
    return paths;
}
function renderBodyContainerHtml(turn, options) {
    const body = renderTurnBodyHtml(turn, options);
    return options.bodyWrapper ? `<div class="${escapeHtml(options.bodyClassName)}">${body}</div>` : body;
}
function turnClassName(role, options) {
    return options.roleClassMode === "prefixed" ? `turn turn-${role}` : `turn ${role}`;
}
function processClassName(options) {
    return options.roleClassMode === "prefixed" ? "turn turn-process" : "turn process";
}
function turnLabel(role, turn, options) {
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
function renderPlainTextHtml(value) {
    const visibleText = stripAppDirectives(value);
    if (!visibleText) {
        return "";
    }
    return visibleText
        .split(/\n{2,}/)
        .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
        .join("");
}
function renderImagesHtml(images, options) {
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
function isInlineImageSrc(src) {
    return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(src);
}
export function sanitizeTranscriptHtml(value) {
    return sanitizeRenderedHtml(value);
}
