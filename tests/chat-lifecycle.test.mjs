import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = await readFile(new URL("../public/chat.js", import.meta.url), "utf8");
const modelSource = await readFile(new URL("../public/chat-model.js", import.meta.url), "utf8");
const modelExports = [...modelSource.matchAll(/export function ([a-zA-Z0-9_]+)\(/g)].map((match) => match[1]);
const html = await readFile(new URL("../public/chat.html", import.meta.url), "utf8");
const now = 1750000000000;
const id = (value) => value.toString(16).padStart(32, "0");
const session = (value = 1, csrf = "A".repeat(43), role = "client") => ({ user: { id: id(value), role, pseudonym: `Synthetic ${value}` },
  csrf, expiresAt: now + 28800000, ...(role === "client" ? { access: { state: "active" } } : {}) });
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const pause = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 12; index++) await new Promise((resolve) => setImmediate(resolve)); };
class Element {
  constructor(tag = "div", registry = null) {
    this.tagName = tag; this.registry = registry; this.children = []; this.parentElement = null; this.isConnected = true; this.events = new Map();
    this.attributes = new Map(); this.dataset = {}; this.style = {}; this.hidden = false; this.disabled = false; this.value = ""; this.files = [];
    this.open = false; this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100; this._text = "";
    const classes = new Set(); this.classList = { add: (...values) => values.forEach((value) => classes.add(value)), remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value), toggle: (value, include = !classes.has(value)) => { if (include) classes.add(value); else classes.delete(value); return include; } };
  }
  set id(value) { this._id = value; this.registry?.set(value, this); } get id() { return this._id; }
  set textContent(value) { this._text = value; this.replaceChildren(); } get textContent() { return this._text; }
  addEventListener(name, handler) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(handler); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { for (const child of children) { if (child.tagName === "fragment") { this.append(...child.children); continue; } child.parentElement = this; child.isConnected = this.isConnected; this.children.push(child); } }
  after(...children) { this.parentElement?.append(...children); }
  replaceChildren(...children) { for (const child of this.children) child.isConnected = false; this.children = []; this.append(...children); }
  remove() { this.isConnected = false; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
  querySelectorAll(selector) { const matches = (child) => selector.startsWith(".") ? child.className?.split(" ").includes(selector.slice(1)) : child.tagName === selector;
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() { return { top: 0, bottom: 100, height: 100 }; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; for (const handler of this.events.get("close") ?? []) handler({}); }
}
function harness({ currentSession = session(), visible = true, intercept = null } = {}) {
  const nodes = new Map(), documentEvents = new Map(), windowEvents = new Map(), calls = [], timers = new Map(), redirects = [], revoked = [], createdUrls = [];
  let timerId = 0, time = now, blobId = 0;
  const body = new Element("body", nodes);
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) { const item = new Element("div", nodes); item.id = match[1]; body.append(item); }
  const element = (value) => nodes.get(value);
  element("workspace").hidden = true;
  const document = { visibilityState: visible ? "visible" : "hidden", body, head: new Element("head", nodes),
    getElementById: (value) => { const item = nodes.get(value); return item?.isConnected ? item : null; },
    createElement: (tag) => new Element(tag, nodes), createDocumentFragment: () => new Element("fragment", nodes),
    querySelector: () => new Element("div", nodes), addEventListener: (name, handler) => documentEvents.set(name, handler) };
  const state = { currentSession, conversations: new Map(), messages: new Map(), posts: 0 };
  const conversation = (owner = state.currentSession?.user.id) => {
    if (!state.conversations.has(owner)) state.conversations.set(owner, { id: id(100 + Number.parseInt(owner, 16)), clientId: owner, clientPseudonym: `Synthetic ${owner}`,
      peerName: `Peer ${owner}`, createdAt: now, closedAt: null, lastActivityAt: now, latestSequence: "1", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 1, canSend: true });
    return state.conversations.get(owner);
  };
  const storedMessages = (conv) => { if (!state.messages.has(conv.id)) state.messages.set(conv.id, [{ id: id(500 + Number.parseInt(conv.clientId, 16)), sequence: "1", sender: "peer", body: `Private ${conv.clientId}`, createdAt: now, deletedAt: null, clientMessageId: null }]); return state.messages.get(conv.id); };
  const context = vm.createContext({ document, window: { addEventListener: (name, handler) => windowEvents.set(name, handler) },
    location: { pathname: currentSession?.user.role === "admin" ? "/admin/messages" : "/messages", replace: (path) => redirects.push(path), reload() { redirects.push("reload"); } },
    Date: class extends Date { static now() { return time; } }, AbortController, TextEncoder, Blob, crypto: webcrypto, queueMicrotask,
    URL: { createObjectURL: () => { const value = `blob:synthetic-${++blobId}`; createdUrls.push(value); return value; }, revokeObjectURL: (url) => revoked.push(url) },
    setTimeout: (handler, delay) => { const value = ++timerId; timers.set(value, { handler, at: time + delay }); return value; }, clearTimeout: (value) => timers.delete(value),
    fetch: async (path, options = {}) => {
      const call = { path, options, ownerAtDispatch: state.currentSession?.user.id, csrfAtDispatch: state.currentSession?.csrf }; calls.push(call);
      // Intercepts deliberately can complete after abort, exercising the real
      // controller's generation checks rather than relying on fetch alone.
      const value = intercept?.(path, options, state, calls); if (value !== undefined) return await value;
      if (/^\/api\/(?:auth|access)\/session$/.test(path)) return response(state.currentSession ? 200 : 401, state.currentSession ? structuredClone(state.currentSession) : { error: "authentication_required" });
      if (path.startsWith("/api/broadcast/") || path === "/api/admin/crm/capabilities" || /\/api\/media\/.*\/capabilities$/.test(path)) return response(404, { error: "not_found" });
      if (path.endsWith("/capabilities")) return response(200, { enabled: true });
      if (path.endsWith("/logout")) { state.currentSession = null; return response(200, { status: "signed_out" }); }
      const conv = state.currentSession ? conversation() : null;
      if (path.endsWith("/conversation")) return response(200, conv);
      if (/\/conversations\?/.test(path)) return response(200, { conversations: [conv], nextCursor: null, hasMore: false });
      const match = /\/conversations\/([a-f0-9]{32})\/(messages|events|read)/.exec(path);
      if (match) {
        if (!conv || match[1] !== conv.id) return response(404, { error: "not_found" });
        if (match[2] === "events") return response(200, { conversation: conv, events: [], nextCursor: "1", hasMore: false });
        if (match[2] === "read") return response(200, { lastReadSequence: "1" });
        if (options.method === "POST") {
          const command = JSON.parse(options.body); state.posts += 1;
          const item = { id: id(1000 + state.posts), sequence: String(storedMessages(conv).length + 1), sender: "me", body: command.body,
            createdAt: time, deletedAt: null, clientMessageId: command.clientMessageId };
          storedMessages(conv).push(item); return response(201, { message: item });
        }
        return response(200, { conversation: conv, messages: storedMessages(conv), eventCursor: "1", hasMoreBefore: false, nextBefore: null });
      }
      throw new Error(`Unexpected request ${path}`);
    } });
  vm.runInContext(`globalThis.__model = (() => {${modelSource.replaceAll("export function ", "function ")}\nreturn {${modelExports.join(",")}};})();`, context, { filename: "public/chat-model.js" });
  const executable = source.replace(/^import \{([^\n]+)\} from "\/chat-model\.js";/, "const {$1} = __model;") +
    "\nglobalThis.__inspect = () => ({ready, sessionOwner, selected, states, inbox, sendBusy, cycleRunning, generation, visibilityGeneration});";
  vm.runInContext(executable, context, { filename: "public/chat.js", importModuleDynamically: async () => { throw new Error("Optional feature disabled in fixture"); } });
  return { element, document, state, calls, redirects, timers, revoked, createdUrls, context, conversation, inspect: () => context.__inspect(),
    async event(name, data = {}) { const handler = documentEvents.get(name) ?? windowEvents.get(name); assert.equal(typeof handler, "function", name); handler(data); await flush(); },
    async hide() { document.visibilityState = "hidden"; await this.event("visibilitychange"); },
    async show() { document.visibilityState = "visible"; await this.event("visibilitychange"); },
    async click(name) { for (const handler of element(name).events.get("click") ?? []) handler({ currentTarget: element(name), preventDefault() {} }); await flush(); },
    async send(body) { element("message-body").value = body; for (const handler of element("message-body").events.get("input") ?? []) handler({});
      for (const handler of element("composer").events.get("submit") ?? []) handler({ preventDefault() {} }); await flush(); },
    async advance(milliseconds) { const target = time + milliseconds; let remaining = 100;
      while (remaining-- > 0) { const next = [...timers].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break;
        timers.delete(next[0]); time = next[1].at; next[1].handler(); await flush(); }
      assert.ok(remaining > 0, "bounded timer fixture"); time = target; await flush(); },
  };
}
const contents = (element) => [element.textContent, element.value, ...element.children.map(contents)].join(" ");
const posts = (f) => f.calls.filter((call) => call.options.method === "POST" && call.path.includes("/messages"));
function assertOwner(f, value, csrf = "A".repeat(43)) {
  assert.equal(f.inspect().sessionOwner.id, id(value)); assert.equal(f.inspect().sessionOwner.csrf, csrf);
  assert.equal(f.inspect().ready, true); assert.equal(f.element("workspace").hidden, false);
}

