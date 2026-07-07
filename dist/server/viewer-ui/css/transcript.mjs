// @ts-nocheck
export const transcriptCss = `/* 目标 callout */
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
.session-note[hidden] { display: none; }
.session-note {
  margin: 12px clamp(20px, 2.2vw, 40px) 0;
}
.session-note-card {
  display: grid;
  gap: 12px;
  max-width: 960px;
  border: 1px solid var(--line);
  border-left: 4px solid var(--seal);
  border-radius: 10px;
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  box-shadow: var(--shadow-soft);
  padding: 12px 14px 14px;
}
.session-note-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.session-note-head > div:first-child {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.session-note-head b {
  color: var(--seal);
  font: 800 10px/1 var(--mono);
  letter-spacing: 0.14em;
}
.session-note-head time,
.session-note-head span {
  min-width: 0;
  overflow: hidden;
  color: var(--faint);
  font: 700 11px/1.25 var(--mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-note-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
}
.session-note-actions button,
.session-note-foot button {
  min-height: 28px;
  border: 1px solid var(--line-2);
  border-radius: 7px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0 10px;
  font: 700 11px/1 var(--mono);
}
.session-note-actions button:hover,
.session-note-foot button:hover {
  border-color: var(--seal);
  color: var(--seal-deep);
  transform: none;
}
.session-note-foot button {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper);
}
.session-note-foot button:hover {
  border-color: var(--seal-deep);
  background: var(--seal-deep);
  color: #fdf3ec;
}
.session-note-foot button:disabled {
  border-color: var(--line);
  background: var(--wash-1);
  color: var(--faint);
}
.session-note-text {
  max-width: 86ch;
  color: var(--ink);
  font: 400 15.5px/1.7 var(--serif);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.session-note textarea {
  width: 100%;
  min-height: 132px;
  resize: vertical;
  border: 1px solid var(--line-2);
  border-radius: 9px;
  background: var(--field-bg);
  color: var(--ink);
  padding: 11px 12px;
  font: 500 14px/1.55 var(--sans);
  outline: 0;
}
.session-note textarea:focus {
  border-color: rgba(177, 56, 42, 0.48);
  background: var(--panel);
  box-shadow: 0 0 0 3px rgba(177, 56, 42, 0.12);
}
.session-note-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--faint);
  font: 700 11px/1 var(--mono);
}
.session-note-foot b {
  color: var(--muted);
}
.session-note-error {
  color: var(--red);
  font: 700 11px/1.35 var(--mono);
}
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
.turn-meta-badge {
  min-height: 14px;
  margin: 0 0 5px auto;
  color: var(--faint);
  font: 700 10.5px/1.2 var(--mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
body[data-turn-meta="off"] .turn-meta-badge { display: none; }
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

`;
