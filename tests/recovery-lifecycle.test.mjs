import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import * as recoveryModel from "../public/recover-model.js";

const capabilityPath = "/api/access/recovery/capabilities";
const capability = () => ({ enabled: true, password: { minLength: 8, maxLength: 128 } });
const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const malformed = (status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => { throw new SyntaxError("synthetic malformed JSON"); } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

class Classes {
  values = new Set();
  add(...values) { for (const value of values) this.values.add(value); }
  remove(...values) { for (const value of values) this.values.delete(value); }
  toggle(value, force = !this.values.has(value)) { if (force) this.values.add(value); else this.values.delete(value); return force; }
  contains(value) { return this.values.has(value); }
}
class Node extends EventTarget {
  constructor(document, tagName, attrs = {}) {
    super(); this.ownerDocument = document; this.tagName = tagName; this.children = []; this.parentElement = null;
    this.attributes = new Map(Object.entries(attrs)); this.id = attrs.id ?? ""; this.type = attrs.type ?? "";
    this.hidden = Object.hasOwn(attrs, "hidden"); this.disabled = Object.hasOwn(attrs, "disabled"); this.readOnly = false;
    this.defaultValue = attrs.value ?? ""; this.value = this.defaultValue; this.defaultChecked = Object.hasOwn(attrs, "checked"); this.checked = this.defaultChecked;
    this.classList = new Classes(); this.textContent = ""; this.dataset = {}; this.style = {};
  }
  append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
  replaceChildren(...items) { for (const item of this.children) item.parentElement = null; this.children = []; this.append(...items); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((item) => item !== this); this.parentElement = null; }
  reset() { for (const item of this.descendants()) if (["input", "textarea", "select"].includes(item.tagName)) { item.value = item.defaultValue; item.checked = item.defaultChecked; } }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector) { return this.ownerDocument.match(this.descendants(), selector); }
  get isConnected() { return this === this.ownerDocument.root || !!this.parentElement?.isConnected; }
}
class Document extends EventTarget {
  constructor(html, visibility = "visible") {
    super(); this.visibilityState = visibility; this.root = new Node(this, "document"); this.activeElement = null; const stack = [this.root];
    const voids = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
    for (const match of html.matchAll(/<(\/?)([a-z][\w:-]*)([^>]*)>/gi)) {
      const [, closing, tagName, rawAttrs] = match; const tag = tagName.toLowerCase();
      if (closing) { while (stack.length > 1 && stack.at(-1).tagName !== tag) stack.pop(); if (stack.length > 1) stack.pop(); continue; }
      const attrs = {};
      for (const attr of rawAttrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[attr[1]] = attr[2] ?? attr[3] ?? attr[4] ?? "";
      const element = new Node(this, tag, attrs); stack.at(-1).append(element); if (tag === "body") this.body = element;
      if (!voids.has(tag) && !rawAttrs.endsWith("/")) stack.push(element);
    }
  }
  createElement(tag) { return new Node(this, tag); }
  getElementById(id) { return this.root.descendants().find((element) => element.id === id) ?? null; }
  match(elements, selector) {
    const match = /^(?:(form) )?(\w+)(?:\[type=["']([^"']+)["']\])?$/.exec(selector);
    assert.ok(match, `unsupported synthetic selector: ${selector}`);
    return elements.filter((element) => element.tagName === match[2] && (!match[3] || element.type === match[3]) && (!match[1] || this.inForm(element)));
  }
  inForm(element) { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "form") return true; return false; }
  querySelectorAll(selector) { return this.match(this.root.descendants(), selector); }
}
function controller(name, fetchHandler, { hash = "", visibility = "visible" } = {}) {
  const html = readFileSync(new URL(`../public/${name}.html`, import.meta.url), "utf8");
  const document = new Document(html, visibility); const window = new EventTarget(); const calls = []; const timers = new Map(); let timerId = 0;
  const location = { hash, pathname: `/${name}` }; const history = { replaceState(_state, _unused, path) { location.hash = ""; location.pathname = path; } };
  const context = createContext({ document, window, location, history, URLSearchParams, TextEncoder, AbortController, Event,
    __recoveryModel: recoveryModel,
    setTimeout(callback, milliseconds) { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(path, options = {}) { calls.push({ path, options }); return Promise.resolve().then(() => fetchHandler(path, options, calls)); } });
  new Script(readFileSync(new URL("../public/session-clock.js", import.meta.url), "utf8"), { filename: "public/session-clock.js" }).runInContext(context);
  let source = readFileSync(new URL(`../public/${name}.js`, import.meta.url), "utf8");
  if (name === "recover") source = source.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*"\/recover-model\.js";/, "const {$1} = __recoveryModel;");
  new Script(source, { filename: `public/${name}.js`, importModuleDynamically: async () => { throw new Error("optional feature unavailable in fixture"); } }).runInContext(context);
  return { document, window, calls, timers, context, get: (id) => document.getElementById(id),
    click(id) { document.getElementById(id).dispatchEvent(new Event("click")); },
    submit(id) { document.getElementById(id).dispatchEvent(new Event("submit", { cancelable: true })); },
    visibility(value) { document.visibilityState = value; document.dispatchEvent(new Event("visibilitychange")); },
    postCount() { return calls.filter((call) => call.options.method === "POST").length; },
    capabilityCount() { return calls.filter((call) => call.path === capabilityPath).length; },
    dispose() { window.dispatchEvent(new Event("pagehide")); } };
}
const signedOut = () => response({ error: "authentication_required" }, 401);
const user = (pseudonym = "Client fictif", { id = "a".repeat(32), csrf = "A".repeat(43) } = {}) => ({ user: { id, role: "client", pseudonym }, csrf, expiresAt: Date.now() + 3600000,
  access: { state: "pending", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: false, ageAssured: false, approved: false, expiresAt: null } });

