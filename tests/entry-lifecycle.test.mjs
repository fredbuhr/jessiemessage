import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const controller = await readFile(new URL("../public/entry.js", import.meta.url), "utf8");
const model = await readFile(new URL("../public/entry-model.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/entry.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/entry.css", import.meta.url), "utf8");
const exports = [...model.matchAll(/export function (\w+)\(/g)].map((match) => match[1]);
const dto = (client = { state: "active", href: "/messages" }, administrator = null) => ({ status: client || administrator ? "available" : "unavailable", client, administrator });
const response = (status = 200, value = dto()) => ({ status, ok: status >= 200 && status < 300, json: async () => value });
const pause = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)); };
class Element {
  constructor() { this.hidden = false; this.textContent = ""; this.attributes = new Map(); this.events = new Map(); this.dataset = {}; this.classes = new Set(); this.classList = { toggle: (name, on) => { if (on) this.classes.add(name); else this.classes.delete(name); } }; }
  addEventListener(name, handler) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(handler); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  set href(value) { this.attributes.set("href", value); } get href() { return this.getAttribute("href"); }
}
function harness({ handler = () => response(), visible = true, online = true, standalone = false, language = "fr-FR" } = {}) {
  const nodes = new Map(), translated = [], documentEvents = new Map(), windowEvents = new Map(), modeEvents = new Map(), calls = [], history = [], navigation = [], timers = new Map();
  let now = 0, timer = 0;
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(match[1], new Element());
  for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) { const node = new Element(); node.dataset.i18n = match[1]; translated.push(node); }
  const register = (events, name, callback) => { if (!events.has(name)) events.set(name, []); events.get(name).push(callback); };
  const document = { visibilityState: visible ? "visible" : "hidden", documentElement: { lang: "fr" }, title: "", getElementById: (id) => nodes.get(id),
    querySelectorAll: (selector) => { assert.equal(selector, "[data-i18n]"); return translated; }, addEventListener: (name, callback) => register(documentEvents, name, callback) };
  const mode = { matches: standalone, addEventListener: (name, callback) => register(modeEvents, name, callback) };
  const navigator = { language, onLine: online };
  const context = vm.createContext({ document, navigator, AbortController, Promise,
    window: { matchMedia: (query) => { assert.equal(query, "(display-mode: standalone)"); return mode; }, addEventListener: (name, callback) => register(windowEvents, name, callback) },
    history: { replaceState: (state, title, path) => history.push(path) }, location: { replace: (path) => navigation.push(path), assign: (path) => navigation.push(path) },
    fetch: async (path, options) => {
      calls.push({ path, options }); const result = await handler(path, options, calls);
      return { ...result, json: async () => context.__decodeEntry(JSON.stringify(await result.json())) };
    },
    setTimeout: (callback, delay) => { const id = ++timer; timers.set(id, { callback, at: now + delay }); return id; }, clearTimeout: (id) => timers.delete(id) });
  vm.runInContext(`globalThis.__decodeEntry = (text) => JSON.parse(text); globalThis.__entryModel = (() => {${model.replaceAll("export function ", "function ")}\nreturn {${exports.join(",")}};})();`, context, { filename: "public/entry-model.js" });
  vm.runInContext(controller.replace(/^import \{([^\n]+)\} from "\/entry-model\.js";/, "const {$1} = __entryModel;"), context, { filename: "public/entry.js" });
  const f = { document, navigator, calls, history, navigation, timers, translated, element: (id) => nodes.get(id),
    async event(name, value = {}) { for (const callback of documentEvents.get(name) ?? windowEvents.get(name) ?? []) callback(value); await flush(); },
    async click(id) { for (const callback of nodes.get(id).events.get("click") ?? []) callback({ preventDefault() {} }); await flush(); },
    async hide() { document.visibilityState = "hidden"; await this.event("visibilitychange"); },
    async show() { document.visibilityState = "visible"; await this.event("visibilitychange"); },
    async offline() { navigator.onLine = false; await this.event("offline"); }, async online() { navigator.onLine = true; await this.event("online"); },
    async displayMode(value) { mode.matches = value; for (const callback of modeEvents.get("change") ?? []) callback({ matches: value }); await flush(); },
    async advance(milliseconds) { const target = now + milliseconds; let budget = 50;
      while (budget-- > 0) { const next = [...timers].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; timers.delete(next[0]); now = next[1].at; next[1].callback(); await flush(); }
      assert.ok(budget > 0); now = target; await flush(); }
  };
  return f;
}
function assertNoLinks(f) { for (const role of ["client", "administrator"]) { assert.equal(f.element(`${role}-link`).hidden, true); assert.equal(f.element(`${role}-link`).href, null); assert.equal(f.element(`${role}-description`).textContent, ""); } }
function installOffer(choice = Promise.resolve({ outcome: "dismissed" })) {
  let prompts = 0, prevented = 0;
  return { event: { preventDefault() { prevented += 1; }, async prompt() { prompts += 1; }, userChoice: choice }, prompts: () => prompts, prevented: () => prevented };
}

