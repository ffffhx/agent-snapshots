// @ts-nocheck
import { MUTATION_CSRF_HEADER } from "./local-security.js";
export function renderServerApp(csrfToken, shareConfig = {}) {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Snapshots</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>${serverCss()}</style>
</head>
<body>
  <main class="app">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="brand">
          <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#c33f28"/><g transform="rotate(-5 32 32)"><rect x="18.5" y="16" width="27" height="33" rx="3" fill="#5c160c" opacity="0.22"/><rect x="18.5" y="15" width="27" height="33" rx="3" fill="#f6ecd6"/><g fill="#c9bb98"><rect x="22.5" y="21" width="19" height="2" rx="1"/><rect x="22.5" y="25.5" width="17" height="2" rx="1"/><rect x="22.5" y="30" width="19" height="2" rx="1"/><rect x="22.5" y="34.5" width="13.5" height="2" rx="1"/></g><circle cx="40.5" cy="42.5" r="6.2" fill="#a82f1c"/><circle cx="40.5" cy="42.5" r="6.2" fill="none" stroke="#fff3df" stroke-width="0.9" stroke-opacity="0.85"/><circle cx="40.5" cy="42.5" r="1.4" fill="#fff3df"/></g></svg>
          <div class="brand-wm"><b>Codex Snapshots</b><span>Read-only archive</span></div>
        </div>
        <div class="toolbar">
          <button id="openSearch" class="search-entry" type="button" title="搜索会话正文">
            <span>搜索会话正文</span>
            <kbd>⌘K</kbd>
          </button>
          <button id="openStats" type="button" title="使用与 token 统计">统计</button>
          <button id="reload" type="button" title="刷新会话列表">刷新</button>
        </div>
      </div>
      <div id="sessions" class="sessions"></div>
    </aside>
    <div id="splitter" class="splitter" role="separator" aria-label="调整项目列表宽度" aria-orientation="vertical" aria-valuemin="240" aria-valuemax="460" aria-valuenow="0" tabindex="0"></div>
    <section class="viewer">
      <div class="masthead">
        <div class="mh-row">
          <h2 id="title">选择一个会话</h2>
          <div class="switches">
            <label title="自动脱敏常见敏感内容"><input id="redact" type="checkbox" checked> 脱敏</label>
          </div>
          <div class="appearance" role="group" aria-label="外观设置">
            <div class="appx-seg" role="group" aria-label="主题">
              <button class="appx" type="button" data-theme-set="light" title="纸（浅色）">纸</button>
              <button class="appx" type="button" data-theme-set="sepia" title="褐（护眼）">褐</button>
              <button class="appx" type="button" data-theme-set="dark" title="暗（深色）">暗</button>
            </div>
            <div class="appx-seg" role="group" aria-label="正文字号">
              <button class="appx" type="button" data-font-step="-1" title="缩小正文字号">A－</button>
              <button class="appx" type="button" data-font-step="1" title="放大正文字号">A＋</button>
            </div>
            <button class="appx" type="button" data-density-toggle title="切换阅读密度（宽松/紧凑）">密</button>
          </div>
          <div id="exports" class="exports"></div>
        </div>
        <div id="meta" class="meta empty">还没有选择会话。</div>
        <div id="sessionSearch" class="session-search">
          <div class="session-search-bar">
            <input id="sessionSearchInput" type="search" placeholder="在当前 Session 里搜大意" disabled>
            <button id="sessionSearchRun" type="button" disabled>语义搜索</button>
            <span id="sessionSearchStatus" class="session-search-status"></span>
          </div>
          <div id="sessionSearchResults" class="session-search-results"></div>
        </div>
      </div>
      <div id="goal" class="goal"></div>
      <div id="risks" class="risks"></div>
      <div id="turns" class="turns"></div>
    </section>
  </main>
  <div id="searchOverlay" class="search-overlay" hidden>
    <section class="search-dialog" role="dialog" aria-modal="true" aria-labelledby="searchTitle">
      <div class="search-bar">
        <div>
          <p class="eyebrow">Session search</p>
          <h2 id="searchTitle">搜索会话正文</h2>
        </div>
        <button id="closeSearch" class="search-close" type="button" title="关闭搜索">关闭</button>
      </div>
      <input id="globalSearch" class="global-search-input" type="search" placeholder="关键词，可加 source: role: project: before: after: -排除" title="支持过滤语法：source:codex/claude、role:user/assistant、project:名称、before:2026-01-01、after:2026-01-01、-排除词" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="searchResults" autocomplete="off" spellcheck="false">
      <div class="search-controls" role="group" aria-label="搜索范围">
        <button class="search-mode active" type="button" data-search-mode="keyword">关键词</button>
        <button class="search-mode" type="button" data-search-mode="semantic">语义</button>
        <button class="search-flag" type="button" data-search-flag="caseSensitive" aria-pressed="false" title="区分大小写">Aa</button>
        <button class="search-flag" type="button" data-search-flag="wholeWord" aria-pressed="false" title="整词匹配">词</button>
        <span id="searchScopeLabel" class="search-scope-label">全部历史</span>
        <button id="prewarmIndex" class="search-prewarm" type="button" title="提前生成语义索引">预热索引</button>
        <span id="searchStatus" class="search-status"></span>
      </div>
      <div id="searchFacets" class="search-facets" aria-label="按来源和项目筛选"></div>
      <div id="searchResults" class="search-results" role="listbox" aria-label="搜索结果"></div>
      <div class="search-foot">
        <span class="search-hints"><kbd>↑</kbd><kbd>↓</kbd> 导航 · <kbd>↵</kbd> 打开 · <kbd>Tab</kbd> 切换关键词/语义 · <kbd>esc</kbd> 关闭</span>
        <span id="searchCount" class="search-count"></span>
      </div>
    </section>
  </div>
  <div id="statsOverlay" class="stats-overlay" hidden>
    <section class="stats-dialog" role="dialog" aria-modal="true" aria-labelledby="statsTitle">
      <div class="stats-bar">
        <div>
          <p class="eyebrow">Usage &amp; tokens</p>
          <h2 id="statsTitle">使用统计</h2>
        </div>
        <div class="stats-bar-actions">
          <button id="statsRefresh" class="stats-refresh" type="button" title="刷新统计">刷新</button>
          <button id="closeStats" class="search-close" type="button" title="关闭">关闭</button>
        </div>
      </div>
      <div id="statsBody" class="stats-body"></div>
    </section>
  </div>
  <div id="toast" class="toast" hidden></div>
  <script>window.CODEX_SNAPSHOT_SHARE_CONFIG=${inlineJson(shareConfig || {})}; window.CODEX_SNAPSHOT_CSRF_TOKEN=${inlineJson(csrfToken)};</script>
  <script>${serverJs()}</script>
</body>
</html>`;
}
function inlineJson(value) {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
        if (char === "<")
            return "\\u003c";
        if (char === ">")
            return "\\u003e";
        if (char === "&")
            return "\\u0026";
        if (char === "\u2028")
            return "\\u2028";
        return "\\u2029";
    });
}
function serverCss() {
    return `
:root {
  --ink: #211b10;
  --ink-soft: #4a4030;
  --muted: #857862;
  --soft: #a99c84;
  --faint: #a99c84;
  --paper: #f3eee1;
  --paper-deep: #ece4d0;
  --panel: #fbf7ec;
  --panel-2: #f6f0e1;
  --panel-wash: rgba(251, 247, 236, 0.86);
  --line: rgba(33, 27, 16, 0.10);
  --line-2: rgba(33, 27, 16, 0.16);
  --hairline: rgba(33, 27, 16, 0.12);
  --seal: #b1382a;
  --seal-deep: #8c2b1f;
  --seal-soft: rgba(177, 56, 42, 0.10);
  --pine: #2f5d49;
  --pine-soft: rgba(47, 93, 73, 0.10);
  --amber: #9a6a1b;
  --amber-soft: rgba(160, 112, 30, 0.12);
  --blue: #8c2b1f;
  --teal: #2f5d49;
  --green: #2f5d49;
  --red: #b1382a;
  --focus: #b1382a;
  --code-bg: #211b12;
  --code-line: #3a3322;
  --code-ink: #efe7d4;
  --sidebar-width: clamp(280px, 22vw, 330px);
  --splitter-width: 12px;
  --serif: ui-serif, "New York", "Iowan Old Style", Palatino, "Songti SC", "Noto Serif SC", Georgia, serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Avenir Next", "Segoe UI", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif;
  --shadow-soft: 0 18px 44px -38px rgba(64, 44, 14, 0.5);
  --shadow-panel: 0 28px 70px -50px rgba(64, 44, 14, 0.6);
  /* Themeable surfaces (retrofitted so dark/sepia stay coherent). */
  --masthead-bg: linear-gradient(180deg, var(--paper) 82%, rgba(243, 238, 225, 0.88));
  --field-bg: rgba(251, 247, 236, 0.72);
  --field-bg-hover: rgba(253, 247, 234, 0.94);
  --result-active-bg: #fdf7ea;
  --user-card-bg: linear-gradient(180deg, #fbf4e2, #f6edd7);
  --user-card-border: rgba(160, 112, 30, 0.26);
  --tool-card-bg: rgba(250, 243, 224, 0.5);
  --read-scale: 1;
  color-scheme: light;
}
html[data-theme="sepia"] {
  --ink: #3a2f1d;
  --ink-soft: #574833;
  --muted: #8a795d;
  --soft: #a3906f;
  --faint: #a3906f;
  --paper: #efe2c8;
  --paper-deep: #e6d6b6;
  --panel: #f6ebd4;
  --panel-2: #f0e3c8;
  --panel-wash: rgba(246, 235, 212, 0.88);
  --line: rgba(58, 47, 29, 0.12);
  --line-2: rgba(58, 47, 29, 0.2);
  --hairline: rgba(58, 47, 29, 0.14);
  --masthead-bg: linear-gradient(180deg, var(--paper) 82%, rgba(230, 214, 182, 0.9));
  --field-bg: rgba(246, 235, 212, 0.75);
  --field-bg-hover: rgba(249, 240, 220, 0.96);
  --result-active-bg: #f6ecd2;
  --user-card-bg: linear-gradient(180deg, #f4e7c6, #eeddb8);
  --tool-card-bg: rgba(240, 227, 200, 0.55);
  color-scheme: light;
}
html[data-theme="dark"] {
  --ink: #ece3d0;
  --ink-soft: #cebf9f;
  --muted: #9c8f74;
  --soft: #837657;
  --faint: #837657;
  --paper: #17130c;
  --paper-deep: #100d08;
  --panel: #221b11;
  --panel-2: #1c160d;
  --panel-wash: rgba(34, 27, 17, 0.86);
  --line: rgba(233, 220, 196, 0.11);
  --line-2: rgba(233, 220, 196, 0.19);
  --hairline: rgba(233, 220, 196, 0.14);
  --seal: #d24c37;
  --seal-deep: #b23a2b;
  --seal-soft: rgba(210, 76, 55, 0.16);
  --pine: #5aa383;
  --pine-soft: rgba(90, 163, 131, 0.14);
  --amber: #c79242;
  --amber-soft: rgba(199, 146, 66, 0.16);
  --red: #d24c37;
  --focus: #d24c37;
  --code-bg: #100d07;
  --code-line: #2c2417;
  --code-ink: #efe7d4;
  --masthead-bg: linear-gradient(180deg, var(--paper) 82%, rgba(16, 13, 8, 0.9));
  --field-bg: rgba(233, 220, 196, 0.05);
  --field-bg-hover: rgba(233, 220, 196, 0.09);
  --result-active-bg: rgba(210, 76, 55, 0.12);
  --user-card-bg: linear-gradient(180deg, #2a2114, #241b10);
  --user-card-border: rgba(199, 146, 66, 0.28);
  --tool-card-bg: rgba(233, 220, 196, 0.04);
  --tool-card-border: rgba(199, 146, 66, 0.34);
  --shadow-soft: 0 18px 44px -38px rgba(0, 0, 0, 0.7);
  --shadow-panel: 0 28px 70px -50px rgba(0, 0, 0, 0.8);
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { height: 100%; overflow: hidden; }
body {
  height: 100%;
  margin: 0;
  overflow: hidden;
  color: var(--ink);
  background:
    radial-gradient(120% 80% at 50% -18%, rgba(177, 56, 42, 0.05), transparent 60%),
    radial-gradient(100% 70% at 0% 120%, rgba(47, 93, 73, 0.05), transparent 55%),
    var(--paper);
  font-family: var(--sans);
  font-size: 15px;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.5;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='.035'/%3E%3C/svg%3E");
}
::selection { background: rgba(177, 56, 42, 0.2); }
.sidebar, .viewer, .search-results {
  scrollbar-width: thin;
  scrollbar-color: rgba(33, 27, 16, 0.26) transparent;
}
::-webkit-scrollbar { width: 11px; height: 11px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 99px;
  background: rgba(33, 27, 16, 0.22);
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background-color: rgba(33, 27, 16, 0.4); }
.app {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: var(--sidebar-width) var(--splitter-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}
.app.resizing, .app.resizing * { cursor: col-resize; user-select: none; }

/* ---------- 侧栏 ---------- */
.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: linear-gradient(180deg, rgba(33, 27, 16, 0.025), transparent 240px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  border-right: 1px solid var(--line);
}
.sidebar-top {
  position: sticky;
  top: 0;
  z-index: 6;
  flex: 0 0 auto;
  padding: 18px 18px 14px;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 11px; margin-bottom: 16px; }
.brand .brand-mark {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 8px;
  box-shadow: 0 6px 18px -10px rgba(80, 40, 10, 0.5);
}
.brand .brand-wm { display: flex; flex-direction: column; gap: 3px; line-height: 1; min-width: 0; }
.brand .brand-wm b { font: 600 16px/1 var(--serif); letter-spacing: 0.01em; color: var(--ink); }
.brand .brand-wm span { font: 600 8.5px/1 var(--mono); letter-spacing: 0.2em; text-transform: uppercase; color: var(--seal); }
.eyebrow {
  margin: 0 0 6px;
  color: var(--seal);
  font: 700 9.5px/1 var(--mono);
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
h1, h2 { margin: 0; letter-spacing: 0; font-family: var(--serif); }
.toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; }
input[type="search"] {
  min-width: 0;
  height: 38px;
  border: 1px solid var(--line-2);
  border-radius: 9px;
  background: var(--panel);
  padding: 0 13px;
  color: var(--ink);
  font: 500 13px/1 var(--sans);
  outline: 0;
}
input[type="search"]::placeholder { color: var(--faint); }
input[type="search"]:focus {
  border-color: var(--seal);
  box-shadow: 0 0 0 3px rgba(177, 56, 42, 0.13);
}
.search-entry {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--line-2);
  border-radius: 9px;
  background: var(--panel);
  color: var(--muted);
  padding: 0 10px 0 13px;
  font-family: var(--sans);
  letter-spacing: 0;
  text-align: left;
}
.search-entry span {
  min-width: 0;
  overflow: hidden;
  color: var(--faint);
  font: 500 13px/1 var(--sans);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-entry kbd {
  flex: 0 0 auto;
  min-width: 36px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: rgba(33, 27, 16, 0.035);
  color: var(--muted);
  padding: 5px 7px;
  font: 700 11px/1 var(--mono);
  text-align: center;
}
.search-entry:hover { border-color: var(--seal); background: var(--panel); color: var(--seal); transform: none; }
.search-entry:hover span, .search-entry:hover kbd { color: var(--seal); }
button, .exports a {
  min-height: 38px;
  border: 1px solid var(--ink);
  border-radius: 9px;
  background: var(--ink);
  color: var(--paper);
  padding: 0 14px;
  font: 600 12px/1 var(--mono);
  letter-spacing: 0.04em;
  text-decoration: none;
  cursor: pointer;
  transition: background 130ms ease, color 130ms ease, border-color 130ms ease, transform 130ms ease, box-shadow 130ms ease;
}
button:hover, .exports a:hover {
  border-color: var(--seal-deep);
  background: var(--seal-deep);
  color: #fdf3ec;
  transform: translateY(-1px);
}
button:focus-visible, .exports a:focus-visible, .source-tab:focus-visible,
.session:focus-visible, .project-more:focus-visible, .sessions-load-more:focus-visible,
.search-result:focus-visible, .search-mode:focus-visible, .search-prewarm:focus-visible, .project-header:focus-visible, .project-search:focus-visible,
.session-search-result:focus-visible {
  outline: 2px solid rgba(177, 56, 42, 0.55);
  outline-offset: 2px;
}
button:disabled { cursor: wait; opacity: 0.55; transform: none; box-shadow: none; }
.loading-state {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel-wash);
  color: var(--muted);
  padding: 12px;
  font: 600 12px/1.3 var(--mono);
  box-shadow: var(--shadow-soft);
}
.turns > .loading-state { justify-self: center; justify-content: center; width: min(460px, 100%); min-height: 90px; margin-top: 40px; }
.loading-spinner {
  width: 16px; height: 16px; flex: 0 0 auto;
  border: 2px solid rgba(33, 27, 16, 0.16);
  border-top-color: var(--seal);
  border-radius: 999px;
  animation: snapshot-spin 0.8s linear infinite;
}
@keyframes snapshot-spin { to { transform: rotate(360deg); } }
@keyframes turn-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.sessions {
  display: grid;
  flex: 1 1 auto;
  gap: 2px;
  align-content: start;
  min-height: 0;
  padding: 8px 12px 24px;
}
.sessions.sessions-loading { align-content: center; padding-top: 0; }
.sessions.sessions-loading > .loading-state { justify-content: center; min-height: 86px; margin: 14px; }
.source-switcher {
  position: sticky;
  top: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
  margin: 4px 2px 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(33, 27, 16, 0.03);
  padding: 3px;
}
.source-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 30px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  padding: 0 8px;
  font: 700 10.5px/1 var(--mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.source-tab:hover { background: rgba(33, 27, 16, 0.05); color: var(--ink); transform: none; }
.source-tab.active { background: var(--ink); color: var(--paper); box-shadow: 0 4px 12px -6px rgba(33, 27, 16, 0.6); }
.source-tab span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-tab b { color: var(--faint); font: inherit; font-weight: 700; }
.source-tab.active b { color: #e6b9ad; }
.source-empty { margin-left: 28px; color: var(--faint); font: 500 12px/1.4 var(--mono); padding: 4px 0; }
.project-group { display: grid; gap: 2px; margin-top: 8px; }
.project-headline {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px;
  align-items: center;
}
.project-header {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  width: 100%;
  min-height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-soft);
  padding: 4px 8px;
  text-align: left;
  font: 600 15px/1.15 var(--serif);
  letter-spacing: 0.01em;
  cursor: pointer;
}
.project-header:hover { background: rgba(33, 27, 16, 0.045); color: var(--ink); transform: none; }
.project-group.collapsed .project-header { color: var(--muted); }
.project-search {
  min-width: 48px;
  min-height: 28px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--field-bg);
  color: var(--faint);
  padding: 0 8px;
  font: 700 11px/1 var(--mono);
  letter-spacing: 0;
}
.project-search:hover {
  border-color: var(--line-2);
  background: rgba(33, 27, 16, 0.055);
  color: var(--seal);
  transform: none;
}
.project-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-count { color: var(--faint); font: 600 11px/1 var(--mono); }
.project-icon {
  position: relative;
  display: inline-block;
  width: 16px; height: 12px;
  border: 1.5px solid currentColor;
  border-radius: 2px;
  opacity: 0.6;
}
.project-icon::before {
  position: absolute; top: -5px; left: 1px;
  width: 7px; height: 4px;
  border: 1.5px solid currentColor; border-bottom: 0; border-radius: 2px 2px 0 0;
  content: "";
}
.session-list { display: grid; gap: 1px; margin: 2px 0 2px 8px; padding-left: 14px; border-left: 1px solid var(--line); }
.session {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  min-height: 36px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  padding: 8px 11px;
  text-align: left;
  font-family: var(--sans);
}
.session::before {
  position: absolute; inset: 9px auto 9px -15px;
  width: 2px; border-radius: 2px; background: transparent; content: "";
}
.session:hover { background: rgba(33, 27, 16, 0.045); transform: none; }
.session.active { background: var(--seal-soft); }
.session.active::before { background: var(--seal); }
.session strong {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: 500 13.5px/1.3 var(--sans);
}
.session.active strong { font-weight: 600; }
.session-time { color: var(--faint); font: 600 10.5px/1 var(--mono); white-space: nowrap; }
.session-badge {
  border: 1px solid rgba(177, 56, 42, 0.42);
  border-radius: 3px;
  background: transparent;
  color: var(--seal);
  padding: 3px 5px;
  font: 700 9px/1 var(--mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}
.project-more {
  justify-self: start;
  min-height: 28px;
  margin-left: 22px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--faint);
  padding: 4px 10px;
  font: 600 11px/1 var(--mono);
}
.project-more:hover { color: var(--seal); background: var(--seal-soft); transform: none; }
.project-note { margin-left: 30px; color: var(--faint); font: 500 11px/1.45 var(--mono); padding: 2px 0; }
.load-more-row { display: grid; gap: 8px; margin: 6px 2px 0; }
.sessions-load-more {
  width: 100%; min-height: 38px;
  border: 1px dashed rgba(33, 27, 16, 0.3);
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
}
.sessions-load-more:hover { border-style: solid; border-color: var(--seal); background: var(--seal-soft); color: var(--seal-deep); transform: none; }
.sessions-load-more:disabled { background: rgba(33, 27, 16, 0.04); }
.load-more-meta { color: var(--faint); font: 500 11px/1.4 var(--mono); padding-left: 2px; }
.load-more-error { color: var(--red); }

/* ---------- 分隔条 ---------- */
.splitter {
  position: relative;
  min-width: var(--splitter-width);
  min-height: 0;
  border: 0;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
  z-index: 8;
}
.splitter::before {
  position: absolute; inset: 0 auto 0 50%;
  width: 1px; background: var(--line); content: ""; transform: translateX(-50%);
}
.splitter::after {
  position: absolute; top: 50%; left: 50%;
  width: 6px; height: 64px;
  border: 1px solid rgba(33, 27, 16, 0.26); border-radius: 999px; background: var(--panel);
  content: ""; opacity: 0; transform: translate(-50%, -50%);
  transition: opacity 120ms ease;
}
.splitter:hover::after, .splitter:focus-visible::after, .app.resizing .splitter::after { border-color: var(--seal); opacity: 1; }
.splitter:focus-visible { outline: 2px solid rgba(177, 56, 42, 0.45); outline-offset: -2px; }

/* ---------- 阅读区 ---------- */
.viewer {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.masthead {
  position: sticky;
  top: 0;
  z-index: 5;
  flex: 0 0 auto;
  padding: 11px clamp(20px, 2.2vw, 40px) 10px;
  background: var(--masthead-bg);
  backdrop-filter: blur(4px);
  border-bottom: 1px solid var(--line);
}
.mh-row { display: flex; align-items: center; gap: 16px; }
.mh-row h2 {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  font: 600 24px/1.18 var(--serif);
  letter-spacing: 0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mh-row h2::before {
  content: "";
  flex: 0 0 auto;
  width: 4px; height: 20px;
  border-radius: 2px;
  background: var(--seal);
}
.switches { display: inline-flex; flex: 0 0 auto; gap: 2px; padding: 3px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--panel); }
.switches label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  border-radius: 6px;
  padding: 0 10px;
  color: var(--muted);
  font: 600 11px/1 var(--mono);
  letter-spacing: 0.04em;
  cursor: pointer;
  user-select: none;
  transition: background 120ms ease, color 120ms ease;
}
.switches label:hover { color: var(--ink); }
.switches input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.switches label:has(input:checked) { background: var(--seal); color: #fdf3ec; }
.appearance { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; padding: 3px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--panel); }
.appx-seg { display: inline-flex; gap: 2px; }
.appx {
  min-height: 28px; min-width: 28px;
  border: 0; border-radius: 6px;
  background: transparent; color: var(--muted);
  padding: 0 8px;
  font: 700 11px/1 var(--mono); letter-spacing: 0.02em;
}
.appx:hover { background: rgba(127, 110, 80, 0.16); color: var(--ink); transform: none; }
.appx.active { background: var(--ink); color: var(--paper); }
.appx:focus-visible { outline: 2px solid rgba(177, 56, 42, 0.55); outline-offset: 2px; }
.exports { display: inline-flex; flex: 0 0 auto; flex-wrap: wrap; gap: 8px; align-items: center; }
.exports a, .exports button {
  display: inline-flex; min-height: 34px; align-items: center;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0 12px;
  font: 600 11.5px/1 var(--mono);
  letter-spacing: 0.03em;
}
.exports a:hover, .exports button:hover { border-color: var(--seal); background: transparent; color: var(--seal-deep); transform: translateY(-1px); }
.exports button[data-publish-cloud] { border-color: var(--ink); background: var(--ink); color: var(--paper); }
.exports button[data-publish-cloud]:hover { border-color: var(--seal-deep); background: var(--seal-deep); color: #fdf3ec; }
.publish-status {
  display: inline-flex; align-items: center; flex-basis: 100%;
  min-height: 22px; max-width: 100%;
  overflow-wrap: anywhere; color: var(--muted);
  font: 600 11.5px/1.35 var(--mono);
}
.publish-status:empty { display: none; }
.publish-status a { color: var(--seal-deep); text-decoration: underline; text-underline-offset: 3px; }
.publish-status.error { color: var(--red); }
.publish-status.warning { color: var(--amber); }
/* dossier 元信息行 */
.meta { margin-top: 8px; }
.meta.empty { color: var(--muted); font: 600 12px/1.5 var(--mono); }
.meta.loading { display: none; }
.dossier { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; font: 600 11.5px/1.5 var(--mono); color: var(--muted); }
.dossier .sep { color: var(--line-2); }
.dossier b { color: var(--ink-soft); font-weight: 700; }
.dossier .k { color: var(--faint); font-weight: 600; }
.dossier .ro { color: var(--seal); font: 700 9.5px/1 var(--mono); letter-spacing: 0.14em; text-transform: uppercase; }
.dossier .tag { display: inline-flex; align-items: center; gap: 5px; color: var(--pine); }
.dossier .tag .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--pine); }

.session-search {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.session-search-bar {
  display: grid;
  grid-template-columns: minmax(180px, 420px) auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
.session-search input {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--field-bg);
  color: var(--ink);
  padding: 0 12px;
  font: 500 13px/1.2 var(--sans);
}
.session-search input:focus {
  outline: 2px solid rgba(177, 56, 42, 0.24);
  border-color: rgba(177, 56, 42, 0.48);
  background: var(--panel);
}
.session-search input:disabled {
  border-color: var(--line);
  background: rgba(33, 27, 16, 0.03);
  color: var(--faint);
}
.session-search button {
  min-height: 34px;
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper);
  padding: 0 12px;
  font-size: 11.5px;
}
.session-search button:hover { border-color: var(--seal-deep); background: var(--seal-deep); color: #fdf3ec; }
.session-search button:disabled { border-color: var(--line); background: rgba(33, 27, 16, 0.05); color: var(--faint); }
.session-search-status {
  min-width: 0;
  overflow: hidden;
  color: var(--faint);
  font: 600 11px/1.35 var(--mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-search-results {
  display: grid;
  gap: 7px;
  align-content: start;
  max-width: 820px;
}
.session-search-results:empty { display: none; }
.session-search-result {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px 12px;
  width: 100%;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--field-bg);
  color: inherit;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  transition: background 130ms ease, border-color 130ms ease;
}
.session-search-result:hover {
  border-color: rgba(177, 56, 42, 0.42);
  background: var(--field-bg-hover);
  transform: none;
}
.session-search-result b {
  min-width: 0;
  color: var(--ink);
  font: 700 11px/1.2 var(--mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.session-search-result em {
  color: var(--seal);
  font: 700 11px/1.2 var(--mono);
  font-style: normal;
}
.session-search-result span {
  display: -webkit-box;
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--ink-soft);
  font: 400 13px/1.5 var(--sans);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.semantic-hit-current .message-card,
.semantic-hit-current.process-entry {
  outline: 2px solid rgba(177, 56, 42, 0.42);
  outline-offset: 5px;
  border-radius: 10px;
}
@media (max-width: 760px) {
  .session-search-bar { grid-template-columns: 1fr; }
  .session-search-status { white-space: normal; }
}

/* 目标 callout */
.goal:empty { display: none; }
.goal {
  margin: 14px clamp(20px, 2.2vw, 40px) 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 14px;
  align-items: start;
  padding: 13px 18px;
  border-radius: 12px;
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  border: 1px solid var(--line);
}
.goal::before { content: ""; grid-row: 1 / 3; width: 3px; align-self: stretch; border-radius: 2px; background: var(--seal); }
.goal b { color: var(--seal); font: 700 9.5px/1 var(--mono); letter-spacing: 0.16em; text-transform: uppercase; padding-top: 3px; }
.goal span { margin: 0; font: 400 15px/1.6 var(--serif); color: var(--ink-soft); overflow-wrap: anywhere; white-space: pre-wrap; }

/* 风险 / 通知 */
.risks { display: grid; gap: 8px; margin: 12px clamp(20px, 2.2vw, 40px) 0; }
.risks:empty { display: none; }
.notice {
  display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px; align-items: center;
  border: 1px solid rgba(160, 112, 30, 0.28); border-left: 4px solid var(--amber);
  border-radius: 10px; background: var(--amber-soft); padding: 10px 13px;
}
.notice b { color: var(--amber); font: 700 11px/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; }
.notice span { overflow-wrap: anywhere; font-size: 13px; }
.risk {
  display: grid; grid-template-columns: 64px minmax(160px, 0.6fr) minmax(0, 1.4fr); gap: 10px; align-items: start;
  border: 1px solid rgba(47, 93, 73, 0.26); border-left: 4px solid var(--green);
  border-radius: 10px; background: var(--pine-soft); padding: 11px 13px;
}
.risk.high { border-color: rgba(177, 56, 42, 0.32); border-left-color: var(--red); background: var(--seal-soft); }
.risk.medium { border-color: rgba(160, 112, 30, 0.3); border-left-color: var(--amber); background: var(--amber-soft); }
.risk b, .risk span, .risk em { min-width: 0; }
.risk b { font: 700 11px/1.3 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--green); }
.risk.high b { color: var(--red); }
.risk.medium b { color: var(--amber); }
.risk span { line-height: 1.4; font-size: 13px; }
.risk em { color: var(--muted); font-style: normal; font-size: 12.5px; line-height: 1.4; overflow-wrap: anywhere; }

/* ---------- 对话 ---------- */
.turns {
  display: grid;
  gap: 30px;
  width: min(1260px, 100%);
  margin: 0 auto;
  padding: 18px clamp(20px, 2.2vw, 38px) 80px;
  zoom: var(--read-scale, 1);
}
html[data-density="compact"] .turns { gap: 18px; }
html[data-density="compact"] .user .message-card { padding: 10px 15px; }
html[data-density="compact"] .tool .message-card { padding: 10px 14px; }
html[data-density="compact"] .sessions { gap: 1px; }
.turn { display: flex; min-width: 0; animation: turn-rise 0.45s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
.turns > :nth-child(1) { animation-delay: 30ms; }
.turns > :nth-child(2) { animation-delay: 70ms; }
.turns > :nth-child(3) { animation-delay: 110ms; }
.turns > :nth-child(4) { animation-delay: 150ms; }
.turns > :nth-child(5) { animation-delay: 190ms; }
.turns > :nth-child(6) { animation-delay: 230ms; }
.user { justify-content: flex-end; }
.assistant, .tool, .process { justify-content: flex-start; }
.interrupt { justify-content: center; }
.message-card { min-width: 0; max-width: min(1180px, 100%); border: 0; background: transparent; padding: 0; box-shadow: none; }
.user .message-card {
  max-width: min(1180px, 74%);
  padding: 14px 19px;
  border-radius: 14px 14px 4px 14px;
  border: 1px solid var(--user-card-border);
  background: var(--user-card-bg);
  box-shadow: 0 18px 40px -34px rgba(120, 80, 20, 0.55);
}
.assistant .message-card { max-width: min(1000px, 100%); }
.tool .message-card {
  max-width: min(1080px, 100%);
  border: 1px dashed var(--tool-card-border, rgba(160, 112, 30, 0.5));
  border-radius: 10px;
  background: var(--tool-card-bg);
  padding: 14px 18px;
}
.turn-meta { margin-bottom: 9px; color: var(--faint); font: 700 9.5px/1.3 var(--mono); letter-spacing: 0.16em; text-transform: uppercase; }
.turn-meta span { font-weight: 500; }
.turn-notice {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px dashed rgba(33, 27, 16, 0.3); border-radius: 999px;
  background: rgba(33, 27, 16, 0.04); color: var(--soft);
  padding: 7px 15px; font: 600 11px/1.3 var(--mono); letter-spacing: 0.08em;
}
.turn-notice span[aria-hidden] { font-size: 10px; }
.process-details { width: min(1000px, 100%); border-top: 1px solid var(--line); color: var(--muted); }
.process-summary {
  display: inline-flex; align-items: center; gap: 9px; min-height: 42px;
  cursor: pointer; list-style: none; user-select: none;
  font: 600 13px/1.3 var(--mono); letter-spacing: 0.05em;
  transition: color 130ms ease;
}
.process-summary:hover { color: var(--seal-deep); }
.process-summary::-webkit-details-marker { display: none; }
.process-summary::after {
  width: 7px; height: 7px;
  border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  content: ""; transform: translateY(-2px) rotate(45deg); transition: transform 0.16s ease;
}
.process-details[open] .process-summary::after { transform: translateY(2px) rotate(225deg); }
.process-body { display: grid; gap: 24px; padding: 6px 0 8px; }
.process-entry { min-width: 0; }
.process-entry .body { color: var(--ink-soft); font-size: 16px; }
.process-tool { max-width: min(960px, 100%); border-left: 3px solid rgba(160, 112, 30, 0.4); padding-left: 12px; }
.tool-details { min-width: 0; }
.tool-details summary {
  cursor: pointer; color: var(--amber);
  font: 700 11.5px/1.4 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; user-select: none;
}
.tool-details summary:hover { color: var(--seal-deep); }
.tool-details[open] summary { margin-bottom: 8px; }
.subagents { width: min(1000px, 100%); margin-top: 36px; border-top: 2px solid var(--line); padding-top: 18px; display: grid; gap: 10px; }
.subagents-head { font: 700 12px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.subagents-count { color: var(--faint); }
.subagent { border: 1px solid var(--line); border-radius: 10px; background: rgba(33, 27, 16, 0.02); overflow: hidden; }
.subagent > .subagent-summary {
  cursor: pointer; user-select: none; list-style: none;
  display: flex; align-items: baseline; gap: 12px; justify-content: space-between;
  padding: 12px 16px; color: var(--ink);
}
.subagent > .subagent-summary::-webkit-details-marker { display: none; }
.subagent > .subagent-summary:hover { background: rgba(33, 27, 16, 0.045); }
.subagent-label { font: 600 14.5px/1.45 var(--serif); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.subagent-meta { display: flex; gap: 10px; flex: none; align-items: baseline; }
.subagent-type { font: 700 10.5px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--amber); }
.subagent-count { font: 500 11px/1 var(--mono); color: var(--faint); white-space: nowrap; }
.subagent[open] > .subagent-summary { border-bottom: 1px solid var(--line); }
.subagent-body { padding: 8px 16px 16px; }
.subagent-body .turns { gap: 18px; margin-top: 8px; }
.body {
  min-width: 0;
  max-width: 80ch;
  font: 400 17.5px/1.76 var(--serif);
  color: var(--ink);
}
.body > * { margin: 0; }
.body > * + * { margin-top: 16px; }
.body p, .body li { overflow-wrap: anywhere; }
.body strong { font-weight: 700; }
.body em { font-style: italic; }
.body a {
  color: var(--seal-deep); text-decoration: underline;
  text-decoration-thickness: 1px; text-decoration-color: rgba(140, 43, 31, 0.45); text-underline-offset: 3px;
}
.body a:hover { text-decoration-color: var(--seal); }
.body code {
  border: 1px solid var(--line);
  border-radius: 5px;
  background: rgba(33, 27, 16, 0.06);
  padding: 0.08em 0.36em;
  font: 500 0.82em/1 var(--mono);
}
.body pre {
  position: relative;
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--code-line);
  border-radius: 11px;
  background: var(--code-bg);
  color: var(--code-ink);
  padding: 36px 16px 16px;
  font: 13px/1.62 var(--mono);
  white-space: pre;
  box-shadow: 0 26px 56px -44px rgba(30, 18, 4, 0.85);
  scrollbar-color: rgba(239, 231, 212, 0.3) transparent;
}
.body pre[data-language]::before {
  position: absolute; top: 11px; right: 13px;
  max-width: calc(100% - 26px); overflow: hidden;
  color: #b3a584; content: attr(data-language);
  font: 700 10px/1 var(--mono); letter-spacing: 0.16em; text-transform: uppercase;
  text-overflow: ellipsis; white-space: nowrap;
}
.body pre code { display: block; min-width: max-content; border: 0; background: transparent; padding: 0; color: inherit; font-size: inherit; }
.body .hljs-keyword, .body .hljs-selector-tag, .body .hljs-built_in { color: #e0764a; }
.body .hljs-title, .body .hljs-title.class_, .body .hljs-title.function_ { color: #eac57d; }
.body .hljs-string, .body .hljs-attr, .body .hljs-symbol { color: #a9c08a; }
.body .hljs-number, .body .hljs-literal { color: #dba16a; }
.body .hljs-comment { color: #8a7d63; font-style: italic; }
.body .hljs-type, .body .hljs-params, .body .hljs-variable, .body .hljs-property { color: #cda6a0; }
.body ul, .body ol { padding-left: 1.35rem; }
.body li + li { margin-top: 0.25rem; }
.body blockquote { border-left: 3px solid rgba(177, 56, 42, 0.4); margin-left: 0; padding-left: 14px; color: var(--ink-soft); font-style: italic; }
.body h1, .body h2, .body h3 { line-height: 1.3; font-size: 1.12em; font-weight: 700; }
.body table {
  display: block; width: max-content; max-width: 100%; overflow-x: auto;
  border-collapse: collapse; font-family: var(--sans); font-size: 13.5px; line-height: 1.5;
}
.body th, .body td { border: 1px solid var(--hairline); padding: 7px 12px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.body th { background: rgba(33, 27, 16, 0.05); color: var(--ink); font-weight: 700; white-space: nowrap; }
.body tbody tr:nth-child(even) td, .body tr:nth-child(even) td { background: rgba(33, 27, 16, 0.022); }
.attachment-grid { display: grid; gap: 18px; margin-top: 22px; }
.body > .attachment-grid { margin-top: 22px; }
.image-attachment { margin: 0; min-width: 0; }
.image-attachment img {
  display: block; max-width: 100%; max-height: 520px;
  border: 1px solid rgba(33, 27, 16, 0.22); border-radius: 8px;
  background: var(--panel); padding: 4px; object-fit: contain;
  box-shadow: 0 22px 50px -44px rgba(64, 44, 14, 0.7);
}
.image-unavailable { border: 1px dashed var(--line-2); border-radius: 8px; padding: 16px; color: var(--muted); }
pre {
  overflow: auto; max-height: 460px; margin: 0;
  border: 1px solid var(--code-line); border-radius: 8px;
  background: var(--code-bg); color: var(--code-ink); padding: 12px;
  font: 12px/1.6 var(--mono); white-space: pre-wrap;
}
.empty { color: var(--muted); }

/* ---------- 搜索浮层 ---------- */
.search-overlay {
  position: fixed; inset: 0; z-index: 40;
  display: grid; justify-items: start; align-items: start;
  background: rgba(38, 28, 12, 0.16);
  padding: clamp(14px, 4dvh, 44px) 16px;
  backdrop-filter: blur(2px) saturate(0.96);
}
.search-overlay[hidden] { display: none; }
.search-dialog {
  display: flex; flex-direction: column; gap: 12px; width: min(560px, 94vw);
  max-height: calc(100dvh - 2 * clamp(14px, 4dvh, 44px));
  border: 1px solid var(--line-2); border-top: 3px solid var(--seal);
  border-radius: 12px; background: linear-gradient(180deg, var(--panel), var(--panel-2));
  padding: 18px; box-shadow: 0 42px 100px -44px rgba(38, 24, 8, 0.85);
  animation: turn-rise 0.28s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
.search-results { flex: 1 1 auto; }
.search-flag {
  min-height: 32px; border: 1px solid var(--line-2); border-radius: 8px;
  background: transparent; color: var(--muted);
  padding: 0 10px; font: 700 11px/1 var(--mono); letter-spacing: 0.02em;
}
.search-flag:hover { border-color: var(--line-2); background: rgba(127, 110, 80, 0.1); color: var(--ink); transform: none; }
.search-flag[aria-pressed="true"] { border-color: var(--seal); background: var(--seal-soft); color: var(--seal-deep); }
.search-facets { display: flex; flex-wrap: wrap; gap: 6px; }
.search-facets:empty { display: none; }
.facet-chip {
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 26px; border: 1px solid var(--line-2); border-radius: 999px;
  background: transparent; color: var(--ink-soft);
  padding: 0 10px; font: 600 10.5px/1 var(--mono); letter-spacing: 0.02em;
  cursor: pointer;
}
.facet-chip:hover { border-color: var(--seal); color: var(--seal-deep); background: transparent; transform: none; }
.facet-chip.active { border-color: var(--seal); background: var(--seal-soft); color: var(--seal-deep); }
.facet-chip b { color: var(--faint); font-weight: 700; }
.facet-chip.active b { color: var(--seal-deep); }
.search-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 2px; }
.search-hints { min-width: 0; overflow: hidden; color: var(--faint); font: 600 11px/1.5 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.search-hints kbd { display: inline-block; min-width: 15px; margin: 0 1px; border: 1px solid var(--line-2); border-radius: 5px; background: rgba(127, 110, 80, 0.1); color: var(--muted); padding: 1px 5px; font: 700 10px/1.4 var(--mono); }
.search-count { flex: 0 0 auto; color: var(--muted); font: 700 11px/1.4 var(--mono); }
.search-result-actions { grid-column: 1 / -1; display: none; gap: 6px; margin-top: 4px; }
.search-result.active .search-result-actions { display: flex; flex-wrap: wrap; }
.sr-act {
  min-height: 26px; border: 1px solid var(--line-2); border-radius: 7px;
  background: transparent; color: var(--ink-soft);
  padding: 0 9px; font: 600 10.5px/1 var(--mono); letter-spacing: 0.02em;
}
.sr-act:hover { border-color: var(--seal); background: transparent; color: var(--seal-deep); transform: none; }
.stats-overlay {
  position: fixed; inset: 0; z-index: 45;
  display: grid; place-items: start center;
  background: rgba(38, 28, 12, 0.36);
  padding: clamp(18px, 7dvh, 64px) 18px 18px;
  backdrop-filter: blur(6px) saturate(0.9);
}
.stats-overlay[hidden] { display: none; }
.stats-dialog {
  display: flex; flex-direction: column; gap: 16px; width: min(720px, 96vw);
  max-height: calc(100dvh - 40px); overflow: auto;
  border: 1px solid var(--line-2); border-top: 3px solid var(--seal);
  border-radius: 12px; background: linear-gradient(180deg, var(--panel), var(--panel-2));
  padding: 20px; box-shadow: 0 42px 100px -44px rgba(38, 24, 8, 0.85);
  animation: turn-rise 0.28s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
.stats-bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.stats-bar h2 { font-size: 22px; font-weight: 600; }
.stats-bar-actions { display: inline-flex; gap: 8px; }
.stats-refresh { min-height: 34px; border-color: var(--line-2); background: transparent; color: var(--muted); }
.stats-refresh:hover { border-color: var(--seal); background: transparent; color: var(--seal); }
.stats-body { display: flex; flex-direction: column; gap: 18px; }
.stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.stat-tile { display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel-wash); padding: 12px 14px; }
.stat-tile-k { color: var(--faint); font: 700 10.5px/1.2 var(--mono); letter-spacing: 0.05em; text-transform: uppercase; }
.stat-tile-v { color: var(--ink); font: 700 24px/1.1 var(--serif); }
.stat-tile-sub { color: var(--muted); font: 600 11px/1.3 var(--mono); }
.stats-section h3 { margin: 0 0 8px; color: var(--ink-soft); font: 600 13px/1.2 var(--sans); }
.stat-rows { display: flex; flex-direction: column; gap: 6px; }
.stat-row { display: grid; grid-template-columns: minmax(80px, 150px) 1fr auto; gap: 10px; align-items: center; }
.stat-row-name { overflow: hidden; color: var(--ink-soft); font: 600 12px/1.3 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.stat-row-track { height: 8px; border-radius: 999px; background: rgba(127, 110, 80, 0.14); overflow: hidden; }
.stat-row-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--seal), var(--amber)); }
.stat-row-val { color: var(--ink); font: 700 11.5px/1.2 var(--mono); white-space: nowrap; }
.stat-row-val b { color: var(--faint); font-weight: 600; }
.stats-muted { color: var(--faint); font: 600 12px/1.4 var(--mono); }
.stats-cost-inputs { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
.stats-cost-inputs label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font: 600 12px/1 var(--mono); }
.stats-cost-inputs input { width: 82px; height: 32px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--field-bg); color: var(--ink); padding: 0 8px; font: 600 12px/1 var(--mono); }
.stats-cost-out { color: var(--ink-soft); font: 600 14px/1.4 var(--sans); }
.stats-cost-out b { color: var(--seal-deep); font-weight: 700; font-size: 18px; }
.stats-cost-out span { color: var(--faint); font: 500 11px/1.3 var(--mono); }
.stats-note { margin: 0; color: var(--faint); font: 500 11px/1.5 var(--mono); }
.exports .resume-orca { border-color: var(--pine); background: var(--pine); color: #eef5ef; }
.exports .resume-orca:hover { border-color: var(--pine); background: #26483a; color: #fff; }
.sr-act-orca { border-color: var(--pine); color: var(--pine); }
.sr-act-orca:hover { border-color: var(--pine); background: var(--pine); color: #fff; }
.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 60;
  max-width: min(560px, 92vw);
  border: 1px solid var(--line-2); border-left: 3px solid var(--pine);
  border-radius: 10px; background: var(--panel); color: var(--ink);
  padding: 12px 16px; font: 600 13px/1.4 var(--sans);
  box-shadow: var(--shadow-panel);
  animation: turn-rise 0.2s ease both;
}
.toast[hidden] { display: none; }
.toast.error { border-left-color: var(--seal); }
.search-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.search-bar h2 { font-size: 22px; font-weight: 600; }
.search-close { min-height: 34px; border-color: var(--line-2); background: transparent; color: var(--muted); }
.search-close:hover { border-color: var(--seal); background: transparent; color: var(--seal); }
.global-search-input { width: 100%; height: 46px; font-size: 15px; }
.search-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.search-mode, .search-prewarm { min-height: 32px; border-color: var(--line-2); background: transparent; color: var(--muted); padding: 0 11px; }
.search-mode:hover, .search-prewarm:hover { border-color: var(--line-2); background: rgba(33, 27, 16, 0.06); color: var(--ink); transform: none; }
.search-mode.active { border-color: var(--ink); background: var(--ink); color: var(--paper); }
.search-mode:disabled, .search-prewarm:disabled { border-color: var(--line); background: rgba(33, 27, 16, 0.04); color: var(--faint); }
.search-prewarm[aria-busy="true"] { border-color: rgba(47, 93, 73, 0.45); background: rgba(47, 93, 73, 0.08); color: var(--pine); }
.search-scope-label {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  max-width: min(320px, 100%);
  border: 1px solid var(--line);
  border-radius: 9px;
  background: rgba(33, 27, 16, 0.035);
  color: var(--muted);
  padding: 0 11px;
  font: 700 11px/1 var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-status { min-width: 0; color: var(--faint); font: 600 11.5px/1.35 var(--mono); }
.search-results { display: grid; grid-auto-rows: max-content; gap: 8px; align-content: start; min-height: 0; overflow: auto; padding-right: 4px; }
.search-empty {
  display: grid; min-height: 112px; place-items: center;
  border: 1px dashed var(--line-2); border-radius: 10px;
  color: var(--faint); font: 600 13px/1.45 var(--mono);
}
.search-result {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 14px; min-height: 0;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--panel-wash); color: var(--ink);
  padding: 12px; text-align: left; font-family: var(--sans);
  cursor: pointer;
  transition: background 130ms ease, border-color 130ms ease, box-shadow 130ms ease;
}
.search-result:hover, .search-result.active { border-color: rgba(177, 56, 42, 0.5); background: var(--result-active-bg); transform: none; box-shadow: 0 14px 30px -26px rgba(140, 43, 31, 0.6); }
.search-result strong, .search-result span, .search-result p { min-width: 0; }
.search-result-title { overflow: hidden; font: 600 15px/1.3 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.search-result-source { color: var(--faint); font: 700 10.5px/1 var(--mono); letter-spacing: 0.05em; white-space: nowrap; }
.search-result-path { grid-column: 1 / -1; overflow: hidden; color: var(--faint); font: 500 11px/1.35 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.search-result-snippet {
  display: -webkit-box;
  grid-column: 1 / -1;
  margin: 0;
  overflow: hidden;
  color: var(--ink-soft);
  font: 400 13.5px/1.55 var(--sans);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.search-result-snippet mark { border-radius: 2px; background: linear-gradient(180deg, rgba(234, 197, 110, 0.2), rgba(234, 197, 110, 0.72)); color: inherit; padding: 0 2px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.search-result-meta { grid-column: 1 / -1; color: var(--faint); font: 600 10.5px/1.3 var(--mono); letter-spacing: 0.05em; text-transform: uppercase; }

.project-group.no-project .project-headline { grid-template-columns: minmax(0, 1fr); }
.project-group.no-project .project-header { grid-template-columns: minmax(0, 1fr) auto; }
.project-group.no-project .project-icon { display: none; }

@media (max-width: 900px) {
  .app { grid-template-columns: 1fr; grid-template-rows: minmax(220px, 38dvh) minmax(0, 1fr); }
  .splitter { display: none; }
  .sidebar { border-right: 0; border-bottom: 2px solid var(--ink); }
  .mh-row { flex-wrap: wrap; }
  .mh-row h2 { flex-basis: 100%; }
  .turns { gap: 32px; }
  .user .message-card, .assistant .message-card, .tool .message-card { max-width: 100%; }
  .body { font-size: 17px; }
}
@media (prefers-reduced-motion: reduce) {
  .loading-spinner { animation: none; }
  .turn, .search-dialog { animation: none; }
  * { transition-duration: 0.01ms !important; }
}


/* ============================================================
   Design elevation — workflow ui-design-elevation
   "Keep the 宣纸 + 墨 + 朱红印章 editorial-archive identity, but make it read as a *typeset document in three fully hand-tuned papers* rather than a l..."
   Appended so later cascade overrides originals; all theme-safe.
   ============================================================ */

/* [high] themed-wash-scale — Themed hover/surface wash scale (fixes dead dark-mode hovers) */
:root{--wash-1:rgba(33,27,16,0.03);--wash-2:rgba(33,27,16,0.05);--wash-3:rgba(33,27,16,0.09);--code-inline-bg:rgba(33,27,16,0.06);--th-bg:rgba(33,27,16,0.05);--zebra-bg:rgba(33,27,16,0.024);}
html[data-theme="sepia"]{--wash-1:rgba(58,47,29,0.04);--wash-2:rgba(58,47,29,0.06);--wash-3:rgba(58,47,29,0.1);--code-inline-bg:rgba(58,47,29,0.07);--th-bg:rgba(58,47,29,0.06);--zebra-bg:rgba(58,47,29,0.03);}
html[data-theme="dark"]{--wash-1:rgba(233,220,196,0.04);--wash-2:rgba(233,220,196,0.07);--wash-3:rgba(233,220,196,0.12);--code-inline-bg:rgba(233,220,196,0.08);--th-bg:rgba(233,220,196,0.07);--zebra-bg:rgba(233,220,196,0.035);}
.session:hover{background:var(--wash-2);}
.source-tab:hover{background:var(--wash-3);}
.source-switcher{background:var(--wash-1);}
.project-header:hover{background:var(--wash-2);}
.search-scope-label{background:var(--wash-1);}
.stat-row-track{background:var(--wash-3);}
.turn-notice{background:var(--wash-1);}
.subagent{background:var(--wash-1);}
.search-entry kbd{background:var(--wash-1);}
.body code{background:var(--code-inline-bg);}
.body th{background:var(--th-bg);}
.body tbody tr:nth-child(even) td,.body tr:nth-child(even) td{background:var(--zebra-bg);}

/* [high] themed-scroll-selection — Theme-aware scrollbar thumb and text selection */
:root{--scroll-thumb:rgba(33,27,16,0.22);--scroll-thumb-hover:rgba(33,27,16,0.4);--selection:rgba(177,56,42,0.2);}
html[data-theme="sepia"]{--scroll-thumb:rgba(58,47,29,0.24);--scroll-thumb-hover:rgba(58,47,29,0.42);--selection:rgba(167,51,31,0.18);}
html[data-theme="dark"]{--scroll-thumb:rgba(233,220,196,0.18);--scroll-thumb-hover:rgba(233,220,196,0.34);--selection:rgba(210,76,55,0.3);}
::selection{background:var(--selection);}
.sidebar,.viewer,.search-results{scrollbar-color:var(--scroll-thumb) transparent;}
::-webkit-scrollbar-thumb{background:var(--scroll-thumb);background-clip:content-box;}
::-webkit-scrollbar-thumb:hover{background-color:var(--scroll-thumb-hover);}

/* [high] themed-focus-ring — Single themed focus-ring token applied to every focusable control (incl. hidden redact toggle + disclosures) */
:root{--focus-ring:rgba(177,56,42,0.55);--focus-glow:rgba(177,56,42,0.14);}
html[data-theme="sepia"]{--focus-ring:rgba(167,51,31,0.58);--focus-glow:rgba(167,51,31,0.16);}
html[data-theme="dark"]{--focus-ring:rgba(210,76,55,0.66);--focus-glow:rgba(210,76,55,0.24);}
button:focus-visible,.source-tab:focus-visible,.session:focus-visible,.search-result:focus-visible,.project-header:focus-visible,.appx:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;}
.splitter:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px;}
input[type="search"]:focus{border-color:var(--seal);box-shadow:0 0 0 1px var(--seal),0 0 0 3px var(--focus-glow);}
.session-search input:focus{outline:0;border-color:var(--seal);box-shadow:0 0 0 1px var(--seal),0 0 0 3px var(--focus-glow);background:var(--panel);}
.switches label:has(input:focus-visible){outline:2px solid var(--focus-ring);outline-offset:2px;border-radius:6px;}
.process-summary:focus-visible,.tool-details summary:focus-visible,.subagent > .subagent-summary:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;border-radius:6px;}

/* [high] markdown-heading-scale — Real 3-step serif heading scale with editorial heading spacing */
.body h1,.body h2,.body h3{line-height:1.28;font-weight:700;color:var(--ink);}
.body h1{font-size:1.4em;letter-spacing:0.002em;}
.body h2{font-size:1.18em;}
.body h3{font-size:1.04em;color:var(--ink-soft);}
.body > * + :is(h1,h2,h3){margin-top:28px;}
.body :is(h1,h2,h3) + *{margin-top:10px;}

/* [high] faint-contrast-aa — Fix --faint metadata failing WCAG AA in light/sepia */
:root{--faint:#7a6c4e;}
html[data-theme="sepia"]{--faint:#7c6a4b;}

/* [high] shared-left-rail — One continuous left rail — anchor the transcript to the same gutter as masthead/goal and unify content max-width */
.turns{width:min(1260px,100%);margin:0;padding:18px clamp(20px,2.2vw,40px) 80px;--content-max:min(1120px,100%);}
.assistant .message-card{max-width:var(--content-max);}
.tool .message-card{max-width:var(--content-max);}

/* [high] turn-rhythm-grouping — Grouped turn rhythm — tighter within a turn, more air before a new user prompt */
.turns{gap:20px;}
.turns > .user:not(:first-child){margin-top:18px;}
/* re-assert the mobile gap after the base override (media queries add no specificity) */
@media (max-width: 900px){.turns{gap:26px;}}
html[data-density="compact"] .turns{gap:14px;}
html[data-density="compact"] .turns > .user:not(:first-child){margin-top:12px;}
html[data-density="compact"] .body{line-height:1.62;}
html[data-density="compact"] .body > * + *{margin-top:12px;}

/* [medium] themed-glow-grain — Per-theme ambient glows and paper-grain opacity (kills dark-mode static, restores warmth) */
:root{--glow-seal:rgba(177,56,42,0.05);--glow-pine:rgba(47,93,73,0.05);--grain-opacity:0.5;}
html[data-theme="sepia"]{--glow-seal:rgba(167,51,31,0.06);--glow-pine:rgba(52,95,75,0.06);--grain-opacity:0.6;}
html[data-theme="dark"]{--glow-seal:rgba(210,76,55,0.1);--glow-pine:rgba(90,163,131,0.08);--grain-opacity:0.3;}
body{background:radial-gradient(120% 80% at 50% -18%,var(--glow-seal),transparent 60%),radial-gradient(100% 70% at 0% 120%,var(--glow-pine),transparent 55%),var(--paper);}
body::before{opacity:var(--grain-opacity);}

/* [medium] masthead-seal-stamp — Elevate the masthead: display title, ink-stamp seal tick, and a whisper of scroll elevation */
:root{--sink-shadow:0 14px 22px -22px rgba(64,44,14,0.5);}
html[data-theme="dark"]{--sink-shadow:0 16px 26px -20px rgba(0,0,0,0.72);}
.masthead{padding:14px clamp(20px,2.2vw,40px) 12px;backdrop-filter:blur(6px);box-shadow:var(--sink-shadow);}
.mh-row h2{font:600 clamp(24px,1.7vw,28px)/1.16 var(--serif);letter-spacing:0;}
.mh-row h2::before{content:"";flex:0 0 auto;width:5px;height:22px;border-radius:1.5px;background:linear-gradient(180deg,var(--seal),var(--seal-deep));box-shadow:inset 0 1px 0 rgba(255,255,255,0.22),0 1px 2px -1px rgba(140,43,31,0.55);}

/* [medium] tracking-tokens — Two tracking tokens to unify the mono 'stamp' label voice (and fix CJK over-tracking) */
:root{--track-eyebrow:0.18em;--track-label:0.08em;}
.eyebrow,.brand .brand-wm span,.dossier .ro{letter-spacing:var(--track-eyebrow);}
.turn-meta,.source-tab,.subagents-head,.risk b,.stat-tile-k,.tool-details summary{letter-spacing:var(--track-label);}

/* [medium] reading-measure-code-lede — Book measure + inline-code balance + promote the goal callout to a lede */
.body{max-width:68ch;}
.body code{padding:0.12em 0.4em;font:500 0.86em/1.2 var(--mono);font-variant-ligatures:none;}
.goal span{font:400 17px/1.62 var(--serif);color:var(--ink);}

/* [medium] tabular-figures — Lining tabular figures for stats KPIs and data numerals */
.stat-tile-v{font-variant-numeric:lining-nums tabular-nums;}
.stat-row-val,.stats-cost-out b{font-variant-numeric:tabular-nums;}
.dossier,.session-time{font-variant-numeric:tabular-nums;}

/* [medium] press-and-motion-refine — Pressed feedback + a precise reduced-motion contract + shared easing tokens */
:root{--ease-rise:cubic-bezier(0.2,0.7,0.3,1);--dur-rise:0.28s;}
.toolbar button:active,.exports a:active,.appx:active,.source-tab:active,.search-mode:active,.search-flag:active,.facet-chip:active,.sr-act:active,.session-search button:active{transform:translateY(0) scale(0.97);transition-duration:60ms;}
@media (prefers-reduced-motion: reduce){
  .turn,.search-dialog,.stats-dialog,.toast,.goal,.risk,.notice,.search-overlay,.stats-overlay,.stat-row-fill,.search-results > .search-result{animation:none !important;}
  *{transition-property:color,background-color,border-color,opacity,box-shadow !important;}
}

/* [medium] disclosure-affordance — Unify the three disclosure carets into one ink chevron */
.tool-details summary::-webkit-details-marker{display:none;}
.subagent > .subagent-summary,.tool-details summary{position:relative;}
.tool-details summary{display:flex;align-items:center;gap:8px;}
.subagent > .subagent-summary::after,.tool-details summary::after{content:"";width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg);transition:transform .16s ease;opacity:.6;margin-left:auto;}
.subagent[open] > .subagent-summary::after,.tool-details[open] summary::after{transform:translateY(2px) rotate(225deg);}

/* [medium] search-legibility-selection — Search palette: legible dark highlight, wrapping key legend, and active-vs-hover distinction */
html[data-theme="dark"] .search-result-snippet mark{color:#1a1206;background:linear-gradient(180deg,rgba(199,146,66,0.85),rgba(199,146,66,0.96));}
.search-foot{align-items:flex-start;flex-wrap:wrap;}
.search-hints{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.6;}
.search-result:hover{border-color:rgba(177,56,42,0.35);background:var(--result-active-bg);}
.search-result.active{border-color:var(--seal);background:var(--result-active-bg);box-shadow:inset 3px 0 0 var(--seal),0 14px 30px -26px rgba(140,43,31,0.6);}

/* [low] choreographed-modals — Choreograph modal entrances: backdrop fade, disclosure settle, and stats bar-grow */
@keyframes overlay-fade{from{opacity:0;}to{opacity:1;}}
@keyframes disclosure-in{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:none;}}
@keyframes bar-grow{from{transform:scaleX(0);}to{transform:scaleX(1);}}
.search-overlay{animation:overlay-fade 0.18s ease both;}
.stats-overlay{animation:overlay-fade 0.2s ease both;}
.process-details[open] .process-body,.subagent[open] > .subagent-body,.tool-details[open] > *:not(summary){animation:disclosure-in 0.22s var(--ease-rise) both;}
.stat-row-fill{transform-origin:left center;animation:bar-grow 0.55s var(--ease-rise) 0.12s both;}

/* [low] cursor-and-radius-polish — Honest disabled cursor + a 3-step radius scale */
button:disabled{cursor:not-allowed;}
button[aria-busy="true"],.search-prewarm[aria-busy="true"]{cursor:progress;}
.session-search input:disabled{cursor:not-allowed;}
:root{--r-sm:7px;--r-md:9px;--r-lg:12px;}
.appx,.source-tab,.sr-act{border-radius:var(--r-sm);}
.exports a,.search-flag{border-radius:var(--r-md);}
.search-result,.stat-tile{border-radius:var(--r-lg);}

`;
}
function serverJs() {
    return `
const state = {
  sessions: [],
  selected: "",
  activeSource: "codex",
  requestToken: 0,
  currentSnapshot: null,
  expandedProjects: new Set(),
  collapsedProjects: new Set(),
  hasMoreSessions: false,
  loadingMoreSessions: false,
  sessionListError: "",
  search: { open: false, query: "", scope: "all", cwd: "", scopeLabel: "全部历史", mode: "keyword", loading: false, results: [], rawResults: [], terms: [], matched: 0, scanned: 0, indexed: 0, indexedChunks: 0, updated: 0, pending: 0, failed: 0, model: "", error: "", requestToken: 0, active: 0, previewRef: "", restoreSelection: "", flags: { caseSensitive: false, wholeWord: false }, filters: null },
  semanticWarmup: { running: false, requestedStop: false, rounds: 0, scanned: 0, indexed: 0, indexedChunks: 0, updated: 0, totalUpdated: 0, pending: 0, failed: 0, model: "", error: "", complete: false },
  sessionSearch: { query: "", loading: false, results: [], chunkCount: 0, model: "", error: "", requestToken: 0 },
  snapshotCache: new Map(),
  previewToken: 0,
  stats: null,
  statsRate: { in: 0, out: 0 },
};
const SOURCE_MODULES = [
  { key: "codex", label: "Codex" },
  { key: "claude", label: "Claude Code" },
];
const SESSION_BATCH_LIMIT = 200;
const SEARCH_SCAN_LIMIT = 600;
const SEMANTIC_SEARCH_SCAN_LIMIT = 600;
const SEMANTIC_SEARCH_UPDATE_LIMIT = 24;
const SEMANTIC_PREWARM_SCAN_LIMIT = 1200;
const SEMANTIC_PREWARM_UPDATE_LIMIT = 120;
const SAFETY_CHECKS_ENABLED = false;
const SIDEBAR_WIDTH_KEY = "codex-snapshot.sidebar-width.v2";
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 460;
const THEME_KEY = "codex-snapshot.theme.v1";
const DENSITY_KEY = "codex-snapshot.density.v1";
const READ_SCALE_KEY = "codex-snapshot.read-scale.v1";
const THEMES = ["light", "sepia", "dark"];
const READ_SCALE_MIN = 0.85;
const READ_SCALE_MAX = 1.4;
const READ_SCALE_STEP = 0.05;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const shareConfig = window.CODEX_SNAPSHOT_SHARE_CONFIG || {};
const csrfToken = String(window.CODEX_SNAPSHOT_CSRF_TOKEN || "");

function renderLoading(message) {
  return "<div class='loading-state' role='status' aria-live='polite' aria-busy='true'>" +
    "<span class='loading-spinner' aria-hidden='true'></span>" +
    "<span>" + esc(message) + "</span>" +
  "</div>";
}

function showViewerLoading(message) {
  state.currentSnapshot = null;
  resetSessionSearchState(false);
  renderSessionSearch();
  $("title").textContent = "正在加载会话";
  $("meta").classList.add("empty");
  $("meta").classList.remove("loading");
  $("meta").removeAttribute("aria-busy");
  $("meta").textContent = "正在读取会话...";
  $("goal").innerHTML = "";
  $("risks").innerHTML = "";
  $("exports").innerHTML = "";
  $("turns").setAttribute("aria-busy", "true");
  $("turns").innerHTML = renderLoading(message || "正在加载...");
}

function activeOptions() {
  return new URLSearchParams({
    id: state.selected,
    includeTools: "1",
    includeToolOutput: "0",
    redact: $("redact").checked ? "1" : "0",
    safety: SAFETY_CHECKS_ENABLED ? "1" : "0",
  });
}

function selectedSession() {
  return state.sessions.find((session) => sessionRef(session) === state.selected) || null;
}

function searchScopeCwd() {
  return state.search.scope === "project" ? String(state.search.cwd || "").trim() : "";
}

function setSearchContext(context = {}) {
  const cwd = String(context.cwd || "").trim();
  const label = String(context.label || "").trim();
  const nextScope = cwd ? "project" : "all";
  const nextLabel = cwd ? "项目：" + (label || "当前项目") : "全部历史";
  const scopeChanged = state.search.scope !== nextScope || state.search.cwd !== cwd;
  state.search.scope = nextScope;
  state.search.cwd = cwd;
  state.search.scopeLabel = nextLabel;
  if (scopeChanged && !state.semanticWarmup.running) {
    resetSemanticWarmupState(false);
  }
  if (scopeChanged) {
    resetSearchResultsState();
  }
}

function openSearchDialog(context = {}) {
  setSearchContext(context);
  state.search.open = true;
  state.search.active = 0;
  state.search.previewRef = "";
  state.search.restoreSelection = state.selected;
  $("searchOverlay").hidden = false;
  document.body.classList.add("search-open");
  renderSearch();
  if ($("globalSearch").value.trim()) {
    scheduleSearch(0);
  }
  setTimeout(() => {
    $("globalSearch").focus();
    $("globalSearch").select();
  }, 0);
}

function closeSearchDialog(commit = false) {
  state.search.open = false;
  $("searchOverlay").hidden = true;
  document.body.classList.remove("search-open");
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = 0;
  }
  if (!commit && state.search.previewRef) {
    // The live preview swapped the reader; restore what the user was looking at.
    const restore = state.search.restoreSelection;
    if (restore && restore !== state.selected) {
      previewSession(restore);
    } else if (!restore) {
      clearViewer();
    }
  }
  state.search.previewRef = "";
}

function isKeyboardActivation(event) {
  return event.key === "Enter" || event.key === " ";
}

const STATS_RATE_KEY = "codex-snapshot.stats-rate.v1";

function loadStatsRate() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATS_RATE_KEY) || "null");
    if (saved && typeof saved === "object") {
      state.statsRate = { in: Number(saved.in) || 0, out: Number(saved.out) || 0 };
    }
  } catch (_error) {
    // Ignore malformed persisted rate.
  }
}

async function openStats() {
  $("statsOverlay").hidden = false;
  document.body.classList.add("stats-open");
  await loadStats();
}

function closeStats() {
  $("statsOverlay").hidden = true;
  document.body.classList.remove("stats-open");
}

async function loadStats() {
  $("statsBody").innerHTML = renderLoading("正在统计本机会话（首次会在后台建索引）...");
  try {
    const response = await fetch("/api/search-stats");
    const stats = await response.json();
    if (!response.ok) {
      throw new Error(stats.error || "统计失败");
    }
    state.stats = stats;
    renderStats();
  } catch (error) {
    $("statsBody").innerHTML = "<div class='search-empty'>" + esc(error instanceof Error ? error.message : String(error)) + "</div>";
  }
}

const STATS_ENGINE_LABELS = { codex: "Codex", claude: "Claude Code", trae: "Trae" };

function statsTile(label, value, sub) {
  return "<div class='stat-tile'><span class='stat-tile-k'>" + esc(label) + "</span>" +
    "<b class='stat-tile-v'>" + esc(value) + "</b>" +
    (sub ? "<span class='stat-tile-sub'>" + esc(sub) + "</span>" : "") +
    "</div>";
}

function statsBar(label, count, total, max, sub) {
  const pct = max > 0 ? Math.max(2, Math.round((total / max) * 100)) : 0;
  return "<div class='stat-row'>" +
    "<span class='stat-row-name' title='" + esc(label) + "'>" + esc(label) + "</span>" +
    "<span class='stat-row-track'><span class='stat-row-fill' style='width:" + pct + "%'></span></span>" +
    "<span class='stat-row-val'>" + esc(formatTokenShort(total)) + "<b>" + esc(sub || "") + "</b></span>" +
  "</div>";
}

function renderStats() {
  const stats = state.stats;
  if (!stats) {
    return;
  }
  const rate = state.statsRate;
  const cost = (Number(stats.inputTokens || 0) / 1000000) * (rate.in || 0) + (Number(stats.outputTokens || 0) / 1000000) * (rate.out || 0);
  const tiles = [
    statsTile("已索引会话", formatTokenCount(stats.indexedSessions), (stats.sessionsWithTokens || 0) + " 条有 token 数据"),
    statsTile("总 token", formatTokenShort(stats.totalTokens), formatTokenCount(stats.totalTokens)),
    statsTile("输入 token", formatTokenShort(stats.inputTokens), ""),
    statsTile("输出 token", formatTokenShort(stats.outputTokens), ""),
  ].join("");

  const engineMax = Math.max(1, ...(stats.byEngine || []).map((entry) => Number(entry.total || 0)));
  const engineRows = (stats.byEngine || []).filter((entry) => entry.sessions).map((entry) =>
    statsBar(STATS_ENGINE_LABELS[entry.key] || entry.key, entry.sessions, Number(entry.total || 0), engineMax, " · " + entry.sessions + " 会话")
  ).join("") || "<div class='stats-muted'>暂无数据</div>";

  const projectMax = Math.max(1, ...(stats.byProject || []).map((entry) => Number(entry.total || 0)));
  const projectRows = (stats.byProject || []).map((entry) =>
    statsBar(entry.name, entry.sessions, Number(entry.total || 0), projectMax, " · " + entry.sessions + " 会话")
  ).join("") || "<div class='stats-muted'>暂无数据</div>";

  const costLine = (rate.in || rate.out)
    ? "<div class='stats-cost-out'>≈ <b>" + esc(cost >= 1 ? cost.toFixed(2) : cost.toFixed(4)) + "</b> <span>（按 输入 " + esc(rate.in || 0) + " / 输出 " + esc(rate.out || 0) + " 每百万 token，粗略上限，含各轮重复上下文）</span></div>"
    : "<div class='stats-cost-out stats-muted'>填入单价即可估算成本（token 计数为准）</div>";

  $("statsBody").innerHTML =
    "<div class='stat-tiles'>" + tiles + "</div>" +
    "<div class='stats-section'><h3>按来源</h3><div class='stat-rows'>" + engineRows + "</div></div>" +
    "<div class='stats-section'><h3>按项目 · Top " + (stats.byProject || []).length + "</h3><div class='stat-rows'>" + projectRows + "</div></div>" +
    "<div class='stats-section'><h3>成本估算</h3>" +
      "<div class='stats-cost-inputs'>" +
        "<label>输入 <input id='statsPriceIn' type='number' min='0' step='0.1' value='" + esc(rate.in || "") + "' placeholder='0'> /1M</label>" +
        "<label>输出 <input id='statsPriceOut' type='number' min='0' step='0.1' value='" + esc(rate.out || "") + "' placeholder='0'> /1M</label>" +
      "</div>" + costLine +
    "</div>" +
    "<p class='stats-note'>索引在后台增量构建；数据来自本机日志，Codex 的 token 为各轮累计（含缓存/重复上下文），仅供参考。</p>";

  const priceIn = $("statsPriceIn");
  const priceOut = $("statsPriceOut");
  const onRate = () => {
    state.statsRate = { in: Number(priceIn.value) || 0, out: Number(priceOut.value) || 0 };
    localStorage.setItem(STATS_RATE_KEY, JSON.stringify(state.statsRate));
    renderStats();
  };
  if (priceIn) priceIn.addEventListener("change", onRate);
  if (priceOut) priceOut.addEventListener("change", onRate);
}

function resetSearchResultsState() {
  state.search.loading = false;
  state.search.results = [];
  state.search.terms = [];
  state.search.matched = 0;
  state.search.scanned = 0;
  state.search.indexed = 0;
  state.search.indexedChunks = 0;
  state.search.updated = 0;
  state.search.pending = 0;
  state.search.failed = 0;
  state.search.model = "";
  state.search.error = "";
  state.search.requestToken += 1;
}

function setSearchMode(mode) {
  state.search.mode = mode === "semantic" ? "semantic" : "keyword";
  resetSearchResultsState();
  renderSearch();
  scheduleSearch(0);
}

let semanticWarmupAbort = null;
function resetSemanticWarmupState(keepComplete = false) {
  state.semanticWarmup = {
    running: false,
    requestedStop: false,
    rounds: 0,
    scanned: keepComplete ? state.semanticWarmup.scanned : 0,
    indexed: keepComplete ? state.semanticWarmup.indexed : 0,
    indexedChunks: keepComplete ? state.semanticWarmup.indexedChunks : 0,
    updated: 0,
    totalUpdated: keepComplete ? state.semanticWarmup.totalUpdated : 0,
    pending: keepComplete ? state.semanticWarmup.pending : 0,
    failed: keepComplete ? state.semanticWarmup.failed : 0,
    model: keepComplete ? state.semanticWarmup.model : "",
    error: "",
    complete: keepComplete ? state.semanticWarmup.complete : false,
  };
}

function updateSemanticWarmupState(payload) {
  const updated = Number(payload.updated || 0);
  state.semanticWarmup.scanned = Number(payload.scanned || 0);
  state.semanticWarmup.indexed = Number(payload.indexed || 0);
  state.semanticWarmup.indexedChunks = Number(payload.indexedChunks || 0);
  state.semanticWarmup.updated = updated;
  state.semanticWarmup.totalUpdated += updated;
  state.semanticWarmup.pending = Number(payload.pending || 0);
  state.semanticWarmup.failed = Number(payload.failed || 0);
  state.semanticWarmup.model = String(payload.model || "");
  state.semanticWarmup.complete = payload.complete === true || state.semanticWarmup.pending === 0;
}

function semanticWarmupStatus(prefix) {
  const warmup = state.semanticWarmup;
  const updated = warmup.totalUpdated ? "，已更新 " + warmup.totalUpdated + " 条" : "";
  const pending = warmup.pending ? "，待补 " + warmup.pending + " 条" : "";
  const failed = warmup.failed ? "，跳过 " + warmup.failed + " 条" : "";
  const model = warmup.model ? " · " + warmup.model : "";
  return prefix + "：索引 " + warmup.indexed + " / 扫描 " + warmup.scanned + updated + pending + failed + model;
}

function semanticWarmupParams() {
  const params = new URLSearchParams({
    source: "all",
    scanLimit: String(SEMANTIC_PREWARM_SCAN_LIMIT),
    updateLimit: String(SEMANTIC_PREWARM_UPDATE_LIMIT),
    completeOnly: "1",
    includeTools: "1",
    includeToolOutput: "0",
  });
  const cwd = searchScopeCwd();
  if (cwd) {
    params.set("cwd", cwd);
  }
  return params;
}

async function toggleSemanticPrewarm() {
  if (state.semanticWarmup.running) {
    state.semanticWarmup.requestedStop = true;
    if (semanticWarmupAbort) {
      semanticWarmupAbort.abort();
    }
    renderSearch();
    return;
  }
  await runSemanticPrewarm();
}

async function runSemanticPrewarm() {
  if (state.semanticWarmup.running) {
    return;
  }
  state.search.mode = "semantic";
  resetSemanticWarmupState(false);
  state.semanticWarmup.running = true;
  renderSearch();

  try {
    while (!state.semanticWarmup.requestedStop) {
      state.semanticWarmup.rounds += 1;
      semanticWarmupAbort = new AbortController();
      const response = await fetch("/api/semantic-index/prewarm?" + semanticWarmupParams().toString(), {
        method: "POST",
        headers: { "${MUTATION_CSRF_HEADER}": csrfToken },
        signal: semanticWarmupAbort.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "预热索引失败");
      }
      updateSemanticWarmupState(payload);
      renderSearch();
      if (state.semanticWarmup.pending <= 0 || Number(payload.updated || 0) <= 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  } catch (error) {
    if (!state.semanticWarmup.requestedStop || error?.name !== "AbortError") {
      state.semanticWarmup.error = error instanceof Error ? error.message : String(error);
    }
  } finally {
    semanticWarmupAbort = null;
    state.semanticWarmup.running = false;
    state.semanticWarmup.requestedStop = false;
    state.semanticWarmup.complete = state.semanticWarmup.pending === 0 && !state.semanticWarmup.error;
    renderSearch();
  }
}

let searchTimer = 0;
let previewTimer = 0;
function scheduleSearch(delay = 220) {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(() => {
    searchTimer = 0;
    runSearch();
  }, delay);
}

const FILTER_KEYS = ["source", "role", "project", "before", "after"];

function parseSearchQuery(raw) {
  const filters = { source: "", roles: [], projects: [], before: 0, after: 0, excludes: [] };
  const textParts = [];
  const tokens = String(raw || "").match(/[^\\s"]*"[^"]*"[^\\s"]*|[^\\s]+/g) || [];
  for (const token of tokens) {
    const match = /^([a-zA-Z]+):(.*)$/.exec(token);
    if (match && FILTER_KEYS.includes(match[1].toLowerCase())) {
      const key = match[1].toLowerCase();
      const value = match[2].replace(/^"|"$/g, "").trim();
      if (!value) {
        continue;
      }
      if (key === "source") {
        const s = value.toLowerCase();
        filters.source = (s === "claude" || s === "claude-code" || s === "claudecode") ? "claude" : (s === "codex" ? "codex" : "");
      } else if (key === "role") {
        filters.roles.push(value.toLowerCase());
      } else if (key === "project") {
        filters.projects.push(value.toLowerCase());
      } else if (key === "before" || key === "after") {
        const time = Date.parse(value);
        if (Number.isFinite(time)) {
          filters[key] = time;
        }
      }
      continue;
    }
    if (token.length > 1 && token[0] === "-" && token[1] !== ":") {
      filters.excludes.push(token.slice(1).replace(/^"|"$/g, "").toLowerCase());
      continue;
    }
    textParts.push(token.replace(/"/g, ""));
  }
  return { text: textParts.join(" ").trim(), filters };
}

function normalizeMs(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return num < 1e12 ? num * 1000 : num;
}

function isWordChar(ch) {
  return !!ch && /[A-Za-z0-9_]/.test(ch);
}

function includesWholeWord(hay, term, caseSensitive) {
  const haystack = caseSensitive ? hay : hay.toLowerCase();
  const needle = caseSensitive ? term : term.toLowerCase();
  if (!needle) {
    return true;
  }
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) {
      return false;
    }
    const before = idx === 0 ? "" : haystack[idx - 1];
    const after = idx + needle.length >= haystack.length ? "" : haystack[idx + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) {
      return true;
    }
    from = idx + 1;
  }
  return false;
}

function resultMatchesFlags(result, terms, flags) {
  if (!terms.length || (!flags.caseSensitive && !flags.wholeWord)) {
    return true;
  }
  const hay = String(result.title || "") + " " + String(result.snippet || "");
  return terms.every((term) => {
    const needle = String(term || "");
    if (!needle) {
      return true;
    }
    if (flags.wholeWord) {
      return includesWholeWord(hay, needle, flags.caseSensitive);
    }
    return hay.indexOf(needle) >= 0;
  });
}

function computeFilteredResults() {
  const filters = state.search.filters || { source: "", roles: [], projects: [], before: 0, after: 0, excludes: [] };
  const flags = state.search.flags;
  const terms = state.search.mode === "semantic" ? [] : (state.search.terms || []);
  return (state.search.rawResults || []).filter((result) => {
    const cwd = String(result.displayCwd || result.cwd || "").toLowerCase();
    const role = String(result.role || result.label || "").toLowerCase();
    const hay = (String(result.title || "") + " " + String(result.snippet || "")).toLowerCase();
    if (filters.projects.length && !filters.projects.some((project) => cwd.includes(project))) {
      return false;
    }
    if (filters.roles.length && !filters.roles.some((wanted) => role.includes(wanted))) {
      return false;
    }
    const mtime = normalizeMs(result.mtime);
    if (filters.before && mtime && mtime >= filters.before) {
      return false;
    }
    if (filters.after && mtime && mtime <= filters.after) {
      return false;
    }
    if (filters.excludes.length && filters.excludes.some((word) => hay.includes(word))) {
      return false;
    }
    if (!resultMatchesFlags(result, terms, flags)) {
      return false;
    }
    return true;
  });
}

function reapplyClientFilters() {
  state.search.results = computeFilteredResults();
  state.search.active = 0;
  renderSearch();
}

function renderFacets() {
  const el = $("searchFacets");
  if (!el) {
    return;
  }
  const raw = state.search.rawResults || [];
  if (!state.search.query || !raw.length) {
    el.innerHTML = "";
    return;
  }
  const filters = state.search.filters || { source: "", projects: [] };
  const sources = new Map();
  const projects = new Map();
  for (const result of raw) {
    const label = result.engineLabel || "Codex";
    const key = /claude/i.test(label) ? "claude" : "codex";
    const entry = sources.get(key) || { key, label, count: 0 };
    entry.count += 1;
    sources.set(key, entry);
    const path = String(result.displayCwd || result.cwd || "").trim();
    if (path) {
      const name = path.split("/").filter(Boolean).pop() || path;
      projects.set(name, (projects.get(name) || 0) + 1);
    }
  }
  const chips = [];
  for (const entry of sources.values()) {
    const active = filters.source === entry.key;
    chips.push("<button type='button' class='facet-chip" + (active ? " active" : "") + "' data-facet-key='source' data-facet-value='" + esc(entry.key) + "'>" + esc(entry.label) + " <b>" + entry.count + "</b></button>");
  }
  const topProjects = Array.from(projects.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [name, count] of topProjects) {
    const active = filters.projects.includes(name.toLowerCase());
    chips.push("<button type='button' class='facet-chip" + (active ? " active" : "") + "' data-facet-key='project' data-facet-value='" + esc(name) + "'>" + esc(name) + " <b>" + count + "</b></button>");
  }
  el.innerHTML = chips.join("");
}

function toggleQueryToken(key, value, single) {
  const input = $("globalSearch");
  const quoted = value.indexOf(" ") >= 0 ? '"' + value + '"' : value;
  const tokenRe = new RegExp("(?:^| )" + key + ":\\\"?" + escapeRegExp(value) + "\\\"?(?= |$)", "i");
  let next;
  if (tokenRe.test(input.value)) {
    next = input.value.replace(tokenRe, " ").replace(/ +/g, " ").trim();
  } else {
    let base = input.value;
    if (single) {
      base = base.replace(new RegExp("(?:^| )" + key + ":[^ ]+", "gi"), " ").replace(/ +/g, " ").trim();
    }
    next = (base + " " + key + ":" + quoted).replace(/ +/g, " ").trim();
  }
  input.value = next;
  input.focus();
  scheduleSearch(0);
}

async function runSearch() {
  const query = $("globalSearch").value.trim();
  state.search.query = query;
  state.search.error = "";
  const parsed = parseSearchQuery(query);
  state.search.filters = parsed.filters;
  state.search.textEmpty = !parsed.text;
  if (!parsed.text) {
    state.search.loading = false;
    state.search.results = [];
    state.search.rawResults = [];
    state.search.terms = [];
    state.search.matched = 0;
    state.search.scanned = 0;
    state.search.indexed = 0;
    state.search.indexedChunks = 0;
    state.search.updated = 0;
    state.search.pending = 0;
    state.search.failed = 0;
    state.search.model = "";
    renderSearch();
    return;
  }

  const requestToken = state.search.requestToken + 1;
  state.search.requestToken = requestToken;
  state.search.loading = true;
  renderSearch();

  const semanticMode = state.search.mode === "semantic";
  const params = new URLSearchParams({
    q: parsed.text,
    source: parsed.filters.source || "all",
    limit: "24",
    scanLimit: String(semanticMode ? SEMANTIC_SEARCH_SCAN_LIMIT : SEARCH_SCAN_LIMIT),
    completeOnly: "1",
    includeTools: "1",
    includeToolOutput: "0",
  });
  const cwd = searchScopeCwd();
  if (cwd) {
    params.set("cwd", cwd);
  }
  if (semanticMode) {
    params.set("updateLimit", String(SEMANTIC_SEARCH_UPDATE_LIMIT));
  }

  try {
    const response = await fetch((semanticMode ? "/api/semantic-search?" : "/api/search?") + params.toString());
    const payload = await response.json();
    if (requestToken !== state.search.requestToken) {
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "Search failed");
    }
    state.search.rawResults = Array.isArray(payload.results) ? payload.results : [];
    state.search.terms = Array.isArray(payload.terms) ? payload.terms : [];
    state.search.results = computeFilteredResults();
    state.search.active = 0;
    state.search.matched = Number(payload.matched || state.search.rawResults.length);
    state.search.scanned = Number(payload.scanned || 0);
    state.search.indexed = Number(payload.indexed || 0);
    state.search.indexedChunks = Number(payload.indexedChunks || 0);
    state.search.updated = Number(payload.updated || 0);
    state.search.pending = Number(payload.pending || 0);
    state.search.failed = Number(payload.failed || 0);
    state.search.model = String(payload.model || "");
  } catch (error) {
    if (requestToken !== state.search.requestToken) {
      return;
    }
    state.search.results = [];
    state.search.rawResults = [];
    state.search.terms = [];
    state.search.matched = 0;
    state.search.indexed = 0;
    state.search.indexedChunks = 0;
    state.search.updated = 0;
    state.search.pending = 0;
    state.search.model = "";
    state.search.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (requestToken === state.search.requestToken) {
      state.search.loading = false;
      renderSearch();
    }
  }
}

function renderSearch() {
  const scopeLabel = $("searchScopeLabel");
  if (scopeLabel) {
    scopeLabel.textContent = state.search.scopeLabel || "全部历史";
    scopeLabel.title = state.search.scope === "project" && state.search.cwd ? state.search.cwd : "全部历史";
  }
  for (const button of document.querySelectorAll("[data-search-mode]")) {
    const mode = button.dataset.searchMode;
    const active = mode === state.search.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  const semantic = state.search.mode === "semantic";
  for (const button of document.querySelectorAll("[data-search-flag]")) {
    const on = !!state.search.flags[button.dataset.searchFlag];
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.disabled = semantic;
  }
  const prewarmButton = $("prewarmIndex");
  if (prewarmButton) {
    const semanticMode = state.search.mode === "semantic";
    prewarmButton.hidden = !semanticMode;
    prewarmButton.disabled = !semanticMode || (state.search.loading && !state.semanticWarmup.running);
    prewarmButton.textContent = state.semanticWarmup.running ? "停止预热" : state.semanticWarmup.complete ? "已预热" : "预热索引";
    if (state.semanticWarmup.running) {
      prewarmButton.setAttribute("aria-busy", "true");
    } else {
      prewarmButton.removeAttribute("aria-busy");
    }
  }

  const status = $("searchStatus");
  if (state.search.mode === "semantic" && state.semanticWarmup.running) {
    status.textContent = semanticWarmupStatus("预热中");
  } else if (state.search.mode === "semantic" && state.semanticWarmup.error && !state.search.query) {
    status.textContent = state.semanticWarmup.error;
  } else if (state.search.mode === "semantic" && state.semanticWarmup.complete && !state.search.query) {
    status.textContent = semanticWarmupStatus("预热完成");
  } else if (state.search.loading) {
    status.textContent = state.search.mode === "semantic" ? "正在更新本机语义索引..." : "正在搜索...";
  } else if (state.search.error) {
    status.textContent = state.search.error;
  } else if (state.search.query) {
    const failed = state.search.failed ? "，跳过 " + state.search.failed + " 条" : "";
    if (state.search.mode === "semantic") {
      const updated = state.search.updated ? "，更新 " + state.search.updated + " 条" : "";
      const pending = state.search.pending ? "，待补 " + state.search.pending + " 条" : "";
      const model = state.search.model ? " · " + state.search.model : "";
      status.textContent = "命中 " + state.search.matched + " / 索引 " + state.search.indexed + " / 扫描 " + state.search.scanned + updated + pending + failed + model;
    } else {
      status.textContent = "命中 " + state.search.matched + " / 扫描 " + state.search.scanned + failed;
    }
  } else {
    status.textContent = "";
  }

  renderFacets();

  const globalInput = $("globalSearch");
  if (state.search.loading) {
    globalInput.removeAttribute("aria-activedescendant");
    $("searchResults").innerHTML = renderLoading("正在搜索会话...");
    return;
  }
  if (!state.search.query) {
    globalInput.removeAttribute("aria-activedescendant");
    $("searchResults").innerHTML = "<div class='search-empty'>" + (state.search.mode === "semantic" ? "输入大意开始语义搜索" : "输入关键词开始搜索") + "</div>";
    return;
  }
  if (state.search.textEmpty) {
    globalInput.removeAttribute("aria-activedescendant");
    $("searchResults").innerHTML = "<div class='search-empty'>请输入关键词（可搭配 source: / project: 等过滤）</div>";
    updateSearchCount();
    return;
  }
  if (state.search.error) {
    globalInput.removeAttribute("aria-activedescendant");
    $("searchResults").innerHTML = "<div class='search-empty'>" + esc(state.search.error) + "</div>";
    return;
  }
  if (!state.search.results.length) {
    const hint = (state.search.rawResults && state.search.rawResults.length)
      ? "过滤后没有会话，试着放宽筛选条件"
      : "没有匹配的会话";
    $("searchResults").innerHTML = "<div class='search-empty'>" + hint + "</div>";
    updateSearchCount();
    return;
  }
  if (state.search.active >= state.search.results.length || state.search.active < 0) {
    state.search.active = 0;
  }
  $("searchResults").innerHTML = state.search.results.map(renderSearchResult).join("");
  updateSearchActive({ preview: false, scroll: false });
  updateSearchCount();
}

function renderSearchResult(result, index) {
  const ref = result.ref || "";
  const title = result.title || ref || "Untitled session";
  const path = result.displayCwd || result.cwd || "普通会话";
  const source = [result.engineLabel || "Codex", relativeTime(result.mtime)].filter(Boolean).join(" · ");
  const score = state.search.mode === "semantic" ? Math.round(Number(result.score || 0) * 100) + "%" : "";
  const label = [result.label || result.role || "Match", result.turn ? "#" + result.turn : "", score].filter(Boolean).join(" ");
  const snippet = state.search.mode === "semantic"
    ? esc(result.snippet || "")
    : highlightSearchSnippet(result.snippet || "", result.terms || state.search.terms);
  const active = index === state.search.active;
  return "<div class='search-result" + (active ? " active" : "") + "' role='option' id='search-result-" + index + "' aria-selected='" + (active ? "true" : "false") + "' data-search-index='" + index + "' data-search-result='" + esc(ref) + "'>" +
    "<strong class='search-result-title'>" + esc(title) + "</strong>" +
    "<span class='search-result-source'>" + esc(source) + "</span>" +
    "<span class='search-result-path'>" + esc(path) + "</span>" +
    "<p class='search-result-snippet'>" + snippet + "</p>" +
    "<span class='search-result-meta'>" + esc(label) + "</span>" +
    "<div class='search-result-actions'>" +
      "<button type='button' class='sr-act' data-sr-action='open' title='打开会话（↵）'>打开</button>" +
      "<button type='button' class='sr-act' data-sr-action='in-session' title='打开并在此会话内搜索'>会话内搜</button>" +
      (result.engine !== "trae" ? "<button type='button' class='sr-act sr-act-orca' data-sr-action='resume-orca' title='在 Orca 中打开终端并恢复此会话'>↗ Orca 继续</button>" : "") +
      "<button type='button' class='sr-act' data-sr-action='export-html' title='导出为 HTML'>导出 HTML</button>" +
      "<button type='button' class='sr-act' data-sr-action='copy-path' title='复制项目路径'>复制路径</button>" +
    "</div>" +
  "</div>";
}

function updateSearchActive(options = {}) {
  const nodes = Array.from(document.querySelectorAll("[data-search-index]"));
  const input = $("globalSearch");
  nodes.forEach((node) => {
    const index = Number(node.dataset.searchIndex);
    const active = index === state.search.active;
    node.classList.toggle("active", active);
    node.setAttribute("aria-selected", active ? "true" : "false");
    if (active) {
      if (input) {
        input.setAttribute("aria-activedescendant", node.id);
      }
      if (options.scroll !== false) {
        node.scrollIntoView({ block: "nearest" });
      }
    }
  });
  if (options.preview) {
    schedulePreview();
  }
}

function moveSearchActive(delta) {
  if (!state.search.results.length) {
    return;
  }
  const count = state.search.results.length;
  state.search.active = (state.search.active + delta + count) % count;
  updateSearchActive({ preview: true, scroll: true });
}

function updateSearchCount() {
  const el = $("searchCount");
  if (!el) {
    return;
  }
  if (!state.search.query || state.search.loading || state.search.error) {
    el.textContent = "";
    return;
  }
  const shown = state.search.results.length;
  if (!shown) {
    el.textContent = "";
    return;
  }
  const raw = (state.search.rawResults || []).length;
  if (raw && shown < raw) {
    el.textContent = shown + " / 候选 " + raw + " 个会话";
    return;
  }
  const matched = Math.max(shown, state.search.matched || shown);
  el.textContent = matched > shown
    ? "显示前 " + shown + " / 命中 " + matched + " 个会话"
    : shown + " 个会话";
}

function schedulePreview(delay = 200) {
  if (previewTimer) {
    clearTimeout(previewTimer);
  }
  previewTimer = setTimeout(() => {
    previewTimer = 0;
    previewActiveResult();
  }, delay);
}

async function previewActiveResult() {
  const result = state.search.results[state.search.active];
  if (!result || !result.ref) {
    return;
  }
  if (result.session) {
    appendSessions([result.session]);
    state.activeSource = visibleSourceKey(sessionEngine(result.session));
  }
  state.search.previewRef = result.ref;
  await previewSession(result.ref, result.turn);
}

async function previewSession(id, turn) {
  if (!id) {
    return;
  }
  const cached = state.snapshotCache.get(id);
  if (cached) {
    state.selected = id;
    renderSessions();
    renderSnapshot(cached);
    if (turn) {
      focusTurn(turn);
    }
    return;
  }
  const token = state.previewToken + 1;
  state.previewToken = token;
  state.requestToken += 1;
  state.selected = id;
  renderSessions();
  showViewerLoading("正在预览会话...");
  try {
    const params = new URLSearchParams({
      id,
      includeTools: "1",
      includeToolOutput: "0",
      redact: $("redact").checked ? "1" : "0",
      safety: SAFETY_CHECKS_ENABLED ? "1" : "0",
    });
    const response = await fetch("/api/snapshot?" + params.toString());
    const snapshot = await response.json();
    if (token !== state.previewToken || state.selected !== id) {
      return;
    }
    if (snapshot.error) {
      $("title").textContent = "会话加载失败";
      $("meta").textContent = "会话内容加载失败。";
      $("turns").innerHTML = "<div class='meta'>" + esc(snapshot.error) + "</div>";
      return;
    }
    state.snapshotCache.set(id, snapshot);
    renderSnapshot(snapshot);
    if (turn) {
      focusTurn(turn);
    }
  } catch (error) {
    if (token === state.previewToken) {
      $("turns").innerHTML = "<div class='meta'>" + esc(error instanceof Error ? error.message : String(error)) + "</div>";
    }
  }
}

async function runSearchResultAction(action, ref) {
  const result = state.search.results.find((item) => item.ref === ref);
  if (!result) {
    return;
  }
  if (action === "open") {
    await selectSearchResult(ref);
    return;
  }
  if (action === "in-session") {
    await selectSearchResult(ref);
    const input = $("sessionSearchInput");
    if (input && !input.disabled) {
      input.focus();
    }
    return;
  }
  if (action === "resume-orca") {
    resumeInOrca(ref, result.cwd || result.displayCwd || "", result.title || "");
    return;
  }
  if (action === "export-html" || action === "export-md") {
    const params = new URLSearchParams({
      id: ref,
      includeTools: "1",
      includeToolOutput: "0",
      redact: $("redact").checked ? "1" : "0",
      safety: SAFETY_CHECKS_ENABLED ? "1" : "0",
      format: action === "export-md" ? "md" : "html",
    });
    window.open("/export?" + params.toString(), "_blank", "noopener,noreferrer");
    return;
  }
  if (action === "copy-path") {
    const path = String(result.displayCwd || result.cwd || "").trim();
    if (path && navigator.clipboard) {
      navigator.clipboard.writeText(path).catch(() => {});
    }
  }
}

function resetSessionSearchState(keepQuery) {
  const query = keepQuery ? state.sessionSearch.query : "";
  state.sessionSearch = { query, loading: false, results: [], chunkCount: 0, model: "", error: "", requestToken: state.sessionSearch.requestToken + 1 };
  const input = $("sessionSearchInput");
  if (input && !keepQuery) {
    input.value = "";
  }
}

let sessionSearchTimer = 0;
function scheduleSessionSearch(delay = 260) {
  if (sessionSearchTimer) {
    clearTimeout(sessionSearchTimer);
  }
  sessionSearchTimer = setTimeout(() => {
    sessionSearchTimer = 0;
    runSessionSearch();
  }, delay);
}

async function runSessionSearch() {
  const input = $("sessionSearchInput");
  const query = input.value.trim();
  state.sessionSearch.query = query;
  state.sessionSearch.error = "";
  if (!state.selected || !state.currentSnapshot) {
    state.sessionSearch.loading = false;
    state.sessionSearch.results = [];
    state.sessionSearch.error = "先选择一个会话。";
    renderSessionSearch();
    return;
  }
  if (!query) {
    resetSessionSearchState(true);
    renderSessionSearch();
    return;
  }

  const requestToken = state.sessionSearch.requestToken + 1;
  state.sessionSearch.requestToken = requestToken;
  state.sessionSearch.loading = true;
  state.sessionSearch.results = [];
  renderSessionSearch();

  const params = activeOptions();
  params.set("q", query);
  params.set("limit", "8");

  try {
    const response = await fetch("/api/session-search?" + params.toString());
    const payload = await response.json();
    if (requestToken !== state.sessionSearch.requestToken) {
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "Semantic search failed");
    }
    state.sessionSearch.results = Array.isArray(payload.results) ? payload.results : [];
    state.sessionSearch.chunkCount = Number(payload.chunkCount || 0);
    state.sessionSearch.model = String(payload.model || "");
  } catch (error) {
    if (requestToken !== state.sessionSearch.requestToken) {
      return;
    }
    state.sessionSearch.results = [];
    state.sessionSearch.chunkCount = 0;
    state.sessionSearch.model = "";
    state.sessionSearch.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (requestToken === state.sessionSearch.requestToken) {
      state.sessionSearch.loading = false;
      renderSessionSearch();
    }
  }
}

function renderSessionSearch() {
  const input = $("sessionSearchInput");
  const button = $("sessionSearchRun");
  const status = $("sessionSearchStatus");
  const results = $("sessionSearchResults");
  if (!input || !button || !status || !results) {
    return;
  }

  const hasSnapshot = Boolean(state.selected && state.currentSnapshot);
  input.disabled = !hasSnapshot;
  button.disabled = !hasSnapshot || state.sessionSearch.loading;
  if (!hasSnapshot) {
    status.textContent = "选择会话后可用";
    results.innerHTML = "";
    return;
  }
  if (state.sessionSearch.loading) {
    status.textContent = "正在调用本机 embedding...";
  } else if (state.sessionSearch.error) {
    status.textContent = state.sessionSearch.error;
  } else if (state.sessionSearch.query) {
    const count = state.sessionSearch.results.length;
    const model = state.sessionSearch.model ? " · " + state.sessionSearch.model : "";
    status.textContent = "命中 " + count + " / " + state.sessionSearch.chunkCount + model;
  } else {
    status.textContent = "本机 Ollama / qwen3-embedding:0.6b";
  }

  if (state.sessionSearch.loading) {
    results.innerHTML = renderLoading("正在语义搜索当前会话...");
    return;
  }
  if (!state.sessionSearch.query || state.sessionSearch.error) {
    results.innerHTML = "";
    return;
  }
  if (!state.sessionSearch.results.length) {
    results.innerHTML = "<div class='search-empty'>没有匹配片段</div>";
    return;
  }
  results.innerHTML = state.sessionSearch.results.map(renderSessionSearchResult).join("");
}

function renderSessionSearchResult(result) {
  const turn = Number(result.turn || 0);
  const score = Math.round(Number(result.score || 0) * 100);
  const label = [
    result.sourceLabel && result.sourceLabel !== "Session" ? result.sourceLabel : "",
    result.label || result.role || "Message",
    turn ? "#" + turn : "",
  ].filter(Boolean).join(" · ");
  return "<div class='session-search-result' role='button' tabindex='0' data-session-search-turn='" + esc(turn || "") + "'>" +
    "<b>" + esc(label || "Match") + "</b>" +
    "<em>" + esc(score) + "%</em>" +
    "<span>" + esc(result.snippet || result.text || "") + "</span>" +
  "</div>";
}

function focusTurn(turnNumber) {
  const target = Array.from(document.querySelectorAll("[data-turn-number]"))
    .find((item) => item.getAttribute("data-turn-number") === String(turnNumber));
  if (!target) {
    return false;
  }
  const details = target.closest("details");
  if (details) {
    details.open = true;
  }
  document.querySelectorAll(".semantic-hit-current").forEach((item) => item.classList.remove("semantic-hit-current"));
  target.classList.add("semantic-hit-current");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target.classList.remove("semantic-hit-current"), 2400);
  return true;
}

function highlightSearchSnippet(text, terms) {
  const source = String(text || "");
  const needles = Array.from(new Set((terms || []).map((term) => String(term || "").trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);
  if (!needles.length) {
    return esc(source);
  }
  const pattern = needles.map(escapeRegExp).join("|");
  if (!pattern) {
    return esc(source);
  }
  const matcher = new RegExp("(" + pattern + ")", "gi");
  return esc(source).replace(matcher, "<mark>$1</mark>");
}

function escapeRegExp(value) {
  return String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

async function selectSearchResult(ref) {
  if (!ref) {
    return;
  }
  const result = state.search.results.find((item) => item.ref === ref);
  if (result?.session) {
    appendSessions([result.session]);
    state.activeSource = visibleSourceKey(sessionEngine(result.session));
  }
  // Commit: the live preview may already show this session — reuse it if cached.
  closeSearchDialog(true);
  if (state.snapshotCache.has(ref)) {
    state.selected = ref;
    renderSessions();
    renderSnapshot(state.snapshotCache.get(ref));
    if (result?.turn) {
      focusTurn(result.turn);
    }
    return;
  }
  await selectSession(ref);
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sidebarMaxWidth() {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - 520));
}

function currentSidebarWidth() {
  const sidebar = document.querySelector(".sidebar");
  return sidebar ? sidebar.getBoundingClientRect().width : 360;
}

function setSidebarWidth(value, persist) {
  if (window.matchMedia("(max-width: 900px)").matches) {
    return;
  }
  const width = Math.round(clampNumber(Number(value) || currentSidebarWidth(), SIDEBAR_MIN, sidebarMaxWidth()));
  document.documentElement.style.setProperty("--sidebar-width", width + "px");
  const splitter = $("splitter");
  if (splitter) {
    splitter.setAttribute("aria-valuenow", String(width));
    splitter.setAttribute("aria-valuetext", width + "px");
  }
  if (persist) {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }
}

function currentTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  return THEMES.includes(stored) ? stored : "light";
}

function applyTheme(theme) {
  const value = THEMES.includes(theme) ? theme : "light";
  document.documentElement.setAttribute("data-theme", value);
  localStorage.setItem(THEME_KEY, value);
  for (const button of document.querySelectorAll("[data-theme-set]")) {
    button.classList.toggle("active", button.dataset.themeSet === value);
  }
}

function currentDensity() {
  return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
}

function applyDensity(density) {
  const value = density === "compact" ? "compact" : "comfortable";
  document.documentElement.setAttribute("data-density", value);
  localStorage.setItem(DENSITY_KEY, value);
  const toggle = document.querySelector("[data-density-toggle]");
  if (toggle) {
    toggle.classList.toggle("active", value === "compact");
    toggle.textContent = value === "compact" ? "疏" : "密";
    toggle.title = value === "compact" ? "当前紧凑，点击切换为宽松" : "当前宽松，点击切换为紧凑";
  }
}

function currentReadScale() {
  const stored = Number(localStorage.getItem(READ_SCALE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) {
    return 1;
  }
  return clampNumber(stored, READ_SCALE_MIN, READ_SCALE_MAX);
}

function applyReadScale(scale) {
  const value = clampNumber(Number(scale) || 1, READ_SCALE_MIN, READ_SCALE_MAX);
  const rounded = Math.round(value * 100) / 100;
  document.documentElement.style.setProperty("--read-scale", String(rounded));
  localStorage.setItem(READ_SCALE_KEY, String(rounded));
}

function stepReadScale(direction) {
  applyReadScale(currentReadScale() + (direction < 0 ? -READ_SCALE_STEP : READ_SCALE_STEP));
}

function initAppearance() {
  applyTheme(currentTheme());
  applyDensity(currentDensity());
  applyReadScale(currentReadScale());
  for (const button of document.querySelectorAll("[data-theme-set]")) {
    button.addEventListener("click", () => applyTheme(button.dataset.themeSet));
  }
  for (const button of document.querySelectorAll("[data-font-step]")) {
    button.addEventListener("click", () => stepReadScale(Number(button.dataset.fontStep) || 1));
  }
  const density = document.querySelector("[data-density-toggle]");
  if (density) {
    density.addEventListener("click", () => applyDensity(currentDensity() === "compact" ? "comfortable" : "compact"));
  }
}

function initSplitter() {
  const splitter = $("splitter");
  const app = document.querySelector(".app");
  if (!splitter || !app) {
    return;
  }
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  setSidebarWidth(Number.isFinite(saved) ? saved : currentSidebarWidth(), false);

  const widthFromPointer = (event) => event.clientX - app.getBoundingClientRect().left;
  const stopResize = (event) => {
    app.classList.remove("resizing");
    try {
      splitter.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture may already be released when the pointer leaves the window.
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  };
  const onPointerMove = (event) => {
    event.preventDefault();
    setSidebarWidth(widthFromPointer(event), true);
  };

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    app.classList.add("resizing");
    splitter.setPointerCapture(event.pointerId);
    setSidebarWidth(widthFromPointer(event), true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  });

  splitter.addEventListener("keydown", (event) => {
    const current = Number(splitter.getAttribute("aria-valuenow")) || currentSidebarWidth();
    const step = event.shiftKey ? 40 : 16;
    let next = current;
    if (event.key === "ArrowLeft") next = current - step;
    else if (event.key === "ArrowRight") next = current + step;
    else if (event.key === "Home") next = SIDEBAR_MIN;
    else if (event.key === "End") next = sidebarMaxWidth();
    else return;
    event.preventDefault();
    setSidebarWidth(next, true);
  });

  window.addEventListener("resize", () => setSidebarWidth(currentSidebarWidth(), true));
}

async function loadSessions() {
  setViewerLoading("正在加载会话...");
  $("sessions").classList.add("sessions-loading");
  $("sessions").innerHTML = renderLoading("正在加载会话...");
  $("sessions").setAttribute("aria-busy", "true");
  $("reload").disabled = true;
  state.sessions = [];
  state.hasMoreSessions = false;
  state.loadingMoreSessions = false;
  state.sessionListError = "";
  try {
    const sessions = await fetchSessionPage(0);
    state.sessions = sessions;
    state.hasMoreSessions = sessions.length === SESSION_BATCH_LIMIT;
    state.activeSource = visibleSourceKey(state.activeSource);
    if (!sourceSessions(state.activeSource).length) {
      const firstSourceWithSessions = SOURCE_MODULES.find((source) => sourceSessions(source.key).length);
      if (firstSourceWithSessions) {
        state.activeSource = firstSourceWithSessions.key;
      }
    }
    await selectFirstSessionForActiveSource();
  } catch (error) {
    state.sessionListError = error instanceof Error ? error.message : String(error);
    renderSessions();
    clearViewer("会话列表加载失败。");
  } finally {
    $("sessions").classList.remove("sessions-loading");
    $("sessions").removeAttribute("aria-busy");
    $("reload").disabled = false;
  }
}

async function fetchSessionPage(offset) {
  const query = new URLSearchParams({
    source: "all",
    limit: String(SESSION_BATCH_LIMIT),
    offset: String(Math.max(0, Number(offset) || 0)),
  });
  const response = await fetch("/api/sessions?" + query.toString());
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Failed to load sessions");
  }
  return Array.isArray(result) ? result : [];
}

function appendSessions(sessions) {
  const seen = new Set(state.sessions.map(sessionRef));
  const nextSessions = [];
  for (const session of sessions) {
    const ref = sessionRef(session);
    if (!seen.has(ref)) {
      seen.add(ref);
      nextSessions.push(session);
    }
  }
  state.sessions = state.sessions.concat(nextSessions);
}

async function loadMoreSessions() {
  if (state.loadingMoreSessions || !state.hasMoreSessions) {
    return;
  }
  state.loadingMoreSessions = true;
  state.sessionListError = "";
  renderSessions();
  try {
    const sessions = await fetchSessionPage(state.sessions.length);
    appendSessions(sessions);
    state.hasMoreSessions = sessions.length === SESSION_BATCH_LIMIT;
    if (!state.selected && sourceSessions(state.activeSource).length) {
      await selectFirstSessionForActiveSource();
      return;
    }
  } catch (error) {
    state.sessionListError = error instanceof Error ? error.message : String(error);
  } finally {
    state.loadingMoreSessions = false;
    renderSessions();
  }
}

function renderSessions() {
  $("sessions").classList.remove("sessions-loading");
  state.activeSource = visibleSourceKey(state.activeSource);
  const source = sourceByKey(state.activeSource);
  const sessions = sourceSessions(source.key);
  const groups = groupSessions(sessions);
  const body = groups.length
    ? groups.map(renderProjectGroup).join("")
    : "<div class='source-empty'>暂无会话</div>";
  $("sessions").innerHTML = renderSourceSwitcher() + body + renderLoadMore();
}

function renderSourceSwitcher() {
  return "<div class='source-switcher' role='tablist' aria-label='Session source'>" +
    SOURCE_MODULES.map((source) => {
      const count = sourceSessions(source.key).length;
      const active = source.key === state.activeSource;
      return "<button class='source-tab" + (active ? " active" : "") + "' type='button' role='tab' aria-selected='" + (active ? "true" : "false") + "' data-source='" + esc(source.key) + "'>" +
        "<span>" + esc(source.label) + "</span>" +
        "<b>" + esc(count) + "</b>" +
      "</button>";
    }).join("") +
  "</div>";
}

function renderLoadMore() {
  if (!state.hasMoreSessions && !state.loadingMoreSessions && !state.sessionListError) {
    return "";
  }
  const button = state.hasMoreSessions || state.loadingMoreSessions
    ? "<button class='sessions-load-more' type='button' data-load-more='1'" + (state.loadingMoreSessions ? " disabled aria-busy='true'" : "") + ">" + (state.loadingMoreSessions ? "正在加载..." : "加载更多") + "</button>"
    : "";
  const status = state.sessionListError
    ? "<span class='load-more-meta load-more-error'>" + esc(state.sessionListError) + "</span>"
    : "<span class='load-more-meta'>已加载 " + esc(state.sessions.length) + " 条</span>";
  return "<div class='load-more-row'>" + button + status + "</div>";
}

function sourceByKey(key) {
  return SOURCE_MODULES.find((source) => source.key === key) || SOURCE_MODULES[0];
}

function visibleSourceKey(key) {
  return sourceByKey(key).key;
}

function sourceSessions(key) {
  return state.sessions.filter((session) => sessionEngine(session) === key);
}

async function selectFirstSessionForActiveSource() {
  state.activeSource = visibleSourceKey(state.activeSource);
  const sessions = sourceSessions(state.activeSource);
  if (!sessions.length) {
    state.selected = "";
    renderSessions();
    clearViewer(sourceByKey(state.activeSource).label + " 暂无可审阅会话。");
    return;
  }
  const selected = sessions.find((session) => sessionRef(session) === state.selected);
  await selectSession(sessionRef(selected || sessions[0]));
}

function setViewerLoading(message) {
  state.requestToken += 1;
  showViewerLoading(message);
}

function clearViewer(message) {
  state.requestToken += 1;
  state.currentSnapshot = null;
  resetSessionSearchState(false);
  renderSessionSearch();
  $("title").textContent = "选择一个会话";
  $("meta").textContent = message || "还没有选择会话。";
  $("meta").classList.add("empty");
  $("meta").classList.remove("loading");
  $("meta").removeAttribute("aria-busy");
  $("goal").innerHTML = "";
  $("risks").innerHTML = "";
  $("exports").innerHTML = "";
  $("turns").innerHTML = "";
}

function sessionEngine(session) {
  return session.engine || "codex";
}

function sessionRef(session) {
  return session.ref || (sessionEngine(session) + ":" + session.id);
}

function groupSessions(sessions, filter) {
  const groupMap = new Map();
  for (const session of sessions) {
    const key = projectKey(session);
    const isNoProject = isNoProjectSession(session);
    if (!groupMap.has(key)) {
      const ephemeral = isNoProject ? null : ephemeralAgentInfo(session);
      const searchCwd = isNoProject || ephemeral ? "" : projectPath(session);
      groupMap.set(key, {
        key,
        label: ephemeral ? ephemeral.prefix : projectLabel(session),
        displayPath: ephemeral ? "临时 agent 运行 · " + ephemeral.prefix + "-*" : projectDisplayPath(session),
        searchCwd,
        isNoProject,
        isEphemeral: Boolean(ephemeral),
        newestMs: 0,
        sessions: [],
      });
    }
    const group = groupMap.get(key);
    group.sessions.push(session);
    const mtime = new Date(session.mtime).getTime();
    if (Number.isFinite(mtime)) {
      group.newestMs = Math.max(group.newestMs, mtime);
    }
  }
  const groups = sortProjectGroups(Array.from(groupMap.values()));
  if (!filter) {
    return groups;
  }
  return sortProjectGroups(groups.map((group) => {
    const projectHaystack = (group.label + " " + group.displayPath + " " + group.key).toLowerCase();
    const projectMatches = projectHaystack.includes(filter);
    const filteredSessions = projectMatches
      ? group.sessions
      : group.sessions.filter((session) => sessionHaystack(session, group).includes(filter));
    return { ...group, sessions: filteredSessions };
  }).filter((group) => group.sessions.length));
}

// Eval/judge harnesses (and headless claude -p runs) execute each agent in its
// own throwaway temp directory such as
// /private/var/folders/<x>/<y>/T/judge-cl-k5jv9X or /tmp/eval-2CwQp3.
// Every one of those would otherwise become its own sidebar "project". Collapse
// them into a single parent group per prefix so the spawned agents nest under
// their batch instead of flooding the list.
function ephemeralAgentInfo(session) {
  // NOTE: this runs inside a template literal, so backslash-heavy regexes get
  // mangled by template escaping. Detect the temp path with plain string ops
  // and keep the only regex backslash-free.
  const cwd = normalizeProjectPath(projectPath(session));
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const base = parts[parts.length - 1];
  const parent = parts[parts.length - 2];
  // System temp roots: macOS var/folders/<x>/<y>/T/<name>, or /tmp/<name>.
  const underTemp = parent === "tmp" || (parent === "T" && parts.indexOf("folders") !== -1);
  if (!underTemp) {
    return null;
  }
  // Collapse the generated suffix of an ephemeral run dir: <prefix>-<id> ->
  // <prefix>. Gated on the temp root above, so a 5-16 char alphanumeric tail
  // is safe to treat as a generated id (eval-ne05uj, judge-cl-k8qxz2, ...).
  const split = base.match(/^(.+)-([A-Za-z0-9_]{5,16})$/);
  if (!split) {
    return null;
  }
  return { prefix: split[1], base: base };
}

function projectKey(session) {
  if (isNoProjectSession(session)) {
    return sessionEngine(session) + "::no-project";
  }
  const ephemeral = ephemeralAgentInfo(session);
  if (ephemeral) {
    return sessionEngine(session) + "::agent::" + ephemeral.prefix;
  }
  return sessionEngine(session) + "::" + projectPath(session);
}

function isNoProjectSession(session) {
  if (session.projectKind === "none" || session.projectKind === "conversation") {
    return true;
  }
  const cwd = projectPath(session);
  return !cwd || cwd === "/" || cwd === "No project" || isCodexStandaloneConversationPath(session);
}

function isCodexStandaloneConversationPath(session) {
  if (sessionEngine(session) !== "codex") {
    return false;
  }
  return [session.cwd, session.displayCwd].some(isStandaloneConversationPath);
}

function isStandaloneConversationPath(value) {
  const parts = normalizeProjectPath(value).split("/").filter(Boolean);
  const codexIndex = parts.findIndex((part, index) => part === "Codex" && parts[index - 1] === "Documents");
  if (codexIndex < 0 || codexIndex + 3 !== parts.length) {
    return false;
  }
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(parts[codexIndex + 1]) && Boolean(parts[codexIndex + 2]);
}

function projectDisplayPath(session) {
  return isNoProjectSession(session) ? "普通会话" : projectPath(session);
}

function projectPath(session) {
  return String(session.cwd || session.displayCwd || "").trim();
}

function normalizeProjectPath(value) {
  return String(value || "").trim().replace(/\\\\/g, "/").replace(/\\/+$/, "");
}

function projectGroupTier(group) {
  if (group.isNoProject) {
    return 2;
  }
  return group.isEphemeral ? 1 : 0;
}

function sortProjectGroups(groups) {
  return groups.slice().sort((a, b) => {
    const tier = projectGroupTier(a) - projectGroupTier(b);
    if (tier) {
      return tier;
    }
    return (b.newestMs || 0) - (a.newestMs || 0) || a.label.localeCompare(b.label);
  });
}

function projectLabel(session) {
  if (isNoProjectSession(session)) {
    return "普通会话";
  }
  const value = String(session.displayCwd || session.cwd || "No project").replace(/[\\\\/]+$/, "");
  const parts = value.split(/[\\\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value || "No project";
}

function sessionHaystack(session, group) {
  return [
    session.engineLabel,
    session.engine,
    session.title,
    session.cwd,
    session.displayCwd,
    session.id,
    session.ref,
    group.label,
    group.displayPath,
  ].filter(Boolean).join(" ").toLowerCase();
}

function renderProjectGroup(group) {
  const collapsedLimit = 5;
  const noisyExpandedLimit = 25;
  const expanded = state.expandedProjects.has(group.key);
  const collapsed = state.collapsedProjects.has(group.key);
  const activeIndex = group.sessions.findIndex((session) => sessionRef(session) === state.selected);
  const noisy = group.isNoProject || group.isEphemeral;
  const expandedLimit = noisy ? Math.min(noisyExpandedLimit, group.sessions.length) : group.sessions.length;
  const visibleLimit = expanded ? expandedLimit : Math.min(collapsedLimit, group.sessions.length);
  let visible = group.sessions.slice(0, visibleLimit);
  if (!collapsed && activeIndex >= visibleLimit) {
    visible = visible.slice(0, Math.max(0, visibleLimit - 1)).concat(group.sessions[activeIndex]);
  }
  const showToggle = !collapsed && group.sessions.length > collapsedLimit;
  const toggleLabel = expanded ? "收起" : noisy ? "显示最近 " + Math.min(noisyExpandedLimit, group.sessions.length) : "展开显示";
  const toggle = showToggle
    ? "<button class='project-more' type='button' data-project-toggle='" + esc(group.key) + "'>" + toggleLabel + "</button>"
    : "";
  const note = !collapsed && noisy && expanded && group.sessions.length > noisyExpandedLimit
    ? "<div class='project-note'>仅显示最近 " + noisyExpandedLimit + " / " + esc(group.sessions.length) + "，可搜索标题定位更多</div>"
    : "";
  const sessionList = collapsed ? "" : "<div class='session-list'>" + visible.map(renderSessionRow).join("") + "</div>";
  const sectionClass = "project-group" + (group.isNoProject ? " no-project" : "") + (collapsed ? " collapsed" : "");
  const projectSearch = group.searchCwd
    ? "<button class='project-search' type='button' data-project-search='" + esc(group.key) + "' data-project-cwd='" + esc(group.searchCwd) + "' data-project-label='" + esc(group.label) + "' title='搜索 " + esc(group.displayPath) + "' aria-label='搜索 " + esc(group.label) + "'>搜索</button>"
    : "";
  return "<section class='" + sectionClass + "'>" +
    "<div class='project-headline'>" +
      "<button class='project-header' type='button' data-project-collapse='" + esc(group.key) + "' aria-expanded='" + (collapsed ? "false" : "true") + "' title='" + esc(group.displayPath) + "'>" +
        "<span class='project-icon' aria-hidden='true'></span>" +
        "<span class='project-title'>" + esc(group.label) + "</span>" +
        "<span class='project-count'>" + esc(group.sessions.length) + "</span>" +
      "</button>" +
      projectSearch +
    "</div>" +
    sessionList +
    note +
    toggle +
  "</section>";
}

function renderSessionRow(session) {
  const ref = sessionRef(session);
  const active = ref === state.selected ? " active" : "";
  const badge = session.historyOnly ? "<span class='session-badge'>history</span>" : "";
  return "<button class='session" + active + "' data-id='" + esc(ref) + "' title='" + esc(session.title) + "'>" +
    "<strong>" + esc(session.title) + "</strong>" +
    badge +
    "<span class='session-time'>" + esc(relativeTime(session.mtime)) + "</span>" +
  "</button>";
}

function relativeTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return "";
  }
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return "刚刚";
  }
  if (diff < hour) {
    return Math.max(1, Math.floor(diff / minute)) + " 分钟";
  }
  if (diff < day) {
    return Math.max(1, Math.floor(diff / hour)) + " 小时";
  }
  if (diff < 7 * day) {
    return Math.max(1, Math.floor(diff / day)) + " 天";
  }
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(time));
}

async function selectSession(id) {
  const requestToken = state.requestToken + 1;
  state.requestToken = requestToken;
  state.selected = id;
  renderSessions();
  showViewerLoading("正在加载会话内容...");
  const response = await fetch("/api/snapshot?" + activeOptions().toString());
  const snapshot = await response.json();
  if (requestToken !== state.requestToken || id !== state.selected) {
    return;
  }
  if (snapshot.error) {
    $("title").textContent = "会话加载失败";
    $("meta").classList.add("empty");
    $("meta").classList.remove("loading");
    $("meta").removeAttribute("aria-busy");
    $("meta").textContent = "会话内容加载失败。";
    $("turns").innerHTML = "<div class='meta'>" + esc(snapshot.error) + "</div>";
    return;
  }
  renderSnapshot(snapshot);
}

function renderSnapshot(snapshot) {
  state.currentSnapshot = snapshot;
  resetSessionSearchState(false);
  $("title").textContent = snapshot.title;
  $("meta").classList.remove("empty", "loading");
  $("meta").removeAttribute("aria-busy");
  $("meta").innerHTML = renderSnapshotMeta(snapshot);
  $("goal").innerHTML = renderSnapshotGoal(snapshot);
  const notices = (snapshot.notices || []).map((notice) => {
    return "<div class='notice " + esc(notice.severity || "medium") + "'><b>NOTE</b><span><strong>" + esc(notice.label || "Notice") + ".</strong> " + esc(notice.text || "") + "</span></div>";
  }).join("");
  const risks = snapshot.risks.length ? snapshot.risks.map((risk) => {
    return "<div class='risk " + esc(risk.severity) + "'><b>" + esc(risk.severity) + "</b><span>" + esc(risk.label) + "</span><em>" + esc(formatRiskTurns(risk)) + "</em></div>";
  }).join("") : "";
  $("risks").innerHTML = snapshot.safetyChecks === false ? "" : notices + risks;
  const options = activeOptions();
  const resumeButton = snapshot.engine !== "trae"
    ? "<button type='button' class='resume-orca' data-resume-orca='" + esc(snapshot.ref || "") + "' data-resume-cwd='" + esc(snapshot.cwd || snapshot.displayCwd || "") + "' data-resume-title='" + esc(snapshot.title || "") + "' title='在 Orca 中打开终端并恢复此会话'>↗ 在 Orca 继续</button>"
    : "";
  $("exports").innerHTML = resumeButton + "<a href='/export?" + options.toString() + "&format=html' target='_blank' rel='noopener noreferrer'>导出 HTML</a><a href='/export?" + options.toString() + "&format=md' target='_blank' rel='noopener noreferrer'>导出 Markdown</a><button type='button' data-publish-cloud='1'>发布分享</button><span id='publishStatus' class='publish-status'></span>";
  $("turns").innerHTML = snapshot.transcriptHtml || "<div class='meta'>没有找到可分享的用户或助手消息。</div>";
  openContentLinksInNewTabs($("turns"));
  renderSessionSearch();
  postSnapshotState(snapshot);
}

function renderSnapshotMeta(snapshot) {
  const usage = snapshot.tokenUsage || {};
  const totalTokens = tokenUsageNumber(usage.totalTokens ?? usage.total_tokens);
  const inputTokens = tokenUsageNumber(usage.inputTokens ?? usage.input_tokens);
  const outputTokens = tokenUsageNumber(usage.outputTokens ?? usage.output_tokens);
  const tokens = totalTokens || (inputTokens + outputTokens);
  const engine = snapshot.engineLabel || "Codex";
  const cwd = String(snapshot.displayCwd || snapshot.cwd || "").trim();
  const entries = Array.isArray(snapshot.turns) ? snapshot.turns.length : 0;
  const parts = [];
  parts.push("<span class='ro'>Read-only</span>");
  parts.push("<span class='sep'>·</span><span class='k'>" + esc(engine) + "</span>");
  if (cwd) {
    parts.push("<span class='sep'>/</span><b>" + esc(cwd) + "</b>");
  }
  if (entries) {
    parts.push("<span class='sep'>·</span><span>" + esc(entries) + " 条记录</span>");
  }
  if (tokens) {
    parts.push("<span class='sep'>·</span><span><b>" + esc(formatTokenShort(tokens)) + "</b> tokens</span>");
  }
  if (snapshot.redacted) {
    parts.push("<span class='sep'>·</span><span class='tag'><span class='dot'></span>已脱敏</span>");
  }
  return "<div class='dossier'>" + parts.join("") + "</div>";
}

function renderSnapshotGoal(snapshot) {
  return snapshot.goalObjective
    ? "<b>目标</b><span>" + esc(snapshot.goalObjective) + "</span>"
    : "";
}

function formatTokenShort(value) {
  const n = tokenUsageNumber(value);
  if (!n) return "0";
  if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(/\\.0$/, "") + "B";
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\\.0$/, "") + "k";
  return String(n);
}

function tokenUsageNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function formatTokenCount(value) {
  const number = tokenUsageNumber(value);
  return number ? new Intl.NumberFormat("zh-CN").format(number) : "0";
}

function postSnapshotState(snapshot) {
  if (!window.parent || window.parent === window) {
    return;
  }
  const options = activeOptions();
  window.parent.postMessage({
    type: "codex-snapshot:state",
    version: 1,
    selected: state.selected,
    title: snapshot.title || state.selected,
    engineLabel: snapshot.engineLabel || "Codex",
    redacted: Boolean(snapshot.redacted),
    options: Object.fromEntries(options.entries()),
  }, "*");
}

function openContentLinksInNewTabs(root) {
  for (const link of root.querySelectorAll("a[href]")) {
    link.target = "_blank";
    link.rel = mergeLinkRel(link.rel);
  }
}

function openInNewTab(url) {
  const opened = window.open(url, "_blank");
  if (opened) {
    opened.opener = null;
    opened.focus?.();
    return;
  }
  window.location.href = url;
}

function mergeLinkRel(value) {
  const rel = new Set(String(value || "").split(/\\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  return Array.from(rel).join(" ");
}

function shareApiBaseUrl() {
  return String(shareConfig.apiUrl || "").replace(/\\/+$/, "");
}

function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatFetchError(error) {
  if (error?.name === "AbortError") {
    return "请求超时，请检查分享 API 是否可访问。";
  }
  const message = messageFromError(error);
  if (message === "Failed to fetch") {
    return "网络请求失败，可能是分享 API 不可访问、CORS 未放行，或浏览器插件/代理拦截。";
  }
  return message;
}

async function fetchJsonRequest(url, options, label) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 12000) : 0;
  let response;
  try {
    response = await fetch(url, controller ? { ...(options || {}), signal: controller.signal } : options);
  } catch (error) {
    throw new Error(label + "失败：" + formatFetchError(error));
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response || typeof response.text !== "function") {
    throw new Error(label + "失败：浏览器没有返回有效响应，请检查插件或代理是否改写了 fetch。");
  }

  const text = await response.text();
  let payload = {};
  if (String(text || "").trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!response.ok) {
        payload = { error: String(text).trim().slice(0, 240) };
      } else {
        throw new Error(label + "失败：服务返回的不是 JSON。");
      }
    }
  }

  return { response, payload };
}

async function fetchShareAuth(apiUrl) {
  const { response, payload } = await fetchJsonRequest(apiUrl + "/api/auth/me?returnTo=" + encodeURIComponent(window.location.href), {
    cache: "no-store",
    credentials: "include",
  }, "检查 GitHub 登录");
  if (!response.ok) {
    throw new Error(payload.error || "检查 GitHub 登录失败：HTTP " + response.status);
  }
  return payload;
}

function redirectToShareLogin(apiUrl, auth) {
  const loginUrl = auth?.loginUrl || apiUrl + "/api/auth/github/start?returnTo=" + encodeURIComponent(window.location.href);
  window.location.href = loginUrl;
}

async function copyShareUrlToClipboard(url) {
  const text = String(url || "");
  if (!text) {
    return false;
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {}
  }
  return copyTextWithSelection(text);
}

function copyTextWithSelection(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    try {
      textarea.focus({ preventScroll: true });
    } catch (_error) {
      textarea.focus();
    }
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy") === true;
  } catch (_error) {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

let toastTimer = 0;
function showToast(message, isError) {
  const el = $("toast");
  if (!el) {
    return;
  }
  el.textContent = message;
  el.classList.toggle("error", !!isError);
  el.hidden = false;
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

async function resumeInOrca(ref, cwd, title) {
  if (!ref || !(ref.startsWith("codex:") || ref.startsWith("claude:"))) {
    showToast("该会话无法在 Orca 中恢复（仅支持 Codex / Claude）", true);
    return;
  }
  showToast("正在唤起 Orca...", false);
  try {
    const params = new URLSearchParams({ id: ref, cwd: cwd || "", title: title || "" });
    const response = await fetch("/api/resume-in-orca?" + params.toString(), {
      method: "POST",
      headers: { "${MUTATION_CSRF_HEADER}": csrfToken },
    });
    const data = await response.json();
    if (response.ok && data.ok) {
      showToast(data.message || "已在 Orca 中恢复会话", false);
    } else {
      showToast(data.error || "在 Orca 中恢复失败", true);
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  }
}

async function publishSelectedSession() {
  if (!state.selected) {
    return;
  }
  const status = $("publishStatus");
  const button = document.querySelector("[data-publish-cloud]");
  if (button) button.disabled = true;
  if (status) {
    status.textContent = shareConfig.apiUrl ? "正在检查 GitHub 登录..." : "正在发布...";
    status.classList.remove("error", "warning");
  }
  try {
    const apiUrl = shareApiBaseUrl();
    if (!apiUrl) {
      throw new Error("分享 API 尚未配置。");
    }
    const auth = await fetchShareAuth(apiUrl);
    if (!auth.configured) {
      throw new Error("分享 API 尚未配置 GitHub 登录。");
    }
    if (!auth.user) {
      if (status) {
        status.textContent = "请先登录 GitHub，登录后会回到这里继续发布。";
      }
      redirectToShareLogin(apiUrl, auth);
      return;
    }
    if (status) {
      status.textContent = "正在发布到 " + apiUrl + "...";
    }
    const options = activeOptions();
    options.set("redact", "1");
    const payloadResult = await fetchJsonRequest("/api/share-payload?" + options.toString(), {
      method: "POST",
      headers: { "${MUTATION_CSRF_HEADER}": csrfToken },
    }, "生成分享内容");
    const payload = payloadResult.payload;
    if (!payloadResult.response.ok) {
      throw new Error(payload.error || "生成分享内容失败：HTTP " + payloadResult.response.status);
    }
    const publishResult = await fetchJsonRequest(String(payload.apiUrl || apiUrl).replace(/\\/+$/, "") + "/api/snapshots", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload.body || {}),
    }, "发布快照");
    const response = publishResult.response;
    const result = publishResult.payload;
    if (!response.ok) {
      if (response.status === 401) {
        redirectToShareLogin(apiUrl, auth);
        return;
      }
      throw new Error(result.error || "发布快照失败：HTTP " + response.status);
    }
    const shareUrl = String(result.url || "");
    if (!shareUrl) {
      throw new Error("发布响应未返回分享链接。");
    }
    const copied = await copyShareUrlToClipboard(shareUrl);
    if (status) {
      status.classList.toggle("warning", !copied);
      status.innerHTML = (copied ? "已复制到剪切板：" : "已发布，复制失败，请手动复制：") +
        " <a href='" + esc(shareUrl) + "' target='_blank' rel='noopener noreferrer'>" + esc(shareUrl) + "</a>";
    }
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : String(error);
      status.classList.add("error");
      status.classList.remove("warning");
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function formatRiskTurns(risk) {
  const turns = Array.isArray(risk.turns) ? risk.turns : [];
  const visibleTurns = turns.slice(0, 18).join(", ");
  const hiddenCount = Math.max(0, turns.length - 18);
  const suffix = hiddenCount ? ", +" + hiddenCount + " more" : "";
  return risk.count + " match(es)" + (turns.length ? ", turns " + visibleTurns + suffix : "");
}

$("sessions").addEventListener("click", async (event) => {
  const sourceButton = event.target.closest("[data-source]");
  if (sourceButton) {
    const nextSource = sourceButton.dataset.source;
    if (nextSource && nextSource !== state.activeSource) {
      state.activeSource = nextSource;
      await selectFirstSessionForActiveSource();
    }
    return;
  }
  const loadMoreButton = event.target.closest("[data-load-more]");
  if (loadMoreButton) {
    await loadMoreSessions();
    return;
  }
  const toggle = event.target.closest("[data-project-toggle]");
  if (toggle) {
    const key = toggle.dataset.projectToggle;
    if (state.expandedProjects.has(key)) {
      state.expandedProjects.delete(key);
    } else {
      state.expandedProjects.add(key);
    }
    renderSessions();
    return;
  }
  const projectSearch = event.target.closest("[data-project-search]");
  if (projectSearch) {
    event.preventDefault();
    event.stopPropagation();
    openSearchDialog({
      cwd: projectSearch.dataset.projectCwd || "",
      label: projectSearch.dataset.projectLabel || "当前项目",
    });
    return;
  }
  const projectHeader = event.target.closest("[data-project-collapse]");
  if (projectHeader) {
    const key = projectHeader.dataset.projectCollapse;
    if (state.collapsedProjects.has(key)) {
      state.collapsedProjects.delete(key);
    } else {
      state.collapsedProjects.add(key);
    }
    renderSessions();
    return;
  }
  const button = event.target.closest("[data-id]");
  if (button) selectSession(button.dataset.id);
});
$("reload").addEventListener("click", loadSessions);
$("openSearch").addEventListener("click", () => openSearchDialog());
$("openStats").addEventListener("click", openStats);
$("closeStats").addEventListener("click", closeStats);
$("statsRefresh").addEventListener("click", loadStats);
$("statsOverlay").addEventListener("click", (event) => {
  if (event.target === $("statsOverlay")) {
    closeStats();
  }
});
$("closeSearch").addEventListener("click", () => closeSearchDialog(false));
$("prewarmIndex").addEventListener("click", toggleSemanticPrewarm);
$("globalSearch").addEventListener("input", () => scheduleSearch());
$("globalSearch").addEventListener("keydown", async (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSearchActive(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSearchActive(-1);
    return;
  }
  if (event.key === "Tab" && !event.shiftKey) {
    event.preventDefault();
    setSearchMode(state.search.mode === "semantic" ? "keyword" : "semantic");
    if ($("globalSearch").value.trim()) {
      scheduleSearch(0);
    }
    return;
  }
  if (event.key === "Enter") {
    const result = state.search.results[state.search.active];
    if (result?.ref) {
      event.preventDefault();
      await selectSearchResult(result.ref);
    }
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeSearchDialog(false);
  }
});
$("searchOverlay").addEventListener("click", (event) => {
  if (event.target === $("searchOverlay")) {
    closeSearchDialog(false);
  }
});
$("searchResults").addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-sr-action]");
  if (actionButton) {
    const holder = actionButton.closest("[data-search-result]");
    if (holder) {
      event.preventDefault();
      event.stopPropagation();
      await runSearchResultAction(actionButton.dataset.srAction, holder.dataset.searchResult);
    }
    return;
  }
  const button = event.target.closest("[data-search-result]");
  if (button) {
    await selectSearchResult(button.dataset.searchResult);
  }
});
$("searchResults").addEventListener("mousemove", (event) => {
  const button = event.target.closest("[data-search-index]");
  if (button) {
    const index = Number(button.dataset.searchIndex);
    if (Number.isFinite(index) && index !== state.search.active) {
      state.search.active = index;
      updateSearchActive({ preview: true, scroll: false });
    }
  }
});
$("sessionSearchInput").addEventListener("input", () => scheduleSessionSearch());
$("sessionSearchInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runSessionSearch();
  }
});
$("sessionSearchRun").addEventListener("click", runSessionSearch);
$("sessionSearchResults").addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-search-turn]");
  if (button) {
    focusTurn(button.dataset.sessionSearchTurn);
  }
});
$("sessionSearchResults").addEventListener("keydown", (event) => {
  if (!isKeyboardActivation(event)) {
    return;
  }
  const button = event.target.closest("[data-session-search-turn]");
  if (button) {
    event.preventDefault();
    focusTurn(button.dataset.sessionSearchTurn);
  }
});
for (const button of document.querySelectorAll("[data-search-mode]")) {
  button.addEventListener("click", () => {
    setSearchMode(button.dataset.searchMode);
    if ($("globalSearch").value.trim()) {
      scheduleSearch(0);
    }
  });
}
for (const button of document.querySelectorAll("[data-search-flag]")) {
  button.addEventListener("click", () => {
    const key = button.dataset.searchFlag;
    state.search.flags[key] = !state.search.flags[key];
    button.setAttribute("aria-pressed", state.search.flags[key] ? "true" : "false");
    reapplyClientFilters();
  });
}
$("searchFacets").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-facet-key]");
  if (!chip) {
    return;
  }
  toggleQueryToken(chip.dataset.facetKey, chip.dataset.facetValue, chip.dataset.facetKey === "source");
});
document.addEventListener("keydown", (event) => {
  const key = String(event.key || "").toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "k") {
    event.preventDefault();
    openSearchDialog();
    return;
  }
  if (event.key === "Escape" && state.search.open) {
    event.preventDefault();
    closeSearchDialog(false);
  }
  if (event.key === "Escape" && !$("statsOverlay").hidden) {
    event.preventDefault();
    closeStats();
  }
});
$("exports").addEventListener("click", (event) => {
  if (event.target.closest("[data-publish-cloud]")) {
    publishSelectedSession();
    return;
  }
  const resumeBtn = event.target.closest("[data-resume-orca]");
  if (resumeBtn) {
    resumeInOrca(resumeBtn.dataset.resumeOrca, resumeBtn.dataset.resumeCwd, resumeBtn.dataset.resumeTitle);
  }
});
$("turns").addEventListener("click", (event) => {
  const link = event.target.closest?.("a[href]");
  if (!link) {
    return;
  }
  event.preventDefault();
  openInNewTab(link.href);
});
for (const id of ["redact"]) {
  $(id).addEventListener("change", () => {
    state.snapshotCache.clear();
    if (state.selected) {
      selectSession(state.selected);
    }
  });
}
initAppearance();
loadStatsRate();
initSplitter();
loadSessions().then(() => {
  // Deep link from the launcher: /?session=<ref> auto-opens that session.
  const wanted = new URLSearchParams(location.search).get("session");
  if (wanted) {
    selectSession(wanted).catch(() => {});
  }
}).catch((error) => {
  $("sessions").innerHTML = "<div class='meta'>" + esc(error.message) + "</div>";
  clearViewer(error.message || "Failed to load sessions.");
});
`;
}