for (const [label, failure] of [["503", () => response({}, 503)], ["429", () => response({}, 429)], ["network failure", () => Promise.reject(new Error("synthetic network failure"))],
  ["malformed JSON", () => malformed()], ["malformed capability", () => response({ enabled: true, password: { minLength: 1, maxLength: 128 } })]]) {
  test(`recovery capability ${label} allows one explicit GET retry without repeating a POST`, async () => {
    let attempt = 0; const f = controller("recover", () => ++attempt === 1 ? failure() : response(capability()));
    try {
      await flush(); assert.equal(f.capabilityCount(), 1); assert.equal(f.get("recovery-request-form").hidden, true); assert.equal(f.get("recovery-retry-capability").hidden, false);
      await flush(); assert.equal(f.capabilityCount(), 1, "a failure does not create an automatic retry loop");
      f.click("recovery-retry-capability"); await flush(); assert.equal(f.capabilityCount(), 2); assert.equal(f.get("recovery-request-form").hidden, false);
      assert.equal(f.get("recovery-retry-capability").hidden, true); assert.equal(f.postCount(), 0);
    } finally { f.dispose(); }
  });
}

test("recovery 404 is disabled for this page even if its body is not JSON", async () => {
  const f = controller("recover", () => malformed(404));
  try {
    await flush(); assert.equal(f.get("recovery-retry-capability").hidden, true); f.click("recovery-retry-capability"); f.visibility("hidden"); f.visibility("visible"); await flush();
    assert.equal(f.capabilityCount(), 1); assert.equal(f.get("recovery-request-form").hidden, true); assert.equal(f.postCount(), 0);
  } finally { f.dispose(); }
});
test("returning to a recovery page retries a transient capability once", async () => {
  let attempt = 0; const f = controller("recover", () => ++attempt === 1 ? response({}, 503) : response(capability()));
  try { await flush(); f.visibility("hidden"); f.visibility("visible"); await flush(); assert.equal(f.capabilityCount(), 2); assert.equal(f.get("recovery-request-form").hidden, false); assert.equal(f.postCount(), 0); }
  finally { f.dispose(); }
});
test("an old recovery capability completion cannot disable or unlock a newer in-flight check", async () => {
  const first = deferred(), second = deferred(); let attempt = 0; const f = controller("recover", () => ++attempt === 1 ? first.promise : second.promise);
  try {
    await flush(); f.visibility("hidden"); assert.equal(f.calls[0].options.signal.aborted, true); f.visibility("visible"); await flush(); assert.equal(f.capabilityCount(), 2);
    first.resolve(response({}, 404)); await flush(); f.click("recovery-retry-capability"); await flush(); assert.equal(f.capabilityCount(), 2, "old finally cannot release the new loading guard");
    second.resolve(response(capability())); await flush(); assert.equal(f.get("recovery-request-form").hidden, false); assert.equal(f.timers.size, 0);
  } finally { f.dispose(); }
});
test("a recovery capability JSON result resolving after hide cannot replace the returned page state", async () => {
  const firstJson = deferred(); let attempt = 0; const f = controller("recover", () => ++attempt === 1 ? { ok: true, status: 200, json: () => firstJson.promise } : response(capability()));
  try {
    await flush(); f.visibility("hidden"); f.visibility("visible"); await flush(); firstJson.resolve({ enabled: false }); await flush();
    assert.equal(f.get("recovery-request-form").hidden, false); assert.equal(f.capabilityCount(), 2); assert.equal(f.get("recovery-retry-capability").hidden, true);
  } finally { f.dispose(); }
});
test("a failed recovery request POST is never automatically retried by visibility or capability actions", async () => {
  const f = controller("recover", (path) => path === capabilityPath ? response(capability()) : response({}, 503));
  try {
    await flush(); f.get("recovery-email").value = "synthetic@example.invalid"; f.submit("recovery-request-form"); await flush(); assert.equal(f.postCount(), 1);
    f.visibility("hidden"); f.visibility("visible"); f.click("recovery-retry-capability"); await flush(); assert.equal(f.postCount(), 1); assert.equal(f.capabilityCount(), 1);
    f.submit("recovery-request-form"); await flush(); assert.equal(f.postCount(), 2, "another POST requires another explicit submit");
  } finally { f.dispose(); }
});
test("an interrupted older reset cannot clear a new password or release the new submit button", async () => {
  const first = deferred(), second = deferred(); let posts = 0;
  const f = controller("recover", (path) => path === capabilityPath ? response(capability()) : ++posts === 1 ? first.promise : second.promise, { hash: `#reset=${"A".repeat(43)}` });
  try {
    await flush(); f.get("recovery-password").value = "First synthetic password"; f.get("recovery-confirmation").value = "First synthetic password"; f.submit("recovery-reset-form"); await flush();
    f.visibility("hidden"); f.visibility("visible"); f.get("recovery-password").value = "Second synthetic password"; f.get("recovery-confirmation").value = "Second synthetic password"; f.submit("recovery-reset-form"); await flush();
    first.resolve(response({ status: "password_changed" })); await flush(); assert.equal(f.get("recovery-password").value, "Second synthetic password");
    assert.equal(f.get("recovery-reset-form").querySelectorAll('button[type="submit"]')[0].disabled, true); assert.equal(f.get("recovery-reset-form").hidden, false); assert.equal(f.postCount(), 2);
    second.resolve(response({}, 503)); await flush(); assert.equal(f.get("recovery-password").value, ""); assert.equal(f.get("recovery-reset-form").querySelectorAll('button[type="submit"]')[0].disabled, false);
  } finally { f.dispose(); }
});