test("entry exposes explicit configured choices without navigating, fetching private sessions or retaining URL parameters", async () => {
  const f = harness({ handler: () => response(200, dto({ state: "active", href: "/messages" }, { state: "connected", href: "/admin/messages" })) }); await flush();
  assert.equal(f.element("client-link").href, "/messages"); assert.equal(f.element("administrator-link").href, "/admin/messages");
  assert.equal(f.element("client-card").hidden, false); assert.equal(f.element("administrator-card").hidden, false); assert.equal(f.navigation.length, 0);
  assert.deepEqual(f.calls.map((item) => item.path), ["/api/entry"]); assert.equal(f.calls[0].options.method, "GET"); assert.equal(f.calls[0].options.cache, "no-store"); assert.equal(f.calls[0].options.credentials, "same-origin");
  assert.ok(f.history.length); assert.ok(f.history.every((path) => path === "/app")); await f.event("pageshow", { persisted: false }); assert.equal(f.calls.length, 1, "initial pageshow does not duplicate the completed bootstrap");
  await f.advance(60000); assert.equal(f.calls.length, 1, "there is no periodic polling");
});

test("client access states, signed-out administrator and absent roles render only their verified destinations", async () => {
  for (const client of [{ state: "signed_out", href: "/access" }, { state: "pending", href: "/access" }, { state: "expired", href: "/access" }, { state: "active", href: "/access" }]) {
    const f = harness({ handler: () => response(200, dto(client)) }); await flush(); assert.equal(f.element("client-link").href, client.href); assert.equal(f.element("administrator-card").hidden, true);
    assert.ok(f.element("client-description").textContent.length > 0);
  }
  for (const administrator of [{ state: "signed_out", href: "/admin/login" }, { state: "connected", href: "/admin" }]) {
    const f = harness({ handler: () => response(200, dto(null, administrator)) }); await flush(); assert.equal(f.element("administrator-link").href, administrator.href); assert.equal(f.element("client-card").hidden, true);
  }
});

test("disabled entry is distinct from failed verification and no unverified sign-in links are shown", async () => {
  const disabled = harness({ handler: () => response(200, dto(null, null)) }); await flush(); assertNoLinks(disabled); assert.match(disabled.element("entry-status").textContent, /pas encore disponible/);
  for (const failure of [response(429), response(503, dto(null, null)), response(201), response(200, { ...dto(), secret: "private-value" }), response(200, dto({ state: "pending", href: "/messages" }))]) {
    const f = harness({ handler: () => failure }); await flush(); assertNoLinks(f); assert.match(f.element("entry-status").textContent, /pas pu être vérifié/); assert.equal(f.element("entry-retry").hidden, false);
    assert.doesNotMatch(f.element("entry-status").textContent, /private-value/);
  }
});

test("an ignored fetch abort times out after eight seconds, permits explicit retry and ignores a late result", async () => {
  const slow = pause(); const f = harness({ handler: (path, options, calls) => calls.length === 1 ? slow.promise : response(200, dto(null, { state: "connected", href: "/admin" })) });
  await flush(); await f.advance(7999); assert.match(f.element("entry-status").textContent, /Vérification/); await f.advance(1);
  assertNoLinks(f); assert.equal(f.calls[0].options.signal.aborted, true); assert.match(f.element("entry-status").textContent, /pas pu être vérifié/);
  await f.click("entry-retry"); assert.equal(f.calls.length, 2); assert.equal(f.element("administrator-link").href, "/admin");
  slow.resolve(response(200, dto())); await flush(); assert.equal(f.element("client-card").hidden, true); assert.equal(f.element("administrator-link").href, "/admin");
});

