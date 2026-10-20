import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { quickReplyOptions, appendQuickReply } from "../public/quick-replies.js";
import { webcrypto } from "node:crypto";

const source = await readFile(new URL("../public/chat.js", import.meta.url), "utf8");
const sessionClockSource = await readFile(new URL("../public/session-clock.js", import.meta.url), "utf8");
const notificationLinkSource = await readFile(new URL("../public/notification-link.js", import.meta.url), "utf8");
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
    this.tagName = tag; this.registry = registry; this.children = []; this.parentElement = null; this._connected = false; this.events = new Map();
    this.attributes = new Map(); this.dataset = {}; this.style = {}; this.hidden = false; this.disabled = false; this.value = ""; this.files = [];
    this.open = false; this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100; this._text = "";
    this._classes = new Set(); const classes = this._classes;
    this.classList = { add: (...values) => values.forEach((value) => classes.add(value)), remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value), toggle: (value, include = !classes.has(value)) => { if (include) classes.add(value); else classes.delete(value); return include; } };
  }
  set id(value) { this._id = value; this.registry?.set(value, this); } get id() { return this._id; }
  set className(value) { this._classes.clear(); for (const item of value.split(/\s+/).filter(Boolean)) this._classes.add(item); } get className() { return [...this._classes].join(" "); }
  get isConnected() { return this.parentElement ? this.parentElement.isConnected : this._connected; }
  get parentNode() { return this.parentElement; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] ?? null; }
  get firstElementChild() { return this.firstChild; }
  get nextSibling() { if (!this.parentElement) return null; return this.parentElement.children[this.parentElement.children.indexOf(this) + 1] ?? null; }
  set textContent(value) { this.replaceChildren(); this._text = value; } get textContent() { return this._text; }
  addEventListener(name, handler) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(handler); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  set src(value) { this.attributes.set("src", value); } get src() { return this.attributes.get("src") ?? ""; }
  contains(element) { return element === this || this.children.some((child) => child.contains(element)); }
  append(...children) { for (const child of children) this.insertBefore(child, null); }
  insertBefore(child, before) {
    if (child.tagName === "fragment") { for (const item of [...child.children]) this.insertBefore(item, before); return child; }
    if (child === before) return child;
    if (before !== null && !this.children.includes(before)) throw new Error("NotFoundError");
    child.remove(); const index = before === null ? this.children.length : this.children.indexOf(before);
    child.parentElement = this; this.children.splice(index, 0, child); return child;
  }
  after(...children) { const parent = this.parentElement, next = this.nextSibling; for (const child of children) parent?.insertBefore(child, next); }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this._text = ""; this.append(...children); }
  remove() {
    const document = this.registry?.document;
    if (this.isConnected && document && this.contains(document.activeElement)) document.activeElement = document.body;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null; this._connected = false;
  }
  querySelectorAll(selector) { const matches = (child) => selector.startsWith(".") ? child.className?.split(" ").includes(selector.slice(1)) : child.tagName === selector;
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() { return { top: 0, bottom: 100, height: 100 }; }
  focus() { if (this.isConnected && this.registry?.document) this.registry.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; for (const handler of this.events.get("close") ?? []) handler({}); }
}
function harness({ currentSession = session(), visible = true, intercept = null, prepare = async (file) => file, notification = null } = {}) {
  const nodes = new Map(), documentEvents = new Map(), windowEvents = new Map(), calls = [], timers = new Map(), redirects = [], revoked = [], createdUrls = [];
  let timerId = 0, time = now, blobId = 0;
  const body = new Element("body", nodes);
  body._connected = true;
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) { const item = new Element("div", nodes); item.id = match[1]; body.append(item); }
  const element = (value) => nodes.get(value);
  element("workspace").hidden = true;
  const document = { visibilityState: visible ? "visible" : "hidden", body, head: new Element("head", nodes),
    getElementById: (value) => { const item = nodes.get(value); return item?.isConnected ? item : null; },
    createElement: (tag) => new Element(tag, nodes), createDocumentFragment: () => new Element("fragment", nodes),
    querySelector: () => new Element("div", nodes), addEventListener: (name, handler) => documentEvents.set(name, handler) };
  nodes.document = document; document.activeElement = body; document.head._connected = true;
  const state = { currentSession, conversations: new Map(), messages: new Map(), posts: 0 };
  const conversation = (owner = state.currentSession?.user.id) => {
    if (!state.conversations.has(owner)) state.conversations.set(owner, { id: id(100 + Number.parseInt(owner, 16)), clientId: owner, clientPseudonym: `Synthetic ${owner}`,
      peerName: `Peer ${owner}`, createdAt: now, closedAt: null, lastActivityAt: now, latestSequence: "1", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 1, canSend: true });
    return state.conversations.get(owner);
  };
  const storedMessages = (conv) => { if (!state.messages.has(conv.id)) state.messages.set(conv.id, [{ id: id(500 + Number.parseInt(conv.clientId, 16)), sequence: "1", sender: "peer", body: `Private ${conv.clientId}`, createdAt: now, deletedAt: null, clientMessageId: null }]); return state.messages.get(conv.id); };
  const worker = {}, workerEvents = new Map(), acknowledgements = [];
  const location = { origin: "https://example.invalid", pathname: currentSession?.user.role === "admin" ? "/admin/messages" : "/messages", hash: notification ? `#notification=${notification}` : "", replace: (path) => redirects.push(path), reload() { redirects.push("reload"); } };
  const history = { replaceState(_state, _title, path) { const next = new URL(path, location.origin); location.pathname = next.pathname; location.hash = next.hash; } };
  const context = vm.createContext({ __quickReplies: { quickReplyOptions, appendQuickReply }, __prepareImageUpload: prepare, document, window: { addEventListener: (name, handler) => windowEvents.set(name, handler) },
    location, history, navigator: { serviceWorker: { controller: worker, addEventListener: (name, handler) => workerEvents.set(name, handler) } },
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
  vm.runInContext(sessionClockSource, context, { filename: "public/session-clock.js" });
  vm.runInContext(notificationLinkSource, context, { filename: "public/notification-link.js" });
  vm.runInContext(`globalThis.__model = (() => {${modelSource.replaceAll("export function ", "function ")}\nreturn {${modelExports.join(",")}};})();`, context, { filename: "public/chat-model.js" });
  const executable = source.replace('import { quickReplyOptions, appendQuickReply } from "/quick-replies.js";', 'const {quickReplyOptions,appendQuickReply} = __quickReplies;').replace('import { prepareImageUpload } from "/image-preparation.js";', 'const prepareImageUpload = __prepareImageUpload;').replace(/^import \{([^\n]+)\} from "\/chat-model\.js";/, "const {$1} = __model;") +
    "\nglobalThis.__inspect = () => ({ready, sessionOwner, selected, states, inbox, sendBusy, cycleRunning, generation, visibilityGeneration, pendingNotification});";
  vm.runInContext(executable, context, { filename: "public/chat.js", importModuleDynamically: async () => { throw new Error("Optional feature disabled in fixture"); } });
  return { element, document, state, calls, redirects, timers, revoked, createdUrls, context, conversation, inspect: () => context.__inspect(),
    async notification(reference, role = currentSession?.user.role ?? "client") { workerEvents.get("message")({ origin: location.origin, source: worker,
      data: { type: "jessie-open-notification", role, notification: reference }, ports: [{ postMessage(value) { acknowledgements.push(value); } }] }); await flush(); return acknowledgements.at(-1); },
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

async function uncertainSendFixture({ role = "client", persist = true } = {}) {
  let f, target;
  const rows = Array.from({ length: 100 }, (_, index) => ({ id: id(2000 + index), sequence: String(index + 1), sender: "peer",
    body: `Earlier message ${index + 1}`, createdAt: now, deletedAt: null, clientMessageId: null }));
  const assetId = id(2500), reference = id(2600);
  const media = (base) => ({ id: assetId, width: 1000, height: 800, thumbnailWidth: 400, thumbnailHeight: 320,
    fullUrl: `${base}/full`, thumbnailUrl: `${base}/thumb` });
  const append = (sender, body, clientMessageId = null, image = false) => {
    const row = { id: id(2000 + rows.length), sequence: String(rows.length + 1), sender, body, createdAt: now, deletedAt: null, clientMessageId };
    if (image) row.media = media(`/api/media/${role}/conversations/${f.conversation().id}/messages/${row.id}`);
    rows.push(row); return row;
  };
  f = harness({ currentSession: session(1, "A".repeat(43), role), intercept: (path, options) => {
    if (path === `/api/media/${role}/capabilities`) return response(200, { enabled: true });
    if (path === `/api/media/${role}/assets` && options.method === "POST") return response(201, { asset: { ...media(`/api/media/${role}/assets/${assetId}`), sharedHere: false } });
    if (path.endsWith("/thumb")) return photoResponse();
    if (path === `/api/notifications/${role}/open`) return response(200, { conversationId: f.conversation().id, messageId: target.id, sequence: target.sequence });
    const match = /\/conversations\/([a-f0-9]{32})\/(messages|events)/.exec(path);
    if (!match) return undefined;
    if (options.method === "POST") {
      const input = JSON.parse(options.body);
      if (persist) append("me", input.body ?? input.caption, input.clientMessageId, Boolean(input.mediaId));
      throw new Error("Synthetic response lost after the send request");
    }
    const conversation = { ...f.conversation(), latestSequence: String(rows.length), latestEventSequence: String(rows.length) };
    if (match[2] === "events") return response(200, { conversation, events: [], nextCursor: String(rows.length), hasMore: false });
    const after = new URL(path, "https://example.invalid").searchParams.get("after");
    const messages = after === null ? rows.slice(-50) : rows.filter(row => BigInt(row.sequence) > BigInt(after)).slice(0, 50);
    return response(200, { conversation, messages, eventCursor: String(rows.length), hasMoreBefore: messages[0]?.sequence !== "1", nextBefore: messages[0]?.sequence ?? null,
      hasMoreAfter: messages.at(-1)?.sequence !== String(rows.length), nextAfter: messages.at(-1)?.sequence ?? null });
  } });
  await flush();
  if (role === "admin") {
    const contact = f.element("conversations").children[0];
    for (const handler of contact.events.get("click")) handler({}); await flush();
  }
  return Object.assign(f, { rows, append,
    async openNotification(message) { target = message; await f.notification(reference, role); },
    async uncertainSend(kind, body) {
      if (kind === "photo") {
        f.element("image-file").files = [new Blob(["Synthetic image"], { type: "image/jpeg" })];
        for (const handler of f.element("image-file").events.get("change")) handler({});
      }
      await f.send(body);
      assert.equal(f.inspect().states.get(f.inspect().selected).pending?.status, "retry");
      assert.equal(posts(f).length, 1);
    },
  });
}

test("notification message-page acknowledgements clear an uncertain text or photo without repeating the send", async t => {
  for (const kind of ["text", "photo"]) await t.test(kind, async () => {
    const f = await uncertainSendFixture(), incoming = f.append("peer", "A newly notified reply");
    await f.uncertainSend(kind, "Already recorded content");
    const key = JSON.parse(posts(f)[0].options.body).clientMessageId;
    await f.openNotification(incoming);
    const state = f.inspect().states.get(f.inspect().selected);
    assert.equal(state.pending, null); assert.equal(state.imageDraft, null);
    assert.equal(state.draft, "", `${kind} was acknowledged by its exact message key`);
    assert.equal(f.element("message-body").value, ""); assert.equal(f.element("send").disabled, true);
    assert.equal(f.element("pending-controls").hidden, true);
    assert.equal(state.messages.get("102").clientMessageId, key);
    await f.click("retry-send"); await f.advance(3000);
    assert.equal(posts(f).length, 1); assert.equal(f.rows.filter(row => row.clientMessageId === key).length, 1);
    assert.doesNotMatch(f.element("chat-status").textContent, /4 096|1 000|Écris un message/);
  });
});

test("retry from an old notification accepts the latest message-page acknowledgement for text and photo", async t => {
  for (const kind of ["text", "photo"]) await t.test(kind, async () => {
    const f = await uncertainSendFixture({ role: "admin" });
    await f.uncertainSend(kind, "Already recorded administrator content");
    const key = JSON.parse(posts(f)[0].options.body).clientMessageId;
    await f.openNotification(f.rows[0]);
    assert.equal(f.inspect().states.get(f.inspect().selected).hasMoreAfter, true);
    assert.equal(f.inspect().states.get(f.inspect().selected).pending.clientMessageId, key);
    await f.click("retry-send");
    const state = f.inspect().states.get(f.inspect().selected);
    assert.ok(f.calls.some(call => call.path.endsWith("/messages?limit=50") && state.messages.has("101")), "retry first loaded the current history");
    assert.equal(state.pending, null); assert.equal(state.imageDraft, null); assert.equal(state.draft, "");
    assert.equal(f.element("message-body").value, ""); assert.equal(f.element("send").disabled, true);
    assert.equal(f.element("pending-controls").hidden, true);
    assert.doesNotMatch(f.element("chat-status").textContent, /4 096|1 000|Écris un message/);
    await f.advance(3000); assert.equal(posts(f).length, 1);
    assert.equal(f.rows.filter(row => row.clientMessageId === key).length, 1);
  });
});

test("message-page reads preserve an ordinary draft and an uncertain send with a different key", async () => {
  for (const uncertain of [false, true]) {
    const f = await uncertainSendFixture({ persist: false }), incoming = f.append("peer", "A notification to open");
    if (uncertain) {
      await f.uncertainSend("text", "Keep this private text");
      f.append("me", "Keep this private text", "f".repeat(32));
    } else {
      f.element("message-body").value = "Keep this private text";
      for (const handler of f.element("message-body").events.get("input")) handler({});
    }
    const key = uncertain ? JSON.parse(posts(f)[0].options.body).clientMessageId : null;
    await f.openNotification(incoming);
    const state = f.inspect().states.get(f.inspect().selected);
    assert.equal(state.draft, "Keep this private text"); assert.equal(f.element("message-body").value, "Keep this private text");
    assert.equal(state.pending?.clientMessageId ?? null, key);
    assert.equal(f.element("message-body").disabled, uncertain); assert.equal(f.element("pending-controls").hidden, !uncertain);
    assert.equal(posts(f).length, uncertain ? 1 : 0);
  }
});

test("an authenticated notification opens its exact message and clears only its navigation reference", async () => {
  const reference = id(910), f = harness({ notification: reference, intercept: (path) => path === "/api/notifications/client/open"
    ? response(200, { conversationId: id(101), messageId: id(501), sequence: "1" }) : undefined });
  await flush(); assert.equal(f.inspect().selected, id(101));
  assert.equal(f.inspect().pendingNotification, null); assert.equal(f.context.location.hash, "");
  assert.equal(f.document.activeElement.classList.contains("notification-target"), true);
  assert.equal(f.redirects.length, 0);
  assert.equal(f.calls.find((call) => call.path.endsWith("/open")).options.headers["X-CSRF-Token"], "A".repeat(43));
});

test("notification opening preserves its destination through a genuinely missing session", async () => {
  const reference = id(911), f = harness({ currentSession: null, notification: reference }); await flush();
  assert.deepEqual(f.redirects, [`/access#notification=${reference}`]);
  assert.equal(f.element("workspace").hidden, true);
  assert.equal(f.calls.some((call) => call.path.endsWith("/open")), false);
});

test("an existing chat acknowledges a notification without reloading or losing its draft, including after backgrounding", async () => {
  const reference = id(912), f = harness({ intercept: (path) => path === "/api/notifications/client/open"
    ? response(200, { conversationId: id(101), messageId: id(501), sequence: "1" }) : undefined });
  await flush(); f.element("message-body").value = "Unsent private draft";
  await f.hide(); assert.equal((await f.notification(reference)).accepted, true);
  assert.equal(f.calls.some((call) => call.path.endsWith("/open")), false);
  await f.show();
  assert.equal(f.element("message-body").value, "Unsent private draft");
  assert.equal(f.inspect().pendingNotification, null); assert.equal(f.redirects.length, 0);
});

test("an administrator notification loads a conversation outside its first inbox page and anchors an old bigint message without a history gap", async () => {
  const reference = id(913), targetSequence = "9007199254740993", conversationId = id(777), messageId = id(778);
  const conversation = { id: conversationId, peerName: "Target peer", clientId: id(779), createdAt: now, closedAt: null, lastActivityAt: now,
    latestSequence: "9007199254741093", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 1, canSend: true };
  const item = { id: messageId, sequence: targetSequence, sender: "peer", body: "The precise notification message", createdAt: now, deletedAt: null };
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin"), notification: reference, intercept: (path) => {
    if (path === "/api/notifications/admin/open") return response(200, { conversationId, messageId, sequence: targetSequence });
    if (path.includes(`/conversations/${conversationId}/messages?`)) return response(200, { conversation, messages: [item], eventCursor: "1", hasMoreBefore: true, nextBefore: targetSequence, hasMoreAfter: true, nextAfter: targetSequence });
    if (path.includes(`/conversations/${conversationId}/events?`)) return response(200, { conversation, events: [{ sequence: "2", kind: "message", message: { ...item, id: id(780), sequence: "9007199254741093", body: "Later message beyond a gap" } }], nextCursor: "2", hasMore: false });
    if (path.endsWith(`/conversations/${conversationId}/read`)) return response(200, { lastReadSequence: targetSequence });
  } });
  await flush();
  assert.equal(f.inspect().selected, conversationId);
  assert.equal(f.calls.some((call) => call.path.endsWith("&after=9007199254740992")), true, "no Number rounding and no scan through intervening pages");
  assert.equal(f.document.activeElement.dataset.sequence, targetSequence);
  assert.equal(f.element("newer-messages").hidden, false);
  assert.match(f.element("new-messages").textContent, /récents/);
  await f.advance(3000);
  assert.doesNotMatch(contents(f.element("messages")), /beyond a gap/);
  assert.equal(f.inspect().states.get(conversationId).messages.size, 1);
});

