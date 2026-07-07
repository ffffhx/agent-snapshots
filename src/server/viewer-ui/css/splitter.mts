// @ts-nocheck

export const splitterCss = `/* ---------- 分隔条 ---------- */
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

`;
