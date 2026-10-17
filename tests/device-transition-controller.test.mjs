import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createDeviceTransitionService } from "../server/transition/service.mjs";

const script = await readFile(new URL("../public/device-transition.js", import.meta.url), "utf8");
const primary = "https://jessiemessage.com", legacy = "https://recette.jessiemessage.com";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function page(fetch, { origin = primary, hash = "", role = "admin" } = {}) {
  const elements = new Map(), events = new Map(), timers = new Map(), navigations = []; let sequence = 0;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, textContent: "", href: "", listeners: new Map(),
      setAttribute() {}, addEventListener(name, callback) { this.listeners.set(name, callback); } });
    return elements.get(id);
  };
  const location = { origin, hash, search: "", pathname: `/connect-device/${role}`, replace: (url) => navigations.push(url), assign: (url) => navigations.push(url) };
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

const notification = "a1".repeat(16), packet = "b".repeat(100);
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
function realService(role) {
  const token = Buffer.alloc(32, 3).toString("base64url"), csrf = Buffer.alloc(32, 4).toString("base64url");
  const current = { user: { id: "a".repeat(32), role, pseudonym: "Synthetic account" }, csrf, expiresAt: Date.now() + 86400000,
    ...(role === "client" ? { access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, expiresAt: null } } : {}) };
  let failLookup = false;
  const credentials = { async session(raw) { if (failLookup) { failLookup = false; throw new Error("Synthetic backend failure"); } return raw === token ? current : null; } };
  return { token, csrf, failNextLookup() { failLookup = true; }, service: createDeviceTransitionService({ authService: credentials, accessService: credentials }) };
}