test("initially hidden chat does not bootstrap; late hidden bootstrap cannot restore a private workspace", async () => {
  const first = harness({ visible: false }); await flush(); assert.equal(first.calls.length, 0); assert.equal(first.element("workspace").hidden, true);
  await first.show(); assertOwner(first, 1);
  const gate = pause(); let intercepted = false;
  const f = harness({ intercept: (path) => path.endsWith("/messages?limit=50") && !intercepted ? (intercepted = true, gate.promise) : undefined });
  await flush(); await f.hide(); gate.resolve(response(200, { conversation: f.conversation(), messages: [{ id: id(99), sequence: "1", sender: "peer", body: "Late private", createdAt: now, deletedAt: null }], eventCursor: "1", hasMoreBefore: false })); await flush();
  assert.equal(f.element("workspace").hidden, true); assert.doesNotMatch(contents(f.element("messages")), /Late private/);
  await f.show(); assertOwner(f, 1); assert.equal(f.calls.filter((call) => call.path.endsWith("/messages?limit=50")).length, 2);
});

test("returning as another client purges the old messages, draft, pending IDs and bootstraps the new conversation", async () => {
  const send = pause(), f = harness({ intercept: (path, options) => options.method === "POST" && path.endsWith("/messages") ? send.promise : undefined });
  await flush(); assertOwner(f, 1); await f.send("Uncertain private A"); const oldKey = JSON.parse(posts(f)[0].options.body).clientMessageId;
  assert.equal(f.inspect().states.get(f.inspect().selected).pending.clientMessageId, oldKey);
  await f.hide(); f.state.currentSession = session(2, "B".repeat(43)); await f.show(); assertOwner(f, 2, "B".repeat(43));
  assert.equal(f.inspect().states.size, 1); assert.equal(f.inspect().states.get(f.inspect().selected).pending, null);
  assert.equal(f.element("message-body").value, ""); assert.doesNotMatch(contents(f.element("messages")), /Uncertain private A|Private 00000000000000000000000000000001/);
  send.resolve(response(201, { message: { id: id(998), sequence: "2", sender: "me", body: "Late A", createdAt: now, deletedAt: null, clientMessageId: oldKey } })); await flush();
  assertOwner(f, 2, "B".repeat(43)); assert.doesNotMatch(contents(f.element("messages")), /Late A/); assert.equal(posts(f).length, 1);
});