test("an unavailable notification leaves the signed-in client in their conversation", async () => {
  const f = harness({ notification: id(914), intercept: (path) => path.endsWith("/open") ? response(404, { error: "not_found" }) : undefined });
  await flush(); assert.equal(f.inspect().ready, true); assert.equal(f.inspect().pendingNotification, null);
  assert.match(f.element("chat-status").textContent, /notification n’est plus disponible/); assert.equal(f.redirects.length, 0);
});

test("a PWA that reuses the existing window can deliver the next notification through a fragment change", async () => {
  const reference = id(915), f = harness({ intercept: (path) => path.endsWith("/open")
    ? response(200, { conversationId: id(101), messageId: id(501), sequence: "1" }) : undefined });
  await flush(); f.context.location.hash = `#notification=${reference}`; await f.event("hashchange");
  assert.equal(f.inspect().pendingNotification, null); assert.equal(f.context.location.hash, "");
  assert.equal(f.document.activeElement.dataset.sequence, "1"); assert.equal(f.redirects.length, 0);
});
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

test("quick replies append to the administrator draft, remain editable, and require the ordinary send action", async () => {
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin") }); await flush();
  for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush();
  f.element("message-body").value = "Private draft";
  await f.click("open-quick-replies"); assert.equal(f.element("quick-replies-dialog").open, true);
  const button = f.element("quick-replies-list").children.find(node => node.dataset.quickReply === "good-night");
  for (const handler of button.events.get("click")) handler({}); await flush();
  assert.equal(f.element("message-body").value, "Private draft\nBonne nuit, bisous 😘");
  assert.equal(f.element("quick-replies-dialog").open, false); assert.equal(f.state.posts, 0);
  assert.equal(f.inspect().states.get(f.inspect().selected).draft, f.element("message-body").value);
  await f.send(f.element("message-body").value + " Edited"); assert.equal(f.state.posts, 1);
  const sent = JSON.parse(f.calls.find(call => call.options.method === "POST" && /\/messages$/.test(call.path)).options.body);
  assert.equal(sent.body, "Private draft\nBonne nuit, bisous 😘 Edited");
});
test("quick replies reject clients, full drafts, suspended sending and stale choices after hiding or account replacement", async () => {
  const client = harness(); await flush(); await client.click("open-quick-replies");
  assert.equal(client.element("open-quick-replies").hidden, true); assert.equal(client.element("quick-replies-dialog").open, false);
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin") }); await flush();
  for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush();
  f.element("message-body").value = "x".repeat(4096); await f.click("open-quick-replies");
  let button = f.element("quick-replies-list").children[0];
  for (const handler of button.events.get("click")) handler({}); await flush();
  assert.equal(f.element("message-body").value.length, 4096); assert.equal(f.element("quick-replies-dialog").open, true);
  assert.match(f.element("quick-replies-status").textContent, /ne peut pas être ajoutée/);
  await f.hide(); assert.equal(f.element("quick-replies-dialog").open, false);
  for (const handler of button.events.get("click")) handler({}); await flush(); assert.equal(f.state.posts, 0);
  await f.show(); await f.click("open-quick-replies"); button = f.element("quick-replies-list").children[0];
  f.inspect().states.get(f.inspect().selected).conversation.canSend = false;
  for (const handler of button.events.get("click")) handler({}); await flush(); assert.equal(f.element("quick-replies-dialog").open, false);
  f.conversation().canSend = true; await f.hide(); f.state.currentSession = session(2, "B".repeat(43), "admin"); await f.show();
  for (const handler of button.events.get("click")) handler({}); await flush();
  assertOwner(f, 2, "B".repeat(43)); assert.equal(f.element("message-body").value, ""); assert.equal(f.element("quick-replies-list").children.length, 0); assert.equal(f.state.posts, 0);
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

test("empty event polls preserve a message and its focused delete control", async () => {
  const f = harness(); await flush(); await f.send("Keep my keyboard position");
  const messages = f.element("messages"), article = messages.children.at(-1), remove = article.querySelector(".delete-message");
  remove.focus(); assert.equal(f.document.activeElement, remove);
  await f.advance(3000);
  assert.ok(f.calls.some((call) => call.path.includes("/events?")), "a real polling cycle completed");
  assert.equal(f.document.activeElement, remove);
  assert.equal(messages.children.at(-1), article);
  assert.equal(article.querySelector(".delete-message"), remove);
  assert.equal(remove.isConnected, true); assert.equal(f.document.activeElement, remove);
  assert.match(contents(article), /Keep my keyboard position/);
});

function photoFixture(f, { sender = "me", messageId = id(800), sequence = "1" } = {}) {
  const conv = f.conversation();
  return { id: messageId, sequence, sender, body: "A private photo", createdAt: now, deletedAt: null, clientMessageId: null,
    media: { id: id(801), width: 1000, height: 800, thumbnailWidth: 400, thumbnailHeight: 320,
      fullUrl: `/api/media/client/conversations/${conv.id}/messages/${messageId}/full`, thumbnailUrl: `/api/media/client/conversations/${conv.id}/messages/${messageId}/thumb` } };
}
const photoResponse = () => ({ ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => new Blob(["synthetic private photo"], { type: "image/jpeg" }) });

test("a receipt-only poll updates the read receipt while preserving the photo and focused control", async () => {
  let f;
  f = harness({ intercept: (path) => {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.endsWith("/messages?limit=50")) return response(200, { conversation: f.conversation(), messages: [photoFixture(f)], eventCursor: "1", hasMoreBefore: false });
    if (path.endsWith("/thumb")) return photoResponse();
    return undefined;
  } }); await flush();
  const article = f.element("messages").children[0], photo = article.querySelector(".photo-open"), image = photo.querySelector("img"), remove = article.querySelector(".delete-message");
  assert.ok(image); assert.match(contents(article), /Envoyé/); photo.focus();
  f.conversation().peerReadSequence = "1";
  await f.advance(3000);
  assert.equal(f.element("messages").children[0], article);
  assert.equal(article.querySelector(".photo-open"), photo); assert.equal(photo.querySelector("img"), image);
  assert.equal(article.querySelector(".delete-message"), remove); assert.equal(f.document.activeElement, photo);
  assert.match(contents(article), /Lu/); assert.doesNotMatch(contents(article), /Envoyé/);
  assert.equal(f.calls.filter((call) => call.path.endsWith("/thumb")).length, 1);
  assert.equal(f.createdUrls.length, 1); assert.equal(f.revoked.length, 0);
});

test("new messages and photo deletion update the history without replacing unaffected messages", async () => {
  let f, events = [];
  f = harness({ intercept: (path) => {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.endsWith("/messages?limit=50")) return response(200, { conversation: f.conversation(), messages: [photoFixture(f)], eventCursor: "1", hasMoreBefore: false });
    if (path.endsWith("/thumb")) return photoResponse();
    if (path.includes("/events?")) { const result = events; events = []; return response(200, { conversation: f.conversation(), events: result, nextCursor: f.conversation().latestEventSequence, hasMore: false }); }
    return undefined;
  } }); await flush();
  const messages = f.element("messages"), first = messages.children[0], originalPhoto = first.querySelector(".photo-open");
  const incoming = { id: id(802), sequence: "2", sender: "peer", body: "A genuinely new message", createdAt: now + 1000, deletedAt: null, clientMessageId: null };
  Object.assign(f.conversation(), { latestSequence: "2", latestEventSequence: "2" }); events = [{ kind: "message", sequence: "2", message: incoming }];
  await f.advance(3000);
  assert.deepEqual(messages.children.map((item) => item.dataset.sequence), ["1", "2"]);
  assert.equal(messages.children[0], first); assert.equal(first.querySelector(".photo-open"), originalPhoto);
  const second = messages.children[1]; assert.match(contents(second), /A genuinely new message/);
  f.conversation().latestEventSequence = "3";
  events = [{ kind: "delete", sequence: "3", message: { ...photoFixture(f), body: null, media: undefined, deletedAt: now + 2000 } }];
  await f.advance(3000);
  assert.equal(messages.children[1], second); assert.match(contents(messages.children[0]), /Message supprimé/);
  assert.equal(messages.children[0].querySelectorAll("img").length, 0); assert.equal(messages.children[0].querySelector(".photo-open"), null);
  assert.deepEqual(f.revoked, f.createdUrls);
});

