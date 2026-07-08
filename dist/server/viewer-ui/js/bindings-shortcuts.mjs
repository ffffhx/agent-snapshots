// @ts-nocheck
export const bindingsShortcutsJs = `$("sessions").addEventListener("click", async (event) => {
  const sourceButton = event.target.closest("[data-source]");
  if (sourceButton) {
    const nextSource = sourceButton.dataset.source;
    if (nextSource && nextSource !== state.activeSource) {
      state.activeSource = nextSource;
      await selectFirstSessionForActiveSource();
    }
    return;
  }
  const loadMoreButton = event.target.closest("[data-load-more]");
  if (loadMoreButton) {
    await loadMoreSessions();
    return;
  }
  const toggle = event.target.closest("[data-project-toggle]");
  if (toggle) {
    const key = toggle.dataset.projectToggle;
    if (state.expandedProjects.has(key)) {
      state.expandedProjects.delete(key);
    } else {
      state.expandedProjects.add(key);
    }
    renderSessions();
    return;
  }
  const projectSearch = event.target.closest("[data-project-search]");
  if (projectSearch) {
    event.preventDefault();
    event.stopPropagation();
    openSearchDialog({
      cwd: projectSearch.dataset.projectCwd || "",
      label: projectSearch.dataset.projectLabel || "当前项目",
    });
    return;
  }
  const projectHeader = event.target.closest("[data-project-collapse]");
  if (projectHeader) {
    const key = projectHeader.dataset.projectCollapse;
    if (state.collapsedProjects.has(key)) {
      state.collapsedProjects.delete(key);
    } else {
      state.collapsedProjects.add(key);
    }
    renderSessions();
    return;
  }
  const button = event.target.closest("[data-id]");
  if (button) selectSession(button.dataset.id);
});
$("reload").addEventListener("click", loadSessions);
$("openSearch").addEventListener("click", () => openSearchDialog());
$("openStats").addEventListener("click", openStats);
$("openGallery").addEventListener("click", openGallery);
$("closeStats").addEventListener("click", closeStats);
$("statsRefresh").addEventListener("click", loadStats);
$("statsOverlay").addEventListener("click", async (event) => {
  const filterButton = event.target.closest("[data-stats-filter]");
  if (filterButton) {
    state.statsFilter = STATS_FILTERS.some((item) => item.key === filterButton.dataset.statsFilter) ? filterButton.dataset.statsFilter : "all";
    renderStatsFilter();
    renderStatsActivity();
    renderStatsProjects();
    renderStatsInsights();
    return;
  }
  if (event.target.closest("[data-weekly-digest-toggle]")) {
    await toggleWeeklyDigest();
    return;
  }
  if (event.target.closest("[data-weekly-digest-copy]")) {
    await copyWeeklyDigestMarkdown();
    return;
  }
  if (event.target.closest("[data-weekly-digest-download]")) {
    downloadWeeklyDigestMarkdown();
    return;
  }
  const skillDraftButton = event.target.closest("[data-skill-draft]");
  if (skillDraftButton) {
    await copyInsightSkillDraft(skillDraftButton.dataset.skillDraft, skillDraftButton.dataset.insightId || "");
    return;
  }
  if (event.target === $("statsOverlay")) {
    closeStats();
  }
});
$("closeGallery").addEventListener("click", closeGallery);
$("galleryOverlay").addEventListener("click", async (event) => {
  const sourceButton = event.target.closest("[data-gallery-source]");
  if (sourceButton) {
    await setGallerySource(sourceButton.dataset.gallerySource);
    return;
  }
  const moreButton = event.target.closest("[data-gallery-more]");
  if (moreButton) {
    await loadGallery(false);
    return;
  }
  const lightboxButton = event.target.closest("[data-gallery-lightbox]");
  if (lightboxButton) {
    openGalleryLightbox(lightboxButton.dataset.galleryLightbox);
    return;
  }
  const sessionButton = event.target.closest("[data-gallery-session]");
  if (sessionButton) {
    await openGallerySession(sessionButton.dataset.gallerySession);
    return;
  }
  if (event.target === $("galleryOverlay")) {
    closeGallery();
  }
});
$("galleryLightbox").addEventListener("click", (event) => {
  if (event.target.closest("[data-lightbox-prev]")) {
    event.preventDefault();
    moveGalleryLightbox(-1);
    return;
  }
  if (event.target.closest("[data-lightbox-next]")) {
    event.preventDefault();
    moveGalleryLightbox(1);
    return;
  }
  if (event.target === $("galleryLightbox") || event.target === $("galleryLightboxImage")) {
    closeGalleryLightbox();
  }
});
$("closeSearch").addEventListener("click", () => closeSearchDialog(false));
$("prewarmIndex").addEventListener("click", toggleSemanticPrewarm);
$("globalSearch").addEventListener("input", () => scheduleSearch());
$("globalSearch").addEventListener("keydown", async (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSearchActive(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSearchActive(-1);
    return;
  }
  if (event.key === "Enter") {
    const result = state.search.results[state.search.active];
    if (result?.ref) {
      event.preventDefault();
      await selectSearchResult(result.ref);
    }
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeSearchDialog(false);
  }
});
$("searchOverlay").addEventListener("click", (event) => {
  if (event.target === $("searchOverlay")) {
    closeSearchDialog(false);
  }
});
$("searchResults").addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-sr-action]");
  if (actionButton) {
    const holder = actionButton.closest("[data-search-result]");
    if (holder) {
      event.preventDefault();
      event.stopPropagation();
      await runSearchResultAction(actionButton.dataset.srAction, holder.dataset.searchResult);
    }
    return;
  }
  const button = event.target.closest("[data-search-result]");
  if (button) {
    await selectSearchResult(button.dataset.searchResult);
  }
});
$("searchResults").addEventListener("mousemove", (event) => {
  const button = event.target.closest("[data-search-index]");
  if (button) {
    const index = Number(button.dataset.searchIndex);
    if (Number.isFinite(index) && index !== state.search.active) {
      state.search.active = index;
      updateSearchActive({ preview: true, scroll: false });
    }
  }
});
$("sessionSearchInput").addEventListener("input", () => scheduleSessionSearch());
$("sessionSearchInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runSessionSearch();
  }
});
$("sessionSearchRun").addEventListener("click", runSessionSearch);
$("sessionNote").addEventListener("input", (event) => {
  const input = event.target.closest("[data-session-note-input]");
  if (!input) {
    return;
  }
  const text = updateSessionNoteDraft(input.value);
  if (input.value !== text) {
    input.value = text;
  }
});
$("sessionNote").addEventListener("focusout", (event) => {
  if (event.target.closest("[data-session-note-input]")) {
    saveSessionNote();
  }
});
$("sessionNote").addEventListener("keydown", (event) => {
  if (!event.target.closest("[data-session-note-input]")) {
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    saveSessionNote({ exitEditing: true });
  }
});
$("sessionNote").addEventListener("click", (event) => {
  if (event.target.closest("[data-session-note-edit]")) {
    editSessionNote();
    return;
  }
  if (event.target.closest("[data-session-note-close]")) {
    closeSessionNote();
    return;
  }
  if (event.target.closest("[data-session-note-save]")) {
    saveSessionNote({ exitEditing: true });
  }
});
$("sessionSearchResults").addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-search-turn]");
  if (button) {
    jumpSessionSearchResult(button.dataset.sessionSearchTurn);
  }
});
$("sessionSearchResults").addEventListener("keydown", (event) => {
  if (!isKeyboardActivation(event)) {
    return;
  }
  const button = event.target.closest("[data-session-search-turn]");
  if (button) {
    event.preventDefault();
    jumpSessionSearchResult(button.dataset.sessionSearchTurn);
  }
});
for (const button of document.querySelectorAll("[data-search-mode]")) {
  button.addEventListener("click", () => {
    setSearchMode(button.dataset.searchMode);
    if ($("globalSearch").value.trim()) {
      scheduleSearch(0);
    }
  });
}
for (const button of document.querySelectorAll("[data-search-flag]")) {
  button.addEventListener("click", () => {
    const key = button.dataset.searchFlag;
    state.search.flags[key] = !state.search.flags[key];
    button.setAttribute("aria-pressed", state.search.flags[key] ? "true" : "false");
    reapplyClientFilters();
  });
}
$("searchFacets").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-facet-key]");
  if (!chip) {
    return;
  }
  toggleQueryToken(chip.dataset.facetKey, chip.dataset.facetValue, chip.dataset.facetKey === "source");
});
$("matchPrev")?.addEventListener("click", () => jumpTranscriptMatch(-1));
$("matchNext")?.addEventListener("click", () => jumpTranscriptMatch(1));
$("matchClose")?.addEventListener("click", () => dismissTranscriptMatchMode({ updateUrl: true }));
let pendingTopJumpTimer = 0;
let pendingTopJump = false;

function clearPendingTopJump() {
  if (pendingTopJumpTimer) {
    clearTimeout(pendingTopJumpTimer);
    pendingTopJumpTimer = 0;
  }
  pendingTopJump = false;
}

function handleGotoTopKey() {
  if (pendingTopJump) {
    clearPendingTopJump();
    jumpTranscriptBoundary("top");
    return;
  }
  pendingTopJump = true;
  pendingTopJumpTimer = window.setTimeout(clearPendingTopJump, 700);
}

document.addEventListener("keydown", (event) => {
  const rawKey = String(event.key || "");
  const key = rawKey.toLowerCase();
  const typing = isTypingTarget(event.target);
  if (state.gallery.lightboxOpen) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveGalleryLightbox(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveGalleryLightbox(1);
      return;
    }
  }
  if (isOverlayOpen()) {
    return;
  }
  if (state.transcriptMatch.active && event.key === "Escape") {
    event.preventDefault();
    dismissTranscriptMatchMode({ updateUrl: true });
    return;
  }
  if ((event.metaKey || event.ctrlKey) && key === "k") {
    event.preventDefault();
    openSearchDialog();
    return;
  }
  if (event.metaKey && key === "/") {
    event.preventDefault();
    openShortcuts();
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && key === "o") {
    event.preventDefault();
    cycleVerbosity();
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && key === "m") {
    event.preventDefault();
    toggleOutline();
    return;
  }
  if (typing || event.metaKey || event.ctrlKey || event.altKey) {
    clearPendingTopJump();
    return;
  }
  if (state.transcriptMatch.active && key === "n") {
    event.preventDefault();
    clearPendingTopJump();
    jumpTranscriptMatch(event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === "[") {
    event.preventDefault();
    clearPendingTopJump();
    jumpUserTurn(-1);
    return;
  }
  if (event.key === "]") {
    event.preventDefault();
    clearPendingTopJump();
    jumpUserTurn(1);
    return;
  }
  if (event.key === "G") {
    event.preventDefault();
    clearPendingTopJump();
    jumpTranscriptBoundary("bottom");
    return;
  }
  if (!event.shiftKey && key === "g") {
    event.preventDefault();
    handleGotoTopKey();
    return;
  }
  clearPendingTopJump();
  if (!event.shiftKey && key === "j") {
    event.preventDefault();
    jumpTranscriptTurn(1);
    return;
  }
  if (!event.shiftKey && key === "k") {
    event.preventDefault();
    jumpTranscriptTurn(-1);
    return;
  }
  if (!event.shiftKey && key === "u") {
    event.preventDefault();
    jumpUserTurn(-1);
    return;
  }
  if (!event.shiftKey && key === "s") {
    event.preventDefault();
    toggleSidebarCollapsed();
    return;
  }
  if (!event.shiftKey && event.key === "/") {
    event.preventDefault();
    focusSessionSearchInput();
  }
});
$("exports").addEventListener("click", (event) => {
  if (event.target.closest("[data-session-note-toggle]")) {
    toggleSessionNote();
    return;
  }
  if (event.target.closest("[data-publish-gist]")) {
    publishSelectedSessionGist();
    return;
  }
  if (event.target.closest("[data-publish-cloud]")) {
    publishSelectedSession();
    return;
  }
  const resumeBtn = event.target.closest("[data-resume-orca]");
  if (resumeBtn) {
    resumeInOrca(resumeBtn.dataset.resumeOrca, resumeBtn.dataset.resumeCwd, resumeBtn.dataset.resumeTitle);
  }
});
$("turns").addEventListener("click", (event) => {
  const filePath = event.target.closest?.("[data-file-path]");
  if (filePath) {
    event.preventDefault();
    event.stopPropagation();
    handleFilePathAction(filePath, event);
    return;
  }
  const link = event.target.closest?.("a[href]");
  if (!link) {
    return;
  }
  event.preventDefault();
  openInNewTab(link.href);
});
$("turns").addEventListener("keydown", (event) => {
  const filePath = event.target.closest?.("[data-file-path]");
  if (!filePath || !isKeyboardActivation(event)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  handleFilePathAction(filePath, event);
});
document.querySelector(".skip-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  const target = $("turns");
  safeFocus(target);
  target?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
});
for (const id of ["redact"]) {
  $(id).addEventListener("change", () => {
    state.snapshotCache.clear();
    if (state.selected) {
      selectSession(state.selected);
    }
  });
}
initAppearance();
initReadingExperience();
loadStatsRate();
initSplitter();
loadSessions().then(() => {
  // Deep link from the launcher/search: /?session=<ref> auto-opens that session.
  const params = new URLSearchParams(location.search);
  const wanted = params.get("session");
  const query = params.get("q") || params.get("query") || "";
  if (wanted) {
    selectSession(wanted)
      .then(() => {
        if (query && state.selected === wanted) {
          startTranscriptMatchModeFromQuery(query, { updateUrl: false });
        }
      })
      .catch(() => {});
  }
}).catch((error) => {
  $("sessions").innerHTML = "<div class='meta'>" + esc(error.message) + "</div>";
  clearViewer(error.message || "Failed to load sessions.");
});
`;