test("a new login for the same account also abandons the old pending send, while the unchanged session preserves its exact retry key", async () => {
  for (const changed of [false, true]) {
    const send = pause(), f = harness({ intercept: (path, options) => options.method === "POST" && path.endsWith("/messages") ? send.promise : undefined });
    await flush(); await f.send("Same account draft"); const key = JSON.parse(posts(f)[0].options.body).clientMessageId;
    await f.hide(); if (changed) f.state.currentSession = session(1, "C".repeat(43)); await f.show();
    assertOwner(f, 1, changed ? "C".repeat(43) : "A".repeat(43));
    const pending = f.inspect().states.get(f.inspect().selected).pending;
    assert.equal(pending?.clientMessageId ?? null, changed ? null : key); assert.equal(f.element("message-body").value, changed ? "" : "Same account draft");
    assert.equal(posts(f).length, 1); send.reject(new Error("old request interrupted")); await flush();
    assert.equal(f.inspect().sendBusy, false);
  }
});

test("a new administrator session clears all loaded inbox and conversation caches before adopting the new owner", async () => {
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin") }); await flush(); assertOwner(f, 1);
  const firstButton = f.element("conversations").children[0]; for (const handler of firstButton.events.get("click")) handler({}); await flush();
  assert.match(contents(f.element("messages")), /Private 00000000000000000000000000000001/);
  await f.hide(); f.state.currentSession = session(2, "B".repeat(43), "admin"); await f.show(); assertOwner(f, 2, "B".repeat(43));
  assert.equal(f.inspect().states.size, 0); assert.equal(f.inspect().inbox.size, 1); assert.equal(f.inspect().inbox.values().next().value.clientId, id(2));
  assert.doesNotMatch(contents(f.element("messages")), /Private 00000000000000000000000000000001/);
});