test("loading older messages prepends in sequence and preserves the existing focused control", async () => {
  let f;
  const newer = { id: id(804), sequence: "2", sender: "me", body: "Already on screen", createdAt: now + 1000, deletedAt: null, clientMessageId: null };
  const older = { id: id(803), sequence: "1", sender: "peer", body: "Older history", createdAt: now, deletedAt: null, clientMessageId: null };
  f = harness({ intercept: (path) => {
    if (path.endsWith("/messages?limit=50")) { Object.assign(f.conversation(), { latestSequence: "2", latestEventSequence: "2" }); return response(200, { conversation: f.conversation(), messages: [newer], eventCursor: "2", hasMoreBefore: true, nextBefore: "2" }); }
    if (path.includes("/messages?before=")) return response(200, { conversation: f.conversation(), messages: [older], hasMoreBefore: false, nextBefore: null });
    return undefined;
  } }); await flush();
  const messages = f.element("messages"), article = messages.children[0], remove = article.querySelector(".delete-message"); remove.focus();
  await f.click("older-messages");
  assert.deepEqual(messages.children.map((item) => item.dataset.sequence), ["1", "2"]);
  assert.match(contents(messages.children[0]), /Older history/); assert.equal(messages.children[1], article);
  assert.equal(article.querySelector(".delete-message"), remove); assert.equal(f.document.activeElement, remove);
});

