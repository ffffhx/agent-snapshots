// @ts-nocheck

export const stateUtilsJs = `
const state = {
  sessions: [],
  selected: "",
  activeSource: "codex",
  requestToken: 0,
  currentSnapshot: null,
  expandedProjects: new Set(),
  collapsedProjects: new Set(),
  hasMoreSessions: false,
  loadingMoreSessions: false,
  sessionListError: "",
  search: { open: false, query: "", scope: "all", cwd: "", scopeLabel: "全部历史", mode: "keyword", loading: false, results: [], rawResults: [], terms: [], matched: 0, scanned: 0, indexed: 0, indexedChunks: 0, updated: 0, pending: 0, failed: 0, model: "", error: "", requestToken: 0, active: 0, previewRef: "", restoreSelection: "", flags: { caseSensitive: false, wholeWord: false }, filters: null },
  semanticWarmup: { running: false, requestedStop: false, rounds: 0, scanned: 0, indexed: 0, indexedChunks: 0, updated: 0, totalUpdated: 0, pending: 0, failed: 0, model: "", error: "", complete: false },
  sessionSearch: { query: "", loading: false, results: [], chunkCount: 0, model: "", error: "", requestToken: 0 },
  transcriptMatch: { active: false, query: "", terms: [], matches: [], index: -1, timer: 0 },
  snapshotCache: new Map(),
  previewToken: 0,
  stats: null,
  statsQuota: null,
  statsActivity: null,
  statsWeeklyDigest: null,
  statsWeeklyDigestOpen: false,
  statsWeeklyDigestLoading: false,
  statsWeeklyDigestError: "",
  statsWeeklyDigestRequestToken: 0,
  statsInsights: null,
  statsInsightsLoading: false,
  statsInsightsError: "",
  statsFilter: "all",
  statsRequestToken: 0,
  statsRate: { in: 0, out: 0 },
  gallery: { open: false, source: "all", items: [], offset: 0, limit: 36, loading: false, hasMore: true, error: "", requestToken: 0, lightboxOpen: false, lightboxIndex: 0 },
  reading: { verbosity: "standard", outlineOpen: false, outlineItems: [], outlineVisible: new Set(), outlineTargets: new Map(), outlineActiveId: "", shortcutsOpen: false, settingsOpen: false, sidebarCollapsed: false, turnMeta: true },
  liveTail: { active: false, ref: "", timer: 0, token: 0, head: null, polling: false, following: true, needsFollowPrompt: false },
  notes: { ref: "", text: "", lastSavedText: "", updatedAt: "", open: false, editing: false, loading: false, saving: false, error: "", requestToken: 0, saveToken: 0 },
};
const SOURCE_MODULES = [
  { key: "codex", label: "Codex" },
  { key: "claude", label: "Claude Code" },
  { key: "trae", label: "Trae" },
];
const SESSION_BATCH_LIMIT = 200;
const LIVE_TAIL_INTERVAL_MS = 4000;
const LIVE_TAIL_BOTTOM_PX = 80;
const SEARCH_SCAN_LIMIT = 600;
const SEMANTIC_SEARCH_SCAN_LIMIT = 600;
const SEMANTIC_SEARCH_UPDATE_LIMIT = 24;
const SEMANTIC_PREWARM_SCAN_LIMIT = 1200;
const SEMANTIC_PREWARM_UPDATE_LIMIT = 120;
const SAFETY_CHECKS_ENABLED = false;
const SIDEBAR_WIDTH_KEY = "agent-snapshot.sidebar-width.v2";
const SIDEBAR_COLLAPSED_KEY = "agent-snapshot.sidebar-collapsed.v1";
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 460;
const THEME_KEY = "agent-snapshot.theme.v1";
const DENSITY_KEY = "agent-snapshot.density.v1";
const READ_SCALE_KEY = "agent-snapshot.read-scale.v1";
const VIEW_VERBOSITY_KEY = "agent-snapshot.view-verbosity.v1";
const OUTLINE_OPEN_KEY = "agent-snapshot.outline-open.v1";
const DEFAULT_VIEW_VERBOSITY_KEY = "agent-snapshot.default-view-verbosity.v1";
const DEFAULT_OUTLINE_OPEN_KEY = "agent-snapshot.default-outline-open.v1";
const TURN_META_KEY = "agent-snapshot.turn-meta.v1";
const THEMES = ["light", "sepia", "dark"];
const VIEW_VERBOSITIES = ["standard", "detailed", "summary"];
const VIEW_VERBOSITY_LABELS = { standard: "标准", detailed: "详细", summary: "摘要" };
const READ_SCALE_MIN = 0.85;
const READ_SCALE_MAX = 1.4;
const READ_SCALE_STEP = 0.05;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const shareConfig = window.AGENT_SNAPSHOT_SHARE_CONFIG || {};
const csrfToken = String(window.AGENT_SNAPSHOT_CSRF_TOKEN || "");

function renderLoading(message) {
  return "<div class='loading-state' role='status' aria-live='polite' aria-busy='true'>" +
    "<span class='loading-spinner' aria-hidden='true'></span>" +
    "<span>" + esc(message) + "</span>" +
  "</div>";
}

function showViewerLoading(message) {
  stopLiveTail({ silent: true });
  state.currentSnapshot = null;
  if (typeof dismissTranscriptMatchMode === "function") {
    dismissTranscriptMatchMode({ updateUrl: false });
  }
  clearSessionNoteState();
  resetSessionSearchState(false);
  renderSessionSearch();
  clearOutline("正在加载大纲...");
  $("title").textContent = "正在加载会话";
  $("meta").classList.add("empty");
  $("meta").classList.remove("loading");
  $("meta").removeAttribute("aria-busy");
  $("meta").textContent = "正在读取会话...";
  $("goal").innerHTML = "";
  $("risks").innerHTML = "";
  $("exports").innerHTML = "";
  $("turns").setAttribute("aria-busy", "true");
  $("turns").innerHTML = renderLoading(message || "正在加载...");
}

function activeOptions() {
  return new URLSearchParams({
    id: state.selected,
    includeTools: "1",
    includeToolOutput: "0",
    redact: $("redact").checked ? "1" : "0",
    safety: SAFETY_CHECKS_ENABLED ? "1" : "0",
  });
}

function selectedSession() {
  return state.sessions.find((session) => sessionRef(session) === state.selected) || null;
}

function searchScopeCwd() {
  return state.search.scope === "project" ? String(state.search.cwd || "").trim() : "";
}

function setSearchContext(context = {}) {
  const cwd = String(context.cwd || "").trim();
  const label = String(context.label || "").trim();
  const nextScope = cwd ? "project" : "all";
  const nextLabel = cwd ? "项目：" + (label || "当前项目") : "全部历史";
  const scopeChanged = state.search.scope !== nextScope || state.search.cwd !== cwd;
  state.search.scope = nextScope;
  state.search.cwd = cwd;
  state.search.scopeLabel = nextLabel;
  if (scopeChanged && !state.semanticWarmup.running) {
    resetSemanticWarmupState(false);
  }
  if (scopeChanged) {
    resetSearchResultsState();
  }
}

function openSearchDialog(context = {}) {
  setSearchContext(context);
  state.search.open = true;
  state.search.active = 0;
  state.search.previewRef = "";
  state.search.restoreSelection = state.selected;
  $("searchOverlay").hidden = false;
  document.body.classList.add("search-open");
  renderSearch();
  beginFocusTrap("search", $("searchOverlay"), { initialFocus: () => $("globalSearch"), close: () => closeSearchDialog(false) });
  if ($("globalSearch").value.trim()) {
    scheduleSearch(0);
  }
  setTimeout(() => {
    $("globalSearch").focus();
    $("globalSearch").select();
  }, 0);
}

function closeSearchDialog(commit = false) {
  state.search.open = false;
  $("searchOverlay").hidden = true;
  document.body.classList.remove("search-open");
  endFocusTrap("search");
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = 0;
  }
  if (!commit && state.search.previewRef) {
    // The live preview swapped the reader; restore what the user was looking at.
    const restore = state.search.restoreSelection;
    if (restore && restore !== state.selected) {
      previewSession(restore);
    } else if (!restore) {
      clearViewer();
    }
  }
  state.search.previewRef = "";
}

function isKeyboardActivation(event) {
  return event.key === "Enter" || event.key === " ";
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
  "[contenteditable='']",
].join(",");
const focusTraps = new Map();
let focusTrapStack = [];

function isVisibleElement(element) {
  return Boolean(element && element.isConnected && !element.closest("[hidden]") && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
}

function focusableWithin(container) {
  if (!container || typeof container.querySelectorAll !== "function") {
    return [];
  }
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    if (!(element instanceof HTMLElement) || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    return isVisibleElement(element);
  });
}

function safeFocus(element) {
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    return false;
  }
  try {
    element.focus({ preventScroll: true });
  } catch (_error) {
    element.focus();
  }
  return document.activeElement === element;
}

function activeFocusTrap() {
  for (let index = focusTrapStack.length - 1; index >= 0; index -= 1) {
    const name = focusTrapStack[index];
    const trap = focusTraps.get(name);
    if (trap && trap.container && isVisibleElement(trap.container)) {
      return { name, ...trap };
    }
  }
  return null;
}

function beginFocusTrap(name, container, options = {}) {
  if (!container) {
    return;
  }
  endFocusTrap(name, { restore: false });
  const restoreFocus = options.restoreFocus === undefined ? document.activeElement : options.restoreFocus;
  focusTraps.set(name, {
    container,
    close: typeof options.close === "function" ? options.close : null,
    initialFocus: options.initialFocus || null,
    restoreFocus: restoreFocus instanceof HTMLElement && restoreFocus !== document.body ? restoreFocus : null,
  });
  focusTrapStack = focusTrapStack.filter((item) => item !== name).concat(name);
  window.setTimeout(() => {
    const trap = activeFocusTrap();
    if (!trap || trap.name !== name) {
      return;
    }
    const initial = typeof trap.initialFocus === "function" ? trap.initialFocus() : trap.initialFocus;
    const target = initial instanceof HTMLElement && isVisibleElement(initial)
      ? initial
      : focusableWithin(trap.container)[0];
    if (target) {
      safeFocus(target);
    } else {
      safeFocus(trap.container);
    }
  }, 0);
}

function endFocusTrap(name, options = {}) {
  const trap = focusTraps.get(name);
  focusTraps.delete(name);
  focusTrapStack = focusTrapStack.filter((item) => item !== name);
  if (!trap) {
    return;
  }
  if (options.restore === false) {
    return;
  }
  const restore = trap?.restoreFocus;
  if (restore && isVisibleElement(restore)) {
    safeFocus(restore);
    return;
  }
  safeFocus($("turns"));
}

function isOverlayOpen() {
  return Boolean(activeFocusTrap());
}

document.addEventListener("keydown", (event) => {
  const trap = activeFocusTrap();
  if (!trap) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    trap.close?.();
    return;
  }
  if (event.key !== "Tab") {
    return;
  }
  const focusable = focusableWithin(trap.container);
  event.preventDefault();
  event.stopPropagation();
  if (!focusable.length) {
    safeFocus(trap.container);
    return;
  }
  const currentIndex = focusable.indexOf(document.activeElement);
  const nextIndex = event.shiftKey
    ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
    : (currentIndex < 0 || currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1);
  safeFocus(focusable[nextIndex]);
}, true);

`;
