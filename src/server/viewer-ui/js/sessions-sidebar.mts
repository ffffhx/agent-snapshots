// @ts-nocheck

export const sessionsSidebarJs = `async function loadSessions() {
  setViewerLoading("正在加载会话...");
  $("sessions").classList.add("sessions-loading");
  $("sessions").innerHTML = renderLoading("正在加载会话...");
  $("sessions").setAttribute("aria-busy", "true");
  $("reload").disabled = true;
  state.sessions = [];
  state.hasMoreSessions = false;
  state.loadingMoreSessions = false;
  state.sessionListError = "";
  try {
    const sessions = await fetchSessionPage(0);
    state.sessions = sessions;
    state.hasMoreSessions = sessions.length === SESSION_BATCH_LIMIT;
    state.activeSource = visibleSourceKey(state.activeSource);
    if (!sourceSessions(state.activeSource).length) {
      const firstSourceWithSessions = SOURCE_MODULES.find((source) => sourceSessions(source.key).length);
      if (firstSourceWithSessions) {
        state.activeSource = firstSourceWithSessions.key;
      }
    }
    await selectFirstSessionForActiveSource();
  } catch (error) {
    state.sessionListError = error instanceof Error ? error.message : String(error);
    renderSessions();
    clearViewer("会话列表加载失败。");
  } finally {
    $("sessions").classList.remove("sessions-loading");
    $("sessions").removeAttribute("aria-busy");
    $("reload").disabled = false;
  }
}

async function fetchSessionPage(offset) {
  const query = new URLSearchParams({
    source: "all",
    limit: String(SESSION_BATCH_LIMIT),
    offset: String(Math.max(0, Number(offset) || 0)),
    completeOnly: "0",
  });
  const response = await fetch("/api/sessions?" + query.toString());
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Failed to load sessions");
  }
  return Array.isArray(result) ? result : [];
}

function appendSessions(sessions) {
  const seen = new Set(state.sessions.map(sessionRef));
  const nextSessions = [];
  for (const session of sessions) {
    const ref = sessionRef(session);
    if (!seen.has(ref)) {
      seen.add(ref);
      nextSessions.push(session);
    }
  }
  state.sessions = state.sessions.concat(nextSessions);
}

async function loadMoreSessions() {
  if (state.loadingMoreSessions || !state.hasMoreSessions) {
    return;
  }
  state.loadingMoreSessions = true;
  state.sessionListError = "";
  renderSessions();
  try {
    const sessions = await fetchSessionPage(state.sessions.length);
    appendSessions(sessions);
    state.hasMoreSessions = sessions.length === SESSION_BATCH_LIMIT;
    if (!state.selected && sourceSessions(state.activeSource).length) {
      await selectFirstSessionForActiveSource();
      return;
    }
  } catch (error) {
    state.sessionListError = error instanceof Error ? error.message : String(error);
  } finally {
    state.loadingMoreSessions = false;
    renderSessions();
  }
}

function renderSessions() {
  $("sessions").classList.remove("sessions-loading");
  state.activeSource = visibleSourceKey(state.activeSource);
  const source = sourceByKey(state.activeSource);
  const sessions = sourceSessions(source.key);
  const groups = groupSessions(sessions);
  const body = groups.length
    ? groups.map(renderProjectGroup).join("")
    : "<div class='source-empty'>暂无会话</div>";
  $("sessions").innerHTML = renderSourceSwitcher() + body + renderLoadMore();
}

function renderSourceSwitcher() {
  return "<div class='source-switcher' role='tablist' aria-label='Session source'>" +
    SOURCE_MODULES.map((source) => {
      const count = sourceSessions(source.key).length;
      const active = source.key === state.activeSource;
      return "<button class='source-tab" + (active ? " active" : "") + "' type='button' role='tab' aria-selected='" + (active ? "true" : "false") + "' data-source='" + esc(source.key) + "'>" +
        "<span>" + esc(source.label) + "</span>" +
        "<b>" + esc(count) + "</b>" +
      "</button>";
    }).join("") +
  "</div>";
}

function renderLoadMore() {
  if (!state.hasMoreSessions && !state.loadingMoreSessions && !state.sessionListError) {
    return "";
  }
  const button = state.hasMoreSessions || state.loadingMoreSessions
    ? "<button class='sessions-load-more' type='button' data-load-more='1'" + (state.loadingMoreSessions ? " disabled aria-busy='true'" : "") + ">" + (state.loadingMoreSessions ? "正在加载..." : "加载更多") + "</button>"
    : "";
  const status = state.sessionListError
    ? "<span class='load-more-meta load-more-error'>" + esc(state.sessionListError) + "</span>"
    : "<span class='load-more-meta'>已加载 " + esc(state.sessions.length) + " 条</span>";
  return "<div class='load-more-row'>" + button + status + "</div>";
}

function sourceByKey(key) {
  return SOURCE_MODULES.find((source) => source.key === key) || SOURCE_MODULES[0];
}

function visibleSourceKey(key) {
  return sourceByKey(key).key;
}

function sourceSessions(key) {
  return state.sessions.filter((session) => sessionEngine(session) === key);
}

async function selectFirstSessionForActiveSource() {
  state.activeSource = visibleSourceKey(state.activeSource);
  const sessions = sourceSessions(state.activeSource);
  if (!sessions.length) {
    state.selected = "";
    renderSessions();
    clearViewer(sourceByKey(state.activeSource).label + " 暂无可审阅会话。");
    return;
  }
  const selected = sessions.find((session) => sessionRef(session) === state.selected);
  await selectSession(sessionRef(selected || sessions[0]));
}

function setViewerLoading(message) {
  state.requestToken += 1;
  showViewerLoading(message);
}

function clearViewer(message) {
  state.requestToken += 1;
  stopLiveTail({ silent: true });
  state.currentSnapshot = null;
  resetSessionSearchState(false);
  renderSessionSearch();
  $("title").textContent = "选择一个会话";
  $("meta").textContent = message || "还没有选择会话。";
  $("meta").classList.add("empty");
  $("meta").classList.remove("loading");
  $("meta").removeAttribute("aria-busy");
  $("goal").innerHTML = "";
  $("risks").innerHTML = "";
  $("exports").innerHTML = "";
  $("turns").innerHTML = "";
  clearOutline("选择会话后显示大纲");
}

function sessionEngine(session) {
  return session.engine || "codex";
}

function sessionRef(session) {
  return session.ref || (sessionEngine(session) + ":" + session.id);
}

function sessionEngineKey(item) {
  const value = String(item?.engine || "").toLowerCase();
  return value === "claude" || value === "trae" ? value : "codex";
}

function normalizedSessionPath(item) {
  return String(item?.filePath || item?.displayFilePath || "").replace(/\\\\/g, "/");
}

function isCompleteSessionItem(item) {
  if (!item) {
    return true;
  }
  if (item.complete === true) {
    return true;
  }
  if (item.complete === false || item.live === true || item._live === true) {
    return false;
  }
  const engine = sessionEngineKey(item);
  if (engine === "trae") {
    return true;
  }
  if (engine === "codex") {
    const filePath = normalizedSessionPath(item);
    if (filePath.includes("/archived_sessions/")) {
      return true;
    }
    if (filePath.includes("/sessions/")) {
      return false;
    }
    return true;
  }
  if (engine === "claude") {
    return item.sourceKind ? item.sourceKind === "transcript" : true;
  }
  return true;
}

function isLiveSessionItem(item) {
  if (!item) {
    return false;
  }
  if (item.live === true || item._live === true) {
    return true;
  }
  if (item.live === false || item.complete === true) {
    return false;
  }
  const engine = sessionEngineKey(item);
  if (engine === "trae") {
    return false;
  }
  if (engine === "codex") {
    if (item.complete === false) {
      return true;
    }
    const filePath = normalizedSessionPath(item);
    return !filePath.includes("/archived_sessions/") && filePath.includes("/sessions/");
  }
  if (engine === "claude") {
    if (item.historyOnly || (item.sourceKind && item.sourceKind !== "transcript")) {
      return false;
    }
    return item.complete === false;
  }
  return item.complete === false;
}

function sortGroupSessionRows(sessions) {
  return sessions.slice().sort((a, b) => {
    const liveDelta = Number(isLiveSessionItem(b)) - Number(isLiveSessionItem(a));
    if (liveDelta) {
      return liveDelta;
    }
    return new Date(b.mtime || 0).getTime() - new Date(a.mtime || 0).getTime();
  });
}

function groupSessions(sessions, filter) {
  const groupMap = new Map();
  for (const session of sessions) {
    const key = projectKey(session);
    const isNoProject = isNoProjectSession(session);
    if (!groupMap.has(key)) {
      const ephemeral = isNoProject ? null : ephemeralAgentInfo(session);
      const searchCwd = isNoProject || ephemeral ? "" : projectPath(session);
      groupMap.set(key, {
        key,
        label: ephemeral ? ephemeral.prefix : projectLabel(session),
        displayPath: ephemeral ? "临时 agent 运行 · " + ephemeral.prefix + "-*" : projectDisplayPath(session),
        searchCwd,
        isNoProject,
        isEphemeral: Boolean(ephemeral),
        newestMs: 0,
        sessions: [],
      });
    }
    const group = groupMap.get(key);
    group.sessions.push(session);
    const mtime = new Date(session.mtime).getTime();
    if (Number.isFinite(mtime)) {
      group.newestMs = Math.max(group.newestMs, mtime);
    }
  }
  for (const group of groupMap.values()) {
    group.sessions = sortGroupSessionRows(group.sessions);
  }
  const groups = sortProjectGroups(Array.from(groupMap.values()));
  if (!filter) {
    return groups;
  }
  return sortProjectGroups(groups.map((group) => {
    const projectHaystack = (group.label + " " + group.displayPath + " " + group.key).toLowerCase();
    const projectMatches = projectHaystack.includes(filter);
    const filteredSessions = projectMatches
      ? group.sessions
      : group.sessions.filter((session) => sessionHaystack(session, group).includes(filter));
    return { ...group, sessions: filteredSessions };
  }).filter((group) => group.sessions.length));
}

// Eval/judge harnesses (and headless claude -p runs) execute each agent in its
// own throwaway temp directory such as
// /private/var/folders/<x>/<y>/T/judge-cl-k5jv9X or /tmp/eval-2CwQp3.
// Every one of those would otherwise become its own sidebar "project". Collapse
// them into a single parent group per prefix so the spawned agents nest under
// their batch instead of flooding the list.
function ephemeralAgentInfo(session) {
  // NOTE: this runs inside a template literal, so backslash-heavy regexes get
  // mangled by template escaping. Detect the temp path with plain string ops
  // and keep the only regex backslash-free.
  const cwd = normalizeProjectPath(projectPath(session));
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const base = parts[parts.length - 1];
  const parent = parts[parts.length - 2];
  // System temp roots: macOS var/folders/<x>/<y>/T/<name>, or /tmp/<name>.
  const underTemp = parent === "tmp" || (parent === "T" && parts.indexOf("folders") !== -1);
  if (!underTemp) {
    return null;
  }
  // Collapse the generated suffix of an ephemeral run dir: <prefix>-<id> ->
  // <prefix>. Gated on the temp root above, so a 5-16 char alphanumeric tail
  // is safe to treat as a generated id (eval-ne05uj, judge-cl-k8qxz2, ...).
  const split = base.match(/^(.+)-([A-Za-z0-9_]{5,16})$/);
  if (!split) {
    return null;
  }
  return { prefix: split[1], base: base };
}

function projectKey(session) {
  if (isNoProjectSession(session)) {
    return sessionEngine(session) + "::no-project";
  }
  const ephemeral = ephemeralAgentInfo(session);
  if (ephemeral) {
    return sessionEngine(session) + "::agent::" + ephemeral.prefix;
  }
  return sessionEngine(session) + "::" + projectPath(session);
}

function isNoProjectSession(session) {
  if (session.projectKind === "none" || session.projectKind === "conversation") {
    return true;
  }
  const cwd = projectPath(session);
  return !cwd || cwd === "/" || cwd === "No project" || isCodexStandaloneConversationPath(session);
}

function isCodexStandaloneConversationPath(session) {
  if (sessionEngine(session) !== "codex") {
    return false;
  }
  return [session.cwd, session.displayCwd].some(isStandaloneConversationPath);
}

function isStandaloneConversationPath(value) {
  const parts = normalizeProjectPath(value).split("/").filter(Boolean);
  const codexIndex = parts.findIndex((part, index) => part === "Codex" && parts[index - 1] === "Documents");
  if (codexIndex < 0 || codexIndex + 3 !== parts.length) {
    return false;
  }
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(parts[codexIndex + 1]) && Boolean(parts[codexIndex + 2]);
}

function projectDisplayPath(session) {
  return isNoProjectSession(session) ? "普通会话" : projectPath(session);
}

function projectPath(session) {
  return String(session.cwd || session.displayCwd || "").trim();
}

function normalizeProjectPath(value) {
  return String(value || "").trim().replace(/\\\\/g, "/").replace(/\\/+$/, "");
}

function projectGroupTier(group) {
  if (group.isNoProject) {
    return 2;
  }
  return group.isEphemeral ? 1 : 0;
}

function sortProjectGroups(groups) {
  return groups.slice().sort((a, b) => {
    const tier = projectGroupTier(a) - projectGroupTier(b);
    if (tier) {
      return tier;
    }
    return (b.newestMs || 0) - (a.newestMs || 0) || a.label.localeCompare(b.label);
  });
}

function projectLabel(session) {
  if (isNoProjectSession(session)) {
    return "普通会话";
  }
  const value = String(session.displayCwd || session.cwd || "No project").replace(/[\\\\/]+$/, "");
  const parts = value.split(/[\\\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value || "No project";
}

function sessionHaystack(session, group) {
  return [
    session.engineLabel,
    session.engine,
    session.title,
    session.cwd,
    session.displayCwd,
    session.id,
    session.ref,
    group.label,
    group.displayPath,
  ].filter(Boolean).join(" ").toLowerCase();
}

function renderProjectGroup(group) {
  const collapsedLimit = 5;
  const noisyExpandedLimit = 25;
  const expanded = state.expandedProjects.has(group.key);
  const collapsed = state.collapsedProjects.has(group.key);
  const activeIndex = group.sessions.findIndex((session) => sessionRef(session) === state.selected);
  const noisy = group.isNoProject || group.isEphemeral;
  const expandedLimit = noisy ? Math.min(noisyExpandedLimit, group.sessions.length) : group.sessions.length;
  const visibleLimit = expanded ? expandedLimit : Math.min(collapsedLimit, group.sessions.length);
  let visible = group.sessions.slice(0, visibleLimit);
  if (!collapsed && activeIndex >= visibleLimit) {
    visible = visible.slice(0, Math.max(0, visibleLimit - 1)).concat(group.sessions[activeIndex]);
  }
  const showToggle = !collapsed && group.sessions.length > collapsedLimit;
  const toggleLabel = expanded ? "收起" : noisy ? "显示最近 " + Math.min(noisyExpandedLimit, group.sessions.length) : "展开显示";
  const toggle = showToggle
    ? "<button class='project-more' type='button' data-project-toggle='" + esc(group.key) + "'>" + toggleLabel + "</button>"
    : "";
  const note = !collapsed && noisy && expanded && group.sessions.length > noisyExpandedLimit
    ? "<div class='project-note'>仅显示最近 " + noisyExpandedLimit + " / " + esc(group.sessions.length) + "，可搜索标题定位更多</div>"
    : "";
  const sessionList = collapsed ? "" : "<div class='session-list' role='list' aria-label='" + esc(group.label) + " 会话'>" + visible.map((session) => "<div role='listitem'>" + renderSessionRow(session) + "</div>").join("") + "</div>";
  const sectionClass = "project-group" + (group.isNoProject ? " no-project" : "") + (collapsed ? " collapsed" : "");
  const projectSearch = group.searchCwd
    ? "<button class='project-search' type='button' data-project-search='" + esc(group.key) + "' data-project-cwd='" + esc(group.searchCwd) + "' data-project-label='" + esc(group.label) + "' title='搜索 " + esc(group.displayPath) + "' aria-label='搜索 " + esc(group.label) + "'>搜索</button>"
    : "";
  return "<section class='" + sectionClass + "'>" +
    "<div class='project-headline'>" +
      "<button class='project-header' type='button' data-project-collapse='" + esc(group.key) + "' aria-expanded='" + (collapsed ? "false" : "true") + "' title='" + esc(group.displayPath) + "'>" +
        "<span class='project-icon' aria-hidden='true'></span>" +
        "<span class='project-title'>" + esc(group.label) + "</span>" +
        "<span class='project-count'>" + esc(group.sessions.length) + "</span>" +
      "</button>" +
      projectSearch +
    "</div>" +
    sessionList +
    note +
    toggle +
  "</section>";
}

function renderSessionRow(session) {
  const ref = sessionRef(session);
  const active = ref === state.selected ? " active" : "";
  const live = isLiveSessionItem(session);
  const liveDot = live ? "<span class='session-live-dot' aria-hidden='true'></span>" : "";
  const liveBadge = live ? "<span class='session-badge live'>进行中</span>" : "";
  const historyBadge = session.historyOnly ? "<span class='session-badge'>history</span>" : "";
  return "<button class='session" + active + (live ? " live" : "") + "' data-id='" + esc(ref) + "' title='" + esc(session.title) + "'" + (active ? " aria-current='page'" : "") + ">" +
    liveDot +
    "<strong>" + esc(session.title) + "</strong>" +
    liveBadge +
    historyBadge +
    "<span class='session-time'>" + esc(relativeTime(session.mtime)) + "</span>" +
  "</button>";
}

function relativeTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return "";
  }
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return "刚刚";
  }
  if (diff < hour) {
    return Math.max(1, Math.floor(diff / minute)) + " 分钟";
  }
  if (diff < day) {
    return Math.max(1, Math.floor(diff / hour)) + " 小时";
  }
  if (diff < 7 * day) {
    return Math.max(1, Math.floor(diff / day)) + " 天";
  }
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(time));
}

async function selectSession(id) {
  const requestToken = state.requestToken + 1;
  state.requestToken = requestToken;
  state.selected = id;
  renderSessions();
  showViewerLoading("正在加载会话内容...");
  try {
    const response = await fetch("/api/snapshot?" + activeOptions().toString());
    const snapshot = await response.json();
    if (requestToken !== state.requestToken || id !== state.selected) {
      return;
    }
    if (!response.ok || snapshot.error) {
      throw new Error(snapshot.error || "会话内容加载失败。");
    }
    renderSnapshot(snapshot);
  } catch (error) {
    if (requestToken !== state.requestToken || id !== state.selected) {
      return;
    }
    $("title").textContent = "会话加载失败";
    $("meta").classList.add("empty");
    $("meta").classList.remove("loading");
    $("meta").removeAttribute("aria-busy");
    $("meta").textContent = "会话内容加载失败。";
    $("turns").removeAttribute("aria-busy");
    $("turns").innerHTML = "<div class='meta'>" + esc(error instanceof Error ? error.message : String(error)) + "</div>";
  }
}

`;