test("same-session visibility return reloads revoked photos and waits for their new load before read eligibility", async () => {
  let f, hold = false; const replacement = pause();
  f = harness({ intercept: (path) => {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.endsWith("/messages?limit=50")) return response(200, { conversation: f.conversation(), messages: [{ ...photoFixture(f, { sender: "peer" }), body: "" }], eventCursor: "1", hasMoreBefore: false });
    if (path.endsWith("/thumb")) return hold ? replacement.promise : photoResponse();
    return undefined;
  } }); await flush();
  const firstPhoto = f.element("messages").querySelector(".photo-open"), firstImage = firstPhoto.querySelector("img");
  for (const handler of firstImage.events.get("load") ?? []) handler({});
  assert.equal(firstPhoto.dataset.loaded, "true");
  await f.hide(); assert.deepEqual(f.revoked, f.createdUrls); assert.equal(firstImage.src, "");
  hold = true; await f.show();
  const photo = f.element("messages").querySelector(".photo-open");
  assert.notEqual(photo.dataset.loaded, "true");
  assert.equal(f.calls.filter((call) => call.path.endsWith("/thumb")).length, 2);
  for (const handler of firstImage.events.get("load") ?? []) handler({});
  await f.advance(150);
  assert.notEqual(photo.dataset.loaded, "true", "a late load from the revoked image cannot mark its replacement ready");
  assert.equal(f.calls.filter((call) => call.options.method === "POST" && call.path.endsWith("/read")).length, 0);
  replacement.resolve(photoResponse()); await flush();
  const image = photo.querySelector("img"); assert.ok(image); assert.notEqual(image, firstImage);
  assert.notEqual(photo.dataset.loaded, "true"); assert.equal(f.createdUrls.length, 2);
  for (const handler of image.events.get("load") ?? []) handler({});
  assert.equal(photo.dataset.loaded, "true");
  await f.advance(150);
  assert.equal(f.calls.filter((call) => call.options.method === "POST" && call.path.endsWith("/read")).length, 1);
});

