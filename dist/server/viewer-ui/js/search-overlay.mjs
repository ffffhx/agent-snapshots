// @ts-nocheck
import { MUTATION_CSRF_HEADER } from "../../local-security.js";
export const searchOverlayJs = `const SEARCH_HISTORY_KEY = "agent-snapshot.search-history.v1";
const SAVED_SEARCHES_KEY = "agent-snapshot.saved-searches.v1";
const SEARCH_HISTORY_LIMIT = 20;
const SEARCH_HISTORY_VISIBLE_LIMIT = 8;
const SAVED_SEARCH_LIMIT = 12;

function normalizeSearchHistory(items, query = "", limit = 20) {
  const source = [];
  const nextQuery = String(query || "").trim();
  if (nextQuery) {
    source.push(nextQuery);
  }
  if (Array.isArray(items)) {
    for (const item of items) {
      const value = typeof item === "string" ? item : item?.query;
      const text = String(value || "").trim();
      if (text) {
        source.push(text);
      }
    }
  }
  const seen = new Set();
  const normalized = [];
  for (const text of source) {
    if (seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized;
}

function savedSearchSnapshot(query, searchState = {}) {
  const flags = searchState.flags || {};
  return {
    query: String(query || "").trim(),
    mode: searchState.mode === "semantic" ? "semantic" : "keyword",
    flags: {
      caseSensitive: !!flags.caseSensitive,
      wholeWord: !!flags.wholeWord,
    },
  };
}

function savedSearchIdentity(item) {
  const snapshot = savedSearchSnapshot(item?.query || "", item || {});
  return [
    snapshot.query,
    snapshot.mode,
    snapshot.flags.caseSensitive ? "1" : "0",
    snapshot.flags.wholeWord ? "1" : "0",
  ].join("\\u001f");
}

function normalizeSavedSearchItem(item) {
  const snapshot = savedSearchSnapshot(item?.query || "", item || {});
  if (!snapshot.query) {
    return null;
  }
  const id = String(item?.id || "").trim();
  return {
    id,
    name: String(item?.name || snapshot.query).trim() || snapshot.query,
    query: snapshot.query,
    mode: snapshot.mode,
    flags: snapshot.flags,
    createdAt: Number(item?.createdAt || item?.updatedAt || 0) || 0,
    updatedAt: Number(item?.updatedAt || item?.createdAt || 0) || 0,
  };
}

function sanitizeSavedSearches(items, limit = 12) {
  if (!Array.isArray(items)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const saved = normalizeSavedSearchItem(item);
    if (!saved) {
      continue;
    }
    const key = savedSearchIdentity(saved);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(saved);
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized;
}

function savedSearchItemFromSnapshot(snapshot, existingIds, now) {
  const base = "saved-" + Math.max(1, Math.floor(Number(now) || Date.now()));
  let id = base;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = base + "-" + suffix;
    suffix += 1;
  }
  return {
    id,
    name: snapshot.query,
    query: snapshot.query,
    mode: snapshot.mode,
    flags: snapshot.flags,
    createdAt: Number(now) || Date.now(),
    updatedAt: Number(now) || Date.now(),
  };
}

function addSavedSearch(items, snapshotInput, limit = 12, now = Date.now()) {
  const snapshot = savedSearchSnapshot(snapshotInput?.query || "", snapshotInput || {});
  const current = sanitizeSavedSearches(items, limit);
  if (!snapshot.query) {
    return current;
  }
  const key = savedSearchIdentity(snapshot);
  const existingIndex = current.findIndex((item) => savedSearchIdentity(item) === key);
  if (existingIndex >= 0) {
    const [existing] = current.splice(existingIndex, 1);
    current.unshift({
      ...existing,
      query: snapshot.query,
      mode: snapshot.mode,
      flags: snapshot.flags,
      updatedAt: Number(now) || Date.now(),
    });
    return current.slice(0, limit);
  }
  const existingIds = new Set(current.map((item) => item.id).filter(Boolean));
  current.unshift(savedSearchItemFromSnapshot(snapshot, existingIds, now));
  return current.slice(0, limit);
}

function removeSavedSearch(items, id, limit = 12) {
  const wanted = String(id || "");
  return sanitizeSavedSearches(items, limit).filter((item) => item.id !== wanted);
}

function updateSavedSearchName(items, id, name, limit = 12) {
  const wanted = String(id || "");
  const nextName = String(name || "").trim();
  if (!wanted || !nextName) {
    return sanitizeSavedSearches(items, limit);
  }
  return sanitizeSavedSearches(items, limit).map((item) => (
    item.id === wanted ? { ...item, name: nextName, updatedAt: Date.now() } : item
  ));
}

function ensureSearchMemoryState() {
  if (!Array.isArray(state.search.history)) {
    try {
      state.search.history = normalizeSearchHistory(JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]"), "", SEARCH_HISTORY_LIMIT);
    } catch {
      state.search.history = [];
    }
  }
  if (!Array.isArray(state.search.savedSearches)) {
    try {
      state.search.savedSearches = sanitizeSavedSearches(JSON.parse(localStorage.getItem(SAVED_SEARCHES_KEY) || "[]"), SAVED_SEARCH_LIMIT);
    } catch {
      state.search.savedSearches = [];
    }
  }
}

function writeSearchHistory() {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(state.search.history || []));
  } catch {}
}

function writeSavedSearches() {
  try {
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(state.search.savedSearches || []));
  } catch {}
}

function persistExecutedSearchQuery(query) {
  ensureSearchMemoryState();
  const next = normalizeSearchHistory(state.search.history, query, SEARCH_HISTORY_LIMIT);
  if (next.join("\\n") === (state.search.history || []).join("\\n")) {
    return;
  }
  state.search.history = next;
  writeSearchHistory();
}

function resetSearchResultsState() {
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
    const key = /claude/i.test(label) ? "claude" : "codex";
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

function ensureSearchMemoryUi() {
  const input = $("globalSearch");
  if (!input) {
    return;
  }
  let row = input.closest(".search-input-row");
  if (!row) {
    row = document.createElement("div");
    row.className = "search-input-row";
    input.parentNode.insertBefore(row, input);
    row.appendChild(input);
  }
  if (!$("saveSearch")) {
    const button = document.createElement("button");
    button.id = "saveSearch";
    button.className = "search-save-button";
    button.type = "button";
    button.setAttribute("aria-label", "保存当前搜索");
    button.title = "保存当前搜索";
    button.textContent = "☆";
    row.appendChild(button);
    button.addEventListener("click", saveCurrentSearch);
  }
  if (!$("searchMemory")) {
    const memory = document.createElement("div");
    memory.id = "searchMemory";
    memory.className = "search-memory";
    memory.setAttribute("aria-label", "保存和最近搜索");
    row.parentNode.insertBefore(memory, row.nextSibling);
    memory.addEventListener("click", handleSearchMemoryClick);
    memory.addEventListener("dblclick", handleSearchMemoryDblClick);
    memory.addEventListener("contextmenu", handleSearchMemoryContextMenu);
    memory.addEventListener("mousemove", handleSearchMemoryMouseMove);
  }
  if (!state.search.memoryKeyHandlerReady) {
    input.addEventListener("keydown", handleSearchInputMemoryEnter, true);
    state.search.memoryKeyHandlerReady = true;
  }
  input.setAttribute("aria-controls", "searchMemory searchResults");
}

function searchNavigationNodes() {
  return Array.from(document.querySelectorAll("[data-search-index]"));
}

function activeSearchNode() {
  return searchNavigationNodes().find((node) => Number(node.dataset.searchIndex) === state.search.active) || null;
}

function activeSearchNodeIsResult() {
  const node = activeSearchNode();
  return !!node && (node.dataset.searchKind === "result" || !!node.dataset.searchResult);
}

function updateSaveSearchButton() {
  const button = $("saveSearch");
  const input = $("globalSearch");
  if (!button || !input) {
    return;
  }
  ensureSearchMemoryState();
  const query = input.value.trim();
  const snapshot = savedSearchSnapshot(query, state.search);
  const saved = !!query && (state.search.savedSearches || []).some((item) => savedSearchIdentity(item) === savedSearchIdentity(snapshot));
  button.disabled = !query;
  button.textContent = saved ? "★" : "☆";
  button.setAttribute("aria-pressed", saved ? "true" : "false");
  button.title = saved ? "已保存当前搜索" : "保存当前搜索";
}

function saveCurrentSearch() {
  const input = $("globalSearch");
  const query = input ? input.value.trim() : "";
  if (!query) {
    showToast("先输入搜索内容", true);
    return;
  }
  ensureSearchMemoryState();
  state.search.savedSearches = addSavedSearch(
    state.search.savedSearches,
    savedSearchSnapshot(query, state.search),
    SAVED_SEARCH_LIMIT,
  );
  writeSavedSearches();
  renderSearch();
  showToast("已保存搜索", false);
}

function renderSavedSearchLabel(item) {
  const mode = item.mode === "semantic" ? "语义" : "关键词";
  const flags = [
    item.flags?.caseSensitive ? "Aa" : "",
    item.flags?.wholeWord ? "词" : "",
  ].filter(Boolean).join(" ");
  return flags ? mode + " · " + flags : mode;
}

function renderSearchMemory() {
  ensureSearchMemoryUi();
  ensureSearchMemoryState();
  updateSaveSearchButton();
  const memory = $("searchMemory");
  const input = $("globalSearch");
  if (!memory || !input || input.value.trim()) {
    if (memory) {
      memory.innerHTML = "";
    }
    return 0;
  }

  const saved = state.search.savedSearches || [];
  const history = (state.search.history || []).slice(0, SEARCH_HISTORY_VISIBLE_LIMIT);
  if (!saved.length && !history.length) {
    memory.innerHTML = "";
    return 0;
  }

  let index = 0;
  const html = [];
  if (saved.length) {
    html.push("<section class='search-memory-section search-saved-section' aria-label='保存的搜索'>");
    html.push("<div class='search-memory-title'>保存的搜索</div>");
    html.push("<div class='saved-search-chips'>");
    for (const item of saved) {
      const active = index === state.search.active;
      html.push("<div class='saved-search-chip" + (active ? " active" : "") + "' role='option' id='search-memory-" + index + "' aria-selected='" + (active ? "true" : "false") + "' data-search-kind='saved' data-search-index='" + index + "' data-search-saved-id='" + esc(item.id) + "' title='双击重命名，右键删除'>" +
        "<span class='saved-search-name'>" + esc(item.name || item.query) + "</span>" +
        "<small>" + esc(renderSavedSearchLabel(item)) + "</small>" +
        "<button type='button' class='search-memory-remove' data-search-memory-remove='saved' aria-label='删除保存的搜索'>×</button>" +
      "</div>");
      index += 1;
    }
    html.push("</div></section>");
  }
  if (history.length) {
    html.push("<section class='search-memory-section search-history-section' aria-label='最近搜索'>");
    html.push("<div class='search-memory-head'><div class='search-memory-title'>最近搜索</div><button type='button' class='search-memory-clear' data-search-history-clear='1'>清空</button></div>");
    html.push("<div class='search-history-list'>");
    for (const query of history) {
      const active = index === state.search.active;
      html.push("<div class='search-history-row" + (active ? " active" : "") + "' role='option' id='search-memory-" + index + "' aria-selected='" + (active ? "true" : "false") + "' data-search-kind='history' data-search-index='" + index + "' data-search-history-query='" + esc(query) + "'>" +
        "<span>" + esc(query) + "</span>" +
        "<button type='button' class='search-memory-remove' data-search-memory-remove='history' aria-label='删除最近搜索'>×</button>" +
      "</div>");
      index += 1;
    }
    html.push("</div></section>");
  }
  if (state.search.active >= index || state.search.active < 0) {
    state.search.active = 0;
  }
  memory.innerHTML = html.join("");
  return index;
}

function applyHistorySearch(query) {
  const input = $("globalSearch");
  const value = String(query || "").trim();
  if (!input || !value) {
    return;
  }
  input.value = value;
  state.search.query = value;
  state.search.active = 0;
  resetSearchResultsState();
  input.focus();
  renderSearch();
  scheduleSearch(0);
}

function applySavedSearch(id) {
  ensureSearchMemoryState();
  const item = (state.search.savedSearches || []).find((entry) => entry.id === String(id || ""));
  const input = $("globalSearch");
  if (!item || !input) {
    return;
  }
  input.value = item.query;
  state.search.query = item.query;
  state.search.mode = item.mode === "semantic" ? "semantic" : "keyword";
  state.search.flags.caseSensitive = !!item.flags?.caseSensitive;
  state.search.flags.wholeWord = !!item.flags?.wholeWord;
  state.search.active = 0;
  resetSearchResultsState();
  input.focus();
  renderSearch();
  scheduleSearch(0);
}

function removeHistoryQuery(query) {
  ensureSearchMemoryState();
  const value = String(query || "").trim();
  state.search.history = (state.search.history || []).filter((item) => item !== value);
  writeSearchHistory();
  renderSearch();
}

function clearSearchHistory() {
  ensureSearchMemoryState();
  state.search.history = [];
  writeSearchHistory();
  renderSearch();
}

function removeSavedSearchById(id) {
  ensureSearchMemoryState();
  state.search.savedSearches = removeSavedSearch(state.search.savedSearches, id, SAVED_SEARCH_LIMIT);
  writeSavedSearches();
  renderSearch();
}

function runSearchNavigationNode(node) {
  if (!node) {
    return;
  }
  if (node.dataset.searchKind === "history") {
    applyHistorySearch(node.dataset.searchHistoryQuery);
    return;
  }
  if (node.dataset.searchKind === "saved") {
    applySavedSearch(node.dataset.searchSavedId);
    return;
  }
  if (node.dataset.searchResult) {
    selectSearchResult(node.dataset.searchResult);
  }
}

function handleSearchMemoryClick(event) {
  const clear = event.target.closest("[data-search-history-clear]");
  if (clear) {
    event.preventDefault();
    clearSearchHistory();
    return;
  }
  const remove = event.target.closest("[data-search-memory-remove]");
  if (remove) {
    const holder = remove.closest("[data-search-index]");
    if (!holder) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (holder.dataset.searchKind === "history") {
      removeHistoryQuery(holder.dataset.searchHistoryQuery);
    } else if (holder.dataset.searchKind === "saved") {
      removeSavedSearchById(holder.dataset.searchSavedId);
    }
    return;
  }
  const item = event.target.closest("[data-search-index]");
  if (item) {
    runSearchNavigationNode(item);
  }
}

function handleSearchMemoryDblClick(event) {
  const item = event.target.closest("[data-search-saved-id]");
  if (!item || event.target.closest("[data-search-memory-remove]")) {
    return;
  }
  event.preventDefault();
  ensureSearchMemoryState();
  const saved = (state.search.savedSearches || []).find((entry) => entry.id === item.dataset.searchSavedId);
  if (!saved) {
    return;
  }
  const nextName = window.prompt("重命名保存的搜索", saved.name || saved.query);
  if (nextName == null) {
    return;
  }
  state.search.savedSearches = updateSavedSearchName(state.search.savedSearches, saved.id, nextName, SAVED_SEARCH_LIMIT);
  writeSavedSearches();
  renderSearch();
}

function handleSearchMemoryContextMenu(event) {
  const item = event.target.closest("[data-search-saved-id]");
  if (!item) {
    return;
  }
  event.preventDefault();
  removeSavedSearchById(item.dataset.searchSavedId);
}

function handleSearchMemoryMouseMove(event) {
  const item = event.target.closest("[data-search-index]");
  if (!item) {
    return;
  }
  const index = Number(item.dataset.searchIndex);
  if (Number.isFinite(index) && index !== state.search.active) {
    state.search.active = index;
    updateSearchActive({ preview: activeSearchNodeIsResult(), scroll: false });
  }
}

function handleSearchInputMemoryEnter(event) {
  if (event.key !== "Enter") {
    return;
  }
  const node = activeSearchNode();
  if (!node || node.dataset.searchKind === "result" || node.dataset.searchResult) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  runSearchNavigationNode(node);
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
  persistExecutedSearchQuery(query);

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
    const response = await fetch((semanticMode ? "/api/semantic-search?" : "/api/search?") + params.toString(), { signal: AbortSignal.timeout(30000) });
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

  const memoryCount = renderSearchMemory();
  const globalInput = $("globalSearch");
  if (state.search.loading) {
    globalInput.removeAttribute("aria-activedescendant");
    $("searchResults").innerHTML = renderLoading("正在搜索会话...");
    return;
  }
  if (!globalInput.value.trim()) {
    if (memoryCount) {
      $("searchResults").innerHTML = "";
      updateSearchActive({ preview: false, scroll: false });
      updateSearchCount();
      return;
    }
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
  return "<div class='search-result" + (active ? " active" : "") + "' role='option' id='search-result-" + index + "' aria-selected='" + (active ? "true" : "false") + "' data-search-kind='result' data-search-index='" + index + "' data-search-result='" + esc(ref) + "'>" +
    "<strong class='search-result-title'>" + esc(title) + "</strong>" +
    "<span class='search-result-source'>" + esc(source) + "</span>" +
    "<span class='search-result-path'>" + esc(path) + "</span>" +
    "<p class='search-result-snippet'>" + snippet + "</p>" +
    "<span class='search-result-meta'>" + esc(label) + "</span>" +
    "<div class='search-result-actions'>" +
      "<button type='button' class='sr-act' data-sr-action='open' title='打开会话（↵）'>打开</button>" +
      "<button type='button' class='sr-act' data-sr-action='in-session' title='打开并在此会话内搜索'>会话内搜</button>" +
      "<button type='button' class='sr-act sr-act-orca' data-sr-action='resume-orca' title='在 Orca 中打开终端并恢复此会话'>↗ Orca 继续</button>" +
      "<button type='button' class='sr-act' data-sr-action='export-html' title='导出为 HTML'>导出 HTML</button>" +
      "<button type='button' class='sr-act' data-sr-action='copy-path' title='复制项目路径'>复制路径</button>" +
    "</div>" +
  "</div>";
}

function updateSearchActive(options = {}) {
  const nodes = searchNavigationNodes();
  const input = $("globalSearch");
  if (!nodes.length) {
    if (input) {
      input.removeAttribute("aria-activedescendant");
    }
    return;
  }
  if (state.search.active >= nodes.length || state.search.active < 0) {
    state.search.active = 0;
  }
  let activeNode = null;
  nodes.forEach((node) => {
    const index = Number(node.dataset.searchIndex);
    const active = index === state.search.active;
    node.classList.toggle("active", active);
    node.setAttribute("aria-selected", active ? "true" : "false");
    if (active) {
      activeNode = node;
      if (input) {
        input.setAttribute("aria-activedescendant", node.id);
      }
      if (options.scroll !== false) {
        node.scrollIntoView({ block: "nearest" });
      }
    }
  });
  if (options.preview && activeNode && (activeNode.dataset.searchKind === "result" || activeNode.dataset.searchResult)) {
    schedulePreview();
  }
}

function moveSearchActive(delta) {
  const nodes = searchNavigationNodes();
  if (!nodes.length) {
    return;
  }
  const count = nodes.length;
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

function tokenizeMatchTerms(value) {
  const tokens = String(value || "").match(/[^\\s"]*"[^"]*"[^\\s"]*|[^\\s]+/g) || [];
  const terms = [];
  const seen = new Set();
  for (const token of tokens) {
    const term = String(token || "").replace(/^"|"$/g, "").replace(/"/g, "").trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push(term);
  }
  return terms.slice(0, 12);
}

function matchTermsFromQuery(query) {
  const parsed = parseSearchQuery(String(query || ""));
  return tokenizeMatchTerms(parsed.text || query);
}

function searchResultMatchTerms(result) {
  const terms = Array.isArray(result?.terms) && result.terms.length
    ? result.terms
    : (state.search.terms || []);
  const normalized = tokenizeMatchTerms(terms.join(" "));
  if (normalized.length) {
    return normalized;
  }
  return matchTermsFromQuery(state.search.query || $("globalSearch")?.value || "");
}

function transcriptMatchBody(node) {
  if (!node || typeof node.querySelector !== "function") {
    return null;
  }
  return node.querySelector(".body") || node;
}

function isSummaryHiddenTranscriptNode(node) {
  if (document.body.getAttribute("data-view-verbosity") !== "summary") {
    return false;
  }
  return node.classList.contains("process-entry")
    || node.classList.contains("process")
    || node.classList.contains("tool")
    || node.classList.contains("interrupt")
    || Boolean(node.closest(".process, .tool, .interrupt, .subagents"));
}

function isTranscriptMatchCandidate(node) {
  return node instanceof HTMLElement
    && node.hasAttribute("data-turn-number")
    && !node.classList.contains("turns-hydrating")
    && !node.closest("[hidden]")
    && !node.closest(".subagents")
    && !isSummaryHiddenTranscriptNode(node)
    && Boolean(transcriptMatchBody(node)?.textContent?.trim());
}

function transcriptMatchCandidates() {
  const container = $("turns");
  if (!container) {
    return [];
  }
  return Array.from(container.querySelectorAll(".turn[data-turn-number], .process-entry[data-turn-number]"))
    .filter(isTranscriptMatchCandidate);
}

function transcriptNodeMatchTerm(node, terms) {
  const body = transcriptMatchBody(node);
  const hay = String(body?.textContent || "").toLowerCase();
  if (!hay) {
    return "";
  }
  for (const term of terms) {
    const needle = String(term || "").toLowerCase();
    if (needle && hay.includes(needle)) {
      return term;
    }
  }
  return "";
}

function clearTranscriptMatchMarks(root = document) {
  const marks = root?.querySelectorAll ? Array.from(root.querySelectorAll("mark[data-transcript-match-mark]")) : [];
  for (const mark of marks) {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent || ""));
    parent?.normalize?.();
  }
}

function markTranscriptTerms(root, terms) {
  if (!root || !terms.length) {
    return;
  }
  const needles = terms.slice().sort((a, b) => b.length - a.length);
  const pattern = needles.map(escapeRegExp).join("|");
  if (!pattern) {
    return;
  }
  const matcher = new RegExp("(" + pattern + ")", "gi");
  const lowerNeedles = needles.map((term) => term.toLowerCase());
  const nodeFilter = window.NodeFilter || { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 };
  const walker = document.createTreeWalker(root, nodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.nodeValue || "";
      if (!value.trim() || !matcher.test(value)) {
        matcher.lastIndex = 0;
        return nodeFilter.FILTER_REJECT;
      }
      matcher.lastIndex = 0;
      const parent = node.parentElement;
      if (!parent || parent.closest("mark[data-transcript-match-mark]")) {
        return nodeFilter.FILTER_REJECT;
      }
      return nodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }
  for (const textNode of textNodes) {
    const text = textNode.nodeValue || "";
    const parts = text.split(matcher);
    if (parts.length <= 1) {
      continue;
    }
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (!part) {
        continue;
      }
      if (lowerNeedles.includes(part.toLowerCase())) {
        const mark = document.createElement("mark");
        mark.className = "transcript-match-mark";
        mark.dataset.transcriptMatchMark = "1";
        mark.textContent = part;
        fragment.appendChild(mark);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    }
    textNode.replaceWith(fragment);
  }
}

function markTranscriptMatches() {
  clearTranscriptMatchMarks();
  for (const node of state.transcriptMatch.matches || []) {
    markTranscriptTerms(transcriptMatchBody(node), state.transcriptMatch.terms || []);
  }
}

function updateTranscriptMatchIndicator() {
  const nav = $("matchNav");
  const count = $("matchNavCount");
  if (!nav || !count) {
    return;
  }
  const total = state.transcriptMatch.matches.length;
  if (!state.transcriptMatch.active || !total) {
    nav.hidden = true;
    count.textContent = "0/0 匹配";
    return;
  }
  nav.hidden = false;
  const index = Math.max(0, state.transcriptMatch.index);
  count.textContent = (index + 1) + "/" + total + " 匹配";
}

function setSessionDeepLink(ref, query) {
  if (!window.history || !ref) {
    return;
  }
  const params = new URLSearchParams(location.search);
  params.set("session", ref);
  const q = String(query || "").trim();
  if (q) {
    params.set("q", q);
  } else {
    params.delete("q");
  }
  const next = location.pathname + (params.toString() ? "?" + params.toString() : "");
  history.replaceState({}, "", next);
}

function clearTranscriptMatchUrlParam() {
  if (!window.history) {
    return;
  }
  const params = new URLSearchParams(location.search);
  if (!params.has("q")) {
    return;
  }
  params.delete("q");
  const next = location.pathname + (params.toString() ? "?" + params.toString() : "");
  history.replaceState({}, "", next);
}

function dismissTranscriptMatchMode(options = {}) {
  if (state.transcriptMatch.timer) {
    clearTimeout(state.transcriptMatch.timer);
  }
  document.querySelectorAll(".transcript-match-current, .transcript-match-flash").forEach((node) => {
    node.classList.remove("transcript-match-current", "transcript-match-flash");
  });
  clearTranscriptMatchMarks();
  state.transcriptMatch = { active: false, query: "", terms: [], matches: [], index: -1, timer: 0 };
  updateTranscriptMatchIndicator();
  if (options.updateUrl) {
    clearTranscriptMatchUrlParam();
  }
}

function refreshTranscriptMatches(options = {}) {
  if (!state.transcriptMatch.active) {
    return false;
  }
  const previous = state.transcriptMatch.matches[state.transcriptMatch.index] || null;
  document.querySelectorAll(".transcript-match-current, .transcript-match-flash").forEach((node) => {
    node.classList.remove("transcript-match-current", "transcript-match-flash");
  });
  clearTranscriptMatchMarks();
  const terms = state.transcriptMatch.terms || [];
  state.transcriptMatch.matches = transcriptMatchCandidates().filter((node) => transcriptNodeMatchTerm(node, terms));
  if (!state.transcriptMatch.matches.length) {
    state.transcriptMatch.index = -1;
    updateTranscriptMatchIndicator();
    return false;
  }
  const previousIndex = previous ? state.transcriptMatch.matches.indexOf(previous) : -1;
  state.transcriptMatch.index = options.keepCurrent && previousIndex >= 0
    ? previousIndex
    : Math.max(0, Math.min(state.transcriptMatch.index, state.transcriptMatch.matches.length - 1));
  markTranscriptMatches();
  updateTranscriptMatchIndicator();
  return true;
}

function flashTranscriptMatch(node) {
  document.querySelectorAll(".transcript-match-current, .transcript-match-flash").forEach((item) => {
    item.classList.remove("transcript-match-current", "transcript-match-flash");
  });
  node.classList.add("transcript-match-current", "transcript-match-flash");
  if (state.transcriptMatch.timer) {
    clearTimeout(state.transcriptMatch.timer);
  }
  state.transcriptMatch.timer = window.setTimeout(() => {
    node.classList.remove("transcript-match-flash");
    state.transcriptMatch.timer = 0;
  }, 2200);
}

function scrollTranscriptMatchIndex(index) {
  const matches = state.transcriptMatch.matches || [];
  if (!matches.length) {
    updateTranscriptMatchIndicator();
    return false;
  }
  const nextIndex = (index + matches.length) % matches.length;
  state.transcriptMatch.index = nextIndex;
  const target = matches[nextIndex];
  const details = target.closest("details");
  if (details) {
    details.open = true;
  }
  target.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  flashTranscriptMatch(target);
  updateTranscriptMatchIndicator();
  return true;
}

function startTranscriptMatchMode(terms, options = {}) {
  const normalized = tokenizeMatchTerms((terms || []).join ? terms.join(" ") : terms);
  if (!normalized.length) {
    dismissTranscriptMatchMode({ updateUrl: false });
    return false;
  }
  if (options.flush !== false) {
    flushTranscriptHydration();
  }
  state.transcriptMatch.active = true;
  state.transcriptMatch.query = String(options.query || normalized.join(" "));
  state.transcriptMatch.terms = normalized;
  state.transcriptMatch.index = 0;
  if (!refreshTranscriptMatches({ keepCurrent: false })) {
    dismissTranscriptMatchMode({ updateUrl: false });
    return false;
  }
  const targetTurn = String(options.targetTurn || "");
  if (targetTurn) {
    const targetIndex = state.transcriptMatch.matches.findIndex((node) => node.getAttribute("data-turn-number") === targetTurn);
    if (targetIndex >= 0) {
      state.transcriptMatch.index = targetIndex;
    }
  }
  if (options.updateUrl && state.selected) {
    setSessionDeepLink(state.selected, state.transcriptMatch.query);
  }
  if (options.autoScroll !== false) {
    scrollTranscriptMatchIndex(state.transcriptMatch.index);
  } else {
    updateTranscriptMatchIndicator();
  }
  return true;
}

function startTranscriptMatchModeFromQuery(query, options = {}) {
  return startTranscriptMatchMode(matchTermsFromQuery(query), { ...options, query: String(query || "") });
}

function jumpTranscriptMatch(direction) {
  if (!state.transcriptMatch.active) {
    return false;
  }
  if (!refreshTranscriptMatches({ keepCurrent: true })) {
    showToast("当前视图没有匹配项", true);
    return false;
  }
  return scrollTranscriptMatchIndex(state.transcriptMatch.index + direction);
}

function jumpSessionSearchResult(turn) {
  const query = state.sessionSearch.query || $("sessionSearchInput")?.value || "";
  if (!startTranscriptMatchModeFromQuery(query, { targetTurn: turn, autoScroll: true })) {
    focusTurn(turn);
  }
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
  const terms = searchResultMatchTerms(result);
  const query = terms.join(" ");
  if (result?.session) {
    appendSessions([result.session]);
    state.activeSource = visibleSourceKey(sessionEngine(result.session));
  }
  // Commit: the live preview may already show this session — reuse it if cached.
  closeSearchDialog(true);
  setSessionDeepLink(ref, query);
  if (state.snapshotCache.has(ref)) {
    state.selected = ref;
    renderSessions();
    renderSnapshot(state.snapshotCache.get(ref));
    if (!startTranscriptMatchMode(terms, { query, updateUrl: false }) && result?.turn) {
      focusTurn(result.turn);
    }
    return;
  }
  await selectSession(ref);
  if (state.selected === ref && !startTranscriptMatchMode(terms, { query, updateUrl: false }) && result?.turn) {
    focusTurn(result.turn);
  }
}

`;
