import { MUTATION_CSRF_HEADER } from "../../local-security.js";
export const ragJs = `
let ragAbort = null;
let ragResult = null;
let ragEvidence = [];
let ragWarnings = [];
let ragStatus = "输入问题后点击提问，答案会附上历史原文。";
let ragModelInfo = null;
let ragRequestId = 0;

function cancelRag() {
  ragRequestId += 1;
  if (ragAbort) { ragAbort.abort(); ragStatus = "已停止"; }
  ragAbort = null;
}

function resetRag() {
  cancelRag(); ragResult = null; ragEvidence = []; ragWarnings = [];
  ragStatus = "范围已切换，请重新提问。";
  $("ragScope").value = searchScopeCwd() ? "project" : "all";
}

function renderRag() {
  $("ragPanel").hidden = state.search.mode !== "rag";
  if (state.search.mode !== "rag") return;
  $("searchFacets").innerHTML = "";
  $("searchResults").innerHTML = "";
  $("searchCount").textContent = "";
  $("globalSearch").placeholder = "例如：上次启动白屏是怎么解决的？";
  $("globalSearch").disabled = !!ragAbort;
  $("globalSearch").setAttribute("aria-label", "向历史会话提问");
  $("globalSearch").setAttribute("role", "textbox");
  $("globalSearch").removeAttribute("aria-expanded");
  $("globalSearch").removeAttribute("aria-autocomplete");
  $("globalSearch").removeAttribute("aria-controls");
  $("searchScopeLabel").textContent = $("ragScope").value === "project" ? "当前项目" : "全部历史";
  $("globalSearch").removeAttribute("aria-activedescendant");
  $("ragAsk").disabled = !!ragAbort;
  $("ragBuild").disabled = !!ragAbort;
  $("ragCancel").hidden = !ragAbort;
  $("ragScope").disabled = !!ragAbort;
  $("ragProgress").textContent = ragStatus;
  $("ragProgress").setAttribute("aria-busy", ragAbort ? "true" : "false");
  $("ragWarnings").textContent = ragWarnings.join(" ");
  const answer = $("ragAnswer");
  answer.replaceChildren();
  if (ragResult) {
    if (ragResult.insufficient) {
      const p = document.createElement("p"); p.textContent = ragResult.reason; answer.append(p);
    } else {
      for (const claim of ragResult.claims || []) {
        const p = document.createElement("p"); p.append(document.createTextNode(claim.text + " "));
        for (const id of claim.citations) {
          const button = document.createElement("button"); button.type = "button"; button.className = "sr-act";
          button.textContent = "[" + id + "]"; button.setAttribute("aria-label", "查看证据 " + id);
          button.addEventListener("click", () => document.getElementById("rag-evidence-" + id)?.scrollIntoView({ block: "nearest" })); p.append(button);
        }
        answer.append(p);
      }
    }
  }
  const sources = $("ragSources"); sources.replaceChildren();
  for (const evidence of ragEvidence) {
    const details = document.createElement("details"); details.id = "rag-evidence-" + evidence.id;
    const summary = document.createElement("summary"); summary.textContent = "[" + evidence.id + "] " + evidence.title + " · " + evidence.source + " · 第 " + evidence.turn + " 条";
    const meta = document.createElement("p"); meta.className = "search-result-meta"; meta.textContent = [evidence.timestamp, evidence.cwd, evidence.truncated ? "部分长内容已省略" : ""].filter(Boolean).join(" · ");
    const pre = document.createElement("pre"); pre.textContent = evidence.text;
    const open = document.createElement("button"); open.type = "button"; open.className = "sr-act"; open.textContent = "打开原会话";
    open.addEventListener("click", async () => {
      closeSearchDialog(true);
      await selectSession(evidence.ref);
      if (evidence.source === "Session") focusTurn(evidence.turn);
    });
    details.append(summary, meta, pre, open); sources.append(details);
  }
  if (ragResult?.metrics) $("ragMetrics").textContent = "耗时 " + (ragResult.metrics.totalMs / 1000).toFixed(1) + " 秒 · 关键词候选 " + ragResult.metrics.keywordHits + " · 语义候选 " + ragResult.metrics.vectorHits + " · 证据 " + ragEvidence.length;
  else $("ragMetrics").textContent = "";
  $("ragModels").textContent = ragModelInfo ? ((ragModelInfo.error || (ragModelInfo.missing.length ? "缺少本地模型：" + ragModelInfo.missing.join("、") + "。请使用 ollama pull 安装。" : ragModelInfo.chatProvider === "deepseek" ? "DeepSeek 密钥已配置" : "模型已就绪")) + " · 回答：" + (ragModelInfo.chatModel || "未知") + " · 检索：" + (ragModelInfo.embeddingModel || "未知") + (ragModelInfo.chatProvider === "deepseek" ? " · 提问时会将问题和相关原文片段发送至 DeepSeek" : "")) : "正在检查模型服务…";
}

async function loadRagModelStatus() {
  try { const response = await fetch("/api/rag/status"); ragModelInfo = await response.json(); }
  catch { ragModelInfo = { error: "无法检查模型服务", missing: [] }; }
  if (state.search.mode === "rag") renderRag();
}

async function runRag(prewarm = false) {
  if (ragAbort) return;
  const query = $("globalSearch").value.trim();
  if (!prewarm && !query) { ragStatus = "请先输入问题。"; renderRag(); return; }
  const controller = new AbortController(); ragAbort = controller;
  const requestId = ++ragRequestId;
  ragResult = null; ragEvidence = []; ragWarnings = [];
  ragStatus = prewarm ? "正在建立索引…" : "正在查找历史依据…";
  const scope = $("ragScope").value;
  const cwd = scope === "project" ? (searchScopeCwd() || selectedSession()?.cwd || "") : "";
  if (scope === "project" && !cwd) { ragAbort = null; ragStatus = "请先选择一个项目中的会话，或切换到全部项目。"; renderRag(); return; }
  renderRag();
  let finished = false;
  const accept = (event) => {
    if (requestId !== ragRequestId) return;
    if (event.type === "status") ragStatus = event.message;
    if (event.type === "index") ragStatus = "已索引 " + event.indexed + " / " + event.scanned + " 个会话，片段 " + event.chunks;
    if (event.type === "evidence") { ragEvidence = event.evidence; ragWarnings = event.warnings; }
    if (event.type === "answer") { ragResult = event; ragEvidence = event.evidence; ragWarnings = event.warnings; ragStatus = event.insufficient ? "未找到充分依据" : "回答完成，点击引用核对原文"; }
    if (event.type === "complete") { ragWarnings = event.warnings; ragStatus = event.complete ? "索引已就绪" : "本批索引已保存，点击建立索引继续（会话待补 " + event.sync.pending + "，向量待补 " + event.vectors.pending + "）"; }
    if (event.type === "answer" || event.type === "complete") finished = true;
    if (event.type === "error") throw new Error(event.error);
    renderRag();
  };
  try {
    const response = await fetch(prewarm ? "/api/rag/prewarm" : "/api/rag/ask", { method: "POST", headers: { "content-type": "application/json", "${MUTATION_CSRF_HEADER}": csrfToken }, body: JSON.stringify({ query, cwd }), signal: controller.signal });
    if (!response.ok) { const error = await response.json(); throw new Error(error.error || "请求失败"); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = "";
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = pending.indexOf("\\n")) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (line.trim()) accept(JSON.parse(line));
      }
      if (done) { if (pending.trim()) accept(JSON.parse(pending)); break; }
    }
    if (!finished) throw new Error("连接在答案完成前中断，请重试。");
  } catch (error) {
    if (requestId === ragRequestId) ragStatus = controller.signal.aborted ? "已停止" : (error.message || String(error));
  } finally {
    if (requestId === ragRequestId) { ragAbort = null; renderRag(); }
  }
}

$("ragAsk").addEventListener("click", () => runRag());
$("ragBuild").addEventListener("click", () => runRag(true));
$("ragCancel").addEventListener("click", () => { cancelRag(); ragStatus = "已停止"; renderRag(); });
$("ragScope").addEventListener("change", () => { ragResult = null; ragEvidence = []; ragWarnings = []; ragStatus = "范围已切换，请重新提问。"; renderRag(); });
$("globalSearch").addEventListener("input", () => {
  if (state.search.mode !== "rag" || ragAbort) return;
  ragResult = null; ragEvidence = []; ragWarnings = []; ragStatus = "问题已修改，点击提问或按 Enter 开始。"; renderRag();
});
`;
