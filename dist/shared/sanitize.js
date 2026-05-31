import sanitizeHtml from "sanitize-html";
const APP_DIRECTIVE_PATTERN = /^[ \t]*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\{[^\n]*\}[ \t]*$/gm;
const APP_DIRECTIVE_HTML_PATTERN = /<p>\s*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\{[\s\S]*?\}\s*<\/p>/g;
export function stripAppDirectives(value) {
    return String(value ?? "")
        .replace(/\r\n/g, "\n")
        .replace(APP_DIRECTIVE_PATTERN, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
export function stripAppDirectiveHtml(value) {
    return String(value ?? "").replace(APP_DIRECTIVE_HTML_PATTERN, "").trim();
}
export function sanitizeRenderedHtml(value) {
    return sanitizeHtml(stripAppDirectiveHtml(value), {
        allowedTags: [
            "a",
            "b",
            "blockquote",
            "br",
            "code",
            "del",
            "details",
            "div",
            "em",
            "figcaption",
            "figure",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "hr",
            "li",
            "ol",
            "p",
            "pre",
            "section",
            "span",
            "strong",
            "summary",
            "table",
            "tbody",
            "td",
            "th",
            "thead",
            "tr",
            "ul",
        ],
        allowedAttributes: {
            a: ["href", "name", "rel", "target", "title"],
            blockquote: ["class"],
            code: ["class"],
            details: ["class", "open"],
            div: ["class"],
            figure: ["class"],
            pre: ["class", "data-language"],
            section: ["class"],
            span: ["class"],
            summary: ["class"],
            table: ["class"],
        },
        allowedClasses: {
            blockquote: ["contains-task-list"],
            code: ["hljs", /^language-[A-Za-z0-9_-]+$/],
            details: ["tool-details"],
            div: [
                "attachment-grid",
                "body",
                "empty",
                "image-unavailable",
                "message-card",
                "process-body",
            ],
            figure: ["image-attachment", "image-unavailable"],
            pre: ["hljs"],
            section: [/^process-entry$/, /^process-(?:tool|user|assistant)$/],
            span: [/^hljs-[A-Za-z0-9_-]+$/],
            summary: ["process-summary"],
            table: ["table"],
        },
        allowedSchemes: ["http", "https", "mailto"],
        allowProtocolRelative: false,
        transformTags: {
            a: (_tagName, attribs) => ({
                tagName: "a",
                attribs: {
                    ...attribs,
                    rel: mergeLinkRel(attribs.rel),
                    target: "_blank",
                },
            }),
        },
    }).trim();
}
export function sanitizeSnapshotHtml(snapshot) {
    const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : [];
    for (const turn of turns) {
        if (!turn || typeof turn !== "object") {
            continue;
        }
        if (typeof turn.text === "string") {
            turn.text = stripAppDirectives(turn.text);
        }
        if (typeof turn.html === "string") {
            turn.html = sanitizeRenderedHtml(turn.html);
        }
    }
    return snapshot;
}
export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
export function mergeLinkRel(value) {
    const rel = new Set(String(value || "").split(/\s+/).filter(Boolean));
    rel.add("noopener");
    rel.add("noreferrer");
    return Array.from(rel).join(" ");
}
