import os from "node:os";
export function detectRisks(text) {
    const checks = [
        { id: "private-key", label: "Private key block", severity: "high", count: 0, pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
        { id: "jwt", label: "JWT-like token", severity: "high", count: 0, pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
        { id: "api-key", label: "API key or secret assignment", severity: "high", count: 0, pattern: /\b(api[_-]?key|secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|cookie|authorization)\b\s*[:=]\s*["']?[^"'\s`]{8,}/gi },
        { id: "bearer", label: "Bearer token", severity: "high", count: 0, pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
        { id: "openai-key", label: "OpenAI-style API key", severity: "high", count: 0, pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
        { id: "aws-key", label: "AWS access key", severity: "high", count: 0, pattern: /\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g },
        { id: "home-path", label: "Local home path", severity: "medium", count: 0, pattern: new RegExp(escapeRegExp(os.homedir()), "g") },
        { id: "internal-domain", label: "Internal-looking domain", severity: "medium", count: 0, pattern: /\b[A-Za-z0-9.-]+\.(bytedance|byteintl|corp|internal|local)\b/gi },
        { id: "env-file", label: "Environment file mention", severity: "medium", count: 0, pattern: /(^|[\/\s])\.env([.\w-]*)?\b/g },
    ];
    const risks = [];
    for (const check of checks) {
        const matches = text.match(check.pattern);
        if (matches?.length) {
            risks.push({
                id: check.id,
                label: check.label,
                severity: check.severity,
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
    let output = text;
    output = output.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
    output = output.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]");
    output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, "Bearer [REDACTED]");
    output = output.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "sk-[REDACTED]");
    output = output.replace(/\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]");
    output = output.replace(/\b(api[_-]?key|secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|cookie|authorization)\b(\s*[:=]\s*)["']?[^"'\s`]{8,}/gi, "$1$2[REDACTED]");
    output = output.replace(new RegExp(escapeRegExp(os.homedir()), "g"), "~");
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
