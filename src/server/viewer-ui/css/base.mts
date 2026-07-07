// @ts-nocheck

export const baseCss = `* { box-sizing: border-box; }
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
.skip-link {
  position: fixed;
  top: 10px;
  left: 12px;
  z-index: 100;
  transform: translateY(-140%);
  border: 1px solid var(--seal);
  border-radius: 8px;
  background: var(--panel);
  color: var(--seal-deep);
  padding: 8px 12px;
  font: 700 12px/1 var(--mono);
  text-decoration: none;
  box-shadow: var(--shadow-panel);
}
.skip-link:focus-visible {
  transform: none;
  outline: 2px solid var(--focus, var(--seal));
  outline-offset: 2px;
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

`;
