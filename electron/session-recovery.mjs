const MAX_REF_LENGTH = 4096;
const MAX_CWD_LENGTH = 4096;
const MAX_TITLE_LENGTH = 500;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

function clippedText(value, maxLength) {
  return Array.from(String(value || "").trim()).slice(0, maxLength).join("");
}

function normalizedRef(value) {
  const ref = String(value || "").trim();
  if (
    !ref
    || ref.length > MAX_REF_LENGTH
    || CONTROL_CHARACTER_RE.test(ref)
    || !/^(codex|claude):.+$/i.test(ref)
  ) {
    return "";
  }
  return ref.replace(/^(codex|claude):/i, (prefix) => prefix.toLowerCase());
}

export function normalizeRecoverySession(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const ref = normalizedRef(
    value.ref
      || (value.engine && value.id ? `${value.engine}:${value.id}` : ""),
  );
  if (!ref) {
    return null;
  }
  const cwd = clippedText(value.cwd || value.displayCwd, MAX_CWD_LENGTH);
  if (!cwd || CONTROL_CHARACTER_RE.test(cwd)) {
    return null;
  }
  return {
    ref,
    cwd,
    title: clippedText(value.title || "未命名会话", MAX_TITLE_LENGTH) || "未命名会话",
    observedAt: String(value.observedAt || new Date().toISOString()),
  };
}

export function mergeRecoverySessions(...groups) {
  const byRef = new Map();
  for (const group of groups) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const value of group) {
      const session = normalizeRecoverySession(value);
      if (session) {
        byRef.set(session.ref, session);
      }
    }
  }
  return [...byRef.values()];
}

export function readSessionRecoveryState(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const recoverableSessions = mergeRecoverySessions(
    raw.recoverableSessions,
    raw.monitoring === true ? raw.liveSessions : [],
  );
  return {
    monitoring: raw.monitoring === true,
    liveSessions: mergeRecoverySessions(raw.liveSessions),
    recoverableSessions,
  };
}

export function excludeLiveRecoverySessions(recoverableSessions, liveSessions) {
  const liveRefs = new Set(mergeRecoverySessions(liveSessions).map((session) => session.ref));
  return mergeRecoverySessions(recoverableSessions).filter((session) => !liveRefs.has(session.ref));
}

export function storedSessionRecoveryState({ monitoring, liveSessions, recoverableSessions }) {
  return {
    version: 1,
    monitoring: Boolean(monitoring),
    liveSessions: mergeRecoverySessions(liveSessions),
    recoverableSessions: mergeRecoverySessions(recoverableSessions),
    updatedAt: new Date().toISOString(),
  };
}
