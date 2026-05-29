import { useEffect, useMemo, useRef, useState } from "react";
import type { SnapshotPayload } from "./types";
import {
  buildTranscriptItems,
  handleContentLinkClick,
  openContentLinksInNewTabs,
  renderTranscriptItem,
  type TranscriptItem,
} from "./transcript";
import { escapeHtml, normalizeApiUrl, resolveInitialApiUrl, safeLocalStorageSet } from "./utils";

type ShareContentState =
  | {
      kind: "loading";
      text: string;
    }
  | {
      kind: "empty";
      text: string;
    }
  | {
      kind: "items";
      items: TranscriptItem[];
    };

export function SharePage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const shareId = useMemo(() => params.get("id") || "", [params]);
  const apiUrl = useMemo(() => resolveInitialApiUrl(params), [params]);
  const [title, setTitle] = useState("正在加载快照");
  const [meta, setMeta] = useState("正在等待分享元数据。");
  const [content, setContent] = useState<ShareContentState>({
    kind: "loading",
    text: "正在加载...",
  });
  const contentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    loadShare({
      apiUrl,
      shareId,
      setTitle,
      setMeta,
      setContent,
    }).catch((error: unknown) => {
      setTitle("快照暂不可用");
      setMeta(apiUrl);
      setContent({
        kind: "empty",
        text: escapeHtml(error instanceof Error ? error.message : String(error)),
      });
    });
  }, [apiUrl, shareId]);

  useEffect(() => {
    openContentLinksInNewTabs(contentRef);
  }, [content]);

  return (
    <main className="share-shell">
      <header className="share-header">
        <p className="eyebrow">云端只读快照</p>
        <h1 id="share-title">{title}</h1>
        <p id="share-meta" className="share-meta">
          {meta}
        </p>
      </header>
      <section id="share-content" className="turns" aria-live="polite" ref={contentRef} onClick={handleContentLinkClick}>
        <ShareContent content={content} />
      </section>
    </main>
  );
}

function ShareContent({ content }: { content: ShareContentState }) {
  if (content.kind === "loading") {
    return <>{content.text}</>;
  }

  if (content.kind === "empty") {
    return <div className="empty" dangerouslySetInnerHTML={{ __html: content.text }} />;
  }

  return content.items.length ? content.items.map(renderTranscriptItem) : <div className="empty">这个快照没有可分享的对话记录。</div>;
}

async function loadShare({
  apiUrl,
  shareId,
  setTitle,
  setMeta,
  setContent,
}: {
  apiUrl: string;
  shareId: string;
  setTitle: (value: string) => void;
  setMeta: (value: string) => void;
  setContent: (value: ShareContentState) => void;
}) {
  if (!shareId) {
    setTitle("缺少分享 ID");
    setMeta("请打开带有 ?id=snap_... 的链接。");
    setContent({
      kind: "empty",
      text: "没有提供分享 ID。",
    });
    return;
  }
  if (!apiUrl) {
    setTitle("缺少分享 API");
    setMeta("公开站点需要配置分享 API。");
    setContent({
      kind: "empty",
      text: "请使用带有 ?api=https://... 的分享链接，或先配置 CODEX_SNAPSHOTS_PUBLIC_API_URL。",
    });
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

  renderSnapshot(payload, apiUrl, setTitle, setMeta, setContent);
}

function renderSnapshot(
  payload: SnapshotPayload,
  apiUrl: string,
  setTitle: (value: string) => void,
  setMeta: (value: string) => void,
  setContent: (value: ShareContentState) => void,
) {
  const snapshot = payload.snapshot;
  const share = payload.share;
  const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : [];

  setTitle(share?.title || snapshot?.title || "快照");
  setMeta(
    [
      share?.engineLabel || snapshot?.engineLabel || "Codex",
      share?.id || snapshot?.id || "未知",
      `${share?.turnCount ?? turns.length} 条记录`,
      `已脱敏：${(share?.redacted ?? snapshot?.redacted) ? "是" : "否"}`,
      normalizeApiUrl(apiUrl),
    ].join(" | "),
  );

  setContent({
    kind: "items",
    items: buildTranscriptItems(turns),
  });
}
