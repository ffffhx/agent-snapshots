import { useEffect, useMemo, useState } from "react";
import type { AuthUser, PublicShare, StatusState } from "./types";
import {
  DEFAULT_VIEWER_URL,
  normalizeApiUrl,
  normalizeViewerUrl,
  resolveInitialApiUrl,
  timeoutSignal,
} from "./utils";

type PublicSessionsState =
  | {
      kind: "message";
      text: string;
    }
  | {
      kind: "shares";
      shares: PublicShare[];
    };

type AuthState =
  | {
      kind: "checking";
      text: string;
    }
  | {
      kind: "anonymous";
      configured: boolean;
      loginUrl?: string | null;
      text: string;
    }
  | {
      kind: "authenticated";
      configured: true;
      user: AuthUser;
    }
  | {
      kind: "error";
      text: string;
    };

const STATUS_LABELS: Record<StatusState, string> = {
  checking: "检查中",
  ready: "已连接",
  error: "未启动",
};

const TEMP_REVIEW_COMMAND = `npx agent-snapshots@latest serve --port 4321

# 或者全局安装 npm 包
npm install -g agent-snapshots@latest
agent-snapshot serve --port 4321`;

const DAEMON_INSTALL_COMMAND = `npm install -g agent-snapshots@latest
agent-snapshot daemon install
agent-snapshot daemon status`;

