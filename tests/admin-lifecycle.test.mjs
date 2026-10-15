import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/admin-login.js", import.meta.url), "utf8");
const initialTime = 1750000000000;
const pause = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const session = (name = "Jess", changes = {}) => ({ user: { id: "1".repeat(32), role: "admin", pseudonym: name }, csrf: "A".repeat(43), expiresAt: initialTime + 28800000, ...changes });
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const flush = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName; this.value = ""; this.defaultValue = ""; this.textContent = ""; this.hidden = false;
    this.disabled = false; this.checked = false; this.required = false; this.children = []; this.dataset = {}; this.events = new Map(); this.attributes = new Map();
    const classes = new Set();
    this.classList = { add: (value) => classes.add(value), remove: (value) => classes.delete(value), contains: (value) => classes.has(value),
      toggle: (value, enabled) => { const include = enabled ?? !classes.has(value); if (include) classes.add(value); else classes.delete(value); return include; } };
  }
  addEventListener(name, handler) { this.events.set(name, handler); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  querySelectorAll(selector) { return this.children.flatMap((child) => [selector === child.tagName ? child : null, ...child.querySelectorAll(selector)]).filter(Boolean); }
  reset() { for (const field of this.querySelectorAll("input")) { field.value = field.defaultValue; field.checked = false; } }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}

function harness({ visible = true, currentSession = session(), intercept, clipboard } = {}) {
  const nodes = new Map(), documentEvents = new Map(), windowEvents = new Map(), calls = [], timers = new Map(), history = [];
  let now = initialTime, timerId = 0;
  const element = (id, tagName = "div") => { if (!nodes.has(id)) nodes.set(id, new Element(tagName)); return nodes.get(id); };
  const form = element("login-form", "form"), tools = element("access-tools"), connected = element("connected");
  const email = element("email", "input"), password = element("password", "input"), factor = element("factor", "input");
  form.append(email, password, factor, element("login-button", "button")); form.hidden = true; connected.hidden = true; tools.hidden = true;
  const invitationForm = element("invitation-form", "form"), createButton = new Element("button");
  const hours = element("invitation-hours", "input"), days = element("invitation-days", "input"), unlimited = element("invitation-unlimited", "input");
  hours.value = hours.defaultValue = "72"; days.value = days.defaultValue = "30";
  invitationForm.append(hours, days, unlimited, createButton);
  tools.append(invitationForm, element("copy-invitation", "button"), element("refresh-access", "button"), element("clients-list"), element("invitations-list"));
  connected.append(tools, element("logout-button", "button"), element("logout-all-button", "button"));
  const document = { visibilityState: visible ? "visible" : "hidden", body: new Element("body"), getElementById: element,
    createElement: (tagName) => new Element(tagName), addEventListener: (name, handler) => documentEvents.set(name, handler) };
  const state = { currentSession, clipboardCalls: [] };
  const context = vm.createContext({ document, window: { addEventListener: (name, handler) => windowEvents.set(name, handler) },
    location: { pathname: "/admin" }, history: { replaceState: (...args) => history.push(args) }, AbortController,
    navigator: { clipboard: { writeText: async (value) => { state.clipboardCalls.push(value); if (clipboard) return clipboard(value); } } },
    Date: class extends Date { static now() { return now; } },
    setTimeout: (handler, delay) => { const id = ++timerId; timers.set(id, { handler, at: now + delay }); return id; }, clearTimeout: (id) => timers.delete(id),
    fetch: async (path, options) => {
      const call = { path, options }; calls.push(call);
      // Deliberately allow intercepted responses to settle despite abort: a
      // controller must guard its generation as well as asking fetch to abort.
      const intercepted = intercept?.(path, options, calls);
      if (intercepted !== undefined) return await intercepted;
      if (path === "/api/auth/session") return response(state.currentSession ? 200 : 401, state.currentSession ?? { error: "authentication_required" });
      if (path === "/api/admin/access") return response(200, { capabilities: {} });
      if (path === "/api/chat/admin/capabilities") return response(200, { enabled: true });
      if (path === "/api/admin/invitations" && options.method === "POST") return response(201, { url: `https://example.invalid/access#invitation=${"B".repeat(43)}` });
      if (path === "/api/admin/invitations") return response(200, { invitations: [{ id: "2".repeat(32), createdAt: initialTime, expiresAt: initialTime + 3600000,
        accessDays: 30, state: "pending" }] });
      if (path === "/api/admin/clients") return response(200, { clients: [{ id: "3".repeat(32), pseudonym: "Client synthétique", email: "private-client@example.invalid",
        status: "active", emailVerified: true, ageAssured: true, accessExpiresAt: null }] });
      if (path.startsWith("/api/auth/logout")) return response(200, { status: "signed_out" });
      throw new Error(`Unexpected request: ${path}`);
    } });
  vm.runInContext(source, context, { filename: "public/admin-login.js" });
  return { element, document, calls, state, timers, createButton, history,
    async event(name, value = {}) { const handler = documentEvents.get(name) ?? windowEvents.get(name); assert.equal(typeof handler, "function", name); handler(value); await flush(); },
    async hide() { document.visibilityState = "hidden"; await this.event("visibilitychange"); },
    async show() { document.visibilityState = "visible"; await this.event("visibilitychange"); },
    async click(id) { const handler = element(id).events.get("click"); assert.equal(typeof handler, "function", id); handler({ preventDefault() {} }); await flush(); },
    async submit(id) { const handler = element(id).events.get("submit"); assert.equal(typeof handler, "function", id); handler({ preventDefault() {} }); await flush(); },
    async advance(milliseconds) { const target = now + milliseconds;
      while (true) { const next = [...timers].filter(([, timer]) => timer.at <= target).sort((left, right) => left[1].at - right[1].at)[0]; if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].handler(); await flush(); }
      now = target; await flush(); },
  };
}
const contents = (node) => [node.value, node.textContent, ...node.children.map(contents)].join(" ");
const posts = (f) => f.calls.filter((call) => call.options.method === "POST");
function privateCleared(f) {
  for (const id of ["connected", "access-tools", "admin-chat-link", "new-invitation"]) assert.equal(f.element(id).hidden, true, id);
  assert.equal(f.element("connected-name").textContent, ""); assert.equal(f.element("invitation-link").value, "");
  assert.equal(f.element("clients-list").children.length, 0); assert.equal(f.element("invitations-list").children.length, 0);
  for (const id of ["email", "password", "factor"]) assert.equal(f.element(id).value, "", id);
}