test("cookie replacement while visible is detected before a private GET can adopt another account's data", async () => {
  const gate = pause(); let interceptEvents = false;
  const f = harness({ intercept: (path) => interceptEvents && path.includes("/events?") ? gate.promise : undefined }); await flush();
  interceptEvents = true; await f.advance(3000); f.state.currentSession = session(2, "B".repeat(43));
  gate.resolve(response(200, { conversation: f.conversation(), events: [], nextCursor: "1", hasMore: false })); await flush();
  assertOwner(f, 2, "B".repeat(43)); assert.equal(f.inspect().states.size, 1); assert.equal(f.inspect().selected, f.conversation().id);
  assert.equal(posts(f).length, 0);
});

test("a private response arriving after a proof was dispatched requires a newer proof", async () => {
  const proof = pause(), events = pause(); let hold = false, proofHeld = false;
  const f = harness({ intercept: (path) => {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (hold && path.includes("/gallery?")) return response(200, { items: [], hasMore: false, nextBefore: null });
    if (hold && path.includes("/events?")) return events.promise;
    if (hold && path.endsWith("/session") && !proofHeld) { proofHeld = true; return proof.promise; }
    return undefined;
  } }); await flush(); hold = true;
  // A gallery response starts its own proof before the event response exists.
  // This uses the real protected GET and the actual gallery button handler.
  await f.click("open-gallery");
  assert.equal(proofHeld, true); await f.advance(3000);
  f.state.currentSession = session(2, "B".repeat(43)); events.resolve(response(200, { conversation: f.conversation(), events: [], nextCursor: "1", hasMore: false })); await flush();
  assertOwner(f, 2, "B".repeat(43));
  proof.resolve(response(200, session())); await flush();
  assertOwner(f, 2, "B".repeat(43)); assert.equal(f.inspect().selected, f.conversation().id);
});

test("a failed session proof after a completed POST preserves the uncertain key even when the proof returns a rejection status", async () => {
  let failProof = false;
  const f = harness({ intercept: (path, options, state) => {
    if (path.endsWith("/messages") && options.method === "POST") { failProof = true; return response(201, { message: { id: id(900), sequence: "2", sender: "me", body: "Uncertain", createdAt: now, deletedAt: null, clientMessageId: JSON.parse(options.body).clientMessageId } }); }
    if (failProof && path.endsWith("/session")) return response(400, { error: "temporary_proof_error" });
    return undefined;
  } }); await flush(); await f.send("Uncertain");
  const pending = f.inspect().states.get(f.inspect().selected).pending; assert.ok(pending); assert.equal(pending.status, "retry");
  assert.equal(pending.clientMessageId, JSON.parse(posts(f)[0].options.body).clientMessageId); assert.equal(f.element("message-body").value, "Uncertain");
  assert.equal(posts(f).length, 1); assert.equal(f.inspect().sendBusy, false);
});

