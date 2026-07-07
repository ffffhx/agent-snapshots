// @ts-nocheck

import { MUTATION_CSRF_HEADER } from "./local-security.js";
export function renderServerApp(csrfToken, shareConfig = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Snapshots</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>${serverCss()}</style>
</head>
<body>
  <main class="app">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="brand">
          <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#c33f28"/><g transform="rotate(-5 32 32)"><rect x="18.5" y="16" width="27" height="33" rx="3" fill="#5c160c" opacity="0.22"/><rect x="18.5" y="15" width="27" height="33" rx="3" fill="#f6ecd6"/><g fill="#c9bb98"><rect x="22.5" y="21" width="19" height="2" rx="1"/><rect x="22.5" y="25.5" width="17" height="2" rx="1"/><rect x="22.5" y="30" width="19" height="2" rx="1"/><rect x="22.5" y="34.5" width="13.5" height="2" rx="1"/></g><circle cx="40.5" cy="42.5" r="6.2" fill="#a82f1c"/><circle cx="40.5" cy="42.5" r="6.2" fill="none" stroke="#fff3df" stroke-width="0.9" stroke-opacity="0.85"/><circle cx="40.5" cy="42.5" r="1.4" fill="#fff3df"/></g></svg>
          <div class="brand-wm"><b>Agent Snapshots</b><span>Read-only archive</span></div>
        </div>
        <div class="toolbar">
          <button id="openSearch" class="search-entry" type="button" title="搜索会话正文">
            <span>搜索会话正文</span>
            <kbd>⌘K</kbd>
          </button>
          <button id="openStats" type="button" title="使用与 token 统计">统计</button>
          <button id="openGallery" type="button" title="浏览跨会话图片">图库</button>
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
          <div class="appearance" role="group" aria-label="外观快捷设置">
            <div class="appx-seg theme-quick" role="group" aria-label="主题快捷切换">
              <button class="appx" type="button" data-theme-set="light" title="纸（浅色）">纸</button>
              <button class="appx" type="button" data-theme-set="sepia" title="褐（护眼）">褐</button>
              <button class="appx" type="button" data-theme-set="dark" title="暗（深色）">暗</button>
            </div>
            <div class="settings-shell">
              <button id="settingsToggle" class="appx settings-button" type="button" title="设置" aria-label="设置" aria-haspopup="dialog" aria-expanded="false" aria-controls="settingsPopover">⚙</button>
              <div id="settingsPopover" class="settings-popover" role="dialog" aria-label="设置" hidden>
                <div class="settings-head">
                  <b>设置</b>
                  <button id="settingsClose" class="settings-close" type="button" title="关闭设置">关闭</button>
                </div>
                <section class="settings-section" aria-label="主题">
                  <span class="settings-label">主题</span>
                  <div class="appx-seg settings-seg" role="group" aria-label="主题">
                    <button class="appx" type="button" data-theme-set="light" title="纸（浅色）">纸</button>
                    <button class="appx" type="button" data-theme-set="sepia" title="褐（护眼）">褐</button>
                    <button class="appx" type="button" data-theme-set="dark" title="暗（深色）">暗</button>
                  </div>
                </section>
                <section class="settings-section" aria-label="阅读字号">
                  <span class="settings-label">阅读字号</span>
                  <div class="settings-control-row">
                    <button class="appx" type="button" data-font-step="-1" title="缩小正文字号">A－</button>
                    <span id="readScaleValue" class="settings-value">100%</span>
                    <button class="appx" type="button" data-font-step="1" title="放大正文字号">A＋</button>
                  </div>
                </section>
                <section class="settings-section" aria-label="密度">
                  <span class="settings-label">密度</span>
                  <div class="appx-seg settings-seg" role="group" aria-label="密度">
                    <button class="appx" type="button" data-density-set="comfortable" title="宽松阅读密度">宽松</button>
                    <button class="appx" type="button" data-density-set="compact" title="紧凑阅读密度">紧凑</button>
                  </div>
                </section>
                <section class="settings-section" aria-label="当前视图详略">
                  <span class="settings-label">当前视图</span>
                  <div class="appx-seg settings-seg view-mode-seg" role="group" aria-label="当前视图详略">
                    <button class="appx" type="button" data-view-verbosity="standard" title="标准视图（Ctrl+O）">标准</button>
                    <button class="appx" type="button" data-view-verbosity="detailed" title="详细视图（Ctrl+O）">详细</button>
                    <button class="appx" type="button" data-view-verbosity="summary" title="摘要视图（Ctrl+O）">摘要</button>
                  </div>
                </section>
                <section class="settings-section" aria-label="默认视图详略">
                  <span class="settings-label">默认视图</span>
                  <div class="appx-seg settings-seg view-mode-seg" role="group" aria-label="默认视图详略">
                    <button class="appx" type="button" data-default-view-verbosity="standard" title="默认标准视图">标准</button>
                    <button class="appx" type="button" data-default-view-verbosity="detailed" title="默认详细视图">详细</button>
                    <button class="appx" type="button" data-default-view-verbosity="summary" title="默认摘要视图">摘要</button>
                  </div>
                </section>
                <section class="settings-section" aria-label="大纲">
                  <span class="settings-label">大纲</span>
                  <button id="toggleOutline" class="appx settings-wide-button" type="button" title="打开/收起大纲（Ctrl+M）" aria-pressed="false">打开大纲</button>
                </section>
                <label class="settings-toggle-row" title="没有保存过大纲状态时默认打开大纲面板">
                  <span>大纲面板默认开启</span>
                  <input id="defaultOutlineOpen" type="checkbox">
                </label>
              </div>
            </div>
          </div>
          <div class="reading-tools" role="group" aria-label="阅读工具">
            <button id="openShortcuts" class="appx" type="button" title="快捷键（⌘/）">⌘/</button>
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
      <button id="followLatest" class="follow-latest" type="button" hidden>↓ 跟随最新</button>
    </section>
  </main>
  <aside id="outlinePanel" class="outline-panel" aria-label="消息大纲" aria-hidden="true">
    <div class="outline-head">
      <b>大纲</b>
      <button id="closeOutline" class="outline-close" type="button" title="收起大纲">收起</button>
    </div>
    <div id="outlineList" class="outline-list"></div>
  </aside>
  <div id="searchOverlay" class="search-overlay" hidden>
    <section class="search-dialog" role="dialog" aria-modal="true" aria-labelledby="searchTitle">
      <div class="search-bar">
        <div>
          <p class="eyebrow">Session search</p>
          <h2 id="searchTitle">搜索会话正文</h2>
        </div>
        <button id="closeSearch" class="search-close" type="button" title="关闭搜索">关闭</button>
      </div>
      <input id="globalSearch" class="global-search-input" type="search" placeholder="关键词，可加 source: role: project: before: after: -排除" title="支持过滤语法：source:codex/claude/trae、role:user/assistant、project:名称、before:2026-01-01、after:2026-01-01、-排除词" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="searchResults" autocomplete="off" spellcheck="false">
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
  <div id="galleryOverlay" class="gallery-overlay" hidden>
    <section class="gallery-dialog" role="dialog" aria-modal="true" aria-labelledby="galleryTitle">
      <div class="gallery-bar">
        <div>
          <p class="eyebrow">Image archive</p>
          <h2 id="galleryTitle">图库</h2>
        </div>
        <button id="closeGallery" class="search-close" type="button" title="关闭图库">关闭</button>
      </div>
      <div id="galleryFilters" class="gallery-filters" role="group" aria-label="图片来源筛选"></div>
      <div id="galleryBody" class="gallery-body"></div>
    </section>
  </div>
  <div id="galleryLightbox" class="gallery-lightbox" hidden>
    <button class="gallery-lightbox-nav prev" type="button" data-lightbox-prev title="上一张">‹</button>
    <figure class="gallery-lightbox-figure">
      <img id="galleryLightboxImage" alt="">
      <figcaption id="galleryLightboxCaption"></figcaption>
    </figure>
    <button class="gallery-lightbox-nav next" type="button" data-lightbox-next title="下一张">›</button>
  </div>
  <div id="shortcutOverlay" class="shortcut-overlay" hidden>
    <section class="shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcutTitle">
      <div class="shortcut-bar">
        <div>
          <p class="eyebrow">快捷键</p>
          <h2 id="shortcutTitle">快捷键</h2>
        </div>
        <button id="closeShortcuts" class="search-close" type="button" title="关闭">关闭</button>
      </div>
      <div class="shortcut-list">
        <div><kbd>⌘K</kbd><span>全局搜索</span></div>
        <div><kbd>Ctrl+O</kbd><span>视图详略</span></div>
        <div><kbd>Ctrl+M</kbd><span>大纲</span></div>
        <div><kbd>[</kbd><kbd>]</kbd><span>上下个用户回合</span></div>
        <div><kbd>⌘/</kbd><span>快捷键</span></div>
        <div><kbd>Esc</kbd><span>关闭弹层</span></div>
      </div>
    </section>
  </div>
  <div id="toast" class="toast" hidden></div>
  <script>window.AGENT_SNAPSHOT_SHARE_CONFIG=${inlineJson(shareConfig || {})}; window.AGENT_SNAPSHOT_CSRF_TOKEN=${inlineJson(csrfToken)};</script>
  <script>${serverJs()}</script>
</body>
</html>`;
}

function inlineJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    if (char === "<") return "\\u003c";
    if (char === ">") return "\\u003e";
    if (char === "&") return "\\u0026";
    if (char === "\u2028") return "\\u2028";
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
  --live: #3f8f62;
  --live-soft: rgba(63, 143, 98, 0.12);
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
  --live: #73c797;
  --live-soft: rgba(115, 199, 151, 0.14);
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
.session.live { grid-template-columns: auto minmax(0, 1fr) auto auto; }
.session:hover { background: rgba(33, 27, 16, 0.045); transform: none; }
.session.active { background: var(--seal-soft); }
.session.active::before { background: var(--seal); }
.session strong {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: 500 13.5px/1.3 var(--sans);
}
.session.active strong { font-weight: 600; }
.session-time { color: var(--faint); font: 600 10.5px/1 var(--mono); white-space: nowrap; }
.session-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--live);
  box-shadow: 0 0 0 0 rgba(63, 143, 98, 0.32);
  animation: live-pulse 2.4s ease-out infinite;
}
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
.session-badge.live {
  border-color: rgba(63, 143, 98, 0.32);
  background: var(--live-soft);
  color: var(--live);
  letter-spacing: 0;
  text-transform: none;
}
@keyframes live-pulse {
  0% { box-shadow: 0 0 0 0 rgba(63, 143, 98, 0.32); }
  70% { box-shadow: 0 0 0 7px rgba(63, 143, 98, 0); }
  100% { box-shadow: 0 0 0 0 rgba(63, 143, 98, 0); }
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
.live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--live);
  font-weight: 700;
}
.live-indicator .live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--live);
  box-shadow: 0 0 0 0 rgba(63, 143, 98, 0.32);
  animation: live-pulse 2.4s ease-out infinite;
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
.appearance { position: relative; display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; padding: 3px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--panel); }
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
.settings-shell { position: relative; display: inline-flex; }
.settings-button { font-size: 14px; line-height: 1; }
.settings-popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 45;
  display: grid;
  width: min(360px, calc(100vw - 32px));
  max-height: min(680px, calc(100dvh - 112px));
  gap: 12px;
  overflow: auto;
  border: 1px solid var(--line-2);
  border-top: 3px solid var(--seal);
  border-radius: 12px;
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  padding: 13px;
  box-shadow: var(--shadow-panel);
  scrollbar-width: thin;
}
.settings-popover[hidden] { display: none; }
.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--line);
  padding: 0 2px 10px;
}
.settings-head b { color: var(--ink); font: 700 12px/1 var(--mono); letter-spacing: var(--track-label); }
.settings-close {
  min-height: 28px;
  border: 1px solid var(--line-2);
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  padding: 0 9px;
  font: 700 10.5px/1 var(--mono);
  letter-spacing: 0.02em;
}
.settings-close:hover { border-color: var(--seal); background: transparent; color: var(--seal-deep); transform: none; }
.settings-section {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
.settings-label {
  color: var(--faint);
  font: 700 11px/1.2 var(--mono);
  letter-spacing: var(--track-label);
}
.settings-seg,
.settings-control-row {
  display: inline-flex;
  min-width: 0;
  width: fit-content;
  max-width: 100%;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--wash-1);
  padding: 3px;
}
.settings-control-row { align-items: center; }
.settings-value {
  display: inline-flex;
  min-width: 54px;
  min-height: 28px;
  align-items: center;
  justify-content: center;
  color: var(--ink-soft);
  font: 700 11px/1 var(--mono);
  font-variant-numeric: tabular-nums;
}
.settings-wide-button {
  justify-self: start;
  border: 1px solid var(--line);
  background: var(--wash-1);
  padding: 0 10px;
}
.settings-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--line);
  color: var(--ink-soft);
  padding: 12px 2px 1px;
  font: 700 12px/1.35 var(--sans);
  cursor: pointer;
  user-select: none;
}
.settings-toggle-row input {
  width: 34px;
  height: 20px;
  margin: 0;
  accent-color: var(--seal);
  cursor: pointer;
}
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
.exports button[data-publish-gist] { border-color: var(--pine); color: var(--pine); }
.exports button[data-publish-gist]:hover { border-color: var(--pine); background: var(--pine); color: #eef5ef; }
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
.commit-card {
  justify-content: center;
}
.commit-card .commit-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  width: min(760px, 100%);
  border: 1px solid rgba(47, 93, 73, 0.24);
  border-left: 4px solid var(--pine);
  border-radius: 10px;
  background: var(--pine-soft);
  color: var(--ink-soft);
  padding: 10px 13px;
  box-shadow: var(--shadow-soft);
}
.commit-sha {
  border: 1px solid rgba(47, 93, 73, 0.28);
  border-radius: 6px;
  background: var(--panel-wash);
  color: var(--pine);
  padding: 4px 6px;
  font: 700 10.5px/1 var(--mono);
}
.commit-subject {
  min-width: 0;
  overflow-wrap: anywhere;
  font: 600 13.5px/1.4 var(--sans);
}
.commit-time {
  color: var(--muted);
  font: 600 11px/1 var(--mono);
  white-space: nowrap;
}

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
.turns-hydrating {
  justify-self: center;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  font: 500 12px/1.6 var(--sans);
  color: var(--muted);
  letter-spacing: 0.02em;
}
.follow-latest {
  position: fixed;
  right: clamp(18px, 3vw, 34px);
  bottom: 24px;
  z-index: 25;
  min-height: 34px;
  border: 1px solid rgba(63, 143, 98, 0.34);
  border-radius: 999px;
  background: var(--panel);
  color: var(--live);
  padding: 0 14px;
  font: 800 12px/1 var(--mono);
  box-shadow: var(--shadow-panel);
}
.follow-latest:hover {
  border-color: var(--live);
  background: var(--live-soft);
  color: var(--live);
  transform: translateY(-1px);
}
.follow-latest[hidden] { display: none; }
.turn.prehydrated { animation: none; }
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
.process-files {
  max-width: min(52vw, 540px);
  overflow: hidden;
  color: var(--faint);
  font: 600 11px/1.3 var(--mono);
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.file-change {
  display: grid;
  gap: 7px;
}
.file-change + .file-change {
  margin-top: 12px;
}
.file-change-path {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--muted);
  font: 700 11px/1.35 var(--mono);
}
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
  display: flex; flex-direction: column; gap: 16px; width: min(1060px, 96vw);
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
.stats-body { display: flex; flex-direction: column; gap: 16px; }
.stats-shell { display: flex; flex-direction: column; gap: 14px; }
.stats-filterbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 2px; }
.stats-chip-group { display: inline-flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.stats-chip {
  min-height: 30px; border: 1px solid var(--line-2); border-radius: 999px;
  background: transparent; color: var(--ink-soft);
  padding: 0 11px; font: 700 11px/1 var(--mono);
}
.stats-chip:hover { border-color: var(--seal); color: var(--seal-deep); background: transparent; transform: none; }
.stats-chip.active { border-color: var(--seal); background: var(--seal-soft); color: var(--seal-deep); }
.stats-chip b { color: var(--faint); font-weight: 700; }
.stats-chip.active b { color: var(--seal-deep); }
.stats-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px 18px; }
.stats-section { min-width: 0; border-top: 1px solid var(--line); padding-top: 12px; }
.stats-section-quota, .stats-section-usage { grid-column: span 5; }
.stats-section-activity, .stats-section-projects { grid-column: span 7; }
.stats-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.stats-section h3 { margin: 0; color: var(--ink-soft); font: 700 13px/1.2 var(--sans); }
.stats-section-meta { color: var(--faint); font: 700 10.5px/1.2 var(--mono); white-space: nowrap; }
.stats-subsection { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
.stats-subsection .stats-section-head { margin-bottom: 8px; }
.stats-skeleton { display: grid; gap: 8px; }
.stats-skeleton-line {
  height: 12px; border-radius: 999px;
  background: linear-gradient(90deg, rgba(127,110,80,0.08), rgba(127,110,80,0.16), rgba(127,110,80,0.08));
  background-size: 220% 100%; animation: skeleton-shift 1.2s ease-in-out infinite;
}
.stats-skeleton-line.short { width: 42%; }
.stats-skeleton-line.mid { width: 70%; }
@keyframes skeleton-shift { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.stat-tile { display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel-wash); padding: 12px 14px; }
.stat-tile-k { color: var(--faint); font: 700 10.5px/1.2 var(--mono); letter-spacing: 0.05em; text-transform: uppercase; }
.stat-tile-v { color: var(--ink); font: 700 24px/1.1 var(--serif); }
.stat-tile-sub { color: var(--muted); font: 600 11px/1.3 var(--mono); }
.stat-rows { display: flex; flex-direction: column; gap: 6px; }
.stat-row { display: grid; grid-template-columns: minmax(80px, 150px) 1fr auto; gap: 10px; align-items: center; }
.stat-row-name { overflow: hidden; color: var(--ink-soft); font: 600 12px/1.3 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.stat-row-track { height: 8px; border-radius: 999px; background: rgba(127, 110, 80, 0.14); overflow: hidden; }
.stat-row-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--seal), var(--amber)); }
.stat-row-val { color: var(--ink); font: 700 11.5px/1.2 var(--mono); white-space: nowrap; }
.stat-row-val b { color: var(--faint); font-weight: 600; }
.stats-muted { color: var(--faint); font: 600 12px/1.4 var(--mono); }
.quota-list { display: grid; gap: 12px; }
.quota-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 5px; }
.quota-label { color: var(--ink-soft); font: 700 12px/1.2 var(--sans); }
.quota-value { color: var(--ink); font: 800 12px/1 var(--mono); }
.quota-track { height: 12px; border-radius: 999px; background: rgba(127, 110, 80, 0.14); overflow: hidden; box-shadow: inset 0 0 0 1px rgba(33, 27, 16, 0.05); }
.quota-fill { display: block; height: 100%; min-width: 2px; border-radius: inherit; transition: width 0.25s ease; }
.quota-meta { display: flex; justify-content: space-between; gap: 10px; margin-top: 5px; color: var(--faint); font: 650 10.5px/1.3 var(--mono); }
.activity-panel { display: grid; gap: 14px; }
.heatmap-frame { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; align-items: start; overflow-x: auto; padding-bottom: 2px; }
.heatmap-weekdays { display: grid; grid-template-rows: repeat(7, 10px); gap: 3px; color: var(--faint); font: 700 9px/10px var(--mono); }
.activity-heatmap { display: grid; grid-auto-flow: column; grid-auto-columns: 10px; grid-template-rows: repeat(7, 10px); gap: 3px; min-width: max-content; }
.activity-day { width: 10px; height: 10px; border: 1px solid rgba(33, 27, 16, 0.06); border-radius: 2px; background: rgba(127, 110, 80, 0.10); }
.activity-day.level-1 { background: rgba(47, 93, 73, 0.28); }
.activity-day.level-2 { background: rgba(47, 93, 73, 0.48); }
.activity-day.level-3 { background: rgba(154, 106, 27, 0.62); }
.activity-day.level-4 { background: rgba(177, 56, 42, 0.76); }
.hour-panel { display: grid; gap: 5px; }
.hour-bars { height: 54px; display: grid; grid-template-columns: repeat(24, minmax(4px, 1fr)); align-items: end; gap: 3px; }
.hour-bar { min-height: 2px; border-radius: 3px 3px 0 0; background: linear-gradient(180deg, var(--seal), var(--amber)); opacity: 0.88; }
.hour-axis { display: grid; grid-template-columns: repeat(4, 1fr); color: var(--faint); font: 700 9.5px/1 var(--mono); }
.hour-axis span:nth-child(2), .hour-axis span:nth-child(3) { text-align: center; }
.hour-axis span:last-child { text-align: right; }
.project-ranks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.rank-title { margin: 0 0 8px; color: var(--muted); font: 800 10.5px/1 var(--mono); letter-spacing: 0.04em; }
.rank-list { display: grid; gap: 7px; }
.rank-row { display: grid; grid-template-columns: minmax(86px, 1fr) minmax(72px, 0.8fr) auto; gap: 8px; align-items: center; }
.rank-name { overflow: hidden; color: var(--ink-soft); font: 650 12px/1.25 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.rank-track { height: 7px; border-radius: 999px; background: rgba(127, 110, 80, 0.14); overflow: hidden; }
.rank-fill { display: block; height: 100%; min-width: 2px; border-radius: inherit; background: linear-gradient(90deg, var(--pine), var(--amber)); }
.rank-val { color: var(--ink); font: 800 10.5px/1.2 var(--mono); white-space: nowrap; text-align: right; }
.rank-val b { display: block; color: var(--faint); font: 650 9.5px/1.2 var(--mono); }
.stats-cost-inputs { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
.stats-cost-inputs label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font: 600 12px/1 var(--mono); }
.stats-cost-inputs input { width: 82px; height: 32px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--field-bg); color: var(--ink); padding: 0 8px; font: 600 12px/1 var(--mono); }
.stats-cost-out { color: var(--ink-soft); font: 600 14px/1.4 var(--sans); }
.stats-cost-out b { color: var(--seal-deep); font-weight: 700; font-size: 18px; }
.stats-cost-out span { color: var(--faint); font: 500 11px/1.3 var(--mono); }
.stats-note { margin: 0; color: var(--faint); font: 500 11px/1.5 var(--mono); }
.gallery-overlay {
  position: fixed; inset: 0; z-index: 50;
  display: grid; place-items: center;
  background: rgba(38, 28, 12, 0.38);
  padding: clamp(10px, 2.4dvh, 22px);
  backdrop-filter: blur(7px) saturate(0.9);
  animation: overlay-fade 0.2s ease both;
}
.gallery-overlay[hidden] { display: none; }
.gallery-dialog {
  display: flex; flex-direction: column; gap: 14px;
  width: min(1320px, 100%);
  height: min(980px, calc(100dvh - 2 * clamp(10px, 2.4dvh, 22px)));
  min-height: 0;
  border: 1px solid var(--line-2);
  border-top: 3px solid var(--seal);
  border-radius: 12px;
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  padding: 18px;
  box-shadow: 0 42px 110px -44px rgba(20, 12, 4, 0.9);
  animation: turn-rise 0.26s var(--ease-rise) both;
}
.gallery-bar {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 12px;
}
.gallery-bar h2 { font-size: 24px; font-weight: 600; }
.gallery-filters { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
.gallery-chip {
  min-height: 30px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0 12px;
  font: 700 11px/1 var(--mono);
}
.gallery-chip:hover { border-color: var(--seal); color: var(--seal-deep); background: transparent; transform: none; }
.gallery-chip.active { border-color: var(--seal); background: var(--seal-soft); color: var(--seal-deep); }
.gallery-body { min-height: 0; overflow: auto; padding-right: 4px; scrollbar-width: thin; }
.gallery-grid { columns: 220px; column-gap: 14px; }
.gallery-card {
  display: inline-block;
  width: 100%;
  margin: 0 0 14px;
  break-inside: avoid;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-wash);
  overflow: hidden;
  box-shadow: 0 18px 38px -34px rgba(64, 44, 14, 0.72);
}
.gallery-card:hover { border-color: rgba(177, 56, 42, 0.4); box-shadow: 0 22px 46px -36px rgba(140, 43, 31, 0.62); }
.gallery-thumb {
  display: block;
  width: 100%;
  min-height: 96px;
  border: 0;
  border-radius: 0;
  background: var(--wash-1);
  padding: 0;
  cursor: zoom-in;
}
.gallery-thumb:hover { background: var(--wash-2); transform: none; }
.gallery-thumb img {
  display: block;
  width: 100%;
  max-height: 360px;
  object-fit: cover;
  background: var(--panel);
}
.gallery-card-meta {
  display: grid;
  gap: 4px;
  width: 100%;
  min-height: 58px;
  border: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  padding: 10px 11px;
  text-align: left;
}
.gallery-card-meta:hover { background: var(--wash-2); transform: none; }
.gallery-card-meta strong {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font: 650 13px/1.28 var(--sans);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery-card-meta span {
  min-width: 0;
  overflow: hidden;
  color: var(--faint);
  font: 650 10.5px/1.35 var(--mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery-footer {
  display: flex;
  justify-content: center;
  padding: 16px 0 4px;
}
.gallery-more {
  min-height: 36px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0 14px;
  font: 700 11px/1 var(--mono);
}
.gallery-more:hover { border-color: var(--seal); background: transparent; color: var(--seal-deep); transform: none; }
.gallery-empty {
  display: grid;
  min-height: 240px;
  place-items: center;
  border: 1px dashed var(--line-2);
  border-radius: 10px;
  color: var(--faint);
  font: 700 13px/1.5 var(--mono);
}
.gallery-error { border-color: rgba(177,56,42,0.45); color: var(--seal); }
.gallery-lightbox {
  position: fixed; inset: 0; z-index: 70;
  display: grid;
  grid-template-columns: minmax(44px, 8vw) minmax(0, 1fr) minmax(44px, 8vw);
  place-items: center;
  gap: 12px;
  background: rgba(10, 8, 6, 0.86);
  padding: 24px;
  animation: overlay-fade 0.16s ease both;
}
.gallery-lightbox[hidden] { display: none; }
.gallery-lightbox-figure {
  display: grid;
  gap: 12px;
  justify-items: center;
  max-width: 100%;
  max-height: 100%;
  margin: 0;
}
.gallery-lightbox img {
  display: block;
  max-width: min(1120px, 100%);
  max-height: calc(100dvh - 112px);
  border: 1px solid rgba(255, 245, 222, 0.22);
  border-radius: 8px;
  background: #111;
  object-fit: contain;
  box-shadow: 0 28px 80px -30px rgba(0, 0, 0, 0.9);
}
.gallery-lightbox figcaption {
  max-width: min(760px, 88vw);
  overflow: hidden;
  color: rgba(255, 245, 222, 0.82);
  font: 650 12px/1.45 var(--mono);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery-lightbox-nav {
  display: grid;
  width: 42px;
  height: 56px;
  place-items: center;
  border: 1px solid rgba(255, 245, 222, 0.22);
  border-radius: 8px;
  background: rgba(255, 245, 222, 0.06);
  color: rgba(255, 245, 222, 0.82);
  font: 400 34px/1 var(--serif);
}
.gallery-lightbox-nav:hover { border-color: rgba(255, 245, 222, 0.5); background: rgba(255, 245, 222, 0.12); color: #fff; transform: none; }
@media (max-width: 900px) {
  .stats-filterbar { align-items: flex-start; flex-direction: column; }
  .stats-chip-group { justify-content: flex-start; }
  .stats-section-quota, .stats-section-usage, .stats-section-activity, .stats-section-projects { grid-column: 1 / -1; }
  .project-ranks { grid-template-columns: 1fr; }
  .gallery-dialog { height: calc(100dvh - 20px); padding: 14px; }
  .gallery-grid { columns: 150px; column-gap: 10px; }
  .gallery-card { margin-bottom: 10px; }
  .gallery-lightbox { grid-template-columns: 1fr; grid-template-rows: 1fr auto; padding: 16px; }
  .gallery-lightbox-nav { position: fixed; top: 50%; transform: translateY(-50%); }
  .gallery-lightbox-nav.prev { left: 12px; }
  .gallery-lightbox-nav.next { right: 12px; }
}
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
  .settings-popover { position: fixed; top: 92px; right: 12px; left: 12px; width: auto; max-height: calc(100dvh - 112px); }
  .settings-section { grid-template-columns: 1fr; gap: 7px; }
  .settings-seg, .settings-control-row { width: 100%; }
  .settings-seg .appx { flex: 1 1 0; }
  .turns { gap: 32px; }
  .user .message-card, .assistant .message-card, .tool .message-card { max-width: 100%; }
  .body { font-size: 17px; }
}
@media (prefers-reduced-motion: reduce) {
  .loading-spinner, .session-live-dot, .live-indicator .live-dot { animation: none; }
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
  .turn,.search-dialog,.stats-dialog,.toast,.goal,.risk,.notice,.search-overlay,.stats-overlay,.stat-row-fill,.quota-fill,.rank-fill,.hour-bar,.stats-skeleton-line,.search-results > .search-result,.session-live-dot,.live-indicator .live-dot{animation:none !important;}
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

/* Reading controls */
.reading-tools{display:inline-flex;flex:0 0 auto;align-items:center;gap:6px;padding:3px;border:1px solid var(--line-2);border-radius:9px;background:var(--panel);}
.view-mode-seg .appx{min-width:42px;}
.reading-tools .appx[aria-pressed="true"]{background:var(--ink);color:var(--paper);}
body[data-view-verbosity="summary"] .turns > .process,
body[data-view-verbosity="summary"] .turns > .tool,
body[data-view-verbosity="summary"] .turns > .interrupt,
body[data-view-verbosity="summary"] .turns > .subagents{display:none !important;}
body[data-view-verbosity="summary"] .process-entry{display:none !important;}
.file-path-action{display:inline;border-radius:4px;color:inherit;text-decoration:underline;text-decoration-color:rgba(177,56,42,0.38);text-decoration-style:dotted;text-underline-offset:3px;cursor:copy;}
.file-path-action:hover{color:var(--seal-deep);text-decoration-color:var(--seal);}
.file-path-action:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;}

/* Message outline */
.outline-panel{position:fixed;top:96px;right:16px;bottom:22px;z-index:30;display:flex;width:min(310px,calc(100vw - 32px));min-height:0;flex-direction:column;gap:10px;border:1px solid var(--line-2);border-top:3px solid var(--pine);border-radius:12px;background:linear-gradient(180deg,var(--panel),var(--panel-2));padding:12px;box-shadow:0 34px 82px -46px rgba(38,24,8,0.82);opacity:0;pointer-events:none;transform:translateX(calc(100% + 24px));transition:opacity 180ms ease,transform 180ms var(--ease-rise);}
body[data-outline-open="true"] .outline-panel{opacity:1;pointer-events:auto;transform:none;}
.outline-head{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);padding:0 2px 9px;}
.outline-head b{color:var(--ink);font:700 12px/1 var(--mono);letter-spacing:var(--track-label);}
.outline-close{min-height:28px;border:1px solid var(--line-2);border-radius:7px;background:transparent;color:var(--muted);padding:0 9px;font:700 10.5px/1 var(--mono);letter-spacing:0.02em;}
.outline-close:hover{border-color:var(--seal);background:transparent;color:var(--seal-deep);transform:none;}
.outline-list{display:grid;gap:2px;min-height:0;overflow:auto;padding-right:2px;scrollbar-width:thin;}
.outline-item{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:start;width:100%;min-height:34px;border:0;border-radius:8px;background:transparent;color:var(--ink-soft);padding:8px 9px;text-align:left;font-family:var(--sans);letter-spacing:0;cursor:pointer;}
.outline-item:hover{background:var(--wash-2);color:var(--ink);transform:none;}
.outline-item.active{background:var(--seal-soft);box-shadow:inset 3px 0 0 var(--seal);color:var(--ink);}
.outline-kind{min-width:32px;color:var(--faint);font:700 10px/1.35 var(--mono);letter-spacing:0.04em;}
.outline-item.active .outline-kind{color:var(--seal-deep);}
.outline-text{min-width:0;overflow:hidden;font:500 12.5px/1.35 var(--sans);text-overflow:ellipsis;white-space:nowrap;}
.outline-empty{border:1px dashed var(--line-2);border-radius:9px;color:var(--faint);padding:14px 12px;text-align:center;font:600 12px/1.45 var(--mono);}

/* Shortcut sheet */
.shortcut-overlay{position:fixed;inset:0;z-index:55;display:grid;place-items:start center;background:rgba(38,28,12,0.28);padding:clamp(18px,8dvh,72px) 18px 18px;backdrop-filter:blur(5px) saturate(0.92);animation:overlay-fade 0.18s ease both;}
.shortcut-overlay[hidden]{display:none;}
.shortcut-dialog{display:flex;width:min(430px,94vw);max-height:calc(100dvh - 40px);flex-direction:column;gap:16px;border:1px solid var(--line-2);border-top:3px solid var(--seal);border-radius:12px;background:linear-gradient(180deg,var(--panel),var(--panel-2));padding:18px;box-shadow:0 42px 100px -44px rgba(38,24,8,0.85);animation:turn-rise 0.24s var(--ease-rise) both;}
.shortcut-bar{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.shortcut-bar h2{font-size:22px;font-weight:600;}
.shortcut-list{display:grid;gap:8px;}
.shortcut-list div{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:center;border:1px solid var(--line);border-radius:9px;background:var(--wash-1);padding:9px 10px;color:var(--ink-soft);font:600 13px/1.35 var(--sans);}
.shortcut-list kbd{display:inline-flex;align-items:center;justify-content:center;min-width:34px;min-height:24px;border:1px solid var(--line-2);border-radius:6px;background:var(--panel);color:var(--muted);padding:0 7px;font:700 11px/1 var(--mono);}
.shortcut-list div:has(kbd + kbd){grid-template-columns:auto auto minmax(0,1fr);}

@media (max-width:900px){
  .reading-tools{order:4;flex-wrap:wrap;}
  .outline-panel{top:auto;right:10px;bottom:10px;left:10px;width:auto;max-height:min(420px,58dvh);transform:translateY(calc(100% + 18px));}
  body[data-outline-open="true"] .outline-panel{transform:none;}
}
@media (prefers-reduced-motion:reduce){
  .outline-panel,.shortcut-dialog,.shortcut-overlay{animation:none !important;transition:none !important;}
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
  statsQuota: null,
  statsActivity: null,
  statsFilter: "all",
  statsRequestToken: 0,
  statsRate: { in: 0, out: 0 },
  gallery: { open: false, source: "all", items: [], offset: 0, limit: 36, loading: false, hasMore: true, error: "", requestToken: 0, lightboxOpen: false, lightboxIndex: 0 },
  reading: { verbosity: "standard", outlineOpen: false, outlineItems: [], outlineVisible: new Set(), outlineTargets: new Map(), outlineActiveId: "", shortcutsOpen: false, settingsOpen: false },
  liveTail: { active: false, ref: "", timer: 0, token: 0, head: null, polling: false, following: true, needsFollowPrompt: false },
};
const SOURCE_MODULES = [
  { key: "codex", label: "Codex" },
  { key: "claude", label: "Claude Code" },
  { key: "trae", label: "Trae" },
];
const SESSION_BATCH_LIMIT = 200;
const LIVE_TAIL_INTERVAL_MS = 4000;
const LIVE_TAIL_BOTTOM_PX = 80;
const SEARCH_SCAN_LIMIT = 600;
const SEMANTIC_SEARCH_SCAN_LIMIT = 600;
const SEMANTIC_SEARCH_UPDATE_LIMIT = 24;
const SEMANTIC_PREWARM_SCAN_LIMIT = 1200;
const SEMANTIC_PREWARM_UPDATE_LIMIT = 120;
const SAFETY_CHECKS_ENABLED = false;
const SIDEBAR_WIDTH_KEY = "agent-snapshot.sidebar-width.v2";
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 460;
const THEME_KEY = "agent-snapshot.theme.v1";
const DENSITY_KEY = "agent-snapshot.density.v1";
const READ_SCALE_KEY = "agent-snapshot.read-scale.v1";
const VIEW_VERBOSITY_KEY = "agent-snapshot.view-verbosity.v1";
const OUTLINE_OPEN_KEY = "agent-snapshot.outline-open.v1";
const DEFAULT_VIEW_VERBOSITY_KEY = "agent-snapshot.default-view-verbosity.v1";
const DEFAULT_OUTLINE_OPEN_KEY = "agent-snapshot.default-outline-open.v1";
const THEMES = ["light", "sepia", "dark"];
const VIEW_VERBOSITIES = ["standard", "detailed", "summary"];
const VIEW_VERBOSITY_LABELS = { standard: "标准", detailed: "详细", summary: "摘要" };
const READ_SCALE_MIN = 0.85;
const READ_SCALE_MAX = 1.4;
const READ_SCALE_STEP = 0.05;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const shareConfig = window.AGENT_SNAPSHOT_SHARE_CONFIG || {};
const csrfToken = String(window.AGENT_SNAPSHOT_CSRF_TOKEN || "");

function renderLoading(message) {
  return "<div class='loading-state' role='status' aria-live='polite' aria-busy='true'>" +
    "<span class='loading-spinner' aria-hidden='true'></span>" +
    "<span>" + esc(message) + "</span>" +
  "</div>";
}

function showViewerLoading(message) {
  stopLiveTail({ silent: true });
  state.currentSnapshot = null;
  resetSessionSearchState(false);
  renderSessionSearch();
  clearOutline("正在加载大纲...");
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

const STATS_RATE_KEY = "agent-snapshot.stats-rate.v1";
const STATS_FILTERS = [
  { key: "all", label: "全部" },
  { key: "codex", label: "Codex" },
  { key: "claude", label: "Claude" },
  { key: "trae", label: "Trae" },
];
const STATS_ENGINE_LABELS = { all: "全部", codex: "Codex", claude: "Claude Code", trae: "Trae" };
const GALLERY_FILTERS = [
  { key: "all", label: "全部" },
  { key: "codex", label: "Codex" },
  { key: "claude", label: "Claude" },
  { key: "trae", label: "Trae" },
];

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
  loadStats();
}

function closeStats() {
  $("statsOverlay").hidden = true;
  document.body.classList.remove("stats-open");
}

function openGallery() {
  state.gallery.open = true;
  $("galleryOverlay").hidden = false;
  document.body.classList.add("gallery-open");
  renderGallery();
  if (!state.gallery.items.length && !state.gallery.loading) {
    loadGallery(true);
  }
  window.setTimeout(() => $("closeGallery")?.focus(), 0);
}

function closeGallery() {
  closeGalleryLightbox();
  state.gallery.open = false;
  $("galleryOverlay").hidden = true;
  document.body.classList.remove("gallery-open");
}

async function setGallerySource(source) {
  const key = GALLERY_FILTERS.some((item) => item.key === source) ? source : "all";
  if (state.gallery.source === key && state.gallery.items.length) {
    return;
  }
  state.gallery.source = key;
  await loadGallery(true);
}

async function loadGallery(reset = false) {
  if (state.gallery.loading) {
    return;
  }
  if (!reset && !state.gallery.hasMore) {
    return;
  }
  const token = state.gallery.requestToken + 1;
  state.gallery.requestToken = token;
  state.gallery.loading = true;
  state.gallery.error = "";
  if (reset) {
    state.gallery.items = [];
    state.gallery.offset = 0;
    state.gallery.hasMore = true;
  }
  renderGallery();
  try {
    const query = new URLSearchParams({
      source: state.gallery.source,
      limit: String(state.gallery.limit),
      offset: String(reset ? 0 : state.gallery.items.length),
    });
    const response = await fetch("/api/images?" + query.toString());
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to load images");
    }
    if (token !== state.gallery.requestToken) {
      return;
    }
    const entries = Array.isArray(result) ? result : Array.isArray(result.entries) ? result.entries : [];
    state.gallery.items = reset ? entries : state.gallery.items.concat(entries);
    state.gallery.offset = state.gallery.items.length;
    state.gallery.hasMore = result && Object.prototype.hasOwnProperty.call(result, "hasMore")
      ? Boolean(result.hasMore) && entries.length > 0
      : entries.length >= state.gallery.limit;
  } catch (error) {
    if (token === state.gallery.requestToken) {
      state.gallery.error = error instanceof Error ? error.message : String(error);
    }
  } finally {
    if (token === state.gallery.requestToken) {
      state.gallery.loading = false;
      renderGallery();
    }
  }
}

function renderGallery() {
  renderGalleryFilters();
  const body = $("galleryBody");
  if (!body) {
    return;
  }
  if (state.gallery.loading && !state.gallery.items.length) {
    body.innerHTML = renderLoading("正在扫描图片...");
    return;
  }
  if (state.gallery.error && !state.gallery.items.length) {
    body.innerHTML = "<div class='gallery-empty gallery-error'>" + esc(state.gallery.error) + "</div>";
    return;
  }
  if (!state.gallery.items.length) {
    body.innerHTML = "<div class='gallery-empty'>还没有发现图片</div>";
    return;
  }
  const grid = "<div class='gallery-grid'>" + state.gallery.items.map(renderGalleryCard).join("") + "</div>";
  const more = state.gallery.hasMore || state.gallery.loading || state.gallery.error
    ? "<div class='gallery-footer'>" +
        (state.gallery.error ? "<span class='load-more-meta load-more-error'>" + esc(state.gallery.error) + "</span>" : "") +
        (state.gallery.hasMore || state.gallery.loading ? "<button class='gallery-more' type='button' data-gallery-more='1'" + (state.gallery.loading ? " disabled aria-busy='true'" : "") + ">" + (state.gallery.loading ? "正在加载..." : "加载更多") + "</button>" : "") +
      "</div>"
    : "";
  body.innerHTML = grid + more;
}

function renderGalleryFilters() {
  const target = $("galleryFilters");
  if (!target) {
    return;
  }
  target.innerHTML = GALLERY_FILTERS.map((filter) => {
    const active = state.gallery.source === filter.key;
    return "<button class='gallery-chip" + (active ? " active" : "") + "' type='button' data-gallery-source='" + esc(filter.key) + "' aria-pressed='" + (active ? "true" : "false") + "'>" + esc(filter.label) + "</button>";
  }).join("");
}

function renderGalleryCard(entry, index) {
  const title = String(entry.sessionTitle || entry.sessionRef || "Untitled session");
  const meta = [entry.engineLabel || galleryEngineLabel(entry.engine), relativeTime(entry.timestamp), galleryProjectLabel(entry.project)].filter(Boolean).join(" · ");
  const imageUrl = "/api/image?ref=" + encodeURIComponent(entry.id || "");
  return "<article class='gallery-card' data-gallery-index='" + esc(index) + "'>" +
    "<button class='gallery-thumb' type='button' data-gallery-lightbox='" + esc(index) + "' title='查看大图'>" +
      "<img src='" + esc(imageUrl) + "' alt='" + esc(title) + "' loading='lazy' decoding='async'>" +
    "</button>" +
    "<button class='gallery-card-meta' type='button' data-gallery-session='" + esc(index) + "' title='打开会话并跳到图片所在回合'>" +
      "<strong>" + esc(title) + "</strong>" +
      "<span>" + esc(meta) + "</span>" +
    "</button>" +
  "</article>";
}

async function openGallerySession(index) {
  const entry = state.gallery.items[Number(index)];
  if (!entry?.sessionRef) {
    return;
  }
  closeGallery();
  if (entry.engine && entry.engine !== "all") {
    state.activeSource = visibleSourceKey(entry.engine);
  }
  await selectSession(entry.sessionRef);
  const turn = Number(entry.turnNumber || 0) || Number(entry.turnIndex || 0) + 1;
  window.setTimeout(() => {
    if (!focusTurn(turn)) {
      showToast("已打开会话，未找到对应回合", true);
    }
  }, 80);
}

function openGalleryLightbox(index) {
  const itemIndex = clampNumber(Number(index), 0, state.gallery.items.length - 1);
  if (!state.gallery.items[itemIndex]) {
    return;
  }
  state.gallery.lightboxOpen = true;
  state.gallery.lightboxIndex = itemIndex;
  $("galleryLightbox").hidden = false;
  updateGalleryLightbox();
}

function closeGalleryLightbox() {
  state.gallery.lightboxOpen = false;
  const overlay = $("galleryLightbox");
  if (overlay) {
    overlay.hidden = true;
  }
  const image = $("galleryLightboxImage");
  if (image) {
    image.removeAttribute("src");
    image.alt = "";
  }
}

function moveGalleryLightbox(delta) {
  if (!state.gallery.items.length) {
    return;
  }
  const length = state.gallery.items.length;
  state.gallery.lightboxIndex = (state.gallery.lightboxIndex + delta + length) % length;
  updateGalleryLightbox();
}

function updateGalleryLightbox() {
  const entry = state.gallery.items[state.gallery.lightboxIndex];
  if (!entry) {
    closeGalleryLightbox();
    return;
  }
  const title = String(entry.sessionTitle || entry.sessionRef || "Image");
  const meta = [galleryEngineLabel(entry.engine), relativeTime(entry.timestamp), galleryProjectLabel(entry.project)].filter(Boolean).join(" · ");
  const image = $("galleryLightboxImage");
  image.src = "/api/image?ref=" + encodeURIComponent(entry.id || "");
  image.alt = title;
  $("galleryLightboxCaption").textContent = title + (meta ? " · " + meta : "");
  for (const button of document.querySelectorAll("[data-lightbox-prev], [data-lightbox-next]")) {
    button.disabled = state.gallery.items.length <= 1;
  }
}

function galleryEngineLabel(engine) {
  if (engine === "claude") return "Claude";
  if (engine === "trae") return "Trae";
  return engine === "codex" ? "Codex" : "";
}

function galleryProjectLabel(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const clean = text.replace(/[\\\\/]+$/, "");
  const parts = clean.split(/[\\\\/]/).filter(Boolean);
  return parts[parts.length - 1] || clean;
}

async function loadStats() {
  const requestToken = state.statsRequestToken + 1;
  state.statsRequestToken = requestToken;
  renderStatsShell();
  loadStatsQuota(requestToken);
  loadStatsActivity(requestToken);
  loadStatsUsage(requestToken);
}

function renderStatsShell() {
  $("statsBody").innerHTML =
    "<div class='stats-shell'>" +
      "<div class='stats-filterbar'>" +
        "<p class='stats-note'>各区块独立加载；项目 token 来自本机搜索索引，首次打开会后台补齐。</p>" +
        "<div id='statsEngineFilters' class='stats-chip-group' role='group' aria-label='统计来源筛选'></div>" +
      "</div>" +
      "<div class='stats-grid'>" +
        statsSectionShell("quota", "配额", "Codex CLI") +
        statsSectionShell("activity", "活跃度", "最近 26 周") +
        statsSectionShell("projects", "项目", "Top 项目") +
        statsSectionShell("usage", "用量", "Token / 成本") +
      "</div>" +
      "<p class='stats-note'>数据来自本机日志。Codex 的 token 为各轮累计（含缓存/重复上下文），成本仅按当前填写单价粗估。</p>" +
    "</div>";
  renderStatsFilter();
}

function statsSectionShell(kind, title, meta) {
  return "<section class='stats-section stats-section-" + esc(kind) + "'>" +
    "<div class='stats-section-head'><h3>" + esc(title) + "</h3><span class='stats-section-meta'>" + esc(meta) + "</span></div>" +
    "<div id='stats" + kind[0].toUpperCase() + kind.slice(1) + "Panel'>" + renderStatsSkeleton() + "</div>" +
  "</section>";
}

function renderStatsSkeleton() {
  return "<div class='stats-skeleton' aria-busy='true'>" +
    "<span class='stats-skeleton-line mid'></span>" +
    "<span class='stats-skeleton-line'></span>" +
    "<span class='stats-skeleton-line short'></span>" +
  "</div>";
}

async function loadStatsQuota(requestToken) {
  try {
    const response = await fetch("/api/quota");
    const quota = await response.json();
    if (!response.ok) {
      throw new Error(quota.error || "配额读取失败");
    }
    if (requestToken !== state.statsRequestToken) {
      return;
    }
    state.statsQuota = quota;
    renderStatsQuota();
  } catch (error) {
    if (requestToken === state.statsRequestToken) {
      $("statsQuotaPanel").innerHTML = statsError(error, "配额读取失败");
    }
  }
}

async function loadStatsActivity(requestToken) {
  try {
    const response = await fetch("/api/activity");
    const activity = await response.json();
    if (!response.ok) {
      throw new Error(activity.error || "活动统计失败");
    }
    if (requestToken !== state.statsRequestToken) {
      return;
    }
    state.statsActivity = activity;
    renderStatsFilter();
    renderStatsActivity();
    renderStatsProjects();
  } catch (error) {
    if (requestToken === state.statsRequestToken) {
      $("statsActivityPanel").innerHTML = statsError(error, "活动统计失败");
      $("statsProjectsPanel").innerHTML = statsError(error, "项目排行失败");
    }
  }
}

async function loadStatsUsage(requestToken) {
  try {
    const response = await fetch("/api/search-stats");
    const stats = await response.json();
    if (!response.ok) {
      throw new Error(stats.error || "统计失败");
    }
    if (requestToken !== state.statsRequestToken) {
      return;
    }
    state.stats = stats;
    renderStatsUsage();
  } catch (error) {
    if (requestToken === state.statsRequestToken) {
      $("statsUsagePanel").innerHTML = statsError(error, "用量统计失败");
    }
  }
}

function statsError(error, fallback) {
  return "<div class='search-empty'>" + esc(error instanceof Error ? error.message : (error || fallback)) + "</div>";
}

function renderStatsFilter() {
  const target = $("statsEngineFilters");
  if (!target) {
    return;
  }
  const counts = statsEngineCounts();
  target.innerHTML = STATS_FILTERS.map((item) => {
    const active = item.key === state.statsFilter;
    const count = counts[item.key] || 0;
    return "<button type='button' class='stats-chip" + (active ? " active" : "") + "' data-stats-filter='" + esc(item.key) + "' aria-pressed='" + (active ? "true" : "false") + "'>" +
      esc(item.label) + " <b>" + esc(count) + "</b>" +
    "</button>";
  }).join("");
}

function statsEngineCounts() {
  const activity = state.statsActivity;
  const engines = activity && activity.engines ? activity.engines : {};
  return {
    all: Number(engines.total || 0),
    codex: Number(engines.codex || 0),
    claude: Number(engines.claude || 0),
    trae: Number(engines.trae || 0),
  };
}

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

function renderStatsQuota() {
  const quota = state.statsQuota;
  if (!quota || !quota.available) {
    $("statsQuotaPanel").innerHTML =
      "<div class='stats-muted'>未找到 Codex CLI 配额快照。Claude Code / Trae 没有对应的本地配额文件。</div>";
    return;
  }
  const freshness = quota.updatedAt ? relativePast(quota.updatedAt) + "的快照" : "快照时间未知";
  const plan = quota.planType ? " · " + quota.planType : "";
  $("statsQuotaPanel").innerHTML =
    "<div class='quota-list'>" +
      quotaMeter("5 小时窗口", quota.primary) +
      quotaMeter("周配额", quota.secondary) +
      "<div class='stats-muted'>Codex" + esc(plan) + " · " + esc(freshness) + "</div>" +
    "</div>";
}

function quotaMeter(label, data) {
  if (!data) {
    return "<div class='stats-muted'>" + esc(label) + " 暂无数据</div>";
  }
  const pct = Math.max(0, Math.min(100, Number(data.usedPercent || 0)));
  const color = quotaColor(pct);
  return "<div class='quota-row'>" +
    "<div class='quota-head'><span class='quota-label'>" + esc(label) + "</span><span class='quota-value'>" + esc(formatPercent(pct)) + "</span></div>" +
    "<div class='quota-track'><span class='quota-fill' style='width:" + pct.toFixed(1) + "%;background:" + esc(color) + "'></span></div>" +
    "<div class='quota-meta'><span>" + esc(resetCountdown(data.resetsAt)) + "</span><span>" + esc(formatWindow(data.windowMinutes)) + "</span></div>" +
  "</div>";
}

function quotaColor(percent) {
  const pct = Math.max(0, Math.min(100, Number(percent || 0)));
  const hue = pct < 70 ? Math.round(138 - (pct / 70) * 90) : Math.round(48 - ((pct - 70) / 30) * 40);
  return "hsl(" + Math.max(8, hue) + " 55% 38%)";
}

function resetCountdown(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return "重置时间未知";
  }
  const diff = time - Date.now();
  if (diff <= 0) {
    return "已到重置时间";
  }
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff >= day) {
    return Math.ceil(diff / day) + " 天后重置";
  }
  if (diff >= hour) {
    return Math.ceil(diff / hour) + " 小时后重置";
  }
  return Math.max(1, Math.ceil(diff / minute)) + " 分钟后重置";
}

function formatWindow(minutes) {
  const n = Number(minutes || 0);
  if (!n) {
    return "";
  }
  if (n >= 60 * 24) {
    return Math.round(n / 60 / 24) + " 天窗口";
  }
  if (n >= 60) {
    return Math.round(n / 60) + " 小时窗口";
  }
  return n + " 分钟窗口";
}

function renderStatsActivity() {
  const activity = state.statsActivity;
  if (!activity) {
    return;
  }
  const filter = state.statsFilter;
  const days = activity.days || [];
  const hours = activity.hours || [];
  const total = days.reduce((sum, day) => sum + filteredCount(day, filter), 0);
  const maxDay = Math.max(1, ...days.map((day) => filteredCount(day, filter)));
  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"].map((label) => "<span>" + label + "</span>").join("");
  const cells = days.map((day) => {
    const count = filteredCount(day, filter);
    const level = heatLevel(count, maxDay);
    const title = day.date + " · " + count + " 次会话";
    return "<span class='activity-day level-" + level + "' title='" + esc(title) + "' aria-label='" + esc(title) + "'></span>";
  }).join("");
  const maxHour = Math.max(1, ...hours.map((hour) => filteredCount(hour, filter)));
  const hourBars = hours.map((hour) => {
    const count = filteredCount(hour, filter);
    const height = count ? Math.max(4, Math.round((count / maxHour) * 54)) : 2;
    const title = String(hour.hour).padStart(2, "0") + ":00 · " + count + " 次会话";
    return "<span class='hour-bar' style='height:" + height + "px' title='" + esc(title) + "'></span>";
  }).join("");
  $("statsActivityPanel").innerHTML =
    "<div class='activity-panel'>" +
      "<div class='stats-muted'>" + esc(STATS_ENGINE_LABELS[filter] || filter) + " · " + esc(total) + " 次会话</div>" +
      "<div class='heatmap-frame'>" +
        "<div class='heatmap-weekdays' aria-hidden='true'>" + weekdayLabels + "</div>" +
        "<div class='activity-heatmap' role='img' aria-label='最近 26 周活动热力图'>" + cells + "</div>" +
      "</div>" +
      "<div class='hour-panel'>" +
        "<div class='stats-section-head'><h3>按小时分布</h3><span class='stats-section-meta'>本地时间</span></div>" +
        "<div class='hour-bars' role='img' aria-label='按小时分布'>" + hourBars + "</div>" +
        "<div class='hour-axis'><span>00</span><span>06</span><span>12</span><span>23</span></div>" +
      "</div>" +
    "</div>";
}

function heatLevel(count, max) {
  if (!count) {
    return 0;
  }
  return Math.max(1, Math.min(4, Math.ceil((count / Math.max(1, max)) * 4)));
}

function filteredCount(row, filter) {
  if (!row) {
    return 0;
  }
  if (filter === "all") {
    return Number(row.total || 0);
  }
  return Number(row[filter] || 0);
}

function renderStatsProjects() {
  const activity = state.statsActivity;
  if (!activity) {
    return;
  }
  const projects = aggregateProjects(activity.projects || [], state.statsFilter);
  const bySessions = projects.slice().sort((a, b) => (b.sessions - a.sessions) || (b.totalTokens - a.totalTokens)).slice(0, 8);
  const rate = state.statsRate;
  const hasRate = Boolean(rate.in || rate.out);
  const byTokens = projects.slice().sort((a, b) => {
    const av = hasRate ? estimatedCost(a.inputTokens, a.outputTokens) : a.totalTokens;
    const bv = hasRate ? estimatedCost(b.inputTokens, b.outputTokens) : b.totalTokens;
    return (bv - av) || (b.sessions - a.sessions);
  }).filter((entry) => entry.totalTokens > 0).slice(0, 8);
  const sessionMax = Math.max(1, ...bySessions.map((entry) => entry.sessions));
  const tokenMax = Math.max(1, ...byTokens.map((entry) => hasRate ? estimatedCost(entry.inputTokens, entry.outputTokens) : entry.totalTokens));
  const sessionRows = bySessions.map((entry) =>
    rankRow(entry.name, entry.path, entry.sessions, sessionMax, formatTokenCount(entry.sessions), entry.totalTokens ? formatTokenShort(entry.totalTokens) + " token" : "")
  ).join("") || "<div class='stats-muted'>暂无项目数据</div>";
  const tokenRows = byTokens.map((entry) => {
    const cost = estimatedCost(entry.inputTokens, entry.outputTokens);
    const metric = hasRate ? cost : entry.totalTokens;
    return rankRow(entry.name, entry.path, metric, tokenMax, formatTokenShort(entry.totalTokens), hasRate ? "≈ " + formatCost(cost) : entry.sessions + " 会话");
  }).join("") || "<div class='stats-muted'>暂无 token 数据</div>";
  $("statsProjectsPanel").innerHTML =
    "<div class='project-ranks'>" +
      "<div><p class='rank-title'>按会话数</p><div class='rank-list'>" + sessionRows + "</div></div>" +
      "<div><p class='rank-title'>按 token / 成本</p><div class='rank-list'>" + tokenRows + "</div></div>" +
    "</div>";
}

function aggregateProjects(projects, filter) {
  const map = new Map();
  for (const entry of projects) {
    const engine = entry.engine || "codex";
    if (filter !== "all" && engine !== filter) {
      continue;
    }
    const key = entry.key || entry.path || entry.name || "(无项目)";
    const item = map.get(key) || {
      key,
      name: entry.name || "(无项目)",
      path: entry.path || "",
      sessions: 0,
      indexedSessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    item.sessions += Number(entry.sessions || 0);
    item.indexedSessions += Number(entry.indexedSessions || 0);
    item.inputTokens += Number(entry.inputTokens || 0);
    item.outputTokens += Number(entry.outputTokens || 0);
    item.totalTokens += Number(entry.totalTokens || 0);
    map.set(key, item);
  }
  return Array.from(map.values()).filter((entry) => entry.sessions || entry.totalTokens);
}

function rankRow(name, path, value, max, valueText, subText) {
  const pct = max > 0 ? Math.max(2, Math.round((Number(value || 0) / max) * 100)) : 0;
  return "<div class='rank-row'>" +
    "<span class='rank-name' title='" + esc(path || name) + "'>" + esc(name) + "</span>" +
    "<span class='rank-track'><span class='rank-fill' style='width:" + pct + "%'></span></span>" +
    "<span class='rank-val'>" + esc(valueText) + (subText ? "<b>" + esc(subText) + "</b>" : "") + "</span>" +
  "</div>";
}

function renderStatsUsage() {
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

  const costLine = (rate.in || rate.out)
    ? "<div class='stats-cost-out'>≈ <b>" + esc(cost >= 1 ? cost.toFixed(2) : cost.toFixed(4)) + "</b> <span>（按 输入 " + esc(rate.in || 0) + " / 输出 " + esc(rate.out || 0) + " 每百万 token，粗略上限，含各轮重复上下文）</span></div>"
    : "<div class='stats-cost-out stats-muted'>填入单价即可估算成本（token 计数为准）</div>";

  $("statsUsagePanel").innerHTML =
    "<div class='stat-tiles'>" + tiles + "</div>" +
    "<div class='stats-subsection'><div class='stats-section-head'><h3>按来源</h3></div><div class='stat-rows'>" + engineRows + "</div></div>" +
    "<div class='stats-subsection'><div class='stats-section-head'><h3>成本估算</h3></div>" +
      "<div class='stats-cost-inputs'>" +
        "<label>输入 <input id='statsPriceIn' type='number' min='0' step='0.1' value='" + esc(rate.in || "") + "' placeholder='0'> /1M</label>" +
        "<label>输出 <input id='statsPriceOut' type='number' min='0' step='0.1' value='" + esc(rate.out || "") + "' placeholder='0'> /1M</label>" +
      "</div>" + costLine +
    "</div>";

  const priceIn = $("statsPriceIn");
  const priceOut = $("statsPriceOut");
  const onRate = () => {
    state.statsRate = { in: Number(priceIn.value) || 0, out: Number(priceOut.value) || 0 };
    localStorage.setItem(STATS_RATE_KEY, JSON.stringify(state.statsRate));
    renderStatsUsage();
    renderStatsProjects();
  };
  if (priceIn) priceIn.addEventListener("change", onRate);
  if (priceOut) priceOut.addEventListener("change", onRate);
}

function estimatedCost(input, output) {
  const rate = state.statsRate;
  return (Number(input || 0) / 1000000) * (rate.in || 0) + (Number(output || 0) / 1000000) * (rate.out || 0);
}

function formatCost(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return "0";
  }
  return number >= 1 ? number.toFixed(2) : number.toFixed(4);
}

function formatPercent(value) {
  const number = Number(value || 0);
  return (number >= 10 ? number.toFixed(0) : number.toFixed(1)).replace(/\\.0$/, "") + "%";
}

function relativePast(value) {
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
    return Math.max(1, Math.floor(diff / minute)) + " 分钟前";
  }
  if (diff < day) {
    return Math.max(1, Math.floor(diff / hour)) + " 小时前";
  }
  return Math.max(1, Math.floor(diff / day)) + " 天前";
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
    const engine = String(result.engine || "").toLowerCase();
    const key = engine === "trae" || /trae/i.test(label) ? "trae" : /claude/i.test(label) ? "claude" : "codex";
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
  let target = findTurnNode(turnNumber);
  if (!target && transcriptHydration) {
    // 目标轮次可能还在渐进补齐的队列里：强制补齐后重试。
    flushTranscriptHydration();
    target = findTurnNode(turnNumber);
  }
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

function findTurnNode(turnNumber) {
  return Array.from(document.querySelectorAll("[data-turn-number]"))
    .find((item) => item.getAttribute("data-turn-number") === String(turnNumber)) || null;
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

function setSettingsOpen(open, options = {}) {
  state.reading.settingsOpen = Boolean(open);
  const popover = $("settingsPopover");
  const toggle = $("settingsToggle");
  if (popover) {
    popover.hidden = !state.reading.settingsOpen;
  }
  if (toggle) {
    toggle.classList.toggle("active", state.reading.settingsOpen);
    toggle.setAttribute("aria-expanded", state.reading.settingsOpen ? "true" : "false");
  }
  if (state.reading.settingsOpen) {
    syncSettingsControls();
  } else if (options.focus !== false) {
    toggle?.focus();
  }
}

function closeSettingsPopover(options = {}) {
  if (!state.reading.settingsOpen) {
    return;
  }
  setSettingsOpen(false, options);
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
  for (const button of document.querySelectorAll("[data-density-set]")) {
    const active = button.dataset.densitySet === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
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
  const valueEl = $("readScaleValue");
  if (valueEl) {
    valueEl.textContent = Math.round(rounded * 100) + "%";
  }
}

function stepReadScale(direction) {
  applyReadScale(currentReadScale() + (direction < 0 ? -READ_SCALE_STEP : READ_SCALE_STEP));
}

function initAppearance() {
  applyTheme(currentTheme());
  applyDensity(currentDensity());
  applyReadScale(currentReadScale());
  $("settingsToggle")?.addEventListener("click", () => setSettingsOpen(!state.reading.settingsOpen, { focus: false }));
  $("settingsClose")?.addEventListener("click", () => closeSettingsPopover());
  document.addEventListener("click", (event) => {
    if (!state.reading.settingsOpen) {
      return;
    }
    if (event.target?.closest?.(".settings-shell")) {
      return;
    }
    closeSettingsPopover({ focus: false });
  });
  for (const button of document.querySelectorAll("[data-theme-set]")) {
    button.addEventListener("click", () => applyTheme(button.dataset.themeSet));
  }
  for (const button of document.querySelectorAll("[data-font-step]")) {
    button.addEventListener("click", () => stepReadScale(Number(button.dataset.fontStep) || 1));
  }
  for (const button of document.querySelectorAll("[data-density-set]")) {
    button.addEventListener("click", () => applyDensity(button.dataset.densitySet));
  }
  const density = document.querySelector("[data-density-toggle]");
  if (density) {
    density.addEventListener("click", () => applyDensity(currentDensity() === "compact" ? "comfortable" : "compact"));
  }
}

var outlineObserver = null;
var outlineRaf = 0;
var outlineRebuildTimer = 0;

function storedVerbosityChoice() {
  const stored = localStorage.getItem(VIEW_VERBOSITY_KEY);
  return VIEW_VERBOSITIES.includes(stored) ? stored : "";
}

function defaultVerbosity() {
  const stored = localStorage.getItem(DEFAULT_VIEW_VERBOSITY_KEY);
  return VIEW_VERBOSITIES.includes(stored) ? stored : "standard";
}

function currentVerbosity() {
  return storedVerbosityChoice() || defaultVerbosity();
}

function applyDefaultVerbosity(mode, options = {}) {
  const value = VIEW_VERBOSITIES.includes(mode) ? mode : "standard";
  localStorage.setItem(DEFAULT_VIEW_VERBOSITY_KEY, value);
  syncDefaultVerbosityControls(value);
  if (!storedVerbosityChoice()) {
    applyVerbosity(value, { persist: false });
  }
  if (options.toast) {
    showToast("默认视图已设为" + VIEW_VERBOSITY_LABELS[value], false);
  }
}

function applyVerbosity(mode, options = {}) {
  const value = VIEW_VERBOSITIES.includes(mode) ? mode : "standard";
  state.reading.verbosity = value;
  document.body.setAttribute("data-view-verbosity", value);
  if (options.persist !== false) {
    localStorage.setItem(VIEW_VERBOSITY_KEY, value);
  }
  for (const button of document.querySelectorAll("[data-view-verbosity]")) {
    const active = button.dataset.viewVerbosity === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (value === "detailed") {
    setTranscriptDetailsOpen(document, true);
  } else {
    setTranscriptDetailsOpen(document, false);
  }
  if (options.toast) {
    showToast("已切换为" + VIEW_VERBOSITY_LABELS[value] + "视图", false);
  }
  scheduleOutlineRebuild();
}

function syncDefaultVerbosityControls(value = defaultVerbosity()) {
  for (const button of document.querySelectorAll("[data-default-view-verbosity]")) {
    const active = button.dataset.defaultViewVerbosity === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function cycleVerbosity() {
  const index = VIEW_VERBOSITIES.indexOf(state.reading.verbosity);
  const next = VIEW_VERBOSITIES[(index + 1) % VIEW_VERBOSITIES.length] || "standard";
  applyVerbosity(next, { toast: true });
}

function setTranscriptDetailsOpen(root, open) {
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  for (const details of scope.querySelectorAll("#turns details.process-details, #turns details.tool-details, details.process-details, details.tool-details")) {
    details.open = Boolean(open);
  }
}

function applyVerbosityToContent(root) {
  if (state.reading.verbosity === "detailed") {
    setTranscriptDetailsOpen(root, true);
  }
}

function storedOutlineChoice() {
  const stored = localStorage.getItem(OUTLINE_OPEN_KEY);
  return stored === "1" || stored === "0" ? stored : "";
}

function defaultOutlineOpen() {
  return localStorage.getItem(DEFAULT_OUTLINE_OPEN_KEY) === "1";
}

function currentOutlineOpen() {
  const stored = storedOutlineChoice();
  return stored ? stored === "1" : defaultOutlineOpen();
}

function applyDefaultOutlineOpen(open, options = {}) {
  const value = Boolean(open);
  localStorage.setItem(DEFAULT_OUTLINE_OPEN_KEY, value ? "1" : "0");
  syncDefaultOutlineControls(value);
  if (!storedOutlineChoice()) {
    setOutlineOpen(value, false);
  }
  if (options.toast) {
    showToast(value ? "默认打开大纲" : "默认收起大纲", false);
  }
}

function syncDefaultOutlineControls(value = defaultOutlineOpen()) {
  const input = $("defaultOutlineOpen");
  if (input) {
    input.checked = Boolean(value);
  }
}

function syncSettingsControls() {
  syncDefaultVerbosityControls();
  syncDefaultOutlineControls();
  applyDensity(currentDensity());
  applyReadScale(currentReadScale());
}

function afterTranscriptContentMutated(root, options = {}) {
  applyVerbosityToContent(root);
  if (options.rebuildOutline !== false) {
    scheduleOutlineRebuild();
  }
}

function setOutlineOpen(open, persist = true) {
  state.reading.outlineOpen = Boolean(open);
  document.body.setAttribute("data-outline-open", state.reading.outlineOpen ? "true" : "false");
  const panel = $("outlinePanel");
  if (panel) {
    panel.setAttribute("aria-hidden", state.reading.outlineOpen ? "false" : "true");
  }
  const toggle = $("toggleOutline");
  if (toggle) {
    toggle.classList.toggle("active", state.reading.outlineOpen);
    toggle.setAttribute("aria-pressed", state.reading.outlineOpen ? "true" : "false");
    toggle.textContent = state.reading.outlineOpen ? "收起大纲" : "打开大纲";
    toggle.title = state.reading.outlineOpen ? "收起大纲（Ctrl+M）" : "打开大纲（Ctrl+M）";
  }
  if (persist) {
    localStorage.setItem(OUTLINE_OPEN_KEY, state.reading.outlineOpen ? "1" : "0");
  }
  if (state.reading.outlineOpen) {
    scheduleOutlineRebuild();
  }
}

function toggleOutline() {
  setOutlineOpen(!state.reading.outlineOpen);
  showToast(state.reading.outlineOpen ? "已打开大纲" : "已收起大纲", false);
}

function clearOutline(message) {
  if (outlineObserver) {
    outlineObserver.disconnect();
    outlineObserver = null;
  }
  state.reading.outlineItems = [];
  state.reading.outlineVisible = new Set();
  state.reading.outlineTargets = new Map();
  state.reading.outlineActiveId = "";
  const list = $("outlineList");
  if (list) {
    list.innerHTML = "<div class='outline-empty'>" + esc(message || "当前会话暂无大纲") + "</div>";
  }
}

function scheduleOutlineRebuild() {
  if (outlineRebuildTimer) {
    clearTimeout(outlineRebuildTimer);
  }
  outlineRebuildTimer = window.setTimeout(() => {
    outlineRebuildTimer = 0;
    rebuildOutline();
  }, 40);
}

function rebuildOutline() {
  if (outlineObserver) {
    outlineObserver.disconnect();
    outlineObserver = null;
  }
  state.reading.outlineVisible = new Set();
  state.reading.outlineTargets = new Map();
  const container = $("turns");
  const list = $("outlineList");
  if (!container || !list) {
    return;
  }
  const items = [];
  for (const node of Array.from(container.children)) {
    if (!(node instanceof HTMLElement) || node.classList.contains("turns-hydrating")) {
      continue;
    }
    if (node.classList.contains("user") && node.hasAttribute("data-turn-number")) {
      const turn = node.getAttribute("data-turn-number") || "";
      const text = outlineText(node.querySelector(".body")?.textContent || node.textContent || "用户消息", "用户消息");
      items.push({ id: "turn-" + turn + "-" + items.length, type: "user", label: text, target: node });
      continue;
    }
    if (node.classList.contains("commit-card")) {
      const sha = String(node.getAttribute("data-commit-sha") || "").slice(0, 7);
      const subject = outlineText(node.querySelector(".commit-subject")?.textContent || "Git 提交", "Git 提交");
      items.push({ id: "commit-" + (sha || items.length) + "-" + items.length, type: "commit", label: (sha ? sha + " " : "") + subject, target: node });
    }
  }
  state.reading.outlineItems = items;
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = "<div class='outline-empty'>当前会话暂无大纲</div>";
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    item.target.setAttribute("data-outline-id", item.id);
    state.reading.outlineTargets.set(item.id, item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outline-item";
    button.dataset.outlineTarget = item.id;
    const kind = document.createElement("span");
    kind.className = "outline-kind";
    kind.textContent = item.type === "commit" ? "提交" : "用户";
    const text = document.createElement("span");
    text.className = "outline-text";
    text.textContent = item.label;
    button.appendChild(kind);
    button.appendChild(text);
    fragment.appendChild(button);
  }
  list.appendChild(fragment);
  const root = container.closest(".viewer") || null;
  if (typeof IntersectionObserver === "function") {
    outlineObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute("data-outline-id") || "";
        if (!id) {
          continue;
        }
        if (entry.isIntersecting) {
          state.reading.outlineVisible.add(id);
        } else {
          state.reading.outlineVisible.delete(id);
        }
      }
      scheduleActiveOutlineUpdate();
    }, { root, threshold: [0, 0.1, 0.5, 1] });
    for (const item of items) {
      outlineObserver.observe(item.target);
    }
  }
  updateActiveOutline();
}

function ensureOutlineObserver() {
  if (outlineObserver || typeof IntersectionObserver !== "function") {
    return;
  }
  const container = $("turns");
  const root = container?.closest(".viewer") || null;
  outlineObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.getAttribute("data-outline-id") || "";
      if (!id) {
        continue;
      }
      if (entry.isIntersecting) {
        state.reading.outlineVisible.add(id);
      } else {
        state.reading.outlineVisible.delete(id);
      }
    }
    scheduleActiveOutlineUpdate();
  }, { root, threshold: [0, 0.1, 0.5, 1] });
}

function appendOutlineEntriesForNodes(nodes) {
  const list = $("outlineList");
  if (!list || !Array.isArray(nodes) || !nodes.length) {
    return;
  }
  const entries = [];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || node.classList.contains("turns-hydrating")) {
      continue;
    }
    if (node.classList.contains("user") && node.hasAttribute("data-turn-number")) {
      const turn = node.getAttribute("data-turn-number") || "";
      const text = outlineText(node.querySelector(".body")?.textContent || node.textContent || "用户消息", "用户消息");
      entries.push({ id: "turn-" + turn + "-" + (state.reading.outlineItems.length + entries.length), type: "user", label: text, target: node });
      continue;
    }
    if (node.classList.contains("commit-card")) {
      const sha = String(node.getAttribute("data-commit-sha") || "").slice(0, 7);
      const subject = outlineText(node.querySelector(".commit-subject")?.textContent || "Git 提交", "Git 提交");
      entries.push({ id: "commit-" + (sha || entries.length) + "-" + (state.reading.outlineItems.length + entries.length), type: "commit", label: (sha ? sha + " " : "") + subject, target: node });
    }
  }
  if (!entries.length) {
    return;
  }
  const empty = list.querySelector(".outline-empty");
  if (empty) {
    list.innerHTML = "";
  }
  ensureOutlineObserver();
  const fragment = document.createDocumentFragment();
  for (const item of entries) {
    item.target.setAttribute("data-outline-id", item.id);
    state.reading.outlineItems.push(item);
    state.reading.outlineTargets.set(item.id, item);
    if (outlineObserver) {
      outlineObserver.observe(item.target);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outline-item";
    button.dataset.outlineTarget = item.id;
    const kind = document.createElement("span");
    kind.className = "outline-kind";
    kind.textContent = item.type === "commit" ? "提交" : "用户";
    const text = document.createElement("span");
    text.className = "outline-text";
    text.textContent = item.label;
    button.appendChild(kind);
    button.appendChild(text);
    fragment.appendChild(button);
  }
  list.appendChild(fragment);
  updateActiveOutline();
}

function outlineText(value, fallback = "用户消息") {
  const text = String(value || "").replace(/\\s+/g, " ").trim();
  if (!text) {
    return fallback;
  }
  return text.length > 60 ? text.slice(0, 60) + "..." : text;
}

function scheduleActiveOutlineUpdate() {
  if (outlineRaf) {
    return;
  }
  outlineRaf = window.requestAnimationFrame(() => {
    outlineRaf = 0;
    updateActiveOutline();
  });
}

function updateActiveOutline() {
  const items = state.reading.outlineItems.filter((item) => item.target && item.target.isConnected);
  if (!items.length) {
    return;
  }
  const visible = items.filter((item) => state.reading.outlineVisible.has(item.id));
  const best = nearestOutlineItem(visible.length ? visible : items);
  if (best) {
    setActiveOutlineItem(best.id, false);
  }
}

function nearestOutlineItem(items) {
  const viewer = document.querySelector(".viewer");
  const rect = viewer ? viewer.getBoundingClientRect() : { top: 0, height: window.innerHeight };
  const center = rect.top + rect.height * 0.38;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const itemRect = item.target.getBoundingClientRect();
    const distance = Math.abs(itemRect.top - center);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function setActiveOutlineItem(id, scrollList) {
  state.reading.outlineActiveId = id;
  for (const button of document.querySelectorAll("[data-outline-target]")) {
    const active = button.dataset.outlineTarget === id;
    button.classList.toggle("active", active);
    if (active && scrollList && state.reading.outlineOpen) {
      button.scrollIntoView({ block: "nearest" });
    }
  }
}

function jumpToOutlineItem(id) {
  const item = state.reading.outlineTargets.get(id);
  if (!item || !item.target || !item.target.isConnected) {
    return false;
  }
  item.target.scrollIntoView({ behavior: "smooth", block: "center" });
  setActiveOutlineItem(id, true);
  return true;
}

function jumpUserTurn(direction) {
  flushTranscriptHydration();
  rebuildOutline();
  const users = state.reading.outlineItems.filter((item) => item.type === "user");
  if (!users.length) {
    showToast("没有用户回合", true);
    return;
  }
  const nearest = nearestOutlineItem(users);
  let index = nearest ? users.findIndex((item) => item.id === nearest.id) : -1;
  if (index < 0) {
    index = direction > 0 ? -1 : users.length;
  }
  const nextIndex = clampNumber(index + direction, 0, users.length - 1);
  jumpToOutlineItem(users[nextIndex].id);
}

function openShortcuts() {
  state.reading.shortcutsOpen = true;
  const overlay = $("shortcutOverlay");
  if (overlay) {
    overlay.hidden = false;
  }
  window.setTimeout(() => $("closeShortcuts")?.focus(), 0);
}

function closeShortcuts() {
  state.reading.shortcutsOpen = false;
  const overlay = $("shortcutOverlay");
  if (overlay) {
    overlay.hidden = true;
  }
}

function isTypingTarget(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function initReadingExperience() {
  applyVerbosity(currentVerbosity(), { persist: false, forceDetails: true });
  syncDefaultVerbosityControls();
  setOutlineOpen(currentOutlineOpen(), false);
  syncDefaultOutlineControls();
  for (const button of document.querySelectorAll("[data-view-verbosity]")) {
    button.addEventListener("click", () => applyVerbosity(button.dataset.viewVerbosity, { toast: true }));
  }
  for (const button of document.querySelectorAll("[data-default-view-verbosity]")) {
    button.addEventListener("click", () => applyDefaultVerbosity(button.dataset.defaultViewVerbosity, { toast: true }));
  }
  $("defaultOutlineOpen")?.addEventListener("change", (event) => applyDefaultOutlineOpen(event.target.checked, { toast: true }));
  $("toggleOutline").addEventListener("click", toggleOutline);
  $("closeOutline").addEventListener("click", () => setOutlineOpen(false));
  $("openShortcuts").addEventListener("click", openShortcuts);
  $("closeShortcuts").addEventListener("click", closeShortcuts);
  $("shortcutOverlay").addEventListener("click", (event) => {
    if (event.target === $("shortcutOverlay")) {
      closeShortcuts();
    }
  });
  $("outlineList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-outline-target]");
    if (button) {
      jumpToOutlineItem(button.dataset.outlineTarget);
    }
  });
  const viewer = document.querySelector(".viewer");
  if (viewer) {
    viewer.addEventListener("scroll", scheduleActiveOutlineUpdate, { passive: true });
    viewer.addEventListener("scroll", handleLiveTailScroll, { passive: true });
  }
  window.addEventListener("resize", scheduleActiveOutlineUpdate);
  window.addEventListener("resize", updateFollowLatestButton);
  $("followLatest").addEventListener("click", () => {
    state.liveTail.following = true;
    state.liveTail.needsFollowPrompt = false;
    scrollLiveTailToBottom();
    updateFollowLatestButton();
  });
  clearOutline("选择会话后显示大纲");
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
    completeOnly: "0",
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
  stopLiveTail({ silent: true });
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
  clearOutline("选择会话后显示大纲");
}

function sessionEngine(session) {
  return session.engine || "codex";
}

function sessionRef(session) {
  return session.ref || (sessionEngine(session) + ":" + session.id);
}

function sessionEngineKey(item) {
  const value = String(item?.engine || "").toLowerCase();
  return value === "claude" || value === "trae" ? value : "codex";
}

function normalizedSessionPath(item) {
  return String(item?.filePath || item?.displayFilePath || "").replace(/\\\\/g, "/");
}

function isCompleteSessionItem(item) {
  if (!item) {
    return true;
  }
  if (item.complete === true) {
    return true;
  }
  if (item.complete === false || item.live === true || item._live === true) {
    return false;
  }
  const engine = sessionEngineKey(item);
  if (engine === "trae") {
    return true;
  }
  if (engine === "codex") {
    const filePath = normalizedSessionPath(item);
    if (filePath.includes("/archived_sessions/")) {
      return true;
    }
    if (filePath.includes("/sessions/")) {
      return false;
    }
    return true;
  }
  if (engine === "claude") {
    return item.sourceKind ? item.sourceKind === "transcript" : true;
  }
  return true;
}

function isLiveSessionItem(item) {
  if (!item) {
    return false;
  }
  if (item.live === true || item._live === true) {
    return true;
  }
  if (item.live === false || item.complete === true) {
    return false;
  }
  const engine = sessionEngineKey(item);
  if (engine === "trae") {
    return false;
  }
  if (engine === "codex") {
    if (item.complete === false) {
      return true;
    }
    const filePath = normalizedSessionPath(item);
    return !filePath.includes("/archived_sessions/") && filePath.includes("/sessions/");
  }
  if (engine === "claude") {
    if (item.historyOnly || (item.sourceKind && item.sourceKind !== "transcript")) {
      return false;
    }
    return item.complete === false;
  }
  return item.complete === false;
}

function sortGroupSessionRows(sessions) {
  return sessions.slice().sort((a, b) => {
    const liveDelta = Number(isLiveSessionItem(b)) - Number(isLiveSessionItem(a));
    if (liveDelta) {
      return liveDelta;
    }
    return new Date(b.mtime || 0).getTime() - new Date(a.mtime || 0).getTime();
  });
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
  for (const group of groupMap.values()) {
    group.sessions = sortGroupSessionRows(group.sessions);
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
  const live = isLiveSessionItem(session);
  const liveDot = live ? "<span class='session-live-dot' aria-hidden='true'></span>" : "";
  const liveBadge = live ? "<span class='session-badge live'>进行中</span>" : "";
  const historyBadge = session.historyOnly ? "<span class='session-badge'>history</span>" : "";
  return "<button class='session" + active + (live ? " live" : "") + "' data-id='" + esc(ref) + "' title='" + esc(session.title) + "'>" +
    liveDot +
    "<strong>" + esc(session.title) + "</strong>" +
    liveBadge +
    historyBadge +
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
  snapshot.commitCount = "";
  resetSessionSearchState(false);
  $("title").textContent = snapshot.title;
  $("meta").classList.remove("empty", "loading");
  $("meta").removeAttribute("aria-busy");
  $("meta").innerHTML = renderSnapshotMeta(snapshot);
  $("goal").innerHTML = renderSnapshotGoal(snapshot);
  renderSnapshotRisks(snapshot);
  const options = activeOptions();
  const resumeButton = snapshot.engine !== "trae"
    ? "<button type='button' class='resume-orca' data-resume-orca='" + esc(snapshot.ref || "") + "' data-resume-cwd='" + esc(snapshot.cwd || snapshot.displayCwd || "") + "' data-resume-title='" + esc(snapshot.title || "") + "' title='在 Orca 中打开终端并恢复此会话'>↗ 在 Orca 继续</button>"
    : "";
  $("exports").innerHTML = resumeButton + "<a href='/export?" + options.toString() + "&format=html' target='_blank' rel='noopener noreferrer'>导出 HTML</a><a href='/export?" + options.toString() + "&format=md' target='_blank' rel='noopener noreferrer'>导出 Markdown</a><button type='button' data-publish-gist='1'>Gist</button><button type='button' data-publish-cloud='1'>发布分享</button><span id='publishStatus' class='publish-status'></span>";
  renderTranscriptTurns(snapshot.transcriptHtml || "<div class='meta'>没有找到可分享的用户或助手消息。</div>");
  loadSessionCommits(snapshot, state.requestToken);
  renderSessionSearch();
  postSnapshotState(snapshot);
  configureLiveTail(snapshot);
}

// 两段式渲染：大会话先渲染最新的一段轮次（秒开），更早的轮次在后台按帧
// 分片补进上方，并调整滚动位置保证视口内容不跳动。小会话保持一次性渲染。
var transcriptHydration = null;
var TRANSCRIPT_PROGRESSIVE_THRESHOLD = 140;
var TRANSCRIPT_TAIL_COUNT = 60;
var TRANSCRIPT_CHUNK_SIZE = 60;

function cancelTranscriptHydration() {
  if (transcriptHydration) {
    transcriptHydration.cancelled = true;
    transcriptHydration = null;
  }
}

function flushTranscriptHydration() {
  if (transcriptHydration) {
    transcriptHydration.flush();
  }
}

function renderTranscriptTurns(html) {
  cancelTranscriptHydration();
  const container = $("turns");
  const template = document.createElement("template");
  template.innerHTML = html || "";
  const nodes = Array.from(template.content.children);
  container.innerHTML = "";
  if (nodes.length <= TRANSCRIPT_PROGRESSIVE_THRESHOLD) {
    container.appendChild(template.content);
    openContentLinksInNewTabs(container);
    afterTranscriptContentMutated(container);
    container.removeAttribute("aria-busy");
    return;
  }

  const tailStart = nodes.length - TRANSCRIPT_TAIL_COUNT;
  const placeholder = document.createElement("div");
  placeholder.className = "turns-hydrating";
  placeholder.textContent = "正在载入更早的 " + tailStart + " 条记录...";
  container.appendChild(placeholder);
  const tail = document.createDocumentFragment();
  for (let i = tailStart; i < nodes.length; i += 1) {
    tail.appendChild(nodes[i]);
  }
  openContentLinksInNewTabs(tail);
  afterTranscriptContentMutated(tail, { rebuildOutline: false });
  container.appendChild(tail);
  scheduleOutlineRebuild();
  container.setAttribute("aria-busy", "true");

  const scroller = container.closest(".viewer") || document.scrollingElement || document.documentElement;
  let end = tailStart;
  const job = { cancelled: false, flush: () => {} };

  const insertChunk = () => {
    const start = Math.max(0, end - TRANSCRIPT_CHUNK_SIZE);
    const chunk = document.createDocumentFragment();
    for (let i = start; i < end; i += 1) {
      // 补齐的历史轮次跳过入场动画，避免整片内容同时播放动效。
      nodes[i].classList.add("prehydrated");
      chunk.appendChild(nodes[i]);
    }
    openContentLinksInNewTabs(chunk);
    afterTranscriptContentMutated(chunk, { rebuildOutline: false });
    const previousHeight = scroller.scrollHeight;
    const previousTop = scroller.scrollTop;
    placeholder.after(chunk);
    scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
    end = start;
    scheduleOutlineRebuild();
  };
  const finish = () => {
    const previousHeight = scroller.scrollHeight;
    const previousTop = scroller.scrollTop;
    placeholder.remove();
    scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
    container.removeAttribute("aria-busy");
    job.cancelled = true;
    if (transcriptHydration === job) {
      transcriptHydration = null;
    }
    scheduleOutlineRebuild();
  };
  const step = () => {
    if (job.cancelled) {
      return;
    }
    if (!placeholder.isConnected) {
      // 容器已被其他内容覆盖（切换会话/加载态），静默作废本次补齐。
      job.cancelled = true;
      if (transcriptHydration === job) {
        transcriptHydration = null;
      }
      return;
    }
    insertChunk();
    if (end <= 0) {
      finish();
      return;
    }
    placeholder.textContent = "正在载入更早的 " + end + " 条记录...";
    scheduleHydrationStep(step);
  };
  job.flush = () => {
    if (job.cancelled || !placeholder.isConnected) {
      return;
    }
    while (end > 0) {
      insertChunk();
    }
    finish();
  };
  transcriptHydration = job;
  scheduleHydrationStep(step);
}

function scheduleHydrationStep(fn) {
  // 不用 requestAnimationFrame：后台 tab 里 rAF 完全不触发，
  // 会导致切走再切回的用户面对永远补不齐的会话。setTimeout 在
  // 前台节奏相当，后台最多被钳到 ~1s/步，仍能推进完成。
  window.setTimeout(fn, 16);
}

function configureLiveTail(snapshot) {
  const ref = snapshot?.ref || state.selected || "";
  if (!ref || !isLiveSessionItem(snapshot)) {
    stopLiveTail({ silent: true });
    return;
  }
  if (state.liveTail.active && state.liveTail.ref === ref) {
    state.liveTail.head = liveHeadFromSnapshot(snapshot);
    updateFollowLatestButton();
    return;
  }
  stopLiveTail({ silent: true });
  state.liveTail.active = true;
  state.liveTail.ref = ref;
  state.liveTail.token += 1;
  state.liveTail.head = liveHeadFromSnapshot(snapshot);
  state.liveTail.polling = false;
  state.liveTail.following = isLiveTailNearBottom();
  state.liveTail.needsFollowPrompt = false;
  updateSelectedSessionCompletion(ref, false);
  updateFollowLatestButton();
  scheduleLiveTailPoll();
}

function stopLiveTail(options = {}) {
  if (state.liveTail.timer) {
    clearTimeout(state.liveTail.timer);
  }
  const wasActive = state.liveTail.active;
  const ref = state.liveTail.ref;
  state.liveTail.active = false;
  state.liveTail.ref = "";
  state.liveTail.timer = 0;
  state.liveTail.token += 1;
  state.liveTail.head = null;
  state.liveTail.polling = false;
  state.liveTail.following = true;
  state.liveTail.needsFollowPrompt = false;
  updateFollowLatestButton();
  if (wasActive && options.completed) {
    updateSelectedSessionCompletion(ref, true);
    if (state.currentSnapshot && (state.currentSnapshot.ref || state.selected) === ref) {
      state.currentSnapshot.complete = true;
      $("meta").innerHTML = renderSnapshotMeta(state.currentSnapshot);
    }
    showToast("会话已完成", false);
  } else if (wasActive && !options.silent && state.currentSnapshot && (state.currentSnapshot.ref || state.selected) === ref) {
    $("meta").innerHTML = renderSnapshotMeta(state.currentSnapshot);
  }
}

function liveHeadFromSnapshot(snapshot) {
  return {
    complete: isCompleteSessionItem(snapshot),
    turnCount: Array.isArray(snapshot?.turns) ? snapshot.turns.length : Number(snapshot?.turnCount || 0) || 0,
    lastEventAt: snapshotLastEventAt(snapshot),
  };
}

function snapshotLastEventAt(snapshot) {
  let latest = new Date(snapshot?.mtime || snapshot?.generatedAt || 0).getTime();
  for (const turn of snapshot?.turns || []) {
    const time = new Date(turn?.timestamp || 0).getTime();
    if (Number.isFinite(time)) {
      latest = Math.max(latest || 0, time);
    }
  }
  return Number.isFinite(latest) && latest > 0 ? new Date(latest).toISOString() : "";
}

function scheduleLiveTailPoll(delay = LIVE_TAIL_INTERVAL_MS) {
  if (!state.liveTail.active) {
    return;
  }
  if (state.liveTail.timer) {
    clearTimeout(state.liveTail.timer);
  }
  state.liveTail.timer = window.setTimeout(pollLiveTail, delay);
}

async function pollLiveTail() {
  if (!state.liveTail.active || state.liveTail.polling) {
    return;
  }
  const ref = state.liveTail.ref;
  const token = state.liveTail.token;
  state.liveTail.timer = 0;
  state.liveTail.polling = true;
  try {
    const head = await fetchSessionHead(ref);
    if (token !== state.liveTail.token || ref !== state.liveTail.ref || ref !== state.selected) {
      return;
    }
    const previousHead = state.liveTail.head;
    const changed = hasSessionHeadChanged(previousHead, head);
    state.liveTail.head = head;
    if (changed) {
      await fetchAndAppendLiveSnapshot(ref, token, head);
      if (token !== state.liveTail.token || ref !== state.liveTail.ref) {
        return;
      }
    }
    if (head.complete === true) {
      stopLiveTail({ completed: true });
      return;
    }
  } catch (_error) {
    // Keep tailing; transient parse/stat failures can happen while a writer is
    // replacing the active JSONL file.
  } finally {
    if (token === state.liveTail.token) {
      state.liveTail.polling = false;
      if (state.liveTail.active) {
        scheduleLiveTailPoll();
      }
    }
  }
}

async function fetchSessionHead(ref) {
  const params = new URLSearchParams({ id: ref });
  const response = await fetch("/api/session-head?" + params.toString());
  const head = await response.json();
  if (!response.ok || head.error) {
    throw new Error(head.error || "Failed to load session head");
  }
  return {
    complete: head.complete === true,
    turnCount: Number(head.turnCount || 0) || 0,
    lastEventAt: String(head.lastEventAt || ""),
  };
}

function hasSessionHeadChanged(previous, next) {
  if (!previous || !next) {
    return true;
  }
  return previous.complete !== next.complete
    || Number(previous.turnCount || 0) !== Number(next.turnCount || 0)
    || String(previous.lastEventAt || "") !== String(next.lastEventAt || "");
}

async function fetchAndAppendLiveSnapshot(ref, token, head) {
  const params = activeOptions();
  const response = await fetch("/api/snapshot?" + params.toString());
  const snapshot = await response.json();
  if (token !== state.liveTail.token || ref !== state.liveTail.ref || ref !== state.selected) {
    return;
  }
  if (!response.ok || snapshot.error) {
    throw new Error(snapshot.error || "Failed to load session");
  }
  if (head?.complete === true) {
    snapshot.complete = true;
  }
  appendLiveSnapshotDelta(snapshot);
  loadSessionCommits(snapshot, state.requestToken);
}

function appendLiveSnapshotDelta(snapshot) {
  const ref = snapshot.ref || state.selected || "";
  const previous = state.currentSnapshot || {};
  const previousCommitCount = previous.commitCount;
  snapshot.commitCount = previousCommitCount !== undefined ? previousCommitCount : "";
  const container = $("turns");
  flushTranscriptHydration();
  const previousCount = snapshotTopLevelItems(previous.turns || []).length;
  const template = document.createElement("template");
  template.innerHTML = snapshot.transcriptHtml || "";
  const allNodes = Array.from(template.content.children);
  const transcriptNodes = allNodes.filter((node) => !(node instanceof HTMLElement) || !node.classList.contains("subagents"));
  const newNodes = transcriptNodes.slice(previousCount);
  const appendedElements = [];
  if (newNodes.length) {
    const fragment = document.createDocumentFragment();
    for (const node of newNodes) {
      if (node instanceof HTMLElement) {
        appendedElements.push(node);
      }
      fragment.appendChild(node);
    }
    openContentLinksInNewTabs(fragment);
    afterTranscriptContentMutated(fragment, { rebuildOutline: false });
    const anchor = container.querySelector(".subagents");
    container.insertBefore(fragment, anchor || null);
  }
  const incomingSubagents = allNodes.find((node) => node instanceof HTMLElement && node.classList.contains("subagents"));
  if (incomingSubagents && !container.querySelector(".subagents")) {
    openContentLinksInNewTabs(incomingSubagents);
    afterTranscriptContentMutated(incomingSubagents, { rebuildOutline: false });
    container.appendChild(incomingSubagents);
  }
  state.currentSnapshot = snapshot;
  const selected = selectedSession();
  if (selected && sessionRef(selected) === ref) {
    selected.mtime = snapshot.mtime || selected.mtime;
  }
  $("title").textContent = snapshot.title || $("title").textContent;
  $("meta").innerHTML = renderSnapshotMeta(snapshot);
  $("goal").innerHTML = renderSnapshotGoal(snapshot);
  renderSnapshotRisks(snapshot);
  if (appendedElements.length) {
    if (!state.reading.outlineItems.length && previousCount > 0) {
      scheduleOutlineRebuild();
    } else {
      appendOutlineEntriesForNodes(appendedElements);
    }
    const shouldFollow = state.liveTail.following || isLiveTailNearBottom();
    if (shouldFollow) {
      state.liveTail.following = true;
      state.liveTail.needsFollowPrompt = false;
      scrollLiveTailToBottom();
    } else {
      state.liveTail.needsFollowPrompt = true;
    }
    updateFollowLatestButton();
  }
  postSnapshotState(snapshot);
}

function updateSelectedSessionCompletion(ref, complete) {
  const session = state.sessions.find((item) => sessionRef(item) === ref);
  if (!session) {
    return;
  }
  session.complete = Boolean(complete);
  session.live = !complete;
  renderSessions();
}

function liveTailScroller() {
  return document.querySelector(".viewer") || document.scrollingElement || document.documentElement;
}

function isLiveTailNearBottom() {
  const scroller = liveTailScroller();
  if (!scroller) {
    return true;
  }
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= LIVE_TAIL_BOTTOM_PX;
}

function scrollLiveTailToBottom() {
  const scroller = liveTailScroller();
  if (scroller) {
    scroller.scrollTop = scroller.scrollHeight;
  }
}

function handleLiveTailScroll() {
  if (!state.liveTail.active) {
    return;
  }
  if (isLiveTailNearBottom()) {
    state.liveTail.following = true;
    state.liveTail.needsFollowPrompt = false;
  } else {
    state.liveTail.following = false;
    state.liveTail.needsFollowPrompt = true;
  }
  updateFollowLatestButton();
}

function updateFollowLatestButton() {
  const button = $("followLatest");
  if (!button) {
    return;
  }
  button.hidden = !(state.liveTail.active && !state.liveTail.following && state.liveTail.needsFollowPrompt);
}

function renderSnapshotRisks(snapshot) {
  const notices = (snapshot.notices || []).map((notice) => {
    return "<div class='notice " + esc(notice.severity || "medium") + "'><b>NOTE</b><span><strong>" + esc(notice.label || "Notice") + ".</strong> " + esc(notice.text || "") + "</span></div>";
  }).join("");
  const risks = (snapshot.risks || []).length ? snapshot.risks.map((risk) => {
    return "<div class='risk " + esc(risk.severity) + "'><b>" + esc(risk.severity) + "</b><span>" + esc(risk.label) + "</span><em>" + esc(formatRiskTurns(risk)) + "</em></div>";
  }).join("") : "";
  $("risks").innerHTML = snapshot.safetyChecks === false ? "" : notices + risks;
}

async function loadSessionCommits(snapshot, requestToken) {
  const ref = snapshot.ref || state.selected || "";
  if (!ref) {
    return;
  }
  try {
    const params = new URLSearchParams({ id: ref });
    const response = await fetch("/api/session-commits?" + params.toString());
    const result = await response.json();
    if (requestToken !== state.requestToken || state.selected !== ref || state.currentSnapshot !== snapshot) {
      return;
    }
    const commits = Array.isArray(result.commits) ? result.commits : [];
    snapshot.commitCount = commits.length;
    $("meta").innerHTML = renderSnapshotMeta(snapshot);
    insertSessionCommitCards(snapshot, commits);
  } catch {
    if (requestToken === state.requestToken && state.selected === ref && state.currentSnapshot === snapshot) {
      snapshot.commitCount = 0;
      $("meta").innerHTML = renderSnapshotMeta(snapshot);
    }
  }
}

function insertSessionCommitCards(snapshot, commits) {
  const container = $("turns");
  Array.from(container.querySelectorAll(".commit-card")).forEach((node) => node.remove());
  if (!Array.isArray(commits) || !commits.length) {
    return;
  }
  flushTranscriptHydration();
  const timeline = transcriptTopLevelTimeline(snapshot, container);
  const sorted = commits.slice().sort((a, b) => commitTimeMs(a) - commitTimeMs(b));
  for (const commit of sorted) {
    const card = renderCommitCardNode(commit);
    const before = commitInsertBeforeNode(timeline, commitTimeMs(commit));
    if (before) {
      container.insertBefore(card, before);
    } else {
      const subagents = container.querySelector(".subagents");
      container.insertBefore(card, subagents || null);
    }
  }
  scheduleOutlineRebuild();
}

function transcriptTopLevelTimeline(snapshot, container) {
  const items = snapshotTopLevelItems(snapshot.turns || []);
  const nodes = Array.from(container.children).filter((node) => {
    return !node.classList.contains("commit-card")
      && !node.classList.contains("subagents")
      && !node.classList.contains("turns-hydrating");
  });
  const timeline = [];
  for (let index = 0; index < items.length && index < nodes.length; index += 1) {
    const time = earliestTurnTimeMs(items[index].turns);
    if (Number.isFinite(time)) {
      timeline.push({ node: nodes[index], time: time });
    }
  }
  return timeline.sort((a, b) => a.time - b.time);
}

function snapshotTopLevelItems(turns) {
  const items = [];
  let index = 0;
  while (index < turns.length) {
    const turn = turns[index];
    if (isSnapshotUserTurn(turn)) {
      items.push({ turns: [turn] });
      index += 1;
      continue;
    }
    const segment = [];
    while (index < turns.length && !isSnapshotUserTurn(turns[index])) {
      segment.push(turns[index]);
      index += 1;
    }
    const finalIndex = lastAssistantTurnIndex(segment);
    if (finalIndex === -1) {
      if (segment.length) {
        items.push({ turns: segment });
      }
      continue;
    }
    if (finalIndex === segment.length - 1) {
      const processTurns = segment.slice(0, finalIndex);
      if (processTurns.length) {
        items.push({ turns: processTurns });
      }
      items.push({ turns: [segment[finalIndex]] });
      continue;
    }
    items.push({ turns: segment });
  }
  return items;
}

function isSnapshotUserTurn(turn) {
  return Boolean(turn && turn.kind !== "tool" && turn.role === "user");
}

function isSnapshotAssistantTurn(turn) {
  return Boolean(turn && turn.kind !== "tool" && turn.role === "assistant");
}

function lastAssistantTurnIndex(turns) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (isSnapshotAssistantTurn(turns[index])) {
      return index;
    }
  }
  return -1;
}

function earliestTurnTimeMs(turns) {
  let best = Number.POSITIVE_INFINITY;
  for (const turn of turns || []) {
    const time = new Date(turn.timestamp || "").getTime();
    if (Number.isFinite(time) && time < best) {
      best = time;
    }
  }
  return best;
}

function commitInsertBeforeNode(timeline, commitMs) {
  if (!Number.isFinite(commitMs)) {
    return null;
  }
  for (const item of timeline) {
    if (item.time > commitMs && item.node && item.node.isConnected) {
      return item.node;
    }
  }
  return null;
}

function renderCommitCardNode(commit) {
  const card = document.createElement("article");
  card.className = "turn commit-card";
  card.setAttribute("data-commit-sha", String(commit.sha || ""));
  card.setAttribute("data-commit-timestamp", String(commit.timestamp || ""));
  const shortSha = String(commit.sha || "").slice(0, 7);
  const subject = String(commit.subject || "").trim() || "(no subject)";
  const timestamp = String(commit.timestamp || "");
  card.innerHTML =
    "<div class='commit-body' title='" + esc(timestamp) + "'>" +
      "<code class='commit-sha'>" + esc(shortSha) + "</code>" +
      "<span class='commit-subject'>" + esc(subject) + "</span>" +
      "<time class='commit-time' datetime='" + esc(timestamp) + "'>" + esc(relativeTime(timestamp)) + "</time>" +
    "</div>";
  return card;
}

function commitTimeMs(commit) {
  const time = new Date(commit && commit.timestamp || "").getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
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
  if (snapshot.commitCount !== "" && snapshot.commitCount !== undefined && snapshot.commitCount !== null) {
    parts.push("<span class='sep'>·</span><span>" + esc(snapshot.commitCount) + " commits</span>");
  }
  if (tokens) {
    parts.push("<span class='sep'>·</span><span><b>" + esc(formatTokenShort(tokens)) + "</b> tokens</span>");
  }
  if (snapshot.redacted) {
    parts.push("<span class='sep'>·</span><span class='tag'><span class='dot'></span>已脱敏</span>");
  }
  if (isLiveSessionItem(snapshot) || (state.liveTail.active && (snapshot.ref || state.selected) === state.liveTail.ref)) {
    parts.push("<span class='sep'>·</span><span class='live-indicator'><span class='live-dot' aria-hidden='true'></span>实时</span>");
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
    type: "agent-snapshot:state",
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
  return copyTextToClipboard(url);
}

async function copyTextToClipboard(value) {
  const text = String(value || "");
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

async function copyFilePath(path) {
  const copied = await copyTextToClipboard(path);
  showToast(copied ? "已复制路径" : "复制路径失败", !copied);
}

async function revealFilePath(path) {
  const targetPath = String(path || "").trim();
  if (!targetPath) {
    return;
  }
  showToast("正在打开文件位置...", false);
  try {
    const params = new URLSearchParams({ path: targetPath });
    const response = await fetch("/api/reveal-in-file?" + params.toString(), {
      method: "POST",
      headers: { "${MUTATION_CSRF_HEADER}": csrfToken },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.ok) {
      showToast(data.message || "已打开文件位置", false);
    } else {
      showToast(data.error || (response.status === 404 ? "路径不存在" : "打开文件位置失败"), true);
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  }
}

function handleFilePathAction(target, event) {
  const path = target?.dataset?.filePath || "";
  if (!path) {
    return;
  }
  if (event?.metaKey) {
    revealFilePath(path);
  } else {
    copyFilePath(path);
  }
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
      showToast(data.via === "terminal" ? "Orca 不可用，已在 " + (data.app || "Terminal") + " 打开" : "已在 Orca 继续", false);
    } else {
      showToast(data.error || "恢复失败", true);
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

function gistPublishToastMessage(code, fallback) {
  if (code === "gh_not_installed") {
    return "未找到 GitHub CLI（gh），请先安装后重试";
  }
  if (code === "gh_not_authenticated") {
    return "GitHub CLI 未登录，请先运行 gh auth login";
  }
  if (code === "network_failure") {
    return "网络连接失败，Gist 发布未完成";
  }
  return fallback || "Gist 发布失败";
}

async function publishSelectedSessionGist() {
  if (!state.selected) {
    return;
  }
  const status = $("publishStatus");
  const button = document.querySelector("[data-publish-gist]");
  if (button) button.disabled = true;
  if (status) {
    status.textContent = "正在发布 Gist...";
    status.classList.remove("error", "warning");
  }
  try {
    const { response, payload } = await fetchJsonRequest("/api/publish-gist", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "${MUTATION_CSRF_HEADER}": csrfToken,
      },
      body: JSON.stringify({ id: state.selected }),
    }, "发布 Gist");
    if (!response.ok || !payload.ok) {
      const message = gistPublishToastMessage(payload.code, payload.error || "Gist 发布失败：HTTP " + response.status);
      if (status) {
        status.textContent = message;
        status.classList.add("error");
        status.classList.remove("warning");
      }
      showToast(message, true);
      return;
    }
    const gistUrl = String(payload.url || "");
    if (!gistUrl) {
      throw new Error("Gist 发布响应未返回链接。");
    }
    const copied = await copyShareUrlToClipboard(gistUrl);
    if (status) {
      status.classList.toggle("warning", !copied);
      status.classList.remove("error");
      status.innerHTML = (copied ? "Gist 已发布，链接已复制：" : "Gist 已发布，复制失败，请手动复制：") +
        " <a href='" + esc(gistUrl) + "' target='_blank' rel='noopener noreferrer'>" + esc(gistUrl) + "</a>";
    }
    showToast(copied ? "Gist 已发布，链接已复制" : "Gist 已发布，复制链接失败", !copied);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (status) {
      status.textContent = message;
      status.classList.add("error");
      status.classList.remove("warning");
    }
    showToast(message, true);
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
$("openGallery").addEventListener("click", openGallery);
$("closeStats").addEventListener("click", closeStats);
$("statsRefresh").addEventListener("click", loadStats);
$("statsOverlay").addEventListener("click", (event) => {
  const filterButton = event.target.closest("[data-stats-filter]");
  if (filterButton) {
    state.statsFilter = STATS_FILTERS.some((item) => item.key === filterButton.dataset.statsFilter) ? filterButton.dataset.statsFilter : "all";
    renderStatsFilter();
    renderStatsActivity();
    renderStatsProjects();
    return;
  }
  if (event.target === $("statsOverlay")) {
    closeStats();
  }
});
$("closeGallery").addEventListener("click", closeGallery);
$("galleryOverlay").addEventListener("click", async (event) => {
  const sourceButton = event.target.closest("[data-gallery-source]");
  if (sourceButton) {
    await setGallerySource(sourceButton.dataset.gallerySource);
    return;
  }
  const moreButton = event.target.closest("[data-gallery-more]");
  if (moreButton) {
    await loadGallery(false);
    return;
  }
  const lightboxButton = event.target.closest("[data-gallery-lightbox]");
  if (lightboxButton) {
    openGalleryLightbox(lightboxButton.dataset.galleryLightbox);
    return;
  }
  const sessionButton = event.target.closest("[data-gallery-session]");
  if (sessionButton) {
    await openGallerySession(sessionButton.dataset.gallerySession);
    return;
  }
  if (event.target === $("galleryOverlay")) {
    closeGallery();
  }
});
$("galleryLightbox").addEventListener("click", (event) => {
  if (event.target.closest("[data-lightbox-prev]")) {
    event.preventDefault();
    moveGalleryLightbox(-1);
    return;
  }
  if (event.target.closest("[data-lightbox-next]")) {
    event.preventDefault();
    moveGalleryLightbox(1);
    return;
  }
  if (event.target === $("galleryLightbox") || event.target === $("galleryLightboxImage")) {
    closeGalleryLightbox();
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
  const typing = isTypingTarget(event.target);
  if (state.gallery.lightboxOpen) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeGalleryLightbox();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveGalleryLightbox(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveGalleryLightbox(1);
      return;
    }
  }
  if (state.gallery.open && event.key === "Escape") {
    event.preventDefault();
    closeGallery();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && key === "k") {
    event.preventDefault();
    openSearchDialog();
    return;
  }
  if (event.metaKey && key === "/") {
    event.preventDefault();
    openShortcuts();
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && key === "o") {
    event.preventDefault();
    cycleVerbosity();
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && key === "m") {
    event.preventDefault();
    toggleOutline();
    return;
  }
  if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === "[") {
    event.preventDefault();
    jumpUserTurn(-1);
    return;
  }
  if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === "]") {
    event.preventDefault();
    jumpUserTurn(1);
    return;
  }
  if (event.key === "Escape" && state.reading.shortcutsOpen) {
    event.preventDefault();
    closeShortcuts();
    return;
  }
  if (event.key === "Escape" && state.reading.settingsOpen) {
    event.preventDefault();
    closeSettingsPopover();
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
  if (event.target.closest("[data-publish-gist]")) {
    publishSelectedSessionGist();
    return;
  }
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
  const filePath = event.target.closest?.("[data-file-path]");
  if (filePath) {
    event.preventDefault();
    event.stopPropagation();
    handleFilePathAction(filePath, event);
    return;
  }
  const link = event.target.closest?.("a[href]");
  if (!link) {
    return;
  }
  event.preventDefault();
  openInNewTab(link.href);
});
$("turns").addEventListener("keydown", (event) => {
  const filePath = event.target.closest?.("[data-file-path]");
  if (!filePath || !isKeyboardActivation(event)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  handleFilePathAction(filePath, event);
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
initReadingExperience();
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