test("failed photos retry on the next poll without replacing their message or photo control", async () => {
  for (const failure of ["network", "decoding"]) {
    let f, thumbnails = 0;
    f = harness({ intercept: (path) => {
      if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
      if (path.endsWith("/messages?limit=50")) return response(200, { conversation: f.conversation(), messages: [photoFixture(f)], eventCursor: "1", hasMoreBefore: false });
      if (path.endsWith("/thumb")) { thumbnails += 1; return thumbnails === 1 && failure === "network" ? response(503, { error: "unavailable" }) : photoResponse(); }
      return undefined;
    } }); await flush();
    const article = f.element("messages").children[0], photo = article.querySelector(".photo-open"), failedImage = photo.querySelector("img");
    if (failure === "decoding") { assert.ok(failedImage); for (const handler of failedImage.events.get("error") ?? []) handler({}); }
    assert.match(contents(photo), /Photo indisponible/); assert.equal(thumbnails, 1); photo.focus();
    await f.advance(3000);
    assert.equal(f.element("messages").children[0], article); assert.equal(article.querySelector(".photo-open"), photo);
    assert.equal(f.document.activeElement, photo); assert.equal(thumbnails, 2); const replacement = photo.querySelector("img"); assert.ok(replacement);
    assert.doesNotMatch(contents(photo), /Photo indisponible/);
    if (failedImage) {
      for (const handler of failedImage.events.get("load") ?? []) handler({});
      for (const handler of failedImage.events.get("error") ?? []) handler({});
      assert.notEqual(photo.dataset.loaded, "true", "callbacks from the failed image cannot mark its replacement loaded");
      assert.equal(photo.querySelector("img"), replacement, "a late error cannot remove the replacement image");
      assert.deepEqual(f.revoked, [f.createdUrls[0]], "a late error cannot revoke the replacement URL");
      for (const handler of replacement.events.get("load") ?? []) handler({});
      assert.equal(photo.dataset.loaded, "true");
    }
  }
});

