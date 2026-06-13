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
        <header>
          <p class="eyebrow">Codex Snapshots</p>
          <h1>会话</h1>
        </header>
        <div class="toolbar">
          <input id="filter" type="search" placeholder="搜索来源、项目或对话">
          <button id="openSearch" class="search-open" type="button" title="搜索会话正文">⌘K</button>
          <button id="reload" type="button" title="刷新会话列表">刷新</button>
        </div>
      </div>
      <div id="sessions" class="sessions"></div>
    </aside>
    <div id="splitter" class="splitter" role="separator" aria-label="调整项目列表宽度" aria-orientation="vertical" aria-valuemin="280" aria-valuemax="680" aria-valuenow="0" tabindex="0"></div>
    <section class="viewer">
      <div class="viewer-top">
        <div>
          <p class="eyebrow">Read-only review</p>
          <h2 id="title">选择一个会话</h2>
        </div>
        <div class="switches">
          <label title="显示工具调用"><input id="includeTools" type="checkbox"> 工具</label>
          <label title="显示工具输出"><input id="includeToolOutput" type="checkbox"> 输出</label>
          <label title="自动脱敏常见敏感内容"><input id="redact" type="checkbox" checked> 脱敏</label>
        </div>
      </div>
      <div id="meta" class="meta empty">还没有选择会话。</div>
      <div id="risks" class="risks"></div>
      <div id="exports" class="exports"></div>
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
      <input id="globalSearch" class="global-search-input" type="search" placeholder="输入关键词、报错、文件名或决策">
      <div class="search-controls" role="group" aria-label="搜索范围">
        <button class="search-scope active" type="button" data-search-scope="all">全部</button>
        <button class="search-scope" type="button" data-search-scope="project">当前项目</button>
        <span id="searchStatus" class="search-status"></span>
      </div>
      <div id="searchResults" class="search-results"></div>
    </section>
  </div>
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
  --paper: #f4efe3;
  --paper-deep: #ece4d0;
  --panel: #fdfaf2;
  --panel-soft: #f7f2e4;
  --panel-wash: rgba(253, 250, 242, 0.86);
  --ink: #231d12;
  --ink-soft: #4f4533;
  --muted: #7a6d55;
  --soft: #a2947a;
  --line: #ddd2ba;
  --hairline: rgba(35, 29, 18, 0.16);
  --seal: #b23a2b;
  --seal-deep: #8c2b1f;
  --seal-wash: rgba(178, 58, 43, 0.09);
  --pine: #2f5d49;
  --pine-wash: rgba(47, 93, 73, 0.1);
  --amber: #93651a;
  --amber-wash: rgba(160, 112, 30, 0.12);
  --blue: #8c2b1f;
  --teal: #2f5d49;
  --green: #2f5d49;
  --red: #b23a2b;
  --focus: #b23a2b;
  --code-bg: #262014;
  --code-line: #45391f;
  --code-ink: #f1ead7;
  --sidebar-width: clamp(340px, 28vw, 470px);
  --splitter-width: 14px;
  --font-display: "Iowan Old Style", "Palatino", "Book Antiqua", "Songti SC", "Noto Serif SC", Georgia, serif;
  --font-ui: "Avenir Next", "Avenir", "Seravek", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace;
  --shadow-soft: 0 18px 48px -38px rgba(64, 48, 20, 0.5);
  --shadow-panel: 0 30px 80px -52px rgba(64, 48, 20, 0.6);
}
* { box-sizing: border-box; }
html {
  height: 100%;
  overflow: hidden;
}
body {
  height: 100%;
  margin: 0;
  overflow: hidden;
  color: var(--ink);
  background:
    repeating-linear-gradient(0deg, rgba(35, 29, 18, 0.018) 0 1px, transparent 1px 3px),
    radial-gradient(1100px 760px at 88% -12%, rgba(178, 58, 43, 0.05), transparent 62%),
    radial-gradient(900px 720px at -8% 112%, rgba(47, 93, 73, 0.055), transparent 58%),
    var(--paper);
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
::selection {
  background: rgba(178, 58, 43, 0.2);
}
.sidebar, .viewer, .search-results {
  scrollbar-width: thin;
  scrollbar-color: rgba(35, 29, 18, 0.28) transparent;
}
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 99px;
  background: rgba(35, 29, 18, 0.24);
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background-color: rgba(35, 29, 18, 0.42); }
.app {
  display: grid;
  grid-template-columns: var(--sidebar-width) var(--splitter-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}
.app.resizing,
.app.resizing * {
  cursor: col-resize;
  user-select: none;
}
.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: linear-gradient(180deg, rgba(35, 29, 18, 0.035), transparent 160px), var(--paper-deep);
  padding: 12px 14px 24px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  border-right: 1px solid var(--hairline);
  box-shadow: inset -18px 0 34px -32px rgba(64, 48, 20, 0.5);
}
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
  position: absolute;
  inset: 0 auto 0 50%;
  width: 1px;
  background: var(--hairline);
  content: "";
  transform: translateX(-50%);
}
.splitter::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 7px;
  height: 76px;
  border: 1px solid rgba(35, 29, 18, 0.28);
  border-radius: 999px;
  background: var(--panel);
  content: "";
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity 120ms ease, background 120ms ease, border-color 120ms ease;
}
.splitter:hover::after,
.splitter:focus-visible::after,
.app.resizing .splitter::after {
  border-color: var(--seal);
  background: var(--panel);
  opacity: 1;
}
.splitter:focus-visible {
  outline: 2px solid rgba(178, 58, 43, 0.45);
  outline-offset: -2px;
}
.viewer {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 14px clamp(18px, 2vw, 34px) 34px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.sidebar-top {
  position: sticky;
  top: -1px;
  z-index: 6;
  flex: 0 0 auto;
  margin: -12px -14px 0;
  padding: 14px 14px 12px;
  background: var(--paper-deep);
  border-bottom: 1px solid var(--hairline);
  box-shadow: 0 16px 28px -28px rgba(64, 48, 20, 0.8);
}
.eyebrow {
  margin: 0 0 6px;
  color: var(--seal);
  font: 700 10px/1 var(--font-mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
h1, h2 { margin: 0; letter-spacing: 0; font-family: var(--font-display); }
h1 { font-size: 36px; line-height: 1; }
.sidebar h1 {
  color: var(--ink);
  font: 600 27px/1.05 var(--font-display);
  letter-spacing: 0.01em;
}
h2 { font-size: 28px; font-weight: 600; line-height: 1.16; overflow-wrap: anywhere; }
.toolbar { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; margin-top: 12px; }
input[type="search"] {
  min-width: 0;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  padding: 0 14px;
  color: var(--ink);
  font: 500 13.5px/1 var(--font-mono);
  outline: 0;
  box-shadow: inset 0 2px 5px rgba(64, 48, 20, 0.06);
}
input[type="search"]::placeholder {
  color: var(--soft);
}
input[type="search"]:focus {
  border-color: var(--seal);
  box-shadow: inset 0 2px 5px rgba(64, 48, 20, 0.06), 0 0 0 3px rgba(178, 58, 43, 0.14);
}
.search-open {
  min-width: 54px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--muted);
  padding: 0 10px;
  letter-spacing: 0.04em;
}
.search-open:hover {
  border-color: var(--seal);
  background: var(--panel);
  color: var(--seal);
}
button, .exports a {
  min-height: 40px;
  border: 1px solid var(--ink);
  border-radius: 6px;
  background: var(--ink);
  color: var(--paper);
  padding: 0 14px;
  font: 700 12px/1 var(--font-mono);
  letter-spacing: 0.05em;
  text-decoration: none;
  cursor: pointer;
  transition: background 130ms ease, color 130ms ease, border-color 130ms ease, transform 130ms ease, box-shadow 130ms ease;
}
button:hover, .exports a:hover {
  border-color: var(--seal-deep);
  background: var(--seal-deep);
  color: #fdf6ec;
  transform: translateY(-1px);
  box-shadow: 0 12px 26px -18px rgba(140, 43, 31, 0.85);
}
button:focus-visible,
.exports a:focus-visible,
.source-tab:focus-visible,
.session:focus-visible,
.project-more:focus-visible,
.sessions-load-more:focus-visible,
.search-result:focus-visible,
.search-scope:focus-visible {
  outline: 2px solid rgba(178, 58, 43, 0.55);
  outline-offset: 2px;
}
button:disabled {
  cursor: wait;
  opacity: 0.55;
  transform: none;
  box-shadow: none;
}
.loading-state {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-wash);
  color: var(--muted);
  padding: 12px;
  font: 700 12px/1.25 var(--font-mono);
  letter-spacing: 0.04em;
  box-shadow: var(--shadow-soft);
}
.turns > .loading-state {
  justify-self: center;
  justify-content: center;
  width: min(460px, 100%);
  min-height: 86px;
}
.loading-spinner {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border: 2px solid rgba(35, 29, 18, 0.16);
  border-top-color: var(--seal);
  border-radius: 999px;
  animation: snapshot-spin 0.8s linear infinite;
}
@keyframes snapshot-spin {
  to { transform: rotate(360deg); }
}
@keyframes turn-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
.sessions {
  display: grid;
  flex: 1 1 auto;
  gap: 14px;
  align-content: start;
  min-height: 0;
  margin-top: 16px;
}
.sessions.sessions-loading {
  align-content: center;
  margin-top: 0;
}
.sessions.sessions-loading > .loading-state {
  justify-content: center;
  min-height: 86px;
}
.source-switcher {
  position: sticky;
  top: 112px;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  border: 1px solid var(--hairline);
  border-radius: 7px;
  background: var(--panel);
  padding: 4px;
  box-shadow: 0 14px 28px -26px rgba(64, 48, 20, 0.75);
}
.source-tab {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-width: 0;
  min-height: 36px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  padding: 0 9px;
  text-align: left;
  font: 700 11px/1 var(--font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.source-tab:hover {
  border-color: var(--hairline);
  background: rgba(35, 29, 18, 0.05);
  color: var(--ink);
  transform: none;
  box-shadow: none;
}
.source-tab.active {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper);
  box-shadow: none;
}
.source-tab span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-tab b {
  color: inherit;
  font: inherit;
  opacity: 0.72;
}
.source-tab.active b {
  color: #f3c9b8;
  opacity: 1;
}
.source-total {
  color: var(--muted);
  font: 700 11px/1 var(--font-mono);
}
.source-empty {
  margin-left: 34px;
  color: var(--soft);
  font: 500 12px/1.4 var(--font-mono);
}
.project-group {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--hairline);
  padding-top: 12px;
}
.project-header {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 11px;
  align-items: center;
  width: 100%;
  min-height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0;
  text-align: left;
  font: 600 17px/1.25 var(--font-display);
  letter-spacing: 0.01em;
  box-shadow: none;
  cursor: pointer;
}
.project-header:hover {
  background: rgba(35, 29, 18, 0.055);
  color: var(--ink);
  transform: none;
  box-shadow: none;
}
.project-header:focus-visible {
  outline: 2px solid rgba(178, 58, 43, 0.45);
  outline-offset: 2px;
}
.project-group.collapsed .project-header {
  color: var(--muted);
}
.project-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-count {
  color: var(--soft);
  font: 700 11px/1 var(--font-mono);
  letter-spacing: 0.04em;
}
.project-icon {
  position: relative;
  display: inline-block;
  width: 21px;
  height: 15px;
  border: 1.5px solid currentColor;
  border-radius: 3px;
  opacity: 0.75;
}
.project-icon::before {
  position: absolute;
  top: -6px;
  left: 1px;
  width: 10px;
  height: 5px;
  border: 1.5px solid currentColor;
  border-bottom: 0;
  border-radius: 3px 3px 0 0;
  content: "";
}
.session-list {
  display: grid;
  gap: 4px;
  margin-left: 34px;
}
.session {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  min-height: 38px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink);
  padding: 8px 11px;
  text-align: left;
  font-family: var(--font-ui);
  letter-spacing: 0;
  box-shadow: none;
}
.session::before {
  position: absolute;
  inset: 9px auto 9px 0;
  width: 3px;
  border-radius: 99px;
  background: transparent;
  content: "";
}
.session:hover, .session.active {
  background: var(--seal-wash);
  color: var(--ink);
  border-color: transparent;
  transform: none;
  box-shadow: none;
}
.session.active::before { background: var(--seal); }
.session strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.3;
}
.session-time {
  color: var(--soft);
  font: 600 11px/1 var(--font-mono);
  white-space: nowrap;
}
.session-badge {
  border: 1px solid rgba(178, 58, 43, 0.46);
  border-radius: 3px;
  background: transparent;
  color: var(--seal);
  padding: 3px 5px;
  font: 700 9.5px/1 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}
