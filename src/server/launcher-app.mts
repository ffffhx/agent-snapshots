// @ts-nocheck

// Compact search launcher for the Electron desktop app — a Raycast/Spotlight-
// style command palette focused on the two things that matter: find a session
// and jump back into it in Orca. Reading is secondary (open the full view).

import { MUTATION_CSRF_HEADER } from "./local-security.js";

export function renderLauncherApp(csrfToken) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Snapshots</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>${launcherCss()}</style>
</head>
<body>
  <main id="launcher" class="launcher">
    <header class="bar" id="dragbar">
      <svg class="glass" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input id="q" class="q" type="text" autocomplete="off" spellcheck="false" placeholder="搜索会话 — 点击预览，回车在 Orca 继续">
      <div class="scopes" id="scopes">
        <button class="scope active" data-scope="all" type="button">全部</button>
        <button class="scope" data-scope="codex" type="button">Codex</button>
        <button class="scope" data-scope="claude" type="button">Claude</button>
      </div>
    </header>
    <section id="recovery" class="recovery" hidden aria-live="polite">
      <span class="recovery-icon" aria-hidden="true">↻</span>
      <div class="recovery-copy">
        <b id="recoveryTitle">发现异常中断的会话</b>
        <span id="recoverySubtitle">恢复电脑重启前仍在运行的 Session</span>
      </div>
      <button id="recoveryRestore" class="recovery-restore" type="button">全部恢复</button>
    </section>
    <section id="workspace" class="workspace">
      <div id="list" class="list" role="listbox" aria-label="会话"></div>
      <aside id="peek" class="peek" aria-label="会话预览" aria-hidden="true"></aside>
    </section>
    <footer class="foot">
      <span class="brand">
        <svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#c33f28"/><g transform="rotate(-5 32 32)"><rect x="18.5" y="15" width="27" height="33" rx="3" fill="#f6ecd6"/><g fill="#c9bb98"><rect x="22.5" y="21" width="19" height="2" rx="1"/><rect x="22.5" y="25.5" width="17" height="2" rx="1"/><rect x="22.5" y="30" width="19" height="2" rx="1"/></g><circle cx="40.5" cy="42.5" r="6.2" fill="#a82f1c"/><circle cx="40.5" cy="42.5" r="6.2" fill="none" stroke="#fff3df" stroke-width="0.9" stroke-opacity="0.85"/></g></svg>
        Agent Snapshots
      </span>
      <span id="ambient" class="ambient" hidden></span>
      <span id="hint" class="hint"></span>
    </footer>
  </main>
  <div id="toast" class="toast" hidden></div>
  <div id="shortcuts" class="shortcuts" hidden>
    <div class="shortcuts-card" role="dialog" aria-modal="true" aria-labelledby="shortcutsTitle">
      <div id="shortcutsTitle" class="shortcuts-title">快捷键</div>
      <div class="shortcut-list">
        <span>点击</span><b>预览会话</b>
        <span>↵</span><b>在 Orca 继续</b>
        <span>⌘↵</span><b>完整视图</b>
        <span>→ / ⌘P</span><b>预览</b>
        <span>← / esc</span><b>关闭预览</b>
        <span>↑↓</span><b>选择</b>
        <span>⌘1-3</span><b>切换范围</b>
        <span>⌘/</span><b>快捷键</b>
        <span>esc</span><b>关闭</b>
      </div>
    </div>
  </div>
  <script>window.CSRF=${JSON.stringify(String(csrfToken || ""))};</script>
  <script>${launcherJs()}</script>
</body>
</html>`;
}

function launcherCss() {
  return `
