import type { MouseEvent, RefObject } from "react";
import type { SnapshotImage, SnapshotTurn } from "./types";
import { escapeHtml, mergeLinkRel, openInNewTab } from "./utils";

type TurnItem = {
  kind: "turn";
  turn: SnapshotTurn;
};

type ProcessItem = {
  kind: "process";
  turns: SnapshotTurn[];
  durationTurns: SnapshotTurn[];
};

export type TranscriptItem = TurnItem | ProcessItem;

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

function buildProcessDurationTurns(startTurn: SnapshotTurn | null, turns: SnapshotTurn[]): SnapshotTurn[] {
  return [startTurn, ...turns].filter(Boolean) as SnapshotTurn[];
}

function isUserMessageTurn(turn: SnapshotTurn | undefined): boolean {
  return Boolean(turn && turn.kind !== "tool" && turn.role === "user");
}

function isAssistantMessageTurn(turn: SnapshotTurn | undefined): boolean {
  return Boolean(turn && turn.kind !== "tool" && turn.role === "assistant");
}

export function renderTranscriptItem(item: TranscriptItem, index: number) {
  if (item.kind === "process") {
    return renderProcessGroup(item, index);
  }
  return renderTurn(item.turn, index);
}

function renderTurn(turn: SnapshotTurn, index: number) {
  const role = turnRole(turn);
  return (
    <article className={`turn ${role}`} key={`turn-${index}`}>
      <div className="message-card">
        <div className="body" dangerouslySetInnerHTML={{ __html: sanitizeClientHtml(renderTurnBody(turn)) }} />
      </div>
    </article>
  );
}

function renderProcessGroup(item: ProcessItem, index: number) {
  const turns = item.turns || [];
  if (!turns.length) {
    return null;
  }

  return (
    <article className="turn process" key={`process-${index}`}>
      <details className="process-details" data-process-index={index}>
        <summary className="process-summary">
          <span>{processLabel(item.durationTurns || turns)}</span>
        </summary>
        <div className="process-body">{turns.map(renderProcessEntry)}</div>
      </details>
    </article>
  );
}

function renderProcessEntry(turn: SnapshotTurn, index: number) {
  const role = turnRole(turn);
  return (
    <section className={`process-entry process-${role}`} key={`entry-${index}`}>
      <div className="body" dangerouslySetInnerHTML={{ __html: sanitizeClientHtml(renderTurnBody(turn)) }} />
    </section>
  );
}

function turnRole(turn: SnapshotTurn): "tool" | "user" | "assistant" {
  if (turn.kind === "tool") {
    return "tool";
  }
  return turn.role === "user" ? "user" : "assistant";
}

function renderTurnBody(turn: SnapshotTurn): string {
  if (turn.kind === "tool") {
    return `<details class="tool-details"><summary>工具${turn.name ? ` / ${escapeHtml(turn.name)}` : ""}</summary><pre>${escapeHtml(turn.text || "")}</pre></details>`;
  }
  return `${stripAppDirectiveHtml(turn.html || "") || renderPlainText(turn.text)}${renderImages(turn.images || [])}`;
}

function processLabel(turns: SnapshotTurn[]): string {
  const duration = processDurationLabel(turns);
  return duration ? `已处理 ${duration}` : "已处理";
}

function processDurationLabel(turns: SnapshotTurn[]): string {
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

function renderPlainText(value: string | undefined): string {
  const visibleText = stripAppDirectives(value);
  if (!visibleText) {
    return "";
  }

  return visibleText
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function stripAppDirectives(value: string | undefined): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\{[^\n]*\}[ \t]*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripAppDirectiveHtml(value: string | undefined): string {
  return String(value || "")
    .replace(/<p>\s*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\{[\s\S]*?\}\s*<\/p>/g, "")
    .trim();
}

function renderImages(images: SnapshotImage[]): string {
  if (!Array.isArray(images) || !images.length) {
    return "";
  }

  return `<div class="attachment-grid">${images
    .map((image, index) => {
      if (!image.src) {
        return `<figure class="image-attachment image-unavailable"><div>${escapeHtml(image.unavailableReason || "图片暂不可用")}</div></figure>`;
      }
      return `<figure class="image-attachment"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || `图片附件 ${index + 1}`)}" decoding="async"></figure>`;
    })
    .join("")}</div>`;
}

function sanitizeClientHtml(value: string): string {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed)>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

export function handleContentLinkClick(event: MouseEvent<HTMLElement>): void {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) {
    return;
  }

  event.preventDefault();
  openInNewTab(link.href);
}

export function openContentLinksInNewTabs(rootRef: RefObject<HTMLElement | null>): void {
  const root = rootRef.current;
  if (!root) {
    return;
  }

  for (const link of root.querySelectorAll("a[href]")) {
    if (!(link instanceof HTMLAnchorElement)) {
      continue;
    }
    link.target = "_blank";
    link.rel = mergeLinkRel(link.rel);
  }
}
