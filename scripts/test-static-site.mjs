#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_API_URL = "https://snapshots.example.test";

async function testHomepagePublicSessions() {
  const { document, elements } = createDocument([
    "viewer-status",
    "api-status",
    "open-local-viewer",
    "viewer-url-label",
    "api-url",
    "share-id",
    "share-form",
    "public-sessions",
    "public-sessions-refresh",
  ]);
  const requests = [];

  await runBrowserScript("site/assets/site.js", {
    document,
    locationHref: "https://ffffhx.github.io/codex-snapshots/",
    config: { apiUrl: PUBLIC_API_URL },
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url) === "http://127.0.0.1:4321/") {
        return jsonResponse({ ok: true });
      }
      if (String(url) === `${PUBLIC_API_URL}/api/snapshots/health`) {
        return jsonResponse({ ok: true, shares: 1 });
      }
      if (String(url) === `${PUBLIC_API_URL}/api/snapshots?limit=12`) {
        return jsonResponse({
          schemaVersion: 1,
          shares: [
            {
              id: "snap_publicsession123456",
              title: "Public Session from Aliyun",
              engine: "codex",
              engineLabel: "Codex",
              createdAt: "2026-05-28T00:00:00.000Z",
              redacted: true,
              turnCount: 2,
              url: "https://ffffhx.github.io/codex-snapshots/share/?id=snap_publicsession123456",
            },
          ],
          count: 1,
          total: 1,
          limit: 12,
          offset: 0,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  const publicSessions = elements.get("public-sessions");
  const card = findElement(publicSessions, (element) => element.tagName === "a" && element.className === "public-session-card");
  const title = findElement(card, (element) => element.tagName === "h3");

  assert(requests.includes(`${PUBLIC_API_URL}/api/snapshots?limit=12`), "homepage should fetch the configured public list API");
  assert(elements.get("api-url").value === PUBLIC_API_URL, "homepage API input should use configured public API");
  assert(card, "homepage should render a public session card");
  assert(title?.textContent === "Public Session from Aliyun", "homepage should render public session title");
  assert(card.href.includes("/share/index.html?"), `homepage card should link to the static share page: ${card.href}`);
  assert(card.href.includes(`api=${encodeURIComponent(PUBLIC_API_URL)}`), `homepage card should preserve the public API URL: ${card.href}`);
  assert(card.target === "_blank", "homepage card should open in a new tab");
  assert(card.rel === "noopener noreferrer", "homepage card should protect the opener");
}

async function testShareFormOpensShareInNewTab() {
  const { document, elements } = createDocument([
    "viewer-status",
    "api-status",
    "open-local-viewer",
    "viewer-url-label",
    "api-url",
    "share-id",
    "share-form",
    "public-sessions",
    "public-sessions-refresh",
  ]);
  const openedUrls = [];

  await runBrowserScript("site/assets/site.js", {
    document,
    locationHref: "https://ffffhx.github.io/codex-snapshots/",
    config: { apiUrl: PUBLIC_API_URL },
    fetch: async (url) => {
      if (String(url) === "http://127.0.0.1:4321/") {
        return jsonResponse({ ok: true });
      }
      if (String(url) === `${PUBLIC_API_URL}/api/snapshots/health`) {
        return jsonResponse({ ok: true, shares: 0 });
      }
      if (String(url) === `${PUBLIC_API_URL}/api/snapshots?limit=12`) {
        return jsonResponse({ schemaVersion: 1, shares: [], count: 0, total: 0, limit: 12, offset: 0 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    open: (url, target) => {
      const entry = { url: String(url), target, focused: false };
      openedUrls.push(entry);
      return {
        opener: {},
        focus() {
          entry.focused = true;
        },
      };
    },
  });

  elements.get("share-id").value = "snap_formtarget123456";
  elements.get("api-url").value = PUBLIC_API_URL;

  let prevented = false;
  elements.get("share-form").eventListeners.get("submit")({
    preventDefault() {
      prevented = true;
    },
  });

  assert(prevented, "share form should prevent same-tab form navigation");
  assert(openedUrls.length === 1, "share form should open one new tab");
  assert(openedUrls[0].target === "_blank", "share form should request a new tab");
  assert(openedUrls[0].focused === true, "share form should focus the opened tab");

  const opened = new URL(openedUrls[0].url);
  assert(opened.pathname.endsWith("/share/index.html"), `share form should open the static share page: ${openedUrls[0].url}`);
  assert(opened.searchParams.get("id") === "snap_formtarget123456", "share form should pass the share id");
  assert(opened.searchParams.get("api") === PUBLIC_API_URL, "share form should pass the API URL");
}

async function testPublicHomepageWithoutConfiguredApiDoesNotFetchLoopback() {
  const { document, elements } = createDocument([
    "viewer-status",
    "api-status",
    "open-local-viewer",
    "viewer-url-label",
    "api-url",
    "share-id",
    "share-form",
    "public-sessions",
    "public-sessions-refresh",
  ]);
  const requests = [];

  await runBrowserScript("site/assets/site.js", {
    document,
    locationHref: "https://ffffhx.github.io/codex-snapshots/",
    config: {},
    storage: {
      "codex-snapshots.api": "http://127.0.0.1:8787",
    },
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url) === "http://127.0.0.1:4321/") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  assert(elements.get("api-url").value === "", "public homepage without config should not default to localhost API");
  assert(elements.get("api-status").textContent === "未配置", "public homepage should show unconfigured API status");
  assert(
    elements.get("public-sessions").children[0]?.textContent === "公开分享 API 尚未配置。",
    "public homepage should explain that the public API is not configured"
  );
  assert(
    !requests.some((request) => request.includes("127.0.0.1:8787")),
    "public homepage should not fetch the loopback share API when config is missing"
  );
}

async function testLocalHomepageDefaultsToLocalApi() {
  const { document, elements } = createDocument([
    "viewer-status",
    "api-status",
    "open-local-viewer",
    "viewer-url-label",
    "api-url",
    "share-id",
    "share-form",
    "public-sessions",
    "public-sessions-refresh",
  ]);
  const requests = [];

  await runBrowserScript("site/assets/site.js", {
    document,
    locationHref: "http://127.0.0.1:4323/",
    config: {},
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url) === "http://127.0.0.1:4321/") {
        return jsonResponse({ ok: true });
      }
      if (String(url) === "http://127.0.0.1:8787/api/snapshots/health") {
        return jsonResponse({ ok: true, shares: 0 });
      }
      if (String(url) === "http://127.0.0.1:8787/api/snapshots?limit=12") {
        return jsonResponse({ schemaVersion: 1, shares: [], count: 0, total: 0, limit: 12, offset: 0 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  assert(elements.get("api-url").value === "http://127.0.0.1:8787", "local homepage should still default to local API");
  assert(requests.includes("http://127.0.0.1:8787/api/snapshots?limit=12"), "local homepage should load local public sessions");
}

async function testSharePageLoadsFromConfiguredApi() {
  const { document, elements } = createDocument(["share-title", "share-meta", "share-content"]);
  const requests = [];

  await runBrowserScript("site/assets/share.js", {
    document,
    locationHref: "https://ffffhx.github.io/codex-snapshots/share/?id=snap_publicsession123456",
    config: { apiUrl: PUBLIC_API_URL },
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url) === `${PUBLIC_API_URL}/api/snapshots/snap_publicsession123456`) {
        return jsonResponse({
          schemaVersion: 1,
          share: {
            id: "snap_publicsession123456",
            title: "Public Session from Aliyun",
            engineLabel: "Codex",
            redacted: true,
            turnCount: 2,
          },
          snapshot: {
            title: "Public Session from Aliyun",
            engineLabel: "Codex",
            redacted: true,
            turns: [
              {
                role: "user",
                text: "Can everyone view this session?",
              },
              {
                role: "assistant",
                text: "Yes, the static share page loaded it from the public API.",
                images: [
                  {
                    src: "data:image/png;base64,iVBORw0KGgo=",
                    mimeType: "image/png",
                    size: "148 KB",
                    alt: "Screenshot",
                  },
                ],
              },
            ],
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  assert(
    requests.includes(`${PUBLIC_API_URL}/api/snapshots/snap_publicsession123456`),
    "share page should fetch snapshot detail from the configured public API"
  );
  assert(elements.get("share-title").textContent === "Public Session from Aliyun", "share page should render the public title");
  assert(elements.get("share-meta").textContent.includes(PUBLIC_API_URL), "share page metadata should show the API URL");
  assert(
    elements.get("share-content").innerHTML.includes("static share page loaded it from the public API"),
    "share page should render transcript content"
  );
  assert(
    !elements.get("share-content").innerHTML.includes("image/png /") &&
      !elements.get("share-content").innerHTML.includes("148 KB") &&
      !elements.get("share-content").innerHTML.includes("figcaption"),
    "share page should not render image mime type or size captions"
  );
}

async function testPublicSharePageWithoutConfiguredApiDoesNotFetchLoopback() {
  const { document, elements } = createDocument(["share-title", "share-meta", "share-content"]);
  const requests = [];

  await runBrowserScript("site/assets/share.js", {
    document,
    locationHref: "https://ffffhx.github.io/codex-snapshots/share/?id=snap_publicsession123456",
    config: {},
    storage: {
      "codex-snapshots.api": "http://127.0.0.1:8787",
    },
    fetch: async (url) => {
      requests.push(String(url));
      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  assert(elements.get("share-title").textContent === "缺少分享 API", "share page should show missing API state");
  assert(elements.get("share-meta").textContent === "公开站点需要配置分享 API。", "share page should explain missing public API");
  assert(requests.length === 0, "share page should not fetch loopback API when public config is missing");
}

async function runBrowserScript(relativePath, { document, locationHref, config, fetch, storage = {}, open = () => null }) {
  const code = await readFile(path.join(ROOT_DIR, relativePath), "utf8");
  const location = new URL(locationHref);
  const localStorage = createLocalStorage(storage);
  const context = vm.createContext({
    AbortSignal,
    console,
    document,
    fetch,
    Intl,
    localStorage,
    navigator: { clipboard: { writeText: async () => undefined } },
    setTimeout,
    URL,
    URLSearchParams,
    window: {
      CODEX_SNAPSHOTS_CONFIG: config,
      location,
      open,
      setTimeout,
    },
  });

  context.window.window = context.window;
  context.window.document = document;
  context.window.localStorage = localStorage;
  context.window.navigator = context.navigator;

  vm.runInContext(code, context, { filename: relativePath });
  await flushPromises();
}

function createDocument(ids) {
  const elements = new Map(ids.map((id) => [id, new TestElement("div", { id })]));

  return {
    document: {
      createElement(tagName) {
        return new TestElement(tagName);
      },
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelectorAll() {
        return [];
      },
    },
    elements,
  };
}

class TestElement {
  constructor(tagName, { id = "" } = {}) {
    this.tagName = tagName.toLowerCase();
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.eventListeners = new Map();
    this.className = "";
    this.dateTime = "";
    this.href = "";
    this.innerHTML = "";
    this.rel = "";
    this.target = "";
    this.textContent = "";
    this.value = "";
  }

  addEventListener(type, listener) {
    this.eventListeners.set(type, listener);
  }

  append(...children) {
    for (const child of children) {
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  focus() {}
}

function findElement(root, predicate) {
  if (!root) {
    return null;
  }
  if (predicate(root)) {
    return root;
  }
  for (const child of root.children || []) {
    const found = findElement(child, predicate);
    if (found) {
      return found;
    }
  }
  return null;
}

function jsonResponse(payload, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function createLocalStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

async function flushPromises() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

await testHomepagePublicSessions();
await testShareFormOpensShareInNewTab();
await testPublicHomepageWithoutConfiguredApiDoesNotFetchLoopback();
await testLocalHomepageDefaultsToLocalApi();
await testSharePageLoadsFromConfiguredApi();
await testPublicSharePageWithoutConfiguredApiDoesNotFetchLoopback();

console.log("✓ static site public share checks passed");
