// @ts-nocheck

const MAX_WRITE_DIFF_LINES = 200;

export function extractClaudeToolFileChanges(name, input, structuredPatch) {
  const toolName = String(name || "");
  const data = normalizeToolInput(input);
  if (toolName === "Edit" || toolName === "MultiEdit") {
    const filePath = data.file_path || data.filePath || "";
    if (!filePath) {
      return [];
    }
    const structuredDiff = structuredPatchToDiff(filePath, structuredPatch);
    if (structuredDiff) {
      return [{ path: filePath, kind: "edit", diffText: structuredDiff }];
    }
    const oldString = data.old_string ?? data.oldString;
    const newString = data.new_string ?? data.newString;
    if (oldString === undefined || newString === undefined) {
      return [];
    }
    return [{
      path: filePath,
      kind: "edit",
      diffText: editStringsToUnifiedDiff(filePath, String(oldString), String(newString)),
    }];
  }
  if (toolName === "Write") {
    const filePath = data.file_path || data.filePath || "";
    const content = data.content;
    if (!filePath || content === undefined) {
      return [];
    }
    return [{
      path: filePath,
      kind: "write",
      diffText: writeContentToUnifiedDiff(filePath, String(content)),
    }];
  }
  return [];
}

export function extractCodexToolFileChanges(name, args) {
  if (String(name || "") !== "apply_patch") {
    return [];
  }
  const patch = extractPatchText(args);
  if (!patch) {
    return [];
  }
  const paths = extractPatchPaths(patch);
  const path = paths.length === 1 ? paths[0] : paths.length > 1 ? paths.join(", ") : "patch";
  return [{ path, kind: "patch", diffText: patch }];
}

export function redactFileChanges(fileChanges, redactText) {
  if (!Array.isArray(fileChanges) || !fileChanges.length) {
    return [];
  }
  const redact = typeof redactText === "function" ? redactText : (value) => String(value ?? "");
  return fileChanges.map((change) => ({
    path: redact(change.path || ""),
    kind: change.kind || "edit",
    diffText: redact(change.diffText || ""),
  })).filter((change) => change.diffText);
}

export function rawFileChangeText(fileChanges) {
  return (fileChanges || []).map((change) => [change.path, change.diffText].filter(Boolean).join("\n")).join("\n");
}

export function structuredPatchToDiff(filePath, structuredPatch) {
  if (!structuredPatch) {
    return "";
  }
  if (typeof structuredPatch === "string") {
    const text = structuredPatch.trim();
    if (!text) {
      return "";
    }
    return hasDiffHeader(text) ? text : diffHeader(filePath, filePath).concat("\n", text);
  }
  const chunks = Array.isArray(structuredPatch) ? structuredPatch : [structuredPatch];
  const lines = diffHeader(filePath, filePath);
  let hasChunk = false;
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") {
      continue;
    }
    const body = Array.isArray(chunk.lines) ? chunk.lines.map((line) => String(line ?? "")) : [];
    if (!body.length) {
      continue;
    }
    hasChunk = true;
    const oldStart = positiveNumber(chunk.oldStart, 1);
    const oldLines = nonNegativeNumber(chunk.oldLines, body.filter((line) => !line.startsWith("+")).length);
    const newStart = positiveNumber(chunk.newStart, 1);
    const newLines = nonNegativeNumber(chunk.newLines, body.filter((line) => !line.startsWith("-")).length);
    lines.push("@@ -" + oldStart + "," + oldLines + " +" + newStart + "," + newLines + " @@");
    lines.push(...body);
  }
  return hasChunk ? lines.join("\n") : "";
}

function editStringsToUnifiedDiff(filePath, oldString, newString) {
  const lines = diffHeader(filePath, filePath);
  for (const line of splitDiffLines(oldString)) {
    lines.push("-" + line);
  }
  for (const line of splitDiffLines(newString)) {
    lines.push("+" + line);
  }
  return lines.join("\n");
}

function writeContentToUnifiedDiff(filePath, content) {
  const contentLines = splitDiffLines(content);
  const visible = contentLines.slice(0, MAX_WRITE_DIFF_LINES);
  const lines = ["--- /dev/null", "+++ b/" + normalizeDiffPath(filePath)];
  for (const line of visible) {
    lines.push("+" + line);
  }
  if (contentLines.length > MAX_WRITE_DIFF_LINES) {
    lines.push("+[truncated " + (contentLines.length - MAX_WRITE_DIFF_LINES) + " more lines]");
  }
  return lines.join("\n");
}

function diffHeader(oldPath, newPath) {
  return ["--- a/" + normalizeDiffPath(oldPath), "+++ b/" + normalizeDiffPath(newPath)];
}

function normalizeDiffPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "") || "file";
}

function splitDiffLines(value) {
  const text = String(value ?? "");
  if (!text) {
    return [""];
  }
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function normalizeToolInput(input) {
  if (!input) {
    return {};
  }
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof input === "object" ? input : {};
}

function extractPatchText(args) {
  const direct = typeof args === "string" ? args : "";
  const directPatch = patchTextFromString(direct);
  if (directPatch) {
    return directPatch;
  }
  const parsed = normalizeToolInput(args);
  return findPatchText(parsed);
}

function findPatchText(value) {
  if (typeof value === "string") {
    return patchTextFromString(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPatchText(item);
      if (found) {
        return found;
      }
    }
    return "";
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      const found = findPatchText(value[key]);
      if (found) {
        return found;
      }
    }
  }
  return "";
}

function patchTextFromString(value) {
  const text = String(value || "");
  const start = text.indexOf("*** Begin Patch");
  if (start < 0) {
    return "";
  }
  const endMarker = "*** End Patch";
  const end = text.indexOf(endMarker, start);
  return end >= 0 ? text.slice(start, end + endMarker.length).trim() : text.slice(start).trim();
}

function extractPatchPaths(patch) {
  const paths = [];
  for (const line of String(patch || "").split(/\r?\n/)) {
    const match = /^(?:\*\*\* (?:Add|Update|Delete) File: )(.+)$/.exec(line.trim());
    if (match && match[1] && !paths.includes(match[1])) {
      paths.push(match[1]);
    }
  }
  return paths;
}

function hasDiffHeader(text) {
  return text.startsWith("--- ") || text.startsWith("diff ");
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}
