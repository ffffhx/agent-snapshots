export { detectRisks, redactText } from "../core/privacy.js";
// Migrated: codex/claude sessions are parsed + projected by agent-session-core
// (via the adapter), which injects our privacy redaction + markdown renderer.
// trae, Claude history-only sessions, and searchSessions still delegate to the
// legacy parser inside the adapter. ASC's snapshot semantics are now the truth.
export { listSessions, loadSnapshot, searchSessions } from "./asc-adapter.mjs";
