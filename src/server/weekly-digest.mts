// @ts-nocheck

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ENGINE_KEYS = ["codex", "claude", "trae"];
const DEFAULT_SCAN_LIMIT = 20_000;

export async function buildWeeklyDigest({
  codexHome,
  claudeHome,
  traeHome,
  traeAppHome,
  traeRecordingsDir,
  listSessions,
  weeks = 1,
  limit = DEFAULT_SCAN_LIMIT,
}) {
  const now = new Date();
  const completeWeeks = Math.max(1, Math.round(Number(weeks || 1)));
  const ranges = weeklyRanges(completeWeeks, now);
  const sessions = await listSessions({
    codexHome,
    claudeHome,
    traeHome,
    traeAppHome,
    traeRecordingsDir,
    source: "all",
    includeArchived: true,
    completeOnly: true,
    limit,
  });
  const tokenRows = await readIndexedSessionTokens();
  const tokenDataAvailable = tokenRows.some((row) => tokenNumber(row.totalTokens) || tokenNumber(row.inputTokens) || tokenNumber(row.outputTokens));
  const tokensUnavailable = sessions.length > 0 && !tokenDataAvailable;
  const tokenByRef = new Map(tokenRows.map((row) => [row.ref, row]));
  const weekRows = ranges.map((range) => emptyWeek(range));
  const firstDate = ranges[0]?.startDate || localDateKey(now);
  const lastDate = ranges[ranges.length - 1]?.endDate || localDateKey(now);

  for (const session of sessions) {
    const date = sessionDate(session);
    const dateKey = localDateKey(date);
    if (dateKey < firstDate || dateKey > lastDate) {
      continue;
    }
    const week = weekRows.find((item) => dateKey >= item.range.startDate && dateKey <= item.range.endDate);
    if (!week) {
      continue;
    }
    const engine = engineKey(session.engine);
    const ref = sessionRef(session);
    const tokens = tokenByRef.get(ref) || {};
    const inputTokens = tokenNumber(tokens.inputTokens);
    const outputTokens = tokenNumber(tokens.outputTokens);
    const totalTokens = tokenNumber(tokens.totalTokens) || inputTokens + outputTokens;
    const turns = sessionTurns(session);

    week.sessionCount.total += 1;
    week.sessionCount[engine] += 1;
    week.totalTokens.input += inputTokens;
    week.totalTokens.output += outputTokens;
    week.totalTokens.total += totalTokens;
    if (inputTokens || outputTokens || totalTokens) {
      week.totalTokens.indexedSessions += 1;
    }

    const day = week._dayMap.get(dateKey);
    if (day) {
      day.sessions += 1;
      day[engine] += 1;
    }

    const project = projectInfo(session.cwd || tokens.cwd, session.displayCwd || tokens.displayCwd);
    const projectEntry = week._projectMap.get(project.key) || {
      key: project.key,
      name: project.name,
      path: project.path,
      sessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    projectEntry.sessions += 1;
    projectEntry.inputTokens += inputTokens;
    projectEntry.outputTokens += outputTokens;
    projectEntry.totalTokens += totalTokens;
    week._projectMap.set(project.key, projectEntry);

    if (!week.longestSession || turns > week.longestSession.turns) {
      week.longestSession = {
        title: session.title || tokens.title || ref,
        ref,
        turns,
      };
    }
  }

  for (let index = 0; index < weekRows.length; index += 1) {
    const week = weekRows[index];
    const days = Array.from(week._dayMap.values());
    week.busiestDay = days.slice().sort((a, b) => (b.sessions - a.sessions) || a.date.localeCompare(b.date))[0] || null;
    if (week.busiestDay && week.busiestDay.sessions <= 0) {
      week.busiestDay = null;
    }
    week.topProjects = Array.from(week._projectMap.values())
      .sort((a, b) => (b.sessions - a.sessions) || (b.totalTokens - a.totalTokens) || a.name.localeCompare(b.name, "zh-CN"))
      .slice(0, 5);
    week.comparison = index > 0 ? compareWeeks(week, weekRows[index - 1]) : null;
    delete week._dayMap;
    delete week._projectMap;
  }

  const digest = {
    generatedAt: now.toISOString(),
    generatedDate: localDateKey(now),
    scanLimit: limit,
    requestedCompleteWeeks: completeWeeks,
    tokenIndex: {
      rows: tokenRows.length,
      sessions: sessions.length,
      tokensAvailable: tokenDataAvailable,
      unavailable: tokensUnavailable,
      note: tokensUnavailable ? "Tokens 列尚在索引中，稍后重试。" : "",
    },
    range: {
      startDate: firstDate,
      endDate: lastDate,
      weeks: ranges.length,
    },
    weeks: weekRows,
  };
  digest.markdown = renderWeeklyDigestMarkdown(digest);
  return digest;
}

function weeklyRanges(completeWeeks, now) {
  const today = startOfLocalDay(now);
  const currentStart = startOfLocalWeek(today);
  const ranges = [];
  for (let index = completeWeeks; index >= 1; index -= 1) {
    const start = addDays(currentStart, -index * 7);
    const end = addDays(start, 6);
    ranges.push({
      startDate: localDateKey(start),
      endDate: localDateKey(end),
      label: index === 1 ? "上周" : `${localDateKey(start)} 至 ${localDateKey(end)}`,
      current: false,
      complete: true,
    });
  }
  ranges.push({
    startDate: localDateKey(currentStart),
    endDate: localDateKey(today),
    label: "本周",
    current: true,
    complete: false,
  });
  return ranges;
}

function emptyWeek(range) {
  const dayMap = new Map();
  let date = parseLocalDate(range.startDate);
  const end = parseLocalDate(range.endDate);
  while (date.getTime() <= end.getTime()) {
    const key = localDateKey(date);
    dayMap.set(key, { date: key, sessions: 0, codex: 0, claude: 0, trae: 0 });
    date = addDays(date, 1);
  }
  return {
    range,
    sessionCount: { total: 0, codex: 0, claude: 0, trae: 0 },
    totalTokens: { input: 0, output: 0, total: 0, indexedSessions: 0 },
    topProjects: [],
    busiestDay: null,
    longestSession: null,
    comparison: null,
    _dayMap: dayMap,
    _projectMap: new Map(),
  };
}

function compareWeeks(current, previous) {
  return {
    sessions: delta(current.sessionCount.total, previous.sessionCount.total),
    totalTokens: delta(current.totalTokens.total, previous.totalTokens.total),
    inputTokens: delta(current.totalTokens.input, previous.totalTokens.input),
    outputTokens: delta(current.totalTokens.output, previous.totalTokens.output),
  };
}

function delta(current, previous) {
  const change = Number(current || 0) - Number(previous || 0);
  const percent = previous > 0 ? (change / previous) * 100 : (current > 0 ? 100 : 0);
  return { current: Number(current || 0), previous: Number(previous || 0), change, percent };
}

export function renderWeeklyDigestMarkdown(digest) {
  const lines = [];
  const tokensUnavailable = Boolean(digest.tokenIndex?.unavailable);
  lines.push(`# Agent 使用周报（${digest.range.startDate} 至 ${digest.range.endDate}）`);
  lines.push("");
  lines.push(`生成时间：${formatLocalDateTime(digest.generatedAt)}`);
  if (tokensUnavailable) {
    lines.push("");
    lines.push("> Tokens 列尚在索引中，稍后重试。");
  }
  lines.push("");

  for (const week of digest.weeks) {
    lines.push(`## ${week.range.label}（${week.range.startDate} 至 ${week.range.endDate}）`);
    lines.push("");
    lines.push("### 概览");
    lines.push(`- 会话数：${formatInteger(week.sessionCount.total)}（${comparisonText(week.comparison?.sessions)}）`);
    if (tokensUnavailable) {
      lines.push("- Tokens：尚在索引中，稍后重试");
    } else {
      lines.push(`- Tokens：${formatTokenShort(week.totalTokens.total)}（输入 ${formatTokenShort(week.totalTokens.input)} / 输出 ${formatTokenShort(week.totalTokens.output)}，${comparisonText(week.comparison?.totalTokens)}）`);
    }
    lines.push(`- 按来源：Codex ${formatInteger(week.sessionCount.codex)}，Claude Code ${formatInteger(week.sessionCount.claude)}，Trae ${formatInteger(week.sessionCount.trae)}`);
    lines.push(`- 最活跃的一天：${week.busiestDay ? `${week.busiestDay.date}（${formatInteger(week.busiestDay.sessions)} 次会话）` : "暂无会话"}`);
    lines.push(`- 最长会话：${week.longestSession ? `${mdText(week.longestSession.title)}（${formatInteger(week.longestSession.turns)} turns，ref：${mdText(week.longestSession.ref)}）` : "暂无会话"}`);
    lines.push("");
    lines.push("### Top 项目");
    lines.push("");
    if (week.topProjects.length) {
      lines.push("| 项目 | 会话 | Tokens | 输入 | 输出 |");
      lines.push("| --- | ---: | ---: | ---: | ---: |");
      for (const project of week.topProjects) {
        if (tokensUnavailable) {
          lines.push(`| ${mdTable(project.name)} | ${formatInteger(project.sessions)} | 索引中 | 索引中 | 索引中 |`);
        } else {
          lines.push(`| ${mdTable(project.name)} | ${formatInteger(project.sessions)} | ${formatTokenShort(project.totalTokens)} | ${formatTokenShort(project.inputTokens)} | ${formatTokenShort(project.outputTokens)} |`);
        }
      }
    } else {
      lines.push("暂无项目数据。");
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function comparisonText(comparison) {
  if (!comparison) {
    return "环比暂无基准";
  }
  const change = Number(comparison.change || 0);
  if (!change) {
    return "环比持平";
  }
  const arrow = change > 0 ? "▲" : "▼";
  return `环比 ${arrow} ${formatTokenShort(Math.abs(change))} / ${arrow} ${formatPercent(Math.abs(comparison.percent || 0))}`;
}

function searchIndexPath() {
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "agent-snapshots", "search-index.v2.db");
}

async function readIndexedSessionTokens() {
  const dbFile = searchIndexPath();
  if (!existsSync(dbFile)) {
    return [];
  }
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbFile);
    try {
      const rows = db.prepare(`
        SELECT ref, title, cwd, display_cwd, tokens_total, tokens_input, tokens_output
        FROM docs
      `).all();
      return rows.map((row) => ({
        ref: String(row.ref || ""),
        title: String(row.title || ""),
        cwd: String(row.cwd || ""),
        displayCwd: String(row.display_cwd || ""),
        totalTokens: tokenNumber(row.tokens_total),
        inputTokens: tokenNumber(row.tokens_input),
        outputTokens: tokenNumber(row.tokens_output),
      })).filter((row) => row.ref);
    } finally {
      db.close?.();
    }
  } catch {
    return [];
  }
}

function sessionRef(session) {
  return session.ref || `${engineKey(session.engine)}:${session.id || ""}`;
}

function sessionDate(session) {
  for (const value of [session.createdAt, session.startedAt, session.timestamp, session.mtime]) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return date;
    }
  }
  return new Date(0);
}

