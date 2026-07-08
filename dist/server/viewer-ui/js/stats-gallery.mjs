// @ts-nocheck
export const statsGalleryJs = `const STATS_RATE_KEY = "agent-snapshot.stats-rate.v1";
const STATS_FILTERS = [
  { key: "all", label: "全部" },
  { key: "codex", label: "Codex" },
  { key: "claude", label: "Claude" },
  { key: "trae", label: "Trae" },
];
const STATS_ENGINE_LABELS = { all: "全部", codex: "Codex", claude: "Claude Code", trae: "Trae" };
const GALLERY_FILTERS = [
  { key: "all", label: "全部" },
  { key: "codex", label: "Codex" },
  { key: "claude", label: "Claude" },
  { key: "trae", label: "Trae" },
];

function loadStatsRate() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATS_RATE_KEY) || "null");
    if (saved && typeof saved === "object") {
      state.statsRate = { in: Number(saved.in) || 0, out: Number(saved.out) || 0 };
    }
  } catch (_error) {
    // Ignore malformed persisted rate.
  }
}

async function openStats() {
  $("statsOverlay").hidden = false;
  document.body.classList.add("stats-open");
  beginFocusTrap("stats", $("statsOverlay"), { initialFocus: () => $("closeStats"), close: closeStats });
  loadStats();
}

function closeStats() {
  $("statsOverlay").hidden = true;
  document.body.classList.remove("stats-open");
  endFocusTrap("stats");
}

function openGallery() {
  state.gallery.open = true;
  $("galleryOverlay").hidden = false;
  document.body.classList.add("gallery-open");
  renderGallery();
  beginFocusTrap("gallery", $("galleryOverlay"), { initialFocus: () => $("closeGallery"), close: closeGallery });
  if (!state.gallery.items.length && !state.gallery.loading) {
    loadGallery(true);
  }
}

function closeGallery() {
  closeGalleryLightbox({ restoreFocus: false });
  state.gallery.open = false;
  $("galleryOverlay").hidden = true;
  document.body.classList.remove("gallery-open");
  endFocusTrap("gallery");
}

async function setGallerySource(source) {
  const key = GALLERY_FILTERS.some((item) => item.key === source) ? source : "all";
  if (state.gallery.source === key && state.gallery.items.length) {
    return;
  }
  state.gallery.source = key;
  await loadGallery(true);
}

async function loadGallery(reset = false) {
  if (state.gallery.loading) {
    return;
  }
  if (!reset && !state.gallery.hasMore) {
    return;
  }
  const token = state.gallery.requestToken + 1;
  state.gallery.requestToken = token;
  state.gallery.loading = true;
  state.gallery.error = "";
  if (reset) {
    state.gallery.items = [];
    state.gallery.offset = 0;
    state.gallery.hasMore = true;
  }
  renderGallery();
  try {
    const query = new URLSearchParams({
      source: state.gallery.source,
      limit: String(state.gallery.limit),
      offset: String(reset ? 0 : state.gallery.items.length),
    });
    const response = await fetch("/api/images?" + query.toString());
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to load images");
    }
    if (token !== state.gallery.requestToken) {
      return;
    }
    const entries = Array.isArray(result) ? result : Array.isArray(result.entries) ? result.entries : [];
    state.gallery.items = reset ? entries : state.gallery.items.concat(entries);
    state.gallery.offset = state.gallery.items.length;
    state.gallery.hasMore = result && Object.prototype.hasOwnProperty.call(result, "hasMore")
      ? Boolean(result.hasMore) && entries.length > 0
      : entries.length >= state.gallery.limit;
  } catch (error) {
    if (token === state.gallery.requestToken) {
      state.gallery.error = error instanceof Error ? error.message : String(error);
    }
  } finally {
    if (token === state.gallery.requestToken) {
      state.gallery.loading = false;
      renderGallery();
    }
  }
}

function renderGallery() {
  renderGalleryFilters();
  const body = $("galleryBody");
  if (!body) {
    return;
  }
  if (state.gallery.loading && !state.gallery.items.length) {
    body.innerHTML = renderLoading("正在扫描图片...");
    return;
  }
  if (state.gallery.error && !state.gallery.items.length) {
    body.innerHTML = "<div class='gallery-empty gallery-error'>" + esc(state.gallery.error) + "</div>";
    return;
  }
  if (!state.gallery.items.length) {
    body.innerHTML = "<div class='gallery-empty'>还没有发现图片</div>";
    return;
  }
  const grid = "<div class='gallery-grid'>" + state.gallery.items.map(renderGalleryCard).join("") + "</div>";
  const more = state.gallery.hasMore || state.gallery.loading || state.gallery.error
    ? "<div class='gallery-footer'>" +
        (state.gallery.error ? "<span class='load-more-meta load-more-error'>" + esc(state.gallery.error) + "</span>" : "") +
        (state.gallery.hasMore || state.gallery.loading ? "<button class='gallery-more' type='button' data-gallery-more='1'" + (state.gallery.loading ? " disabled aria-busy='true'" : "") + ">" + (state.gallery.loading ? "正在加载..." : "加载更多") + "</button>" : "") +
      "</div>"
    : "";
  body.innerHTML = grid + more;
  wireGalleryImageLoads(body);
}

function renderGalleryFilters() {
  const target = $("galleryFilters");
  if (!target) {
    return;
  }
  target.innerHTML = GALLERY_FILTERS.map((filter) => {
    const active = state.gallery.source === filter.key;
    return "<button class='gallery-chip" + (active ? " active" : "") + "' type='button' data-gallery-source='" + esc(filter.key) + "' aria-pressed='" + (active ? "true" : "false") + "'>" + esc(filter.label) + "</button>";
  }).join("");
}

function renderGalleryCard(entry, index) {
  const title = String(entry.sessionTitle || entry.sessionRef || "Untitled session");
  const meta = [entry.engineLabel || galleryEngineLabel(entry.engine), relativeTime(entry.timestamp), galleryProjectLabel(entry.project)].filter(Boolean).join(" · ");
  const imageUrl = "/api/image?ref=" + encodeURIComponent(entry.id || "");
  const aspectRatio = galleryImageAspectRatio(entry);
  return "<article class='gallery-card' data-gallery-index='" + esc(index) + "'>" +
    "<button class='gallery-thumb' type='button' data-gallery-lightbox='" + esc(index) + "' title='查看大图' style='aspect-ratio:" + esc(aspectRatio) + "'>" +
      "<img src='" + esc(imageUrl) + "' alt='" + esc(title) + "' loading='lazy' decoding='async'>" +
    "</button>" +
    "<button class='gallery-card-meta' type='button' data-gallery-session='" + esc(index) + "' title='打开会话并跳到图片所在回合'>" +
      "<strong>" + esc(title) + "</strong>" +
      "<span>" + esc(meta) + "</span>" +
    "</button>" +
  "</article>";
}

function galleryImageAspectRatio(entry) {
  const width = Number(entry?.width || 0);
  const height = Number(entry?.height || 0);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return Math.round(width) + " / " + Math.round(height);
  }
  return "4 / 3";
}

function wireGalleryImageLoads(root) {
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  for (const image of scope.querySelectorAll(".gallery-thumb img")) {
    const markLoaded = () => image.classList.add("loaded");
    if (image.complete && image.naturalWidth > 0) {
      markLoaded();
    } else {
      image.addEventListener("load", markLoaded, { once: true });
    }
  }
}

async function openGallerySession(index) {
  const entry = state.gallery.items[Number(index)];
  if (!entry?.sessionRef) {
    return;
  }
  closeGallery();
  if (entry.engine && entry.engine !== "all") {
    state.activeSource = visibleSourceKey(entry.engine);
  }
  await selectSession(entry.sessionRef);
  const turn = Number(entry.turnNumber || 0) || Number(entry.turnIndex || 0) + 1;
  window.setTimeout(() => {
    if (!focusTurn(turn)) {
      showToast("已打开会话，未找到对应回合", true);
    }
  }, 80);
}

function openGalleryLightbox(index) {
  const itemIndex = clampNumber(Number(index), 0, state.gallery.items.length - 1);
  if (!state.gallery.items[itemIndex]) {
    return;
  }
  state.gallery.lightboxOpen = true;
  state.gallery.lightboxIndex = itemIndex;
  $("galleryLightbox").hidden = false;
  updateGalleryLightbox();
  beginFocusTrap("lightbox", $("galleryLightbox"), {
    initialFocus: () => document.querySelector("[data-lightbox-next]:not(:disabled), [data-lightbox-prev]:not(:disabled)") || $("galleryLightbox"),
    close: closeGalleryLightbox,
  });
}

function closeGalleryLightbox(options = {}) {
  state.gallery.lightboxOpen = false;
  const overlay = $("galleryLightbox");
  if (overlay) {
    overlay.hidden = true;
  }
  endFocusTrap("lightbox", { restore: options.restoreFocus !== false });
  const image = $("galleryLightboxImage");
  if (image) {
    image.removeAttribute("src");
    image.alt = "";
  }
}

function moveGalleryLightbox(delta) {
  if (!state.gallery.items.length) {
    return;
  }
  const length = state.gallery.items.length;
  state.gallery.lightboxIndex = (state.gallery.lightboxIndex + delta + length) % length;
  updateGalleryLightbox();
}

function updateGalleryLightbox() {
  const entry = state.gallery.items[state.gallery.lightboxIndex];
  if (!entry) {
    closeGalleryLightbox();
    return;
  }
  const title = String(entry.sessionTitle || entry.sessionRef || "Image");
  const meta = [galleryEngineLabel(entry.engine), relativeTime(entry.timestamp), galleryProjectLabel(entry.project)].filter(Boolean).join(" · ");
  const image = $("galleryLightboxImage");
  image.src = "/api/image?ref=" + encodeURIComponent(entry.id || "");
  image.alt = title;
  $("galleryLightboxCaption").textContent = title + (meta ? " · " + meta : "");
  for (const button of document.querySelectorAll("[data-lightbox-prev], [data-lightbox-next]")) {
    button.disabled = state.gallery.items.length <= 1;
  }
}

function galleryEngineLabel(engine) {
  if (engine === "claude") return "Claude";
  if (engine === "trae") return "Trae";
  return engine === "codex" ? "Codex" : "";
}

function galleryProjectLabel(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const clean = text.replace(/[\\\\/]+$/, "");
  const parts = clean.split(/[\\\\/]/).filter(Boolean);
  return parts[parts.length - 1] || clean;
}

async function loadStats() {
  const requestToken = state.statsRequestToken + 1;
  state.statsRequestToken = requestToken;
  renderStatsShell();
  loadStatsQuota(requestToken);
  loadStatsActivity(requestToken);
  loadStatsUsage(requestToken);
  loadStatsInsights(requestToken);
  if (state.statsWeeklyDigestOpen) {
    loadStatsWeeklyDigest(requestToken);
  }
}

function renderStatsShell() {
  $("statsBody").innerHTML =
    "<div class='stats-shell'>" +
      "<div class='stats-filterbar'>" +
        "<p class='stats-note'>各区块独立加载；项目 token 来自本机搜索索引，首次打开会后台补齐。</p>" +
        "<div id='statsEngineFilters' class='stats-chip-group' role='group' aria-label='统计来源筛选'></div>" +
      "</div>" +
      "<div class='stats-grid'>" +
        statsSectionShell("quota", "配额", "Codex / Claude") +
        statsSectionShell("activity", "活跃度", "最近 26 周") +
        statsSectionShell("projects", "项目", "Top 项目") +
        statsSectionShell("usage", "用量", "Token / 成本") +
        statsSectionShell("insights", "洞察", "最新 500 个会话") +
      "</div>" +
      "<p class='stats-note'>数据来自本机日志。Codex 的 token 为各轮累计（含缓存/重复上下文），成本仅按当前填写单价粗估。</p>" +
    "</div>";
  renderStatsFilter();
}

function statsSectionShell(kind, title, meta) {
  const action = kind === "activity"
    ? "<span class='stats-section-actions'><span class='stats-section-meta'>" + esc(meta) + "</span><button class='stats-mini-action' type='button' data-weekly-digest-toggle='1' aria-pressed='" + (state.statsWeeklyDigestOpen ? "true" : "false") + "'>" + (state.statsWeeklyDigestOpen ? "热力图" : "周报") + "</button></span>"
    : "<span class='stats-section-meta'>" + esc(meta) + "</span>";
  return "<section class='stats-section stats-section-" + esc(kind) + "'>" +
    "<div class='stats-section-head'><h3>" + esc(title) + "</h3>" + action + "</div>" +
    "<div id='stats" + kind[0].toUpperCase() + kind.slice(1) + "Panel'>" + renderStatsSkeleton() + "</div>" +
  "</section>";
}

function renderStatsSkeleton() {
  return "<div class='stats-skeleton' aria-busy='true'>" +
    "<span class='stats-skeleton-line mid'></span>" +
    "<span class='stats-skeleton-line'></span>" +
    "<span class='stats-skeleton-line short'></span>" +
  "</div>";
}

async function loadStatsQuota(requestToken) {
  try {
    const response = await fetch("/api/quota");
    const quota = await response.json();
    if (!response.ok) {
      throw new Error(quota.error || "配额读取失败");
    }
    if (requestToken !== state.statsRequestToken) {
      return;
    }
    state.statsQuota = quota;
    renderStatsQuota();
  } catch (error) {
    if (requestToken === state.statsRequestToken) {
      $("statsQuotaPanel").innerHTML = statsError(error, "配额读取失败");
    }
  }
}

async function loadStatsActivity(requestToken) {
  try {
    const response = await fetch("/api/activity");
    const activity = await response.json();
    if (!response.ok) {
      throw new Error(activity.error || "活动统计失败");
    }
    if (requestToken !== state.statsRequestToken) {
      return;
    }
    state.statsActivity = activity;
    renderStatsFilter();
    renderStatsActivity();
    renderStatsProjects();
  } catch (error) {
    if (requestToken === state.statsRequestToken) {
      $("statsActivityPanel").innerHTML = statsError(error, "活动统计失败");
      $("statsProjectsPanel").innerHTML = statsError(error, "项目排行失败");
    }
  }
}

async function loadStatsWeeklyDigest(requestToken = state.statsRequestToken) {
  const token = state.statsWeeklyDigestRequestToken + 1;
  state.statsWeeklyDigestRequestToken = token;
  state.statsWeeklyDigestLoading = true;
  state.statsWeeklyDigestError = "";
  renderStatsActivity();
  try {
    const response = await fetch("/api/weekly-digest?weeks=1");
    const digest = await response.json();
    if (!response.ok) {
      throw new Error(digest.error || "周报生成失败");
    }
    if (requestToken !== state.statsRequestToken || token !== state.statsWeeklyDigestRequestToken) {
      return;
    }
    state.statsWeeklyDigest = digest;
  } catch (error) {
    if (requestToken === state.statsRequestToken && token === state.statsWeeklyDigestRequestToken) {
      state.statsWeeklyDigestError = error instanceof Error ? error.message : String(error);
    }
  } finally {
    if (requestToken === state.statsRequestToken && token === state.statsWeeklyDigestRequestToken) {
      state.statsWeeklyDigestLoading = false;
      renderStatsActivity();
    }
  }
}

async function loadStatsUsage(requestToken) {
  try {
    const response = await fetch("/api/search-stats");
    const stats = await response.json();
    if (!response.ok) {
      throw new Error(stats.error || "统计失败");
    }
    if (requestToken !== state.statsRequestToken) {
      return;
    }
    state.stats = stats;
    renderStatsUsage();
  } catch (error) {
    if (requestToken === state.statsRequestToken) {
      $("statsUsagePanel").innerHTML = statsError(error, "用量统计失败");
    }
  }
}

async function loadStatsInsights(requestToken) {
  state.statsInsightsLoading = true;
  state.statsInsightsError = "";
  renderStatsInsights();
  try {
    const response = await fetch("/api/insights?limit=500");
    const insights = await response.json();
    if (!response.ok) {
      throw new Error(insights.error || "洞察分析失败");
    }
    if (requestToken !== state.statsRequestToken) {
      return;
    }
    state.statsInsights = insights;
    renderStatsInsights();
  } catch (error) {
    if (requestToken === state.statsRequestToken) {
      state.statsInsightsError = error instanceof Error ? error.message : String(error);
      renderStatsInsights();
    }
  } finally {
    if (requestToken === state.statsRequestToken) {
      state.statsInsightsLoading = false;
      renderStatsInsights();
    }
  }
}

function statsError(error, fallback) {
  return "<div class='search-empty'>" + esc(error instanceof Error ? error.message : (error || fallback)) + "</div>";
}

function renderStatsFilter() {
  const target = $("statsEngineFilters");
  if (!target) {
    return;
  }
  const counts = statsEngineCounts();
  target.innerHTML = STATS_FILTERS.map((item) => {
    const active = item.key === state.statsFilter;
    const count = counts[item.key] || 0;
    return "<button type='button' class='stats-chip" + (active ? " active" : "") + "' data-stats-filter='" + esc(item.key) + "' aria-pressed='" + (active ? "true" : "false") + "'>" +
      esc(item.label) + " <b>" + esc(count) + "</b>" +
    "</button>";
  }).join("");
}

function statsEngineCounts() {
  const activity = state.statsActivity;
  const engines = activity && activity.engines ? activity.engines : {};
  return {
    all: Number(engines.total || 0),
    codex: Number(engines.codex || 0),
    claude: Number(engines.claude || 0),
    trae: Number(engines.trae || 0),
  };
}

function statsTile(label, value, sub) {
  return "<div class='stat-tile'><span class='stat-tile-k'>" + esc(label) + "</span>" +
    "<b class='stat-tile-v'>" + esc(value) + "</b>" +
    (sub ? "<span class='stat-tile-sub'>" + esc(sub) + "</span>" : "") +
    "</div>";
}

function statsBar(label, count, total, max, sub) {
  const pct = max > 0 ? Math.max(2, Math.round((total / max) * 100)) : 0;
  return "<div class='stat-row'>" +
    "<span class='stat-row-name' title='" + esc(label) + "'>" + esc(label) + "</span>" +
    "<span class='stat-row-track'><span class='stat-row-fill' style='width:" + pct + "%'></span></span>" +
    "<span class='stat-row-val'>" + esc(formatTokenShort(total)) + "<b>" + esc(sub || "") + "</b></span>" +
  "</div>";
}

function renderStatsQuota() {
  const quota = state.statsQuota;
  const hasCodexQuota = quota && quota.available;
  const freshness = hasCodexQuota && quota.updatedAt ? relativePast(quota.updatedAt) + "的快照" : "快照时间未知";
  const plan = hasCodexQuota && quota.planType ? " · " + quota.planType : "";
  const codexHtml = hasCodexQuota
    ? quotaMeter("Codex · 5 小时窗口", quota.primary) +
      quotaMeter("Codex · 周配额", quota.secondary) +
      "<div class='stats-muted'>Codex" + esc(plan) + " · " + esc(freshness) + "</div>"
    : "<div class='stats-muted'>未找到 Codex CLI 配额快照。</div>";
  $("statsQuotaPanel").innerHTML =
    "<div class='quota-list'>" +
      codexHtml +
      claudeBlockCard(quota && quota.claude) +
    "</div>";
}

function quotaMeter(label, data) {
  if (!data) {
    return "<div class='stats-muted'>" + esc(label) + " 暂无数据</div>";
  }
  const pct = Math.max(0, Math.min(100, Number(data.usedPercent || 0)));
  const color = quotaColor(pct);
  return "<div class='quota-row'>" +
    "<div class='quota-head'><span class='quota-label'>" + esc(label) + "</span><span class='quota-value'>" + esc(formatPercent(pct)) + "</span></div>" +
    "<div class='quota-track'><span class='quota-fill' style='width:" + pct.toFixed(1) + "%;background:" + esc(color) + "'></span></div>" +
    "<div class='quota-meta'><span>" + esc(resetCountdown(data.resetsAt)) + "</span><span>" + esc(formatWindow(data.windowMinutes)) + "</span></div>" +
  "</div>";
}

function claudeBlockCard(data) {
  if (!data || data.active !== true) {
    return "<div class='quota-row quota-block-card'>" +
      "<div class='quota-head'><span class='quota-label'>Claude Code · 5 小时块</span><span class='quota-value'>无活动</span></div>" +
      "<div class='stats-muted'>最近 6 小时无 Claude 活动</div>" +
    "</div>";
  }
  const tokens = data.tokens || {};
  const input = tokenUsageNumber(tokens.input);
  const output = tokenUsageNumber(tokens.output);
  const cacheCreation = tokenUsageNumber(tokens.cacheCreation);
  const cacheRead = tokenUsageNumber(tokens.cacheRead);
  const burn = input + output + cacheCreation;
  const messages = tokenUsageNumber(data.messages);
  return "<div class='quota-row quota-block-card'>" +
    "<div class='quota-head'><span class='quota-label'>Claude Code · 5 小时块</span><span class='quota-value'>" + esc(claudeBlockCountdown(data.blockEnd)) + "</span></div>" +
    "<div class='quota-stat-grid'>" +
      quotaStat("token 总量", formatTokenCount(burn), "不含缓存读") +
      quotaStat("消息", formatTokenCount(messages), "") +
      quotaStat("缓存读", formatTokenCount(cacheRead), "单独记录") +
    "</div>" +
    "<div class='quota-meta'><span>" + esc(formatClaudeBlockRange(data.blockStart, data.blockEnd)) + "</span><span>本块无套餐上限数据，仅作燃烧参考</span></div>" +
  "</div>";
}

function quotaStat(label, value, sub) {
  return "<span class='quota-stat'><b>" + esc(value) + "</b><small>" + esc(label) + "</small>" + (sub ? "<em>" + esc(sub) + "</em>" : "") + "</span>";
}

function quotaColor(percent) {
  const pct = Math.max(0, Math.min(100, Number(percent || 0)));
  const hue = pct < 70 ? Math.round(138 - (pct / 70) * 90) : Math.round(48 - ((pct - 70) / 30) * 40);
  return "hsl(" + Math.max(8, hue) + " 55% 38%)";
}

function resetCountdown(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return "重置时间未知";
  }
  const diff = time - Date.now();
  if (diff <= 0) {
    return "已到重置时间";
  }
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff >= day) {
    return Math.ceil(diff / day) + " 天后重置";
  }
  if (diff >= hour) {
    return Math.ceil(diff / hour) + " 小时后重置";
  }
  return Math.max(1, Math.ceil(diff / minute)) + " 分钟后重置";
}

function claudeBlockCountdown(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return "新块时间未知";
  }
  const diff = time - Date.now();
  if (diff <= 0) {
    return "等待新块";
  }
  const minute = 60 * 1000;
  const totalMinutes = Math.max(1, Math.ceil(diff / minute));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return hours + " 小时 " + minutes + " 分后进入新块";
  }
  if (hours > 0) {
    return hours + " 小时后进入新块";
  }
  return totalMinutes + " 分钟后进入新块";
}

function formatClaudeBlockRange(start, end) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return "块时间未知";
  }
  const formatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return formatter.format(startTime) + " - " + formatter.format(endTime);
}

function formatWindow(minutes) {
  const n = Number(minutes || 0);
  if (!n) {
    return "";
  }
  if (n >= 60 * 24) {
    return Math.round(n / 60 / 24) + " 天窗口";
  }
  if (n >= 60) {
    return Math.round(n / 60) + " 小时窗口";
  }
  return n + " 分钟窗口";
}

function renderStatsActivity() {
  if (state.statsWeeklyDigestOpen) {
    renderStatsWeeklyDigest();
    return;
  }
  const activity = state.statsActivity;
  if (!activity) {
    return;
  }
  const filter = state.statsFilter;
  const days = activity.days || [];
  const hours = activity.hours || [];
  const total = days.reduce((sum, day) => sum + filteredCount(day, filter), 0);
  const maxDay = Math.max(1, ...days.map((day) => filteredCount(day, filter)));
  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"].map((label) => "<span>" + label + "</span>").join("");
  const cells = days.map((day) => {
    const count = filteredCount(day, filter);
    const level = heatLevel(count, maxDay);
    const title = day.date + " · " + count + " 次会话";
    return "<span class='activity-day level-" + level + "' title='" + esc(title) + "' aria-label='" + esc(title) + "'></span>";
  }).join("");
  const maxHour = Math.max(1, ...hours.map((hour) => filteredCount(hour, filter)));
  const hourBars = hours.map((hour) => {
    const count = filteredCount(hour, filter);
    const height = count ? Math.max(4, Math.round((count / maxHour) * 54)) : 2;
    const title = String(hour.hour).padStart(2, "0") + ":00 · " + count + " 次会话";
    return "<span class='hour-bar' style='height:" + height + "px' title='" + esc(title) + "'></span>";
  }).join("");
  $("statsActivityPanel").innerHTML =
    "<div class='activity-panel'>" +
      "<div class='stats-muted'>" + esc(STATS_ENGINE_LABELS[filter] || filter) + " · " + esc(total) + " 次会话</div>" +
      "<div class='heatmap-frame'>" +
        "<div class='heatmap-weekdays' aria-hidden='true'>" + weekdayLabels + "</div>" +
        "<div class='activity-heatmap' role='img' aria-label='最近 26 周活动热力图'>" + cells + "</div>" +
      "</div>" +
      "<div class='hour-panel'>" +
        "<div class='stats-section-head'><h3>按小时分布</h3><span class='stats-section-meta'>本地时间</span></div>" +
        "<div class='hour-bars' role='img' aria-label='按小时分布'>" + hourBars + "</div>" +
        "<div class='hour-axis'><span>00</span><span>06</span><span>12</span><span>23</span></div>" +
      "</div>" +
    "</div>";
}

function renderStatsWeeklyDigest() {
  const panel = $("statsActivityPanel");
  if (!panel) {
    return;
  }
  if (state.statsWeeklyDigestLoading && !state.statsWeeklyDigest) {
    panel.innerHTML = renderLoading("正在生成周报...");
    return;
  }
  if (state.statsWeeklyDigestError && !state.statsWeeklyDigest) {
    panel.innerHTML = statsError(state.statsWeeklyDigestError, "周报生成失败");
    return;
  }
  const digest = state.statsWeeklyDigest;
  if (!digest) {
    panel.innerHTML = renderLoading("正在生成周报...");
    return;
  }
  const weeks = Array.isArray(digest.weeks) ? digest.weeks : [];
  const current = weeks.find((week) => week?.range?.current) || weeks[weeks.length - 1] || null;
  const currentIndex = current ? weeks.indexOf(current) : -1;
  const previous = currentIndex > 0 ? weeks[currentIndex - 1] : null;
  const currentHtml = current ? renderWeeklyDigestCard(current, true) : "<div class='stats-muted'>暂无本周数据</div>";
  const previousHtml = previous ? renderWeeklyDigestCard(previous, false) : "<div class='stats-muted'>暂无上周数据</div>";
  panel.innerHTML =
    "<div class='weekly-digest-panel'>" +
      "<div class='weekly-digest-toolbar'>" +
        "<div><b>本周 vs 上周</b><span>" + esc(digest.range?.startDate || "") + " 至 " + esc(digest.range?.endDate || "") + "</span></div>" +
        "<div class='weekly-digest-actions'>" +
          "<button class='stats-mini-action' type='button' data-weekly-digest-copy='1'>复制 Markdown</button>" +
          "<button class='stats-mini-action' type='button' data-weekly-digest-download='1'>下载 .md</button>" +
        "</div>" +
      "</div>" +
      (state.statsWeeklyDigestError ? "<div class='weekly-digest-warning'>" + esc(state.statsWeeklyDigestError) + "</div>" : "") +
      "<div class='weekly-digest-grid'>" + currentHtml + previousHtml + "</div>" +
      renderWeeklyTopProjects(current) +
    "</div>";
}

function renderWeeklyDigestCard(week, primary) {
  return "<article class='weekly-card" + (primary ? " primary" : "") + "'>" +
    "<div class='weekly-card-head'><strong>" + esc(week.range?.label || "") + "</strong><span>" + esc(weeklyRangeText(week)) + "</span></div>" +
    "<div class='weekly-metrics'>" +
      weeklyMetric("会话", formatTokenCount(week.sessionCount?.total), primary ? week.comparison?.sessions : null, false) +
      weeklyMetric("Tokens", formatTokenShort(week.totalTokens?.total), primary ? week.comparison?.totalTokens : null, true) +
    "</div>" +
    "<div class='weekly-detail-list'>" +
      "<span><b>来源</b>" + esc(weeklyEngineText(week)) + "</span>" +
      "<span><b>最活跃</b>" + esc(weeklyBusiestText(week)) + "</span>" +
      "<span><b>最长会话</b>" + esc(weeklyLongestText(week)) + "</span>" +
    "</div>" +
  "</article>";
}

function weeklyMetric(label, value, comparison, tokenValue) {
  return "<div class='weekly-metric'><span>" + esc(label) + "</span><strong>" + esc(value) + "</strong>" + weeklyDelta(comparison, tokenValue) + "</div>";
}

function weeklyDelta(comparison, tokenValue) {
  if (!comparison) {
    return "<em class='weekly-delta flat'>环比 -</em>";
  }
  const change = Number(comparison.change || 0);
  if (!change) {
    return "<em class='weekly-delta flat'>持平</em>";
  }
  const cls = change > 0 ? "up" : "down";
  const arrow = change > 0 ? "▲" : "▼";
  const value = tokenValue ? formatTokenShort(Math.abs(change)) : formatTokenCount(Math.abs(change));
  return "<em class='weekly-delta " + cls + "'>" + arrow + " " + esc(value) + "</em>";
}

function weeklyRangeText(week) {
  const range = week?.range || {};
  return [range.startDate, range.endDate].filter(Boolean).join(" 至 ");
}

function weeklyEngineText(week) {
  const counts = week?.sessionCount || {};
  return "Codex " + formatTokenCount(counts.codex) + " · Claude " + formatTokenCount(counts.claude) + " · Trae " + formatTokenCount(counts.trae);
}

function weeklyBusiestText(week) {
  const day = week?.busiestDay;
  return day ? day.date + " · " + formatTokenCount(day.sessions) + " 次" : "暂无";
}

function weeklyLongestText(week) {
  const session = week?.longestSession;
  if (!session) {
    return "暂无";
  }
  return String(session.title || session.ref || "Untitled session") + " · " + formatTokenCount(session.turns) + " turns";
}

function renderWeeklyTopProjects(week) {
  const projects = Array.isArray(week?.topProjects) ? week.topProjects : [];
  if (!projects.length) {
    return "<div class='weekly-projects'><div class='rank-title'>本周 Top 项目</div><div class='stats-muted'>暂无项目数据</div></div>";
  }
  const rows = projects.map((project) =>
    "<tr><td title='" + esc(project.path || project.name) + "'>" + esc(project.name || "(无项目)") + "</td><td>" + esc(formatTokenCount(project.sessions)) + "</td><td>" + esc(formatTokenShort(project.totalTokens)) + "</td></tr>"
  ).join("");
  return "<div class='weekly-projects'>" +
    "<div class='rank-title'>本周 Top 项目</div>" +
    "<table class='weekly-project-table'><thead><tr><th>项目</th><th>会话</th><th>Tokens</th></tr></thead><tbody>" + rows + "</tbody></table>" +
  "</div>";
}

async function toggleWeeklyDigest() {
  state.statsWeeklyDigestOpen = !state.statsWeeklyDigestOpen;
  updateWeeklyDigestToggle();
  renderStatsActivity();
  if (state.statsWeeklyDigestOpen && !state.statsWeeklyDigestLoading && !state.statsWeeklyDigest) {
    await loadStatsWeeklyDigest();
  }
}

function updateWeeklyDigestToggle() {
  const button = document.querySelector("[data-weekly-digest-toggle]");
  if (!button) {
    return;
  }
  button.textContent = state.statsWeeklyDigestOpen ? "热力图" : "周报";
  button.setAttribute("aria-pressed", state.statsWeeklyDigestOpen ? "true" : "false");
}

async function copyWeeklyDigestMarkdown() {
  const digest = state.statsWeeklyDigest;
  const markdown = String(digest?.markdown || "");
  if (!markdown) {
    showToast("周报还没生成完成", true);
    return;
  }
  const copied = await copyText(markdown);
  showToast(copied ? "已复制周报 Markdown" : "复制失败", !copied);
}

function downloadWeeklyDigestMarkdown() {
  const digest = state.statsWeeklyDigest;
  const markdown = String(digest?.markdown || "");
  if (!markdown) {
    showToast("周报还没生成完成", true);
    return;
  }
  const date = String(digest.generatedDate || new Date().toISOString().slice(0, 10));
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "agent-weekly-" + date + ".md";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_error) {
    // Fall through to the textarea copy path.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "readonly");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch (_error) {
    return false;
  }
}

function renderStatsInsights() {
  const panel = $("statsInsightsPanel");
  if (!panel) {
    return;
  }
  const insights = state.statsInsights;
  if (state.statsInsightsLoading && !insights) {
    panel.innerHTML = renderStatsSkeleton();
    return;
  }
  if (state.statsInsightsError && !insights) {
    panel.innerHTML = statsError(state.statsInsightsError, "洞察分析失败");
    return;
  }
  if (!insights) {
    panel.innerHTML = renderStatsSkeleton();
    return;
  }
  const filter = state.statsFilter;
  const commands = filteredInsightRows(insights.topCommands || [], filter, 7);
  const tools = filteredToolRows(insights.topTools || [], filter, 8);
  const prompts = filteredInsightRows(insights.promptPatterns || [], filter, 5);
  const chains = filteredInsightRows(insights.workflowChains || [], filter, 6);
  const freshness = insights.cached ? "缓存" : "刚生成";
  const scanned = formatTokenCount(insights.scannedSessions || 0) + " 会话 · " + freshness;
  panel.innerHTML =
    "<div class='insights-panel'>" +
      "<div class='stats-muted'>" + esc((STATS_ENGINE_LABELS[filter] || filter) + " · " + scanned) + (state.statsInsightsError ? " · " + esc(state.statsInsightsError) : "") + "</div>" +
      "<div class='insights-grid'>" +
        insightCard("常用命令", "Shell", renderCommandInsightRows(commands)) +
        insightCard("常用工具", "按来源", renderToolInsightRows(tools, filter)) +
        insightCard("常用提问模式", "草稿，仅供人工整理", renderPromptInsightRows(prompts)) +
        insightCard("高频操作链", "草稿，仅供人工整理", renderChainInsightRows(chains)) +
      "</div>" +
    "</div>";
}

function insightCard(title, meta, body) {
  return "<article class='insight-card'>" +
    "<div class='insight-card-head'><b>" + esc(title) + "</b><span>" + esc(meta) + "</span></div>" +
    "<div class='insight-list'>" + body + "</div>" +
  "</article>";
}

function filteredInsightRows(items, filter, limit) {
  return (Array.isArray(items) ? items : [])
    .map((entry) => ({ entry, visibleCount: insightVisibleCount(entry, filter) }))
    .filter((row) => row.visibleCount > 0)
    .sort((a, b) => (b.visibleCount - a.visibleCount) || compareInsightTime(a.entry, b.entry))
    .slice(0, limit)
    .map((row) => ({ ...row.entry, visibleCount: row.visibleCount }));
}

function filteredToolRows(items, filter, limit) {
  return (Array.isArray(items) ? items : [])
    .filter((entry) => filter === "all" || entry.engine === filter)
    .map((entry) => ({ ...entry, visibleCount: Number(entry.count || 0) }))
    .filter((entry) => entry.visibleCount > 0)
    .sort((a, b) => (b.visibleCount - a.visibleCount) || compareInsightTime(a, b) || String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"))
    .slice(0, limit);
}

function insightVisibleCount(entry, filter) {
  if (!entry) {
    return 0;
  }
  if (filter === "all") {
    return Number(entry.count || 0);
  }
  const counts = entry.engineCounts || {};
  return Number(counts[filter] || 0);
}

function compareInsightTime(a, b) {
  return (new Date(b?.lastUsedAt || 0).getTime() || 0) - (new Date(a?.lastUsedAt || 0).getTime() || 0);
}

function renderCommandInsightRows(rows) {
  if (!rows.length) {
    return renderInsightEmpty("暂无命令数据");
  }
  return rows.map((entry) =>
    "<div class='insight-row'>" +
      "<span class='insight-main'><b title='" + esc(entry.command || "") + "'>" + esc(entry.command || "未知命令") + "</b><small>" + esc(insightLastUsed(entry.lastUsedAt)) + "</small></span>" +
      "<span class='insight-count'>" + esc(formatTokenCount(entry.visibleCount || entry.count)) + "</span>" +
    "</div>"
  ).join("");
}

function renderToolInsightRows(rows, filter) {
  if (!rows.length) {
    return renderInsightEmpty("暂无工具数据");
  }
  return rows.map((entry) => {
    const label = filter === "all" ? (STATS_ENGINE_LABELS[entry.engine] || entry.engine || "来源") + " · " + (entry.name || "Tool") : (entry.name || "Tool");
    return "<div class='insight-row'>" +
      "<span class='insight-main'><b title='" + esc(label) + "'>" + esc(label) + "</b><small>" + esc(insightLastUsed(entry.lastUsedAt)) + "</small></span>" +
      "<span class='insight-count'>" + esc(formatTokenCount(entry.visibleCount || entry.count)) + "</span>" +
    "</div>";
  }).join("");
}

function renderPromptInsightRows(rows) {
  if (!rows.length) {
    return renderInsightEmpty("暂无重复模式");
  }
  return rows.map((entry) =>
    "<div class='insight-row insight-row-action'>" +
      "<span class='insight-main'><b title='" + esc(entry.example || entry.prefix || "") + "'>" + esc(entry.prefix || "提问模式") + "</b><small>" + esc(entry.example || insightLastUsed(entry.lastUsedAt)) + "</small></span>" +
      "<span class='insight-side'><span class='insight-count'>" + esc(formatTokenCount(entry.visibleCount || entry.count)) + "</span><button class='stats-mini-action insight-copy' type='button' data-skill-draft='prompt' data-insight-id='" + esc(entry.id || "") + "' title='复制 SKILL.md 草稿，仅供人工整理'>复制草稿</button></span>" +
    "</div>"
  ).join("");
}

function renderChainInsightRows(rows) {
  if (!rows.length) {
    return renderInsightEmpty("暂无操作链数据");
  }
  return rows.map((entry) =>
    "<div class='insight-row insight-row-action'>" +
      "<span class='insight-main'><b title='" + esc(entry.label || "") + "'>" + esc(entry.label || "操作链") + "</b><small>" + esc(insightLastUsed(entry.lastUsedAt)) + "</small></span>" +
      "<span class='insight-side'><span class='insight-count'>" + esc(formatTokenCount(entry.visibleCount || entry.count)) + "</span><button class='stats-mini-action insight-copy' type='button' data-skill-draft='chain' data-insight-id='" + esc(entry.id || "") + "' title='复制 SKILL.md 草稿，仅供人工整理'>复制草稿</button></span>" +
    "</div>"
  ).join("");
}

function renderInsightEmpty(text) {
  return "<div class='insight-empty'>" + esc(text) + "</div>";
}

function insightLastUsed(value) {
  const text = relativePast(value);
  return text ? "上次 " + text : "时间未知";
}

async function copyInsightSkillDraft(type, id) {
  const insights = state.statsInsights || {};
  const item = type === "prompt"
    ? (insights.promptPatterns || []).find((entry) => entry.id === id)
    : (insights.workflowChains || []).find((entry) => entry.id === id);
  if (!item) {
    showToast("未找到可导出的洞察", true);
    return;
  }
  const markdown = type === "prompt" ? promptPatternSkillDraft(item) : workflowChainSkillDraft(item);
  const copied = await copyText(markdown);
  showToast(copied ? "已复制 Skill 草稿，仅供人工整理" : "复制失败", !copied);
}

function promptPatternSkillDraft(pattern) {
  const triggers = uniqueDraftLines([pattern.prefix].concat(pattern.triggerPhrases || [], pattern.examples || [])).slice(0, 6);
  return [
    "# " + draftTitle("常用提问模式", pattern.prefix),
    "",
    "> 草稿，仅供人工整理。由 Agent Snapshots 洞察基于本机会话历史启发式生成，发布前请人工校对、补充边界与安全约束。",
    "",
    "## Description",
    "当用户以「" + draftInline(pattern.prefix) + "」或相近开头提出需求时，复用历史中反复出现的处理方式：先界定目标，再读取必要上下文，最后给出可验证的结果。",
    "",
    "## Trigger Phrases",
    triggers.map((item) => "- " + draftInline(item)).join("\\n") || "- " + draftInline(pattern.prefix || "相近提问开头"),
    "",
    "## Steps",
    "1. 复述用户目标，并确认是需要改动、分析、排障还是总结。",
    "2. 搜索并读取最相关的本地文件、会话或上下文，避免只凭记忆判断。",
    "3. 按仓库现有模式执行最小必要改动或分析，记录关键依据。",
    "4. 运行可用的检查或给出无法验证的原因。",
    "5. 用简短结论说明结果、影响范围和后续人工整理点。",
    "",
    "## Notes",
    "- 这个草稿来自 " + formatTokenCount(pattern.count || 0) + " 次相似提问，请人工合并重复触发词。",
  ].join("\\n");
}

function workflowChainSkillDraft(chain) {
  const label = chain.label || (chain.chain || []).join(" → ");
  const triggerLines = uniqueDraftLines([
    "需要按 " + label + " 完成任务",
    "修复问题并验证结果",
    "读取上下文、修改并运行检查",
  ]);
  const steps = (chain.chain || []).map((name, index) => String(index + 1) + ". " + toolStepText(name));
  return [
    "# " + draftTitle("高频操作链", label),
    "",
    "> 草稿，仅供人工整理。由 Agent Snapshots 洞察基于本机工具调用链启发式生成，发布前请人工校对、补充适用场景。",
    "",
    "## Description",
    "当任务通常需要按「" + draftInline(label) + "」推进时，使用这个流程保持上下文读取、改动和验证顺序清晰。",
    "",
    "## Trigger Phrases",
    triggerLines.map((item) => "- " + draftInline(item)).join("\\n"),
    "",
    "## Steps",
    steps.join("\\n") || "1. 按任务需要读取上下文、执行操作并验证结果。",
    "",
    "## Notes",
    "- 这个草稿来自 " + formatTokenCount(chain.count || 0) + " 次历史操作链，请人工确认每一步是否应保留。",
  ].join("\\n");
}

function toolStepText(name) {
  const key = String(name || "").toLowerCase();
  if (key === "read") return "Read：读取相关文件、配置或会话上下文，先建立事实依据。";
  if (key === "edit" || key === "multiedit" || key === "write" || key === "apply_patch") return name + "：按既有代码风格做最小必要修改，并避免无关重构。";
  if (key === "bash") return "Bash：运行目标检查、测试或诊断命令，保留失败信息用于下一步判断。";
  if (key === "websearch") return "WebSearch：只在需要当前信息或外部事实时检索，并优先使用权威来源。";
  if (key === "grep" || key === "rg" || key === "glob") return name + "：快速定位相关文件和调用点，缩小处理范围。";
  return name + "：执行该工具对应的必要操作，并记录输入、输出和后续判断。";
}

function draftTitle(prefix, value) {
  const text = draftInline(value).replace(/[#[\\]<>]/g, "").trim();
  const short = Array.from(text || "未命名模式").slice(0, 28).join("");
  return prefix + "：" + short;
}

function uniqueDraftLines(items) {
  const out = [];
  for (const item of items || []) {
    const text = draftInline(item);
    if (text && !out.includes(text)) {
      out.push(text);
    }
  }
  return out;
}

function draftInline(value) {
  return String(value || "").replace(/\\s+/g, " ").trim().slice(0, 180);
}

function heatLevel(count, max) {
  if (!count) {
    return 0;
  }
  return Math.max(1, Math.min(4, Math.ceil((count / Math.max(1, max)) * 4)));
}

function filteredCount(row, filter) {
  if (!row) {
    return 0;
  }
  if (filter === "all") {
    return Number(row.total || 0);
  }
  return Number(row[filter] || 0);
}

function renderStatsProjects() {
  const activity = state.statsActivity;
  if (!activity) {
    return;
  }
  const projects = aggregateProjects(activity.projects || [], state.statsFilter);
  const bySessions = projects.slice().sort((a, b) => (b.sessions - a.sessions) || (b.totalTokens - a.totalTokens)).slice(0, 8);
  const rate = state.statsRate;
  const hasRate = Boolean(rate.in || rate.out);
  const byTokens = projects.slice().sort((a, b) => {
    const av = hasRate ? estimatedCost(a.inputTokens, a.outputTokens) : a.totalTokens;
    const bv = hasRate ? estimatedCost(b.inputTokens, b.outputTokens) : b.totalTokens;
    return (bv - av) || (b.sessions - a.sessions);
  }).filter((entry) => entry.totalTokens > 0).slice(0, 8);
  const sessionMax = Math.max(1, ...bySessions.map((entry) => entry.sessions));
  const tokenMax = Math.max(1, ...byTokens.map((entry) => hasRate ? estimatedCost(entry.inputTokens, entry.outputTokens) : entry.totalTokens));
  const sessionRows = bySessions.map((entry) =>
    rankRow(entry.name, entry.path, entry.sessions, sessionMax, formatTokenCount(entry.sessions), entry.totalTokens ? formatTokenShort(entry.totalTokens) + " token" : "")
  ).join("") || "<div class='stats-muted'>暂无项目数据</div>";
  const tokenRows = byTokens.map((entry) => {
    const cost = estimatedCost(entry.inputTokens, entry.outputTokens);
    const metric = hasRate ? cost : entry.totalTokens;
    return rankRow(entry.name, entry.path, metric, tokenMax, formatTokenShort(entry.totalTokens), hasRate ? "≈ " + formatCost(cost) : entry.sessions + " 会话");
  }).join("") || "<div class='stats-muted'>暂无 token 数据</div>";
  $("statsProjectsPanel").innerHTML =
    "<div class='project-ranks'>" +
      "<div><p class='rank-title'>按会话数</p><div class='rank-list'>" + sessionRows + "</div></div>" +
      "<div><p class='rank-title'>按 token / 成本</p><div class='rank-list'>" + tokenRows + "</div></div>" +
    "</div>";
}

function aggregateProjects(projects, filter) {
  const map = new Map();
  for (const entry of projects) {
    const engine = entry.engine || "codex";
    if (filter !== "all" && engine !== filter) {
      continue;
    }
    const key = entry.key || entry.path || entry.name || "(无项目)";
    const item = map.get(key) || {
      key,
      name: entry.name || "(无项目)",
      path: entry.path || "",
      sessions: 0,
      indexedSessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    item.sessions += Number(entry.sessions || 0);
    item.indexedSessions += Number(entry.indexedSessions || 0);
    item.inputTokens += Number(entry.inputTokens || 0);
    item.outputTokens += Number(entry.outputTokens || 0);
    item.totalTokens += Number(entry.totalTokens || 0);
    map.set(key, item);
  }
  return Array.from(map.values()).filter((entry) => entry.sessions || entry.totalTokens);
}

function rankRow(name, path, value, max, valueText, subText) {
  const pct = max > 0 ? Math.max(2, Math.round((Number(value || 0) / max) * 100)) : 0;
  return "<div class='rank-row'>" +
    "<span class='rank-name' title='" + esc(path || name) + "'>" + esc(name) + "</span>" +
    "<span class='rank-track'><span class='rank-fill' style='width:" + pct + "%'></span></span>" +
    "<span class='rank-val'>" + esc(valueText) + (subText ? "<b>" + esc(subText) + "</b>" : "") + "</span>" +
  "</div>";
}

function renderStatsUsage() {
  const stats = state.stats;
  if (!stats) {
    return;
  }
  const rate = state.statsRate;
  const cost = (Number(stats.inputTokens || 0) / 1000000) * (rate.in || 0) + (Number(stats.outputTokens || 0) / 1000000) * (rate.out || 0);
  const tiles = [
    statsTile("已索引会话", formatTokenCount(stats.indexedSessions), (stats.sessionsWithTokens || 0) + " 条有 token 数据"),
    statsTile("总 token", formatTokenShort(stats.totalTokens), formatTokenCount(stats.totalTokens)),
    statsTile("输入 token", formatTokenShort(stats.inputTokens), ""),
    statsTile("输出 token", formatTokenShort(stats.outputTokens), ""),
  ].join("");

  const engineMax = Math.max(1, ...(stats.byEngine || []).map((entry) => Number(entry.total || 0)));
  const engineRows = (stats.byEngine || []).filter((entry) => entry.sessions).map((entry) =>
    statsBar(STATS_ENGINE_LABELS[entry.key] || entry.key, entry.sessions, Number(entry.total || 0), engineMax, " · " + entry.sessions + " 会话")
  ).join("") || "<div class='stats-muted'>暂无数据</div>";

  const costLine = (rate.in || rate.out)
    ? "<div class='stats-cost-out'>≈ <b>" + esc(cost >= 1 ? cost.toFixed(2) : cost.toFixed(4)) + "</b> <span>（按 输入 " + esc(rate.in || 0) + " / 输出 " + esc(rate.out || 0) + " 每百万 token，粗略上限，含各轮重复上下文）</span></div>"
    : "<div class='stats-cost-out stats-muted'>填入单价即可估算成本（token 计数为准）</div>";

  $("statsUsagePanel").innerHTML =
    "<div class='stat-tiles'>" + tiles + "</div>" +
    "<div class='stats-subsection'><div class='stats-section-head'><h3>按来源</h3></div><div class='stat-rows'>" + engineRows + "</div></div>" +
    "<div class='stats-subsection'><div class='stats-section-head'><h3>成本估算</h3></div>" +
      "<div class='stats-cost-inputs'>" +
        "<label>输入 <input id='statsPriceIn' type='number' min='0' step='0.1' value='" + esc(rate.in || "") + "' placeholder='0'> /1M</label>" +
        "<label>输出 <input id='statsPriceOut' type='number' min='0' step='0.1' value='" + esc(rate.out || "") + "' placeholder='0'> /1M</label>" +
      "</div>" + costLine +
    "</div>";

  const priceIn = $("statsPriceIn");
  const priceOut = $("statsPriceOut");
  const onRate = () => {
    state.statsRate = { in: Number(priceIn.value) || 0, out: Number(priceOut.value) || 0 };
    localStorage.setItem(STATS_RATE_KEY, JSON.stringify(state.statsRate));
    renderStatsUsage();
    renderStatsProjects();
  };
  if (priceIn) priceIn.addEventListener("change", onRate);
  if (priceOut) priceOut.addEventListener("change", onRate);
}

function estimatedCost(input, output) {
  const rate = state.statsRate;
  return (Number(input || 0) / 1000000) * (rate.in || 0) + (Number(output || 0) / 1000000) * (rate.out || 0);
}

function formatCost(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return "0";
  }
  return number >= 1 ? number.toFixed(2) : number.toFixed(4);
}

function formatPercent(value) {
  const number = Number(value || 0);
  return (number >= 10 ? number.toFixed(0) : number.toFixed(1)).replace(/\\.0$/, "") + "%";
}

function relativePast(value) {
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
    return Math.max(1, Math.floor(diff / minute)) + " 分钟前";
  }
  if (diff < day) {
    return Math.max(1, Math.floor(diff / hour)) + " 小时前";
  }
  return Math.max(1, Math.floor(diff / day)) + " 天前";
}

`;
