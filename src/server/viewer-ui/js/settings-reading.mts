// @ts-nocheck

export const settingsReadingJs = `function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sidebarMaxWidth() {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - 520));
}

function currentSidebarWidth() {
  const sidebar = document.querySelector(".sidebar");
  return sidebar ? sidebar.getBoundingClientRect().width : 360;
}

function setSidebarWidth(value, persist) {
  if (window.matchMedia("(max-width: 900px)").matches) {
    return;
  }
  const width = Math.round(clampNumber(Number(value) || currentSidebarWidth(), SIDEBAR_MIN, sidebarMaxWidth()));
  document.documentElement.style.setProperty("--sidebar-width", width + "px");
  const splitter = $("splitter");
  if (splitter) {
    splitter.setAttribute("aria-valuenow", String(width));
    splitter.setAttribute("aria-valuetext", width + "px");
  }
  if (persist) {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }
}

function currentSidebarCollapsed() {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

function setSidebarCollapsed(collapsed, persist = true) {
  state.reading.sidebarCollapsed = Boolean(collapsed);
  document.body.setAttribute("data-sidebar-collapsed", state.reading.sidebarCollapsed ? "true" : "false");
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    sidebar.setAttribute("aria-hidden", state.reading.sidebarCollapsed ? "true" : "false");
    if (state.reading.sidebarCollapsed && sidebar.contains(document.activeElement)) {
      safeFocus($("turns"));
    }
  }
  const splitter = $("splitter");
  if (splitter) {
    splitter.setAttribute("aria-label", state.reading.sidebarCollapsed ? "项目列表已收起，按 s 展开" : "调整项目列表宽度");
  }
  if (persist) {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, state.reading.sidebarCollapsed ? "1" : "0");
  }
}

function toggleSidebarCollapsed() {
  setSidebarCollapsed(!state.reading.sidebarCollapsed);
  showToast(state.reading.sidebarCollapsed ? "已收起侧栏" : "已展开侧栏", false);
}

function currentTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  return THEMES.includes(stored) ? stored : "light";
}

function setSettingsOpen(open, options = {}) {
  state.reading.settingsOpen = Boolean(open);
  const popover = $("settingsPopover");
  const toggle = $("settingsToggle");
  if (popover) {
    popover.hidden = !state.reading.settingsOpen;
  }
  if (toggle) {
    toggle.classList.toggle("active", state.reading.settingsOpen);
    toggle.setAttribute("aria-expanded", state.reading.settingsOpen ? "true" : "false");
  }
  if (state.reading.settingsOpen) {
    syncSettingsControls();
    beginFocusTrap("settings", popover, { initialFocus: () => $("settingsClose"), close: closeSettingsPopover });
  } else if (options.focus !== false) {
    endFocusTrap("settings");
    toggle?.focus();
  } else {
    endFocusTrap("settings");
  }
}

function closeSettingsPopover(options = {}) {
  if (!state.reading.settingsOpen) {
    return;
  }
  setSettingsOpen(false, options);
}

function applyTheme(theme) {
  const value = THEMES.includes(theme) ? theme : "light";
  document.documentElement.setAttribute("data-theme", value);
  localStorage.setItem(THEME_KEY, value);
  for (const button of document.querySelectorAll("[data-theme-set]")) {
    button.classList.toggle("active", button.dataset.themeSet === value);
  }
}

function currentDensity() {
  return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
}

function applyDensity(density) {
  const value = density === "compact" ? "compact" : "comfortable";
  document.documentElement.setAttribute("data-density", value);
  localStorage.setItem(DENSITY_KEY, value);
  for (const button of document.querySelectorAll("[data-density-set]")) {
    const active = button.dataset.densitySet === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  const toggle = document.querySelector("[data-density-toggle]");
  if (toggle) {
    toggle.classList.toggle("active", value === "compact");
    toggle.textContent = value === "compact" ? "疏" : "密";
    toggle.title = value === "compact" ? "当前紧凑，点击切换为宽松" : "当前宽松，点击切换为紧凑";
  }
}

function currentReadScale() {
  const stored = Number(localStorage.getItem(READ_SCALE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) {
    return 1;
  }
  return clampNumber(stored, READ_SCALE_MIN, READ_SCALE_MAX);
}

function applyReadScale(scale) {
  const value = clampNumber(Number(scale) || 1, READ_SCALE_MIN, READ_SCALE_MAX);
  const rounded = Math.round(value * 100) / 100;
  document.documentElement.style.setProperty("--read-scale", String(rounded));
  localStorage.setItem(READ_SCALE_KEY, String(rounded));
  const valueEl = $("readScaleValue");
  if (valueEl) {
    valueEl.textContent = Math.round(rounded * 100) + "%";
  }
}

function stepReadScale(direction) {
  applyReadScale(currentReadScale() + (direction < 0 ? -READ_SCALE_STEP : READ_SCALE_STEP));
}

function initAppearance() {
  applyTheme(currentTheme());
  applyDensity(currentDensity());
  applyReadScale(currentReadScale());
  $("settingsToggle")?.addEventListener("click", () => setSettingsOpen(!state.reading.settingsOpen, { focus: false }));
  $("settingsClose")?.addEventListener("click", () => closeSettingsPopover());
  document.addEventListener("click", (event) => {
    if (!state.reading.settingsOpen) {
      return;
    }
    if (event.target?.closest?.(".settings-shell")) {
      return;
    }
    closeSettingsPopover({ focus: false });
  });
  for (const button of document.querySelectorAll("[data-theme-set]")) {
    button.addEventListener("click", () => applyTheme(button.dataset.themeSet));
  }
  for (const button of document.querySelectorAll("[data-font-step]")) {
    button.addEventListener("click", () => stepReadScale(Number(button.dataset.fontStep) || 1));
  }
  for (const button of document.querySelectorAll("[data-density-set]")) {
    button.addEventListener("click", () => applyDensity(button.dataset.densitySet));
  }
  const density = document.querySelector("[data-density-toggle]");
  if (density) {
    density.addEventListener("click", () => applyDensity(currentDensity() === "compact" ? "comfortable" : "compact"));
  }
}

var outlineObserver = null;
var outlineRaf = 0;
var outlineRebuildTimer = 0;

function storedVerbosityChoice() {
  const stored = localStorage.getItem(VIEW_VERBOSITY_KEY);
  return VIEW_VERBOSITIES.includes(stored) ? stored : "";
}

function defaultVerbosity() {
  const stored = localStorage.getItem(DEFAULT_VIEW_VERBOSITY_KEY);
  return VIEW_VERBOSITIES.includes(stored) ? stored : "standard";
}

function currentVerbosity() {
  return storedVerbosityChoice() || defaultVerbosity();
}

function applyDefaultVerbosity(mode, options = {}) {
  const value = VIEW_VERBOSITIES.includes(mode) ? mode : "standard";
  localStorage.setItem(DEFAULT_VIEW_VERBOSITY_KEY, value);
  syncDefaultVerbosityControls(value);
  if (!storedVerbosityChoice()) {
    applyVerbosity(value, { persist: false });
  }
  if (options.toast) {
    showToast("默认视图已设为" + VIEW_VERBOSITY_LABELS[value], false);
  }
}

function applyVerbosity(mode, options = {}) {
  const value = VIEW_VERBOSITIES.includes(mode) ? mode : "standard";
  state.reading.verbosity = value;
  document.body.setAttribute("data-view-verbosity", value);
  if (options.persist !== false) {
    localStorage.setItem(VIEW_VERBOSITY_KEY, value);
  }
  for (const button of document.querySelectorAll("[data-view-verbosity]")) {
    const active = button.dataset.viewVerbosity === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (value === "detailed") {
    setTranscriptDetailsOpen(document, true);
  } else {
    setTranscriptDetailsOpen(document, false);
  }
  if (options.toast) {
    showToast("已切换为" + VIEW_VERBOSITY_LABELS[value] + "视图", false);
  }
  scheduleOutlineRebuild();
  if (typeof refreshTranscriptMatches === "function") {
    refreshTranscriptMatches({ keepCurrent: true });
  }
}

function syncDefaultVerbosityControls(value = defaultVerbosity()) {
  for (const button of document.querySelectorAll("[data-default-view-verbosity]")) {
    const active = button.dataset.defaultViewVerbosity === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function cycleVerbosity() {
  const index = VIEW_VERBOSITIES.indexOf(state.reading.verbosity);
  const next = VIEW_VERBOSITIES[(index + 1) % VIEW_VERBOSITIES.length] || "standard";
  applyVerbosity(next, { toast: true });
}

function setTranscriptDetailsOpen(root, open) {
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  for (const details of scope.querySelectorAll("#turns details.process-details, #turns details.tool-details, details.process-details, details.tool-details")) {
    details.open = Boolean(open);
  }
}

function applyVerbosityToContent(root) {
  if (state.reading.verbosity === "detailed") {
    setTranscriptDetailsOpen(root, true);
  }
}

function storedOutlineChoice() {
  const stored = localStorage.getItem(OUTLINE_OPEN_KEY);
  return stored === "1" || stored === "0" ? stored : "";
}

function defaultOutlineOpen() {
  return localStorage.getItem(DEFAULT_OUTLINE_OPEN_KEY) === "1";
}

function currentOutlineOpen() {
  const stored = storedOutlineChoice();
  return stored ? stored === "1" : defaultOutlineOpen();
}

function applyDefaultOutlineOpen(open, options = {}) {
  const value = Boolean(open);
  localStorage.setItem(DEFAULT_OUTLINE_OPEN_KEY, value ? "1" : "0");
  syncDefaultOutlineControls(value);
  if (!storedOutlineChoice()) {
    setOutlineOpen(value, false);
  }
  if (options.toast) {
    showToast(value ? "默认打开大纲" : "默认收起大纲", false);
  }
}

function syncDefaultOutlineControls(value = defaultOutlineOpen()) {
  const input = $("defaultOutlineOpen");
  if (input) {
    input.checked = Boolean(value);
  }
}

function currentTurnMetaEnabled() {
  return localStorage.getItem(TURN_META_KEY) !== "0";
}

function applyTurnMeta(enabled, options = {}) {
  state.reading.turnMeta = Boolean(enabled);
  document.body.setAttribute("data-turn-meta", state.reading.turnMeta ? "on" : "off");
  localStorage.setItem(TURN_META_KEY, state.reading.turnMeta ? "1" : "0");
  const input = $("turnMetaToggle");
  if (input) {
    input.checked = state.reading.turnMeta;
  }
  if (options.toast) {
    showToast(state.reading.turnMeta ? "已显示回合元信息" : "已隐藏回合元信息", false);
  }
}

function syncSettingsControls() {
  syncDefaultVerbosityControls();
  syncDefaultOutlineControls();
  applyTurnMeta(currentTurnMetaEnabled());
  applyDensity(currentDensity());
  applyReadScale(currentReadScale());
}

function afterTranscriptContentMutated(root, options = {}) {
  applyVerbosityToContent(root);
  if (options.rebuildOutline !== false) {
    scheduleOutlineRebuild();
  }
}

function setOutlineOpen(open, persist = true) {
  state.reading.outlineOpen = Boolean(open);
  document.body.setAttribute("data-outline-open", state.reading.outlineOpen ? "true" : "false");
  const panel = $("outlinePanel");
  if (panel) {
    panel.setAttribute("aria-hidden", state.reading.outlineOpen ? "false" : "true");
  }
  const toggle = $("toggleOutline");
  if (toggle) {
    toggle.classList.toggle("active", state.reading.outlineOpen);
    toggle.setAttribute("aria-pressed", state.reading.outlineOpen ? "true" : "false");
    toggle.textContent = state.reading.outlineOpen ? "收起大纲" : "打开大纲";
    toggle.title = state.reading.outlineOpen ? "收起大纲（Ctrl+M）" : "打开大纲（Ctrl+M）";
  }
  if (persist) {
    localStorage.setItem(OUTLINE_OPEN_KEY, state.reading.outlineOpen ? "1" : "0");
  }
  if (state.reading.outlineOpen) {
    scheduleOutlineRebuild();
  }
}

function toggleOutline() {
  setOutlineOpen(!state.reading.outlineOpen);
  showToast(state.reading.outlineOpen ? "已打开大纲" : "已收起大纲", false);
}

function clearOutline(message) {
  if (outlineObserver) {
    outlineObserver.disconnect();
    outlineObserver = null;
  }
  state.reading.outlineItems = [];
  state.reading.outlineVisible = new Set();
  state.reading.outlineTargets = new Map();
  state.reading.outlineActiveId = "";
  const list = $("outlineList");
  if (list) {
    list.innerHTML = "<div class='outline-empty'>" + esc(message || "当前会话暂无大纲") + "</div>";
  }
}

function scheduleOutlineRebuild() {
  if (outlineRebuildTimer) {
    clearTimeout(outlineRebuildTimer);
  }
  outlineRebuildTimer = window.setTimeout(() => {
    outlineRebuildTimer = 0;
    rebuildOutline();
  }, 40);
}

function rebuildOutline() {
  if (outlineObserver) {
    outlineObserver.disconnect();
    outlineObserver = null;
  }
  state.reading.outlineVisible = new Set();
  state.reading.outlineTargets = new Map();
  const container = $("turns");
  const list = $("outlineList");
  if (!container || !list) {
    return;
  }
  const items = [];
  for (const node of Array.from(container.children)) {
    if (!(node instanceof HTMLElement) || node.classList.contains("turns-hydrating")) {
      continue;
    }
    if (node.classList.contains("user") && node.hasAttribute("data-turn-number")) {
      const turn = node.getAttribute("data-turn-number") || "";
      const text = outlineText(node.querySelector(".body")?.textContent || node.textContent || "用户消息", "用户消息");
      items.push({ id: "turn-" + turn + "-" + items.length, type: "user", label: text, target: node });
      continue;
    }
    if (node.classList.contains("commit-card")) {
      const sha = String(node.getAttribute("data-commit-sha") || "").slice(0, 7);
      const subject = outlineText(node.querySelector(".commit-subject")?.textContent || "Git 提交", "Git 提交");
      items.push({ id: "commit-" + (sha || items.length) + "-" + items.length, type: "commit", label: (sha ? sha + " " : "") + subject, target: node });
    }
  }
  state.reading.outlineItems = items;
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = "<div class='outline-empty'>当前会话暂无大纲</div>";
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    item.target.setAttribute("data-outline-id", item.id);
    state.reading.outlineTargets.set(item.id, item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outline-item";
    button.dataset.outlineTarget = item.id;
    const kind = document.createElement("span");
    kind.className = "outline-kind";
    kind.textContent = item.type === "commit" ? "提交" : "用户";
    const text = document.createElement("span");
    text.className = "outline-text";
    text.textContent = item.label;
    button.appendChild(kind);
    button.appendChild(text);
    fragment.appendChild(button);
  }
  list.appendChild(fragment);
  const root = container.closest(".viewer") || null;
  if (typeof IntersectionObserver === "function") {
    outlineObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute("data-outline-id") || "";
        if (!id) {
          continue;
        }
        if (entry.isIntersecting) {
          state.reading.outlineVisible.add(id);
        } else {
          state.reading.outlineVisible.delete(id);
        }
      }
      scheduleActiveOutlineUpdate();
    }, { root, threshold: [0, 0.1, 0.5, 1] });
    for (const item of items) {
      outlineObserver.observe(item.target);
    }
  }
  updateActiveOutline();
}

function ensureOutlineObserver() {
  if (outlineObserver || typeof IntersectionObserver !== "function") {
    return;
  }
  const container = $("turns");
  const root = container?.closest(".viewer") || null;
  outlineObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.getAttribute("data-outline-id") || "";
      if (!id) {
        continue;
      }
      if (entry.isIntersecting) {
        state.reading.outlineVisible.add(id);
      } else {
        state.reading.outlineVisible.delete(id);
      }
    }
    scheduleActiveOutlineUpdate();
  }, { root, threshold: [0, 0.1, 0.5, 1] });
}

function appendOutlineEntriesForNodes(nodes) {
  const list = $("outlineList");
  if (!list || !Array.isArray(nodes) || !nodes.length) {
    return;
  }
  const entries = [];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || node.classList.contains("turns-hydrating")) {
      continue;
    }
    if (node.classList.contains("user") && node.hasAttribute("data-turn-number")) {
      const turn = node.getAttribute("data-turn-number") || "";
      const text = outlineText(node.querySelector(".body")?.textContent || node.textContent || "用户消息", "用户消息");
      entries.push({ id: "turn-" + turn + "-" + (state.reading.outlineItems.length + entries.length), type: "user", label: text, target: node });
      continue;
    }
    if (node.classList.contains("commit-card")) {
      const sha = String(node.getAttribute("data-commit-sha") || "").slice(0, 7);
      const subject = outlineText(node.querySelector(".commit-subject")?.textContent || "Git 提交", "Git 提交");
      entries.push({ id: "commit-" + (sha || entries.length) + "-" + (state.reading.outlineItems.length + entries.length), type: "commit", label: (sha ? sha + " " : "") + subject, target: node });
    }
  }
  if (!entries.length) {
    return;
  }
  const empty = list.querySelector(".outline-empty");
  if (empty) {
    list.innerHTML = "";
  }
  ensureOutlineObserver();
  const fragment = document.createDocumentFragment();
  for (const item of entries) {
    item.target.setAttribute("data-outline-id", item.id);
    state.reading.outlineItems.push(item);
    state.reading.outlineTargets.set(item.id, item);
    if (outlineObserver) {
      outlineObserver.observe(item.target);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outline-item";
    button.dataset.outlineTarget = item.id;
    const kind = document.createElement("span");
    kind.className = "outline-kind";
    kind.textContent = item.type === "commit" ? "提交" : "用户";
    const text = document.createElement("span");
    text.className = "outline-text";
    text.textContent = item.label;
    button.appendChild(kind);
    button.appendChild(text);
    fragment.appendChild(button);
  }
  list.appendChild(fragment);
  updateActiveOutline();
}

function outlineText(value, fallback = "用户消息") {
  const text = String(value || "").replace(/\\s+/g, " ").trim();
  if (!text) {
    return fallback;
  }
  return text.length > 60 ? text.slice(0, 60) + "..." : text;
}

function scheduleActiveOutlineUpdate() {
  if (outlineRaf) {
    return;
  }
  outlineRaf = window.requestAnimationFrame(() => {
    outlineRaf = 0;
    updateActiveOutline();
  });
}

function updateActiveOutline() {
  const items = state.reading.outlineItems.filter((item) => item.target && item.target.isConnected);
  if (!items.length) {
    return;
  }
  const visible = items.filter((item) => state.reading.outlineVisible.has(item.id));
  const best = nearestOutlineItem(visible.length ? visible : items);
  if (best) {
    setActiveOutlineItem(best.id, false);
  }
}

function nearestOutlineItem(items) {
  const viewer = document.querySelector(".viewer");
  const rect = viewer ? viewer.getBoundingClientRect() : { top: 0, height: window.innerHeight };
  const center = rect.top + rect.height * 0.38;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const itemRect = item.target.getBoundingClientRect();
    const distance = Math.abs(itemRect.top - center);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function setActiveOutlineItem(id, scrollList) {
  state.reading.outlineActiveId = id;
  for (const button of document.querySelectorAll("[data-outline-target]")) {
    const active = button.dataset.outlineTarget === id;
    button.classList.toggle("active", active);
    if (active && scrollList && state.reading.outlineOpen) {
      button.scrollIntoView({ block: "nearest" });
    }
  }
}

function jumpToOutlineItem(id) {
  const item = state.reading.outlineTargets.get(id);
  if (!item || !item.target || !item.target.isConnected) {
    return false;
  }
  item.target.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  setActiveOutlineItem(id, true);
  return true;
}

function jumpUserTurn(direction) {
  flushTranscriptHydration();
  rebuildOutline();
  const users = state.reading.outlineItems.filter((item) => item.type === "user");
  if (!users.length) {
    showToast("没有用户回合", true);
    return;
  }
  const nearest = nearestOutlineItem(users);
  let index = nearest ? users.findIndex((item) => item.id === nearest.id) : -1;
  if (index < 0) {
    index = direction > 0 ? -1 : users.length;
  }
  const nextIndex = clampNumber(index + direction, 0, users.length - 1);
  jumpToOutlineItem(users[nextIndex].id);
}

function transcriptNavigationItems() {
  const container = $("turns");
  if (!container) {
    return [];
  }
  return Array.from(container.children).filter((node) => {
    return node instanceof HTMLElement
      && node.classList.contains("turn")
      && !node.classList.contains("turns-hydrating")
      && !node.classList.contains("subagents");
  });
}

function nearestTranscriptItem(items) {
  const viewer = document.querySelector(".viewer");
  const rect = viewer ? viewer.getBoundingClientRect() : { top: 0, height: window.innerHeight };
  const center = rect.top + rect.height * 0.42;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const itemRect = item.getBoundingClientRect();
    const distance = Math.abs(itemRect.top - center);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function flashTranscriptItem(node) {
  document.querySelectorAll(".turn-keyboard-current").forEach((item) => item.classList.remove("turn-keyboard-current"));
  node.classList.add("turn-keyboard-current");
  window.setTimeout(() => node.classList.remove("turn-keyboard-current"), 1600);
}

function scrollTranscriptItem(node, block = "center") {
  if (!node) {
    return false;
  }
  const details = node.closest("details");
  if (details) {
    details.open = true;
  }
  node.scrollIntoView({ behavior: preferredScrollBehavior(), block });
  flashTranscriptItem(node);
  return true;
}

function jumpTranscriptTurn(direction) {
  const items = transcriptNavigationItems();
  if (!items.length) {
    showToast("当前会话没有可导航记录", true);
    return;
  }
  const current = document.querySelector(".turn-keyboard-current") || nearestTranscriptItem(items);
  let index = current ? items.indexOf(current) : -1;
  if (index < 0) {
    index = direction > 0 ? -1 : items.length;
  }
  const nextIndex = clampNumber(index + direction, 0, items.length - 1);
  scrollTranscriptItem(items[nextIndex]);
}

function jumpTranscriptBoundary(edge) {
  if (edge === "top") {
    flushTranscriptHydration();
  }
  const items = transcriptNavigationItems();
  if (!items.length) {
    showToast("当前会话没有可导航记录", true);
    return;
  }
  const node = edge === "bottom" ? items[items.length - 1] : items[0];
  scrollTranscriptItem(node, edge === "bottom" ? "end" : "start");
}

function focusSessionSearchInput() {
  const input = $("sessionSearchInput");
  if (!input || input.disabled) {
    showToast("选择会话后可用会话内搜索", true);
    return;
  }
  safeFocus(input);
  input.select?.();
}

function openShortcuts() {
  state.reading.shortcutsOpen = true;
  const overlay = $("shortcutOverlay");
  if (overlay) {
    overlay.hidden = false;
  }
  beginFocusTrap("shortcuts", overlay, { initialFocus: () => $("closeShortcuts"), close: closeShortcuts });
}

function closeShortcuts() {
  state.reading.shortcutsOpen = false;
  const overlay = $("shortcutOverlay");
  if (overlay) {
    overlay.hidden = true;
  }
  endFocusTrap("shortcuts");
}

function isTypingTarget(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
}

function initReadingExperience() {
  applyVerbosity(currentVerbosity(), { persist: false, forceDetails: true });
  applyTurnMeta(currentTurnMetaEnabled());
  syncDefaultVerbosityControls();
  setOutlineOpen(currentOutlineOpen(), false);
  syncDefaultOutlineControls();
  for (const button of document.querySelectorAll("[data-view-verbosity]")) {
    button.addEventListener("click", () => applyVerbosity(button.dataset.viewVerbosity, { toast: true }));
  }
  for (const button of document.querySelectorAll("[data-default-view-verbosity]")) {
    button.addEventListener("click", () => applyDefaultVerbosity(button.dataset.defaultViewVerbosity, { toast: true }));
  }
  $("defaultOutlineOpen")?.addEventListener("change", (event) => applyDefaultOutlineOpen(event.target.checked, { toast: true }));
  $("turnMetaToggle")?.addEventListener("change", (event) => applyTurnMeta(event.target.checked, { toast: true }));
  $("toggleOutline").addEventListener("click", toggleOutline);
  $("closeOutline").addEventListener("click", () => setOutlineOpen(false));
  $("openShortcuts").addEventListener("click", openShortcuts);
  $("closeShortcuts").addEventListener("click", closeShortcuts);
  $("shortcutOverlay").addEventListener("click", (event) => {
    if (event.target === $("shortcutOverlay")) {
      closeShortcuts();
    }
  });
  $("outlineList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-outline-target]");
    if (button) {
      jumpToOutlineItem(button.dataset.outlineTarget);
    }
  });
  const viewer = document.querySelector(".viewer");
  if (viewer) {
    viewer.addEventListener("scroll", scheduleActiveOutlineUpdate, { passive: true });
    viewer.addEventListener("scroll", handleLiveTailScroll, { passive: true });
  }
  window.addEventListener("resize", scheduleActiveOutlineUpdate);
  window.addEventListener("resize", updateFollowLatestButton);
  $("followLatest").addEventListener("click", () => {
    state.liveTail.following = true;
    state.liveTail.needsFollowPrompt = false;
    scrollLiveTailToBottom();
    updateFollowLatestButton();
  });
  clearOutline("选择会话后显示大纲");
}

function initSplitter() {
  const splitter = $("splitter");
  const app = document.querySelector(".app");
  if (!splitter || !app) {
    return;
  }
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  setSidebarWidth(Number.isFinite(saved) ? saved : currentSidebarWidth(), false);
  setSidebarCollapsed(currentSidebarCollapsed(), false);

  const widthFromPointer = (event) => event.clientX - app.getBoundingClientRect().left;
  const stopResize = (event) => {
    app.classList.remove("resizing");
    try {
      splitter.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture may already be released when the pointer leaves the window.
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  };
  const onPointerMove = (event) => {
    event.preventDefault();
    setSidebarWidth(widthFromPointer(event), true);
  };

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    app.classList.add("resizing");
    splitter.setPointerCapture(event.pointerId);
    setSidebarWidth(widthFromPointer(event), true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  });

  splitter.addEventListener("keydown", (event) => {
    const current = Number(splitter.getAttribute("aria-valuenow")) || currentSidebarWidth();
    const step = event.shiftKey ? 40 : 16;
    let next = current;
    if (event.key === "ArrowLeft") next = current - step;
    else if (event.key === "ArrowRight") next = current + step;
    else if (event.key === "Home") next = SIDEBAR_MIN;
    else if (event.key === "End") next = sidebarMaxWidth();
    else return;
    event.preventDefault();
    setSidebarWidth(next, true);
  });

  window.addEventListener("resize", () => setSidebarWidth(currentSidebarWidth(), true));
}

`;
