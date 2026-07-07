// @ts-nocheck
export const sidebarCss = `/* ---------- 侧栏 ---------- */
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
}
input[type="search"]::placeholder { color: var(--faint); }
input[type="search"]:focus-visible {
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
}
@keyframes snapshot-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: no-preference) {
  .loading-spinner { animation: snapshot-spin 0.8s linear infinite; }
}
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
@media (prefers-reduced-motion: no-preference) {
  .session-live-dot { animation: live-pulse 2.4s ease-out infinite; }
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

`;
