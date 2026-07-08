import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { SnapshotPayload } from "./types";
import {
  buildTranscriptOutlineItems,
  handleContentLinkClick,
  openContentLinksInNewTabs,
  renderTranscriptHtml,
} from "./transcript";
import type { TranscriptOutlineItem } from "./transcript";
import { escapeHtml, normalizeApiUrl, resolveInitialApiUrl, safeLocalStorageSet } from "./utils";

export function SharePage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const shareId = useMemo(() => params.get("id") || "", [params]);
  const apiUrl = useMemo(() => resolveInitialApiUrl(params), [params]);
  const [title, setTitle] = useState("正在加载快照");
  const [meta, setMeta] = useState("正在等待分享元数据。");
  const [goalObjective, setGoalObjective] = useState("");
  const [contentHtml, setContentHtml] = useState("正在加载...");
  const [outlineItems, setOutlineItems] = useState<TranscriptOutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [allExpanded, setAllExpanded] = useState(false);
  const contentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    loadShare({
      apiUrl,
      shareId,
      setTitle,
      setMeta,
      setGoalObjective,
      setContentHtml,
      setOutlineItems,
    }).catch((error: unknown) => {
      setTitle("快照暂不可用");
      setMeta(apiUrl);
      setGoalObjective("");
      setContentHtml(`<div class="empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`);
      setOutlineItems([]);
    });
  }, [apiUrl, shareId]);

  useEffect(() => {
    openContentLinksInNewTabs(contentRef);
    const root = contentRef.current;
    if (!root) {
      return undefined;
    }
    setShareDetailsOpen(root, false);
    const syncExpanded = () => setAllExpanded(allShareDetailsOpen(root));
    const details = shareDetailNodes(root);
    details.forEach((node) => node.addEventListener("toggle", syncExpanded));
    syncExpanded();
    return () => {
      details.forEach((node) => node.removeEventListener("toggle", syncExpanded));
    };
  }, [contentHtml]);

  useEffect(() => {
    setOutlineOpen(outlineItems.length > 0);
  }, [outlineItems]);

  const toggleAllDetails = () => {
    const root = contentRef.current;
    if (!root) {
      return;
    }
    const next = !allShareDetailsOpen(root);
    setShareDetailsOpen(root, next);
    setAllExpanded(next);
  };

  const jumpToOutlineItem = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) {
      return;
    }
    event.preventDefault();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
    window.history.replaceState(null, "", `#${id}`);
  };

  return (
    <main className="share-shell">
      {outlineItems.length ? (
        <aside className={`share-outline ${outlineOpen ? "open" : ""}`} aria-label="快照大纲" aria-hidden={!outlineOpen}>
          <div className="share-outline-head">
            <b>大纲</b>
            <button type="button" onClick={() => setOutlineOpen(false)}>
              收起
            </button>
          </div>
          <div className="share-outline-list">
            {outlineItems.map((item) => (
              <a
                className="share-outline-item"
                href={`#${item.id}`}
                key={item.id}
                onClick={(event) => jumpToOutlineItem(event, item.id)}
              >
                <span>用户 {item.turn}</span>
                <b>{item.label}</b>
              </a>
            ))}
          </div>
        </aside>
      ) : null}
      <header className="share-header">
        <p className="eyebrow">云端只读快照</p>
        <h1 id="share-title">{title}</h1>
        <p id="share-meta" className="share-meta">
          {meta}
        </p>
        {goalObjective ? (
          <section className="share-goal" aria-label="快照目标">
            <span>目标</span>
            <p>{goalObjective}</p>
          </section>
        ) : null}
      </header>
      <nav className="share-reading-controls" aria-label="阅读控制">
        <button type="button" onClick={toggleAllDetails}>
          {allExpanded ? "全部收起" : "全部展开"}
        </button>
        {outlineItems.length ? (
          <button type="button" aria-pressed={outlineOpen} onClick={() => setOutlineOpen((value) => !value)}>
            {outlineOpen ? "收起大纲" : "打开大纲"}
          </button>
        ) : null}
      </nav>
      <section
        id="share-content"
        className="turns"
        aria-live="polite"
        ref={contentRef}
        onClick={handleContentLinkClick}
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />
    </main>
  );
}

async function loadShare({
  apiUrl,
  shareId,
  setTitle,
  setMeta,
  setGoalObjective,
  setContentHtml,
  setOutlineItems,
}: {
  apiUrl: string;
  shareId: string;
  setTitle: (value: string) => void;
  setMeta: (value: string) => void;
  setGoalObjective: (value: string) => void;
  setContentHtml: (value: string) => void;
  setOutlineItems: (value: TranscriptOutlineItem[]) => void;
}) {
  if (!shareId) {
    setTitle("缺少分享 ID");
    setMeta("请打开带有 ?id=snap_... 的链接。");
    setGoalObjective("");
    setContentHtml('<div class="empty">没有提供分享 ID。</div>');
    setOutlineItems([]);
    return;
  }
  if (!apiUrl) {
    setTitle("缺少分享 API");
    setMeta("公开站点需要配置分享 API。");
    setGoalObjective("");
    setContentHtml('<div class="empty">请使用带有 ?api=https://... 的分享链接，或先配置 AGENT_SNAPSHOTS_PUBLIC_API_URL。</div>');
    setOutlineItems([]);
    return;
  }

  safeLocalStorageSet("agent-snapshots.api", apiUrl);

  const response = await fetch(`${apiUrl}/api/snapshots/${encodeURIComponent(shareId)}`, {
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as SnapshotPayload & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || `无法从 ${apiUrl} 加载快照`);
  }

  renderSnapshot(payload, apiUrl, setTitle, setMeta, setGoalObjective, setContentHtml, setOutlineItems);
}

function renderSnapshot(
  payload: SnapshotPayload,
  apiUrl: string,
  setTitle: (value: string) => void,
  setMeta: (value: string) => void,
  setGoalObjective: (value: string) => void,
  setContentHtml: (value: string) => void,
  setOutlineItems: (value: TranscriptOutlineItem[]) => void,
) {
  const snapshot = payload.snapshot;
  const share = payload.share;
  const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : [];

  setTitle(share?.title || snapshot?.title || "快照");
  setGoalObjective(snapshot?.goalObjective || share?.goalObjective || "");
  setMeta(
    [
      share?.engineLabel || snapshot?.engineLabel || "Codex",
      share?.id || snapshot?.id || "未知",
      `${share?.turnCount ?? turns.length} 条记录`,
      `已脱敏：${(share?.redacted ?? snapshot?.redacted) ? "是" : "否"}`,
      normalizeApiUrl(apiUrl),
    ].join(" | "),
  );

  setOutlineItems(buildTranscriptOutlineItems(turns, { anchorPrefix: "turn-" }));
  setContentHtml(renderTranscriptHtml(turns, {
    emptyHtml: "<div class='empty'>这个快照没有可分享的对话记录。</div>",
    turnAnchorPrefix: "turn-",
  }));
}

function shareDetailNodes(root: HTMLElement): HTMLDetailsElement[] {
  return Array.from(root.querySelectorAll("details.process-details, details.tool-details")).filter(
    (node): node is HTMLDetailsElement => node instanceof HTMLDetailsElement,
  );
}

function setShareDetailsOpen(root: HTMLElement, open: boolean): void {
  for (const detail of shareDetailNodes(root)) {
    detail.open = open;
  }
}

function allShareDetailsOpen(root: HTMLElement): boolean {
  const details = shareDetailNodes(root);
  return details.length > 0 && details.every((detail) => detail.open);
}