test("an old send finally cannot unlock a newer send belonging to the newly logged-in account", async () => {
  const first = pause(), second = pause(); let count = 0;
  const f = harness({ intercept: (path, options) => options.method === "POST" && path.endsWith("/messages") ? (++count === 1 ? first.promise : second.promise) : undefined });
  await flush(); await f.send("Old A"); const firstKey = JSON.parse(posts(f)[0].options.body).clientMessageId;
  await f.hide(); f.state.currentSession = session(2, "B".repeat(43)); await f.show(); await f.send("New B");
  assert.equal(f.inspect().sendBusy, true); first.resolve(response(201, { message: { id: id(999), sequence: "2", sender: "me", body: "Old A", createdAt: now, deletedAt: null, clientMessageId: firstKey } })); await flush();
  assert.equal(f.inspect().sendBusy, true); assert.equal(f.element("message-body").value, "New B"); assert.equal(f.element("send").disabled, true);
  second.reject(new Error("uncertain current send")); await flush(); assert.equal(f.inspect().sendBusy, false); assert.equal(posts(f).length, 2);
});

test("logout during an unfinished bootstrap permanently invalidates its late response without automatic re-entry", async () => {
  const gate = pause(); let held = false;
  const f = harness({ intercept: (path) => path.endsWith("/messages?limit=50") && !held ? (held = true, gate.promise) : undefined });
  await flush(); await f.click("logout"); assert.ok(f.redirects.includes("/access"));
  gate.resolve(response(200, { conversation: f.conversation(id(1)), messages: [{ id: id(987), sequence: "1", sender: "peer", body: "Late logout data", createdAt: now, deletedAt: null }], eventCursor: "1", hasMoreBefore: false })); await flush();
  assert.equal(f.element("workspace").hidden, true); assert.equal(f.inspect().ready, false); assert.equal(f.inspect().states.size, 0);
  assert.doesNotMatch(contents(f.element("messages")), /Late logout data/); assert.equal(f.calls.filter((call) => call.path.endsWith("/logout")).length, 1);
});


test("a visible cookie replacement is confirmed before any user POST, for a different account and a fresh login of the same account", async () => {
  for (const value of [1, 2]) {
    const f = harness(); await flush(); f.state.currentSession = session(value, "D".repeat(43));
    await f.send("Old session draft must not be submitted");
    assertOwner(f, value, "D".repeat(43)); assert.equal(posts(f).length, 0);
    assert.equal(f.element("message-body").value, ""); assert.equal(f.inspect().states.get(f.inspect().selected).pending, null);
  }
});

test("a blocked old poll cannot block polling after same-session visibility restore or disturb its current cycle", async () => {
  const old = pause(), current = pause(); let eventCalls = 0;
  const f = harness({ intercept: (path) => {
    if (!path.includes("/events?")) return undefined;
    eventCalls += 1; return eventCalls === 1 ? old.promise : eventCalls === 2 ? current.promise : undefined;
  } });
  await flush(); await f.advance(3000); assert.equal(eventCalls, 1); assert.equal(f.inspect().cycleRunning, true);
  await f.hide(); await f.show(); await f.advance(0); assert.equal(eventCalls, 2); assert.equal(f.inspect().cycleRunning, true);
  old.resolve(response(200, { conversation: f.conversation(), events: [], nextCursor: "1", hasMore: false })); await flush();
  assertOwner(f, 1); assert.equal(f.inspect().cycleRunning, true);
  current.resolve(response(200, { conversation: f.conversation(), events: [], nextCursor: "1", hasMore: false })); await flush();
  assert.equal(f.inspect().cycleRunning, false); assert.equal(eventCalls, 2);
});

test("late photo blobs cannot create an object URL after hide or a newly detected cookie owner", async () => {
  for (const mode of ["hidden", "owner"]) {
    const blob = pause(); let f;
    f = harness({ intercept: (path) => {
      if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
      if (path.endsWith("/messages?limit=50") && f.state.currentSession.user.id === id(1)) {
        const conv = f.conversation(), mediaId = id(700), messageId = id(701);
        return response(200, { conversation: conv, messages: [{ id: messageId, sequence: "1", sender: "peer", body: "", createdAt: now, deletedAt: null,
          media: { id: mediaId, width: 1000, height: 800, thumbnailWidth: 400, thumbnailHeight: 320,
            fullUrl: `/api/media/client/conversations/${conv.id}/messages/${messageId}/full`, thumbnailUrl: `/api/media/client/conversations/${conv.id}/messages/${messageId}/thumb` } }], eventCursor: "1", hasMoreBefore: false });
      }
      if (path.endsWith("/thumb")) return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: () => blob.promise };
      return undefined;
    } });
    await flush(); assertOwner(f, 1); assert.equal(f.calls.filter((call) => call.path.endsWith("/thumb")).length, 1);
    if (mode === "hidden") await f.hide(); else f.state.currentSession = session(2, "B".repeat(43));
    blob.resolve(new Blob(["synthetic photo bytes"], { type: "image/jpeg" })); await flush();
    assert.equal(f.createdUrls.length, 0); assert.equal(f.element("messages").querySelectorAll("img").length, 0);
    if (mode === "hidden") assert.equal(f.element("workspace").hidden, true); else assertOwner(f, 2, "B".repeat(43));
  }
});