:root{
  --ink:#efe6d3; --dim:#a4977c; --faint:#7f7358;
  --seal:#d94f39; --seal-soft:rgba(217,79,57,0.16);
  --live:#7ccf88; --live-soft:rgba(124,207,136,0.14);
  --panel:rgba(26,20,13,0.66); --row-hover:rgba(233,220,196,0.05);
  --line:rgba(233,220,196,0.09); --line-2:rgba(233,220,196,0.14);
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,"PingFang SC",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Avenir Next","Segoe UI","PingFang SC",system-ui,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:transparent;color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;overflow:hidden}
::selection{background:var(--seal-soft)}
.launcher{display:flex;flex-direction:column;height:100vh;background:var(--panel);backdrop-filter:saturate(1.2) blur(2px);border:0.5px solid var(--line-2);border-radius:12px;overflow:hidden}
.bar{display:flex;align-items:center;gap:12px;padding:0 16px 0 82px;height:58px;flex:0 0 auto;border-bottom:1px solid var(--line);-webkit-app-region:drag}
.glass{width:20px;height:20px;flex:0 0 auto;color:var(--faint)}
.q{flex:1 1 auto;min-width:0;height:100%;border:0;background:transparent;color:var(--ink);font:400 20px/1 var(--sans);outline:0;-webkit-app-region:no-drag}
.q::placeholder{color:var(--faint)}
.scopes{display:inline-flex;gap:2px;padding:3px;border-radius:8px;background:rgba(233,220,196,0.05);-webkit-app-region:no-drag}
.scope{border:0;border-radius:6px;background:transparent;color:var(--dim);padding:5px 9px;font:700 10.5px/1 var(--mono);letter-spacing:0.04em;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.scope:hover{color:var(--ink)}
.scope.active{background:rgba(233,220,196,0.1);color:var(--ink)}
.recovery{display:flex;align-items:center;gap:10px;min-height:52px;flex:0 0 auto;padding:8px 14px;border-bottom:1px solid rgba(217,79,57,0.2);background:linear-gradient(90deg,rgba(217,79,57,0.16),rgba(217,79,57,0.07));-webkit-app-region:no-drag}
.recovery[hidden]{display:none}
.recovery-icon{display:grid;place-items:center;width:28px;height:28px;flex:0 0 auto;border:1px solid rgba(217,79,57,0.3);border-radius:8px;background:rgba(217,79,57,0.13);color:#f09a86;font:800 19px/1 var(--sans)}
.recovery-copy{display:flex;min-width:0;flex:1 1 auto;flex-direction:column;gap:3px}
.recovery-copy b{overflow:hidden;color:#f0dfc5;font:700 12.5px/1.2 var(--sans);text-overflow:ellipsis;white-space:nowrap}
.recovery-copy span{overflow:hidden;color:#b9aa8d;font:600 10.5px/1.2 var(--mono);text-overflow:ellipsis;white-space:nowrap}
.recovery-restore{flex:0 0 auto;border:1px solid rgba(217,79,57,0.46);border-radius:7px;background:rgba(217,79,57,0.2);color:#ffb09d;padding:7px 10px;font:800 11px/1 var(--mono);cursor:pointer}
.recovery-restore:hover{border-color:rgba(240,127,101,0.7);background:rgba(217,79,57,0.3);color:#ffd0c4}
.recovery-restore:disabled{cursor:default;opacity:.68}
.recovery-restore:focus-visible{outline:2px solid rgba(217,79,57,0.5);outline-offset:2px}
.recovery.ready{border-bottom-color:rgba(124,207,136,0.14);background:linear-gradient(90deg,rgba(124,207,136,0.1),rgba(124,207,136,0.035))}
.recovery.ready .recovery-icon{border-color:rgba(124,207,136,0.25);background:rgba(124,207,136,0.1);color:#a8dcb0}
.recovery.ready .recovery-restore{border-color:rgba(124,207,136,0.18);background:rgba(124,207,136,0.07);color:#9fc5a4}
.workspace{position:relative;display:flex;flex:1 1 auto;min-height:0;overflow:hidden}
.list{flex:1 1 auto;min-width:0;max-width:100%;min-height:0;overflow-y:auto;padding:8px;scrollbar-width:thin;scrollbar-color:rgba(233,220,196,0.2) transparent;transition:flex-basis .18s ease,max-width .18s ease}
.peek-open .list{flex:0 0 55%;max-width:55%}
.peek{display:flex;flex:0 0 0;min-width:0;height:100%;overflow:hidden;flex-direction:column;border-left:1px solid transparent;background:rgba(18,13,8,0.68);opacity:0;transform:translateX(18px);pointer-events:none;transition:flex-basis .18s ease,opacity .16s ease,transform .18s ease,border-color .18s ease}
.peek-open .peek{flex-basis:45%;border-left-color:var(--line-2);opacity:1;transform:translateX(0);pointer-events:auto}
.list::-webkit-scrollbar{width:10px}
.list::-webkit-scrollbar-thumb{background:rgba(233,220,196,0.16);background-clip:content-box;border:3px solid transparent;border-radius:99px}
.sectlabel{padding:8px 12px 6px;color:var(--faint);font:700 10px/1 var(--mono);letter-spacing:0.14em;text-transform:uppercase}
.row{position:relative;display:grid;grid-template-columns:26px minmax(0,1fr) max-content;align-items:center;gap:12px;padding:9px 28px 9px 12px;border-radius:9px;cursor:pointer;transition:background-color .12s ease,box-shadow .12s ease}
.row:hover{background:var(--row-hover)}
.row.sel{background:var(--seal-soft);box-shadow:inset 3px 0 0 var(--seal)}
.badge{display:grid;place-items:center;width:26px;height:26px;border-radius:7px;font:800 11px/1 var(--mono);color:#fff}
.badge.codex{background:linear-gradient(180deg,#3a2f1d,#2a2214);color:#e6d9bd;border:1px solid rgba(233,220,196,0.18)}
.badge.claude{background:linear-gradient(180deg,#7a3a1f,#5e2c17);color:#f4dcc4}
.rc{min-width:0;overflow:hidden}
.rt{overflow:hidden;color:var(--ink);font:500 14px/1.3 var(--sans);text-overflow:ellipsis;white-space:nowrap}
.rs{overflow:hidden;margin-top:2px;color:var(--dim);font:500 11.5px/1.3 var(--mono);text-overflow:ellipsis;white-space:nowrap}
.rs mark{color:#ffd7a0;font-weight:700;background:rgba(217,79,57,0.26);border-radius:3px;padding:0 2px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.racc{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;color:var(--faint);font:600 11px/1 var(--mono);white-space:nowrap}
.age{color:var(--faint)}
.rowhint{max-width:130px;overflow:hidden;border:1px solid rgba(217,79,57,0.3);border-radius:7px;background:rgba(217,79,57,0.1);color:var(--seal);opacity:0;pointer-events:none;font:700 11px/1 var(--mono);padding:5px 8px;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;transition:opacity .12s ease,background-color .12s ease,border-color .12s ease}
.row.sel .rowhint,.row:hover .rowhint{opacity:1;pointer-events:auto}
.rowhint:hover{border-color:rgba(217,79,57,0.55);background:rgba(217,79,57,0.22)}
.rowhint:focus-visible{outline:2px solid rgba(217,79,57,0.5);outline-offset:2px}
.row .rowhint.resuming{opacity:1;pointer-events:none;cursor:default}
.rowhint .spin{width:10px;height:10px;margin-right:5px;border-width:1.5px;border-top-color:var(--seal);vertical-align:-1px}
.peekchev{position:absolute;right:10px;top:50%;color:#efcfb7;font:800 20px/1 var(--sans);opacity:0;transform:translateY(-50%) translateX(-2px);transition:opacity .12s ease,transform .12s ease}
.row.sel .peekchev{opacity:.82;transform:translateY(-50%) translateX(0)}
.live-chip{display:inline-flex;align-items:center;gap:5px;height:19px;padding:0 7px;border:1px solid rgba(124,207,136,0.24);border-radius:99px;background:var(--live-soft);color:#bfe6c4;font:800 10px/1 var(--mono)}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--live);box-shadow:0 0 0 0 rgba(124,207,136,0.36);animation:livepulse 2.2s ease-out infinite}
@keyframes livepulse{0%{box-shadow:0 0 0 0 rgba(124,207,136,0.32)}70%{box-shadow:0 0 0 6px rgba(124,207,136,0)}100%{box-shadow:0 0 0 0 rgba(124,207,136,0)}}
.actions{display:inline-flex;align-items:center;gap:5px;opacity:0;pointer-events:none;transform:translateX(3px);transition:opacity .12s ease,transform .12s ease}
.row.sel .actions,.row:hover .actions{opacity:1;pointer-events:auto;transform:translateX(0)}
.qact{display:grid;place-items:center;width:24px;height:24px;border:1px solid rgba(233,220,196,0.12);border-radius:7px;background:rgba(233,220,196,0.06);color:#d7caa9;cursor:pointer}
.qact:hover{border-color:rgba(233,220,196,0.24);background:rgba(233,220,196,0.11);color:var(--ink)}
.qact:focus-visible{outline:2px solid rgba(217,79,57,0.5);outline-offset:2px}
.qact svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.qact.pinact{font:700 13px/1 var(--sans)}
.qact.pinact.active{border-color:rgba(255,211,107,0.34);background:rgba(255,211,107,0.12)}
.pin-marker{display:inline-grid;place-items:center;width:17px;height:17px;flex:0 0 auto;font-size:10.5px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.35))}
.freq-marker{display:inline-grid;place-items:center;width:14px;height:14px;flex:0 0 auto;color:#ffd36b;font-size:10px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.38))}
.note-marker{position:relative;display:inline-block;width:14px;height:15px;flex:0 0 auto;border:1px solid rgba(233,220,196,0.25);border-radius:3px;background:rgba(233,220,196,0.08);box-shadow:inset 0 1px 0 rgba(255,255,255,0.08),0 1px 2px rgba(0,0,0,0.28)}
.note-marker::before{position:absolute;left:3px;right:3px;top:4px;height:1px;background:#d7caa9;box-shadow:0 3px 0 rgba(215,202,169,0.72),0 6px 0 rgba(215,202,169,0.42);content:""}
.note-marker::after{position:absolute;right:1px;top:1px;width:4px;height:4px;border-left:1px solid rgba(233,220,196,0.22);border-bottom:1px solid rgba(233,220,196,0.22);background:rgba(217,79,57,0.18);content:""}
.empty{display:grid;place-items:center;height:100%;min-height:180px;padding:28px;color:var(--faint);font:600 13px/1.5 var(--mono);text-align:center}
.spin{width:15px;height:15px;border:2px solid rgba(233,220,196,0.2);border-top-color:var(--seal);border-radius:99px;animation:sp .8s linear infinite;margin-right:8px;display:inline-block;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
.peek-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex:0 0 auto;padding:13px 12px 10px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(233,220,196,0.055),rgba(233,220,196,0))}
.peek-headtext{min-width:0}
.peek-title{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:var(--ink);font:700 13px/1.28 var(--sans)}
.peek-meta{overflow:hidden;margin-top:4px;color:var(--dim);font:700 10.5px/1.25 var(--mono);text-overflow:ellipsis;white-space:nowrap}
.peek-close{display:grid;place-items:center;flex:0 0 auto;width:24px;height:24px;border:1px solid rgba(233,220,196,0.12);border-radius:7px;background:rgba(233,220,196,0.05);color:var(--dim);font:700 18px/1 var(--sans);cursor:pointer}
.peek-close:hover{border-color:rgba(233,220,196,0.22);background:rgba(233,220,196,0.1);color:var(--ink)}
.peek-close:focus-visible{outline:2px solid rgba(217,79,57,0.5);outline-offset:2px}
.peek-body{display:flex;flex:1 1 auto;min-height:0;overflow-y:auto;flex-direction:column;gap:8px;padding:10px 11px 14px;scrollbar-width:thin;scrollbar-color:rgba(233,220,196,0.18) transparent}
.peek-body::-webkit-scrollbar{width:9px}
.peek-body::-webkit-scrollbar-thumb{background:rgba(233,220,196,0.14);background-clip:content-box;border:3px solid transparent;border-radius:99px}
.peek-state{display:flex;align-items:center;justify-content:center;gap:8px;min-height:108px;color:var(--dim);font:700 12px/1.35 var(--mono);text-align:center}
.peek-state .spin{width:12px;height:12px;margin-right:0;border-width:1.5px}
.peek-state.err{color:#e9b0a4}
.peek-turn{display:block;flex:0 0 auto;max-width:94%;border:1px solid rgba(233,220,196,0.1);border-radius:8px;background:rgba(233,220,196,0.045);color:#e6d9bd;font:500 12px/1.42 var(--sans);white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;padding:8px 10px}
.peek-turn.user{align-self:flex-end;border-right:3px solid var(--seal);background:rgba(217,79,57,0.12);border-top-right-radius:3px}
.peek-turn.assistant{align-self:flex-start;border-left:3px solid rgba(233,220,196,0.34);border-top-left-radius:3px}
.foot{display:flex;align-items:center;justify-content:space-between;gap:12px;height:42px;flex:0 0 auto;padding:0 14px;border-top:1px solid var(--line-2);background:linear-gradient(0deg,rgba(14,10,6,0.62),rgba(14,10,6,0.16));-webkit-app-region:drag}
.brand{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;color:#c3b596;font:700 11px/1 var(--mono);letter-spacing:0.03em}
.mark{width:18px;height:18px;border-radius:5px}
.ambient{display:inline-flex;align-items:center;gap:10px;flex:0 0 auto;min-width:0;color:var(--dim);font:700 10.5px/1 var(--mono);white-space:nowrap;-webkit-app-region:no-drag}
.ambient[hidden]{display:none}
.quota-meters{display:inline-flex;align-items:center;gap:7px;min-width:0}
.quota-meter{display:inline-flex;align-items:center;gap:4px;color:var(--faint)}
.quota-label{color:#a99b7f;font-weight:800}
.quota-track{width:34px;height:4px;overflow:hidden;border-radius:99px;background:rgba(233,220,196,0.11);box-shadow:inset 0 0 0 1px rgba(233,220,196,0.05)}
.quota-fill{display:block;height:100%;border-radius:inherit;background:#7ccf88}
.quota-meter.warn .quota-fill{background:#d7a247}
.quota-meter.danger .quota-fill{background:#dc604b}
.quota-pct{min-width:24px;color:#bbae91;text-align:right}
.ambient-live{display:inline-flex;align-items:center;gap:5px;height:22px;border:1px solid rgba(124,207,136,0.2);border-radius:99px;background:rgba(124,207,136,0.1);color:#bfe6c4;padding:0 8px;font:800 10.5px/1 var(--mono);cursor:pointer;appearance:none;-webkit-appearance:none}
.ambient-live:hover{border-color:rgba(124,207,136,0.32);background:rgba(124,207,136,0.15);color:#d5f0d8}
.ambient-live:focus-visible{outline:2px solid rgba(124,207,136,0.46);outline-offset:2px}
.hint{display:flex;align-items:center;justify-content:flex-end;flex:1 1 auto;min-width:0;overflow:hidden;color:#cdc0a1;font:600 11.5px/1 var(--mono);white-space:nowrap}
.hint .stat{min-width:0;overflow:hidden;color:var(--dim);text-overflow:ellipsis}
.hint .sep{color:rgba(233,220,196,0.26);margin:0 7px;font-style:normal}
.hint .act{color:var(--seal);font-weight:800}
.hint kbd{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:20px;margin-right:6px;padding:0 6px;border:1px solid rgba(233,220,196,0.24);border-top-color:rgba(255,255,255,0.28);border-radius:6px;background:linear-gradient(180deg,rgba(233,220,196,0.16),rgba(233,220,196,0.08));color:#efe3c5;font:700 11px/1 var(--mono);box-shadow:inset 0 1px 0 rgba(255,255,255,0.12),0 1px 2px rgba(0,0,0,0.4);vertical-align:-4px}
.toast{position:fixed;left:50%;bottom:52px;transform:translateX(-50%);z-index:9;max-width:86vw;border:1px solid var(--line-2);border-left:3px solid var(--seal);border-radius:9px;background:rgba(30,23,15,0.95);color:var(--ink);padding:10px 14px;font:600 12.5px/1.4 var(--sans);box-shadow:0 20px 50px -24px #000}
.toast .spin{width:12px;height:12px;margin-right:8px;border-width:2px;vertical-align:-2px}
.toast[hidden]{display:none}
.toast.err{border-left-color:#e0563b}
.shortcuts{position:fixed;inset:0;z-index:8;display:grid;place-items:center;background:rgba(5,4,3,0.18);backdrop-filter:blur(1.5px)}
.shortcuts[hidden]{display:none}
.shortcuts-card{width:min(360px,calc(100vw - 42px));border:1px solid var(--line-2);border-radius:12px;background:rgba(30,23,15,0.96);box-shadow:0 26px 70px -32px #000;padding:16px 18px 18px}
.shortcuts-title{margin-bottom:12px;color:var(--ink);font:800 12px/1 var(--mono);letter-spacing:0.12em}
.shortcut-list{display:grid;grid-template-columns:72px minmax(0,1fr);gap:9px 16px;align-items:center}
.shortcut-list span{display:inline-flex;align-items:center;justify-content:center;min-height:22px;border:1px solid rgba(233,220,196,0.2);border-radius:7px;background:rgba(233,220,196,0.07);color:#eadfc6;font:800 11px/1 var(--mono)}
.shortcut-list b{min-width:0;color:var(--dim);font:700 12px/1.25 var(--sans)}
@media (max-width:680px){
  .peek-open .list{flex:1 1 auto;max-width:100%}
  .peek{position:absolute;top:0;right:0;bottom:0;z-index:4;width:min(84vw,350px);height:auto;box-shadow:-18px 0 42px -26px #000;transform:translateX(22px)}
  .peek-open .peek{flex-basis:auto;transform:translateX(0)}
}
@media (max-width:760px){
  .quota-meters{display:none}
}
@media (prefers-reduced-motion:reduce){
  .spin,.live-dot{animation:none}
  .row,.scope,.rowhint,.actions,.list,.peek,.peekchev{transition:none}
}
`;
}

function launcherJs() {
  return `
const $=(id)=>document.getElementById(id);
const esc=(v)=>String(v==null?"":v).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const SCOPES=["all","codex","claude"];
const SCOPE_LABELS={all:"全部",codex:"Codex",claude:"Claude"};
const state={items:[],sel:0,scope:"all",query:"",mode:"recent",token:0,loading:false,searchMs:0,matched:0,searchFailed:false,pinnedPrefs:[],pinnedSet:new Set(),accessPrefs:{},projectPrefs:{},noteRefs:new Set(),notePreviews:{},pinnedCount:0,liveCount:0,recentCount:0,quota:null,ambientLiveCount:0,shortcutsOpen:false,previewOpen:false,previewLoading:false,previewError:false,previewKey:"",previewData:null,previewToken:0,resumingRef:""};
let timer=0;
let ambientTimer=0;
let ambientToken=0;
let previewTimer=0;
let pruneQueue=Promise.resolve();
const AMBIENT_REFRESH_MS=60000;
const RECENT_WATERMARK_POLL_MS=8000;
const RECENT_WATERMARK_JITTER_MS=2000;
const RECENT_WATERMARK_BACKOFF_MS=30000;
const PEEK_CACHE_MAX=10;
const peekCache=new Map();
const recentFreshness={started:false,timer:0,polling:false,refreshing:false,errors:0,watermark:null};

function relTime(v){
  if(!v) return "";
  const t=new Date(v).getTime(); if(!t) return "";
  const s=Math.max(0,(Date.now()-t)/1000);
  if(s<60) return "刚刚";
  if(s<3600) return Math.floor(s/60)+" 分钟";
  if(s<86400) return Math.floor(s/3600)+" 小时";
  if(s<86400*30) return Math.floor(s/86400)+" 天";
  return new Date(t).toISOString().slice(0,10);
}
function engineKey(it){ const e=(it.engine||"").toLowerCase(); return e==="claude"?e:"codex"; }
function badgeChar(k){ return k==="codex"?"C":"◇"; }
function bareSessionId(it){
  const id=String(it&&it.id||"").trim();
  if(id) return id;
  const ref=String(it&&it.ref||"");
  const match=/^codex:(home-[0-9a-f]{12}):(.+)$/.exec(ref);
  if(match) return match[2];
  return ref.replace(/^(codex|claude):/,"");
}
function sessionKey(it){
  const ref=String(it&&it.ref||"").trim();
  if(ref) return ref;
  const id=bareSessionId(it);
  return id?engineKey(it)+":"+id:"";
}
function isCompleteItem(it){
  if(!it) return true;
  if(it.complete===true) return true;
  if(it.complete===false) return false;
  const k=engineKey(it);
  const count=Number(it.messageCount);
  if(Number.isFinite(count)) return count>0;
  if(k==="claude") return it.sourceKind==="transcript" && it.historyOnly!==true;
  return true;
}
function isLiveCandidate(it){
  if(!it) return false;
  if(it.live===true) return true;
  if(it.live===false) return false;
  if(it.complete===false) return true;
  if(it.complete===true) return false;
  return !isCompleteItem(it);
}
function isRunning(it){ return !!(it && (it._live===true || it.live===true || it.complete===false)); }

function showToast(msg,err,loading){
  const el=$("toast");
  if(loading) el.innerHTML="<span class='spin'></span>"+esc(msg);
  else el.textContent=msg;
  el.classList.toggle("err",!!err); el.hidden=false;
  clearTimeout(showToast._t);
  if(!loading) showToast._t=setTimeout(()=>{el.hidden=true;},3600);
}

function renderSessionRecovery(value){
  const section=$("recovery");
  const button=$("recoveryRestore");
  const title=$("recoveryTitle");
  const subtitle=$("recoverySubtitle");
  const count=Math.max(0,Math.floor(Number(value&&value.count)||0));
  const restoring=!!(value&&value.restoring);
  section.hidden=false;
  section.classList.toggle("ready",count===0);
  title.textContent=count>0?"发现 "+count+" 个异常中断的会话":"崩溃恢复已开启";
  subtitle.textContent=count>0?"恢复电脑重启前仍在运行的 Session":"异常重启后，可在这里一键恢复 Session";
  button.disabled=restoring||count===0;
  button.innerHTML=restoring?"<span class='spin'></span>恢复中…":"全部恢复";
  if(count===0) button.textContent="暂无可恢复";
}

async function initializeSessionRecovery(){
  const desktop=window.agentSnapshotsDesktop;
  if(!desktop || typeof desktop.getSessionRecovery!=="function") return;
  try{
    renderSessionRecovery(await desktop.getSessionRecovery());
    if(typeof desktop.onSessionRecoveryChanged==="function"){
      desktop.onSessionRecoveryChanged(renderSessionRecovery);
    }
  }catch(e){
    renderSessionRecovery(null);
  }
}

async function restoreInterruptedSessions(){
  const desktop=window.agentSnapshotsDesktop;
  if(!desktop || typeof desktop.restoreInterruptedSessions!=="function") return;
  showToast("正在恢复异常中断的 Session…",false,true);
  try{
    const result=await desktop.restoreInterruptedSessions();
    renderSessionRecovery({count:result&&result.remaining,restoring:false});
    const restored=Math.max(0,Number(result&&result.restored)||0);
    const failed=Math.max(0,Number(result&&result.failed)||0);
    if(failed>0) showToast("已恢复 "+restored+" 个，"+failed+" 个失败，可点击重试",true);
    else showToast("已恢复 "+restored+" 个 Session",false);
    setTimeout(()=>{run();refreshAmbientStatus();},800);
  }catch(e){
    showToast(String(e&&e.message||e||"恢复失败"),true);
    initializeSessionRecovery();
  }
}

function schedule(){
  clearTimeout(timer);
  timer=setTimeout(run,140);
}

function jitteredRecentWatermarkDelay(baseMs){
  const base=Math.max(1000,Number(baseMs)||RECENT_WATERMARK_POLL_MS);
  const jitter=(Math.random()*2-1)*RECENT_WATERMARK_JITTER_MS;
  return Math.max(1000,Math.round(base+jitter));
}

function shouldPollRecentWatermark(){
  return !document.hidden && state.mode==="recent" && !$("q").value.trim() && !state.previewOpen;
}

function scheduleRecentWatermarkPoll(baseDelay){
  clearTimeout(recentFreshness.timer);
  if(document.hidden) return;
  recentFreshness.timer=setTimeout(pollRecentWatermark,jitteredRecentWatermarkDelay(baseDelay));
}

function startRecentWatermarkPolling(){
  if(recentFreshness.started) return;
  recentFreshness.started=true;
  scheduleRecentWatermarkPoll(RECENT_WATERMARK_POLL_MS);
}

async function fetchRecentWatermark(){
  const response=await fetch("/api/sessions-watermark");
  const payload=await response.json();
  if(!response.ok) throw new Error(payload.error||"watermark failed");
  return String(payload.watermark??"");
}

async function pollRecentWatermark(){
  if(!shouldPollRecentWatermark()){
    scheduleRecentWatermarkPoll(recentFreshness.errors>=3?RECENT_WATERMARK_BACKOFF_MS:RECENT_WATERMARK_POLL_MS);
    return;
  }
  if(recentFreshness.polling){
    scheduleRecentWatermarkPoll(recentFreshness.errors>=3?RECENT_WATERMARK_BACKOFF_MS:RECENT_WATERMARK_POLL_MS);
    return;
  }
  recentFreshness.polling=true;
  try{
    const watermark=await fetchRecentWatermark();
    if(recentFreshness.watermark!==null && watermark!==recentFreshness.watermark){
      const refreshed=await refreshRecentInPlace();
      if(!refreshed) return;
    }
    recentFreshness.watermark=watermark;
    recentFreshness.errors=0;
  }catch(e){
    recentFreshness.errors+=1;
  }finally{
    recentFreshness.polling=false;
    scheduleRecentWatermarkPoll(recentFreshness.errors>=3?RECENT_WATERMARK_BACKOFF_MS:RECENT_WATERMARK_POLL_MS);
  }
}

async function refreshRecentInPlace(){
  if(recentFreshness.refreshing || state.loading || !shouldPollRecentWatermark()) return false;
  recentFreshness.refreshing=true;
  const selectedRef=sessionKey(state.items[state.sel]);
  const scope=state.scope;
  try{
    const src=scope==="all"?"all":scope;
    const prefs=await fetchLauncherPrefs();
    if(!shouldPollRecentWatermark() || state.scope!==scope) return false;
    setLauncherPrefs(prefs);
    const liveParams=new URLSearchParams({limit:"40",completeOnly:"0",liveOnly:"1",source:src});
    const recentParams=new URLSearchParams({limit:"40",completeOnly:"1",source:src});
    const [pinnedResult,liveResult,recentResult]=await Promise.allSettled([
      resolvePinnedRows(prefs.pinned,src),
      fetch("/api/sessions?"+liveParams.toString()).then(x=>x.json()),
      fetch("/api/sessions?"+recentParams.toString()).then(x=>x.json())
    ]);
    if(!shouldPollRecentWatermark() || state.scope!==scope) return false;
    if(liveResult.status==="rejected" && recentResult.status==="rejected") throw liveResult.reason || recentResult.reason;
    const pinnedRows=pinnedResult.status==="fulfilled" && Array.isArray(pinnedResult.value)?pinnedResult.value:[];
    const liveRows=liveResult.status==="fulfilled" && Array.isArray(liveResult.value)?liveResult.value:[];
    const recentRows=recentResult.status==="fulfilled" && Array.isArray(recentResult.value)?recentResult.value:[];
    const merged=mergeRecent(pinnedRows,liveRows,recentRows);
    state.items=merged.items;
    state.pinnedCount=merged.pinnedCount;
    state.liveCount=merged.liveCount;
    state.recentCount=merged.recentCount;
    const nextIndex=selectedRef?state.items.findIndex((item)=>sessionKey(item)===selectedRef):-1;
    state.sel=nextIndex>=0?nextIndex:0;
    render();
    return true;
  }finally{
    recentFreshness.refreshing=false;
  }
}

async function fetchLauncherPrefs(){
  try{
    const r=await fetch("/api/launcher-prefs").then(x=>x.ok?x.json():null);
    return normalizeLauncherPrefs(r);
  }catch(e){
    return normalizeLauncherPrefs(null);
  }
}

function normalizeLauncherPrefs(prefs){
  return {
    pinned:normalizePinnedPrefs(prefs&&prefs.pinned),
    accesses:normalizeUsagePrefs(prefs&&prefs.accesses),
    projects:normalizeUsagePrefs(prefs&&prefs.projects),
    noteRefs:normalizeNoteRefs(prefs&&prefs.noteRefs),
    notePreviews:normalizeNotePreviews(prefs&&prefs.notePreviews)
  };
}

function normalizePinnedPrefs(pinned){
  if(!Array.isArray(pinned)) return [];
  const out=[];
  const seen=new Set();
  for(const item of pinned){
    const ref=String(item&&item.ref||"").trim();
    const engine=String(item&&item.engine||"").trim().toLowerCase();
    if(!ref || !["codex","claude"].includes(engine) || seen.has(ref)) continue;
    out.push({ref,engine,pinnedAt:String(item&&item.pinnedAt||"")});
    seen.add(ref);
  }
  return out;
}

function setPinnedPrefs(pinned){
  state.pinnedPrefs=normalizePinnedPrefs(pinned);
  state.pinnedSet=new Set(state.pinnedPrefs.map((item)=>item.ref));
}

function setLauncherPrefs(prefs){
  const normalized=normalizeLauncherPrefs(prefs);
  state.accessPrefs=normalized.accesses;
  state.projectPrefs=normalized.projects;
  state.noteRefs=new Set(normalized.noteRefs);
  state.notePreviews=normalized.notePreviews;
  setPinnedPrefs(normalized.pinned);
}

function normalizeUsagePrefs(records){
  const out={};
  if(!records || typeof records!=="object" || Array.isArray(records)) return out;
  for(const key of Object.keys(records)){
    const item=records[key];
    const count=Math.max(0,Math.floor(Number(item&&item.count)||0));
    const last=String(item&&item.last||"");
    if(!key || count<=0 || !Number.isFinite(new Date(last).getTime())) continue;
    out[key]={count,last};
  }
  return out;
}

function normalizeNoteRefs(refs){
  if(!Array.isArray(refs)) return [];
  const out=[];
  const seen=new Set();
  for(const value of refs){
    const ref=String(value||"").trim();
    if(!ref || seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out;
}

function normalizeNotePreviews(records){
  const out={};
  if(!records || typeof records!=="object" || Array.isArray(records)) return out;
  for(const key of Object.keys(records)){
    const ref=String(key||"").trim();
    if(!ref) continue;
    out[ref]=Array.from(String(records[key]||"").replace(/\\s+/g," ").trim()).slice(0,80).join("");
  }
  return out;
}

function isPinnedItem(it){
  const key=sessionKey(it);
  return !!key && (it&&it._pinned===true || state.pinnedSet.has(key));
}

async function resolvePinnedRows(pinned,source){
  const wanted=normalizePinnedPrefs(pinned).filter((item)=>source==="all"||item.engine===source);
  if(!wanted.length) return [];
  const params=new URLSearchParams({all:"1",completeOnly:"0",source});
  const response=await fetch("/api/sessions?"+params.toString());
  if(!response.ok) return [];
  const rows=await response.json();
  if(!Array.isArray(rows)) return [];
  const byKey=new Map();
  for(const item of rows){
    const key=sessionKey(item);
    if(key && !byKey.has(key)) byKey.set(key,item);
  }
  const ordered=wanted.slice().sort((a,b)=>new Date(b.pinnedAt||0).getTime()-new Date(a.pinnedAt||0).getTime());
  const resolved=[];
  const missing=[];
  for(const pin of ordered){
    const item=byKey.get(pin.ref);
    if(item) resolved.push(Object.assign({},item,{_pinned:true,_pinnedAt:pin.pinnedAt}));
    else missing.push(pin);
  }
  if(missing.length) pruneMissingPinnedRefs(missing);
  return resolved;
}

function pruneMissingPinnedRefs(missing){
  const unique=[];
  const seen=new Set();
  for(const pin of missing){
    if(!pin||!pin.ref||seen.has(pin.ref)) continue;
    seen.add(pin.ref);
    unique.push(pin);
  }
  if(!unique.length) return;
  pruneQueue=pruneQueue.catch(()=>{}).then(async()=>{
    for(const pin of unique){
      const next=await savePinPreference(pin.ref,pin.engine,false).catch(()=>null);
      if(next) setPinnedPrefs(next);
    }
  });
}

async function run(){
  const q=$("q").value.trim();
  state.query=q;
  const token=++state.token;
  state.loading=true;
  state.searchMs=0;
  state.matched=0;
  state.searchFailed=false;
  state.pinnedCount=0;
  state.liveCount=0;
  state.recentCount=0;
  if(!q){
    state.mode="recent";
    render(true);
    try{
      const src=state.scope==="all"?"all":state.scope;
      const prefs=await fetchLauncherPrefs();
      if(token!==state.token) return;
      setLauncherPrefs(prefs);
      const liveParams=new URLSearchParams({limit:"40",completeOnly:"0",liveOnly:"1",source:src});
      const recentParams=new URLSearchParams({limit:"40",completeOnly:"1",source:src});
      const [pinnedResult,liveResult,recentResult]=await Promise.allSettled([
        resolvePinnedRows(prefs.pinned,src),
        fetch("/api/sessions?"+liveParams.toString()).then(x=>x.json()),
        fetch("/api/sessions?"+recentParams.toString()).then(x=>x.json())
      ]);
      if(token!==state.token) return;
      if(liveResult.status==="rejected" && recentResult.status==="rejected") throw liveResult.reason || recentResult.reason;
      const pinnedRows=pinnedResult.status==="fulfilled" && Array.isArray(pinnedResult.value)?pinnedResult.value:[];
      const liveRows=liveResult.status==="fulfilled" && Array.isArray(liveResult.value)?liveResult.value:[];
      const recentRows=recentResult.status==="fulfilled" && Array.isArray(recentResult.value)?recentResult.value:[];
      const merged=mergeRecent(pinnedRows,liveRows,recentRows);
      state.items=merged.items;
      state.pinnedCount=merged.pinnedCount;
      state.liveCount=merged.liveCount;
      state.recentCount=merged.recentCount;
    }catch(e){ if(token===state.token) state.items=[]; }
    if(token===state.token){ state.loading=false; state.sel=0; render(); scheduleRecentWatermarkPoll(RECENT_WATERMARK_POLL_MS); }
    return;
  }
  state.mode="search";
  state.items=[];
  state.sel=0;
  render(true);
  try{
    const started=performance.now();
    const p=new URLSearchParams({q,source:state.scope,limit:"40",includeTools:"1"});
    const [searchResult,prefsResult]=await Promise.allSettled([
      fetch("/api/search?"+p.toString(),{signal:AbortSignal.timeout(30000)}).then(x=>x.json()),
      fetchLauncherPrefs()
    ]);
    if(token!==state.token) return;
    if(prefsResult.status==="fulfilled") setLauncherPrefs(prefsResult.value);
    if(searchResult.status==="rejected") throw searchResult.reason;
    const r=searchResult.value;
    state.items=Array.isArray(r.results)?r.results:[];
    state.matched=Number(r.matched||state.items.length)||state.items.length;
    state.searchMs=Math.max(0,Math.round(performance.now()-started));
  }catch(e){ if(token===state.token){ state.items=[]; state.searchFailed=true; } }
  if(token===state.token){ state.loading=false; state.sel=0; render(); }
}

function mergeRecent(pinnedRows,liveRows,recentRows){
  const seen=new Set();
  const items=[];
  const recentCandidates=[];
  let pinnedCount=0;
  let liveCount=0;
  let recentCount=0;
  for(const item of pinnedRows){
    const key=sessionKey(item); if(key && seen.has(key)) continue;
    if(key) seen.add(key);
    items.push(Object.assign({},item,{_pinned:true}));
    pinnedCount+=1;
  }
  for(const item of liveRows){
    if(!isLiveCandidate(item)) continue;
    const key=sessionKey(item); if(key && seen.has(key)) continue;
    if(key) seen.add(key);
    items.push(Object.assign({},item,{_live:true}));
    liveCount+=1;
  }
  for(const item of recentRows){
    const key=sessionKey(item); if(key && seen.has(key)) continue;
    if(key) seen.add(key);
    recentCandidates.push(item);
  }
  for(const item of rankRecentRows(recentCandidates)){
    items.push(item);
    recentCount+=1;
  }
  return {items,pinnedCount,liveCount,recentCount};
}

function rankRecentRows(rows){
  const now=Date.now();
  const todayStart=new Date();
  todayStart.setHours(0,0,0,0);
  const todayMs=todayStart.getTime();
  const oldCutoff=now-7*86400000;
  return (rows||[]).map((item,index)=>{
    const mtime=sessionMtimeMs(item);
    const key=sessionKey(item);
    const cwd=String(item&& (item.cwd||item.displayCwd) || "").trim();
    const refBoost=decayedUsageBoost(state.accessPrefs[key],now,30*60000,4*3600000);
    const projectBoost=decayedUsageBoost(state.projectPrefs[cwd],now,20*60000,3*3600000);
    const boost=Math.min(6*3600000,refBoost+projectBoost);
    let score=mtime+boost;
    if(mtime>0 && mtime<oldCutoff && score>=todayMs) score=todayMs-1;
    return {
      item:Object.assign({},item,{_frecencyBoosted:boost>=60000,_frecencyScore:score}),
      index,
      mtime,
      score
    };
  }).sort((a,b)=>{
    if(b.score!==a.score) return b.score-a.score;
    if(b.mtime!==a.mtime) return b.mtime-a.mtime;
    return a.index-b.index;
  }).map((entry)=>entry.item);
}

function decayedUsageBoost(record,now,unitMs,maxMs){
  if(!record) return 0;
  const count=Math.max(0,Number(record.count)||0);
  const last=new Date(record.last||0).getTime();
  if(count<=0 || !Number.isFinite(last) || last<=0) return 0;
  const ageDays=Math.max(0,(now-last)/86400000);
  const weight=count*Math.exp(-ageDays/14);
  return Math.min(maxMs,weight*unitMs);
}

function sessionMtimeMs(it){
  const t=new Date(it&&it.mtime||0).getTime();
  return Number.isFinite(t)?t:0;
}

function normalizePercent(v){
  const n=Number(v);
  if(!Number.isFinite(n)) return NaN;
  const pct=n>=0 && n<=1?n*100:n;
  return Math.max(0,Math.min(100,pct));
}

function countLiveRows(rows){
  const seen=new Set();
  let count=0;
  for(const item of rows||[]){
    if(!isLiveCandidate(item)) continue;
    const key=sessionKey(item);
    if(key && seen.has(key)) continue;
    if(key) seen.add(key);
    count+=1;
  }
  return count;
}

function formatReset(v){
  if(!v) return "重置时间未知";
  const d=new Date(v);
  if(!Number.isFinite(d.getTime())) return "重置时间未知";
  const weekday=new Intl.DateTimeFormat("zh-CN",{weekday:"short"}).format(d);
  const time=new Intl.DateTimeFormat("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false}).format(d).replace(/^24:/,"00:");
  return weekday+" "+time+" 重置";
}

function freshnessText(v){
  const t=relTime(v);
  if(!t) return "快照时间未知";
  if(t==="刚刚") return "快照刚刚更新";
  if(/^\\d{4}-\\d{2}-\\d{2}$/.test(t)) return "快照 "+t+" 更新";
  return "快照 "+t+"前更新";
}

function quotaMeter(label,part,updatedAt){
  if(!part) return "";
  const pct=normalizePercent(part.usedPercent);
  if(!Number.isFinite(pct)) return "";
  const shown=Math.round(pct);
  const level=pct>85?"danger":pct>60?"warn":"ok";
  const title=label+" "+shown+"% · "+formatReset(part.resetsAt)+" · "+freshnessText(updatedAt);
  return "<span class='quota-meter "+level+"' title='"+esc(title)+"'>"+
    "<span class='quota-label'>"+esc(label)+"</span>"+
    "<span class='quota-track'><span class='quota-fill' style='width:"+shown+"%'></span></span>"+
    "<span class='quota-pct'>"+shown+"%</span>"+
  "</span>";
}

function quotaMeters(){
  const q=state.quota;
  if(!q || q.available===false) return "";
  const html=[
    quotaMeter("5h",q.primary,q.updatedAt),
    quotaMeter("周",q.secondary,q.updatedAt)
  ].filter(Boolean).join("");
  return html?"<span class='quota-meters'>"+html+"</span>":"";
}

function renderAmbient(){
  const el=$("ambient");
  const parts=[];
  const meters=quotaMeters();
  if(meters) parts.push(meters);
  if(state.ambientLiveCount>0){
    parts.push("<button class='ambient-live' data-ambient-action='live' type='button' title='显示进行中的会话' aria-label='显示进行中的会话'>"+
      "<span class='live-dot'></span><span>"+state.ambientLiveCount+" 进行中</span>"+
    "</button>");
  }
  if(!parts.length){
    el.hidden=true;
    el.innerHTML="";
    return;
  }
  el.hidden=false;
  el.innerHTML=parts.join("");
}

async function refreshAmbientStatus(){
  if(document.hidden) return;
  const token=++ambientToken;
  const liveParams=new URLSearchParams({limit:"100",completeOnly:"0",liveOnly:"1",source:"all"});
  const [quotaResult,liveResult]=await Promise.allSettled([
    fetch("/api/quota").then(x=>x.ok?x.json():null),
    fetch("/api/sessions?"+liveParams.toString()).then(x=>x.ok?x.json():[])
  ]);
  if(token!==ambientToken) return;
  if(quotaResult.status==="fulfilled" && quotaResult.value && quotaResult.value.available!==false) state.quota=quotaResult.value;
  else state.quota=null;
  if(liveResult.status==="fulfilled" && Array.isArray(liveResult.value)) state.ambientLiveCount=countLiveRows(liveResult.value);
  else state.ambientLiveCount=0;
  renderAmbient();
}

function scheduleAmbientRefresh(delay){
  clearTimeout(ambientTimer);
  if(document.hidden) return;
  ambientTimer=setTimeout(async()=>{
    await refreshAmbientStatus();
    scheduleAmbientRefresh(AMBIENT_REFRESH_MS);
  },delay);
}

function render(loading){
  state.loading=!!loading;
  const list=$("list");
  if(loading && !state.items.length){
    const text=state.mode==="search"?"正在搜索…":"正在载入…";
    list.innerHTML="<div class='empty'><span class='spin'></span> "+text+"</div>";
    updateHint(); syncPreviewAfterRender(); return;
  }
  if(state.sel>=state.items.length) state.sel=Math.max(0,state.items.length-1);
  if(!state.items.length){
    list.innerHTML="<div class='empty'>"+emptyMessage()+"</div>";
    updateHint(); syncPreviewAfterRender(); return;
  }
  let html="";
  if(state.mode==="recent"){
    const pinnedEnd=state.pinnedCount;
    const liveEnd=pinnedEnd+state.liveCount;
    if(!state.pinnedCount && !state.liveCount && !state.recentCount){
      html+="<div class='sectlabel'>最近 · "+state.items.length+"</div>";
      html+=state.items.map((it,i)=>row(it,i)).join("");
    }else if(state.pinnedCount>0){
      html+="<div class='sectlabel'>置顶 · "+state.pinnedCount+"</div>";
      for(let i=0;i<pinnedEnd;i++) html+=row(state.items[i],i);
    }
    if(state.liveCount>0){
      html+="<div class='sectlabel'>进行中 · "+state.liveCount+"</div>";
      for(let i=pinnedEnd;i<liveEnd;i++) html+=row(state.items[i],i);
    }
    if(state.recentCount>0){
      html+="<div class='sectlabel'>最近 · "+state.recentCount+"</div>";
      for(let i=liveEnd;i<state.items.length;i++) html+=row(state.items[i],i);
    }
  }else{
    const label=state.mode==="recent"?"最近 · "+state.items.length:searchLabel();
    html+="<div class='sectlabel'>"+esc(label)+"</div>";
    html+=state.items.map((it,i)=>row(it,i)).join("");
  }
  list.innerHTML=html;
  scrollSelected();
  updateHint();
  syncPreviewAfterRender();
}

function searchLabel(){
  const shown=state.items.length;
  const matched=state.matched||shown;
  return matched>shown?"结果 · "+shown+" / "+matched:"结果 · "+shown;
}

function emptyMessage(){
  const label=SCOPE_LABELS[state.scope]||"当前范围";
  if(state.query&&state.searchFailed) return "搜索失败或超时，请重试";
  if(state.query) return "没有匹配的 "+label+" 会话";
  if(state.scope==="codex") return "暂无 Codex 会话";
  if(state.scope==="claude") return "暂无 Claude 会话";
  return "暂无会话";
}

function row(it,i){
  const k=engineKey(it);
  const title=it.title||it.ref||"未命名会话";
  const origin=String(it&&it.codexHomeLabel||"").trim();
  const rowTitle=(it&&it._frecencyBoosted?"常用 · ":"")+title+(origin?" · Codex home: "+origin:"");
  const proj=(it.displayCwd||it.cwd||"").split("/").filter(Boolean).pop()||"";
  const snip=it.snippet?highlight(it.snippet,it.terms):"";
  const sub=[proj,relTime(it.mtime)].filter(Boolean).join(" · ");
  const subLine=state.mode==="search"&&snip?snip:esc(sub);
  const pinned=isPinnedItem(it);
  const key=sessionKey(it);
  const notePreview=key?String(state.notePreviews[key]||""):"";
  const noteMarker=key&&state.noteRefs.has(key)?"<span class='note-marker' title='"+esc(notePreview?"备注："+notePreview:"有备注")+"' aria-label='有备注'></span>":"";
  const pinMarker=pinned?"<span class='pin-marker' title='已置顶' aria-label='已置顶'>⭐</span>":"";
  const freqMarker=it&&it._frecencyBoosted?"<span class='freq-marker' title='常用' aria-label='常用'>⚡</span>":"";
  const live=isRunning(it)?"<span class='live-chip'><span class='live-dot'></span>进行中</span>":"";
  const pin=actionButton("pin",pinned?"取消置顶":"置顶","⭐","pinact"+(pinned?" active":""));
  const copy=actionButton("copy","复制恢复命令",iconCopy());
  const actions="<span class='actions'>"+pin+copy+actionButton("open","完整视图",iconOpen())+"</span>";
  return "<div class='row"+(i===state.sel?" sel":"")+"' data-i='"+i+"' title='"+esc(rowTitle)+"'>"+
    "<span class='badge "+k+"'>"+badgeChar(k)+"</span>"+
    "<div class='rc'><div class='rt'>"+esc(title)+"</div><div class='rs'>"+subLine+"</div></div>"+
    "<div class='racc'>"+noteMarker+pinMarker+freqMarker+live+"<span class='age'>"+esc(relTime(it.mtime))+"</span>"+resumeButton(it,key)+actions+"</div>"+
    "<span class='peekchev' aria-hidden='true'>›</span>"+
  "</div>";
}

function resumeButton(it,key){
  const resuming=!!state.resumingRef&&!!key&&state.resumingRef===key;
  return "<button class='rowhint"+(resuming?" resuming":"")+"' data-action='resume' type='button'"+(resuming?" disabled":"")+" title='在 Orca 继续该会话'>"+
    (resuming?"<span class='spin'></span>唤起中…":"Orca 继续")+"</button>";
}

function actionButton(action,title,icon,extraClass){
  const cls=("qact "+(extraClass||"")).trim();
  return "<button class='"+cls+"' data-action='"+action+"' type='button' title='"+esc(title)+"' aria-label='"+esc(title)+"'>"+icon+"</button>";
}
function iconCopy(){ return "<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='8' y='8' width='10' height='10' rx='2'></rect><path d='M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'></path></svg>"; }
function iconOpen(){ return "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M14 4h6v6'></path><path d='M10 14 20 4'></path><path d='M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4'></path></svg>"; }

function highlight(text,terms){
  const full=String(text||"");
  const needles=Array.from(new Set((terms||[]).map(t=>String(t||"").trim().toLowerCase()).filter(Boolean))).sort((a,b)=>b.length-a.length).slice(0,10);
  if(!needles.length) return esc(full.slice(0,180));
  const fullLow=full.toLowerCase();
  // Center the window on the FIRST match so the keyword is visible on the single
  // line (the row clips with an ellipsis; a match deep in a long tool-call would
  // otherwise be cut off). Keep a little context before it.
  let first=-1;
  for(const n of needles){ const i=fullLow.indexOf(n); if(i>=0 && (first<0||i<first)) first=i; }
  const start = first<0 ? 0 : Math.max(0, first-16);
  const src=full.slice(start,start+220);
  const low=src.toLowerCase();
  const marks=[];
  for(const n of needles){ let from=0,idx; while((idx=low.indexOf(n,from))>=0){ marks.push([idx,idx+n.length]); from=idx+n.length; } }
  marks.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const m of marks){ const last=merged[merged.length-1]; if(last&&m[0]<=last[1]) last[1]=Math.max(last[1],m[1]); else merged.push([m[0],m[1]]); }
  let out=start>0?"…":"",pos=0;
  for(const seg of merged){ out+=esc(src.slice(pos,seg[0]))+"<mark>"+esc(src.slice(seg[0],seg[1]))+"</mark>"; pos=seg[1]; }
  out+=esc(src.slice(pos));
  return out;
}

function projectName(it){
  return String(it&& (it.displayCwd||it.cwd) || "").split("/").filter(Boolean).pop()||"";
}

function peekCacheKey(it){
  const ref=sessionKey(it);
  return ref?ref+"|"+String(it&&it.mtime||""):"";
}

function readPeekCache(key){
  if(!key || !peekCache.has(key)) return null;
  const value=peekCache.get(key);
  peekCache.delete(key);
  peekCache.set(key,value);
  return value;
}

function rememberPeek(key,value){
  if(!key) return;
  if(peekCache.has(key)) peekCache.delete(key);
  peekCache.set(key,value);
  while(peekCache.size>PEEK_CACHE_MAX){
    const first=peekCache.keys().next().value;
    peekCache.delete(first);
  }
}

function openPreview(){
  if(!state.items.length) return;
  state.previewOpen=true;
  schedulePreviewLoad(0);
  updateHint();
}

function closePreview(){
  clearTimeout(previewTimer);
  state.previewOpen=false;
  state.previewLoading=false;
  state.previewError=false;
  state.previewToken+=1;
  renderPreview();
  updateHint();
}

function syncPreviewAfterRender(){
  if(state.previewOpen) schedulePreviewLoad(0);
  else renderPreview();
}

function schedulePreviewLoad(delay){
  clearTimeout(previewTimer);
  if(!state.previewOpen){ renderPreview(); return; }
  const it=state.items[state.sel];
  const key=peekCacheKey(it);
  if(!it || !key){
    state.previewKey="";
    state.previewData=null;
    state.previewLoading=false;
    state.previewError=false;
    renderPreview();
    return;
  }
  const cached=readPeekCache(key);
  if(cached){
    state.previewKey=key;
    state.previewData=cached;
    state.previewLoading=false;
    state.previewError=false;
    renderPreview();
    return;
  }
  state.previewKey=key;
  state.previewData=null;
  state.previewLoading=true;
  state.previewError=false;
  renderPreview();
  previewTimer=setTimeout(loadPreview,Math.max(0,Number(delay)||0));
}

async function loadPreview(){
  if(!state.previewOpen) return;
  const it=state.items[state.sel];
  const key=peekCacheKey(it);
  const ref=sessionKey(it);
  if(!it || !key || !ref) return;
  const token=++state.previewToken;
  try{
    const params=new URLSearchParams({id:ref,turns:"6"});
    const response=await fetch("/api/session-peek?"+params.toString());
    if(!response.ok) throw new Error("peek failed");
    const payload=await response.json();
    if(token!==state.previewToken || !state.previewOpen || peekCacheKey(state.items[state.sel])!==key) return;
    const data=normalizePeekPayload(payload,it);
    rememberPeek(key,data);
    state.previewData=data;
    state.previewLoading=false;
    state.previewError=false;
    renderPreview();
  }catch(e){
    if(token!==state.previewToken || !state.previewOpen || peekCacheKey(state.items[state.sel])!==key) return;
    state.previewData=null;
    state.previewLoading=false;
    state.previewError=true;
    renderPreview();
  }
}

function normalizePeekPayload(payload,it){
  const turns=Array.isArray(payload&&payload.turns)?payload.turns:[];
  return {
    title:String(payload&&payload.title||it&&it.title||it&&it.ref||"未命名会话"),
    project:String(payload&&payload.project||projectName(it)||""),
    mtime:String(payload&&payload.mtime||it&&it.mtime||""),
    turns:turns.map((turn)=>({
      role:String(turn&&turn.role||"assistant").toLowerCase()==="user"?"user":"assistant",
      text:peekTurnText(turn&&turn.text)
    })).filter((turn)=>turn.text.trim()).slice(-6)
  };
}

function peekTurnText(text){
  return String(text||"").replace(/\\r\\n/g,"\\n").replace(/\\r/g,"\\n");
}

function renderPreview(){
  const panel=$("peek");
  if(!panel) return;
  document.body.classList.toggle("peek-open",!!state.previewOpen);
  panel.setAttribute("aria-hidden",state.previewOpen?"false":"true");
  if(!state.previewOpen) return;
  const it=state.items[state.sel];
  const shellData=state.previewData || {
    title:it&&it.title||it&&it.ref||"会话预览",
    project:projectName(it),
    mtime:it&&it.mtime||"",
    turns:[]
  };
  if(!it){
    panel.innerHTML=renderPeekShell(shellData,"<div class='peek-state'>暂无可预览会话</div>");
    return;
  }
  if(state.previewError){
    panel.innerHTML=renderPeekShell(shellData,"<div class='peek-state err'>无法载入预览</div>");
    return;
  }
  if(state.previewLoading && !state.previewData){
    panel.innerHTML=renderPeekShell(shellData,"<div class='peek-state'><span class='spin'></span>载入预览</div>");
    return;
  }
  const turns=(state.previewData&&state.previewData.turns||[]).map(renderPeekTurn).join("");
  panel.innerHTML=renderPeekShell(shellData,turns||"<div class='peek-state'>暂无可预览对话</div>");
}

function renderPeekShell(data,body){
  const meta=[data&&data.project,relTime(data&&data.mtime)].filter(Boolean).join(" · ");
  return "<div class='peek-head'>"+
    "<div class='peek-headtext'><div class='peek-title'>"+esc(data&&data.title||"会话预览")+"</div><div class='peek-meta'>"+esc(meta)+"</div></div>"+
    "<button class='peek-close' data-peek-close='1' type='button' title='关闭预览' aria-label='关闭预览'>×</button>"+
  "</div><div class='peek-body'>"+body+"</div>";
}

function renderPeekTurn(turn){
  const role=turn.role==="user"?"user":"assistant";
  const label=role==="user"?"User":"Assistant";
  return "<div class='peek-turn "+role+"' aria-label='"+label+"'>"+esc(turn.text)+"</div>";
}

function updateHint(){
  const sep="<span class='sep'>·</span>";
  const status="<span class='stat'>"+esc(statusText())+"</span>";
  const primary="<span class='act'>点击 预览</span>"+sep+"<kbd>↵</kbd> 在 Orca 继续"+sep+"<kbd>⌘↵</kbd> 完整视图";
  const preview=state.previewOpen
    ? "<kbd>←</kbd> <span class='act'>关闭预览</span>"+sep+"<kbd>esc</kbd> 关闭预览"
    : "<kbd>→</kbd> 预览"+sep+"<kbd>⌘P</kbd> 预览";
  const escapeHint=state.previewOpen?"":sep+"<kbd>esc</kbd> 清除";
  $("hint").innerHTML=status+sep+primary+sep+preview+sep+"<kbd>↑↓</kbd> 选择"+sep+"<kbd>⌘/</kbd> 快捷键"+escapeHint;
}

function statusText(){
  if(state.loading) return state.mode==="search"?"正在搜索":"正在载入";
  if(state.mode==="search"){
    const shown=state.items.length;
    const matched=state.matched||shown;
    const count=matched>shown?shown+"/"+matched+" 条结果":shown+" 条结果";
    return state.searchMs?count+" · "+state.searchMs+" ms":count;
  }
  const parts=[];
  if(state.pinnedCount) parts.push(state.pinnedCount+" 置顶");
  if(state.liveCount) parts.push(state.liveCount+" 进行中");
  if(parts.length) return "共 "+state.items.length+" 条 · "+parts.join(" · ");
  return state.items.length+" 条最近";
}

function move(d){
  if(!state.items.length) return;
  state.sel=(state.sel+d+state.items.length)%state.items.length;
  for(const el of document.querySelectorAll(".row")){ el.classList.toggle("sel", Number(el.dataset.i)===state.sel); }
  scrollSelected();
  updateHint();
  if(state.previewOpen) schedulePreviewLoad(200);
}

function scrollSelected(){
  const sel=document.querySelector(".row.sel");
  if(sel) sel.scrollIntoView({block:"nearest",behavior:"smooth"});
}

function openFull(it){
  if(!it) return;
  touchLauncherAccess(it);
  window.open("/?session="+encodeURIComponent(it.ref||""),"_blank");
}

function touchLauncherAccess(it){
  const ref=sessionKey(it);
  if(!ref) return;
  fetch("/api/launcher-prefs/touch",{
    method:"POST",
    headers:{"content-type":"application/json","${MUTATION_CSRF_HEADER}":window.CSRF},
    body:JSON.stringify({ref,cwd:it.cwd||it.displayCwd||""}),
    keepalive:true
  }).catch(()=>{});
}

function resumeCommand(it){
  const k=engineKey(it);
  const id=bareSessionId(it);
  if(!id) return "";
  return k==="claude"?"claude --resume "+id:"codex resume --dangerously-bypass-approvals-and-sandbox "+id;
}

async function copyResumeCommand(it){
  const cmd=resumeCommand(it);
  if(!cmd) return;
  try{
    await copyText(cmd);
    showToast("已复制",false);
  }catch(e){
    showToast("复制失败",true);
  }
}

async function togglePin(it){
  const ref=sessionKey(it);
  const engine=engineKey(it);
  if(!ref){
    showToast("无法置顶该会话",true);
    return;
  }
  const next=!isPinnedItem(it);
  try{
    setPinnedPrefs(await savePinPreference(ref,engine,next));
    showToast(next?"已置顶":"已取消置顶",false);
    if(state.mode==="recent" && !state.query) run();
    else render();
  }catch(e){
    showToast(String(e&&e.message||e),true);
  }
}

async function savePinPreference(ref,engine,pinned){
  const r=await fetch("/api/launcher-prefs/pin",{
    method:"POST",
    headers:{"content-type":"application/json","${MUTATION_CSRF_HEADER}":window.CSRF},
    body:JSON.stringify({ref,engine,pinned})
  });
  const d=await r.json();
  if(!r.ok||!d.ok) throw new Error(d.error||"置顶失败");
  return d.pinned;
}

async function copyText(text){
  if(navigator.clipboard && window.isSecureContext){
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta=document.createElement("textarea");
  ta.value=text;
  ta.setAttribute("readonly","");
  ta.style.position="fixed";
  ta.style.left="-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok=document.execCommand("copy");
  ta.remove();
  if(!ok) throw new Error("copy failed");
}

async function resumeOrOpen(it){
  if(!it||state.resumingRef) return;
  state.resumingRef=sessionKey(it)||"pending";
  syncResumeButtons();
  showToast("正在唤起 Orca…",false,true);
  try{
    const p=new URLSearchParams({id:it.ref||"",cwd:it.cwd||it.displayCwd||"",title:it.title||""});
    // The server may open the Orca app and shell out to its CLI several times
    // (each capped at 8s), so give the whole hop a generous ceiling.
    const r=await fetch("/api/resume-in-orca?"+p.toString(),{method:"POST",headers:{"${MUTATION_CSRF_HEADER}":window.CSRF},signal:AbortSignal.timeout(30000)});
    const d=await r.json();
    if(r.ok&&d.ok) showToast(d.via==="terminal"?"Orca 不可用，已在 "+(d.app||"Terminal")+" 打开":"已在 Orca 继续",false);
    else showToast(d.error||"恢复失败",true);
  }catch(e){
    showToast(e&&e.name==="TimeoutError"?"唤起 Orca 超时，请重试":String(e&&e.message||e),true);
  }finally{
    state.resumingRef="";
    syncResumeButtons();
  }
}

function syncResumeButtons(){
  for(const el of document.querySelectorAll(".row[data-i]")){
    const it=state.items[Number(el.dataset.i)];
    const btn=el.querySelector("[data-action='resume']");
    if(!btn||!it) continue;
    const resuming=!!state.resumingRef&&sessionKey(it)===state.resumingRef;
    btn.classList.toggle("resuming",resuming);
    btn.disabled=resuming;
    btn.innerHTML=resuming?"<span class='spin'></span>唤起中…":"Orca 继续";
  }
}

function setScope(scope){
  if(!SCOPES.includes(scope)) return;
  const changed=state.scope!==scope;
  state.scope=scope;
  for(const el of document.querySelectorAll(".scope")) el.classList.toggle("active",el.dataset.scope===scope);
  if(changed) run();
}

function showLiveSessions(){
  $("q").value="";
  if(state.scope!=="all") setScope("all");
  else run();
  $("q").focus();
}

function openShortcuts(){
  state.shortcutsOpen=true;
  $("shortcuts").hidden=false;
}

function closeShortcuts(){
  state.shortcutsOpen=false;
  $("shortcuts").hidden=true;
}

function toggleShortcuts(){
  if(state.shortcutsOpen) closeShortcuts(); else openShortcuts();
}

function handleCommandKey(e){
  if(!(e.metaKey||e.ctrlKey)) return false;
  if(String(e.key||"").toLowerCase()==="p"){
    e.preventDefault();
    openPreview();
    return true;
  }
  if(e.key==="/"){
    e.preventDefault();
    toggleShortcuts();
    return true;
  }
  if(/^[1-3]$/.test(e.key)){
    e.preventDefault();
    setScope(SCOPES[Number(e.key)-1]);
    return true;
  }
  return false;
}

function isTypingTarget(target){
  const el=target&&target.closest?target.closest("input,textarea,select,[contenteditable='true']"):null;
  return !!el;
}

function shouldOpenPreviewFromSearchInput(input){
  if(!input) return true;
  const value=String(input.value||"");
  const start=Number(input.selectionStart);
  const end=Number(input.selectionEnd);
  if(!Number.isFinite(start)||!Number.isFinite(end)) return true;
  return start===end && end>=value.length;
}

$("q").addEventListener("input",schedule);
$("q").addEventListener("keydown",(e)=>{
  if(state.shortcutsOpen && e.key==="Escape"){ e.preventDefault(); closeShortcuts(); return; }
  if(state.previewOpen && (e.key==="Escape"||e.key==="ArrowLeft")){ e.preventDefault(); closePreview(); return; }
  if(handleCommandKey(e)) return;
  if(e.key==="ArrowRight" && shouldOpenPreviewFromSearchInput(e.currentTarget)){ e.preventDefault(); openPreview(); return; }
  if(e.key==="ArrowDown"){ e.preventDefault(); move(1); }
  else if(e.key==="ArrowUp"){ e.preventDefault(); move(-1); }
  else if(e.key==="Enter"){ e.preventDefault(); if(e.metaKey||e.ctrlKey) openFull(state.items[state.sel]); else resumeOrOpen(state.items[state.sel]); }
  else if(e.key==="Escape"){ e.preventDefault(); if($("q").value){ $("q").value=""; schedule(); } }
});
$("list").addEventListener("click",(e)=>{
  const action=e.target.closest("[data-action]");
  if(action){
    e.preventDefault();
    e.stopPropagation();
    const r=action.closest("[data-i]"); if(!r) return;
    state.sel=Number(r.dataset.i);
    for(const el of document.querySelectorAll(".row")){ el.classList.toggle("sel", el===r); }
    updateHint();
    if(state.previewOpen) schedulePreviewLoad(0);
    const it=state.items[state.sel];
    if(action.dataset.action==="pin") togglePin(it);
    else if(action.dataset.action==="copy") copyResumeCommand(it);
    else if(action.dataset.action==="open") openFull(it);
    else if(action.dataset.action==="resume") resumeOrOpen(it);
    return;
  }
  const r=e.target.closest("[data-i]"); if(!r) return;
  state.sel=Number(r.dataset.i);
  for(const el of document.querySelectorAll(".row")){ el.classList.toggle("sel", el===r); }
  updateHint();
  if(e.metaKey||e.ctrlKey){ if(state.previewOpen) schedulePreviewLoad(0); openFull(state.items[state.sel]); }
  else openPreview();
});
$("peek").addEventListener("click",(e)=>{
  const close=e.target.closest("[data-peek-close]");
  if(close){ e.preventDefault(); closePreview(); }
});
$("scopes").addEventListener("click",(e)=>{
  const b=e.target.closest("[data-scope]"); if(!b) return;
  setScope(b.dataset.scope);
});
$("ambient").addEventListener("click",(e)=>{
  const b=e.target.closest("[data-ambient-action]"); if(!b) return;
  if(b.dataset.ambientAction==="live") showLiveSessions();
});
$("recoveryRestore").addEventListener("click",restoreInterruptedSessions);
$("shortcuts").addEventListener("click",(e)=>{ if(e.target===$("shortcuts")) closeShortcuts(); });
document.addEventListener("keydown",(e)=>{
  if(e.defaultPrevented) return;
  if(state.shortcutsOpen && e.key==="Escape"){ e.preventDefault(); closeShortcuts(); }
  else if(state.previewOpen && (e.key==="Escape"||e.key==="ArrowLeft")){ e.preventDefault(); closePreview(); }
  else if(handleCommandKey(e)) return;
  else if(e.key==="ArrowRight" && !isTypingTarget(e.target)){ e.preventDefault(); openPreview(); }
});
document.addEventListener("visibilitychange",()=>{
  if(document.hidden){ clearTimeout(ambientTimer); clearTimeout(recentFreshness.timer); clearTimeout(previewTimer); state.previewToken+=1; }
  else{
    refreshAmbientStatus();
    scheduleAmbientRefresh(AMBIENT_REFRESH_MS);
    scheduleRecentWatermarkPoll(0);
    if(state.previewOpen) schedulePreviewLoad(0);
  }
});
$("q").focus();
run();
startRecentWatermarkPolling();
refreshAmbientStatus();
scheduleAmbientRefresh(AMBIENT_REFRESH_MS);
initializeSessionRecovery();
`;
}
