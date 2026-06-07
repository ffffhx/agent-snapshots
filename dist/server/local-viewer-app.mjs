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
  --ink: #17202a;
  --muted: #617181;
  --soft: #8492a3;
  --line: #d9e2e8;
  --paper: #f6f8f5;
  --panel: #ffffff;
  --panel-soft: #f8fbf9;
  --panel-wash: rgba(255, 255, 255, 0.82);
  --sidebar-width: clamp(340px, 28vw, 470px);
  --splitter-width: 14px;
  --blue: #2f6fbb;
  --teal: #0f766e;
  --green: #15803d;
  --red: #b43b45;
  --amber: #b7791f;
  --focus: #2f6fbb;
  --shadow-soft: 0 24px 70px -54px rgba(23, 32, 42, 0.42);
  --shadow-panel: 0 26px 80px -62px rgba(23, 32, 42, 0.55);
  --grid-strong: rgba(23, 32, 42, 0.058);
  --grid-soft: rgba(23, 32, 42, 0.034);
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
  background: var(--paper);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
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
  background: var(--panel-soft);
  padding: 12px 14px 24px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  border-right: 1px solid rgba(23, 32, 42, 0.1);
  box-shadow: inset -16px 0 36px -34px rgba(23, 32, 42, 0.46);
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
  width: 2px;
  background: rgba(23, 32, 42, 0.16);
  content: "";
  transform: translateX(-50%);
}
.splitter::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 7px;
  height: 76px;
  border: 1px solid rgba(23, 32, 42, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  content: "";
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity 120ms ease, background 120ms ease, border-color 120ms ease;
}
.splitter:hover::after,
.splitter:focus-visible::after,
.app.resizing .splitter::after {
  border-color: rgba(23, 32, 42, 0.42);
  background: rgba(255, 255, 255, 0.96);
  opacity: 1;
}
.splitter:focus-visible {
  outline: 3px solid rgba(47, 111, 187, 0.22);
  outline-offset: -3px;
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
  background: var(--panel-soft);
  box-shadow: 0 16px 30px -30px rgba(23, 32, 42, 0.78);
}
.eyebrow {
  margin: 0 0 4px;
  color: var(--blue);
  font: 800 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: 36px; line-height: 1; }
