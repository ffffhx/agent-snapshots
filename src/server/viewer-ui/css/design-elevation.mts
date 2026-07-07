// @ts-nocheck

export const designElevationCss = `/* ============================================================
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
button:focus-visible,.source-tab:focus-visible,.session:focus-visible,.search-result:focus-visible,.project-header:focus-visible,.project-search:focus-visible,.project-more:focus-visible,.sessions-load-more:focus-visible,.gallery-chip:focus-visible,.gallery-thumb:focus-visible,.gallery-card-meta:focus-visible,.gallery-more:focus-visible,.stats-chip:focus-visible,.facet-chip:focus-visible,.search-flag:focus-visible,.search-prewarm:focus-visible,.sr-act:focus-visible,.session-search-result:focus-visible,.appx:focus-visible,.exports a:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;}
.splitter:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px;}
input[type="search"]:focus{border-color:var(--seal);}
input[type="search"]:focus-visible,.session-search input:focus-visible,.stats-cost-inputs input:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;box-shadow:0 0 0 3px var(--focus-glow);}
.session-search input:focus{border-color:var(--seal);background:var(--panel);}
.stats-cost-inputs input:focus{border-color:var(--seal);}
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

`;