for (const [label, failure] of [["503", () => response({}, 503)], ["429", () => response({}, 429)], ["network failure", () => Promise.reject(new Error("synthetic network failure"))],
  ["malformed JSON", () => malformed()], ["malformed capability", () => response({ enabled: true })]]) {
  test(`access recovery link returns after capability ${label} and an explicit retry`, async () => {
    let attempt = 0; const f = controller("access", (path) => path === "/api/access/session" ? signedOut() : ++attempt === 1 ? failure() : response(capability()));
    try {
      await flush(); assert.equal(f.capabilityCount(), 1); assert.equal(f.get("client-recovery-link").hidden, true); assert.equal(f.get("client-recovery-retry").hidden, false);
      await flush(); assert.equal(f.capabilityCount(), 1); f.click("client-recovery-retry"); await flush();
      assert.equal(f.capabilityCount(), 2); assert.equal(f.get("client-recovery-link").hidden, false); assert.equal(f.get("client-recovery-retry").hidden, true); assert.equal(f.postCount(), 0);
    } finally { f.dispose(); }
  });
}
test("access recovery link returns on visibility after a temporary failure", async () => {
  let attempt = 0; const f = controller("access", (path) => path === "/api/access/session" ? signedOut() : ++attempt === 1 ? response({}, 503) : response(capability()));
  try { await flush(); f.visibility("hidden"); f.visibility("visible"); await flush(); assert.equal(f.capabilityCount(), 2); assert.equal(f.get("client-recovery-link").hidden, false); assert.equal(f.postCount(), 0); }
  finally { f.dispose(); }
});
test("access 404 capability is the only permanent disabled result and does not loop", async () => {
  const f = controller("access", (path) => path === "/api/access/session" ? signedOut() : malformed(404));
  try {
    await flush(); assert.equal(f.capabilityCount(), 1); f.click("client-recovery-retry"); f.visibility("hidden"); f.visibility("visible"); await flush();
    assert.equal(f.capabilityCount(), 1); assert.equal(f.get("client-recovery-link").hidden, true); assert.equal(f.get("client-recovery-retry").hidden, true); assert.equal(f.postCount(), 0);
  } finally { f.dispose(); }
});
test("old access capability finally cannot release a new check after hide and return", async () => {
  const first = deferred(), second = deferred(); let attempt = 0;
  const f = controller("access", (path) => path === "/api/access/session" ? signedOut() : ++attempt === 1 ? first.promise : second.promise);
  try {
    await flush(); const old = f.calls.find((call) => call.path === capabilityPath); f.visibility("hidden"); assert.equal(old.options.signal.aborted, true); f.visibility("visible"); await flush(); assert.equal(f.capabilityCount(), 2);
    first.resolve(response({}, 404)); await flush(); f.click("client-recovery-retry"); await flush(); assert.equal(f.capabilityCount(), 2);
    second.resolve(response(capability())); await flush(); assert.equal(f.get("client-recovery-link").hidden, false); assert.equal(f.timers.size, 0);
  } finally { f.dispose(); }
});
test("old access login POST cannot clear a new password, release its buttons or switch its account", async () => {
  const first = deferred(), second = deferred(); let posts = 0; let proofReady = false;
  const newUser = () => user("Nouveau compte", { id: "b".repeat(32), csrf: "E".repeat(43) });
  const f = controller("access", (path) => path === "/api/access/session" ? proofReady ? response(newUser()) : signedOut() : path === capabilityPath ? response(capability()) : ++posts === 1 ? first.promise : second.promise);
  try {
    await flush(); f.get("login-email").value = "first@example.invalid"; f.get("login-password").value = "First synthetic password"; f.submit("client-login-form"); await flush();
    f.visibility("hidden"); f.visibility("visible"); await flush(); assert.equal(f.get("client-login-form").querySelectorAll('button[type="submit"]')[0].disabled, false, "resume releases controls from the abandoned action");
    f.get("login-email").value = "second@example.invalid"; f.get("login-password").value = "Second synthetic password"; f.submit("client-login-form"); await flush();
    first.resolve(response(user("Ancien compte"))); await flush(); assert.equal(f.get("login-password").value, "Second synthetic password");
    assert.equal(f.get("client-login-form").querySelectorAll('button[type="submit"]')[0].disabled, true); assert.equal(f.get("client-name").textContent, "");
    proofReady = true; second.resolve(response(newUser())); await flush(); assert.equal(f.get("client-name").textContent, "Nouveau compte"); assert.equal(f.get("client-logout").disabled, false); assert.equal(f.postCount(), 2);
  } finally { f.dispose(); }
});
test("access does not repeat an interrupted login POST when the session GET confirms a connected client", async () => {
  const login = deferred(); let sessions = 0;
  const f = controller("access", (path) => path === "/api/access/session" ? ++sessions === 1 ? signedOut() : response(user("Compte actuel", { id: "b".repeat(32), csrf: "E".repeat(43) })) : path === capabilityPath ? response(capability()) : login.promise);
  try {
    await flush(); f.get("login-password").value = "Synthetic password value"; f.submit("client-login-form"); await flush(); f.visibility("hidden"); f.visibility("visible"); await flush();
    assert.equal(f.get("client-name").textContent, "Compte actuel"); assert.equal(f.get("client-logout").disabled, false); assert.equal(f.get("client-logout-all").disabled, false); assert.equal(f.postCount(), 1);
    login.resolve(response(user("Ancien résultat"))); await flush(); assert.equal(f.get("client-name").textContent, "Compte actuel"); assert.equal(f.get("client-logout").disabled, false);
  } finally { f.dispose(); }
});
test("a hidden access page defers its first GET and discards an old session after a newer account returns", async () => {
  const oldSession = deferred(); let sessions = 0;
  const f = controller("access", (path) => path === "/api/access/session" ? ++sessions === 1 ? oldSession.promise : response(user("Compte récent", { id: "b".repeat(32), csrf: "E".repeat(43) })) : response(capability()), { visibility: "hidden" });
  try {
    await flush(); assert.equal(f.calls.length, 0); f.visibility("visible"); await flush(); f.visibility("hidden"); f.visibility("visible"); await flush();
    assert.equal(f.get("client-name").textContent, "Compte récent"); oldSession.resolve(response(user("Ancien compte"))); await flush(); assert.equal(f.get("client-name").textContent, "Compte récent");
  } finally { f.dispose(); }
});