test("all previously authorized private photo URLs are revoked when the session owner is replaced", async () => {
  let f;
  f = harness({ intercept: (path) => {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.endsWith("/messages?limit=50") && f.state.currentSession.user.id === id(1)) {
      const conv = f.conversation(), messageId = id(702);
      return response(200, { conversation: conv, messages: [{ id: messageId, sequence: "1", sender: "peer", body: "", createdAt: now, deletedAt: null,
        media: { id: id(703), width: 1000, height: 800, thumbnailWidth: 400, thumbnailHeight: 320,
          fullUrl: `/api/media/client/conversations/${conv.id}/messages/${messageId}/full`, thumbnailUrl: `/api/media/client/conversations/${conv.id}/messages/${messageId}/thumb` } }], eventCursor: "1", hasMoreBefore: false });
    }
    if (path.endsWith("/thumb")) return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => new Blob(["synthetic photo"], { type: "image/jpeg" }) };
    return undefined;
  } }); await flush(); assert.equal(f.createdUrls.length, 1); assert.equal(f.revoked.length, 0);
  f.state.currentSession = session(2, "B".repeat(43)); await f.send("Do not send from the old owner");
  assertOwner(f, 2, "B".repeat(43)); assert.deepEqual(f.revoked, f.createdUrls); assert.equal(posts(f).length, 0);
});


test("a resumed workspace stays masked until the current session proof resolves, even for the unchanged owner", async () => {
  const proof = pause(); let hold = false;
  const f = harness({ intercept: (path) => hold && path.endsWith("/session") ? proof.promise : undefined });
  await flush(); assertOwner(f, 1); await f.hide(); assert.equal(f.element("workspace").hidden, true);
  hold = true; await f.show(); assert.equal(f.element("workspace").hidden, true); assert.equal(f.inspect().states.size, 1);
  hold = false; proof.resolve(response(200, session())); await flush(); assertOwner(f, 1);
});

test("late unauthorized photo headers cannot sign out the new owner or a hidden same-session page", async () => {
  for (const status of [401, 403]) for (const mode of ["owner", "hidden"]) {
    const headers = pause(); let f;
    f = harness({ intercept: (path) => {
      if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
      if (path.endsWith("/messages?limit=50") && f.state.currentSession.user.id === id(1)) {
        const conv = f.conversation(), messageId = id(704);
        return response(200, { conversation: conv, messages: [{ id: messageId, sequence: "1", sender: "peer", body: "", createdAt: now, deletedAt: null,
          media: { id: id(705), width: 1000, height: 800, thumbnailWidth: 400, thumbnailHeight: 320,
            fullUrl: `/api/media/client/conversations/${conv.id}/messages/${messageId}/full`, thumbnailUrl: `/api/media/client/conversations/${conv.id}/messages/${messageId}/thumb` } }], eventCursor: "1", hasMoreBefore: false });
      }
      if (path.endsWith("/thumb")) return headers.promise;
      return undefined;
    } }); await flush(); assert.equal(f.calls.filter((call) => call.path.endsWith("/thumb")).length, 1);
    await f.hide();
    if (mode === "owner") { f.state.currentSession = session(2, "B".repeat(43)); await f.show(); assertOwner(f, 2, "B".repeat(43)); }
    headers.resolve({ ok: false, status }); await flush();
    assert.equal(f.redirects.length, 0); assert.equal(f.createdUrls.length, 0);
    if (mode === "owner") assertOwner(f, 2, "B".repeat(43)); else assert.equal(f.element("workspace").hidden, true);
  }
});