test("initially hidden administrator page clears anonymous credentials and does no request until visible", async () => {
  const f = harness({ visible: false });
  privateCleared(f); assert.equal(f.calls.length, 0); assert.equal(f.element("login-form").hidden, true);
  await f.show(); assert.equal(f.calls.filter((call) => call.path === "/api/auth/session").length, 3);
  assert.equal(f.element("connected-name").textContent, "Jess");
});

test("initial visibility and pageshow notifications share one administrator bootstrap", async () => {
  const gate = pause(), f = harness({ intercept: (path) => path === "/api/auth/session" ? gate.promise : undefined });
  await f.event("pageshow", { persisted: false }); await f.event("visibilitychange");
  assert.equal(f.calls.length, 1); assert.equal(f.element("connected").hidden, true);
  gate.resolve(response(200, session())); await flush();
  assert.equal(f.element("access-tools").hidden, false); assert.equal(f.calls.filter((call) => call.path === "/api/admin/clients").length, 1);
});

test("visibility hide and pagehide erase administrator identity, clients, invitation secret and credentials", async () => {
  for (const event of ["visibilitychange", "pagehide"]) {
    const f = harness(); await flush(); await f.submit("invitation-form");
    assert.match(f.element("invitation-link").value, /#invitation=/); assert.match(contents(f.element("clients-list")), /private-client@example.invalid/);
    f.element("email").value = "private-admin@example.invalid"; f.element("password").value = "synthetic-private-password"; f.element("factor").value = "123456";
    if (event === "visibilitychange") f.document.visibilityState = "hidden";
    await f.event(event); privateCleared(f); assert.equal(f.element("login-form").hidden, true);
  }
});

test("late client-list and capability responses cannot repopulate an administrator page after hide", async () => {
  const clients = pause(), capability = pause(), f = harness({ intercept: (path) => path === "/api/admin/clients" ? clients.promise : path === "/api/chat/admin/capabilities" ? capability.promise : undefined });
  await flush(); const active = f.calls.filter((call) => ["/api/admin/clients", "/api/chat/admin/capabilities"].includes(call.path));
  await f.hide(); assert.ok(active.every((call) => call.options.signal.aborted));
  clients.resolve(response(200, { clients: [{ pseudonym: "Late private", email: "late-private@example.invalid", status: "active", emailVerified: true, ageAssured: true, accessExpiresAt: null }] }));
  capability.resolve(response(200, { enabled: true })); await flush(); privateCleared(f);
});

test("return validates a fresh administrator session before loading any new private data and ignores the old list", async () => {
  const oldClients = pause(), newSession = pause(); let clientCalls = 0, sessionCalls = 0, waitingForReturn = false;
  const f = harness({ intercept: (path) => {
    if (path === "/api/admin/clients" && ++clientCalls === 1) return oldClients.promise;
    if (path === "/api/auth/session") { sessionCalls += 1; if (waitingForReturn) return newSession.promise; }
    return undefined;
  } });
  await flush(); const beforeReturn = sessionCalls; await f.hide(); waitingForReturn = true; await f.show(); await f.event("pageshow", { persisted: true });
  privateCleared(f); assert.equal(clientCalls, 1); assert.equal(sessionCalls, beforeReturn + 1);
  oldClients.resolve(response(200, { clients: [] })); await flush(); privateCleared(f);
  waitingForReturn = false; f.state.currentSession = session("Jess actuelle"); newSession.resolve(response(200, f.state.currentSession)); await flush();
  assert.equal(f.element("connected-name").textContent, "Jess actuelle"); assert.equal(clientCalls, 2);
  assert.match(contents(f.element("clients-list")), /private-client@example.invalid/); assert.equal(posts(f).length, 0);
});

test("an old login response and its finally cannot replace a fresh view or unlock a newer login", async () => {
  const oldLogin = pause(), newLogin = pause(); let loginCalls = 0;
  const f = harness({ currentSession: null, intercept: (path) => path === "/api/auth/login" ? (++loginCalls === 1 ? oldLogin.promise : newLogin.promise) : undefined });
  await flush(); f.element("email").value = "admin@example.invalid"; f.element("password").value = "synthetic-password"; f.element("factor").value = "123456";
  await f.submit("login-form"); await f.hide(); await f.show();
  assert.equal(f.element("login-form").hidden, false); privateCleared(f);
  f.element("email").value = "new@example.invalid"; f.element("password").value = "new-synthetic-password"; f.element("factor").value = "654321";
  await f.submit("login-form"); assert.equal(f.element("login-button").disabled, true);
  oldLogin.resolve(response(200, session("Ancienne réponse"))); await flush();
  assert.equal(f.element("login-button").disabled, true); assert.equal(f.element("connected-name").textContent, "");
  f.state.currentSession = session("Connexion actuelle"); newLogin.resolve(response(200, f.state.currentSession)); await flush();
  assert.equal(f.element("connected-name").textContent, "Connexion actuelle"); assert.equal(f.element("login-button").disabled, false);
  assert.equal(loginCalls, 2); assert.equal(posts(f).length, 2);
});

test("a hidden pending logout is not replayed and its old finally cannot unlock a new invitation action", async () => {
  const logout = pause(), create = pause(), f = harness({ intercept: (path, options) => path === "/api/auth/logout" ? logout.promise : path === "/api/admin/invitations" && options.method === "POST" ? create.promise : undefined });
  await flush(); await f.click("logout-button"); await f.hide(); await f.show();
  await f.submit("invitation-form"); assert.equal(f.createButton.disabled, true);
  logout.resolve(response(200, { status: "signed_out" })); await flush(); assert.equal(f.createButton.disabled, true);
  assert.equal(f.element("connected-name").textContent, "Jess");
  create.resolve(response(201, { url: `https://example.invalid/access#invitation=${"C".repeat(43)}` })); await flush();
  assert.equal(f.createButton.disabled, false); assert.equal(posts(f).filter((call) => call.path === "/api/auth/logout").length, 1);
});

test("a late clipboard result and finally cannot affect the new visible administrator action", async () => {
  const copy = pause(), create = pause(); let creates = 0;
  const f = harness({ clipboard: () => copy.promise, intercept: (path, options) => path === "/api/admin/invitations" && options.method === "POST" && ++creates === 2 ? create.promise : undefined });
  await flush(); await f.submit("invitation-form"); await f.click("copy-invitation"); await f.hide(); await f.show();
  await f.submit("invitation-form"); assert.equal(f.createButton.disabled, true);
  copy.resolve(); await flush(); assert.equal(f.createButton.disabled, true); assert.notEqual(f.element("auth-status").textContent, "Le lien est copié.");
  create.resolve(response(201, { url: `https://example.invalid/access#invitation=${"D".repeat(43)}` })); await flush();
  assert.equal(f.createButton.disabled, false); assert.equal(f.state.clipboardCalls.length, 1);
});

test("late invitation creation stays hidden and resuming performs GET validation without replaying its POST", async () => {
  const create = pause(), f = harness({ intercept: (path, options) => path === "/api/admin/invitations" && options.method === "POST" ? create.promise : undefined });
  await flush(); await f.submit("invitation-form"); await f.hide();
  create.resolve(response(201, { url: `https://example.invalid/access#invitation=${"E".repeat(43)}` })); await flush(); privateCleared(f);
  await f.show(); assert.equal(posts(f).length, 1); assert.equal(f.element("invitation-link").value, "");
  assert.equal(f.element("connected-name").textContent, "Jess");
});

test("session expiry retains its original deadline while hidden and expired responses reveal no identity", async () => {
  const f = harness({ currentSession: session("Jess courte", { expiresAt: initialTime + 1000 }) }); await flush();
  await f.advance(400); await f.hide(); assert.ok([...f.timers.values()].some((timer) => timer.at === initialTime + 1000));
  await f.advance(600); privateCleared(f); assert.match(f.element("auth-status").textContent, /expiré/);
  await f.show(); privateCleared(f); assert.equal(f.element("login-form").hidden, false);
  assert.equal(posts(f).length, 0);
});

test("pagehide and duplicate return events trigger exactly one fresh session and no protected actions while hidden", async () => {
  const f = harness(); await flush(); const before = f.calls.length;
  await f.event("pagehide", { persisted: true }); privateCleared(f);
  await f.click("logout-all-button"); await f.submit("invitation-form"); await f.submit("login-form"); assert.equal(f.calls.length, before);
  await f.event("pageshow", { persisted: true }); await f.event("visibilitychange");
  assert.equal(f.calls.slice(before).filter((call) => call.path === "/api/auth/session").length, 3);
  assert.equal(f.element("access-tools").hidden, false); assert.equal(posts(f).length, 0);
});

test("administrator request security options remain intact for login and authenticated actions", async () => {
  const f = harness(); await flush(); await f.submit("invitation-form"); await f.click("logout-all-button");
  const create = posts(f).find((call) => call.path === "/api/admin/invitations");
  assert.equal(create.options.headers["X-CSRF-Token"], session().csrf); assert.equal(create.options.headers["Content-Type"], "application/json");
  assert.equal(create.options.credentials, "same-origin"); assert.equal(create.options.cache, "no-store"); assert.ok(create.options.signal instanceof AbortSignal);
  assert.equal(f.element("connected").hidden, true); assert.equal(f.element("invitation-link").value, "");
});

test("cookie actor changes during private reads discard the old audience before rebuilding from GET proof", async () => {
  for (const change of ["user", "csrf"]) {
    const oldClients = pause(); let clientCalls = 0;
    const f = harness({ intercept: (path) => path === "/api/admin/clients" && ++clientCalls === 1 ? oldClients.promise : undefined });
    await flush();
    f.state.currentSession = session("Session actuelle", change === "user"
      ? { user: { id: "9".repeat(32), role: "admin", pseudonym: "Session actuelle" } }
      : { csrf: "F".repeat(43) });
    oldClients.resolve(response(200, { clients: [{ id: "8".repeat(32), pseudonym: "Ancien public", email: "old-audience@example.invalid",
      status: "active", emailVerified: true, ageAssured: true, accessExpiresAt: null }] }));
    await flush();
    assert.equal(f.element("connected-name").textContent, "Session actuelle");
    assert.equal(contents(f.element("clients-list")).includes("old-audience@example.invalid"), false);
    assert.match(contents(f.element("clients-list")), /private-client@example.invalid/);
    assert.equal(clientCalls, 2); assert.equal(posts(f).length, 0);
  }
});

test("a failed final GET proof after committed invitation creation remains an unconfirmed operation and is never retried", async () => {
  for (const status of [400, 409, 503]) {
    let proofFailure = false;
    const f = harness({ intercept: (path, options) => {
      if (path === "/api/admin/invitations" && options.method === "POST") {
        proofFailure = true;
        return response(201, { url: `https://example.invalid/access#invitation=${"G".repeat(43)}` });
      }
      if (path === "/api/auth/session" && proofFailure) { proofFailure = false; return response(status, { error: "synthetic_get_failure" }); }
      return undefined;
    } });
    await flush(); await f.submit("invitation-form");
    assert.equal(posts(f).length, 1); assert.equal(f.element("invitation-link").value, ""); assert.equal(f.element("new-invitation").hidden, true);
    assert.equal(f.element("connected-name").textContent, "Jess"); assert.equal(f.element("access-tools").hidden, false);
    assert.match(f.element("auth-status").textContent, /résultat.*pas pu être confirmé/);
    assert.doesNotMatch(f.element("auth-status").textContent, /informations|majorité|code de sécurité/);
  }
});

test("an old proof rejected after hide and return cannot clear the newly validated administrator view", async () => {
  const oldProof = pause(); let gateProof = false;
  const f = harness({ intercept: (path, options) => {
    if (path === "/api/admin/invitations" && options.method === "POST") { gateProof = true; return response(201, { url: "https://example.invalid/access#invitation=old" }); }
    if (path === "/api/auth/session" && gateProof) return oldProof.promise;
    return undefined;
  } });
  await flush(); await f.submit("invitation-form"); assert.equal(f.createButton.disabled, true);
  await f.hide(); gateProof = false; f.state.currentSession = session("Retour actuel", { csrf: "H".repeat(43) }); await f.show();
  assert.equal(f.element("connected-name").textContent, "Retour actuel"); assert.equal(f.element("access-tools").hidden, false);
  oldProof.resolve(response(409, { error: "old-proof-error" })); await flush();
  assert.equal(f.element("connected-name").textContent, "Retour actuel"); assert.equal(f.element("access-tools").hidden, false);
  assert.equal(f.element("invitation-link").value, ""); assert.equal(posts(f).length, 1);
  assert.doesNotMatch(f.element("auth-status").textContent, /confirmé|refusée/);
});

test("clipboard copying requires a current matching session and never copies a previous actor's invitation", async () => {
  const f = harness(); await flush(); await f.submit("invitation-form"); assert.match(f.element("invitation-link").value, /#invitation=/);
  f.state.currentSession = session("Nouvelle session", { csrf: "I".repeat(43) });
  await f.click("copy-invitation");
  assert.equal(f.state.clipboardCalls.length, 0); assert.equal(f.element("invitation-link").value, "");
  assert.equal(f.element("connected-name").textContent, "Nouvelle session"); assert.equal(posts(f).length, 1);
});

test("repeated final proof failures permit only one GET recovery per visible intent", async () => {
  let sessions = 0;
  const f = harness({ intercept: (path) => {
    if (path === "/api/chat/admin/capabilities") return response(404, { error: "not_found" });
    if (path === "/api/auth/session") {
      sessions += 1;
      // The cap also makes this regression terminate safely on a broken loop.
      if (sessions > 8) return response(503, { error: "test_stop" });
      return sessions % 2 === 1 ? response(200, session()) : response(503, { error: "proof_unavailable" });
    }
    return undefined;
  } });
  await flush();
  assert.equal(sessions, 4); assert.equal(f.calls.filter((call) => call.path === "/api/admin/clients").length, 2);
  privateCleared(f); assert.equal(f.element("login-form").hidden, false); assert.match(f.element("auth-status").textContent, /Recharge la page/);
  assert.equal(posts(f).length, 0);
});
