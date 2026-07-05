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

export function renderMarkdownHtml(text: unknown): string {
  return sanitizeRenderedHtml(markdownRenderer.render(stripAppDirectives(text)).trim());
}

function configureMarkdownLinks(renderer: markdownit): void {
  const defaultRender = renderer.renderer.rules.link_open || ((tokens, index, options, env, self) => {
    return self.renderToken(tokens, index, options);
  });
  const defaultCloseRender = renderer.renderer.rules.link_close || ((tokens, index, options, env, self) => {
    return self.renderToken(tokens, index, options);
  });

  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (isLocalCodePathLink(tokens, index)) {
      token.meta = { ...(token.meta || {}), renderAsCodePath: true };
      return "<code>";
    }
    setMarkdownTokenAttr(token, "target", "_blank");
    setMarkdownTokenAttr(token, "rel", mergeLinkRel(token.attrGet("rel")));
    return defaultRender(tokens, index, options, env, self);
  };

  renderer.renderer.rules.link_close = (tokens, index, options, env, self) => {
    if (isClosingLocalCodePathLink(tokens, index)) {
      return "</code>";
    }
    return defaultCloseRender(tokens, index, options, env, self);
  };
}

function setMarkdownTokenAttr(token: markdownit.Token, name: string, value: string): void {
  const index = token.attrIndex(name);
  if (index < 0) {
    token.attrPush([name, value]);
    return;
  }
  token.attrs![index][1] = value;
}

function isLocalCodePathLink(tokens: markdownit.Token[], index: number): boolean {
  const token = tokens[index];
  const href = token.attrGet("href") || "";
  if (!isLocalPathHref(href)) {
    return false;
  }

  const label = collectLinkText(tokens, index);
  return looksLikeCodePath(label) || looksLikeLocalFilesystemPath(href);
}

function isClosingLocalCodePathLink(tokens: markdownit.Token[], index: number): boolean {
  const level = tokens[index].level;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const token = tokens[cursor];
    if (token.level !== level) {
      continue;
    }
    if (token.type === "link_open") {
      return Boolean(token.meta?.renderAsCodePath);
    }
    if (token.type === "link_close") {
      return false;
    }
  }
  return false;
}

function collectLinkText(tokens: markdownit.Token[], index: number): string {
  const level = tokens[index].level;
  const parts: string[] = [];
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.type === "link_close" && token.level === level) {
      break;
    }
    if (typeof token.content === "string") {
      parts.push(token.content);
    }
  }
  return parts.join("");
}

function isLocalPathHref(href: string): boolean {
  const value = decodePathCandidate(href);
  if (!value || value.startsWith("#") || value.startsWith("//")) {
    return false;
  }
  if (/^file:/i.test(value)) {
    return true;
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function looksLikeCodePath(value: string): boolean {
  const candidate = normalizePathCandidate(value);
  if (!candidate || (looksLikeWebDomain(candidate) && !hasKnownFileExtension(candidate))) {
    return false;
  }
  if (/^file:/i.test(candidate)) {
    return true;
  }
  if (/^(?:~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/])/.test(candidate)) {
    return true;
  }
  if (/^\/(?:Users|home|private|tmp|var|opt|Volumes|workspace)\b/.test(candidate)) {
    return true;
  }
  if (/^(?:src|dist|lib|app|apps|packages|scripts|server|client|components|docs|test|tests|bin|deploy)[\\/]/i.test(candidate)) {
    return true;
  }
  if (candidate.startsWith("/")) {
    return false;
  }
  return hasKnownFileExtension(candidate);
}

function looksLikeLocalFilesystemPath(value: string): boolean {
  const candidate = normalizePathCandidate(value);
  if (!candidate || looksLikeWebDomain(candidate)) {
    return false;
  }
  return /^file:/i.test(candidate)
    || /^(?:~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/])/.test(candidate)
    || /^\/(?:Users|home|private|tmp|var|opt|Volumes|workspace)\b/.test(candidate)
    || /^(?:src|dist|lib|app|apps|packages|scripts|server|client|components|docs|test|tests|bin|deploy)[\\/]/i.test(candidate);
}

function normalizePathCandidate(value: string): string {
  return decodePathCandidate(value)
    .trim()
    .replace(/^file:\/\/+/i, "/")
    .replace(/[?#].*$/, "")
    .replace(/(?::\d+(?::\d+)?)$/, "")
    .replace(/#L\d+(?:-L\d+)?$/i, "")
    .replace(/^<|>$/g, "");
}

function decodePathCandidate(value: string): string {
  try {
    return decodeURI(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function looksLikeWebDomain(value: string): boolean {
  return !/[\\/]/.test(value) && /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value);
}

function hasKnownFileExtension(value: string): boolean {
  return /\.(?:[cm]?[jt]sx?|[cm]?[jt]s|json|jsonl|md|mdx|css|scss|sass|less|html?|vue|svelte|py|go|rs|java|kt|kts|swift|php|rb|sh|bash|zsh|fish|ya?ml|toml|lock|svg|png|jpe?g|gif|webp|sql|proto|graphql|gql|xml|txt|tsx?)$/i.test(value);
}

function renderHighlightedCode(source: string, rawLanguage: string): string {
  const language = normalizeMarkdownLanguage(rawLanguage);
  const displayLanguage = language || normalizeMarkdownLanguageLabel(rawLanguage) || "text";
  const code = String(source || "");
  let html = "";
  if (language && hljs.getLanguage(language)) {
    html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } else {
    html = escapeHtml(code);
  }
  const className = language ? ` class="hljs language-${escapeHtml(language)}"` : " class=\"hljs\"";
  return `<pre data-language="${escapeHtml(displayLanguage)}"><code${className}>${html}</code></pre>`;
}

function normalizeMarkdownLanguage(rawLanguage: string): string {
  const language = normalizeMarkdownLanguageLabel(rawLanguage);
  if (!language) {
    return "";
  }
  const mapped = MARKDOWN_LANGUAGE_ALIASES.get(language) || language;
  return hljs.getLanguage(mapped) ? mapped : "";
}

function normalizeMarkdownLanguageLabel(rawLanguage: string): string {
  return String(rawLanguage || "")
    .trim()
    .split(/\s+/)[0]
    .replace(/[^A-Za-z0-9_+-]/g, "")
    .toLowerCase();
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