export function HomePage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const viewerUrl = useMemo(() => normalizeViewerUrl(params.get("viewer") || DEFAULT_VIEWER_URL), [params]);
  const [apiValue] = useState(() => resolveInitialApiUrl(params));
  const [viewerStatus, setViewerStatus] = useState<StatusState>("checking");
  const [publicSessions, setPublicSessions] = useState<PublicSessionsState>({
    kind: "message",
    text: "正在加载公开 Session...",
  });
  const [authState, setAuthState] = useState<AuthState>({
    kind: "checking",
    text: "正在检查 GitHub 登录...",
  });
  const [deletingShareId, setDeletingShareId] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");

  useEffect(() => {
    checkViewer(viewerUrl, setViewerStatus);
  }, [viewerUrl]);

  useEffect(() => {
    loadAuthState(apiValue, setAuthState);
    loadPublicSessions(apiValue, setPublicSessions);
  }, []);

  async function handleDeleteShare(share: PublicShare) {
    const api = normalizeApiUrl(apiValue);

    if (!api) {
      setDeleteStatus("分享 API 尚未配置。");
      return;
    }

    if (authState.kind !== "authenticated") {
      setDeleteStatus("请先登录 GitHub。");
      return;
    }

    if (!canDeleteShare(authState.user, share)) {
      setDeleteStatus("你只能删除自己发布的 Session。");
      return;
    }

    const confirmed = window.confirm(`删除「${share.title || share.id}」？删除后分享链接会失效。`);
    if (!confirmed) {
      return;
    }

    setDeletingShareId(share.id);
    setDeleteStatus("");

    try {
      const response = await fetch(`${api}/api/snapshots/${encodeURIComponent(share.id)}`, {
        method: "DELETE",
        cache: "no-store",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        const message =
          response.status === 401
            ? "请先登录 GitHub。"
            : response.status === 404
              ? "分享快照不存在或已被删除。"
              : response.status === 403
                ? "你只能删除自己发布的 Session。"
                : payload.error || `删除失败：HTTP ${response.status}`;
        throw new Error(message);
      }

      setPublicSessions((state) =>
        state.kind === "shares"
          ? {
              kind: "shares",
              shares: state.shares.filter((item) => item.id !== share.id),
            }
          : state,
      );
      setDeleteStatus("已删除分享快照。");
    } catch (error) {
      setDeleteStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingShareId("");
    }
  }

  function handleGithubLogin() {
    const api = normalizeApiUrl(apiValue);
    if (!api) {
      setDeleteStatus("分享 API 尚未配置。");
      return;
    }
    const loginUrl =
      authState.kind === "anonymous" && authState.loginUrl
        ? authState.loginUrl
        : `${api}/api/auth/github/start?returnTo=${encodeURIComponent(window.location.href)}`;
    window.location.href = loginUrl;
  }

  async function handleGithubLogout() {
    const api = normalizeApiUrl(apiValue);
    if (!api) {
      return;
    }
    try {
      await fetch(`${api}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
    } finally {
      await loadAuthState(api, setAuthState);
      setDeleteStatus("");
    }
  }

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">本地优先 / 只读审阅 / 可脱敏分享</p>
          <h1 id="hero-title">Agent Snapshots</h1>
          <p className="lede">把 Codex 和 Claude Code 的本地会话整理成可审阅、可导出、可发布的只读快照。</p>
          <div className="hero-stats" aria-label="能力概览">
            <span>
              <b>2</b> agent sources
            </span>
            <span>
              <b>0</b> cloud sync required
            </span>
            <span>
              <b>HTML</b> / Markdown
            </span>
          </div>
          <div className="actions">
            <a className="button primary" id="open-local-viewer" href={viewerUrl} target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">↗</span>
              打开本地查看器
            </a>
            <a className="button" href="https://www.npmjs.com/package/agent-snapshots" target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">pkg</span>
              npm 包
            </a>
            <a className="button" href="https://github.com/ffffhx/agent-snapshots" target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">git</span>
              GitHub 仓库
            </a>
          </div>
        </div>
        <ProductShot />
      </section>

      <section className="public-sessions" aria-labelledby="public-sessions-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">公开 Session</p>
            <h2 id="public-sessions-title">最近发布的分享快照</h2>
          </div>
          <div className="public-session-actions">
            <AuthControls state={authState} onLogin={handleGithubLogin} onLogout={handleGithubLogout} />
            <button
              className="button"
              id="public-sessions-refresh"
              type="button"
              onClick={() => {
                setDeleteStatus("");
                loadAuthState(normalizeApiUrl(apiValue), setAuthState);
                loadPublicSessions(normalizeApiUrl(apiValue), setPublicSessions);
              }}
            >
              <span aria-hidden="true">↻</span>
              刷新
            </button>
          </div>
        </div>
        {deleteStatus ? (
          <p className="public-session-status" role="status">
            {deleteStatus}
          </p>
        ) : null}
        <div className="public-session-grid" id="public-sessions" aria-live="polite">
          <PublicSessions
            state={publicSessions}
            api={normalizeApiUrl(apiValue)}
            authUser={authState.kind === "authenticated" ? authState.user : null}
            deletingShareId={deletingShareId}
            onDelete={handleDeleteShare}
          />
        </div>
      </section>

      <section className="commands" aria-label="运行方式">
        <article className="command-block">
          <div className="command-block-copy">
            <p className="eyebrow">临时审阅 / npm 包</p>
            <h2>不用克隆，直接运行</h2>
            <p>
              这是一次性的本地预览方式：直接通过已发布的 npm 包启动只读查看器，不会安装后台服务。只要这个命令还在运行，浏览器就可以访问
              4321；命令停掉后端口会释放。
            </p>
          </div>
          <div className="command-line large">
            <pre>
              <code>{TEMP_REVIEW_COMMAND}</code>
            </pre>
            <CopyButton command="npx agent-snapshots@latest serve --port 4321">复制 npx 命令</CopyButton>
          </div>
        </article>
        <article className="command-block">
          <div className="command-block-copy">
            <p className="eyebrow">macOS LaunchAgent / npm 包</p>
            <h2>安装成后台常驻</h2>
            <p>
              这是长期使用方式：全局安装 npm 包后注册为用户级后台服务，不需要克隆仓库或安装 pnpm。安装完成后服务会在后台监听
              4321，直到你卸载 daemon 或停止服务。
            </p>
          </div>
          <div className="command-line large">
            <pre>
              <code>{DAEMON_INSTALL_COMMAND}</code>
            </pre>
            <CopyButton command={DAEMON_INSTALL_COMMAND}>复制安装命令</CopyButton>
          </div>
        </article>
      </section>

      <section className="status-grid" aria-label="连接状态">
        <article className="status-panel">
          <div className="panel-heading">
            <p className="eyebrow">本地服务</p>
            <StatusPill id="viewer-status" state={viewerStatus} text={STATUS_LABELS[viewerStatus]} />
          </div>
          <h2>安装后打开本地只读查看器</h2>
          <p>
            官网只负责引导；会话数据仍保留在你的电脑上，并从 <code id="viewer-url-label">{viewerUrl}</code> 读取。
          </p>
          <div className="command-line">
            <pre>
              <code>npx agent-snapshots@latest serve --port 4321</code>
            </pre>
            <CopyButton command="npx agent-snapshots@latest serve --port 4321">复制</CopyButton>
          </div>
        </article>
      </section>
    </main>
  );
}

function ProductShot() {
  return (
    <div className="product-shot" aria-label="Agent Snapshots 产品预览">
      <aside className="shot-sidebar">
        <div className="shot-kicker">Local Agents</div>
        <div className="shot-title">Projects</div>
        <div className="shot-search">搜索项目或对话</div>
        <div className="shot-tabs">
          <span className="active">
            Codex <b>191</b>
          </span>
          <span>
            Claude <b>0</b>
          </span>
        </div>
        <div className="shot-project active">
          <span className="shot-dot"></span>
          <div>
            <b>agent-snapshots</b>
            <small>优化官网和本地查看器</small>
          </div>
          <em>刚刚</em>
        </div>
        <div className="shot-project">
          <span className="shot-dot green"></span>
          <div>
            <b>garden-lab</b>
            <small>评估会话快照拆分</small>
          </div>
          <em>7 小时</em>
        </div>
        <div className="shot-project">
          <span className="shot-dot amber"></span>
          <div>
            <b>coze-monorepo</b>
            <small>定位订阅跳转调用</small>
          </div>
          <em>1 天</em>
        </div>
      </aside>
      <section className="shot-main">
        <div className="shot-topbar">
          <div>
            <div className="shot-kicker">Read-only review</div>
            <div className="shot-heading">优化官网和本地查看器</div>
          </div>
          <div className="shot-switches">
            <span>Tools</span>
            <span>Output</span>
            <span className="on">Redact</span>
          </div>
        </div>
        <div className="shot-meta">
          <span>Codex</span>
          <span>~/Code/agent-snapshots</span>
          <span>7 entries</span>
          <span>redacted: yes</span>
        </div>
        <div className="shot-risk">
          <b>OK</b>
          <span>No common high-risk patterns detected</span>
        </div>
        <div className="shot-bubble user">使用前端设计相关的 skill，优化一下这个项目的官网和本地查看器。</div>
        <div className="shot-bubble assistant">我会先看真实页面，再统一视觉系统、提高信息密度，并用浏览器验证响应式效果。</div>
      </section>
    </div>
  );
}

function StatusPill({ id, state, text }: { id: string; state: StatusState; text: string }) {
  return (
    <span className={`status-pill ${state}`} id={id}>
      {text}
    </span>
  );
}

function CopyButton({ command, children }: { command: string; children: string }) {
  const [label, setLabel] = useState(children);

  async function copyCommand() {
    if (!command) {
      return;
    }

    await navigator.clipboard?.writeText(command).catch(() => undefined);
    setLabel("已复制");
    window.setTimeout(() => {
      setLabel(children);
    }, 1400);
  }

  return (
    <button className="button copy-button" type="button" data-copy-command={command} onClick={copyCommand}>
      {label}
    </button>
  );
}

function AuthControls({
  state,
  onLogin,
  onLogout,
}: {
  state: AuthState;
  onLogin: () => void;
  onLogout: () => void;
}) {
  if (state.kind === "authenticated") {
    return (
      <div className="github-auth" id="github-auth">
        <span className="github-auth-user">
          {state.user.avatarUrl ? <img src={state.user.avatarUrl} alt="" /> : null}
          <span>{state.user.isOwner ? "站长" : "已登录"} @{state.user.login}</span>
        </span>
        <button className="button" type="button" onClick={onLogout}>
          退出
        </button>
      </div>
    );
  }

  if (state.kind === "checking") {
    return (
      <div className="github-auth" id="github-auth">
        <span className="github-auth-note">{state.text}</span>
      </div>
    );
  }

  const disabled = state.kind === "error" || (state.kind === "anonymous" && !state.configured);
  const text = state.kind === "error" ? state.text : state.kind === "anonymous" && !state.configured ? "GitHub 登录未配置" : state.text;

  return (
    <div className="github-auth" id="github-auth">
      <span className="github-auth-note">{text}</span>
      <button className="button primary" type="button" disabled={disabled} onClick={onLogin}>
        登录 GitHub
      </button>
    </div>
  );
}

function PublicSessions({
  state,
  api,
  authUser,
  deletingShareId,
  onDelete,
}: {
  state: PublicSessionsState;
  api: string;
  authUser: AuthUser | null;
  deletingShareId: string;
  onDelete: (share: PublicShare) => void;
}) {
  if (state.kind === "message") {
    return <div className="public-session-empty">{state.text}</div>;
  }

  if (!state.shares.length) {
    return <div className="public-session-empty">暂无公开 Session。</div>;
  }

  return state.shares.map((share) => (
    <PublicSessionCard
      key={share.id}
      share={share}
      api={api}
      canDelete={canDeleteShare(authUser, share)}
      isDeleting={deletingShareId === share.id}
      onDelete={onDelete}
    />
  ));
}

function PublicSessionCard({
  share,
  api,
  canDelete,
  isDeleting,
  onDelete,
}: {
  share: PublicShare;
  api: string;
  canDelete: boolean;
  isDeleting: boolean;
  onDelete: (share: PublicShare) => void;
}) {
  return (
    <article className="public-session-card">
      <a className="public-session-link" href={sharePageUrl(share.id, api)} target="_blank" rel="noopener noreferrer">
        <div className="public-session-top">
          <span className="public-session-engine">{share.engineLabel || share.engine || "Codex"}</span>
          <time dateTime={share.createdAt || ""}>{formatDateLabel(share.createdAt || share.updatedAt)}</time>
        </div>
        <h3>{share.title || share.id}</h3>
        <p className="public-session-meta">
          {Number(share.turnCount || 0)} 条记录 · {(share.redacted ?? true) ? "已脱敏" : "未脱敏"}
        </p>
        {share.owner?.login ? <p className="public-session-owner">by @{share.owner.login}</p> : null}
      </a>
      {canDelete ? (
        <button
          className="public-session-delete"
          type="button"
          disabled={isDeleting}
          aria-label={`删除分享快照：${share.title || share.id}`}
          title="删除分享快照"
          onClick={() => onDelete(share)}
        >
          {isDeleting ? "删除中" : "删除"}
        </button>
      ) : null}
    </article>
  );
}

async function checkViewer(url: string, setViewerStatus: (state: StatusState) => void) {
  setViewerStatus("checking");

  try {
    await fetch(url, {
      cache: "no-store",
      mode: "no-cors",
      signal: timeoutSignal(2500),
    });
    setViewerStatus("ready");
  } catch {
    setViewerStatus("error");
  }
}

async function loadAuthState(url: string, setAuthState: (state: AuthState) => void) {
  if (!url) {
    setAuthState({
      kind: "anonymous",
      configured: false,
      text: "GitHub 登录未配置",
    });
    return;
  }

  setAuthState({
    kind: "checking",
    text: "正在检查 GitHub 登录...",
  });

  try {
    const response = await fetch(`${url}/api/auth/me?returnTo=${encodeURIComponent(window.location.href)}`, {
      cache: "no-store",
      credentials: "include",
      signal: timeoutSignal(3000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      configured?: boolean;
      loginUrl?: string | null;
      user?: AuthUser | null;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    if (payload.user) {
      setAuthState({
        kind: "authenticated",
        configured: true,
        user: payload.user,
      });
      return;
    }

    setAuthState({
      kind: "anonymous",
      configured: Boolean(payload.configured),
      loginUrl: payload.loginUrl,
      text: payload.configured ? "登录后可发布和管理自己的 Session" : "GitHub 登录未配置",
    });
  } catch {
    setAuthState({
      kind: "error",
      text: "登录状态不可用",
    });
  }
}

async function loadPublicSessions(url: string, setPublicSessions: (state: PublicSessionsState) => void) {
  if (!url) {
    setPublicSessions({
      kind: "message",
      text: "公开分享 API 尚未配置。",
    });
    return;
  }

  setPublicSessions({
    kind: "message",
    text: "正在加载公开 Session...",
  });

  try {
    const response = await fetch(`${url}/api/snapshots?limit=12`, {
      cache: "no-store",
      signal: timeoutSignal(3500),
    });
    const payload = (await response.json().catch(() => ({}))) as { shares?: unknown; error?: string };

    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    const shares = Array.isArray(payload.shares) ? payload.shares.filter((share): share is PublicShare => Boolean(share && typeof share === "object" && "id" in share)) : [];
    setPublicSessions({
      kind: "shares",
      shares,
    });
  } catch {
    setPublicSessions({
      kind: "message",
      text: "分享 API 暂不可用，稍后再试。",
    });
  }
}

function canDeleteShare(user: AuthUser | null, share: PublicShare): boolean {
  if (!user) {
    return false;
  }
  if (user.isOwner) {
    return true;
  }
  if (share.owner?.id && user.id && share.owner.id === user.id) {
    return true;
  }
  return Boolean(share.owner?.login && user.login && share.owner.login.toLowerCase() === user.login.toLowerCase());
}

function sharePageUrl(id: string, api: string): string {
  const target = new URL("./share/index.html", window.location.href);
  target.searchParams.set("id", id);
  target.searchParams.set("api", api);
  return target.toString();
}

function formatDateLabel(value: string | undefined): string {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) {
    return "未知时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
