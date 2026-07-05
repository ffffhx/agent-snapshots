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
  <title>Codex Snapshots</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>${launcherCss()}</style>
</head>
<body>
  <main class="launcher">
    <header class="bar" id="dragbar">
      <svg class="glass" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input id="q" class="q" type="text" autocomplete="off" spellcheck="false" placeholder="搜索会话 — 回车在 Orca 继续">
      <div class="scopes" id="scopes">
        <button class="scope active" data-scope="all" type="button">全部</button>
        <button class="scope" data-scope="codex" type="button">Codex</button>
        <button class="scope" data-scope="claude" type="button">Claude</button>
      </div>
    </header>
    <div id="list" class="list" role="listbox" aria-label="会话"></div>
    <footer class="foot">
      <span class="brand">
        <svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#c33f28"/><g transform="rotate(-5 32 32)"><rect x="18.5" y="15" width="27" height="33" rx="3" fill="#f6ecd6"/><g fill="#c9bb98"><rect x="22.5" y="21" width="19" height="2" rx="1"/><rect x="22.5" y="25.5" width="17" height="2" rx="1"/><rect x="22.5" y="30" width="19" height="2" rx="1"/></g><circle cx="40.5" cy="42.5" r="6.2" fill="#a82f1c"/><circle cx="40.5" cy="42.5" r="6.2" fill="none" stroke="#fff3df" stroke-width="0.9" stroke-opacity="0.85"/></g></svg>
        Codex Snapshots
      </span>
      <span id="hint" class="hint"></span>
    </footer>
  </main>
  <div id="toast" class="toast" hidden></div>
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
.scope{border:0;border-radius:6px;background:transparent;color:var(--dim);padding:5px 9px;font:700 10.5px/1 var(--mono);letter-spacing:0.04em;cursor:pointer}
.scope:hover{color:var(--ink)}
.scope.active{background:rgba(233,220,196,0.1);color:var(--ink)}
.list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px;scrollbar-width:thin;scrollbar-color:rgba(233,220,196,0.2) transparent}
.list::-webkit-scrollbar{width:10px}
.list::-webkit-scrollbar-thumb{background:rgba(233,220,196,0.16);background-clip:content-box;border:3px solid transparent;border-radius:99px}
.sectlabel{padding:8px 12px 6px;color:var(--faint);font:700 10px/1 var(--mono);letter-spacing:0.14em;text-transform:uppercase}
.row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;align-items:center;gap:12px;padding:9px 12px;border-radius:9px;cursor:pointer}
.row:hover{background:var(--row-hover)}
.row.sel{background:var(--seal-soft);box-shadow:inset 3px 0 0 var(--seal)}
.badge{display:grid;place-items:center;width:26px;height:26px;border-radius:7px;font:800 11px/1 var(--mono);color:#fff}
.badge.codex{background:linear-gradient(180deg,#3a2f1d,#2a2214);color:#e6d9bd;border:1px solid rgba(233,220,196,0.18)}
.badge.claude{background:linear-gradient(180deg,#7a3a1f,#5e2c17);color:#f4dcc4}
.badge.trae{background:#2f5d49;color:#dbeee5}
.rc{min-width:0}
.rt{overflow:hidden;color:var(--ink);font:500 14px/1.3 var(--sans);text-overflow:ellipsis;white-space:nowrap}
.rs{overflow:hidden;margin-top:2px;color:var(--dim);font:500 11.5px/1.3 var(--mono);text-overflow:ellipsis;white-space:nowrap}
.rs mark{background:transparent;color:var(--seal);font-weight:700}
.racc{display:flex;align-items:center;gap:10px;flex:0 0 auto;color:var(--faint);font:600 11px/1 var(--mono);white-space:nowrap}
.rowhint{color:var(--seal);opacity:0;font-weight:700}
.row.sel .rowhint{opacity:1}
.empty{display:grid;place-items:center;height:100%;min-height:180px;color:var(--faint);font:600 13px/1.5 var(--mono);text-align:center}
.spin{width:15px;height:15px;border:2px solid rgba(233,220,196,0.2);border-top-color:var(--seal);border-radius:99px;animation:sp .8s linear infinite;margin-right:8px;display:inline-block;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
.foot{display:flex;align-items:center;justify-content:space-between;gap:12px;height:38px;flex:0 0 auto;padding:0 14px;border-top:1px solid var(--line);-webkit-app-region:drag}
.brand{display:inline-flex;align-items:center;gap:8px;color:var(--dim);font:700 11px/1 var(--mono);letter-spacing:0.02em}
.mark{width:18px;height:18px;border-radius:5px}
.hint{color:var(--faint);font:600 11px/1 var(--mono)}
.hint kbd{display:inline-block;min-width:14px;margin:0 1px;padding:2px 5px;border:1px solid var(--line-2);border-radius:5px;background:rgba(233,220,196,0.06);color:var(--dim);font:700 10px/1 var(--mono)}
.hint b{color:var(--seal)}
.toast{position:fixed;left:50%;bottom:52px;transform:translateX(-50%);z-index:9;max-width:86vw;border:1px solid var(--line-2);border-left:3px solid var(--seal);border-radius:9px;background:rgba(30,23,15,0.95);color:var(--ink);padding:10px 14px;font:600 12.5px/1.4 var(--sans);box-shadow:0 20px 50px -24px #000}
.toast[hidden]{display:none}
.toast.err{border-left-color:#e0563b}
`;
}
function launcherJs() {
    return `
const $=(id)=>document.getElementById(id);
const esc=(v)=>String(v==null?"":v).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const state={items:[],sel:0,scope:"all",query:"",mode:"recent",token:0};
let timer=0;

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
function engineKey(it){ const e=(it.engine||"").toLowerCase(); return e==="claude"||e==="trae"?e:"codex"; }
function badgeChar(k){ return k==="codex"?"C":k==="claude"?"◇":"T"; }

function showToast(msg,err){
  const el=$("toast"); el.textContent=msg; el.classList.toggle("err",!!err); el.hidden=false;
  clearTimeout(showToast._t); showToast._t=setTimeout(()=>{el.hidden=true;},3600);
}

function schedule(){
  clearTimeout(timer);
  timer=setTimeout(run,140);
}

async function run(){
  const q=$("q").value.trim();
  state.query=q;
  const token=++state.token;
  if(!q){
    state.mode="recent";
    render(true);
    try{
      const src=state.scope==="all"?"all":state.scope;
      const r=await fetch("/api/sessions?limit=40&completeOnly=1&source="+src).then(x=>x.json());
      if(token!==state.token) return;
      state.items=Array.isArray(r)?r:[];
    }catch(e){ if(token===state.token) state.items=[]; }
    if(token===state.token){ state.sel=0; render(); }
    return;
  }
  state.mode="search";
  render(true);
  try{
    const p=new URLSearchParams({q,source:state.scope,limit:"40",includeTools:"1"});
    const r=await fetch("/api/search?"+p.toString()).then(x=>x.json());
    if(token!==state.token) return;
    state.items=Array.isArray(r.results)?r.results:[];
  }catch(e){ if(token===state.token) state.items=[]; }
  if(token===state.token){ state.sel=0; render(); }
}

function render(loading){
  const list=$("list");
  if(loading && !state.items.length){
    list.innerHTML="<div class='empty'><span class='spin'></span> 正在搜索…</div>";
    updateHint(); return;
  }
  if(!state.items.length){
    list.innerHTML="<div class='empty'>"+(state.query?"没有匹配的会话":"暂无会话")+"</div>";
    updateHint(); return;
  }
  const label=state.mode==="recent"?"最近":"结果 · "+state.items.length;
  let html="<div class='sectlabel'>"+esc(label)+"</div>";
  html+=state.items.map((it,i)=>row(it,i)).join("");
  list.innerHTML=html;
  const sel=list.querySelector(".row.sel");
  if(sel) sel.scrollIntoView({block:"nearest"});
  updateHint();
}

function row(it,i){
  const k=engineKey(it);
  const title=it.title||it.ref||"未命名会话";
  const proj=(it.displayCwd||it.cwd||"").split("/").filter(Boolean).pop()||"";
  const snip=it.snippet?highlight(it.snippet,it.terms):"";
  const sub=[proj,relTime(it.mtime)].filter(Boolean).join(" · ");
  const subLine=state.mode==="search"&&snip?snip:esc(sub);
  const hint=k==="codex"?"↵ Orca":"↵ 打开";
  return "<div class='row"+(i===state.sel?" sel":"")+"' data-i='"+i+"'>"+
    "<span class='badge "+k+"'>"+badgeChar(k)+"</span>"+
    "<div class='rc'><div class='rt'>"+esc(title)+"</div><div class='rs'>"+subLine+"</div></div>"+
    "<div class='racc'><span>"+esc(relTime(it.mtime))+"</span><span class='rowhint'>"+hint+"</span></div>"+
  "</div>";
}

function highlight(text,terms){
  const src=String(text||"").slice(0,180);
  const needles=Array.from(new Set((terms||[]).map(t=>String(t||"").trim().toLowerCase()).filter(Boolean))).sort((a,b)=>b.length-a.length).slice(0,10);
  if(!needles.length) return esc(src);
  const low=src.toLowerCase();
  const marks=[];
  for(const n of needles){ let from=0,idx; while((idx=low.indexOf(n,from))>=0){ marks.push([idx,idx+n.length]); from=idx+n.length; } }
  if(!marks.length) return esc(src);
  marks.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const m of marks){ const last=merged[merged.length-1]; if(last&&m[0]<=last[1]) last[1]=Math.max(last[1],m[1]); else merged.push([m[0],m[1]]); }
  let out="",pos=0;
  for(const seg of merged){ out+=esc(src.slice(pos,seg[0]))+"<mark>"+esc(src.slice(seg[0],seg[1]))+"</mark>"; pos=seg[1]; }
  out+=esc(src.slice(pos));
  return out;
}

function updateHint(){
  const it=state.items[state.sel];
  const k=it?engineKey(it):"codex";
  const primary=k==="codex"?"<b>↵</b> 在 Orca 继续":"<b>↵</b> 打开";
  $("hint").innerHTML=primary+" &nbsp;·&nbsp; <kbd>⌘↵</kbd> 完整视图 &nbsp;·&nbsp; <kbd>↑↓</kbd> 选择 &nbsp;·&nbsp; <kbd>esc</kbd> 关闭";
}

function move(d){
  if(!state.items.length) return;
  state.sel=(state.sel+d+state.items.length)%state.items.length;
  for(const el of document.querySelectorAll(".row")){ el.classList.toggle("sel", Number(el.dataset.i)===state.sel); }
  const sel=document.querySelector(".row.sel"); if(sel) sel.scrollIntoView({block:"nearest"});
  updateHint();
}

function openFull(it){
  if(!it) return;
  window.open("/?session="+encodeURIComponent(it.ref||""),"_blank");
}

async function resumeOrOpen(it){
  if(!it) return;
  const k=engineKey(it);
  if(k!=="codex"){ openFull(it); return; }
  showToast("正在唤起 Orca…",false);
  try{
    const p=new URLSearchParams({id:it.ref||"",cwd:it.cwd||it.displayCwd||""});
    const r=await fetch("/api/resume-in-orca?"+p.toString(),{method:"POST",headers:{"${MUTATION_CSRF_HEADER}":window.CSRF}});
    const d=await r.json();
    if(r.ok&&d.ok) showToast(d.message||"已在 Orca 中恢复会话",false);
    else showToast(d.error||"在 Orca 中恢复失败",true);
  }catch(e){ showToast(String(e&&e.message||e),true); }
}

$("q").addEventListener("input",schedule);
$("q").addEventListener("keydown",(e)=>{
  if(e.key==="ArrowDown"){ e.preventDefault(); move(1); }
  else if(e.key==="ArrowUp"){ e.preventDefault(); move(-1); }
  else if(e.key==="Enter"){ e.preventDefault(); const it=state.items[state.sel]; if(e.metaKey||e.ctrlKey) openFull(it); else resumeOrOpen(it); }
  else if(e.key==="Escape"){ e.preventDefault(); if($("q").value){ $("q").value=""; schedule(); } }
});
$("list").addEventListener("click",(e)=>{
  const r=e.target.closest("[data-i]"); if(!r) return;
  state.sel=Number(r.dataset.i);
  for(const el of document.querySelectorAll(".row")){ el.classList.toggle("sel", el===r); }
  updateHint();
  if(e.metaKey||e.ctrlKey) openFull(state.items[state.sel]); else resumeOrOpen(state.items[state.sel]);
});
$("scopes").addEventListener("click",(e)=>{
  const b=e.target.closest("[data-scope]"); if(!b) return;
  state.scope=b.dataset.scope;
  for(const el of document.querySelectorAll(".scope")) el.classList.toggle("active",el===b);
  run();
});
$("q").focus();
run();
`;
}
