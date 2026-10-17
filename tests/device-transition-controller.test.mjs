import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../public/device-transition.js", import.meta.url), "utf8");
const primary = "https://jessiemessage.com", legacy = "https://recette.jessiemessage.com";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function page(fetch, { origin = primary, hash = "" } = {}) {
  const elements = new Map(), events = new Map(), timers = new Map(), navigations = []; let sequence = 0;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, textContent: "", href: "", listeners: new Map(),
      setAttribute() {}, addEventListener(name, callback) { this.listeners.set(name, callback); } });
    return elements.get(id);
  };
  const location = { origin, hash, search: "", pathname: "/connect-device/admin", replace: (url) => navigations.push(url), assign: (url) => navigations.push(url) };
  runInNewContext(script, {
    document: { documentElement: { lang: "fr", dataset: { transitionLegacy: legacy, transitionPrimary: primary } }, getElementById: element },
    window: { addEventListener: (name, callback) => events.set(name, callback) },
    history: { replaceState() { location.hash = ""; } }, location, fetch, AbortController,
    setTimeout(callback, milliseconds) { const id = ++sequence; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  return { element, events, timers, navigations, location,
    click: () => element("transition-start").listeners.get("click")(),
    expire() { for (const timer of [...timers.values()]) { assert.equal(timer.milliseconds, 8000); timer.callback(); } },
  };
}

test("a hanging begin request is aborted after eight seconds and a trusted retry can navigate", async () => {
  const requests = []; let first = true;
  const p = page(async (_url, options) => {
    requests.push(options);
    if (first) { first = false; return new Promise(() => {}); }
    return { ok: true, json: async () => ({ challenge: "a".repeat(100) }) };
  });
  p.click(); await tick(); assert.equal(p.element("transition-start").disabled, true); assert.equal(requests.length, 1);
  p.expire(); await tick();
  assert.equal(requests[0].signal.aborted, true); assert.equal(p.element("transition-start").disabled, false);
  assert.equal(p.element("transition-start").textContent, "Réessayer"); assert.equal(p.navigations.length, 0); assert.equal(p.timers.size, 0);
  p.click(); await tick(); assert.equal(requests.length, 2); assert.deepEqual(p.navigations, [`${legacy}/connect-device/admin#challenge=${"a".repeat(100)}`]);
});

test("the same eight-second deadline includes a response whose JSON body never arrives", async () => {
  let signal;
  const p = page(async (_url, options) => { signal = options.signal; return { ok: true, json: () => new Promise(() => {}) }; });
  p.click(); await tick(); p.expire(); await tick();
  assert.equal(signal.aborted, true); assert.equal(p.element("transition-start").disabled, false);
  assert.match(p.element("transition-status").textContent, /Tu peux réessayer/); assert.equal(p.navigations.length, 0);
});

test("the source session GET uses the same request deadline before authorization", async () => {
  const requests = [];
  const p = page(async (url, options) => { requests.push([url, options]); return new Promise(() => {}); }, { origin: legacy, hash: `#challenge=${"a".repeat(100)}` });
  await tick(); assert.equal(p.location.hash, ""); assert.equal(requests[0][0], "/api/auth/session"); assert.equal(requests[0][1].method, "GET");
  p.expire(); await tick(); assert.equal(requests[0][1].signal.aborted, true);
  assert.equal(p.element("transition-start").disabled, false); assert.equal(requests.length, 1);
});

test("pagehide aborts outstanding work and a late response cannot navigate or replace a newer page state", async () => {
  let resolve, signal;
  const p = page(async (_url, options) => { signal = options.signal; return new Promise((done) => { resolve = done; }); });
  p.click(); await tick(); p.events.get("pagehide")(); await tick(); assert.equal(signal.aborted, true);
  p.events.get("pageshow")(); assert.equal(p.element("transition-start").disabled, false);
  const current = p.element("transition-status").textContent;
  resolve({ ok: true, json: async () => ({ challenge: "a".repeat(100) }) }); await tick();
  assert.equal(p.navigations.length, 0); assert.equal(p.element("transition-status").textContent, current); assert.equal(p.timers.size, 0);
});
