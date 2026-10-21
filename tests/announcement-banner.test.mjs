import test from "node:test";
import assert from "node:assert/strict";
import { createAnnouncementBanner, parseAnnouncementBannerResponse } from "../public/announcement-banner.js";

const now = 1792584000000, id = n => n.toString(16).padStart(32, "0");
const response = (revision = "1", body = "Je commence mon show 💋") => ({ serverTime: now, announcement: { id: id(7), revision, body, startsAt: now - 1000, expiresAt: now + 3600000 } });
class Element {
  constructor(tag, document) { this.tagName = tag; this.document = document; this.children = []; this.parentElement = null; this.hidden = false; this.events = new Map(); this.attrs = new Map(); this.textContent = ""; this.open = false; }
  get isConnected() { return this === this.document.body || this === this.document.head || !!this.parentElement?.isConnected; }
  append(...items) { for (const item of items) { item.remove(); item.parentElement = this; this.children.push(item); } }
  prepend(...items) { for (const item of [...items].reverse()) { item.remove(); item.parentElement = this; this.children.unshift(item); } }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this); this.parentElement = null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); } getAttribute(name) { return this.attrs.get(name) ?? null; } removeAttribute(name) { this.attrs.delete(name); }
  contains(item) { return this === item || this.children.some(child => child.contains(item)); }
  addEventListener(name, handler) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(handler); }
  click() { for (const handler of this.events.get("click") ?? []) handler({ currentTarget: this, preventDefault() {} }); }
  focus() { this.document.activeElement = this; }
  showModal() { this.open = true; } close() { this.open = false; }
}
function fixture(t, respond = async () => response()) {
  const document = { visibilityState: "visible", activeElement: null };
  document.createElement = tag => new Element(tag, document); document.body = document.createElement("body"); document.head = document.createElement("head");
  document.getElementById = id => { const visit = node => node.id === id ? node : node.children.map(visit).find(Boolean); return visit(document.body) ?? visit(document.head) ?? null; };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
  let clock = now, next = 0, current = true; const timers = new Map(), calls = [], listeners = new Set();
  t.mock.method(Date, "now", () => clock);
  t.mock.method(globalThis.performance, "now", () => clock);
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { timers.set(++next, { callback, delay }); return next; });
  t.mock.method(globalThis, "clearTimeout", key => timers.delete(key));
  const host = document.createElement("div"), menu = document.createElement("div"), returnFocus = document.createElement("button"); document.body.append(host, menu, returnFocus);
  const ui = { t: (value, params = {}) => value.replace(/\{(\w+)\}/g, (_, key) => String(params[key])), text(node, value) { node.textContent = value; },
    rawText(node, value) { node.textContent = value; }, attr(node, name, value) { node.setAttribute(name, value); }, forget() {}, onChange(handler) { listeners.add(handler); return () => listeners.delete(handler); } };
  const banner = createAnnouncementBanner({ host, menuParent: menu, ui, getReturnFocus: () => returnFocus, isCurrent: () => current,
    request: async (...args) => { calls.push(args); return respond(...args); } });
  t.after(() => banner.destroy());
  return { document, banner, calls, timers, returnFocus, el: id => document.getElementById(id), setCurrent(value) { current = value; }, advance(value) { clock = value; }, listeners };
}

test("client announcement DTO rejects future, expired, malformed and imprecise revisions", () => {
  assert.equal(parseAnnouncementBannerResponse({ serverTime: now, announcement: null }).announcement, null);
  assert.equal(parseAnnouncementBannerResponse(response()).announcement.body, "Je commence mon show 💋");
  for (const patch of [{ startsAt: now + 1 }, { expiresAt: now }, { revision: 1 }, { revision: "01" }, { revision: "18446744073709551616" }, { body: "x".repeat(1001) }]) assert.throws(() => parseAnnouncementBannerResponse({ ...response(), announcement: { ...response().announcement, ...patch } }));
});

test("client banner keeps a bounded poll cadence, raw content and same-revision dismissal", async t => {
  let revision = "1"; const f = fixture(t, async () => response(revision, "Fermer"));
  await f.banner.refresh(); assert.equal(f.calls.length, 1); assert.equal(f.el("announcement-preview").textContent, "Fermer");
  assert.equal(f.el("announcement-banner").hidden, false); await f.banner.refresh(); assert.equal(f.calls.length, 1);
  f.el("hide-announcement").click(); assert.equal(f.el("announcement-banner").hidden, true); assert.equal(f.el("open-current-announcement").hidden, false);
  await f.banner.refresh(true); assert.equal(f.el("announcement-banner").hidden, true);
  revision = "2"; await f.banner.refresh(true); assert.equal(f.el("announcement-banner").hidden, false);
  f.el("open-announcement").click(); assert.equal(f.el("announcement-dialog").open, true); assert.equal(f.document.activeElement, f.el("close-announcement"));
  f.el("close-announcement").click(); assert.equal(f.document.activeElement, f.el("open-announcement"));
});

test("expiry clears visible text, menu entry and an open dialog without waiting for a server poll", async t => {
  const f = fixture(t); await f.banner.refresh(); f.el("open-announcement").click();
  assert.equal(f.el("announcement-dialog").open, true);
  f.advance(now + 3600000); const timer = [...f.timers.values()][0]; timer.callback();
  assert.equal(f.el("announcement-banner").hidden, true); assert.equal(f.el("announcement-body").textContent, "");
  assert.equal(f.el("open-current-announcement").hidden, true); assert.equal(f.el("announcement-dialog").open, false); assert.equal(f.document.activeElement, f.returnFocus);
});

test("suspend and destroy refuse a delayed response from a previous visible account context", async t => {
  let resolve; const pending = new Promise(done => { resolve = done; }); const f = fixture(t, () => pending);
  const task = f.banner.refresh(); f.banner.suspend(); f.setCurrent(false); resolve(response()); await task;
  assert.equal(f.el("announcement-preview").textContent, ""); assert.equal(f.el("announcement-banner").hidden, true);
  f.banner.destroy(); assert.equal(f.el("announcement-banner"), null); assert.equal(f.el("announcement-dialog"), null); assert.equal(f.listeners.size, 0);
});

test("a response delayed past the announcement end cannot extend its display window", async t => {
  let resolve; const delayed = new Promise(done => { resolve = done; }); const f = fixture(t, () => delayed);
  const task = f.banner.refresh(); f.advance(now + 20000);
  resolve({ serverTime: now, announcement: { ...response().announcement, expiresAt: now + 5000 } }); await task;
  assert.equal(f.el("announcement-banner").hidden, true); assert.equal(f.el("announcement-body").textContent, "");
  assert.equal(f.el("open-current-announcement").hidden, true);
});
