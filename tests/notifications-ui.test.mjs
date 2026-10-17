import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createECDH } from "node:crypto";

const source = await readFile(new URL("../public/notifications.js", import.meta.url), "utf8");
const swSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const key = createECDH("prime256v1"); key.generateKeys();
const vapidPublicKey = key.getPublicKey().toString("base64url");
const id = "a".repeat(32), subscriptionId = "b".repeat(32), csrf = "A".repeat(43);
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const flush = async () => { for (let index = 0; index < 12; index++) await new Promise((resolve) => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class Element extends EventTarget {
  constructor(tag = "div") { super(); this.tagName = tag; this.children = []; this.hidden = false; this.disabled = false; this.attributes = new Map(); this.dataset = {}; this._text = ""; this.parentElement = null; const classes = new Set(); this.classList = { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } }; }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join(" "); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  descendants() { return this.children.flatMap((node) => [node, ...node.descendants()]); }
}
function harness({ permission = "default", supported = true, secure = true, registrationReady = null, local = false, intercept, nextPermission = "granted", role = "client", ios = false } = {}) {
  const host = new Element(), document = { visibilityState: "visible", createElement: (tag) => new Element(tag) };
  const calls = [], trace = [], timers = new Map(), catalogue = {}, bindings = new Map(), availability = [];
  let timer = 0, disposed = false, language = "fr", currentCsrf = csrf;
  const fixture = { enabled: local, permissionCalls: 0, subscribeCalls: 0, unsubscribeCalls: 0 };
  const subscription = { options: { applicationServerKey: key.getPublicKey() }, endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-only", toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: vapidPublicKey, auth: Buffer.alloc(16, 1).toString("base64url") } }; }, async unsubscribe() { fixture.unsubscribeCalls++; trace.push("unsubscribe"); currentSubscription = null; return true; } };
  let currentSubscription = local ? subscription : null;
  const registration = { active: {}, pushManager: { async getSubscription() { trace.push("getSubscription"); return currentSubscription; }, async subscribe(options) { fixture.subscribeCalls++; trace.push("subscribe"); if (Notification.permission === "default") { fixture.permissionCalls++; trace.push("permission"); Notification.permission = nextPermission; } if (Notification.permission !== "granted") throw Object.assign(new Error("Permission not granted"), { name: "NotAllowedError" }); assert.equal(options.userVisibleOnly, true); assert.equal(Buffer.from(options.applicationServerKey).toString("base64url"), vapidPublicKey); currentSubscription = subscription; return subscription; } } };
  const Notification = { permission, requestPermission() { fixture.permissionCalls++; trace.push("permission"); Notification.permission = nextPermission; return Promise.resolve(nextPermission); } };
  const context = vm.createContext({ document, navigator: { platform: ios ? "MacIntel" : "Linux", maxTouchPoints: ios ? 5 : 0, serviceWorker: { register(path, options) { trace.push("register"); assert.equal(path, "/sw.js"); assert.deepEqual({ ...options }, { scope: "/", updateViaCache: "none" }); return registrationReady?.promise ?? Promise.resolve(registration); }, ready: registrationReady?.promise ?? Promise.resolve(registration) } },
    ...(supported ? { Notification, PushManager: function PushManager() {} } : {}), isSecureContext: secure,
    Uint8Array, atob: (value) => Buffer.from(value, "base64").toString("binary"), AbortController,
    JessieI18n: { register(entries) { Object.assign(catalogue, entries); }, getLanguage() { return language; }, text(node, text) { bindings.set(node, text); node.textContent = language === "en" ? catalogue[text] ?? text : text; }, rawText(node, text) { bindings.delete(node); node.textContent = text; }, forget(node) { for (const child of [node, ...node.descendants()]) bindings.delete(child); } },
    setTimeout(callback, delay) { const id = ++timer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch: async (path, options) => {
      calls.push({ path, options }); trace.push(`fetch:${path}`);
      const intercepted = intercept?.(path, options, fixture); if (intercepted !== undefined) return intercepted;
      if (path.endsWith("/session")) return response({ user: { id, role }, csrf: currentCsrf, expiresAt: Date.now() + 3600000 });
      if (path.endsWith("/capabilities")) return response({ enabled: true, vapidPublicKey });
      if (path.endsWith("/status")) return response({ enabled: fixture.enabled, subscriptionId: fixture.enabled ? subscriptionId : null });
      if (path.endsWith("/subscription")) { fixture.enabled = true; return response({ enabled: true, subscriptionId }); }
      if (path.endsWith("/disable")) { fixture.enabled = false; return response({ enabled: false }); }
      throw new Error("Unexpected synthetic request");
    } });
  vm.runInContext(source, context);
  const panel = context.JessieNotifications.mount(host, { role, owner: { id, csrf }, isCurrent: () => !disposed, onAvailability: (value) => availability.push(value) });
  return { host, calls, trace, fixture, timers, Notification, catalogue, registration, availability,
    button(action) { return host.descendants().find((node) => node.dataset.notificationAction === action); },
    click(action) { this.button(action).dispatchEvent(new Event("click")); },
    language(next) { language = next; for (const [node, text] of bindings) node.textContent = language === "en" ? catalogue[text] ?? text : text; },
    changeOwner() { currentCsrf = "E".repeat(43); },
    clear() { disposed = true; panel.clear(); },
    async expire(delay = 15000) { const entry = [...timers].find(([, value]) => value.delay === delay); assert.ok(entry); timers.delete(entry[0]); entry[1].callback(); await flush(); },
  };
}

test("preparation registers an active worker before enabling the explicit gesture and never requests permission or subscribes", async () => {
  const pending = deferred(), f = harness({ registrationReady: pending });
  await flush(); assert.equal(f.fixture.permissionCalls, 0); assert.equal(f.fixture.subscribeCalls, 0); assert.equal(f.button("enable").hidden, true);
  f.click("enable"); assert.equal(f.fixture.permissionCalls, 0);
  pending.resolve(f.registration); await flush(); assert.equal(f.button("enable").hidden, false); assert.match(f.host.textContent, /désactivées/);
  const start = f.trace.length; f.click("enable"); assert.equal(f.trace[start], "subscribe", "subscribe remains inside the original click stack and handles permission itself");
  assert.equal(f.trace.slice(start).some((value) => value.startsWith("fetch:")), false, "no network await precedes the subscription gesture");
  await flush(); assert.equal(f.fixture.permissionCalls, 1); assert.equal(f.fixture.subscribeCalls, 1); assert.match(f.host.textContent, /activées sur cet appareil/);
  const post = f.calls.find((call) => call.path.endsWith("/subscription")); assert.equal(post.options.headers["X-CSRF-Token"], csrf);
  const body = JSON.parse(post.options.body); assert.equal(body.language, "fr"); assert.equal(body.subscription.endpoint.startsWith("https://fcm."), true);
  assert.equal(post.options.credentials, "same-origin"); assert.equal(post.options.cache, "no-store");
  assert.doesNotMatch(f.host.textContent, /synthetic-only|fcm\.googleapis|[ab]{32}|A{43}/); f.clear();
});

test("denied permission stays respected and unsupported contexts explain iPhone Home Screen installation", async () => {
  const denied = harness({ permission: "denied" }); await flush(); denied.click("enable"); await flush();
  assert.equal(denied.fixture.permissionCalls, 0); assert.equal(denied.fixture.subscribeCalls, 0); assert.equal(denied.button("enable").hidden, true); assert.match(denied.host.textContent, /réglages de ce site/); denied.clear();
  for (const settings of [{ supported: false }, { secure: false }]) {
    const f = harness(settings); await flush(); assert.equal(f.fixture.permissionCalls, 0); assert.equal(f.trace.includes("register"), false);
    assert.equal(f.host.descendants().find((node) => node.textContent.startsWith("Sur iPhone ou iPad")).hidden, true); assert.match(f.host.textContent, /pas disponibles dans ce navigateur/); f.clear();
  }
  const ipad = harness({ supported: false, ios: true }); await flush();
  assert.equal(ipad.host.descendants().find((node) => node.textContent.startsWith("Sur iPhone ou iPad")).hidden, false); ipad.clear();
});

test("a dismissed prompt does not register a server preference and a later explicit choice uses the selected language", async () => {
  const f = harness({ nextPermission: "default" }); await flush(); f.click("enable"); await flush();
  assert.equal(f.fixture.permissionCalls, 1); assert.equal(f.fixture.subscribeCalls, 1); assert.equal(f.calls.some((call) => call.path.endsWith("/subscription")), false);
  assert.equal(f.button("enable").hidden, false); assert.match(f.host.textContent, /Tu n’as pas activé/);
  f.language("en"); assert.match(f.host.textContent, /Notifications are still off/); assert.equal(f.button("enable").textContent, "Turn on on this device"); f.clear();
});

test("browser permission alone is not displayed as an enabled server preference", async () => {
  const f = harness({ permission: "granted", local: false }); await flush();
  assert.match(f.host.textContent, /Notifications désactivées/); assert.equal(f.button("enable").hidden, false);
  f.language("en"); f.click("enable"); await flush(); assert.equal(f.fixture.permissionCalls, 0);
  assert.equal(JSON.parse(f.calls.find((call) => call.path.endsWith("/subscription")).options.body).language, "en"); f.clear();
});

test("disabling changes only the current subscription and confirms the server before removing the browser subscription", async () => {
  const f = harness({ permission: "granted", local: true }); await flush(); assert.match(f.host.textContent, /activées/);
  f.click("disable"); await flush(); const post = f.calls.find((call) => call.path.endsWith("/disable"));
  assert.deepEqual(JSON.parse(post.options.body), { id: subscriptionId }); assert.equal(post.options.headers["X-CSRF-Token"], csrf);
  assert.equal(f.fixture.unsubscribeCalls, 1); assert.ok(f.trace.indexOf("unsubscribe") > f.trace.findIndex((item) => item.endsWith("/disable")));
  assert.match(f.host.textContent, /Les autres appareils restent inchangés/); assert.equal(f.button("disable").hidden, true); f.clear();
});

test("a failed activation is reconciled by a status check without another prompt or repeated subscription POST", async () => {
  let first = true;
  const f = harness({ intercept: (path, _options, fixture) => { if (path.endsWith("/subscription") && first) { first = false; fixture.enabled = true; return response({ error: "notifications_unavailable" }, 503); } } });
  await flush(); f.click("enable"); await flush(); assert.match(f.host.textContent, /activation n’est pas confirmée/);
  f.click("retry"); await flush(); assert.match(f.host.textContent, /activées sur cet appareil/); assert.equal(f.fixture.permissionCalls, 1);
  assert.equal(f.calls.filter((call) => call.path.endsWith("/subscription")).length, 1); f.clear();
});

test("owner changes and cleared views cannot create or display a preference for the stale account", async () => {
  const f = harness(); await flush(); f.changeOwner(); f.click("enable"); await flush();
  assert.equal(f.fixture.subscribeCalls, 1); assert.equal(f.calls.some((call) => call.path.endsWith("/subscription")), false);
  assert.match(f.host.textContent, /connexion a changé/); f.clear();
  const pending = deferred(), late = harness({ registrationReady: pending }); await flush(); late.clear(); pending.resolve(late.registration); await flush();
  assert.equal(late.host.children.length, 0); assert.equal(late.host.hidden, true); assert.equal(late.fixture.subscribeCalls, 0);
});

test("disabled capabilities stay absent and browser preparation has a bounded retry without a permission prompt", async () => {
  const disabled = harness({ intercept: (path) => path.endsWith("/capabilities") ? response({}, 404) : undefined }); await flush();
  assert.equal(disabled.host.hidden, true); assert.deepEqual(disabled.availability, [false]); assert.equal(disabled.trace.includes("register"), false); disabled.clear();
  const pending = deferred(), f = harness({ registrationReady: pending }); await flush(); await f.expire();
  assert.equal(f.button("retry").hidden, false); assert.match(f.host.textContent, /pas pu être vérifiés/); assert.equal(f.fixture.permissionCalls, 0); f.clear(); pending.resolve(f.registration); await flush();
});

function workerHarness(windows = []) {
  const listeners = new Map(), shown = [], opened = []; let focused = 0, closed = 0;
  vm.runInNewContext(swSource, { URL, self: { location: { origin: "https://example.invalid" }, addEventListener: (name, callback) => listeners.set(name, callback), skipWaiting: async () => {},
    registration: { async showNotification(title, options) { shown.push({ title, options }); } }, clients: { async claim() {}, async matchAll() { return windows.map((url) => ({ url, async focus() { focused++; } })); }, async openWindow(url) { opened.push(url); } } } });
  return { listeners, shown, opened, get focused() { return focused; }, get closed() { return closed; },
    async event(name, data, notification = { url: "https://evil.invalid/private" }) { let pending; listeners.get(name)({ data, notification: { data: notification, close() { closed++; } }, waitUntil(promise) { pending = promise; } }); await pending; } };
}
test("the worker displays only fixed generic copy and cannot fetch or cache private data", async () => {
  const f = workerHarness(); await f.event("install"); await f.event("activate");
  await f.event("push", { json: () => ({ language: "en", title: "Private name", body: "Secret message", image: "/private/photo", conversationId: id }) });
  await f.event("push", { json: () => { throw new Error("malformed"); } });
  assert.equal(f.shown[0].title, "Jessie"); assert.equal(f.shown[0].options.body, "A new message is waiting for you.");
  assert.equal(f.shown[1].options.body, "Un nouveau message t’attend.");
  for (const value of f.shown) { assert.equal(value.options.tag, "jessie-new-message"); assert.equal(value.options.renotify, false); assert.equal(value.options.data.url, "/app"); assert.doesNotMatch(JSON.stringify(value), /Secret|Private name|conversationId/); }
  assert.equal(f.listeners.has("fetch"), false); assert.doesNotMatch(swSource, /\b(?:fetch\s*\(|caches\.|indexedDB|localStorage|sessionStorage)\b/);
});
test("notification clicks always reach app entry and preserve a draft in an already open conversation", async () => {
  const existing = workerHarness(["https://example.invalid/app"]); await existing.event("notificationclick");
  assert.equal(existing.focused, 1); assert.equal(existing.opened.length, 0); assert.equal(existing.closed, 1);
  const chat = workerHarness(["https://example.invalid/messages", "https://evil.invalid/app"]); await chat.event("notificationclick");
  assert.deepEqual(chat.opened, ["/app"]); assert.equal(chat.focused, 0);
});

test("new notifications open the intended role directly without exposing message or conversation identifiers", async () => {
  for (const role of ["client", "admin"]) {
    const f = workerHarness(), reference = "cd".repeat(16);
    await f.event("push", { json: () => ({ language: "fr", role, notification: reference, url: "https://evil.invalid" }) });
    const path = `${role === "admin" ? "/admin/messages" : "/messages"}#notification=${reference}`;
    assert.equal(f.shown[0].options.data.url, path);
    await f.event("notificationclick", undefined, f.shown[0].options.data);
    assert.deepEqual(f.opened, [path]);
  }
  const f = workerHarness();
  await f.event("push", { json: () => ({ role: "admin", notification: "../../private" }) });
  assert.equal(f.shown[0].options.data.url, "/app");
});


test("an endpoint conflict requires an explicit local reset and a fresh activation click without automatic resubscription", async () => {
  let conflict = true;
  const f = harness({ local: true, permission: "granted", intercept: (path) => path.endsWith("/status") ? response({ enabled: false, subscriptionId: null })
    : path.endsWith("/subscription") && conflict ? response({ error: "subscription_conflict" }, 409) : undefined });
  await flush(); f.click("enable"); await flush(); assert.equal(f.button("reset").hidden, false); assert.equal(f.fixture.unsubscribeCalls, 0);
  assert.match(f.host.textContent, /Réinitialise-les ici/); f.click("reset"); await flush();
  assert.equal(f.fixture.unsubscribeCalls, 1); assert.equal(f.fixture.subscribeCalls, 0); assert.equal(f.button("enable").hidden, false);
  assert.match(f.host.textContent, /C’est réinitialisé/); conflict = false;
  const before = f.trace.length; f.click("enable"); assert.equal(f.trace[before], "subscribe"); await flush();
  assert.equal(f.fixture.subscribeCalls, 1); assert.match(f.host.textContent, /activées sur cet appareil/); f.clear();
});


test("a malformed enabled status cannot claim notifications are active without a revocable subscription identifier", async () => {
  const f = harness({ local: true, permission: "granted", intercept: (path) => path.endsWith("/status") ? response({ enabled: true, subscriptionId: null }) : undefined });
  await flush(); assert.match(f.host.textContent, /pas pu être vérifiés/); assert.equal(f.button("disable").hidden, true);
  assert.equal(f.button("enable").hidden, true); f.clear();
});

test("a supported open chat acknowledges the click and keeps its browsing context instead of being navigated", async () => {
  const listeners = new Map(), opened = [], received = []; let focused = 0;
  const reference = "ef".repeat(16), origin = "https://example.invalid";
  const live = { url: `${origin}/messages#notification=${reference}`, focused: false, async focus() { focused++; return this; },
    postMessage(value, ports) { received.push(value); ports[0].postMessage({ accepted: true }); } };
  vm.runInNewContext(swSource, { URL, MessageChannel, setTimeout, clearTimeout, self: { location: { origin },
    addEventListener: (name, callback) => listeners.set(name, callback), clients: {
      async matchAll() { return [live]; }, async openWindow(path) { opened.push(path); },
    } } });
  let pending;
  listeners.get("notificationclick")({ notification: { data: { url: `/messages#notification=${reference}` }, close() {} }, waitUntil(value) { pending = value; } });
  await pending;
  assert.equal(focused, 1); assert.deepEqual(opened, []);
  assert.equal(received[0].type, "jessie-open-notification"); assert.equal(received[0].notification, reference);
});
