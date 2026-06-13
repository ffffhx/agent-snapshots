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
            items.push({ kind: "turn", turn: finalTurn });
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
    return renderTurnHtml(item.turn, options);
}
function renderTurnHtml(turn, options) {
    if (isInterruptionTurn(turn)) {
        return renderInterruptionNoticeHtml(options);
    }
    const role = turnRole(turn);
    const meta = options.includeTopLevelToolMeta && role === "tool"
        ? `<div class="turn-meta">${escapeHtml(turnLabel(role, turn, options))}</div>`
        : "";
    return `<article class="${escapeHtml(turnClassName(role, options))}"><div class="message-card">${meta}${renderBodyContainerHtml(turn, options)}</div></article>`;
}
function renderInterruptionNoticeHtml(options) {
    return `<article class="${escapeHtml(turnClassName("interrupt", options))}"><div class="turn-notice"><span aria-hidden="true">⏹</span><span>${escapeHtml(options.labels.interrupted)}</span></div></article>`;
}
function renderProcessGroupHtml(item, index, options) {
    const turns = item.turns || [];
    if (!turns.length) {
        return "";
    }
    return `<article class="${escapeHtml(processClassName(options))}"><details class="process-details" data-process-index="${escapeHtml(index)}"><summary class="process-summary"><span>${escapeHtml(processLabel(item.durationTurns || turns, options.labels.processed))}</span></summary><div class="process-body">${turns.map((turn) => renderProcessEntryHtml(turn, options)).join("")}</div></details></article>`;
}
function renderProcessEntryHtml(turn, options) {
    const role = turnRole(turn);
    const meta = options.includeProcessMessageMeta && role !== "tool"
        ? `<div class="turn-meta">${escapeHtml(turnLabel(role, turn, options))}</div>`
        : "";
    return `<section class="process-entry process-${escapeHtml(role)}">${meta}${renderBodyContainerHtml(turn, options)}</section>`;
}
function turnRole(turn) {
    if (turn.kind === "tool") {
        return "tool";
    }
    return turn.role === "user" ? "user" : "assistant";
}
function renderTurnBodyHtml(turn, options) {
    if (turn.kind === "tool") {
        return `<details class="tool-details"><summary>${escapeHtml(options.labels.tool)}${turn.name ? ` / ${escapeHtml(turn.name)}` : ""}</summary><pre>${escapeHtml(turn.text || "")}</pre></details>`;
    }
    const content = `${sanitizeRenderedHtml(turn.html || "") || renderPlainTextHtml(turn.text)}${renderImagesHtml(turn.images || [], options)}`;
    return options.contentClassName ? `<div class="${escapeHtml(options.contentClassName)}">${content}</div>` : content;
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
        if (!image.src) {
            return `<figure class="image-attachment image-unavailable"><div>${escapeHtml(image.unavailableReason || options.labels.imageUnavailable)}</div></figure>`;
        }
        return `<figure class="image-attachment"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || `${options.labels.imageAltPrefix} ${index + 1}`)}" decoding="async"></figure>`;
    })
        .join("")}</div>`;
}
export function sanitizeTranscriptHtml(value) {
    return sanitizeRenderedHtml(value);
}