test("the same deadline also bounds a response whose JSON body never settles", async () => {
  const body = pause(); const f = harness({ handler: () => ({ ok: true, status: 200, json: () => body.promise }) }); await flush(); await f.advance(8000);
  assertNoLinks(f); assert.match(f.element("entry-status").textContent, /pas pu être vérifié/); body.resolve(dto()); await flush(); assertNoLinks(f);
});

test("hide and pagehide clear destinations immediately; visibility and pageshow deduplicate a fresh check", async () => {
  const slow = pause(); const f = harness({ handler: (path, options, calls) => calls.length === 2 ? slow.promise : response() }); await flush(); assert.equal(f.element("client-link").href, "/messages");
  await f.hide(); assertNoLinks(f); assert.equal(f.element("entry-status").textContent, "");
  await f.show(); await f.event("pageshow", { persisted: true }); assert.equal(f.calls.length, 2); assertNoLinks(f);
  await f.event("pagehide"); assert.equal(f.calls[1].options.signal.aborted, true); assertNoLinks(f);
  slow.resolve(response(200, dto(null, { state: "connected", href: "/admin" }))); await flush(); assertNoLinks(f);
  await f.event("pageshow", { persisted: true }); assert.equal(f.calls.length, 3); assert.equal(f.element("client-link").href, "/messages"); assert.equal(f.element("administrator-card").hidden, true);
});

test("an initially hidden entry does not fetch and an aborted old generation cannot repopulate the new one", async () => {
  const old = pause(); const f = harness({ visible: false, handler: (path, options, calls) => calls.length === 1 ? old.promise : response(200, dto(null, { state: "signed_out", href: "/admin/login" })) });
  await flush(); assert.equal(f.calls.length, 0); await f.show(); assert.equal(f.calls.length, 1); await f.hide(); await f.show(); assert.equal(f.calls.length, 2);
  old.resolve(response()); await flush(); assert.equal(f.element("client-card").hidden, true); assert.equal(f.element("administrator-link").href, "/admin/login");
});

test("offline startup is friendly without requests; online retries only a visible page", async () => {
  const f = harness({ online: false }); await flush(); assert.equal(f.calls.length, 0); assertNoLinks(f); assert.match(f.element("entry-status").textContent, /internet/);
  await f.click("entry-retry"); assert.equal(f.calls.length, 0); await f.online(); assert.equal(f.calls.length, 1); assert.equal(f.element("client-link").href, "/messages");
  await f.offline(); assertNoLinks(f); await f.hide(); await f.online(); assert.equal(f.calls.length, 1); await f.show(); assert.equal(f.calls.length, 2);
});

test("language changes translate fixed and dynamic states without repeating checks or saving a preference", async () => {
  const f = harness(); await flush(); assert.equal(f.document.documentElement.lang, "fr"); assert.match(f.element("client-link").textContent, /conversation/);
  await f.click("language-switch"); assert.equal(f.document.documentElement.lang, "en"); assert.equal(f.element("client-link").textContent, "Return to my conversation");
  assert.equal(f.element("administrator-description").textContent, ""); assert.ok(f.translated.every((node) => typeof node.textContent === "string" && node.textContent.length > 0)); assert.equal(f.calls.length, 1);
  await f.offline(); assert.match(f.element("entry-status").textContent, /internet/); await f.click("language-switch"); assert.match(f.element("entry-status").textContent, /Reconnecte-toi/);
});

