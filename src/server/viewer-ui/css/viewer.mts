// @ts-nocheck

export const viewerCss = `/* ---------- 阅读区 ---------- */
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
  box-shadow: 0 0 0 2px rgba(63, 143, 98, 0.16);
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
.match-nav {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  min-height: 34px;
  border: 1px solid var(--line-2);
  border-radius: 9px;
  background: var(--panel);
  padding: 3px 4px 3px 10px;
  color: var(--muted);
  font: 700 11px/1 var(--mono);
  font-variant-numeric: tabular-nums;
}
.match-nav[hidden] { display: none; }
.match-nav span {
  padding-right: 4px;
  white-space: nowrap;
}
.match-nav .appx {
  min-height: 26px;
  min-width: 26px;
  padding: 0 6px;
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
.exports .note-toggle {
  gap: 7px;
}
.note-toggle-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.28;
}
.exports .note-toggle.has-note {
  border-color: rgba(177, 56, 42, 0.36);
  background: var(--seal-soft);
  color: var(--seal-deep);
}
.exports .note-toggle.has-note .note-toggle-dot {
  opacity: 1;
}
.exports .note-toggle.active {
  border-color: var(--seal);
  color: var(--seal-deep);
}
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
.session-search input:focus-visible {
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
.transcript-match-current .message-card,
.transcript-match-current.process-entry {
  outline: 2px solid rgba(177, 56, 42, 0.48);
  outline-offset: 5px;
  border-radius: 10px;
}
.transcript-match-flash .message-card,
.transcript-match-flash.process-entry {
  background: linear-gradient(180deg, rgba(234, 197, 110, 0.16), transparent 78%);
}
.transcript-match-mark {
  border-radius: 2px;
  background: linear-gradient(180deg, rgba(234, 197, 110, 0.2), rgba(234, 197, 110, 0.72));
  color: inherit;
  padding: 0 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
html[data-theme="dark"] .transcript-match-mark {
  color: #1a1206;
  background: linear-gradient(180deg, rgba(199, 146, 66, 0.85), rgba(199, 146, 66, 0.96));
}
@media (max-width: 760px) {
  .session-search-bar { grid-template-columns: 1fr; }
  .session-search-status { white-space: normal; }
}

`;
