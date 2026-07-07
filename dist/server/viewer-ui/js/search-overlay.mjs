// @ts-nocheck
import { MUTATION_CSRF_HEADER } from "../../local-security.js";
export const searchOverlayJs = `function resetSearchResultsState() {
  state.search.loading = false;
  state.search.results = [];
  state.search.terms = [];
  state.search.matched = 0;
  state.search.scanned = 0;
  state.search.indexed = 0;
  state.search.indexedChunks = 0;
  state.search.updated = 0;
  state.search.pending = 0;
  state.search.failed = 0;
  state.search.model = "";
  state.search.error = "";
  state.search.requestToken += 1;
}

function setSearchMode(mode) {
  state.search.mode = mode === "semantic" ? "semantic" : "keyword";
  resetSearchResultsState();
  renderSearch();
  scheduleSearch(0);
}

let semanticWarmupAbort = null;
function resetSemanticWarmupState(keepComplete = false) {
  state.semanticWarmup = {
    running: false,
    requestedStop: false,
    rounds: 0,
    scanned: keepComplete ? state.semanticWarmup.scanned : 0,
    indexed: keepComplete ? state.semanticWarmup.indexed : 0,
    indexedChunks: keepComplete ? state.semanticWarmup.indexedChunks : 0,
    updated: 0,
    totalUpdated: keepComplete ? state.semanticWarmup.totalUpdated : 0,
    pending: keepComplete ? state.semanticWarmup.pending : 0,
    failed: keepComplete ? state.semanticWarmup.failed : 0,
    model: keepComplete ? state.semanticWarmup.model : "",
    error: "",
    complete: keepComplete ? state.semanticWarmup.complete : false,
  };
}

function updateSemanticWarmupState(payload) {
  const updated = Number(payload.updated || 0);
  state.semanticWarmup.scanned = Number(payload.scanned || 0);
  state.semanticWarmup.indexed = Number(payload.indexed || 0);
  state.semanticWarmup.indexedChunks = Number(payload.indexedChunks || 0);
  state.semanticWarmup.updated = updated;
  state.semanticWarmup.totalUpdated += updated;
  state.semanticWarmup.pending = Number(payload.pending || 0);
  state.semanticWarmup.failed = Number(payload.failed || 0);
  state.semanticWarmup.model = String(payload.model || "");
  state.semanticWarmup.complete = payload.complete === true || state.semanticWarmup.pending === 0;
}

function semanticWarmupStatus(prefix) {
  const warmup = state.semanticWarmup;
  const updated = warmup.totalUpdated ? "，已更新 " + warmup.totalUpdated + " 条" : "";
  const pending = warmup.pending ? "，待补 " + warmup.pending + " 条" : "";
  const failed = warmup.failed ? "，跳过 " + warmup.failed + " 条" : "";
  const model = warmup.model ? " · " + warmup.model : "";
  return prefix + "：索引 " + warmup.indexed + " / 扫描 " + warmup.scanned + updated + pending + failed + model;
}

function semanticWarmupParams() {
  const params = new URLSearchParams({
    source: "all",
    scanLimit: String(SEMANTIC_PREWARM_SCAN_LIMIT),
    updateLimit: String(SEMANTIC_PREWARM_UPDATE_LIMIT),
    completeOnly: "1",
    includeTools: "1",
    includeToolOutput: "0",
  });
  const cwd = searchScopeCwd();
  if (cwd) {
    params.set("cwd", cwd);
  }
  return params;
}

async function toggleSemanticPrewarm() {
  if (state.semanticWarmup.running) {
    state.semanticWarmup.requestedStop = true;
    if (semanticWarmupAbort) {
      semanticWarmupAbort.abort();
    }
    renderSearch();
    return;
  }
  await runSemanticPrewarm();
}

async function runSemanticPrewarm() {
  if (state.semanticWarmup.running) {
    return;
  }
  state.search.mode = "semantic";
  resetSemanticWarmupState(false);
  state.semanticWarmup.running = true;
  renderSearch();

  try {
    while (!state.semanticWarmup.requestedStop) {
      state.semanticWarmup.rounds += 1;
      semanticWarmupAbort = new AbortController();
      const response = await fetch("/api/semantic-index/prewarm?" + semanticWarmupParams().toString(), {
        method: "POST",
        headers: { "${MUTATION_CSRF_HEADER}": csrfToken },
        signal: semanticWarmupAbort.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "预热索引失败");
      }
      updateSemanticWarmupState(payload);
      renderSearch();
      if (state.semanticWarmup.pending <= 0 || Number(payload.updated || 0) <= 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  } catch (error) {
    if (!state.semanticWarmup.requestedStop || error?.name !== "AbortError") {
      state.semanticWarmup.error = error instanceof Error ? error.message : String(error);
    }
  } finally {
    semanticWarmupAbort = null;
    state.semanticWarmup.running = false;
    state.semanticWarmup.requestedStop = false;
    state.semanticWarmup.complete = state.semanticWarmup.pending === 0 && !state.semanticWarmup.error;
    renderSearch();
  }
}

let searchTimer = 0;
let previewTimer = 0;
function scheduleSearch(delay = 220) {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(() => {
    searchTimer = 0;
    runSearch();
  }, delay);
}

const FILTER_KEYS = ["source", "role", "project", "before", "after"];

function parseSearchQuery(raw) {
  const filters = { source: "", roles: [], projects: [], before: 0, after: 0, excludes: [] };
  const textParts = [];
  const tokens = String(raw || "").match(/[^\\s"]*"[^"]*"[^\\s"]*|[^\\s]+/g) || [];
  for (const token of tokens) {
    const match = /^([a-zA-Z]+):(.*)$/.exec(token);
    if (match && FILTER_KEYS.includes(match[1].toLowerCase())) {
      const key = match[1].toLowerCase();
      const value = match[2].replace(/^"|"$/g, "").trim();
      if (!value) {
        continue;
      }
      if (key === "source") {
        const s = value.toLowerCase();
        filters.source = (s === "claude" || s === "claude-code" || s === "claudecode") ? "claude" : (s === "codex" ? "codex" : "");
      } else if (key === "role") {
        filters.roles.push(value.toLowerCase());
      } else if (key === "project") {
        filters.projects.push(value.toLowerCase());
      } else if (key === "before" || key === "after") {
        const time = Date.parse(value);
        if (Number.isFinite(time)) {
          filters[key] = time;
        }
      }
      continue;
    }
    if (token.length > 1 && token[0] === "-" && token[1] !== ":") {
      filters.excludes.push(token.slice(1).replace(/^"|"$/g, "").toLowerCase());
      continue;
    }
    textParts.push(token.replace(/"/g, ""));
  }
  return { text: textParts.join(" ").trim(), filters };
}

function normalizeMs(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return num < 1e12 ? num * 1000 : num;
}

function isWordChar(ch) {
  return !!ch && /[A-Za-z0-9_]/.test(ch);
}

function includesWholeWord(hay, term, caseSensitive) {
  const haystack = caseSensitive ? hay : hay.toLowerCase();
  const needle = caseSensitive ? term : term.toLowerCase();
  if (!needle) {
    return true;
  }
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) {
      return false;
    }
    const before = idx === 0 ? "" : haystack[idx - 1];
    const after = idx + needle.length >= haystack.length ? "" : haystack[idx + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) {
      return true;
    }
    from = idx + 1;
  }
  return false;
}

function resultMatchesFlags(result, terms, flags) {
  if (!terms.length || (!flags.caseSensitive && !flags.wholeWord)) {
    return true;
  }
  const hay = String(result.title || "") + " " + String(result.snippet || "");
  return terms.every((term) => {
    const needle = String(term || "");
    if (!needle) {
      return true;
    }
    if (flags.wholeWord) {
      return includesWholeWord(hay, needle, flags.caseSensitive);
    }
    return hay.indexOf(needle) >= 0;
  });
}

function computeFilteredResults() {
  const filters = state.search.filters || { source: "", roles: [], projects: [], before: 0, after: 0, excludes: [] };
  const flags = state.search.flags;
  const terms = state.search.mode === "semantic" ? [] : (state.search.terms || []);
  return (state.search.rawResults || []).filter((result) => {
    const cwd = String(result.displayCwd || result.cwd || "").toLowerCase();
    const role = String(result.role || result.label || "").toLowerCase();
    const hay = (String(result.title || "") + " " + String(result.snippet || "")).toLowerCase();
    if (filters.projects.length && !filters.projects.some((project) => cwd.includes(project))) {
      return false;
    }
    if (filters.roles.length && !filters.roles.some((wanted) => role.includes(wanted))) {
      return false;
    }
    const mtime = normalizeMs(result.mtime);
    if (filters.before && mtime && mtime >= filters.before) {
      return false;
    }
    if (filters.after && mtime && mtime <= filters.after) {
      return false;
    }
    if (filters.excludes.length && filters.excludes.some((word) => hay.includes(word))) {
      return false;
    }
    if (!resultMatchesFlags(result, terms, flags)) {
      return false;
    }
    return true;
  });
}

function reapplyClientFilters() {
  state.search.results = computeFilteredResults();
  state.search.active = 0;
  renderSearch();
}

function renderFacets() {
  const el = $("searchFacets");
  if (!el) {
    return;
  }
  const raw = state.search.rawResults || [];
  if (!state.search.query || !raw.length) {
    el.innerHTML = "";
    return;
  }
  const filters = state.search.filters || { source: "", projects: [] };
  const sources = new Map();
  const projects = new Map();
  for (const result of raw) {
    const label = result.engineLabel || "Codex";
    const engine = String(result.engine || "").toLowerCase();
    const key = engine === "trae" || /trae/i.test(label) ? "trae" : /claude/i.test(label) ? "claude" : "codex";
    const entry = sources.get(key) || { key, label, count: 0 };
    entry.count += 1;
    sources.set(key, entry);
    const path = String(result.displayCwd || result.cwd || "").trim();
    if (path) {
      const name = path.split("/").filter(Boolean).pop() || path;
      projects.set(name, (projects.get(name) || 0) + 1);
    }
  }
  const chips = [];
  for (const entry of sources.values()) {
    const active = filters.source === entry.key;
    chips.push("<button type='button' class='facet-chip" + (active ? " active" : "") + "' data-facet-key='source' data-facet-value='" + esc(entry.key) + "'>" + esc(entry.label) + " <b>" + entry.count + "</b></button>");
  }
  const topProjects = Array.from(projects.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [name, count] of topProjects) {
    const active = filters.projects.includes(name.toLowerCase());
    chips.push("<button type='button' class='facet-chip" + (active ? " active" : "") + "' data-facet-key='project' data-facet-value='" + esc(name) + "'>" + esc(name) + " <b>" + count + "</b></button>");
  }
  el.innerHTML = chips.join("");
}

function toggleQueryToken(key, value, single) {
  const input = $("globalSearch");
  const quoted = value.indexOf(" ") >= 0 ? '"' + value + '"' : value;
  const tokenRe = new RegExp("(?:^| )" + key + ":\\\"?" + escapeRegExp(value) + "\\\"?(?= |$)", "i");
  let next;
  if (tokenRe.test(input.value)) {
    next = input.value.replace(tokenRe, " ").replace(/ +/g, " ").trim();
  } else {
    let base = input.value;
    if (single) {
      base = base.replace(new RegExp("(?:^| )" + key + ":[^ ]+", "gi"), " ").replace(/ +/g, " ").trim();
    }
    next = (base + " " + key + ":" + quoted).replace(/ +/g, " ").trim();
  }
  input.value = next;
  input.focus();
  scheduleSearch(0);
}

async function runSearch() {
  const query = $("globalSearch").value.trim();
  state.search.query = query;
  state.search.error = "";
  const parsed = parseSearchQuery(query);
  state.search.filters = parsed.filters;
  state.search.textEmpty = !parsed.text;
  if (!parsed.text) {
    state.search.loading = false;
    state.search.results = [];
    state.search.rawResults = [];
    state.search.terms = [];
    state.search.matched = 0;
    state.search.scanned = 0;
    state.search.indexed = 0;
    state.search.indexedChunks = 0;
    state.search.updated = 0;
    state.search.pending = 0;
    state.search.failed = 0;
    state.search.model = "";
    renderSearch();
    return;
  }

  const requestToken = state.search.requestToken + 1;
  state.search.requestToken = requestToken;
  state.search.loading = true;
  renderSearch();

  const semanticMode = state.search.mode === "semantic";
  const params = new URLSearchParams({
    q: parsed.text,
    source: parsed.filters.source || "all",
    limit: "24",
    scanLimit: String(semanticMode ? SEMANTIC_SEARCH_SCAN_LIMIT : SEARCH_SCAN_LIMIT),
    completeOnly: "1",
    includeTools: "1",
    includeToolOutput: "0",
  });
  const cwd = searchScopeCwd();
  if (cwd) {
    params.set("cwd", cwd);
  }
  if (semanticMode) {
    params.set("updateLimit", String(SEMANTIC_SEARCH_UPDATE_LIMIT));
  }

  try {
    const response = await fetch((semanticMode ? "/api/semantic-search?" : "/api/search?") + params.toString());
    const payload = await response.json();
    if (requestToken !== state.search.requestToken) {
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "Search failed");
    }
    state.search.rawResults = Array.isArray(payload.results) ? payload.results : [];
    state.search.terms = Array.isArray(payload.terms) ? payload.terms : [];
    state.search.results = computeFilteredResults();
    state.search.active = 0;
    state.search.matched = Number(payload.matched || state.search.rawResults.length);
    state.search.scanned = Number(payload.scanned || 0);
    state.search.indexed = Number(payload.indexed || 0);
    state.search.indexedChunks = Number(payload.indexedChunks || 0);
    state.search.updated = Number(payload.updated || 0);
    state.search.pending = Number(payload.pending || 0);
    state.search.failed = Number(payload.failed || 0);
    state.search.model = String(payload.model || "");
  } catch (error) {
    if (requestToken !== state.search.requestToken) {
      return;
    }
    state.search.results = [];
    state.search.rawResults = [];
    state.search.terms = [];
    state.search.matched = 0;
    state.search.indexed = 0;
    state.search.indexedChunks = 0;
    state.search.updated = 0;
    state.search.pending = 0;
    state.search.model = "";
    state.search.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (requestToken === state.search.requestToken) {
      state.search.loading = false;
      renderSearch();
    }
  }
}

function renderSearch() {
  const scopeLabel = $("searchScopeLabel");
  if (scopeLabel) {
    scopeLabel.textContent = state.search.scopeLabel || "全部历史";
    scopeLabel.title = state.search.scope === "project" && state.search.cwd ? state.search.cwd : "全部历史";
  }
  for (const button of document.querySelectorAll("[data-search-mode]")) {
    const mode = button.dataset.searchMode;
    const active = mode === state.search.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  const semantic = state.search.mode === "semantic";
  for (const button of document.querySelectorAll("[data-search-flag]")) {
    const on = !!state.search.flags[button.dataset.searchFlag];
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.disabled = semantic;
  }
  const prewarmButton = $("prewarmIndex");
  if (prewarmButton) {
    const semanticMode = state.search.mode === "semantic";
    prewarmButton.hidden = !semanticMode;
    prewarmButton.disabled = !semanticMode || (state.search.loading && !state.semanticWarmup.running);
    prewarmButton.textContent = state.semanticWarmup.running ? "停止预热" : state.semanticWarmup.complete ? "已预热" : "预热索引";
    if (state.semanticWarmup.running) {
      prewarmButton.setAttribute("aria-busy", "true");
    } else {
      prewarmButton.removeAttribute("aria-busy");
    }
  }

  const status = $("searchStatus");
  if (state.search.mode === "semantic" && state.semanticWarmup.running) {
    status.textContent = semanticWarmupStatus("预热中");
  } else if (state.search.mode === "semantic" && state.semanticWarmup.error && !state.search.query) {
    status.textContent = state.semanticWarmup.error;
  } else if (state.search.mode === "semantic" && state.semanticWarmup.complete && !state.search.query) {
    status.textContent = semanticWarmupStatus("预热完成");
  } else if (state.search.loading) {
    status.textContent = state.search.mode === "semantic" ? "正在更新本机语义索引..." : "正在搜索...";
  } else if (state.search.error) {
    status.textContent = state.search.error;
  } else if (state.search.query) {
    const failed = state.search.failed ? "，跳过 " + state.search.failed + " 条" : "";
    if (state.search.mode === "semantic") {
      const updated = state.search.updated ? "，更新 " + state.search.updated + " 条" : "";
      const pending = state.search.pending ? "，待补 " + state.search.pending + " 条" : "";
      const model = state.search.model ? " · " + state.search.model : "";
      status.textContent = "命中 " + state.search.matched + " / 索引 " + state.search.indexed + " / 扫描 " + state.search.scanned + updated + pending + failed + model;
    } else {
      status.textContent = "命中 " + state.search.matched + " / 扫描 " + state.search.scanned + failed;
    }
  } else {
    status.textContent = "";
  }

  renderFacets();

  const globalInput = $("globalSearch");
  if (state.search.loading) {
    globalInput.removeAttribute("aria-activedescendant");
    $("searchResults").innerHTML = renderLoading("正在搜索会话...");
    return;
  }
  if (!state.search.query) {
    globalInput.removeAttribute("aria-activedescendant");
    $("searchResults").innerHTML = "<div class='search-empty'>" + (state.search.mode === "semantic" ? "输入大意开始语义搜索" : "输入关键词开始搜索") + "</div>";
    return;
  }
  if (state.search.textEmpty) {
    globalInput.removeAttribute("aria-activedescendant");
    $("searchResults").innerHTML = "<div class='search-empty'>请输入关键词（可搭配 source: / project: 等过滤）</div>";
    updateSearchCount();
    return;
  }
  if (state.search.error) {
    globalInput.removeAttribute("aria-activedescendant");
    $("searchResults").innerHTML = "<div class='search-empty'>" + esc(state.search.error) + "</div>";
    return;
  }
  if (!state.search.results.length) {
    const hint = (state.search.rawResults && state.search.rawResults.length)
      ? "过滤后没有会话，试着放宽筛选条件"
      : "没有匹配的会话";
    $("searchResults").innerHTML = "<div class='search-empty'>" + hint + "</div>";
    updateSearchCount();
    return;
  }
  if (state.search.active >= state.search.results.length || state.search.active < 0) {
    state.search.active = 0;
  }
  $("searchResults").innerHTML = state.search.results.map(renderSearchResult).join("");
  updateSearchActive({ preview: false, scroll: false });
  updateSearchCount();
}

function renderSearchResult(result, index) {
  const ref = result.ref || "";
  const title = result.title || ref || "Untitled session";
  const path = result.displayCwd || result.cwd || "普通会话";
  const source = [result.engineLabel || "Codex", relativeTime(result.mtime)].filter(Boolean).join(" · ");
  const score = state.search.mode === "semantic" ? Math.round(Number(result.score || 0) * 100) + "%" : "";
  const label = [result.label || result.role || "Match", result.turn ? "#" + result.turn : "", score].filter(Boolean).join(" ");
  const snippet = state.search.mode === "semantic"
    ? esc(result.snippet || "")
    : highlightSearchSnippet(result.snippet || "", result.terms || state.search.terms);
  const active = index === state.search.active;
  return "<div class='search-result" + (active ? " active" : "") + "' role='option' id='search-result-" + index + "' aria-selected='" + (active ? "true" : "false") + "' data-search-index='" + index + "' data-search-result='" + esc(ref) + "'>" +
    "<strong class='search-result-title'>" + esc(title) + "</strong>" +
    "<span class='search-result-source'>" + esc(source) + "</span>" +
    "<span class='search-result-path'>" + esc(path) + "</span>" +
    "<p class='search-result-snippet'>" + snippet + "</p>" +
    "<span class='search-result-meta'>" + esc(label) + "</span>" +
    "<div class='search-result-actions'>" +
      "<button type='button' class='sr-act' data-sr-action='open' title='打开会话（↵）'>打开</button>" +
      "<button type='button' class='sr-act' data-sr-action='in-session' title='打开并在此会话内搜索'>会话内搜</button>" +
      (result.engine !== "trae" ? "<button type='button' class='sr-act sr-act-orca' data-sr-action='resume-orca' title='在 Orca 中打开终端并恢复此会话'>↗ Orca 继续</button>" : "") +
      "<button type='button' class='sr-act' data-sr-action='export-html' title='导出为 HTML'>导出 HTML</button>" +
      "<button type='button' class='sr-act' data-sr-action='copy-path' title='复制项目路径'>复制路径</button>" +
    "</div>" +
  "</div>";
}

function updateSearchActive(options = {}) {
  const nodes = Array.from(document.querySelectorAll("[data-search-index]"));
  const input = $("globalSearch");
  nodes.forEach((node) => {
    const index = Number(node.dataset.searchIndex);
    const active = index === state.search.active;
    node.classList.toggle("active", active);
    node.setAttribute("aria-selected", active ? "true" : "false");
    if (active) {
      if (input) {
        input.setAttribute("aria-activedescendant", node.id);
      }
      if (options.scroll !== false) {
        node.scrollIntoView({ block: "nearest" });
      }
    }
  });
  if (options.preview) {
    schedulePreview();
  }
}

function moveSearchActive(delta) {
  if (!state.search.results.length) {
    return;
  }
  const count = state.search.results.length;
  state.search.active = (state.search.active + delta + count) % count;
  updateSearchActive({ preview: true, scroll: true });
}

function updateSearchCount() {
  const el = $("searchCount");
  if (!el) {
    return;
  }
  if (!state.search.query || state.search.loading || state.search.error) {
    el.textContent = "";
    return;
  }
  const shown = state.search.results.length;
  if (!shown) {
    el.textContent = "";
    return;
  }
  const raw = (state.search.rawResults || []).length;
  if (raw && shown < raw) {
    el.textContent = shown + " / 候选 " + raw + " 个会话";
    return;
  }
  const matched = Math.max(shown, state.search.matched || shown);
  el.textContent = matched > shown
    ? "显示前 " + shown + " / 命中 " + matched + " 个会话"
    : shown + " 个会话";
}

function schedulePreview(delay = 200) {
  if (previewTimer) {
    clearTimeout(previewTimer);
  }
  previewTimer = setTimeout(() => {
    previewTimer = 0;
    previewActiveResult();
  }, delay);
}

async function previewActiveResult() {
  const result = state.search.results[state.search.active];
  if (!result || !result.ref) {
    return;
  }
  if (result.session) {
    appendSessions([result.session]);
    state.activeSource = visibleSourceKey(sessionEngine(result.session));
  }
  state.search.previewRef = result.ref;
  await previewSession(result.ref, result.turn);
}

async function previewSession(id, turn) {
  if (!id) {
    return;
  }
  const cached = state.snapshotCache.get(id);
  if (cached) {
    state.selected = id;
    renderSessions();
    renderSnapshot(cached);
    if (turn) {
      focusTurn(turn);
    }
    return;
  }
  const token = state.previewToken + 1;
  state.previewToken = token;
  state.requestToken += 1;
  state.selected = id;
  renderSessions();
  showViewerLoading("正在预览会话...");
  if (typeof prepareSessionNoteLoad === "function") {
    prepareSessionNoteLoad(id);
  }
  try {
    const params = new URLSearchParams({
      id,
      includeTools: "1",
      includeToolOutput: "0",
      redact: $("redact").checked ? "1" : "0",
      safety: SAFETY_CHECKS_ENABLED ? "1" : "0",
    });
    const response = await fetch("/api/snapshot?" + params.toString());
    const snapshot = await response.json();
    if (token !== state.previewToken || state.selected !== id) {
      return;
    }
    if (snapshot.error) {
      $("title").textContent = "会话加载失败";
      $("meta").textContent = "会话内容加载失败。";
      $("turns").innerHTML = "<div class='meta'>" + esc(snapshot.error) + "</div>";
      return;
    }
    state.snapshotCache.set(id, snapshot);
    renderSnapshot(snapshot);
    if (turn) {
      focusTurn(turn);
    }
  } catch (error) {
    if (token === state.previewToken) {
      $("turns").innerHTML = "<div class='meta'>" + esc(error instanceof Error ? error.message : String(error)) + "</div>";
    }
  }
}

async function runSearchResultAction(action, ref) {
  const result = state.search.results.find((item) => item.ref === ref);
  if (!result) {
    return;
  }
  if (action === "open") {
    await selectSearchResult(ref);
    return;
  }
  if (action === "in-session") {
    await selectSearchResult(ref);
    const input = $("sessionSearchInput");
    if (input && !input.disabled) {
      input.focus();
    }
    return;
  }
  if (action === "resume-orca") {
    resumeInOrca(ref, result.cwd || result.displayCwd || "", result.title || "");
    return;
  }
  if (action === "export-html" || action === "export-md") {
    const params = new URLSearchParams({
      id: ref,
      includeTools: "1",
      includeToolOutput: "0",
      redact: $("redact").checked ? "1" : "0",
      safety: SAFETY_CHECKS_ENABLED ? "1" : "0",
      format: action === "export-md" ? "md" : "html",
    });
    window.open("/export?" + params.toString(), "_blank", "noopener,noreferrer");
    return;
  }
  if (action === "copy-path") {
    const path = String(result.displayCwd || result.cwd || "").trim();
    if (path && navigator.clipboard) {
      navigator.clipboard.writeText(path).catch(() => {});
    }
  }
}

function resetSessionSearchState(keepQuery) {
  const query = keepQuery ? state.sessionSearch.query : "";
  state.sessionSearch = { query, loading: false, results: [], chunkCount: 0, model: "", error: "", requestToken: state.sessionSearch.requestToken + 1 };
  const input = $("sessionSearchInput");
  if (input && !keepQuery) {
    input.value = "";
  }
}

let sessionSearchTimer = 0;
function scheduleSessionSearch(delay = 260) {
  if (sessionSearchTimer) {
    clearTimeout(sessionSearchTimer);
  }
  sessionSearchTimer = setTimeout(() => {
    sessionSearchTimer = 0;
    runSessionSearch();
  }, delay);
}

async function runSessionSearch() {
  const input = $("sessionSearchInput");
  const query = input.value.trim();
  state.sessionSearch.query = query;
  state.sessionSearch.error = "";
  if (!state.selected || !state.currentSnapshot) {
    state.sessionSearch.loading = false;
    state.sessionSearch.results = [];
    state.sessionSearch.error = "先选择一个会话。";
    renderSessionSearch();
    return;
  }
  if (!query) {
    resetSessionSearchState(true);
    renderSessionSearch();
    return;
  }

  const requestToken = state.sessionSearch.requestToken + 1;
  state.sessionSearch.requestToken = requestToken;
  state.sessionSearch.loading = true;
  state.sessionSearch.results = [];
  renderSessionSearch();

  const params = activeOptions();
  params.set("q", query);
  params.set("limit", "8");

  try {
    const response = await fetch("/api/session-search?" + params.toString());
    const payload = await response.json();
    if (requestToken !== state.sessionSearch.requestToken) {
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "Semantic search failed");
    }
    state.sessionSearch.results = Array.isArray(payload.results) ? payload.results : [];
    state.sessionSearch.chunkCount = Number(payload.chunkCount || 0);
    state.sessionSearch.model = String(payload.model || "");
  } catch (error) {
    if (requestToken !== state.sessionSearch.requestToken) {
      return;
    }
    state.sessionSearch.results = [];
    state.sessionSearch.chunkCount = 0;
    state.sessionSearch.model = "";
    state.sessionSearch.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (requestToken === state.sessionSearch.requestToken) {
      state.sessionSearch.loading = false;
      renderSessionSearch();
    }
  }
}

function renderSessionSearch() {
  const input = $("sessionSearchInput");
  const button = $("sessionSearchRun");
  const status = $("sessionSearchStatus");
  const results = $("sessionSearchResults");
  if (!input || !button || !status || !results) {
    return;
  }

  const hasSnapshot = Boolean(state.selected && state.currentSnapshot);
  input.disabled = !hasSnapshot;
  button.disabled = !hasSnapshot || state.sessionSearch.loading;
  if (!hasSnapshot) {
    status.textContent = "选择会话后可用";
    results.innerHTML = "";
    return;
  }
  if (state.sessionSearch.loading) {
    status.textContent = "正在调用本机 embedding...";
  } else if (state.sessionSearch.error) {
    status.textContent = state.sessionSearch.error;
  } else if (state.sessionSearch.query) {
    const count = state.sessionSearch.results.length;
    const model = state.sessionSearch.model ? " · " + state.sessionSearch.model : "";
    status.textContent = "命中 " + count + " / " + state.sessionSearch.chunkCount + model;
  } else {
    status.textContent = "本机 Ollama / qwen3-embedding:0.6b";
  }

  if (state.sessionSearch.loading) {
    results.innerHTML = renderLoading("正在语义搜索当前会话...");
    return;
  }
  if (!state.sessionSearch.query || state.sessionSearch.error) {
    results.innerHTML = "";
    return;
  }
  if (!state.sessionSearch.results.length) {
    results.innerHTML = "<div class='search-empty'>没有匹配片段</div>";
    return;
  }
  results.innerHTML = state.sessionSearch.results.map(renderSessionSearchResult).join("");
}

function renderSessionSearchResult(result) {
  const turn = Number(result.turn || 0);
  const score = Math.round(Number(result.score || 0) * 100);
  const label = [
    result.sourceLabel && result.sourceLabel !== "Session" ? result.sourceLabel : "",
    result.label || result.role || "Message",
    turn ? "#" + turn : "",
  ].filter(Boolean).join(" · ");
  return "<div class='session-search-result' role='button' tabindex='0' data-session-search-turn='" + esc(turn || "") + "'>" +
    "<b>" + esc(label || "Match") + "</b>" +
    "<em>" + esc(score) + "%</em>" +
    "<span>" + esc(result.snippet || result.text || "") + "</span>" +
  "</div>";
}

function focusTurn(turnNumber) {
  let target = findTurnNode(turnNumber);
  if (!target && transcriptHydration) {
    // 目标轮次可能还在渐进补齐的队列里：强制补齐后重试。
    flushTranscriptHydration();
    target = findTurnNode(turnNumber);
  }
  if (!target) {
    return false;
  }
  const details = target.closest("details");
  if (details) {
    details.open = true;
  }
  document.querySelectorAll(".semantic-hit-current").forEach((item) => item.classList.remove("semantic-hit-current"));
  target.classList.add("semantic-hit-current");
  target.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  window.setTimeout(() => target.classList.remove("semantic-hit-current"), 2400);
  return true;
}

function preferredScrollBehavior() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function findTurnNode(turnNumber) {
  return Array.from(document.querySelectorAll("[data-turn-number]"))
    .find((item) => item.getAttribute("data-turn-number") === String(turnNumber)) || null;
}

function highlightSearchSnippet(text, terms) {
  const source = String(text || "");
  const needles = Array.from(new Set((terms || []).map((term) => String(term || "").trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);
  if (!needles.length) {
    return esc(source);
  }
  const pattern = needles.map(escapeRegExp).join("|");
  if (!pattern) {
    return esc(source);
  }
  const matcher = new RegExp("(" + pattern + ")", "gi");
  return esc(source).replace(matcher, "<mark>$1</mark>");
}

function escapeRegExp(value) {
  return String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

async function selectSearchResult(ref) {
  if (!ref) {
    return;
  }
  const result = state.search.results.find((item) => item.ref === ref);
  if (result?.session) {
    appendSessions([result.session]);
    state.activeSource = visibleSourceKey(sessionEngine(result.session));
  }
  // Commit: the live preview may already show this session — reuse it if cached.
  closeSearchDialog(true);
  if (state.snapshotCache.has(ref)) {
    state.selected = ref;
    renderSessions();
    renderSnapshot(state.snapshotCache.get(ref));
    if (result?.turn) {
      focusTurn(result.turn);
    }
    return;
  }
  await selectSession(ref);
}

`;