.project-more {
  justify-self: start;
  min-height: 30px;
  margin-left: 34px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--soft);
  padding: 4px 10px;
  font: 600 12px/1 var(--font-mono);
  letter-spacing: 0.04em;
  box-shadow: none;
}
.project-more:hover {
  color: var(--seal);
  background: var(--seal-wash);
  border-color: transparent;
  transform: none;
  box-shadow: none;
}
.project-note {
  margin-left: 44px;
  color: var(--soft);
  font: 500 11px/1.45 var(--font-mono);
}
.load-more-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin-left: 34px;
}
.sessions-load-more {
  width: 100%;
  min-height: 42px;
  border: 1px dashed rgba(35, 29, 18, 0.3);
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  box-shadow: none;
}
.sessions-load-more:hover {
  border-color: var(--seal);
  border-style: solid;
  background: var(--seal-wash);
  color: var(--seal-deep);
  transform: none;
  box-shadow: none;
}
.sessions-load-more:disabled {
  background: rgba(35, 29, 18, 0.04);
}
.load-more-meta {
  color: var(--soft);
  font: 500 11px/1.4 var(--font-mono);
}
.load-more-error {
  color: var(--red);
}
.search-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: start center;
  background: rgba(38, 29, 16, 0.36);
  padding: clamp(18px, 8dvh, 72px) 18px 18px;
  backdrop-filter: blur(7px) saturate(0.9);
}
.search-overlay[hidden] {
  display: none;
}
.search-dialog {
  display: grid;
  gap: 12px;
  width: min(860px, 100%);
  max-height: min(760px, calc(100dvh - 36px));
  border: 1px solid var(--hairline);
  border-top: 3px solid var(--seal);
  border-radius: 8px;
  background: linear-gradient(180deg, var(--panel), var(--panel-soft));
  padding: 18px;
  box-shadow: 0 42px 110px -48px rgba(38, 24, 8, 0.85);
  animation: turn-rise 0.28s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
.search-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}
.search-bar h2 {
  font-size: 24px;
}
.search-close {
  min-height: 34px;
  border-color: var(--line);
  background: transparent;
  color: var(--muted);
  box-shadow: none;
}
.search-close:hover {
  border-color: var(--seal);
  background: transparent;
  color: var(--seal);
  box-shadow: none;
}
.global-search-input {
  width: 100%;
  height: 48px;
  font-size: 15px;
}
.search-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.search-scope {
  min-height: 32px;
  border-color: var(--line);
  background: transparent;
  color: var(--muted);
  padding: 0 11px;
  box-shadow: none;
}
.search-scope:hover {
  border-color: var(--hairline);
  background: rgba(35, 29, 18, 0.06);
  color: var(--ink);
  transform: none;
  box-shadow: none;
}
.search-scope.active {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper);
}
.search-scope:disabled {
  border-color: var(--line);
  background: rgba(35, 29, 18, 0.04);
  color: var(--soft);
}
.search-status {
  min-width: 0;
  color: var(--soft);
  font: 600 11.5px/1.35 var(--font-mono);
}
.search-results {
  display: grid;
  gap: 8px;
  min-height: 120px;
  max-height: min(540px, calc(100dvh - 290px));
  overflow: auto;
  padding-right: 4px;
}
.search-empty {
  display: grid;
  min-height: 112px;
  place-items: center;
  border: 1px dashed rgba(35, 29, 18, 0.26);
  border-radius: 6px;
  color: var(--soft);
  font: 600 13px/1.45 var(--font-mono);
}
.search-result {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 14px;
  min-height: 0;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--panel-wash);
  color: var(--ink);
  padding: 12px;
  text-align: left;
  font-family: var(--font-ui);
  letter-spacing: 0;
  box-shadow: none;
}
.search-result:hover,
.search-result.active {
  border-color: rgba(178, 58, 43, 0.5);
  background: #fdf7ea;
  color: var(--ink);
  transform: none;
  box-shadow: 0 14px 30px -26px rgba(140, 43, 31, 0.6);
}
.search-result strong,
.search-result span,
.search-result p {
  min-width: 0;
}
.search-result-title {
  overflow: hidden;
  font: 600 15px/1.3 var(--font-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-result-source {
  color: var(--soft);
  font: 700 10.5px/1 var(--font-mono);
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.search-result-path {
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--soft);
  font: 500 11px/1.35 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-result-snippet {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--ink-soft);
  font: 400 13.5px/1.55 var(--font-ui);
  overflow-wrap: anywhere;
}
.search-result-snippet mark {
  border-radius: 2px;
  background: linear-gradient(180deg, rgba(240, 213, 110, 0.18), rgba(240, 213, 110, 0.72));
  color: inherit;
  padding: 0 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.search-result-meta {
  grid-column: 1 / -1;
  color: var(--soft);
  font: 600 10.5px/1.3 var(--font-mono);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.project-group.no-project .project-header {
  grid-template-columns: minmax(0, 1fr) auto;
  margin-left: 34px;
  width: calc(100% - 34px);
}
.project-group.no-project .project-icon {
  display: none;
}
.viewer-top {
  position: sticky;
  top: 0;
  z-index: 4;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  border-bottom: 2px solid rgba(35, 29, 18, 0.78);
  margin: -14px clamp(-34px, -2vw, -18px) 14px;
  padding: 12px clamp(18px, 2vw, 34px);
  background: var(--paper);
  box-shadow: 0 18px 38px -34px rgba(64, 48, 20, 0.7);
  isolation: isolate;
}
.viewer-top::before {
  position: absolute;
  right: 0;
  bottom: 100%;
  left: 0;
  height: 36px;
  background: var(--paper);
  content: "";
  pointer-events: none;
}
.viewer-top h2 {
  font-size: 29px;
}
.switches { display: flex; flex-wrap: wrap; gap: 8px; justify-content: end; }
.switches label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-wash);
  padding: 0 10px;
  font: 600 11.5px/1 var(--font-mono);
  user-select: none;
  cursor: pointer;
  transition: border-color 130ms ease, color 130ms ease;
}
.switches label:hover {
  border-color: rgba(178, 58, 43, 0.45);
}
.switches input {
  accent-color: var(--seal);
}
.switches label:has(input:checked) {
  border-color: rgba(178, 58, 43, 0.4);
  color: var(--seal-deep);
}
.meta, .risks, .exports { margin-top: 10px; }
.risks:empty { display: none; }
.meta {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel-wash);
  padding: 10px;
  color: var(--muted);
  font: 600 13px/1.5 var(--font-mono);
  overflow-wrap: anywhere;
  box-shadow: var(--shadow-soft);
}
.meta.loading {
  display: grid;
  flex: 1 1 auto;
  min-height: 260px;
  margin-top: 0;
  border: 0;
  background: transparent;
  padding: 0;
  place-items: center;
  box-shadow: none;
}
.meta.loading .loading-state {
  justify-content: center;
  width: min(460px, 100%);
  min-height: 86px;
}
.meta.loading ~ .exports,
.meta.loading ~ .turns {
  margin-top: 0;
}
.meta-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.meta-pill {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--hairline);
  border-radius: 5px;
  background: rgba(253, 250, 242, 0.65);
  padding: 8px 10px;
  color: var(--ink);
}
.meta-pill b {
  color: var(--seal);
  font: 700 9.5px/1 var(--font-mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
}
.meta-pill span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.meta-goal {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 10px;
  margin-top: 8px;
  border: 1px solid var(--hairline);
  border-left: 3px solid var(--seal);
  border-radius: 5px;
  background: rgba(253, 250, 242, 0.65);
  padding: 10px;
  color: var(--ink);
}
.meta-goal b {
  color: var(--seal);
  font: 700 9.5px/1.3 var(--font-mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.meta-goal span {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.risks { display: grid; gap: 8px; }
.notice {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  border: 1px solid rgba(147, 101, 26, 0.28);
  border-left: 4px solid var(--amber);
  border-radius: 6px;
  background: var(--amber-wash);
  padding: 10px 12px;
}
.notice b {
  color: var(--amber);
  font: 700 11px/1 var(--font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.notice span {
  overflow-wrap: anywhere;
}
.risk {
  display: grid;
  grid-template-columns: 76px minmax(160px, 0.65fr) minmax(0, 1.35fr);
  gap: 10px;
  align-items: start;
  border: 1px solid rgba(47, 93, 73, 0.26);
  border-left: 4px solid var(--green);
  border-radius: 6px;
  background: var(--pine-wash);
  padding: 11px 12px;
}
.risk.high {
  border-color: rgba(178, 58, 43, 0.32);
  border-left-color: var(--red);
  background: var(--seal-wash);
}
.risk.medium {
  border-color: rgba(147, 101, 26, 0.3);
  border-left-color: var(--amber);
  background: var(--amber-wash);
}
.risk b, .risk span, .risk em { min-width: 0; }
.risk b {
  font: 700 11px/1.3 var(--font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--green);
}
.risk.high b { color: var(--red); }
.risk.medium b { color: var(--amber); }
.risk span { line-height: 1.35; overflow-wrap: normal; }
.risk em { color: var(--muted); font-style: normal; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
.exports { display: flex; flex-wrap: wrap; gap: 8px; }
.exports a,
.exports button {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  border-radius: 5px;
  padding: 0 11px;
  font-size: 11px;
  letter-spacing: 0.07em;
}
.exports button[data-publish-cloud] {
  border-color: var(--seal-deep);
  background: var(--seal-deep);
}
.exports button[data-publish-cloud]:hover {
  border-color: var(--seal);
  background: var(--seal);
}
.publish-status {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  max-width: min(680px, 100%);
  overflow-wrap: anywhere;
  color: var(--muted);
  font: 600 12px/1.35 var(--font-mono);
}
.publish-status a {
  color: var(--seal-deep);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.publish-status.error {
  color: var(--red);
}
.publish-status.warning {
  color: var(--amber);
}
.turns {
  display: grid;
  gap: 32px;
  width: min(1600px, 100%);
  margin: 24px auto 0;
}
.turn {
  display: flex;
  min-width: 0;
  animation: turn-rise 0.4s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
.turns > :nth-child(1) { animation-delay: 30ms; }
.turns > :nth-child(2) { animation-delay: 70ms; }
.turns > :nth-child(3) { animation-delay: 110ms; }
.turns > :nth-child(4) { animation-delay: 150ms; }
.turns > :nth-child(5) { animation-delay: 190ms; }
.turns > :nth-child(6) { animation-delay: 230ms; }
.user { justify-content: flex-end; }
.assistant, .tool { justify-content: flex-start; }
.process { justify-content: flex-start; }
.interrupt { justify-content: center; }
.turn-notice {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px dashed rgba(35, 29, 18, 0.3);
  border-radius: 999px;
  background: rgba(35, 29, 18, 0.045);
  color: var(--soft);
  padding: 7px 15px;
  font: 600 11px/1.3 var(--font-mono);
  letter-spacing: 0.08em;
}
.turn-notice span[aria-hidden] {
  font-size: 10px;
}
.message-card {
  min-width: 0;
  max-width: min(1160px, 74%);
  border: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}
.user .message-card {
  max-width: min(1220px, 76%);
  border: 1px solid rgba(147, 101, 26, 0.32);
  border-radius: 10px 10px 3px 10px;
  background: linear-gradient(180deg, #fbf3dd, #f8edd2);
  padding: 14px 18px;
  box-shadow: 0 24px 56px -48px rgba(110, 78, 24, 0.65);
}
.assistant .message-card {
  max-width: min(1120px, 74%);
}
.tool .message-card {
  max-width: min(1160px, 80%);
  border: 1px dashed rgba(147, 101, 26, 0.5);
  border-radius: 8px;
  background: rgba(250, 243, 224, 0.55);
  padding: 14px 18px;
}
.turn-meta {
  margin-bottom: 10px;
  color: var(--soft);
  font: 700 10px/1.3 var(--font-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.turn-meta span { font-weight: 500; }
.process-details {
  width: min(1120px, 74%);
  border-top: 1px solid var(--hairline);
  color: var(--muted);
}
.process-summary {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  font: 600 13.5px/1.3 var(--font-mono);
  letter-spacing: 0.05em;
  transition: color 130ms ease;
}
.process-summary:hover {
  color: var(--seal-deep);
}
.process-summary::-webkit-details-marker {
  display: none;
}
.process-summary::after {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  content: "";
  transform: translateY(-2px) rotate(45deg);
  transition: transform 0.16s ease;
}
.process-details[open] .process-summary::after {
  transform: translateY(2px) rotate(225deg);
}
.process-body {
  display: grid;
  gap: 24px;
  padding: 6px 0 8px;
}
.process-entry {
  min-width: 0;
}
.process-entry .body {
  color: var(--ink-soft);
  font-size: 16px;
}
.process-tool {
  max-width: min(980px, 100%);
  border-left: 3px solid rgba(147, 101, 26, 0.4);
  padding-left: 12px;
}
.tool-details {
  min-width: 0;
}
.tool-details summary {
  cursor: pointer;
  color: var(--amber);
  font: 700 11.5px/1.4 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  user-select: none;
}
.tool-details summary:hover {
  color: var(--seal-deep);
}
.tool-details[open] summary {
  margin-bottom: 8px;
}
.body {
  min-width: 0;
  max-width: 78ch;
  font-family: var(--font-display);
  font-size: 17.5px;
  line-height: 1.78;
}
.body > * { margin: 0; }
.body > * + * { margin-top: 18px; }
.body p, .body li { overflow-wrap: anywhere; }
.body strong { font-weight: 700; }
.body em { font-style: italic; }
.body a {
  color: var(--seal-deep);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-decoration-color: rgba(140, 43, 31, 0.45);
  text-underline-offset: 3px;
}
.body a:hover {
  text-decoration-color: var(--seal);
}
.body code {
  border: 1px solid rgba(35, 29, 18, 0.14);
  border-radius: 4px;
  background: rgba(35, 29, 18, 0.06);
  padding: 0.08rem 0.34rem;
  font-family: var(--font-mono);
  font-size: 0.82em;
}
.body pre {
  position: relative;
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--code-line);
  border-radius: 8px;
  background: var(--code-bg);
  color: var(--code-ink);
  padding: 38px 16px 16px;
  font: 13px/1.6 var(--font-mono);
  white-space: pre;
  box-shadow: 0 26px 60px -48px rgba(38, 24, 8, 0.9);
  scrollbar-color: rgba(241, 234, 215, 0.3) transparent;
}
.body pre[data-language]::before {
  position: absolute;
  top: 10px;
  right: 12px;
  max-width: calc(100% - 24px);
  overflow: hidden;
  color: #b3a584;
  content: attr(data-language);
  font: 700 10px/1 var(--font-mono);
  letter-spacing: 0.16em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}
.body pre code {
  display: block;
  min-width: max-content;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: inherit;
}
.body .hljs-keyword,
.body .hljs-selector-tag,
.body .hljs-built_in { color: #e0764a; }
.body .hljs-title,
.body .hljs-title.class_,
.body .hljs-title.function_ { color: #eac57d; }
.body .hljs-string,
.body .hljs-attr,
.body .hljs-symbol { color: #a9c08a; }
.body .hljs-number,
.body .hljs-literal { color: #dba16a; }
.body .hljs-comment { color: #8a7d63; font-style: italic; }
.body .hljs-type,
.body .hljs-params,
.body .hljs-variable,
.body .hljs-property { color: #cda6a0; }
.body ul, .body ol { padding-left: 1.35rem; }
.body li + li { margin-top: 0.25rem; }
.body blockquote {
  border-left: 3px solid rgba(178, 58, 43, 0.4);
  margin-left: 0;
  padding-left: 14px;
  color: var(--ink-soft);
  font-style: italic;
}
.body h1, .body h2, .body h3 {
  line-height: 1.3;
  font-size: 1.12em;
  font-weight: 700;
}
.body table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-family: var(--font-ui);
  font-size: 13.5px;
  line-height: 1.5;
}
.body th, .body td {
  border: 1px solid var(--hairline);
  padding: 7px 12px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}
.body th {
  background: rgba(35, 29, 18, 0.05);
  color: var(--ink);
  font-weight: 700;
  white-space: nowrap;
}
.body tbody tr:nth-child(even) td,
.body tr:nth-child(even) td {
  background: rgba(35, 29, 18, 0.022);
}
.attachment-grid {
  display: grid;
  gap: 18px;
  margin-top: 24px;
}
.body > .attachment-grid { margin-top: 24px; }
.image-attachment {
  margin: 0;
  min-width: 0;
}
.image-attachment img {
  display: block;
  max-width: 100%;
  max-height: 520px;
  border: 1px solid rgba(35, 29, 18, 0.22);
  border-radius: 6px;
  background: var(--panel);
  padding: 4px;
  object-fit: contain;
  box-shadow: 0 22px 50px -44px rgba(64, 48, 20, 0.7);
}
.image-unavailable {
  border: 1px dashed var(--line);
  border-radius: 6px;
  padding: 16px;
  color: var(--muted);
}
pre {
  overflow: auto;
  max-height: 460px;
  margin: 0;
  border: 1px solid var(--code-line);
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--code-ink);
  padding: 12px;
  font: 12px/1.6 var(--font-mono);
  white-space: pre-wrap;
  scrollbar-color: rgba(241, 234, 215, 0.3) transparent;
}
.empty { color: var(--muted); }
@media (max-width: 900px) {
  .app {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(220px, 38dvh) minmax(0, 1fr);
  }
  .viewer {
    padding: 22px 18px 34px;
  }
  .viewer-top {
    grid-template-columns: 1fr;
    margin: -22px -18px 22px;
    padding: 12px 18px 14px;
  }
  .sidebar { border-right: 0; border-bottom: 2px solid var(--ink); box-shadow: none; }
  .splitter { display: none; }
  .sidebar-top { position: static; margin-top: -12px; }
  .source-switcher { position: static; }
  .switches { justify-content: start; }
  .risk { grid-template-columns: 1fr; }
  .turns { gap: 36px; }
  .message-card, .user .message-card { max-width: 94%; }
  .assistant .message-card { max-width: 100%; }
  .user .message-card { padding: 12px 16px; }
  .body { font-size: 17px; }
}
@media (prefers-reduced-motion: reduce) {
  .loading-spinner { animation: none; }
  .turn, .search-dialog { animation: none; }
  * { transition-duration: 0.01ms !important; }
}
`;
}
function serverJs() {
    return `
const state = {
  sessions: [],
  selected: "",
  activeSource: "codex",
  requestToken: 0,
  expandedProjects: new Set(),
  collapsedProjects: new Set(),
  hasMoreSessions: false,
  loadingMoreSessions: false,
  sessionListError: "",
  search: { open: false, query: "", scope: "all", loading: false, results: [], terms: [], matched: 0, scanned: 0, failed: 0, error: "", requestToken: 0 },
};
const SOURCE_MODULES = [
  { key: "codex", label: "Codex" },
  { key: "claude", label: "Claude Code" },
  { key: "trae", label: "Trae" },
];
const SESSION_BATCH_LIMIT = 200;
const SEARCH_SCAN_LIMIT = 600;
const SAFETY_CHECKS_ENABLED = false;
const SIDEBAR_WIDTH_KEY = "codex-snapshot.sidebar-width";
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 680;
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
  $("title").textContent = "正在加载会话";
  $("meta").classList.add("empty", "loading");
  $("meta").setAttribute("aria-busy", "true");
  $("meta").innerHTML = renderLoading(message || "正在加载...");
  $("risks").innerHTML = "";
  $("exports").innerHTML = "";
  $("turns").innerHTML = "";
  $("turns").removeAttribute("aria-busy");
}

function activeOptions() {
  if ($("includeToolOutput").checked) {
    $("includeTools").checked = true;
  }
  return new URLSearchParams({
    id: state.selected,
    includeTools: $("includeTools").checked ? "1" : "0",
    includeToolOutput: $("includeToolOutput").checked ? "1" : "0",
    redact: $("redact").checked ? "1" : "0",
    safety: SAFETY_CHECKS_ENABLED ? "1" : "0",
  });
}

function selectedSession() {
  return state.sessions.find((session) => sessionRef(session) === state.selected) || null;
}

function currentProjectCwd() {
  const selected = selectedSession();
  if (!selected || isNoProjectSession(selected)) {
    return "";
  }
  return projectPath(selected);
}

function openSearchDialog() {
  state.search.open = true;
  $("searchOverlay").hidden = false;
  renderSearch();
  setTimeout(() => {
    $("globalSearch").focus();
    $("globalSearch").select();
  }, 0);
}

function closeSearchDialog() {
  state.search.open = false;
  $("searchOverlay").hidden = true;
}

function setSearchScope(scope) {
  state.search.scope = scope === "project" ? "project" : "all";
  renderSearch();
  scheduleSearch(0);
}

let searchTimer = 0;
function scheduleSearch(delay = 220) {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(() => {
    searchTimer = 0;
    runSearch();
  }, delay);
}

async function runSearch() {
  const query = $("globalSearch").value.trim();
  state.search.query = query;
  state.search.error = "";
  if (!query) {
    state.search.loading = false;
    state.search.results = [];
    state.search.terms = [];
    state.search.matched = 0;
    state.search.scanned = 0;
    state.search.failed = 0;
    renderSearch();
    return;
  }

  const requestToken = state.search.requestToken + 1;
  state.search.requestToken = requestToken;
  state.search.loading = true;
  renderSearch();

  const params = new URLSearchParams({
    q: query,
    source: "all",
    limit: "24",
    scanLimit: String(SEARCH_SCAN_LIMIT),
    completeOnly: "1",
  });
  const cwd = state.search.scope === "project" ? currentProjectCwd() : "";
  if (cwd) {
    params.set("cwd", cwd);
  }

  try {
    const response = await fetch("/api/search?" + params.toString());
    const payload = await response.json();
    if (requestToken !== state.search.requestToken) {
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "Search failed");
    }
    state.search.results = Array.isArray(payload.results) ? payload.results : [];
    state.search.terms = Array.isArray(payload.terms) ? payload.terms : [];
    state.search.matched = Number(payload.matched || state.search.results.length);
    state.search.scanned = Number(payload.scanned || 0);
    state.search.failed = Number(payload.failed || 0);
  } catch (error) {
    if (requestToken !== state.search.requestToken) {
      return;
    }
    state.search.results = [];
    state.search.terms = [];
    state.search.matched = 0;
    state.search.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (requestToken === state.search.requestToken) {
      state.search.loading = false;
      renderSearch();
    }
  }
}

function renderSearch() {
  const projectCwd = currentProjectCwd();
  if (state.search.scope === "project" && !projectCwd) {
    state.search.scope = "all";
  }
  for (const button of document.querySelectorAll("[data-search-scope]")) {
    const scope = button.dataset.searchScope;
    const active = scope === state.search.scope;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.disabled = scope === "project" && !projectCwd;
  }

  const status = $("searchStatus");
  if (state.search.loading) {
    status.textContent = "正在搜索...";
  } else if (state.search.error) {
    status.textContent = state.search.error;
  } else if (state.search.query) {
    const failed = state.search.failed ? "，跳过 " + state.search.failed + " 条" : "";
    status.textContent = "命中 " + state.search.matched + " / 扫描 " + state.search.scanned + failed;
  } else {
    status.textContent = "";
  }

  if (state.search.loading) {
    $("searchResults").innerHTML = renderLoading("正在搜索会话...");
    return;
  }
  if (!state.search.query) {
    $("searchResults").innerHTML = "<div class='search-empty'>输入关键词开始搜索</div>";
    return;
  }
  if (state.search.error) {
    $("searchResults").innerHTML = "<div class='search-empty'>" + esc(state.search.error) + "</div>";
    return;
  }
  if (!state.search.results.length) {
    $("searchResults").innerHTML = "<div class='search-empty'>没有匹配的会话</div>";
    return;
  }
  $("searchResults").innerHTML = state.search.results.map(renderSearchResult).join("");
}

function renderSearchResult(result) {
  const ref = result.ref || "";
  const title = result.title || ref || "Untitled session";
  const path = result.displayCwd || result.cwd || "普通会话";
  const source = [result.engineLabel || "Codex", relativeTime(result.mtime)].filter(Boolean).join(" · ");
  const label = [result.label || result.role || "Match", result.turn ? "#" + result.turn : ""].filter(Boolean).join(" ");
  return "<button class='search-result' type='button' data-search-result='" + esc(ref) + "'>" +
    "<strong class='search-result-title'>" + esc(title) + "</strong>" +
    "<span class='search-result-source'>" + esc(source) + "</span>" +
    "<span class='search-result-path'>" + esc(path) + "</span>" +
    "<p class='search-result-snippet'>" + highlightSearchSnippet(result.snippet || "", result.terms || state.search.terms) + "</p>" +
    "<span class='search-result-meta'>" + esc(label) + "</span>" +
  "</button>";
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
    state.activeSource = sessionEngine(result.session);
  }
  closeSearchDialog();
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
  const filter = $("filter").value.trim().toLowerCase();
  const source = sourceByKey(state.activeSource);
  const sessions = sourceSessions(source.key);
  const sourceMatches = (source.label + " " + source.key).toLowerCase().includes(filter);
  const groups = groupSessions(sessions, sourceMatches ? "" : filter);
  const body = groups.length
    ? groups.map(renderProjectGroup).join("")
    : "<div class='source-empty'>" + (filter ? "没有匹配的会话" : "暂无会话") + "</div>";
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

function sourceSessions(key) {
  return state.sessions.filter((session) => sessionEngine(session) === key);
}

async function selectFirstSessionForActiveSource() {
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
  $("title").textContent = "选择一个会话";
  $("meta").textContent = message || "还没有选择会话。";
  $("meta").classList.add("empty");
  $("meta").classList.remove("loading");
  $("meta").removeAttribute("aria-busy");
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
      groupMap.set(key, {
        key,
        label: projectLabel(session),
        displayPath: projectDisplayPath(session),
        isNoProject,
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

function projectKey(session) {
  if (isNoProjectSession(session)) {
    return sessionEngine(session) + "::no-project";
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

function sortProjectGroups(groups) {
  return groups.slice().sort((a, b) => {
    if (a.isNoProject !== b.isNoProject) {
      return a.isNoProject ? 1 : -1;
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
  const expandedLimit = group.isNoProject ? Math.min(noisyExpandedLimit, group.sessions.length) : group.sessions.length;
  const visibleLimit = expanded ? expandedLimit : Math.min(collapsedLimit, group.sessions.length);
  let visible = group.sessions.slice(0, visibleLimit);
  if (!collapsed && activeIndex >= visibleLimit) {
    visible = visible.slice(0, Math.max(0, visibleLimit - 1)).concat(group.sessions[activeIndex]);
  }
  const showToggle = !collapsed && group.sessions.length > collapsedLimit;
  const toggleLabel = expanded ? "收起" : group.isNoProject ? "显示最近 " + Math.min(noisyExpandedLimit, group.sessions.length) : "展开显示";
  const toggle = showToggle
    ? "<button class='project-more' type='button' data-project-toggle='" + esc(group.key) + "'>" + toggleLabel + "</button>"
    : "";
  const note = !collapsed && group.isNoProject && expanded && group.sessions.length > noisyExpandedLimit
    ? "<div class='project-note'>仅显示最近 " + noisyExpandedLimit + " / " + esc(group.sessions.length) + "，可搜索标题定位更多</div>"
    : "";
  const sessionList = collapsed ? "" : "<div class='session-list'>" + visible.map(renderSessionRow).join("") + "</div>";
  const sectionClass = "project-group" + (group.isNoProject ? " no-project" : "") + (collapsed ? " collapsed" : "");
  return "<section class='" + sectionClass + "'>" +
    "<button class='project-header' type='button' data-project-collapse='" + esc(group.key) + "' aria-expanded='" + (collapsed ? "false" : "true") + "' title='" + esc(group.displayPath) + "'>" +
      "<span class='project-icon' aria-hidden='true'></span>" +
      "<span class='project-title'>" + esc(group.label) + "</span>" +
      "<span class='project-count'>" + esc(group.sessions.length) + "</span>" +
    "</button>" +
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
  $("title").textContent = snapshot.title;
  $("meta").classList.remove("empty", "loading");
  $("meta").removeAttribute("aria-busy");
  $("meta").innerHTML = renderSnapshotMeta(snapshot);
  const notices = (snapshot.notices || []).map((notice) => {
    return "<div class='notice " + esc(notice.severity || "medium") + "'><b>NOTE</b><span><strong>" + esc(notice.label || "Notice") + ".</strong> " + esc(notice.text || "") + "</span></div>";
  }).join("");
  const risks = snapshot.risks.length ? snapshot.risks.map((risk) => {
    return "<div class='risk " + esc(risk.severity) + "'><b>" + esc(risk.severity) + "</b><span>" + esc(risk.label) + "</span><em>" + esc(formatRiskTurns(risk)) + "</em></div>";
  }).join("") : "<div class='risk'><b>OK</b><span>未发现常见高风险模式</span><em>分享前仍建议快速复核。</em></div>";
  $("risks").innerHTML = snapshot.safetyChecks === false ? "" : notices + risks;
  const options = activeOptions();
  $("exports").innerHTML = "<a href='/export?" + options.toString() + "&format=html' target='_blank' rel='noopener noreferrer'>导出 HTML</a><a href='/export?" + options.toString() + "&format=md' target='_blank' rel='noopener noreferrer'>导出 Markdown</a><button type='button' data-publish-cloud='1'>发布分享</button><span id='publishStatus' class='publish-status'></span>";
  $("turns").innerHTML = snapshot.transcriptHtml || "<div class='meta'>没有找到可分享的用户或助手消息。</div>";
  openContentLinksInNewTabs($("turns"));
  postSnapshotState(snapshot);
}

function renderSnapshotMeta(snapshot) {
  const usage = snapshot.tokenUsage || {};
  const totalTokens = tokenUsageNumber(usage.totalTokens ?? usage.total_tokens);
  const inputTokens = tokenUsageNumber(usage.inputTokens ?? usage.input_tokens);
  const cachedInputTokens = tokenUsageNumber(usage.cachedInputTokens ?? usage.cached_input_tokens);
  const outputTokens = tokenUsageNumber(usage.outputTokens ?? usage.output_tokens);
  const reasoningOutputTokens = tokenUsageNumber(usage.reasoningOutputTokens ?? usage.reasoning_output_tokens);
  const items = totalTokens || inputTokens || outputTokens || cachedInputTokens || reasoningOutputTokens
    ? [
      ["总用量", formatTokenCount(totalTokens || inputTokens + outputTokens) + " tokens"],
      ["输入", formatTokenCount(inputTokens)],
      ...(cachedInputTokens ? [["缓存输入", formatTokenCount(cachedInputTokens)]] : []),
      ["输出", formatTokenCount(outputTokens)],
      ...(reasoningOutputTokens ? [["推理", formatTokenCount(reasoningOutputTokens)]] : []),
    ]
    : [["Token", "暂无 token 统计"]];
  const pills = "<div class='meta-pills'>" + items.map(([label, value]) => {
    return "<span class='meta-pill'><b>" + esc(label) + "</b><span>" + esc(value) + "</span></span>";
  }).join("") + "</div>";
  const goal = snapshot.goalObjective
    ? "<div class='meta-goal'><b>目标</b><span>" + esc(snapshot.goalObjective) + "</span></div>"
    : "";
  return pills + goal;
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
$("filter").addEventListener("input", renderSessions);
$("reload").addEventListener("click", loadSessions);
$("openSearch").addEventListener("click", openSearchDialog);
$("closeSearch").addEventListener("click", closeSearchDialog);
$("globalSearch").addEventListener("input", () => scheduleSearch());
$("globalSearch").addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    const first = state.search.results[0];
    if (first?.ref) {
      event.preventDefault();
      await selectSearchResult(first.ref);
    }
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeSearchDialog();
  }
});
$("searchOverlay").addEventListener("click", (event) => {
  if (event.target === $("searchOverlay")) {
    closeSearchDialog();
  }
});
$("searchResults").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-search-result]");
  if (button) {
    await selectSearchResult(button.dataset.searchResult);
  }
});
for (const button of document.querySelectorAll("[data-search-scope]")) {
  button.addEventListener("click", () => setSearchScope(button.dataset.searchScope));
}
document.addEventListener("keydown", (event) => {
  const key = String(event.key || "").toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "k") {
    event.preventDefault();
    openSearchDialog();
    return;
  }
  if (event.key === "Escape" && state.search.open) {
    event.preventDefault();
    closeSearchDialog();
  }
});
$("exports").addEventListener("click", (event) => {
  if (event.target.closest("[data-publish-cloud]")) {
    publishSelectedSession();
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
for (const id of ["includeTools", "includeToolOutput", "redact"]) {
  $(id).addEventListener("change", () => state.selected && selectSession(state.selected));
}
initSplitter();
loadSessions().catch((error) => {
  $("sessions").innerHTML = "<div class='meta'>" + esc(error.message) + "</div>";
  clearViewer(error.message || "Failed to load sessions.");
});
`;
}