test("installation requires an offered event and explicit click; cancellation consumes it and a new offer can be retried", async () => {
  const f = harness(); await flush(); assert.equal(f.element("install-app").hidden, true); await f.click("install-app");
  const first = installOffer(); await f.event("beforeinstallprompt", first.event); assert.equal(first.prevented(), 1); assert.equal(first.prompts(), 0); assert.equal(f.element("install-app").hidden, false);
  await f.click("install-app"); assert.equal(first.prompts(), 1); assert.equal(f.element("install-app").hidden, true); assert.match(f.element("install-status").textContent, /annulée/);
  await f.click("install-app"); assert.equal(first.prompts(), 1);
  const next = installOffer(Promise.resolve({ outcome: "accepted" })); await f.event("beforeinstallprompt", next.event); await f.click("install-app"); assert.equal(next.prompts(), 1); assert.match(f.element("install-status").textContent, /acceptée/);
  await f.event("appinstalled"); assert.equal(f.element("install-app").hidden, true); assert.match(f.element("install-status").textContent, /ajouté/);
  await f.event("beforeinstallprompt", installOffer().event); assert.equal(f.element("install-app").hidden, true);
});

test("hidden, offline and standalone contexts cannot offer installation; stale prompt completions cannot alter a new view", async () => {
  for (const settings of [{ visible: false }, { online: false }, { standalone: true }]) {
    const f = harness(settings), offer = installOffer(); await flush(); await f.event("beforeinstallprompt", offer.event); assert.equal(f.element("install-app").hidden, true); await f.click("install-app"); assert.equal(offer.prompts(), 0);
  }
  const choice = pause(), f = harness(), offer = installOffer(choice.promise); await flush(); await f.event("beforeinstallprompt", offer.event); await f.click("install-app"); await f.hide(); await f.show();
  const fresh = installOffer(); await f.event("beforeinstallprompt", fresh.event); choice.resolve({ outcome: "accepted" }); await flush();
  assert.equal(f.element("install-status").textContent, ""); assert.equal(f.element("install-app").hidden, false); await f.displayMode(true); assert.equal(f.element("install-app").hidden, true);
  assert.equal(f.element("install-help").hidden, true); assert.equal(fresh.prompts(), 0);
});

test("entry includes approved branding and accessible offline guidance without private caching or inline code", () => {
  assert.match(html, /src="\/brand\/icon-128\.png"/); assert.match(html, /href="\/brand\/brand\.css"/);
  assert.match(html, /<noscript>[\s\S]*contact@jessiemessage\.com[\s\S]*<\/noscript>/); assert.match(html, /role="status" aria-live="polite"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/); assert.doesNotMatch(html, /style="|<style>/);
  assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB|serviceWorker|CacheStorage|caches\.|userAgent|innerHTML|location\.assign/);
  assert.match(css, /safe-area-inset-bottom/); assert.match(css, /max-width:380px/); assert.match(css, /focus-visible/); assert.match(css, /min-height:44px/);
});


test("entry opens a single connected role directly and preserves a choice when both are connected", async () => {
  for (const [entry, expected] of [
    [dto({ state: "active", href: "/messages" }, { state: "signed_out", href: "/admin/login" }), "/messages"],
    [dto({ state: "signed_out", href: "/access" }, { state: "connected", href: "/admin/messages" }), "/admin/messages"],
    [dto({ state: "pending", href: "/access" }, { state: "connected", href: "/admin/messages" }), null],
    [dto({ state: "active", href: "/messages" }, { state: "connected", href: "/admin/messages" }), null],
    [dto({ state: "pending", href: "/access" }, null), null],
  ]) {
    const f = harness({ handler: () => response(200, entry) }); await flush();
    assert.deepEqual(f.navigation, expected ? [expected] : []);
    assert.deepEqual(f.calls.map((call) => call.path), ["/api/entry"]);
  }
});

test("device resume remains an explicit role choice with welcoming FR/EN copy", async () => {
  const f = harness({ handler: () => response(200, dto({ state: "signed_out", href: "/connect-device/client" }, { state: "signed_out", href: "/connect-device/admin" })) });
  await flush();
  assert.equal(f.element("client-link").href, "/connect-device/client");
  assert.equal(f.element("client-link").textContent, "Retrouver mon espace");
  assert.equal(f.element("administrator-link").textContent, "Retrouver l’administration");
  assert.equal(f.navigation.length, 0, "the two roles never guess which identity to resume");
  await f.click("language-switch");
  assert.equal(f.element("client-link").textContent, "Return to my space");
  assert.equal(f.element("administrator-link").textContent, "Return to administration");
  assert.equal(f.calls.length, 1, "language does not authorize or restart a transition");
});
