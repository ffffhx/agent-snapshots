// @ts-nocheck
import { serverCss } from "./css/index.mjs";
import { serverJs } from "./js/index.mjs";
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
  <a class="skip-link" href="#turns">跳到正文</a>
  <main class="app">
    <aside class="sidebar" aria-label="会话列表">
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
      <div id="sessions" class="sessions" role="navigation" aria-label="会话列表"></div>
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
              <div id="settingsPopover" class="settings-popover" role="dialog" aria-modal="true" aria-label="设置" hidden>
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
                    <button class="appx" type="button" data-font-step="-1" title="缩小正文字号" aria-label="缩小正文字号">A－</button>
                    <span id="readScaleValue" class="settings-value">100%</span>
                    <button class="appx" type="button" data-font-step="1" title="放大正文字号" aria-label="放大正文字号">A＋</button>
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
                <label class="settings-toggle-row" title="显示助手回复的耗时和 token">
                  <span>回合元信息</span>
                  <input id="turnMetaToggle" type="checkbox">
                </label>
              </div>
            </div>
          </div>
          <div id="matchNav" class="match-nav" aria-live="polite" hidden>
            <span id="matchNavCount">0/0 匹配</span>
            <button id="matchPrev" class="appx" type="button" title="上一个匹配（Shift+N）" aria-label="上一个匹配">N</button>
            <button id="matchNext" class="appx" type="button" title="下一个匹配（N）" aria-label="下一个匹配">n</button>
            <button id="matchClose" class="appx" type="button" title="关闭匹配" aria-label="关闭匹配">×</button>
          </div>
          <div class="reading-tools" role="group" aria-label="阅读工具">
            <button id="openShortcuts" class="appx" type="button" title="快捷键（⌘/）" aria-label="打开快捷键">⌘/</button>
          </div>
          <div id="exports" class="exports"></div>
        </div>
        <div id="meta" class="meta empty">还没有选择会话。</div>
        <div id="sessionSearch" class="session-search">
          <div class="session-search-bar">
            <input id="sessionSearchInput" type="search" placeholder="在当前 Session 里搜大意" aria-label="在当前 Session 里语义搜索" autocomplete="off" disabled>
            <button id="sessionSearchRun" type="button" disabled>语义搜索</button>
            <span id="sessionSearchStatus" class="session-search-status"></span>
          </div>
          <div id="sessionSearchResults" class="session-search-results"></div>
        </div>
      </div>
      <div id="goal" class="goal"></div>
      <div id="risks" class="risks"></div>
      <div id="sessionNote" class="session-note" hidden></div>
      <div id="turns" class="turns" tabindex="-1" aria-label="正文记录"></div>
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
    <section class="search-dialog" role="dialog" aria-modal="true" aria-label="搜索会话正文" aria-labelledby="searchTitle">
      <div class="search-bar">
        <div>
          <p class="eyebrow">Session search</p>
          <h2 id="searchTitle">搜索会话正文</h2>
        </div>
        <button id="closeSearch" class="search-close" type="button" title="关闭搜索">关闭</button>
      </div>
      <input id="globalSearch" class="global-search-input" type="search" placeholder="关键词，可加 source: role: project: before: after: -排除" title="支持过滤语法：source:codex/claude、role:user/assistant、project:名称、before:2026-01-01、after:2026-01-01、-排除词" role="combobox" aria-label="搜索关键词" aria-expanded="true" aria-autocomplete="list" aria-controls="searchResults" autocomplete="off" spellcheck="false">
      <div class="search-controls" role="group" aria-label="搜索范围">
        <button class="search-mode active" type="button" data-search-mode="keyword">关键词</button>
        <button class="search-mode" type="button" data-search-mode="semantic">语义</button>
        <button class="search-flag" type="button" data-search-flag="caseSensitive" aria-pressed="false" title="区分大小写" aria-label="区分大小写">Aa</button>
        <button class="search-flag" type="button" data-search-flag="wholeWord" aria-pressed="false" title="整词匹配" aria-label="整词匹配">词</button>
        <span id="searchScopeLabel" class="search-scope-label">全部历史</span>
        <button id="prewarmIndex" class="search-prewarm" type="button" title="提前生成语义索引">预热索引</button>
        <span id="searchStatus" class="search-status"></span>
      </div>
      <div id="searchFacets" class="search-facets" aria-label="按来源和项目筛选"></div>
      <div id="searchResults" class="search-results" role="listbox" aria-label="搜索结果"></div>
      <div class="search-foot">
        <span class="search-hints"><kbd>↑</kbd><kbd>↓</kbd> 导航 · <kbd>↵</kbd> 打开 · <kbd>Tab</kbd> 切换焦点 · <kbd>esc</kbd> 关闭</span>
        <span id="searchCount" class="search-count"></span>
      </div>
    </section>
  </div>
  <div id="statsOverlay" class="stats-overlay" hidden>
    <section class="stats-dialog" role="dialog" aria-modal="true" aria-label="使用统计" aria-labelledby="statsTitle">
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
    <section class="gallery-dialog" role="dialog" aria-modal="true" aria-label="图库" aria-labelledby="galleryTitle">
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
  <div id="galleryLightbox" class="gallery-lightbox" role="dialog" aria-modal="true" aria-label="图片预览" tabindex="-1" hidden>
    <button class="gallery-lightbox-nav prev" type="button" data-lightbox-prev title="上一张" aria-label="上一张">‹</button>
    <figure class="gallery-lightbox-figure">
      <img id="galleryLightboxImage" alt="">
      <figcaption id="galleryLightboxCaption"></figcaption>
    </figure>
    <button class="gallery-lightbox-nav next" type="button" data-lightbox-next title="下一张" aria-label="下一张">›</button>
  </div>
  <div id="shortcutOverlay" class="shortcut-overlay" hidden>
    <section class="shortcut-dialog" role="dialog" aria-modal="true" aria-label="快捷键" aria-labelledby="shortcutTitle">
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
        <div><kbd>j</kbd><kbd>k</kbd><span>上下个记录</span></div>
        <div><kbd>g</kbd><kbd>g</kbd><span>跳到顶部</span></div>
        <div><kbd>G</kbd><span>跳到底部</span></div>
        <div><kbd>u</kbd><span>上个用户回合</span></div>
        <div><kbd>[</kbd><kbd>]</kbd><span>上下个用户回合</span></div>
        <div><kbd>/</kbd><span>会话内搜索</span></div>
        <div><kbd>s</kbd><span>收起侧栏</span></div>
        <div><kbd>⌘/</kbd><span>快捷键</span></div>
        <div><kbd>Esc</kbd><span>关闭弹层</span></div>
      </div>
    </section>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <script>window.AGENT_SNAPSHOT_SHARE_CONFIG=${inlineJson(shareConfig || {})}; window.AGENT_SNAPSHOT_CSRF_TOKEN=${inlineJson(csrfToken)};</script>
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