test("a photo response arriving after its message deletion cannot restore the private image", async () => {
  let f, events = []; const thumbnail = pause();
  f = harness({ intercept: (path) => {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.endsWith("/messages?limit=50")) return response(200, { conversation: f.conversation(), messages: [photoFixture(f)], eventCursor: "1", hasMoreBefore: false });
    if (path.endsWith("/thumb")) return thumbnail.promise;
    if (path.includes("/events?")) { const current = events; events = []; return response(200, { conversation: f.conversation(), events: current, nextCursor: f.conversation().latestEventSequence, hasMore: false }); }
    return undefined;
  } }); await flush(); assert.equal(f.calls.filter((call) => call.path.endsWith("/thumb")).length, 1);
  f.conversation().latestEventSequence = "2";
  events = [{ kind: "delete", sequence: "2", message: { ...photoFixture(f), body: null, media: undefined, deletedAt: now + 2000 } }];
  await f.advance(3000); thumbnail.resolve(photoResponse()); await flush();
  assert.match(contents(f.element("messages")), /Message supprimé/);
  assert.equal(f.element("messages").querySelectorAll("img").length, 0); assert.equal(f.createdUrls.length, 0);
});

test("returning offline keeps private work masked, bounds retries, then resumes on online without replaying a send", async () => {
  let unavailable = false;
  const f = harness({ intercept: (path, options) => {
    if (unavailable && path.endsWith("/session")) return response(503, { error: "unavailable" });
    if (options.method === "POST" && path.endsWith("/messages")) throw new Error("synthetic interrupted response");
    return undefined;
  } }); await flush(); await f.send("Keep this uncertain draft");
  const pending = f.inspect().states.get(f.inspect().selected).pending, key = pending.clientMessageId;
  assert.equal(pending.status, "retry"); await f.hide(); unavailable = true; await f.show();
  assert.equal(f.element("workspace").hidden, true); assert.equal(f.redirects.length, 0);
  assert.equal(f.element("retry-connection").hidden, false);
  const beforeRetries = f.calls.filter((call) => call.path.endsWith("/session")).length;
  await f.advance(22000);
  const afterRetries = f.calls.filter((call) => call.path.endsWith("/session")).length;
  assert.equal(afterRetries - beforeRetries, 3);
  await f.advance(30000); assert.equal(f.calls.filter((call) => call.path.endsWith("/session")).length, afterRetries);
  assert.equal(posts(f).length, 1); assert.equal(f.inspect().states.get(f.inspect().selected).pending.clientMessageId, key);
  unavailable = false; await f.event("online"); assertOwner(f, 1);
  assert.equal(f.element("message-body").value, "Keep this uncertain draft");
  assert.equal(f.inspect().states.get(f.inspect().selected).pending.clientMessageId, key);
  assert.equal(posts(f).length, 1, "resuming never retries a mutation automatically");
  assert.equal(f.element("retry-connection").hidden, true);
});

