#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_API_URL = "https://snapshots.example.test";

async function testHomepagePublicSessions() {
  const requests = [];
  const { document } = await runStaticPage("site/index.html", {
    locationHref: "https://ffffhx.github.io/codex-snapshots/",
    config: { apiUrl: PUBLIC_API_URL },
    fetch: async (url, options = {}) => {
      requests.push(String(url));
      if (String(url) === "http://127.0.0.1:4321/") {
        return jsonResponse({ ok: true });
      }
      if (String(url).startsWith(`${PUBLIC_API_URL}/api/auth/me`)) {
        assert(options.credentials === "include", "homepage auth check should include credentials");
        return jsonResponse({ configured: true, user: null, loginUrl: `${PUBLIC_API_URL}/api/auth/github/start` });
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

  await waitFor(() => document.querySelector(".public-session-card"));

  const card = document.querySelector(".public-session-card");
  const link = card?.querySelector(".public-session-link");
  const title = card?.querySelector("h3");

  assert(requests.includes(`${PUBLIC_API_URL}/api/snapshots?limit=12`), "homepage should fetch the configured public list API");
  assert(document.getElementById("api-url")?.value === PUBLIC_API_URL, "homepage API input should use configured public API");
  assert(card, "homepage should render a public session card");
  assert(title?.textContent === "Public Session from Aliyun", "homepage should render public session title");
  assert(link?.href.includes("/share/index.html?"), `homepage card should link to the static share page: ${link?.href}`);
  assert(link?.href.includes(`api=${encodeURIComponent(PUBLIC_API_URL)}`), `homepage card should preserve the public API URL: ${link?.href}`);
  assert(link?.target === "_blank", "homepage card should open in a new tab");
  assert(link?.rel === "noopener noreferrer", "homepage card should protect the opener");
  assert(!card?.querySelector(".public-session-delete"), "anonymous users should not see a delete action");
}

async function testShareFormOpensShareInNewTab() {
  const openedUrls = [];
  const { document, window } = await runStaticPage("site/index.html", {
    locationHref: "https://ffffhx.github.io/codex-snapshots/",
    config: { apiUrl: PUBLIC_API_URL },
    fetch: async (url) => {
      if (String(url) === "http://127.0.0.1:4321/") {
        return jsonResponse({ ok: true });
      }
      if (String(url).startsWith(`${PUBLIC_API_URL}/api/auth/me`)) {
        return jsonResponse({ configured: true, user: null, loginUrl: `${PUBLIC_API_URL}/api/auth/github/start` });
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

  setInputValue(window, document.getElementById("share-id"), "snap_formtarget123456");
  setInputValue(window, document.getElementById("api-url"), PUBLIC_API_URL);
  await flushPromises(window);

  const submitted = document.getElementById("share-form").dispatchEvent(
    new window.Event("submit", {
      bubbles: true,
      cancelable: true,
    }),
  );
  await flushPromises(window);

  assert(submitted === false, "share form should prevent same-tab form navigation");
  assert(openedUrls.length === 1, "share form should open one new tab");
  assert(openedUrls[0].target === "_blank", "share form should request a new tab");
  assert(openedUrls[0].focused === true, "share form should focus the opened tab");

  const opened = new URL(openedUrls[0].url);
  assert(opened.pathname.endsWith("/share/index.html"), `share form should open the static share page: ${openedUrls[0].url}`);
  assert(opened.searchParams.get("id") === "snap_formtarget123456", "share form should pass the share id");
  assert(opened.searchParams.get("api") === PUBLIC_API_URL, "share form should pass the API URL");
}

async function testHomepageDeletesOwnPublicSessionWithGithubLogin() {
  const requests = [];
  let deleted = false;
  const { document, window } = await runStaticPage("site/index.html", {
    locationHref: "https://ffffhx.github.io/codex-snapshots/",
    config: { apiUrl: PUBLIC_API_URL },
    confirm: () => true,
    fetch: async (url, options = {}) => {
      requests.push({
        url: String(url),
        method: String(options.method || "GET").toUpperCase(),
        authorization: options.headers?.authorization || "",
        credentials: options.credentials || "",
      });
      if (String(url) === "http://127.0.0.1:4321/") {
        return jsonResponse({ ok: true });
      }
      if (String(url).startsWith(`${PUBLIC_API_URL}/api/auth/me`)) {
        return jsonResponse({
          configured: true,
          user: {
            id: "42",
            login: "alice",
            avatarUrl: "",
            profileUrl: "https://github.com/alice",
            isOwner: false,
          },
          loginUrl: `${PUBLIC_API_URL}/api/auth/github/start`,
        });
      }
      if (String(url) === `${PUBLIC_API_URL}/api/snapshots/health`) {
        return jsonResponse({ ok: true, shares: deleted ? 0 : 1 });
      }
      if (String(url) === `${PUBLIC_API_URL}/api/snapshots?limit=12`) {
        return jsonResponse({
          schemaVersion: 1,
          shares: deleted
            ? []
            : [
                {
                  id: "snap_publicsession123456",
                  title: "Public Session from Aliyun",
                  engine: "codex",
                  engineLabel: "Codex",
                  createdAt: "2026-05-28T00:00:00.000Z",
                  redacted: true,
                  turnCount: 2,
                  owner: {
                    id: "42",
                    login: "alice",
                  },
                },
              ],
          count: deleted ? 0 : 1,
          total: deleted ? 0 : 1,
          limit: 12,
          offset: 0,
        });
      }
      if (String(url) === `${PUBLIC_API_URL}/api/snapshots/snap_publicsession123456` && options.method === "DELETE") {
        assert(!options.headers?.authorization, "delete should not send the old shared bearer token");
        assert(options.credentials === "include", "delete should send the GitHub session cookie");
        deleted = true;
        return jsonResponse({ ok: true, deleted: true, id: "snap_publicsession123456" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  await waitFor(() => document.querySelector(".public-session-card"));
  await flushPromises(window);

  document.querySelector(".public-session-delete")?.dispatchEvent(
    new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }),
  );

  await waitFor(() => !document.querySelector(".public-session-card"));

  assert(deleted, "homepage should call the delete endpoint");
  assert(
    requests.some((request) => request.method === "DELETE" && request.url.endsWith("/api/snapshots/snap_publicsession123456")),
    "homepage should issue a DELETE request for the selected share",
  );
  assert(document.querySelector(".public-session-status")?.textContent === "已删除分享快照。", "homepage should show delete success");
  assert(document.getElementById("public-sessions")?.textContent === "暂无公开 Session。", "homepage should remove the deleted share from the list");
}

async function testPublicHomepageWithoutConfiguredApiDoesNotFetchLoopback() {
  const requests = [];
  const { document } = await runStaticPage("site/index.html", {
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

  await waitFor(() => document.getElementById("api-status")?.textContent === "未配置");

  assert(document.getElementById("api-url")?.value === "", "public homepage without config should not default to localhost API");
  assert(document.getElementById("api-status")?.textContent === "未配置", "public homepage should show unconfigured API status");
  assert(
    document.getElementById("public-sessions")?.textContent === "公开分享 API 尚未配置。",
    "public homepage should explain that the public API is not configured",
  );
  assert(
    !requests.some((request) => request.includes("127.0.0.1:8787")),
    "public homepage should not fetch the loopback share API when config is missing",
  );
}

async function testLocalHomepageDefaultsToLocalApi() {
  const requests = [];
  const { document } = await runStaticPage("site/index.html", {
    locationHref: "http://127.0.0.1:4323/",
    config: {},
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url) === "http://127.0.0.1:4321/") {
        return jsonResponse({ ok: true });
      }
      if (String(url).startsWith("http://127.0.0.1:8787/api/auth/me")) {
        return jsonResponse({ configured: false, user: null, loginUrl: null });
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

  await waitFor(() => document.getElementById("api-url")?.value === "http://127.0.0.1:8787");

  assert(document.getElementById("api-url")?.value === "http://127.0.0.1:8787", "local homepage should still default to local API");
  assert(requests.includes("http://127.0.0.1:8787/api/snapshots?limit=12"), "local homepage should load local public sessions");
}

async function testSharePageLoadsFromConfiguredApi() {
  const requests = [];
  const { document } = await runStaticPage("site/share/index.html", {
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
            goalObjective: "Explain how the public share page loads data.",
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

  await waitFor(() => document.getElementById("share-title")?.textContent === "Public Session from Aliyun");

  assert(
    requests.includes(`${PUBLIC_API_URL}/api/snapshots/snap_publicsession123456`),
    "share page should fetch snapshot detail from the configured public API",
  );
  assert(document.getElementById("share-title")?.textContent === "Public Session from Aliyun", "share page should render the public title");
  assert(document.getElementById("share-meta")?.textContent.includes(PUBLIC_API_URL), "share page metadata should show the API URL");
  assert(
    document.querySelector(".share-goal")?.textContent.includes("Explain how the public share page loads data."),
    "share page should render the snapshot goal metadata",
  );
  assert(
    document.getElementById("share-content")?.innerHTML.includes("static share page loaded it from the public API"),
    "share page should render transcript content",
  );
  assert(
    !document.getElementById("share-content")?.innerHTML.includes("image/png /") &&
      !document.getElementById("share-content")?.innerHTML.includes("148 KB") &&
      !document.getElementById("share-content")?.innerHTML.includes("figcaption"),
    "share page should not render image mime type or size captions",
  );
}

async function testPublicSharePageWithoutConfiguredApiDoesNotFetchLoopback() {
  const requests = [];
  const { document } = await runStaticPage("site/share/index.html", {
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

  await waitFor(() => document.getElementById("share-title")?.textContent === "缺少分享 API");

  assert(document.getElementById("share-title")?.textContent === "缺少分享 API", "share page should show missing API state");
  assert(document.getElementById("share-meta")?.textContent === "公开站点需要配置分享 API。", "share page should explain missing public API");
  assert(requests.length === 0, "share page should not fetch loopback API when public config is missing");
}

async function runStaticPage(relativeHtmlPath, { locationHref, config, fetch, storage = {}, open = () => null, confirm = () => false }) {
  const html = await readFile(path.join(ROOT_DIR, relativeHtmlPath), "utf8");
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: locationHref,
  });
  const { window } = dom;

  window.CODEX_SNAPSHOTS_CONFIG = config;
  window.fetch = fetch;
  window.open = open;
  window.confirm = confirm;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => undefined,
    },
  });
  if (typeof window.AbortSignal.timeout !== "function") {
    Object.defineProperty(window.AbortSignal, "timeout", {
      configurable: true,
      value: AbortSignal.timeout?.bind(AbortSignal) || (() => undefined),
    });
  }

  for (const [key, value] of Object.entries(storage)) {
    window.localStorage.setItem(key, value);
  }

  const scriptPath = relativeHtmlPath.includes("/share/") ? "site/assets/share.js" : "site/assets/site.js";
  const code = await readFile(path.join(ROOT_DIR, scriptPath), "utf8");
  window.eval(code);
  await flushPromises(window);

  return {
    document: window.document,
    window,
  };
}

function setInputValue(window, input, value) {
  assert(input, "input should exist before setting value");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(
    new window.Event("input", {
      bubbles: true,
    }),
  );
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

async function waitFor(predicate, { timeoutMs = 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert(predicate(), "timed out waiting for expected DOM state");
}

async function flushPromises(window) {
  for (let index = 0; index < 10; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

await testHomepagePublicSessions();
await testShareFormOpensShareInNewTab();
await testHomepageDeletesOwnPublicSessionWithGithubLogin();
await testPublicHomepageWithoutConfiguredApiDoesNotFetchLoopback();
await testLocalHomepageDefaultsToLocalApi();
await testSharePageLoadsFromConfiguredApi();
await testPublicSharePageWithoutConfiguredApiDoesNotFetchLoopback();

console.log("✓ static site public share checks passed");
