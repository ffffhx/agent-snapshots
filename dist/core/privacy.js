import os from "node:os";
// Identifier-ish key that contains a sensitive keyword anywhere inside it, so
// prefixed/suffixed forms (client_secret, db_password, aws_secret_access_key)
// are caught. `_` is a word char, so the previous `\b...\b` form missed them.
// Bounded quantifiers ({0,64}) keep this linear — an unbounded `*` on both
// sides of the alternation can backtrack quadratically on long word runs.
const SECRET_KEY = "[A-Za-z0-9_.-]{0,64}(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credential|cookie|authorization|passphrase|pat)[A-Za-z0-9_.-]{0,64}";
// Optional quote, the : or = separator, optional opening quote — tolerant of
// JSON (`"password":"v"`), YAML (`password: v`) and shell (`password=v`).
const ASSIGN_SEP = "\\s*[\"']?\\s*[:=]\\s*[\"']?";
const HOME_DIR = os.homedir();
const REDACTION_RULES = [
    {
        id: "private-key",
        label: "Private key block",
        severity: "high",
        // Tolerate a missing END marker (truncated paste) by redacting to EOF.
        pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
        replacement: "[REDACTED_PRIVATE_KEY]",
    },
    {
        id: "jwt",
        label: "JWT-like token",
        severity: "high",
        pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
        replacement: "[REDACTED_JWT]",
    },
    {
        id: "github-token",
        label: "GitHub token",
        severity: "high",
        pattern: /\b(?:gh[opusr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
        replacement: "[REDACTED_GITHUB_TOKEN]",
    },
    {
        id: "slack-token",
        label: "Slack token",
        severity: "high",
        pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/gi,
        replacement: "[REDACTED_SLACK_TOKEN]",
    },
    {
        id: "google-api-key",
        label: "Google API key",
        severity: "high",
        pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
        replacement: "[REDACTED_GOOGLE_API_KEY]",
    },
    {
        id: "bearer",
        label: "Bearer token",
        severity: "high",
        pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
        replacement: "Bearer [REDACTED]",
    },
    {
        id: "openai-key",
        label: "OpenAI-style API key",
        severity: "high",
        pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
        replacement: "sk-[REDACTED]",
    },
    {
        id: "aws-key",
        label: "AWS access key",
        severity: "high",
        pattern: /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,
        replacement: "[REDACTED_AWS_KEY]",
    },
    {
        id: "connection-string",
        label: "Connection string credentials",
        severity: "high",
        // postgres://user:pass@host, mysql://, mongodb+srv://, redis://, amqp://
        pattern: /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|amqps|ftp|ssh):\/\/)([^:@\s/]+):([^@\s/]+)@/gi,
        replacement: "$1[REDACTED]:[REDACTED]@",
    },
    {
        id: "api-key",
        label: "API key or secret assignment",
        severity: "high",
        // Scrub the whole value to end-of-line (handles spaces, short values,
        // quoted JSON values, and multiple secrets on one line such as cookies).
        pattern: new RegExp(`(${SECRET_KEY})(${ASSIGN_SEP})([^\\n]+)`, "gi"),
        replacement: "$1$2[REDACTED]",
    },
    {
        id: "home-path",
        label: "Local home path",
        severity: "medium",
        pattern: new RegExp(escapeRegExp(HOME_DIR), "g"),
        replacement: "~",
    },
    {
        id: "user-path",
        label: "Other machine home path",
        severity: "medium",
        // Generic /home/<user>, /Users/<user>, and C:\Users\<user> on other hosts.
        pattern: /((?:\/(?:home|Users)\/|[A-Za-z]:\\Users\\))([^/\\\s]+)/g,
        replacement: "$1[REDACTED_USER]",
    },
    {
        id: "internal-domain",
        label: "Internal-looking domain",
        severity: "medium",
        pattern: /\b[A-Za-z0-9.-]+\.(?:bytedance|byteintl|corp|internal|local)\b/gi,
        replacement: "[REDACTED_INTERNAL_HOST]",
    },
    {
        id: "env-file",
        label: "Environment file mention",
        severity: "medium",
        pattern: /(^|[/\s])\.env([.\w-]*)?\b/g,
        // The mention is informational; the filename itself is not a secret value.
        detectOnly: true,
    },
];
export function detectRisks(text) {
    const risks = [];
    for (const rule of REDACTION_RULES) {
        const matches = String(text ?? "").match(rule.pattern);
        if (matches?.length) {
            risks.push({
                id: rule.id,
                label: rule.label,
                severity: rule.severity,
                count: matches.length,
            });
        }
    }
    return risks;
}
export function addRisks(risks, text, turn) {
    for (const risk of detectRisks(text)) {
        addRiskEntry(risks, risk, turn);
    }
}
export function addImageRisk(risks, count, turn) {
    if (!count) {
        return;
    }
    addRiskEntry(risks, {
        id: "image-attachment",
        label: "Image attachment",
        severity: "medium",
        count,
    }, turn);
}
export function severityRank(severity) {
    if (severity === "high") {
        return 3;
    }
    if (severity === "medium") {
        return 2;
    }
    return 1;
}
export function redactText(text) {
    let output = String(text ?? "");
    for (const rule of REDACTION_RULES) {
        if (rule.detectOnly || rule.replacement === undefined) {
            continue;
        }
        output = output.replace(rule.pattern, rule.replacement);
    }
    return output;
}
function addRiskEntry(risks, risk, turn) {
    const key = risk.id;
    const current = risks.get(key) || {
        id: risk.id,
        label: risk.label,
        severity: risk.severity,
        count: 0,
        turns: [],
    };
    current.count += risk.count;
    if (!current.turns.includes(turn)) {
        current.turns.push(turn);
    }
    risks.set(key, current);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
