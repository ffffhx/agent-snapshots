// @ts-nocheck
export const readingControlsCss = `/* Reading controls */
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

/* Accessibility + keyboard polish */
:where(a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"]),.file-path-action):focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;}
body[data-sidebar-collapsed="true"] .app{grid-template-columns:0 var(--splitter-width) minmax(0,1fr);}
body[data-sidebar-collapsed="true"] .sidebar{border-right:0;overflow:hidden;pointer-events:none;}
body[data-sidebar-collapsed="true"] .sidebar > *{visibility:hidden;}
body[data-sidebar-collapsed="true"] .splitter::before{background:var(--seal);}
.turn-keyboard-current .message-card,
.turn-keyboard-current.process-entry,
.turn-keyboard-current.commit-card .commit-body{outline:2px solid var(--focus-ring);outline-offset:5px;border-radius:10px;}
.gallery-lightbox:focus-visible{outline:2px solid rgba(255,245,222,0.72);outline-offset:-6px;}
@media (prefers-reduced-motion: no-preference){
  .stats-skeleton-line{animation:skeleton-shift 1.2s ease-in-out infinite;}
}

@media (max-width:900px){
  body[data-sidebar-collapsed="true"] .app{grid-template-columns:1fr;grid-template-rows:0 minmax(0,1fr);}
  body[data-sidebar-collapsed="true"] .sidebar{border-bottom:0;}
  .reading-tools{order:4;flex-wrap:wrap;}
  .outline-panel{top:auto;right:10px;bottom:10px;left:10px;width:auto;max-height:min(420px,58dvh);transform:translateY(calc(100% + 18px));}
  body[data-outline-open="true"] .outline-panel{transform:none;}
}
@media (prefers-reduced-motion:reduce){
  .outline-panel,.shortcut-dialog,.shortcut-overlay{animation:none !important;transition:none !important;}
}

`;