test("a genuine unauthorized resume purges drafts while temporary proof failures do not redirect", async () => {
  for (const failure of ["network", 503, 403, 401]) {
    let fail = false;
    const f = harness({ intercept: (path) => {
      if (!fail || !path.endsWith("/session")) return undefined;
      if (failure === "network") throw new Error("synthetic offline");
      return response(failure, { error: failure === 401 ? "authentication_required" : "request_rejected" });
    } }); await flush();
    f.element("message-body").value = "Private draft"; for (const handler of f.element("message-body").events.get("input")) handler({});
    await f.hide(); fail = true; await f.show();
    if (failure === 401) { assert.equal(f.inspect().states.size, 0); assert.deepEqual(f.redirects, ["/access"]); }
    else { assert.equal(f.inspect().states.size, 1); assert.equal(f.redirects.length, 0); assert.equal(f.element("workspace").hidden, true); }
  }
});

test("initial temporary outage can recover from the visible retry button without reloading", async () => {
  let unavailable = true;
  const f = harness({ intercept: (path) => unavailable && path.endsWith("/session") ? response(503, {}) : undefined }); await flush();
  assert.equal(f.inspect().ready, false); assert.equal(f.element("retry-connection").hidden, false); assert.equal(f.redirects.length, 0);
  unavailable = false; await f.click("retry-connection"); assertOwner(f, 1);
  assert.equal(f.redirects.length, 0); assert.equal(f.element("retry-connection").hidden, true);
});

test("long administrator sessions use bounded server checks and survive a hidden timer wakeup", async () => {
  const persistent = { ...session(1, "A".repeat(43), "admin"), expiresAt: now + 180 * 86400000 };
  const f = harness({ currentSession: persistent }); await flush(); assertOwner(f, 1);
  assert.ok([...f.timers.values()].every((timer) => timer.at - now <= 300000), "no browser timeout receives the 180-day duration");
  const before = f.calls.length; await f.hide(); await f.advance(300000);
  assert.equal(f.redirects.length, 0); assert.equal(f.calls.length, before, "hidden session checks do not poll or renew");
  await f.show(); assertOwner(f, 1); assert.equal(f.redirects.length, 0);
});

test("drafts warn before leaving and remain per conversation without browser persistence", async () => {
  const f = harness(); await flush(); let prevented = false;
  const event = { preventDefault() { prevented = true; } };
  await f.event("beforeunload", event); assert.equal(prevented, false);
  f.element("message-body").value = "Do not lose this draft"; for (const handler of f.element("message-body").events.get("input")) handler({});
  await f.hide(); await f.event("beforeunload", event); assert.equal(prevented, true); assert.equal(event.returnValue, "");
  await f.show(); assert.equal(f.element("message-body").value, "Do not lose this draft");
  assert.equal(f.context.localStorage, undefined); assert.equal(f.context.sessionStorage, undefined);
  await f.click("logout"); prevented = false; await f.event("beforeunload", event); assert.equal(prevented, false);
});

