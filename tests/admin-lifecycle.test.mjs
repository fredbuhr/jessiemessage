import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/admin-login.js", import.meta.url), "utf8");
const initialTime = 1750000000000;
const pause = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const session = (name = "Jess", changes = {}) => ({ user: { id: "1".repeat(32), role: "admin", pseudonym: name }, csrf: "A".repeat(43), expiresAt: initialTime + 28800000, ...changes });
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => ({
  ...(Array.isArray(data?.clients) || Array.isArray(data?.invitations) ? { nextCursor: null, hasMore: false } : {}), ...data,
}) });
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

const clientRow = (index = 3, changes = {}) => ({ id: index.toString(16).padStart(32, "0"), pseudonym: `Client ${index}`, email: `client-${index}@example.invalid`,
  status: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, createdAt: initialTime - index, accessExpiresAt: initialTime + 86400000, ...changes });
const invitationRow = (index = 2) => ({ id: index.toString(16).padStart(32, "0"), createdAt: initialTime - index, expiresAt: initialTime + 3600000, accessDays: 30, state: "pending" });
function harness({ visible = true, currentSession = session(), intercept, clipboard,
  clients = [clientRow(3, { pseudonym: "Client synthétique", email: "private-client@example.invalid", accessExpiresAt: null })],
  invitations = [invitationRow(2)] } = {}) {
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
  for (const kind of ["invitations", "clients"]) {
    const navigation = element(`${kind}-pagination`);
    navigation.append(element(`${kind}-page-note`), element(`${kind}-next`, "button"), element(`${kind}-first`, "button"));
    tools.append(navigation);
  }
  connected.append(tools, element("logout-button", "button"), element("logout-all-button", "button"));
  const document = { visibilityState: visible ? "visible" : "hidden", body: new Element("body"), getElementById: element,
    createElement: (tagName) => new Element(tagName), addEventListener: (name, handler) => documentEvents.set(name, handler) };
  const state = { currentSession, clipboardCalls: [], clients, invitations };
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
      for (const kind of ["invitations", "clients"]) {
        if (!path.startsWith(`/api/admin/${kind}?`)) continue;
        const url = new URL(path, "https://example.invalid"), cursor = url.searchParams.get("cursor");
        const offset = cursor === null ? 0 : Number(cursor.slice(`${kind}_`.length));
        const rows = state[kind].slice(offset, offset + 50), hasMore = offset + rows.length < state[kind].length;
        return response(200, { [kind]: rows, hasMore, nextCursor: hasMore ? `${kind}_${offset + rows.length}` : null });
      }
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

const plainResponse = (status, body = "Not found") => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

test("plain 404 optional features preserve an authentication-only administrator session without an error banner", async (t) => {
  for (const initialSession of [true, false]) await t.test(initialSession ? "restored session" : "successful login", async () => {
    let f;
    f = harness({ currentSession: initialSession ? session() : null, intercept: (path) => {
      if (["/api/admin/access", "/api/chat/admin/capabilities"].includes(path)) return plainResponse(404);
      if (path === "/api/auth/login") { f.state.currentSession = session(); return response(200, f.state.currentSession); }
      return undefined;
    } });
    await flush();
    if (!initialSession) {
      f.element("email").value = "admin@example.invalid"; f.element("password").value = "synthetic-password"; f.element("factor").value = "123456";
      await f.submit("login-form");
    }
    assert.equal(f.element("connected").hidden, false); assert.equal(f.element("connected-name").textContent, "Jess");
    assert.equal(f.element("login-form").hidden, true); assert.equal(f.element("access-title").textContent, "Ton accès est prêt.");
    assert.equal(f.element("auth-status").textContent, ""); assert.equal(f.element("auth-status").classList.contains("is-error"), false);
    assert.equal(f.element("access-tools").hidden, true); assert.equal(f.element("admin-chat-link").hidden, true);
    assert.equal(f.calls.some((call) => /^\/api\/admin\/(?:clients|invitations)/.test(call.path)), false);
    for (const id of ["email", "password", "factor"]) assert.equal(f.element(id).value, "", id);
  });
});

test("plain 401 from an optional authenticated request clears the revoked session", async () => {
  const f = harness({ intercept: (path) => path === "/api/admin/access" ? plainResponse(401, "Unauthorized")
    : path === "/api/chat/admin/capabilities" ? plainResponse(404) : undefined });
  await flush();
  privateCleared(f); assert.equal(f.element("login-form").hidden, false);
  assert.equal(f.element("auth-status").textContent, "Ta session a expiré. Reconnecte-toi pour continuer.");
  await f.click("logout-button"); assert.equal(posts(f).length, 0);
});

test("plain 503 remains a visible service error rather than a disabled optional feature", async () => {
  const f = harness({ intercept: (path) => path === "/api/admin/access" ? plainResponse(503, "Unavailable")
    : path === "/api/chat/admin/capabilities" ? plainResponse(404) : undefined });
  await flush();
  assert.equal(f.element("connected").hidden, false); assert.equal(f.element("access-tools").hidden, true);
  assert.equal(f.element("auth-status").textContent, "La connexion est indisponible pour le moment. Réessaie dans quelques instants.");
  assert.equal(f.element("auth-status").classList.contains("is-error"), true);
});

test("a successful HTTP session response containing malformed JSON is still refused", async () => {
  const f = harness({ intercept: (path) => path === "/api/auth/session" ? plainResponse(200, "Not JSON") : undefined });
  await flush();
  privateCleared(f); assert.equal(f.element("login-form").hidden, false);
  assert.equal(f.element("auth-status").classList.contains("is-error"), true);
  assert.equal(f.calls.some((call) => call.path === "/api/admin/access" || call.path === "/api/chat/admin/capabilities"), false);
});

test("a late plain 404 body cannot clear a newer administrator's access after hide", async () => {
  let body, accessCalls = 0;
  const delayed = new Response(new ReadableStream({ start(controller) { body = controller; } }), {
    status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
  const f = harness({ intercept: (path) => path === "/api/admin/access" && ++accessCalls === 1 ? delayed
    : path === "/api/chat/admin/capabilities" ? plainResponse(404) : undefined });
  await flush(); const oldAccess = f.calls.find((call) => call.path === "/api/admin/access");
  await f.hide(); privateCleared(f); assert.equal(oldAccess.options.signal.aborted, true);
  f.state.currentSession = session("Nouvelle administratrice", { csrf: "B".repeat(43) }); await f.show();
  assert.equal(f.element("access-tools").hidden, false); const currentList = f.element("clients-list").children[0];
  body.enqueue(new TextEncoder().encode("Not found")); body.close(); await flush();
  assert.equal(f.element("connected-name").textContent, "Nouvelle administratrice");
  assert.equal(f.element("access-tools").hidden, false); assert.equal(f.element("clients-list").children[0], currentList);
  assert.equal(f.element("auth-status").textContent, ""); assert.equal(posts(f).length, 0);
});

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
  assert.equal(f.element("access-tools").hidden, false); assert.equal(f.calls.filter((call) => call.path === "/api/admin/clients?limit=50").length, 1);
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
  const clients = pause(), capability = pause(), f = harness({ intercept: (path) => path === "/api/admin/clients?limit=50" ? clients.promise : path === "/api/chat/admin/capabilities" ? capability.promise : undefined });
  await flush(); const active = f.calls.filter((call) => ["/api/admin/clients?limit=50", "/api/chat/admin/capabilities"].includes(call.path));
  await f.hide(); assert.ok(active.every((call) => call.options.signal.aborted));
  clients.resolve(response(200, { clients: [{ pseudonym: "Late private", email: "late-private@example.invalid", status: "active", emailVerified: true, ageAssured: true, accessExpiresAt: null }] }));
  capability.resolve(response(200, { enabled: true })); await flush(); privateCleared(f);
});

test("return validates a fresh administrator session before loading any new private data and ignores the old list", async () => {
  const oldClients = pause(), newSession = pause(); let clientCalls = 0, sessionCalls = 0, waitingForReturn = false;
  const f = harness({ intercept: (path) => {
    if (path === "/api/admin/clients?limit=50" && ++clientCalls === 1) return oldClients.promise;
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
    const f = harness({ intercept: (path) => path === "/api/admin/clients?limit=50" && ++clientCalls === 1 ? oldClients.promise : undefined });
    await flush();
    f.state.currentSession = session("Session actuelle", change === "user"
      ? { user: { id: "9".repeat(32), role: "admin", pseudonym: "Session actuelle" } }
      : { csrf: "F".repeat(43) });
    oldClients.resolve(response(200, { clients: [{ id: "8".repeat(32), pseudonym: "Ancien public", email: "old-audience@example.invalid",
      status: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, accessExpiresAt: null }] }));
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
  assert.equal(sessions, 4); assert.equal(f.calls.filter((call) => call.path === "/api/admin/clients?limit=50").length, 2);
  privateCleared(f); assert.equal(f.element("login-form").hidden, false); assert.match(f.element("auth-status").textContent, /Recharge la page/);
  assert.equal(posts(f).length, 0);
});

const listCalls = (f, kind) => f.calls.filter((call) => call.path.startsWith(`/api/admin/${kind}?`));
const renewForms = (f) => f.element("clients-list").querySelectorAll("form");
async function submitNode(node) {
  const handler = node.events.get("submit"); assert.equal(typeof handler, "function");
  handler({ preventDefault() {} }); await flush();
}

test("administrator lists traverse 650 entries independently with only one page retained", async () => {
  const f = harness({ clients: Array.from({ length: 650 }, (_, index) => clientRow(index + 1)), invitations: Array.from({ length: 120 }, (_, index) => invitationRow(index + 1)) });
  await flush();
  assert.equal(listCalls(f, "clients").length, 1); assert.equal(listCalls(f, "invitations").length, 1);
  assert.equal(f.element("clients-list").children.length, 50); assert.equal(f.element("clients-first").disabled, true);
  await f.click("invitations-next"); const invitationPage = contents(f.element("invitations-list"));
  for (let index = 1; index < 13; index += 1) {
    await f.click("clients-next");
    assert.equal(f.element("clients-list").children.length, 50);
    assert.equal(contents(f.element("clients-list")).includes(`client-${index * 50}@example.invalid`), false);
    assert.equal(contents(f.element("invitations-list")), invitationPage);
  }
  assert.match(contents(f.element("clients-list")), /client-650@example\.invalid/);
  assert.equal(listCalls(f, "clients").length, 13); assert.equal(listCalls(f, "invitations").length, 2);
  assert.equal(f.element("clients-next").disabled, true); assert.match(f.element("clients-page-note").textContent, /fin de la liste/);
  await f.click("clients-next"); assert.equal(listCalls(f, "clients").length, 13);
  await f.click("clients-first"); assert.match(contents(f.element("clients-list")), /client-1@example\.invalid/);
  assert.equal(contents(f.element("invitations-list")), invitationPage);
  assert.equal(listCalls(f, "clients").at(-1).path, "/api/admin/clients?limit=50");
  await f.click("refresh-access");
  assert.equal(listCalls(f, "clients").at(-1).path, "/api/admin/clients?limit=50");
  assert.equal(listCalls(f, "invitations").at(-1).path, "/api/admin/invitations?limit=50");
  assert.equal(f.element("invitations-first").disabled, true); assert.equal(posts(f).length, 0);
});

test("an older page is painted only after its final current-session proof", async () => {
  const proof = pause(); let pendingProof = false;
  const f = harness({ clients: Array.from({ length: 60 }, (_, index) => clientRow(index + 1)), intercept: (path) => {
    if (path === "/api/admin/clients?limit=50&cursor=clients_50") pendingProof = true;
    if (path === "/api/auth/session" && pendingProof) return proof.promise;
    return undefined;
  } });
  await flush(); await f.click("clients-next");
  assert.match(contents(f.element("clients-list")), /client-1@example\.invalid/);
  assert.doesNotMatch(contents(f.element("clients-list")), /client-60@example\.invalid/);
  assert.equal(f.element("clients-next").disabled, true);
  proof.resolve(response(200, session())); await flush();
  assert.match(contents(f.element("clients-list")), /client-60@example\.invalid/); assert.equal(f.element("clients-list").children.length, 10);
  assert.equal(f.element("clients-first").disabled, false);
});

test("late older-page data and errors after hide cannot replace a new account or its cursor", async () => {
  for (const status of [200, 401]) {
    const older = pause();
    const f = harness({ clients: Array.from({ length: 60 }, (_, index) => clientRow(index + 1)), intercept: (path) => path.includes("cursor=clients_50") ? older.promise : undefined });
    await flush(); await f.click("clients-next"); await f.hide();
    assert.equal(f.element("clients-page-note").textContent, ""); assert.equal(f.element("clients-pagination").hidden, true);
    f.state.currentSession = session("Nouvelle Jessie", { csrf: "J".repeat(43), user: { id: "9".repeat(32), role: "admin", pseudonym: "Nouvelle Jessie" } });
    f.state.clients = [clientRow(900)]; await f.show();
    older.resolve(response(status, status === 200 ? { clients: [clientRow(60)] } : { error: "authentication_required" })); await flush();
    assert.equal(f.element("connected-name").textContent, "Nouvelle Jessie");
    assert.match(contents(f.element("clients-list")), /client-900@example\.invalid/); assert.doesNotMatch(contents(f.element("clients-list")), /client-60@example\.invalid/);
    assert.equal(f.element("clients-first").disabled, true); assert.equal(listCalls(f, "clients").at(-1).path, "/api/admin/clients?limit=50");
  }
});

test("a changed actor during pagination discards the returned page and rebuilds both first pages", async () => {
  const older = pause();
  const f = harness({ clients: Array.from({ length: 60 }, (_, index) => clientRow(index + 1)), intercept: (path) => path.includes("cursor=clients_50") ? older.promise : undefined });
  await flush(); await f.click("clients-next");
  f.state.currentSession = session("Session B", { csrf: "K".repeat(43) }); f.state.clients = [clientRow(901)];
  older.resolve(response(200, { clients: [clientRow(60)] })); await flush();
  assert.equal(f.element("connected-name").textContent, "Session B"); assert.match(contents(f.element("clients-list")), /client-901@example\.invalid/);
  assert.doesNotMatch(contents(f.element("clients-list")), /client-60@example\.invalid/); assert.equal(f.element("clients-first").disabled, true); assert.equal(posts(f).length, 0);
});

test("invalid pagination metadata never advances or replaces an already verified page", async () => {
  for (const data of [
    { clients: [clientRow(60)], hasMore: true, nextCursor: "clients_60" },
    { clients: Array.from({ length: 50 }, (_, index) => clientRow(index + 51)), hasMore: true, nextCursor: "bad+cursor" },
    { clients: [clientRow(60)], hasMore: false, nextCursor: "clients_60" },
    { clients: Array.from({ length: 51 }, (_, index) => clientRow(index + 51)) },
  ]) {
    const f = harness({ clients: Array.from({ length: 60 }, (_, index) => clientRow(index + 1)), intercept: (path) => path.includes("cursor=clients_50") ? response(200, data) : undefined });
    await flush(); await f.click("clients-next");
    assert.match(contents(f.element("clients-list")), /client-1@example\.invalid/); assert.equal(f.element("clients-list").children.length, 50);
    assert.equal(f.element("clients-first").disabled, true); assert.equal(f.element("clients-next").disabled, false); assert.equal(posts(f).length, 0);
  }
});

test("only invited email-verified approved finite active access offers renewal and expired access is identified", async () => {
  const clients = [clientRow(1), clientRow(2, { accessExpiresAt: initialTime - 1 }), clientRow(3, { accessExpiresAt: null }),
    ...["pending", "suspended", "revoked", "deleted"].map((status, index) => clientRow(index + 4, { status })),
    clientRow(8, { emailVerified: false }), clientRow(9, { invitationConsumed: false }), clientRow(10, { approved: false })];
  const f = harness({ clients }); await flush();
  assert.equal(renewForms(f).length, 2);
  assert.match(contents(f.element("clients-list").children[0]), /État : Actif/);
  assert.match(contents(f.element("clients-list").children[1]), /État : Accès expiré/);
  assert.match(contents(renewForms(f)[0]), /Prolonger l’accès/); assert.match(contents(renewForms(f)[1]), /Renouveler l’accès expiré/);
  for (const form of renewForms(f)) assert.equal(form.querySelectorAll("input")[0].value, "30");
});

test("manual admission allows approval without age assurance only after invitation consumption and email verification", async () => {
  const clients = [clientRow(1, { status: "pending", approved: false }), clientRow(2, { status: "pending", approved: false, emailVerified: false }),
    clientRow(3, { status: "pending", approved: false, invitationConsumed: false })];
  let f;
  f = harness({ clients, intercept: (path) => {
    if (!path.endsWith("/approve")) return undefined;
    f.state.clients[0] = clientRow(1);
    return response(200, { status: "approved" });
  } });
  await flush();
  const cards = f.element("clients-list").children;
  const buttons = cards.map((card) => card.querySelectorAll("button")[0]);
  assert.equal(buttons[0].disabled, false); assert.equal(buttons[1].disabled, true); assert.equal(buttons[2].disabled, true);
  assert.match(contents(cards[0]), /Admission manuelle/); assert.match(contents(cards[0]), /Approbation de Jess : en attente/);
  assert.doesNotMatch(contents(f.element("clients-list")), /Majorité|majorité vérifiée/);
  buttons[0].events.get("click")(); await flush();
  const approval = posts(f); assert.equal(approval.length, 1); assert.equal(approval[0].path, `/api/admin/clients/${clients[0].id}/approve`);
  assert.equal(approval[0].options.headers["X-CSRF-Token"], session().csrf);
  assert.match(contents(f.element("clients-list").children[0]), /Accès approuvé par Jess/);
  assert.equal(f.element("auth-status").textContent, "L’accès client est approuvé.");
});

test("a client list with missing or unknown admission fields is rejected before private rows are rendered", async () => {
  for (const changes of [{ admissionPolicy: undefined }, { admissionPolicy: "unknown" }, { invitationConsumed: undefined }, { invitationConsumed: "true" }]) {
    const f = harness({ clients: [clientRow(1, changes)] }); await flush();
    assert.equal(f.element("clients-list").children.length, 0); assert.equal(f.element("access-tools").hidden, true);
    assert.doesNotMatch(contents(f.element("clients-list")), /client-1@example/); assert.equal(posts(f).length, 0);
  }
});

test("renewal snapshots the chosen duration and expiry, preserves the busy draft and refreshes only the current client page", async () => {
  const pending = pause();
  const clients = Array.from({ length: 60 }, (_, index) => clientRow(index + 1));
  const f = harness({ clients, intercept: (path) => path.endsWith("/renew") ? pending.promise : undefined });
  await flush(); await f.click("clients-next"); const invitationsBefore = listCalls(f, "invitations").length;
  const form = renewForms(f)[0], input = form.querySelectorAll("input")[0]; input.value = "45";
  await submitNode(form); const post = posts(f).at(-1);
  assert.equal(post.path, `/api/admin/clients/${clients[50].id}/renew`);
  assert.deepEqual(JSON.parse(post.options.body), { accessDays: 45, expectedExpiresAt: clients[50].accessExpiresAt });
  assert.equal(form.querySelectorAll("button")[0].disabled, true); assert.equal(input.value, "45");
  input.value = "60"; await submitNode(form); assert.equal(posts(f).length, 1);
  const newExpiry = clients[50].accessExpiresAt + 45 * 86400000; f.state.clients[50] = clientRow(51, { accessExpiresAt: newExpiry });
  pending.resolve(response(200, { status: "renewed", client: { id: clients[50].id, accessExpiresAt: newExpiry } })); await flush();
  assert.equal(posts(f).length, 1); assert.equal(listCalls(f, "invitations").length, invitationsBefore);
  assert.equal(listCalls(f, "clients").at(-1).path, "/api/admin/clients?limit=50&cursor=clients_50");
  assert.equal(f.element("clients-first").disabled, false); assert.match(f.element("auth-status").textContent, /prolongée/);
  assert.equal(renewForms(f)[0].querySelectorAll("button")[0].disabled, false);
});

test("renewal validates whole-day input locally and gives a duration-specific server rejection", async () => {
  const f = harness({ clients: [clientRow(1)], intercept: (path) => path.endsWith("/renew") ? response(400, { error: "invalid_request" }) : undefined });
  await flush(); const form = renewForms(f)[0], input = form.querySelectorAll("input")[0];
  for (const value of ["", "0", "1.5", "3651", "NaN"]) {
    input.value = value; await submitNode(form); assert.equal(posts(f).length, 0); assert.match(f.element("auth-status").textContent, /1 à 3 650/);
  }
  input.value = "3650"; await submitNode(form);
  assert.equal(posts(f).length, 1); assert.equal(input.value, "3650"); assert.match(f.element("auth-status").textContent, /durée plus courte/);
  assert.doesNotMatch(f.element("auth-status").textContent, /mot de passe|code de sécurité/);
});

test("a concurrent renewal conflict refreshes the current date and never replays the mutation", async () => {
  const f = harness({ clients: [clientRow(1)], intercept: (path) => {
    if (!path.endsWith("/renew")) return undefined;
    f.state.clients[0] = clientRow(1, { accessExpiresAt: initialTime + 10 * 86400000 });
    return response(409, { error: "access_changed" });
  } });
  await flush(); const before = listCalls(f, "clients").length; await submitNode(renewForms(f)[0]);
  assert.equal(posts(f).length, 1); assert.equal(listCalls(f, "clients").length, before + 1);
  assert.match(f.element("auth-status").textContent, /modifié entre-temps/); assert.match(f.element("auth-status").textContent, /Vérifie/);
  const updated = renewForms(f)[0]; await submitNode(updated);
  assert.equal(JSON.parse(posts(f).at(-1).options.body).expectedExpiresAt, initialTime + 10 * 86400000);
});

test("unknown renewal outcomes perform GET reconciliation without claiming success or replaying POST", async () => {
  for (const outcome of ["network", "unavailable", "malformed"]) {
    const f = harness({ clients: [clientRow(1)], intercept: (path) => {
      if (!path.endsWith("/renew")) return undefined;
      f.state.clients[0] = clientRow(1, { accessExpiresAt: initialTime + 31 * 86400000 });
      if (outcome === "network") return Promise.reject(new TypeError("synthetic_network"));
      return outcome === "unavailable" ? response(503, { error: "unavailable" }) : response(200, { status: "renewed" });
    } });
    await flush(); const before = listCalls(f, "clients").length; await submitNode(renewForms(f)[0]);
    assert.equal(posts(f).length, 1); assert.equal(listCalls(f, "clients").length, before + 1);
    assert.match(f.element("auth-status").textContent, /résultat.*pas pu être confirmé/);
    assert.doesNotMatch(f.element("auth-status").textContent, /est prolongée/); assert.equal(renewForms(f)[0].querySelectorAll("button")[0].disabled, false);
  }
});

test("a failed list read after successful renewal keeps the mutation unconfirmed and preserves the draft", async () => {
  let committed = false;
  const f = harness({ clients: [clientRow(1)], intercept: (path) => {
    if (path.endsWith("/renew")) { committed = true; return response(200, { status: "renewed", client: { id: clientRow(1).id, accessExpiresAt: initialTime + 31 * 86400000 } }); }
    if (path === "/api/admin/clients?limit=50" && committed) return response(503, { error: "unavailable" });
    return undefined;
  } });
  await flush(); const form = renewForms(f)[0]; form.querySelectorAll("input")[0].value = "30"; await submitNode(form);
  assert.equal(posts(f).length, 1); assert.equal(renewForms(f)[0], form); assert.equal(form.querySelectorAll("input")[0].value, "30");
  assert.match(f.element("auth-status").textContent, /résultat.*pas pu être confirmé/);
});

test("renewal preflight detects a changed session before sending any mutation", async () => {
  const f = harness({ clients: [clientRow(1)] }); await flush();
  f.state.currentSession = session("Nouvelle session", { csrf: "L".repeat(43) }); f.state.clients = [clientRow(900)];
  await submitNode(renewForms(f)[0]);
  assert.equal(posts(f).length, 0); assert.equal(f.element("connected-name").textContent, "Nouvelle session");
  assert.match(contents(f.element("clients-list")), /client-900@example\.invalid/); assert.doesNotMatch(contents(f.element("clients-list")), /client-1@example\.invalid/);
});

test("an old renewal response and finally cannot reveal data or unlock a new account's pending renewal", async () => {
  const first = pause(), second = pause(); let renewals = 0;
  const f = harness({ clients: [clientRow(1)], intercept: (path) => path.endsWith("/renew") ? (++renewals === 1 ? first.promise : second.promise) : undefined });
  await flush(); await submitNode(renewForms(f)[0]); await f.hide(); privateCleared(f);
  f.state.currentSession = session("Compte B", { csrf: "M".repeat(43) }); f.state.clients = [clientRow(900)]; await f.show();
  const newForm = renewForms(f)[0]; newForm.querySelectorAll("input")[0].value = "60"; await submitNode(newForm);
  first.resolve(response(200, { status: "renewed", client: { id: clientRow(1).id, accessExpiresAt: initialTime + 31 * 86400000 } })); await flush();
  assert.equal(f.element("connected-name").textContent, "Compte B"); assert.equal(newForm.querySelectorAll("button")[0].disabled, true);
  assert.equal(newForm.querySelectorAll("input")[0].value, "60"); assert.doesNotMatch(contents(f.element("clients-list")), /client-1@example\.invalid/);
  const expiresAt = initialTime + 61 * 86400000; f.state.clients[0] = clientRow(900, { accessExpiresAt: expiresAt });
  second.resolve(response(200, { status: "renewed", client: { id: clientRow(900).id, accessExpiresAt: expiresAt } })); await flush();
  assert.equal(posts(f).length, 2); assert.equal(renewForms(f)[0].querySelectorAll("button")[0].disabled, false);
});

test("a cookie change during renewal reconciliation clears the previous client and retains no secret cursor", async () => {
  const finalPage = pause(); let renewed = false;
  const f = harness({ clients: Array.from({ length: 60 }, (_, index) => clientRow(index + 1)), intercept: (path) => {
    if (path.endsWith("/renew")) { renewed = true; return response(200, { status: "renewed", client: { id: clientRow(51).id, accessExpiresAt: initialTime + 31 * 86400000 } }); }
    if (path.includes("cursor=clients_50") && renewed) return finalPage.promise;
    return undefined;
  } });
  await flush(); await f.click("clients-next"); await submitNode(renewForms(f)[0]);
  f.state.currentSession = session("Nouvel onglet", { csrf: "N".repeat(43) }); f.state.clients = [clientRow(950)];
  finalPage.resolve(response(200, { clients: [clientRow(51)] })); await flush();
  assert.equal(posts(f).length, 1); assert.equal(f.element("connected-name").textContent, "Nouvel onglet"); assert.match(contents(f.element("clients-list")), /client-950@example\.invalid/);
  assert.doesNotMatch(contents(f.element("clients-list")), /client-51@example\.invalid/); assert.equal(f.element("clients-first").disabled, true);
  assert.match(f.element("auth-status").textContent, /résultat.*pas pu être confirmé/);
});

test("an unconfirmed renewal preserves an edited duration when GET finds the exact same expiry", async () => {
  for (const failure of ["network", "unavailable", "malformed"]) {
    const pending = pause(), read = pause(); let attempted = false;
    const f = harness({ clients: [clientRow(1)], intercept: (path) => {
      if (path.endsWith("/renew")) { attempted = true; return pending.promise; }
      if (path === "/api/admin/clients?limit=50" && attempted) return read.promise;
      return undefined;
    } });
    await flush(); const form = renewForms(f)[0], input = form.querySelectorAll("input")[0]; input.value = "97"; await submitNode(form);
    input.value = "98";
    if (failure === "network") pending.resolve(Promise.reject(new TypeError("synthetic_network")));
    else pending.resolve(response(failure === "unavailable" ? 503 : 200, failure === "unavailable" ? { error: "unavailable" } : { status: "renewed" }));
    await flush(); input.value = "99";
    read.resolve(response(200, { clients: [clientRow(1)] })); await flush();
    assert.equal(posts(f).length, 1); assert.equal(JSON.parse(posts(f)[0].options.body).accessDays, 97);
    assert.equal(renewForms(f)[0].querySelectorAll("input")[0].value, "99");
    assert.match(f.element("auth-status").textContent, /résultat.*pas pu être confirmé/);
  }
});