.sidebar h1 {
  color: var(--ink);
  font: 900 26px/1.02 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
h2 { font-size: 28px; line-height: 1.12; overflow-wrap: anywhere; }
.toolbar { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 12px; }
input[type="search"] {
  min-width: 0;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  padding: 0 14px;
  color: var(--ink);
  font: 700 14px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  outline: 0;
}
input[type="search"]:focus {
  border-color: var(--focus);
  box-shadow: 0 0 0 3px rgba(47, 111, 187, 0.13);
}
button, .exports a {
  min-height: 40px;
  border: 1px solid var(--ink);
  border-radius: 8px;
  background: var(--ink);
  color: white;
  padding: 0 14px;
  font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-decoration: none;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
}
button:hover, .exports a:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px -20px rgba(23, 32, 42, 0.82);
}
button:focus-visible,
.exports a:focus-visible,
.source-tab:focus-visible,
.session:focus-visible,
.project-more:focus-visible,
.sessions-load-more:focus-visible {
  outline: 3px solid rgba(47, 111, 187, 0.22);
  outline-offset: 2px;
}
button:disabled {
  cursor: wait;
  opacity: 0.62;
  transform: none;
  box-shadow: none;
}
.loading-state {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  color: var(--muted);
  padding: 12px;
  font: 800 12px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
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
  border: 2px solid rgba(23, 32, 42, 0.16);
  border-top-color: var(--ink);
  border-radius: 999px;
  animation: snapshot-spin 0.8s linear infinite;
}
@keyframes snapshot-spin {
  to { transform: rotate(360deg); }
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
  top: 108px;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  border: 1px solid rgba(23, 32, 42, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  padding: 5px;
  box-shadow: 0 14px 28px -30px rgba(23, 32, 42, 0.72);
}
.source-tab {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-width: 0;
  min-height: 36px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: rgba(23, 32, 42, 0.64);
  padding: 0 9px;
  text-align: left;
  font: 900 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
.source-tab:hover {
  border-color: rgba(23, 32, 42, 0.16);
  background: rgba(23, 32, 42, 0.06);
  color: var(--ink);
}
.source-tab.active {
  border-color: var(--teal);
  background: var(--teal);
  color: #fff;
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
}
.source-total {
  color: var(--muted);
  font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.source-empty {
  margin-left: 34px;
  color: rgba(23, 32, 42, 0.48);
  font: 700 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.project-group {
  display: grid;
  gap: 8px;
  border-top: 1px solid rgba(23, 32, 42, 0.08);
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
  border-radius: 8px;
  background: transparent;
  color: rgba(23, 32, 42, 0.78);
  padding: 0;
  text-align: left;
  font: 900 19px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  box-shadow: none;
  cursor: pointer;
}
.project-header:hover {
  background: rgba(23, 32, 42, 0.06);
  color: var(--ink);
  transform: none;
  box-shadow: none;
}
.project-header:focus-visible {
  outline: 3px solid rgba(15, 118, 110, 0.28);
  outline-offset: 2px;
}
.project-group.collapsed .project-header {
  color: rgba(23, 32, 42, 0.62);
}
.project-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-count {
  color: var(--muted);
  font: 900 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.project-icon {
  position: relative;
  display: inline-block;
  width: 21px;
  height: 15px;
  border: 2px solid currentColor;
  border-radius: 3px;
}
.project-icon::before {
  position: absolute;
  top: -7px;
  left: 1px;
  width: 10px;
  height: 6px;
  border: 2px solid currentColor;
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
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  padding: 8px 11px;
  text-align: left;
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
  background: rgba(15, 118, 110, 0.1);
  transform: none;
  box-shadow: none;
}
.session.active::before { background: var(--teal); }
.session strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  line-height: 1.25;
}
.session-time {
  color: var(--muted);
  font: 900 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
}
.session-badge {
  border: 1px solid rgba(183, 121, 31, 0.32);
  background: rgba(255, 248, 232, 0.86);
  color: var(--amber);
  padding: 3px 5px;
  font: 800 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  white-space: nowrap;
}
.project-more {
  justify-self: start;
  min-height: 30px;
  margin-left: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(23, 32, 42, 0.5);
  padding: 4px 10px;
  font: 800 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  box-shadow: none;
}
.project-more:hover {
  color: var(--ink);
  background: rgba(23, 32, 42, 0.06);
  transform: none;
  box-shadow: none;
}
.project-note {
  margin-left: 44px;
  color: rgba(23, 32, 42, 0.52);
  font: 700 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
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
  border: 1px solid rgba(23, 32, 42, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  box-shadow: none;
}
.sessions-load-more:hover {
  background: rgba(23, 32, 42, 0.07);
  transform: none;
  box-shadow: none;
}
.sessions-load-more:disabled {
  background: rgba(23, 32, 42, 0.05);
}
.load-more-meta {
  color: rgba(23, 32, 42, 0.48);
  font: 700 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.load-more-error {
  color: var(--red);
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
  border-bottom: 1px solid rgba(23, 32, 42, 0.12);
  margin: -14px clamp(-34px, -2vw, -18px) 14px;
  padding: 12px clamp(18px, 2vw, 34px);
  background: var(--paper);
  box-shadow: 0 18px 42px -38px rgba(23, 32, 42, 0.72);
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
.switches { display: flex; flex-wrap: wrap; gap: 8px; justify-content: end; }
.switches label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.88);
  padding: 0 10px;
  font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  user-select: none;
}
.switches input {
  accent-color: var(--teal);
}
.meta, .risks, .exports { margin-top: 10px; }
.risks:empty { display: none; }
.meta {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-wash);
  padding: 10px;
  color: var(--muted);
  font: 800 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
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
  border: 1px solid rgba(23, 32, 42, 0.09);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.7);
  padding: 8px 10px;
  color: var(--ink);
}
.meta-pill b {
  color: var(--soft);
  font: 900 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
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
  border: 1px solid rgba(23, 32, 42, 0.09);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.7);
  padding: 10px;
  color: var(--ink);
}
.meta-goal b {
  color: var(--soft);
  font: 900 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
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
  border-left: 5px solid var(--amber);
  border-radius: 8px;
  background: rgba(255, 248, 232, 0.9);
  padding: 10px 12px;
}
.notice b {
  color: var(--amber);
  font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
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
  border-left: 5px solid var(--green);
  border-radius: 8px;
  background: rgba(245, 251, 247, 0.9);
  padding: 11px 12px;
}
.risk.high { border-color: var(--red); background: rgba(255, 241, 238, 0.92); }
.risk.medium { border-color: var(--amber); background: rgba(255, 248, 232, 0.9); }
.risk b, .risk span, .risk em { min-width: 0; }
.risk b { font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
.risk span { line-height: 1.35; overflow-wrap: normal; }
.risk em { color: var(--muted); font-style: normal; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
.exports { display: flex; flex-wrap: wrap; gap: 8px; }
.exports a,
.exports button {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  border-radius: 7px;
  padding: 0 11px;
  font-size: 11px;
}
.exports button[data-publish-cloud] {
  border-color: var(--teal);
  background: var(--teal);
}
.publish-status {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  max-width: min(680px, 100%);
  overflow-wrap: anywhere;
  color: var(--muted);
  font: 800 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.publish-status a {
  color: var(--blue);
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
}
.user { justify-content: flex-end; }
.assistant, .tool { justify-content: flex-start; }
.process { justify-content: flex-start; }
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
  border: 1px solid rgba(15, 118, 110, 0.18);
  border-radius: 8px;
  background: #eef9f6;
  padding: 12px 18px;
  box-shadow: 0 26px 64px -56px rgba(23, 32, 42, 0.48);
}
.assistant .message-card {
  max-width: min(1120px, 74%);
}
.tool .message-card {
  max-width: min(1160px, 80%);
  border: 1px solid rgba(183, 121, 31, 0.26);
  border-radius: 8px;
  background: #fff8df;
  padding: 16px 18px;
}
.turn-meta {
  margin-bottom: 10px;
  color: var(--muted);
  font: 900 11px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
.turn-meta span { font-weight: 700; }
.process-details {
  width: min(1120px, 74%);
  border-top: 1px solid rgba(23, 32, 42, 0.1);
  color: rgba(23, 32, 42, 0.62);
}
.process-summary {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  font: 800 17px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.process-summary::-webkit-details-marker {
  display: none;
}
.process-summary::after {
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
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
  color: var(--ink);
  font-size: 17px;
}
.process-tool {
  max-width: min(980px, 100%);
  border-left: 3px solid rgba(183, 121, 31, 0.32);
  padding-left: 12px;
}
.body {
  min-width: 0;
  max-width: 78ch;
  font-size: 18px;
  line-height: 1.7;
}
.body > * { margin: 0; }
.body > * + * { margin-top: 18px; }
.body p, .body li { overflow-wrap: anywhere; }
.body strong { font-weight: 800; }
.body em { font-style: italic; }
.body a { color: var(--blue); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.body code {
  border: 1px solid rgba(23, 32, 42, 0.12);
  border-radius: 6px;
  background: rgba(23, 32, 42, 0.06);
  padding: 0.08rem 0.34rem;
  font-size: 0.9em;
}
.body pre {
  position: relative;
  max-width: 100%;
  overflow: auto;
  border: 1px solid #253043;
  border-radius: 8px;
  background: #111722;
  color: #edf4ff;
  padding: 38px 16px 16px;
  font: 13px/1.58 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre;
  box-shadow: 0 26px 64px -52px rgba(23, 32, 42, 0.8);
}
.body pre[data-language]::before {
  position: absolute;
  top: 10px;
  right: 12px;
  max-width: calc(100% - 24px);
  overflow: hidden;
  color: #aeb8c8;
  content: attr(data-language);
  font: 900 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
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
}
.body .hljs-keyword,
.body .hljs-selector-tag,
.body .hljs-built_in { color: #8ab4f8; }
.body .hljs-title,
.body .hljs-title.class_,
.body .hljs-title.function_ { color: #f2cc60; }
.body .hljs-string,
.body .hljs-attr,
.body .hljs-symbol { color: #9ccc65; }
.body .hljs-number,
.body .hljs-literal { color: #f8a978; }
.body .hljs-comment { color: #7d8796; font-style: italic; }
.body .hljs-type,
.body .hljs-params,
.body .hljs-variable,
.body .hljs-property { color: #c4b5fd; }
.body ul, .body ol { padding-left: 1.35rem; }
.body li + li { margin-top: 0.25rem; }
.body blockquote {
  border-left: 3px solid #ccd5df;
  margin-left: 0;
  padding-left: 14px;
  color: #4b5563;
}
.body h1, .body h2, .body h3 {
  line-height: 1.25;
  font-size: 1.08em;
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
  border: 1px solid rgba(23, 32, 42, 0.18);
  border-radius: 8px;
  background: #fff;
  object-fit: contain;
  box-shadow: 0 24px 54px -50px rgba(23, 32, 42, 0.6);
}
.image-unavailable {
  border: 1px dashed var(--line);
  border-radius: 8px;
  padding: 16px;
  color: var(--muted);
}
pre {
  overflow: auto;
  max-height: 460px;
  margin: 0;
  border: 1px solid #252c39;
  background: #111722;
  color: #edf4ff;
  padding: 12px;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
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
  .sidebar { border-bottom: 2px solid var(--ink); }
  .splitter { display: none; }
  .sidebar-top { position: static; }
  .source-switcher { position: static; }
  .switches { justify-content: start; }
  .risk { grid-template-columns: 1fr; }
  .turns { gap: 36px; }
  .message-card, .user .message-card { max-width: 94%; }
  .assistant .message-card { max-width: 100%; }
  .user .message-card { padding: 12px 16px; }
  .body { font-size: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .loading-spinner { animation: none; }
}
`;
}
function serverJs() {
    return `
const state = { sessions: [], selected: "", activeSource: "codex", requestToken: 0, expandedProjects: new Set(), collapsedProjects: new Set(), hasMoreSessions: false, loadingMoreSessions: false, sessionListError: "" };
const SOURCE_MODULES = [
  { key: "codex", label: "Codex" },
  { key: "claude", label: "Claude Code" },
  { key: "trae", label: "Trae" },
];
const SESSION_BATCH_LIMIT = 200;
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