test("message deletion requires explicit confirmation and cancellation returns focus without a request", async () => {
  let f;
  f = harness({ intercept: (path) => path.endsWith("/messages?limit=50") ? response(200, {
    conversation: f.conversation(), messages: [{ id: id(880), sequence: "1", sender: "me", body: "Keep until confirmed", createdAt: now, deletedAt: null }], eventCursor: "1", hasMoreBefore: false,
  }) : path.endsWith("/delete") ? response(200, { message: { id: id(880), sequence: "1", sender: "me", body: null, createdAt: now, deletedAt: now } }) : undefined }); await flush();
  const button = f.element("messages").children[0].querySelector(".delete-message"); button.focus();
  for (const handler of button.events.get("click")) handler({}); await flush();
  assert.equal(f.element("confirm-delete").open, true); assert.equal(f.document.activeElement, f.element("cancel-delete"));
  assert.equal(f.calls.filter((call) => call.path.endsWith("/delete")).length, 0);
  await f.click("cancel-delete"); assert.equal(f.document.activeElement, button); assert.equal(f.element("confirm-delete").open, false);
  for (const handler of button.events.get("click")) handler({}); await flush(); await f.click("accept-delete");
  assert.equal(f.calls.filter((call) => call.path.endsWith("/delete")).length, 1); assert.match(contents(f.element("messages")), /Message supprimé/);
});


test("a local image preparation failure releases the untouched send for correction without a private POST", async () => {
  const f = harness({ prepare: async () => { throw Object.assign(new Error("synthetic oversized dimensions"), { code: "media_dimensions" }); },
    intercept: (path) => path === "/api/media/client/capabilities" ? response(200, { enabled: true }) : undefined }); await flush();
  const file = new Blob(["synthetic photo"], { type: "image/jpeg" });
  f.element("image-file").files = [file]; for (const handler of f.element("image-file").events.get("change")) handler({});
  await f.send("Keep the caption");
  const state = f.inspect().states.get(f.inspect().selected);
  assert.equal(state.pending, null); assert.equal(state.imageDraft.file, file); assert.equal(state.draft, "Keep the caption");
  assert.equal(f.element("pick-image").disabled, false); assert.equal(f.element("message-body").disabled, false);
  assert.match(f.element("chat-status").textContent, /Cette photo est trop grande/);
  assert.equal(f.calls.filter((call) => call.options.method === "POST" && /\/(messages|assets)$/.test(call.path)).length, 0);
});

test("administrator conversation changes preserve each memory-only draft", async () => {
  let f; const secondId = id(999);
  const secondConversation = () => ({ ...f.conversation(), id: secondId, peerName: "Other synthetic peer" });
  f = harness({ currentSession: session(1, "A".repeat(43), "admin"), intercept: (path) => {
    if (path.startsWith("/api/chat/admin/conversations?")) return response(200, { conversations: [f.conversation(), secondConversation()], nextCursor: null, hasMore: false });
    if (path.startsWith(`/api/chat/admin/conversations/${secondId}/messages?`)) return response(200, { conversation: secondConversation(), messages: [], eventCursor: "0", hasMoreBefore: false });
    if (path.startsWith(`/api/chat/admin/conversations/${secondId}/events?`)) return response(200, { conversation: secondConversation(), events: [], nextCursor: "0", hasMore: false });
    return undefined;
  } }); await flush();
  const choose = async (id) => { const button = f.element("conversations").children.find((item) => item.dataset.conversationId === id); for (const handler of button.events.get("click")) handler({}); await flush(); };
  const draft = (text) => { f.element("message-body").value = text; for (const handler of f.element("message-body").events.get("input")) handler({}); };
  const firstId = f.conversation().id; await choose(firstId); draft("First private draft");
  await choose(secondId); assert.equal(f.element("message-body").value, ""); draft("Second private draft");
  await choose(firstId); assert.equal(f.element("message-body").value, "First private draft");
  await choose(secondId); assert.equal(f.element("message-body").value, "Second private draft");
  assert.equal(posts(f).length, 0); assert.equal(f.context.localStorage, undefined);
});

test("a delayed close event from a cancelled dialog cannot cancel its next confirmation", async () => {
  let f;
  f = harness({ intercept: (path) => path.endsWith("/messages?limit=50") ? response(200, {
    conversation: f.conversation(), messages: [{ id: id(881), sequence: "1", sender: "me", body: "Keep the current confirmation", createdAt: now, deletedAt: null }], eventCursor: "1", hasMoreBefore: false,
  }) : path.endsWith("/delete") ? response(200, { message: { id: id(881), sequence: "1", sender: "me", body: null, createdAt: now, deletedAt: now } }) : undefined });
  await flush();
  const dialog = f.element("confirm-delete"), queuedCloseEvents = [];
  // Native dialog.close() queues its close event; it need not be delivered
  // before the next keyboard activation reopens the same dialog.
  dialog.close = () => { dialog.open = false; queuedCloseEvents.push(...dialog.events.get("close")); };
  const opener = f.element("messages").children[0].querySelector(".delete-message"); opener.focus();
  for (const handler of opener.events.get("click")) handler({}); await flush(); await f.click("cancel-delete");
  assert.equal(dialog.open, false); assert.equal(f.document.activeElement, opener);
  for (const handler of opener.events.get("click")) handler({}); await flush();
  assert.equal(dialog.open, true); assert.equal(f.document.activeElement, f.element("cancel-delete"));
  for (const handler of queuedCloseEvents.splice(0)) handler({}); await flush();
  assert.equal(dialog.open, true, "an old close event must not dismiss a currently open confirmation");
  assert.equal(f.calls.filter((call) => call.path.endsWith("/delete")).length, 0);
  await f.click("accept-delete");
  assert.equal(f.calls.filter((call) => call.path.endsWith("/delete")).length, 1);
  assert.match(contents(f.element("messages")), /Message supprimé/);
});