test("access login renders only the final GET owner when another account replaces the POST cookie", async () => {
  const proof = deferred(); let sessions = 0;
  const f = controller("access", (path) => path === "/api/access/session" ? ++sessions === 1 ? signedOut() : proof.promise : path === capabilityPath ? response(capability()) : response(user("Compte A")));
  try {
    await flush(); f.get("login-password").value = "Synthetic login password"; f.submit("client-login-form"); await flush();
    assert.equal(f.get("client-name").textContent, "", "the POST identity is never rendered before proof"); assert.equal(f.get("client-connected").hidden, true);
    proof.resolve(response(user("Compte B", { id: "b".repeat(32), csrf: "E".repeat(43) }))); await flush();
    assert.equal(f.get("client-name").textContent, "Compte B"); assert.match(f.get("access-status").textContent, /connexion a changé/); assert.equal(f.postCount(), 1); assert.equal(sessions, 2);
  } finally { f.dispose(); }
});
test("access login adopts a fresh CSRF proof for a newer login of the same account", async () => {
  let sessions = 0;
  const current = () => ({ ...user("Session actuelle", { csrf: "E".repeat(43) }), access: { ...user().access, state: "expired" } });
  const f = controller("access", (path) => path === "/api/access/session" ? ++sessions === 1 ? signedOut() : response(current()) : path === capabilityPath ? response(capability()) : path === "/api/access/login" ? response(user("Ancienne session")) : response({ status: "logged_out" }));
  try {
    await flush(); f.get("login-password").value = "Synthetic login password"; f.submit("client-login-form"); await flush();
    assert.equal(f.get("client-name").textContent, "Session actuelle"); assert.match(f.get("client-access-state").textContent, /arrivé à son terme/); assert.match(f.get("access-status").textContent, /connexion a changé/);
    f.click("client-logout"); await flush(); const logout = f.calls.find((call) => call.path === "/api/access/logout");
    assert.equal(logout.options.headers["X-CSRF-Token"], "E".repeat(43)); assert.equal(f.calls.filter((call) => call.path === "/api/access/login").length, 1);
  } finally { f.dispose(); }
});
test("a failed final session proof never renders the possibly applied login or automatically repeats its POST", async () => {
  let sessions = 0;
  const f = controller("access", (path) => path === "/api/access/session" ? ++sessions === 1 ? signedOut() : response({}, 503) : path === capabilityPath ? response(capability()) : response(user("Compte à ne pas afficher")));
  try {
    await flush(); f.get("login-password").value = "Synthetic login password"; f.submit("client-login-form"); await flush();
    assert.equal(f.get("client-name").textContent, ""); assert.equal(f.get("client-connected").hidden, true); assert.match(f.get("access-status").textContent, /connexion a peut-être abouti/);
    assert.equal(f.get("login-password").value, ""); assert.equal(f.postCount(), 1); await flush(); assert.equal(f.postCount(), 1);
    f.visibility("hidden"); f.visibility("visible"); await flush(); assert.equal(f.postCount(), 1); assert.equal(f.get("client-name").textContent, "");
  } finally { f.dispose(); }
});
