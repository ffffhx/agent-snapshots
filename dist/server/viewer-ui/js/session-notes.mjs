// @ts-nocheck
import { MUTATION_CSRF_HEADER } from "../../local-security.js";
export const sessionNotesJs = `
const SESSION_NOTE_TEXT_LIMIT = 2000;
const SESSION_NOTE_PREVIEW_LIMIT = 80;

function normalizeSessionNoteText(value) {
  const text = String(value ?? "").replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n");
  return Array.from(text).slice(0, SESSION_NOTE_TEXT_LIMIT).join("");
}

function sessionNoteHasText() {
  return Boolean(String(state.notes?.text || "").trim());
}

function sessionNotePreviewText(value) {
  return Array.from(String(value || "").replace(/\\s+/g, " ").trim()).slice(0, SESSION_NOTE_PREVIEW_LIMIT).join("");
}

function sessionNoteRelativeTime(value) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) {
    return "";
  }
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return Math.max(1, Math.floor(diff / minute)) + " 分钟前";
  if (diff < day) return Math.max(1, Math.floor(diff / hour)) + " 小时前";
  if (diff < 7 * day) return Math.max(1, Math.floor(diff / day)) + " 天前";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(time));
}

function sessionNoteToolbarButton(ref) {
  const activeRef = String(ref || state.selected || "");
  const hasNote = activeRef && state.notes?.ref === activeRef && sessionNoteHasText();
  const open = activeRef && state.notes?.ref === activeRef && state.notes?.open;
  const title = hasNote
    ? "查看备注：" + sessionNotePreviewText(state.notes.text)
    : "添加备注";
  return "<button id='sessionNoteToggle' class='note-toggle" + (hasNote ? " has-note" : "") + (open ? " active" : "") + "' type='button' data-session-note-toggle='1' title='" + esc(title) + "' aria-pressed='" + (open ? "true" : "false") + "'>" +
    "<span class='note-toggle-dot' aria-hidden='true'></span><span>备注</span>" +
  "</button>";
}

function clearSessionNoteState() {
  const requestToken = Number(state.notes?.requestToken || 0) + 1;
  const saveToken = Number(state.notes?.saveToken || 0) + 1;
  state.notes = { ref: "", text: "", lastSavedText: "", updatedAt: "", open: false, editing: false, loading: false, saving: false, error: "", requestToken, saveToken };
  renderSessionNote();
}

function prepareSessionNoteLoad(ref) {
  const noteRef = String(ref || "").trim();
  if (!noteRef) {
    clearSessionNoteState();
    return;
  }
  const requestToken = Number(state.notes?.requestToken || 0) + 1;
  state.notes = { ref: noteRef, text: "", lastSavedText: "", updatedAt: "", open: false, editing: false, loading: true, saving: false, error: "", requestToken, saveToken: Number(state.notes?.saveToken || 0) + 1 };
  renderSessionNote();
  fetchSessionNote(noteRef, requestToken);
}

function ensureSessionNoteForSnapshot(ref) {
  const noteRef = String(ref || "").trim();
  if (!noteRef) {
    clearSessionNoteState();
    return;
  }
  if (state.notes?.ref !== noteRef) {
    prepareSessionNoteLoad(noteRef);
    return;
  }
  renderSessionNote();
}

async function fetchSessionNote(ref, requestToken) {
  try {
    const params = new URLSearchParams({ id: ref });
    const response = await fetch("/api/session-notes?" + params.toString(), { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (requestToken !== state.notes?.requestToken || state.notes?.ref !== ref) {
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "备注加载失败");
    }
    const text = normalizeSessionNoteText(payload.text || "");
    const updatedAt = Number.isFinite(new Date(payload.updatedAt || 0).getTime()) ? String(payload.updatedAt) : "";
    state.notes = { ...state.notes, text, lastSavedText: text, updatedAt, loading: false, error: "" };
    renderSessionNote();
  } catch (error) {
    if (requestToken !== state.notes?.requestToken || state.notes?.ref !== ref) {
      return;
    }
    state.notes = { ...state.notes, loading: false, error: error instanceof Error ? error.message : String(error) };
    renderSessionNote();
  }
}

function syncSessionNoteToggle() {
  const button = $("sessionNoteToggle");
  if (!button) {
    return;
  }
  const ref = String(state.selected || "");
  const hasNote = ref && state.notes?.ref === ref && sessionNoteHasText();
  const open = ref && state.notes?.ref === ref && state.notes?.open;
  button.classList.toggle("has-note", Boolean(hasNote));
  button.classList.toggle("active", Boolean(open));
  button.setAttribute("aria-pressed", open ? "true" : "false");
  button.title = hasNote ? "查看备注：" + sessionNotePreviewText(state.notes.text) : "添加备注";
}

function renderSessionNote() {
  const container = $("sessionNote");
  syncSessionNoteToggle();
  if (!container) {
    return;
  }
  const note = state.notes || {};
  if (!note.ref || !note.open) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.hidden = false;
  if (note.loading && !note.lastSavedText && !note.editing) {
    container.innerHTML = "<section class='session-note-card'><div class='session-note-head'><b>备注</b><span>正在加载...</span></div></section>";
    return;
  }
  if (note.editing || !String(note.lastSavedText || "").trim()) {
    container.innerHTML = renderSessionNoteEditor(note);
    return;
  }
  container.innerHTML = renderSessionNoteReader(note);
}

function renderSessionNoteHeader(note, actionHtml) {
  const updated = note.updatedAt ? "<time datetime='" + esc(note.updatedAt) + "'>更新于 " + esc(sessionNoteRelativeTime(note.updatedAt)) + "</time>" : "<span>本地备注</span>";
  return "<div class='session-note-head'><div><b>备注</b>" + updated + "</div><div class='session-note-actions'>" + (actionHtml || "") + "</div></div>";
}

function renderSessionNoteReader(note) {
  return "<section class='session-note-card read'>" +
    renderSessionNoteHeader(note, "<button type='button' data-session-note-edit='1'>编辑</button>") +
    "<div class='session-note-text'>" + esc(note.text || "") + "</div>" +
  "</section>";
}

function renderSessionNoteEditor(note) {
  const text = normalizeSessionNoteText(note.text || "");
  const count = Array.from(text).length;
  const action = note.saving ? "保存中..." : "保存";
  return "<section class='session-note-card editing'>" +
    renderSessionNoteHeader(note, "<button type='button' data-session-note-close='1'>收起</button>") +
    "<textarea id='sessionNoteInput' data-session-note-input='1' maxlength='" + SESSION_NOTE_TEXT_LIMIT + "' placeholder='给这个会话留一条只保存在本机的备注'>" + esc(text) + "</textarea>" +
    "<div class='session-note-foot'><span><b data-session-note-count='1'>" + esc(count) + "</b> / " + SESSION_NOTE_TEXT_LIMIT + "</span><button type='button' data-session-note-save='1'" + (note.saving ? " disabled" : "") + ">" + action + "</button></div>" +
    (note.error ? "<div class='session-note-error'>" + esc(note.error) + "</div>" : "") +
  "</section>";
}

function toggleSessionNote() {
  const ref = String(state.selected || "").trim();
  if (!ref) {
    return;
  }
  if (state.notes?.ref !== ref) {
    prepareSessionNoteLoad(ref);
  }
  if (state.notes.open) {
    state.notes = { ...state.notes, open: false, editing: false, text: state.notes.lastSavedText || "", error: "" };
    renderSessionNote();
    return;
  }
  const hasNote = sessionNoteHasText();
  state.notes = { ...state.notes, open: true, editing: !hasNote, text: state.notes.text || state.notes.lastSavedText || "", error: "" };
  renderSessionNote();
  if (!hasNote) {
    focusSessionNoteInput();
  }
}

function editSessionNote() {
  if (!state.notes?.ref) {
    return;
  }
  state.notes = { ...state.notes, open: true, editing: true, text: state.notes.lastSavedText || state.notes.text || "", error: "" };
  renderSessionNote();
  focusSessionNoteInput();
}

function closeSessionNote() {
  state.notes = { ...state.notes, open: false, editing: false, text: state.notes.lastSavedText || "", error: "" };
  renderSessionNote();
}

function focusSessionNoteInput() {
  window.setTimeout(() => {
    const input = $("sessionNoteInput");
    if (!input) {
      return;
    }
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 0);
}

function updateSessionNoteDraft(value) {
  const text = normalizeSessionNoteText(value);
  state.notes = { ...state.notes, text, error: "" };
  const counter = document.querySelector("[data-session-note-count]");
  if (counter) {
    counter.textContent = String(Array.from(text).length);
  }
  return text;
}

async function saveSessionNote(options = {}) {
  const ref = String(state.notes?.ref || state.selected || "").trim();
  if (!ref || state.notes?.saving) {
    return;
  }
  const input = $("sessionNoteInput");
  const text = updateSessionNoteDraft(input ? input.value : state.notes.text || "");
  const previous = String(state.notes.lastSavedText || "");
  if (text === previous) {
    state.notes = { ...state.notes, editing: options.exitEditing ? false : state.notes.editing, error: "" };
    renderSessionNote();
    return;
  }
  const saveToken = Number(state.notes.saveToken || 0) + 1;
  state.notes = { ...state.notes, saving: true, saveToken, error: "" };
  try {
    const response = await fetch("/api/session-notes", {
      method: "POST",
      headers: { "content-type": "application/json", "${MUTATION_CSRF_HEADER}": csrfToken },
      body: JSON.stringify({ id: ref, text }),
    });
    const payload = await response.json().catch(() => ({}));
    if (saveToken !== state.notes?.saveToken || state.notes?.ref !== ref) {
      return;
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "备注保存失败");
    }
    const savedText = payload.deleted ? "" : normalizeSessionNoteText(payload.text ?? text);
    const updatedAt = payload.deleted ? "" : String(payload.updatedAt || new Date().toISOString());
    state.notes = {
      ...state.notes,
      text: savedText,
      lastSavedText: savedText,
      updatedAt,
      open: Boolean(savedText.trim()) && state.notes.open,
      editing: savedText.trim() ? (options.exitEditing ? false : state.notes.editing) : false,
      saving: false,
      error: "",
    };
    showToast("已保存", false);
    renderSessionNote();
  } catch (error) {
    if (saveToken !== state.notes?.saveToken || state.notes?.ref !== ref) {
      return;
    }
    state.notes = { ...state.notes, saving: false, error: error instanceof Error ? error.message : String(error) };
    renderSessionNote();
    showToast("备注保存失败", true);
  }
}
`;
