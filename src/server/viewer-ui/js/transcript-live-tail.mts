// @ts-nocheck

export const transcriptLiveTailJs = `function renderSnapshot(snapshot) {
  state.currentSnapshot = snapshot;
  snapshot.commitCount = "";
  resetSessionSearchState(false);
  $("title").textContent = snapshot.title;
  $("meta").classList.remove("empty", "loading");
  $("meta").removeAttribute("aria-busy");
  $("meta").innerHTML = renderSnapshotMeta(snapshot);
  $("goal").innerHTML = renderSnapshotGoal(snapshot);
  renderSnapshotRisks(snapshot);
  const options = activeOptions();
  const resumeButton = snapshot.engine !== "trae"
    ? "<button type='button' class='resume-orca' data-resume-orca='" + esc(snapshot.ref || "") + "' data-resume-cwd='" + esc(snapshot.cwd || snapshot.displayCwd || "") + "' data-resume-title='" + esc(snapshot.title || "") + "' title='在 Orca 中打开终端并恢复此会话'>↗ 在 Orca 继续</button>"
    : "";
  $("exports").innerHTML = resumeButton + sessionNoteToolbarButton(snapshot.ref || state.selected || "") + "<a href='/export?" + options.toString() + "&format=html' target='_blank' rel='noopener noreferrer'>导出 HTML</a><a href='/export?" + options.toString() + "&format=md' target='_blank' rel='noopener noreferrer'>导出 Markdown</a><button type='button' data-publish-gist='1'>Gist</button><button type='button' data-publish-cloud='1'>发布分享</button><span id='publishStatus' class='publish-status'></span>";
  ensureSessionNoteForSnapshot(snapshot.ref || state.selected || "");
  renderTranscriptTurns(snapshot.transcriptHtml || "<div class='meta'>没有找到可分享的用户或助手消息。</div>");
  loadSessionCommits(snapshot, state.requestToken);
  renderSessionSearch();
  postSnapshotState(snapshot);
  configureLiveTail(snapshot);
}

// 两段式渲染：大会话先渲染最新的一段轮次（秒开），更早的轮次在后台按帧
// 分片补进上方，并调整滚动位置保证视口内容不跳动。小会话保持一次性渲染。
var transcriptHydration = null;
var TRANSCRIPT_PROGRESSIVE_THRESHOLD = 140;
var TRANSCRIPT_TAIL_COUNT = 60;
var TRANSCRIPT_CHUNK_SIZE = 60;

function cancelTranscriptHydration() {
  if (transcriptHydration) {
    transcriptHydration.cancelled = true;
    transcriptHydration = null;
  }
}

function flushTranscriptHydration() {
  if (transcriptHydration) {
    transcriptHydration.flush();
  }
}

function renderTranscriptTurns(html) {
  cancelTranscriptHydration();
  const container = $("turns");
  const template = document.createElement("template");
  template.innerHTML = html || "";
  const nodes = Array.from(template.content.children);
  container.innerHTML = "";
  if (nodes.length <= TRANSCRIPT_PROGRESSIVE_THRESHOLD) {
    container.appendChild(template.content);
    openContentLinksInNewTabs(container);
    afterTranscriptContentMutated(container);
    container.removeAttribute("aria-busy");
    return;
  }

  const tailStart = nodes.length - TRANSCRIPT_TAIL_COUNT;
  const placeholder = document.createElement("div");
  placeholder.className = "turns-hydrating";
  placeholder.textContent = "正在载入更早的 " + tailStart + " 条记录...";
  container.appendChild(placeholder);
  const tail = document.createDocumentFragment();
  for (let i = tailStart; i < nodes.length; i += 1) {
    tail.appendChild(nodes[i]);
  }
  openContentLinksInNewTabs(tail);
  afterTranscriptContentMutated(tail, { rebuildOutline: false });
  container.appendChild(tail);
  scheduleOutlineRebuild();
  container.setAttribute("aria-busy", "true");

  const scroller = container.closest(".viewer") || document.scrollingElement || document.documentElement;
  let end = tailStart;
  const job = { cancelled: false, flush: () => {} };

  const insertChunk = () => {
    const start = Math.max(0, end - TRANSCRIPT_CHUNK_SIZE);
    const chunk = document.createDocumentFragment();
    for (let i = start; i < end; i += 1) {
      // 补齐的历史轮次跳过入场动画，避免整片内容同时播放动效。
      nodes[i].classList.add("prehydrated");
      chunk.appendChild(nodes[i]);
    }
    openContentLinksInNewTabs(chunk);
    afterTranscriptContentMutated(chunk, { rebuildOutline: false });
    const previousHeight = scroller.scrollHeight;
    const previousTop = scroller.scrollTop;
    placeholder.after(chunk);
    scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
    end = start;
    scheduleOutlineRebuild();
  };
  const finish = () => {
    const previousHeight = scroller.scrollHeight;
    const previousTop = scroller.scrollTop;
    placeholder.remove();
    scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
    container.removeAttribute("aria-busy");
    job.cancelled = true;
    if (transcriptHydration === job) {
      transcriptHydration = null;
    }
    scheduleOutlineRebuild();
  };
  const step = () => {
    if (job.cancelled) {
      return;
    }
    if (!placeholder.isConnected) {
      // 容器已被其他内容覆盖（切换会话/加载态），静默作废本次补齐。
      job.cancelled = true;
      if (transcriptHydration === job) {
        transcriptHydration = null;
      }
      return;
    }
    insertChunk();
    if (end <= 0) {
      finish();
      return;
    }
    placeholder.textContent = "正在载入更早的 " + end + " 条记录...";
    scheduleHydrationStep(step);
  };
  job.flush = () => {
    if (job.cancelled || !placeholder.isConnected) {
      return;
    }
    while (end > 0) {
      insertChunk();
    }
    finish();
  };
  transcriptHydration = job;
  scheduleHydrationStep(step);
}

function scheduleHydrationStep(fn) {
  // 不用 requestAnimationFrame：后台 tab 里 rAF 完全不触发，
  // 会导致切走再切回的用户面对永远补不齐的会话。setTimeout 在
  // 前台节奏相当，后台最多被钳到 ~1s/步，仍能推进完成。
  window.setTimeout(fn, 16);
}

function configureLiveTail(snapshot) {
  const ref = snapshot?.ref || state.selected || "";
  if (!ref || !isLiveSessionItem(snapshot)) {
    stopLiveTail({ silent: true });
    return;
  }
  if (state.liveTail.active && state.liveTail.ref === ref) {
    state.liveTail.head = liveHeadFromSnapshot(snapshot);
    updateFollowLatestButton();
    return;
  }
  stopLiveTail({ silent: true });
  state.liveTail.active = true;
  state.liveTail.ref = ref;
  state.liveTail.token += 1;
  state.liveTail.head = liveHeadFromSnapshot(snapshot);
  state.liveTail.polling = false;
  state.liveTail.following = isLiveTailNearBottom();
  state.liveTail.needsFollowPrompt = false;
  updateSelectedSessionCompletion(ref, false);
  updateFollowLatestButton();
  scheduleLiveTailPoll();
}

function stopLiveTail(options = {}) {
  if (state.liveTail.timer) {
    clearTimeout(state.liveTail.timer);
  }
  const wasActive = state.liveTail.active;
  const ref = state.liveTail.ref;
  state.liveTail.active = false;
  state.liveTail.ref = "";
  state.liveTail.timer = 0;
  state.liveTail.token += 1;
  state.liveTail.head = null;
  state.liveTail.polling = false;
  state.liveTail.following = true;
  state.liveTail.needsFollowPrompt = false;
  updateFollowLatestButton();
  if (wasActive && options.completed) {
    updateSelectedSessionCompletion(ref, true);
    if (state.currentSnapshot && (state.currentSnapshot.ref || state.selected) === ref) {
      state.currentSnapshot.complete = true;
      $("meta").innerHTML = renderSnapshotMeta(state.currentSnapshot);
    }
    showToast("会话已完成", false);
  } else if (wasActive && !options.silent && state.currentSnapshot && (state.currentSnapshot.ref || state.selected) === ref) {
    $("meta").innerHTML = renderSnapshotMeta(state.currentSnapshot);
  }
}

function liveHeadFromSnapshot(snapshot) {
  return {
    complete: isCompleteSessionItem(snapshot),
    turnCount: Array.isArray(snapshot?.turns) ? snapshot.turns.length : Number(snapshot?.turnCount || 0) || 0,
    lastEventAt: snapshotLastEventAt(snapshot),
  };
}

function snapshotLastEventAt(snapshot) {
  let latest = new Date(snapshot?.mtime || snapshot?.generatedAt || 0).getTime();
  for (const turn of snapshot?.turns || []) {
    const time = new Date(turn?.timestamp || 0).getTime();
    if (Number.isFinite(time)) {
      latest = Math.max(latest || 0, time);
    }
  }
  return Number.isFinite(latest) && latest > 0 ? new Date(latest).toISOString() : "";
}

function scheduleLiveTailPoll(delay = LIVE_TAIL_INTERVAL_MS) {
  if (!state.liveTail.active) {
    return;
  }
  if (state.liveTail.timer) {
    clearTimeout(state.liveTail.timer);
  }
  state.liveTail.timer = window.setTimeout(pollLiveTail, delay);
}

async function pollLiveTail() {
  if (!state.liveTail.active || state.liveTail.polling) {
    return;
  }
  const ref = state.liveTail.ref;
  const token = state.liveTail.token;
  state.liveTail.timer = 0;
  state.liveTail.polling = true;
  try {
    const head = await fetchSessionHead(ref);
    if (token !== state.liveTail.token || ref !== state.liveTail.ref || ref !== state.selected) {
      return;
    }
    const previousHead = state.liveTail.head;
    const changed = hasSessionHeadChanged(previousHead, head);
    state.liveTail.head = head;
    if (changed) {
      await fetchAndAppendLiveSnapshot(ref, token, head);
      if (token !== state.liveTail.token || ref !== state.liveTail.ref) {
        return;
      }
    }
    if (head.complete === true) {
      stopLiveTail({ completed: true });
      return;
    }
  } catch (_error) {
    // Keep tailing; transient parse/stat failures can happen while a writer is
    // replacing the active JSONL file.
  } finally {
    if (token === state.liveTail.token) {
      state.liveTail.polling = false;
      if (state.liveTail.active) {
        scheduleLiveTailPoll();
      }
    }
  }
}

async function fetchSessionHead(ref) {
  const params = new URLSearchParams({ id: ref });
  const response = await fetch("/api/session-head?" + params.toString());
  const head = await response.json();
  if (!response.ok || head.error) {
    throw new Error(head.error || "Failed to load session head");
  }
  return {
    complete: head.complete === true,
    turnCount: Number(head.turnCount || 0) || 0,
    lastEventAt: String(head.lastEventAt || ""),
  };
}

function hasSessionHeadChanged(previous, next) {
  if (!previous || !next) {
    return true;
  }
  return previous.complete !== next.complete
    || Number(previous.turnCount || 0) !== Number(next.turnCount || 0)
    || String(previous.lastEventAt || "") !== String(next.lastEventAt || "");
}

async function fetchAndAppendLiveSnapshot(ref, token, head) {
  const params = activeOptions();
  const response = await fetch("/api/snapshot?" + params.toString());
  const snapshot = await response.json();
  if (token !== state.liveTail.token || ref !== state.liveTail.ref || ref !== state.selected) {
    return;
  }
  if (!response.ok || snapshot.error) {
    throw new Error(snapshot.error || "Failed to load session");
  }
  if (head?.complete === true) {
    snapshot.complete = true;
  }
  appendLiveSnapshotDelta(snapshot);
  loadSessionCommits(snapshot, state.requestToken);
}

function appendLiveSnapshotDelta(snapshot) {
  const ref = snapshot.ref || state.selected || "";
  const previous = state.currentSnapshot || {};
  const previousCommitCount = previous.commitCount;
  snapshot.commitCount = previousCommitCount !== undefined ? previousCommitCount : "";
  const container = $("turns");
  flushTranscriptHydration();
  const previousCount = snapshotTopLevelItems(previous.turns || []).length;
  const template = document.createElement("template");
  template.innerHTML = snapshot.transcriptHtml || "";
  const allNodes = Array.from(template.content.children);
  const transcriptNodes = allNodes.filter((node) => !(node instanceof HTMLElement) || !node.classList.contains("subagents"));
  const newNodes = transcriptNodes.slice(previousCount);
  const appendedElements = [];
  if (newNodes.length) {
    const fragment = document.createDocumentFragment();
    for (const node of newNodes) {
      if (node instanceof HTMLElement) {
        appendedElements.push(node);
      }
      fragment.appendChild(node);
    }
    openContentLinksInNewTabs(fragment);
    afterTranscriptContentMutated(fragment, { rebuildOutline: false });
    const anchor = container.querySelector(".subagents");
    container.insertBefore(fragment, anchor || null);
  }
  const incomingSubagents = allNodes.find((node) => node instanceof HTMLElement && node.classList.contains("subagents"));
  if (incomingSubagents && !container.querySelector(".subagents")) {
    openContentLinksInNewTabs(incomingSubagents);
    afterTranscriptContentMutated(incomingSubagents, { rebuildOutline: false });
    container.appendChild(incomingSubagents);
  }
  state.currentSnapshot = snapshot;
  const selected = selectedSession();
  if (selected && sessionRef(selected) === ref) {
    selected.mtime = snapshot.mtime || selected.mtime;
  }
  $("title").textContent = snapshot.title || $("title").textContent;
  $("meta").innerHTML = renderSnapshotMeta(snapshot);
  $("goal").innerHTML = renderSnapshotGoal(snapshot);
  renderSnapshotRisks(snapshot);
  if (appendedElements.length) {
    if (!state.reading.outlineItems.length && previousCount > 0) {
      scheduleOutlineRebuild();
    } else {
      appendOutlineEntriesForNodes(appendedElements);
    }
    const shouldFollow = state.liveTail.following || isLiveTailNearBottom();
    if (shouldFollow) {
      state.liveTail.following = true;
      state.liveTail.needsFollowPrompt = false;
      scrollLiveTailToBottom();
    } else {
      state.liveTail.needsFollowPrompt = true;
    }
    updateFollowLatestButton();
  }
  postSnapshotState(snapshot);
}

function updateSelectedSessionCompletion(ref, complete) {
  const session = state.sessions.find((item) => sessionRef(item) === ref);
  if (!session) {
    return;
  }
  session.complete = Boolean(complete);
  session.live = !complete;
  renderSessions();
}

function liveTailScroller() {
  return document.querySelector(".viewer") || document.scrollingElement || document.documentElement;
}

function isLiveTailNearBottom() {
  const scroller = liveTailScroller();
  if (!scroller) {
    return true;
  }
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= LIVE_TAIL_BOTTOM_PX;
}

function scrollLiveTailToBottom() {
  const scroller = liveTailScroller();
  if (scroller) {
    scroller.scrollTop = scroller.scrollHeight;
  }
}

function handleLiveTailScroll() {
  if (!state.liveTail.active) {
    return;
  }
  if (isLiveTailNearBottom()) {
    state.liveTail.following = true;
    state.liveTail.needsFollowPrompt = false;
  } else {
    state.liveTail.following = false;
    state.liveTail.needsFollowPrompt = true;
  }
  updateFollowLatestButton();
}

function updateFollowLatestButton() {
  const button = $("followLatest");
  if (!button) {
    return;
  }
  button.hidden = !(state.liveTail.active && !state.liveTail.following && state.liveTail.needsFollowPrompt);
}

function renderSnapshotRisks(snapshot) {
  const notices = (snapshot.notices || []).map((notice) => {
    return "<div class='notice " + esc(notice.severity || "medium") + "'><b>NOTE</b><span><strong>" + esc(notice.label || "Notice") + ".</strong> " + esc(notice.text || "") + "</span></div>";
  }).join("");
  const risks = (snapshot.risks || []).length ? snapshot.risks.map((risk) => {
    return "<div class='risk " + esc(risk.severity) + "'><b>" + esc(risk.severity) + "</b><span>" + esc(risk.label) + "</span><em>" + esc(formatRiskTurns(risk)) + "</em></div>";
  }).join("") : "";
  $("risks").innerHTML = snapshot.safetyChecks === false ? "" : notices + risks;
}

async function loadSessionCommits(snapshot, requestToken) {
  const ref = snapshot.ref || state.selected || "";
  if (!ref) {
    return;
  }
  try {
    const params = new URLSearchParams({ id: ref });
    const response = await fetch("/api/session-commits?" + params.toString());
    const result = await response.json();
    if (requestToken !== state.requestToken || state.selected !== ref || state.currentSnapshot !== snapshot) {
      return;
    }
    const commits = Array.isArray(result.commits) ? result.commits : [];
    snapshot.commitCount = commits.length;
    $("meta").innerHTML = renderSnapshotMeta(snapshot);
    insertSessionCommitCards(snapshot, commits);
  } catch {
    if (requestToken === state.requestToken && state.selected === ref && state.currentSnapshot === snapshot) {
      snapshot.commitCount = 0;
      $("meta").innerHTML = renderSnapshotMeta(snapshot);
    }
  }
}

function insertSessionCommitCards(snapshot, commits) {
  const container = $("turns");
  Array.from(container.querySelectorAll(".commit-card")).forEach((node) => node.remove());
  if (!Array.isArray(commits) || !commits.length) {
    return;
  }
  flushTranscriptHydration();
  const timeline = transcriptTopLevelTimeline(snapshot, container);
  const sorted = commits.slice().sort((a, b) => commitTimeMs(a) - commitTimeMs(b));
  for (const commit of sorted) {
    const card = renderCommitCardNode(commit);
    const before = commitInsertBeforeNode(timeline, commitTimeMs(commit));
    if (before) {
      container.insertBefore(card, before);
    } else {
      const subagents = container.querySelector(".subagents");
      container.insertBefore(card, subagents || null);
    }
  }
  scheduleOutlineRebuild();
}

function transcriptTopLevelTimeline(snapshot, container) {
  const items = snapshotTopLevelItems(snapshot.turns || []);
  const nodes = Array.from(container.children).filter((node) => {
    return !node.classList.contains("commit-card")
      && !node.classList.contains("subagents")
      && !node.classList.contains("turns-hydrating");
  });
  const timeline = [];
  for (let index = 0; index < items.length && index < nodes.length; index += 1) {
    const time = earliestTurnTimeMs(items[index].turns);
    if (Number.isFinite(time)) {
      timeline.push({ node: nodes[index], time: time });
    }
  }
  return timeline.sort((a, b) => a.time - b.time);
}

function snapshotTopLevelItems(turns) {
  const items = [];
  let index = 0;
  while (index < turns.length) {
    const turn = turns[index];
    if (isSnapshotUserTurn(turn)) {
      items.push({ turns: [turn] });
      index += 1;
      continue;
    }
    const segment = [];
    while (index < turns.length && !isSnapshotUserTurn(turns[index])) {
      segment.push(turns[index]);
      index += 1;
    }
    const finalIndex = lastAssistantTurnIndex(segment);
    if (finalIndex === -1) {
      if (segment.length) {
        items.push({ turns: segment });
      }
      continue;
    }
    if (finalIndex === segment.length - 1) {
      const processTurns = segment.slice(0, finalIndex);
      if (processTurns.length) {
        items.push({ turns: processTurns });
      }
      items.push({ turns: [segment[finalIndex]] });
      continue;
    }
    items.push({ turns: segment });
  }
  return items;
}

function isSnapshotUserTurn(turn) {
  return Boolean(turn && turn.kind !== "tool" && turn.role === "user");
}

function isSnapshotAssistantTurn(turn) {
  return Boolean(turn && turn.kind !== "tool" && turn.role === "assistant");
}

function lastAssistantTurnIndex(turns) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (isSnapshotAssistantTurn(turns[index])) {
      return index;
    }
  }
  return -1;
}

function earliestTurnTimeMs(turns) {
  let best = Number.POSITIVE_INFINITY;
  for (const turn of turns || []) {
    const time = new Date(turn.timestamp || "").getTime();
    if (Number.isFinite(time) && time < best) {
      best = time;
    }
  }
  return best;
}

function commitInsertBeforeNode(timeline, commitMs) {
  if (!Number.isFinite(commitMs)) {
    return null;
  }
  for (const item of timeline) {
    if (item.time > commitMs && item.node && item.node.isConnected) {
      return item.node;
    }
  }
  return null;
}

function renderCommitCardNode(commit) {
  const card = document.createElement("article");
  card.className = "turn commit-card";
  card.setAttribute("data-commit-sha", String(commit.sha || ""));
  card.setAttribute("data-commit-timestamp", String(commit.timestamp || ""));
  const shortSha = String(commit.sha || "").slice(0, 7);
  const subject = String(commit.subject || "").trim() || "(no subject)";
  const timestamp = String(commit.timestamp || "");
  card.innerHTML =
    "<div class='commit-body' title='" + esc(timestamp) + "'>" +
      "<code class='commit-sha'>" + esc(shortSha) + "</code>" +
      "<span class='commit-subject'>" + esc(subject) + "</span>" +
      "<time class='commit-time' datetime='" + esc(timestamp) + "'>" + esc(relativeTime(timestamp)) + "</time>" +
    "</div>";
  return card;
}

function commitTimeMs(commit) {
  const time = new Date(commit && commit.timestamp || "").getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function renderSnapshotMeta(snapshot) {
  const usage = snapshot.tokenUsage || {};
  const totalTokens = tokenUsageNumber(usage.totalTokens ?? usage.total_tokens);
  const inputTokens = tokenUsageNumber(usage.inputTokens ?? usage.input_tokens);
  const outputTokens = tokenUsageNumber(usage.outputTokens ?? usage.output_tokens);
  const tokens = totalTokens || (inputTokens + outputTokens);
  const engine = snapshot.engineLabel || "Codex";
  const cwd = String(snapshot.displayCwd || snapshot.cwd || "").trim();
  const entries = Array.isArray(snapshot.turns) ? snapshot.turns.length : 0;
  const parts = [];
  parts.push("<span class='ro'>Read-only</span>");
  parts.push("<span class='sep'>·</span><span class='k'>" + esc(engine) + "</span>");
  if (cwd) {
    parts.push("<span class='sep'>/</span><b>" + esc(cwd) + "</b>");
  }
  if (entries) {
    parts.push("<span class='sep'>·</span><span>" + esc(entries) + " 条记录</span>");
  }
  if (snapshot.commitCount !== "" && snapshot.commitCount !== undefined && snapshot.commitCount !== null) {
    parts.push("<span class='sep'>·</span><span>" + esc(snapshot.commitCount) + " commits</span>");
  }
  if (tokens) {
    parts.push("<span class='sep'>·</span><span><b>" + esc(formatTokenShort(tokens)) + "</b> tokens</span>");
  }
  if (snapshot.redacted) {
    parts.push("<span class='sep'>·</span><span class='tag'><span class='dot'></span>已脱敏</span>");
  }
  if (isLiveSessionItem(snapshot) || (state.liveTail.active && (snapshot.ref || state.selected) === state.liveTail.ref)) {
    parts.push("<span class='sep'>·</span><span class='live-indicator' aria-live='off' title='实时会话，自动跟随最新内容'><span class='live-dot' aria-hidden='true'></span>实时</span>");
  }
  return "<div class='dossier'>" + parts.join("") + "</div>";
}

function renderSnapshotGoal(snapshot) {
  return snapshot.goalObjective
    ? "<b>目标</b><span>" + esc(snapshot.goalObjective) + "</span>"
    : "";
}

function formatTokenShort(value) {
  const n = tokenUsageNumber(value);
  if (!n) return "0";
  if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(/\\.0$/, "") + "B";
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\\.0$/, "") + "k";
  return String(n);
}

function tokenUsageNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function formatTokenCount(value) {
  const number = tokenUsageNumber(value);
  return number ? new Intl.NumberFormat("zh-CN").format(number) : "0";
}

function postSnapshotState(snapshot) {
  if (!window.parent || window.parent === window) {
    return;
  }
  const options = activeOptions();
  window.parent.postMessage({
    type: "agent-snapshot:state",
    version: 1,
    selected: state.selected,
    title: snapshot.title || state.selected,
    engineLabel: snapshot.engineLabel || "Codex",
    redacted: Boolean(snapshot.redacted),
    options: Object.fromEntries(options.entries()),
  }, "*");
}

`;
