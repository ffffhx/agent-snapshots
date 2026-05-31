// @ts-nocheck
import hljs from "highlight.js";
import markdownit from "markdown-it";
import { mergeLinkRel, sanitizeRenderedHtml, stripAppDirectives } from "../shared/sanitize.js";
const MARKDOWN_LANGUAGE_ALIASES = new Map([
    ["plain", "plaintext"],
    ["plaintext", "plaintext"],
    ["text", "plaintext"],
    ["js", "javascript"],
    ["jsx", "javascript"],
    ["ts", "typescript"],
    ["tsx", "typescript"],
    ["yml", "yaml"],
]);
const markdownRenderer = markdownit({
    breaks: true,
    html: false,
    linkify: true,
    typographer: false,
    highlight: renderHighlightedCode,
});
configureMarkdownLinks(markdownRenderer);
export function renderMarkdownHtml(text) {
    return sanitizeRenderedHtml(markdownRenderer.render(stripAppDirectives(text)).trim());
}
function configureMarkdownLinks(renderer) {
    const defaultRender = renderer.renderer.rules.link_open || ((tokens, index, options, env, self) => {
        return self.renderToken(tokens, index, options);
    });
    renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
        const token = tokens[index];
        setMarkdownTokenAttr(token, "target", "_blank");
        setMarkdownTokenAttr(token, "rel", mergeLinkRel(token.attrGet("rel")));
        return defaultRender(tokens, index, options, env, self);
    };
}
function setMarkdownTokenAttr(token, name, value) {
    const index = token.attrIndex(name);
    if (index < 0) {
        token.attrPush([name, value]);
        return;
    }
    token.attrs[index][1] = value;
}
function renderHighlightedCode(source, rawLanguage) {
    const language = normalizeMarkdownLanguage(rawLanguage);
    const displayLanguage = language || normalizeMarkdownLanguageLabel(rawLanguage) || "text";
    const code = String(source || "");
    let html = "";
    if (language && hljs.getLanguage(language)) {
        html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    else {
        html = escapeHtml(code);
    }
    const className = language ? ` class="hljs language-${escapeHtml(language)}"` : " class=\"hljs\"";
    return `<pre data-language="${escapeHtml(displayLanguage)}"><code${className}>${html}</code></pre>`;
}
function normalizeMarkdownLanguage(rawLanguage) {
    const language = normalizeMarkdownLanguageLabel(rawLanguage);
    if (!language) {
        return "";
    }
    const mapped = MARKDOWN_LANGUAGE_ALIASES.get(language) || language;
    return hljs.getLanguage(mapped) ? mapped : "";
}
function normalizeMarkdownLanguageLabel(rawLanguage) {
    return String(rawLanguage || "")
        .trim()
        .split(/\s+/)[0]
        .replace(/[^A-Za-z0-9_+-]/g, "")
        .toLowerCase();
}
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