for (const role of ["admin", "client"]) {
  test(`${role}: every successful handoff hop carries the retry notification hint in its fragment only`, async () => {
    const requests = [];
    const begin = page(async (url, options) => { requests.push({ url, body: options.body }); return response({ challenge: packet }); }, { role, hash: `#notification=${notification}` });
    begin.click(); await tick();
    assert.deepEqual(requests, [{ url: `/api/device-transition/${role}/begin`, body: JSON.stringify({ notification }) }]);
    assert.deepEqual(begin.navigations, [`${legacy}/connect-device/${role}#challenge=${packet}&notification=${notification}`]);
    assert.equal(begin.location.hash, "");

    const authorize = page(async (url, options) => {
      requests.push({ url, body: options.body });
      return response(url.endsWith("/session") ? { user: { role }, csrf: "c".repeat(43) } : { ticket: packet });
    }, { role, origin: legacy, hash: `#challenge=${packet}&notification=${notification}` });
    await tick();
    assert.equal(authorize.location.hash, "");
    assert.deepEqual(authorize.navigations, [`${primary}/connect-device/${role}#ticket=${packet}&notification=${notification}`]);
    assert.equal(requests.every(({ url }) => !/[?#]/.test(url)), true, "no fragment metadata enters an HTTP API URL");
    assert.equal(requests.at(-1).body, JSON.stringify({ challenge: packet }), "the hint does not extend the closed authorize input");
  });

  for (const action of ["authorize", "complete"]) for (const failure of ["503", "network", "timeout"]) {
    test(`${role}: ${action} ${failure} keeps the notification when the user retries`, async () => {
      const requests = [];
      const p = page(async (url, options) => {
        requests.push({ url, ...options });
        if (url.endsWith("/session")) return response({ user: { role }, csrf: "c".repeat(43) });
        if (url.endsWith(`/${action}`)) {
          if (failure === "503") return response({ error: "transition_unavailable" }, 503);
          if (failure === "network") throw new TypeError("Synthetic network failure");
          return new Promise(() => {});
        }
        return response({ challenge: packet });
      }, { role, origin: action === "authorize" ? legacy : primary, hash: `#${action === "authorize" ? "challenge" : "ticket"}=${packet}&notification=${notification}` });
      await tick();
      assert.equal(p.location.hash, "", "clear the packet and hint before asynchronous work");
      assert.equal(requests.at(-1)?.url, `/api/device-transition/${role}/${action}`);
      if (failure === "timeout") { p.expire(); await tick(); assert.equal(requests.at(-1).signal.aborted, true); }
      assert.equal(p.element("transition-start").disabled, false);
      assert.equal(p.element("transition-start").textContent, "Réessayer");
      p.click(); await tick();
      if (action === "authorize") {
        assert.deepEqual(p.navigations, [`${primary}/connect-device/${role}#notification=${notification}`]);
      } else {
        assert.equal(requests.at(-1).url, `/api/device-transition/${role}/begin`);
        assert.equal(requests.at(-1).body, JSON.stringify({ notification }));
        assert.deepEqual(p.navigations, [`${legacy}/connect-device/${role}#challenge=${packet}&notification=${notification}`]);
      }
      assert.equal(requests.every(({ url }) => !/[?#]/.test(url)), true);
      assert.equal(p.timers.size, 0);
    });
  }

  test(`${role}: normal completion follows the authenticated destination rather than the retry hint`, async () => {
    const f = realService(role), reference = "d2".repeat(16);
    const begun = f.service.begin(role, { notification: reference });
    const { ticket } = await f.service.authorize(role, f.token, f.csrf, { challenge: begun.challenge });
    const requests = [], destination = `${role === "admin" ? "/admin/messages" : "/messages"}#notification=${reference}`;
    const p = page(async (url, options) => {
      requests.push({ url, body: options.body });
      return response(await f.service.complete(role, begun.nonce, null, JSON.parse(options.body)));
    }, {
      role, hash: `#ticket=${ticket}&notification=${notification}`,
    });
    await tick();
    assert.deepEqual(requests, [{ url: `/api/device-transition/${role}/complete`, body: JSON.stringify({ ticket }) }]);
    assert.deepEqual(p.navigations, [destination]);
  });

  for (const failure of ["backend-after-consumption", "lost-response-after-consumption"]) {
    test(`${role}: ${failure} starts a new handoff instead of replaying the spent ticket`, async () => {
      const f = realService(role), first = f.service.begin(role, { notification });
      const { ticket } = await f.service.authorize(role, f.token, f.csrf, { challenge: first.challenge });
      if (failure === "backend-after-consumption") f.failNextLookup();
      const requests = []; let fresh;
      const p = page(async (url, options) => {
        requests.push(url);
        if (url.endsWith("/begin")) { fresh = f.service.begin(role, JSON.parse(options.body), first.nonce); return response({ challenge: fresh.challenge }); }
        try {
          await f.service.complete(role, first.nonce, null, JSON.parse(options.body));
        } catch (error) { return response({ error: error.publicCode }, error.httpStatus); }
        throw new TypeError("Synthetic lost completion response");
      }, { role, hash: `#ticket=${ticket}&notification=${notification}` });
      await tick();
      assert.equal(p.element("transition-start").textContent, "Réessayer");
      await assert.rejects(() => f.service.complete(role, first.nonce, null, { ticket }), error => error.httpStatus === 400, "the first ticket was actually consumed before the failure");
      p.click(); await tick();
      assert.deepEqual(requests, [`/api/device-transition/${role}/complete`, `/api/device-transition/${role}/begin`]);
      assert.notEqual(fresh?.challenge, first.challenge);
      assert.deepEqual(p.navigations, [`${legacy}/connect-device/${role}#challenge=${fresh.challenge}&notification=${notification}`]);
      const next = await f.service.authorize(role, f.token, f.csrf, { challenge: fresh.challenge });
      const completed = await f.service.complete(role, fresh.nonce, null, { ticket: next.ticket });
      assert.equal(completed.destination, `${role === "admin" ? "/admin/messages" : "/messages"}#notification=${notification}`);
    });
  }
}

test("older challenge and ticket fragments without a retry hint remain compatible", async () => {
  const source = page(async url => response(url.endsWith("/session") ? { user: { role: "admin" }, csrf: "c".repeat(43) } : { ticket: packet }), {
    origin: legacy, hash: `#challenge=${packet}`,
  });
  await tick();
  assert.deepEqual(source.navigations, [`${primary}/connect-device/admin#ticket=${packet}`]);
  const target = page(async () => response({ destination: "/admin/messages" }), { hash: `#ticket=${packet}` });
  await tick();
  assert.deepEqual(target.navigations, ["/admin/messages"]);
});

for (const hash of [
  `#challenge=${packet}&notification=invalid`,
  `#ticket=${packet}&notification=${notification.toUpperCase()}`,
  `#challenge=${packet}&notification=${notification}&notification=${notification}`,
  `#ticket=${packet}&notification=${notification}&extra=1`,
  `#challenge=${packet}&unknown=${notification}`,
  `#notification=${notification}&ticket=${packet}`,
  `#notification=${notification}&challenge=${packet}`,
  `#ticket=${packet}&ticket=${packet}&notification=${notification}`,
  `#ticket=${packet}&notification=`,
  `#ticket=${packet}&notification=%61${notification.slice(1)}`,
]) test(`malformed, duplicate or unknown fragment fields are refused: ${hash.slice(0, 24)}`, async () => {
  let calls = 0;
  const p = page(async () => { calls += 1; return response({}); }, { hash });
  await tick();
  assert.equal(calls, 0);
  assert.equal(p.location.hash, "");
  assert.equal(p.element("transition-status").textContent, "Ce lien n’est plus disponible. Recommence depuis la nouvelle adresse.");
  assert.deepEqual(p.navigations, []);
});

test("pagehide also aborts a hinted completion and ignores its late authenticated destination", async () => {
  let resolve, signal;
  const p = page(async (_url, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); }, {
    hash: `#ticket=${packet}&notification=${notification}`,
  });
  await tick();
  p.events.get("pagehide")(); await tick();
  assert.equal(signal?.aborted, true);
  p.events.get("pageshow")();
  resolve(response({ destination: `/admin/messages#notification=${notification}` })); await tick();
  assert.deepEqual(p.navigations, []);
  assert.equal(p.element("transition-start").disabled, false);
  assert.equal(p.timers.size, 0);
});