function sessionTurns(session) {
  const number = Number(session.turnCount || session.messageCount || session.messages || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function startOfLocalWeek(date) {
  const day = startOfLocalDay(date);
  const mondayOffset = (day.getDay() + 6) % 7;
  return addDays(day, -mondayOffset);
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseLocalDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return startOfLocalDay(new Date());
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function engineKey(value) {
  const key = String(value || "").toLowerCase();
  return ENGINE_KEYS.includes(key) ? key : "codex";
}

function projectInfo(rawPath, displayPath) {
  const key = String(rawPath || displayPath || "").trim();
  const display = String(displayPath || rawPath || "").trim();
  if (!key && !display) {
    return { key: "__none__", name: "(无项目)", path: "" };
  }
  const visiblePath = display || key;
  const parts = visiblePath.replace(/[/\\]+$/, "").split(/[/\\]+/).filter(Boolean);
  return {
    key: key || visiblePath,
    name: parts[parts.length - 1] || visiblePath,
    path: visiblePath,
  };
}

function tokenNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function formatInteger(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("zh-CN").format(Number.isFinite(number) ? Math.round(number) : 0);
}

function formatTokenShort(value) {
  const n = tokenNumber(value);
  if (!n) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return formatInteger(n);
}

function formatPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return "0%";
  }
  return `${(number >= 10 ? number.toFixed(0) : number.toFixed(1)).replace(/\.0$/, "")}%`;
}

function formatLocalDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(date);
}

function mdText(value) {
  return String(value || "").replace(/\s+/g, " ").trim() || "-";
}

function mdTable(value) {
  return mdText(value).replace(/\|/g, "\\|");
}
