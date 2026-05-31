import { useEffect, useMemo, useRef, useState } from "react";
import type { SnapshotPayload } from "./types";
import {
  handleContentLinkClick,
  openContentLinksInNewTabs,
  renderTranscriptHtml,
} from "./transcript";
import { escapeHtml, normalizeApiUrl, resolveInitialApiUrl, safeLocalStorageSet } from "./utils";

export function SharePage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const shareId = useMemo(() => params.get("id") || "", [params]);
  const apiUrl = useMemo(() => resolveInitialApiUrl(params), [params]);
  const [title, setTitle] = useState("正在加载快照");
  const [meta, setMeta] = useState("正在等待分享元数据。");
  const [goalObjective, setGoalObjective] = useState("");
  const [contentHtml, setContentHtml] = useState("正在加载...");
  const contentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    loadShare({
      apiUrl,
      shareId,
      setTitle,
      setMeta,
      setGoalObjective,
      setContentHtml,
    }).catch((error: unknown) => {
      setTitle("快照暂不可用");
      setMeta(apiUrl);
      setGoalObjective("");
      setContentHtml(`<div class="empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`);
    });
  }, [apiUrl, shareId]);

  useEffect(() => {
    openContentLinksInNewTabs(contentRef);
  }, [contentHtml]);

  return (
    <main className="share-shell">
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
}: {
  apiUrl: string;
  shareId: string;
  setTitle: (value: string) => void;
  setMeta: (value: string) => void;
  setGoalObjective: (value: string) => void;
  setContentHtml: (value: string) => void;
}) {
  if (!shareId) {
    setTitle("缺少分享 ID");
    setMeta("请打开带有 ?id=snap_... 的链接。");
    setGoalObjective("");
    setContentHtml('<div class="empty">没有提供分享 ID。</div>');
    return;
  }
  if (!apiUrl) {
    setTitle("缺少分享 API");
    setMeta("公开站点需要配置分享 API。");
    setGoalObjective("");
    setContentHtml('<div class="empty">请使用带有 ?api=https://... 的分享链接，或先配置 CODEX_SNAPSHOTS_PUBLIC_API_URL。</div>');
    return;
  }

  safeLocalStorageSet("codex-snapshots.api", apiUrl);

  const response = await fetch(`${apiUrl}/api/snapshots/${encodeURIComponent(shareId)}`, {
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as SnapshotPayload & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || `无法从 ${apiUrl} 加载快照`);
  }

  renderSnapshot(payload, apiUrl, setTitle, setMeta, setGoalObjective, setContentHtml);
}

function renderSnapshot(
  payload: SnapshotPayload,
  apiUrl: string,
  setTitle: (value: string) => void,
  setMeta: (value: string) => void,
  setGoalObjective: (value: string) => void,
  setContentHtml: (value: string) => void,
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

  setContentHtml(renderTranscriptHtml(turns, "<div class='empty'>这个快照没有可分享的对话记录。</div>"));
}
