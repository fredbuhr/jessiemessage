import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { quickReplyOptions, appendQuickReply } from "../public/quick-replies.js";
import { emojiCategories, emojiOptions, insertEmoji } from "../public/emoji-catalog.js";
import { webcrypto } from "node:crypto";

const source = await readFile(new URL("../public/chat.js", import.meta.url), "utf8");
const sessionClockSource = await readFile(new URL("../public/session-clock.js", import.meta.url), "utf8");
const modelSource = await readFile(new URL("../public/chat-model.js", import.meta.url), "utf8");
const modelExports = [...modelSource.matchAll(/export function ([a-zA-Z0-9_]+)\(/g)].map((match) => match[1]);
const html = await readFile(new URL("../public/chat.html", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../public/i18n.js", import.meta.url), "utf8");
const catalogueSource = await readFile(new URL("../public/i18n-chat.js", import.meta.url), "utf8");
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
    this.open = false; this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100; this._text = ""; this.textWrites = [];
    this._classes = new Set(); const classes = this._classes;
    this.classList = { add: (...values) => values.forEach((value) => classes.add(value)), remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value), toggle: (value, include = !classes.has(value)) => { if (include) classes.add(value); else classes.delete(value); return include; } };
  }
  set id(value) { this._id = value; this.attributes.set("id", value); this.registry?.set(value, this); } get id() { return this._id; }
  set className(value) { this._classes.clear(); for (const item of value.split(/\s+/).filter(Boolean)) this._classes.add(item); } get className() { return [...this._classes].join(" "); }
  get isConnected() { return this.parentElement ? this.parentElement.isConnected : this._connected; }
  get parentNode() { return this.parentElement; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] ?? null; }
  get firstElementChild() { return this.firstChild; }
  get nextSibling() { if (!this.parentElement) return null; return this.parentElement.children[this.parentElement.children.indexOf(this) + 1] ?? null; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); this.textWrites.push(String(value)); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  addEventListener(name, handler) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(handler); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "id") this.id = value; if (name === "class") this.className = value; if (name === "placeholder") this.placeholder = value; if (name === "hidden") this.hidden = true; }
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
  matches(selector) { return selector.split(",").some((part) => { const value = part.trim();
    if (value.startsWith("[")) return this.getAttribute(value.slice(1, -1)) !== null;
    if (value.startsWith(".")) return this._classes.has(value.slice(1));
    if (value.startsWith("#")) return this.id === value.slice(1);
    return this.tagName === value;
  }); }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  getBoundingClientRect() { return { top: 0, bottom: 100, height: 100 }; }
  focus() { if (this.isConnected && this.registry?.document) this.registry.document.activeElement = this; }
  showModal() { this.open = true; this.querySelector("button")?.focus(); }
  close() { this.open = false; for (const handler of this.events.get("close") ?? []) handler({}); }
}
function parsePage(nodes) {
  const root = new Element("document", nodes), stack = [root]; root._connected = true;
  const voids = new Set(["meta", "link", "img", "input", "br"]);
  for (const match of html.matchAll(/<![^>]*>|<\/([a-z][a-z0-9-]*)\s*>|<([a-z][a-z0-9-]*)([^>]*)>|([^<]+)/gi)) {
    if (match[1]) { if (stack.at(-1).tagName === match[1]) stack.pop(); continue; }
    if (match[2]) {
      const node = new Element(match[2], nodes);
      for (const attribute of match[3].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/gi)) node.setAttribute(attribute[1], attribute[2] ?? "");
      stack.at(-1).append(node); if (!voids.has(node.tagName)) stack.push(node);
    } else if (match[4]) stack.at(-1)._text += match[4];
  }
  return root;
}
function harness({ currentSession = session(), visible = true, intercept = null, language = "fr", mobile = false } = {}) {
  const nodes = new Map(), documentEvents = new Map(), windowEvents = new Map(), calls = [], timers = new Map(), redirects = [], revoked = [], createdUrls = [];
  let timerId = 0, time = now, blobId = 0;
  const root = parsePage(nodes), body = root.querySelector("body");
  const element = (value) => nodes.get(value);
  const addEvent = (map, name, handler) => { if (!map.has(name)) map.set(name, []); map.get(name).push(handler); };
  const document = { visibilityState: visible ? "visible" : "hidden", body, head: root.querySelector("head"), documentElement: root.querySelector("html"),
    getElementById: (value) => { const item = nodes.get(value); return item?.isConnected ? item : null; },
    createElement: (tag) => new Element(tag, nodes), createDocumentFragment: () => new Element("fragment", nodes),
    querySelector: (selector) => root.querySelector(selector), querySelectorAll: (selector) => root.querySelectorAll(selector),
    addEventListener: (name, handler) => addEvent(documentEvents, name, handler) };
  nodes.document = document; document.activeElement = body;
  const state = { currentSession, conversations: new Map(), messages: new Map(), posts: 0 };
  const conversation = (owner = state.currentSession?.user.id) => {
    if (!state.conversations.has(owner)) state.conversations.set(owner, { id: id(100 + Number.parseInt(owner, 16)), clientId: owner, clientPseudonym: `Synthetic ${owner}`,
      peerName: "Messages privés", createdAt: now, closedAt: null, lastActivityAt: now, latestSequence: "1", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 1, canSend: true });
    return state.conversations.get(owner);
  };
  const storedMessages = (conv) => { if (!state.messages.has(conv.id)) state.messages.set(conv.id, [{ id: id(500 + Number.parseInt(conv.clientId, 16)), sequence: "1", sender: "peer", body: "Envoyer", createdAt: now, deletedAt: null, clientMessageId: null }]); return state.messages.get(conv.id); };
  const context = vm.createContext({ __emojis: { emojiCategories, emojiOptions, insertEmoji }, __quickReplies: { quickReplyOptions, appendQuickReply }, document, window: { addEventListener: (name, handler) => addEvent(windowEvents, name, handler) }, navigator: { language: language === "fr" ? "fr-FR" : "en-US" },
    sessionStorage: { getItem: () => null, setItem() {} },
    location: { pathname: currentSession?.user.role === "admin" ? "/admin/messages" : "/messages", replace: (path) => redirects.push(path), reload() { redirects.push("reload"); } },
    getComputedStyle: (node) => {
      const workspace = element("workspace"), admin = workspace.classList.contains("is-admin"), selected = workspace.classList.contains("selected");
      const hidden = node.hidden || node.tagName === "dialog" && !node.open || mobile && admin && (node.id === "inbox" && selected || node.id === "chat" && !selected);
      return { display: hidden ? "none" : "block", visibility: "visible" };
    },
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
  vm.runInContext(i18nSource, context, { filename: "public/i18n.js" });
  vm.runInContext(catalogueSource, context, { filename: "public/i18n-chat.js" });
  vm.runInContext(sessionClockSource, context, { filename: "public/session-clock.js" });
  vm.runInContext(`globalThis.__model = (() => {${modelSource.replaceAll("export function ", "function ")}\nreturn {${modelExports.join(",")}};})();`, context, { filename: "public/chat-model.js" });
  const executable = source.replace('import { emojiCategories, emojiOptions, insertEmoji } from "/emoji-catalog.js";', 'const {emojiCategories,emojiOptions,insertEmoji} = __emojis;').replace('import { quickReplyOptions, appendQuickReply } from "/quick-replies.js";', 'const {quickReplyOptions,appendQuickReply} = __quickReplies;').replace('import { prepareImageUpload } from "/image-preparation.js";', 'const prepareImageUpload = async (file) => file;').replace(/^import \{([^\n]+)\} from "\/chat-model\.js";/, "const {$1} = __model;") +
    "\nglobalThis.__inspect = () => ({ready, sessionOwner, selected, states, inbox, sendBusy, cycleRunning, generation, visibilityGeneration});";
  vm.runInContext(executable, context, { filename: "public/chat.js", importModuleDynamically: async () => { throw new Error("Optional feature disabled in fixture"); } });
  return { element, document, state, calls, redirects, timers, revoked, createdUrls, context, conversation, inspect: () => context.__inspect(),
    async event(name, data = {}) { const handlers = documentEvents.get(name) ?? windowEvents.get(name); assert.ok(handlers?.length, name); for (const handler of handlers) handler(data); await flush(); },
    async hide() { document.visibilityState = "hidden"; await this.event("visibilitychange"); },
    async show() { document.visibilityState = "visible"; await this.event("visibilitychange"); },
    language: (value) => context.JessieI18n.setLanguage(value), run: (code) => vm.runInContext(code, context),
    async click(name) { for (const handler of element(name).events.get("click") ?? []) handler({ currentTarget: element(name), preventDefault() {} }); await flush(); },
    async send(body) { element("message-body").value = body; for (const handler of element("message-body").events.get("input") ?? []) handler({});
      for (const handler of element("composer").events.get("submit") ?? []) handler({ preventDefault() {} }); await flush(); },
    async advance(milliseconds) { const target = time + milliseconds; let remaining = 100;
      while (remaining-- > 0) { const next = [...timers].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break;
        timers.delete(next[0]); time = next[1].at; next[1].handler(); await flush(); }
      assert.ok(remaining > 0, "bounded timer fixture"); time = target; await flush(); },
  };
}


const announcement = (f) => f.element("message-announcement");
const message = (value, sender = "peer", extra = {}) => ({ id: id(1000 + value), sequence: String(value), sender, body: `Synthetic private content ${value}`, createdAt: now, deletedAt: null, ...extra });
const event = (value, item, kind = "message") => ({ sequence: String(value), kind, message: item });
function liveHarness(options = {}) {
  let f; const pages = [];
  f = harness({ ...options, intercept(path, request, state, calls) {
    const custom = options.intercept?.(path, request, state, calls, f); if (custom !== undefined) return custom;
    if (path.endsWith("/messages?limit=50")) {
      const conversation = f.conversation(); Object.assign(conversation, { latestSequence: "10", latestEventSequence: "20" });
      return response(200, { conversation, messages: [message(10)], eventCursor: "20", hasMoreBefore: true, nextBefore: "10" });
    }
    if (path.includes("/messages?before=")) return response(200, { conversation: f.conversation(), messages: [message(9)], eventCursor: "20", hasMoreBefore: false, nextBefore: null });
    if (path.includes("/events?")) {
      const page = pages.shift() ?? { events: [], nextCursor: f.run("currentState().eventCursor"), hasMore: false };
      return response(200, { conversation: f.conversation(), ...page });
    }
    return undefined;
  } });
  return Object.assign(f, {
    push(events, { more = false, next = events.at(-1)?.sequence ?? "20", latest = null } = {}) {
      if (latest !== null) f.conversation().latestSequence = String(latest);
      pages.push({ events, nextCursor: next, hasMore: more });
    },
    async fetchEvents() { await f.run("fetchEvents(currentState())"); await flush(); },
  });
}
const messagePosts = (f) => f.calls.filter((call) => call.options.method === "POST" && /\/(messages|assets)(?:$|\?)/.test(call.path));
function quietViewport(f) { Object.assign(f.element("message-scroll"), { scrollHeight: 2000, clientHeight: 100, scrollTop: 0 }); }

test("the dedicated polite live region starts empty and never contains history or private message content", async () => {
  const f = liveHarness(); await flush();
  assert.equal(announcement(f).getAttribute("role"), "status"); assert.equal(announcement(f).getAttribute("aria-live"), "polite"); assert.equal(announcement(f).getAttribute("aria-atomic"), "true");
  assert.equal(announcement(f).textContent, ""); assert.equal(f.element("messages").contains(announcement(f)), false);
  const count = announcement(f).textWrites.length;
  quietViewport(f); await f.run("loadOlder()"); await f.fetchEvents();
  assert.equal(announcement(f).textContent, ""); assert.equal(announcement(f).textWrites.length, count);
  assert.equal(f.element("messages").children[0].querySelector(".bubble").textContent, "Synthetic private content 9");
});

test("only fresh living peer messages increase the cumulative count; empty polls and unrelated events leave it intact", async () => {
  const f = liveHarness(); await flush(); quietViewport(f);
  const original = f.element("messages").children[0]; f.element("message-body").value = "Untouched synthetic draft"; f.element("message-body").focus();
  f.push([event(21, message(11, "peer", { body: "Never announce this private sentence" }))], { latest: 11 }); await f.fetchEvents();
  assert.equal(announcement(f).textContent, "Nouveau message reçu."); const afterFirst = announcement(f).textWrites.length;
  await f.run("poll()"); await flush(); assert.equal(announcement(f).textWrites.length, afterFirst); assert.equal(announcement(f).textContent, "Nouveau message reçu.");
  f.push([event(21, message(11))], { next: "21" }); await f.fetchEvents();
  f.push([event(22, message(11))]); await f.fetchEvents();
  f.conversation().peerReadSequence = "11"; await f.fetchEvents();
  f.push([event(23, message(12, "me"))], { latest: 12 }); await f.fetchEvents();
  f.push([event(24, message(13)), event(25, message(13, "peer", { body: null, deletedAt: now }), "delete")], { latest: 13 }); await f.fetchEvents();
  f.push([event(26, message(9))]); await f.fetchEvents();
  assert.equal(announcement(f).textWrites.length, afterFirst); assert.equal(announcement(f).textContent, "Nouveau message reçu.");
  f.push([event(27, message(14)), event(28, message(15))], { latest: 15 }); await f.fetchEvents();
  assert.equal(announcement(f).textContent, "3 nouveaux messages reçus.");
  assert.equal(f.element("messages").children.find((node) => node.dataset.sequence === "10"), original);
  assert.equal(f.document.activeElement, f.element("message-body")); assert.equal(f.element("message-body").value, "Untouched synthetic draft"); assert.equal(messagePosts(f).length, 0);
  assert.doesNotMatch(announcement(f).textContent, /Synthetic|private|Messages privés|Never announce/);
});

test("metadata describing later pages never suppresses fresh messages on pages two and three", async () => {
  const f = liveHarness(); await flush(); quietViewport(f);
  f.push([event(21, message(11))], { latest: 99, more: true });
  f.push([event(22, message(12))], { more: true });
  f.push([event(23, message(13))]);
  await f.fetchEvents(); assert.equal(announcement(f).textContent, "3 nouveaux messages reçus.");
  const writes = announcement(f).textWrites.length;
  // A discarded old event cannot advance the accepted announcement baseline.
  f.push([event(21, message(90)), event(24, message(14))]); await f.fetchEvents();
  assert.equal(announcement(f).textContent, "4 nouveaux messages reçus."); assert.equal(announcement(f).textWrites.length, writes + 1);
});

test("language switching clears the spoken text without replay or network and preserves the cumulative count", async () => {
  const f = liveHarness(); await flush(); f.push([event(21, message(11))], { latest: 11 }); await f.fetchEvents();
  const calls = f.calls.length; f.language("en");
  assert.equal(announcement(f).textContent, ""); assert.equal(f.calls.length, calls);
  await f.fetchEvents(); assert.equal(announcement(f).textContent, "");
  f.push([event(22, message(12))], { latest: 12 }); await f.fetchEvents();
  assert.equal(announcement(f).textContent, "2 new messages received.");
  assert.equal(announcement(f).getAttribute("data-jm-i18n-bound"), null);
  f.language("fr"); assert.equal(announcement(f).textContent, "");
  f.push([event(23, message(13))], { latest: 13 }); await f.fetchEvents(); assert.equal(announcement(f).textContent, "3 nouveaux messages reçus.");
});

test("hide, pagehide and session replacement purge announcements and late responses cannot speak", async () => {
  const gate = pause(); let hold = false;
  const f = liveHarness({ intercept: (path) => hold && path.includes("/events?") ? gate.promise : undefined }); await flush();
  f.push([event(21, message(11))], { latest: 11 }); await f.fetchEvents(); assert.notEqual(announcement(f).textContent, "");
  hold = true; const late = f.run("fetchEvents(currentState())"); await flush(); await f.hide();
  assert.equal(announcement(f).textContent, "");
  gate.resolve(response(200, { conversation: f.conversation(), events: [event(22, message(12))], nextCursor: "22", hasMore: false }));
  await assert.rejects(late, (error) => error.stale === true); assert.equal(announcement(f).textContent, "");
  hold = false; f.state.currentSession = session(2, "B".repeat(43)); await f.show();
  assert.equal(announcement(f).textContent, ""); assert.equal(f.inspect().sessionOwner.id, id(2));
  f.push([event(21, message(11))], { latest: 11 }); await f.fetchEvents(); assert.equal(announcement(f).textContent, "Nouveau message reçu.");
  await f.event("pagehide"); assert.equal(announcement(f).textContent, ""); assert.equal(f.inspect().states.size, 0);
});

test("resuming visible catch-up remains silent across more than three pages before arming live announcements", async () => {
  const f = liveHarness(); await flush(); await f.hide(); await f.show();
  f.push([event(21, message(11))], { latest: 14, more: true }); f.push([event(22, message(12))], { more: true }); f.push([event(23, message(13))], { more: true });
  f.push([event(24, message(14))]); await f.fetchEvents(); assert.equal(announcement(f).textContent, "");
  await f.fetchEvents(); assert.equal(announcement(f).textContent, "");
  f.push([event(25, message(15))], { latest: 15 }); await f.fetchEvents(); assert.equal(announcement(f).textContent, "Nouveau message reçu.");
});

function twoConversationHarness({ mobile = true, holdSecond = null } = {}) {
  let f; const firstId = id(101), secondId = id(102);
  const conversations = new Map([[firstId, { id: firstId, clientId: id(1), peerName: "Synthetic first", createdAt: now, closedAt: null, latestSequence: "1", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 0, canSend: true }],
    [secondId, { id: secondId, clientId: id(2), peerName: "Synthetic second", createdAt: now, closedAt: null, latestSequence: "1", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 0, canSend: true }]]);
  f = harness({ currentSession: session(1, "A".repeat(43), "admin"), mobile, intercept(path) {
    if (/\/conversations\?/.test(path)) return response(200, { conversations: [...conversations.values()], hasMore: false, nextCursor: null });
    const match = /\/conversations\/([a-f0-9]{32})\/(messages|events)/.exec(path); if (!match) return undefined;
    const conversation = conversations.get(match[1]);
    if (match[2] === "events") return response(200, { conversation, events: [], nextCursor: "1", hasMore: false });
    if (match[1] === secondId && holdSecond) return holdSecond.promise;
    return response(200, { conversation, messages: [message(1)], eventCursor: "1", hasMoreBefore: false });
  } });
  return Object.assign(f, { conversations, firstId, secondId, async select(value) {
    const button = f.element("conversations").children.find((node) => node.dataset.conversationId === value); button.focus();
    for (const handler of button.events.get("click")) handler({}); await flush();
  } });
}

test("contact activation and return use visible logical keyboard targets without opening the composer", async () => {
  const f = twoConversationHarness(); await flush(); await f.select(f.firstId);
  assert.equal(f.document.activeElement, f.element("message-scroll")); assert.notEqual(f.document.activeElement, f.element("message-body"));
  f.element("back-to-inbox").focus(); await f.click("back-to-inbox");
  assert.equal(f.document.activeElement.dataset.conversationId, f.firstId); assert.equal(f.element("workspace").classList.contains("selected"), false);
  await f.select(f.secondId); f.element("back-to-inbox").focus(); await f.click("back-to-inbox");
  assert.equal(f.document.activeElement.dataset.conversationId, f.secondId);
  const focused = f.document.activeElement; await f.run("renderInbox()");
  assert.notEqual(f.document.activeElement, focused); assert.equal(f.document.activeElement.dataset.conversationId, f.secondId);
});

test("a pending conversation load cannot take focus after the user already moved elsewhere", async () => {
  const gate = pause(), f = twoConversationHarness({ holdSecond: gate }); await flush(); await f.select(f.secondId);
  assert.equal(f.document.activeElement, f.element("message-scroll")); f.element("logout").focus();
  gate.resolve(response(200, { conversation: f.conversations.get(f.secondId), messages: [message(1)], eventCursor: "1", hasMoreBefore: false })); await flush();
  assert.equal(f.document.activeElement, f.element("logout"));
});

test("deleting a focused message selects its tombstone, while another active control keeps focus", async () => {
  for (const move of [false, true]) {
    let f; const gate = pause();
    f = liveHarness({ intercept: (path) => path.endsWith("/delete") ? gate.promise : path.endsWith("/messages?limit=50") ? response(200, {
      conversation: f.conversation(), messages: [message(1, "me")], eventCursor: "1", hasMoreBefore: false,
    }) : undefined }); await flush();
    const button = f.element("messages").children[0].querySelector(".delete-message"); button.focus();
    for (const handler of button.events.get("click")) handler({}); await flush(); await f.click("accept-delete"); if (move) f.element("message-body").focus();
    gate.resolve(response(200, { message: message(1, "me", { body: null, deletedAt: now }) })); await flush();
    if (move) assert.equal(f.document.activeElement, f.element("message-body"));
    else { assert.equal(f.document.activeElement, f.element("messages").children[0]); assert.equal(f.document.activeElement.getAttribute("tabindex"), "-1"); }
    assert.equal(announcement(f).textContent, "");
  }
});

test("history and new-message pagination controls hand focus to history only when their focused control disappears", async () => {
  const f = liveHarness(); await flush(); const older = f.element("older-messages"); older.focus(); await f.click("older-messages");
  assert.equal(older.hidden, true); assert.equal(f.document.activeElement, f.element("message-scroll"));
  f.element("new-messages").hidden = false; f.element("new-messages").focus(); await f.click("new-messages");
  assert.equal(f.document.activeElement, f.element("message-scroll")); assert.equal(f.element("new-messages").hidden, true); assert.equal(announcement(f).textContent, "");
});

test("a cached conversation re-entry consumes catch-up silently and starts a fresh visible counter", async () => {
  let f; let events = [], cursor = "1";
  f = harness({ currentSession: session(1, "A".repeat(43), "admin"), intercept(path) {
    if (path.includes("/events?")) { const selected = events; events = []; return response(200, { conversation: f.conversation(), events: selected, nextCursor: cursor, hasMore: false }); }
    return undefined;
  } }); await flush();
  const activate = async () => { const button = f.element("conversations").children[0]; button.focus(); for (const handler of button.events.get("click")) handler({}); await flush(); };
  await activate(); events = [event(2, message(2))]; cursor = "2"; f.conversation().latestSequence = "2"; await f.run("fetchEvents(currentState())");
  assert.equal(announcement(f).textContent, "Nouveau message reçu."); await f.click("back-to-inbox"); assert.equal(announcement(f).textContent, "");
  events = [event(3, message(3))]; cursor = "3"; f.conversation().latestSequence = "3"; await activate();
  assert.equal(announcement(f).textContent, "");
  events = [event(4, message(4))]; cursor = "4"; f.conversation().latestSequence = "4"; await f.run("fetchEvents(currentState())");
  assert.equal(announcement(f).textContent, "Nouveau message reçu.");
});

test("inbox pagination ending restores focus to the first newly loaded contact", async () => {
  let f; let page = 0;
  f = harness({ currentSession: session(1, "A".repeat(43), "admin"), intercept(path) {
    if (!path.includes("/conversations?")) return undefined;
    page += 1; const first = { ...f.conversation(), id: id(101) }, second = { ...first, id: id(102), peerName: "Synthetic second" };
    return response(200, page === 1 ? { conversations: [first], hasMore: true, nextCursor: first.id } : { conversations: [second], hasMore: false, nextCursor: null });
  } }); await flush();
  f.element("more-conversations").focus(); await f.click("more-conversations");
  assert.equal(f.element("more-conversations").hidden, true); assert.equal(f.document.activeElement.dataset.conversationId, id(102));
  assert.equal(announcement(f).textContent, "");
});

const photoResponse = () => ({ ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => new Blob(["synthetic private photo"], { type: "image/jpeg" }) });
const libraryAsset = (value = 801) => ({ id: id(value), width: 1000, height: 800, thumbnailWidth: 400, thumbnailHeight: 320,
  fullUrl: `/api/media/client/assets/${id(value)}/full`, thumbnailUrl: `/api/media/client/assets/${id(value)}/thumb`, createdAt: now, sharedHere: false });
function libraryHarness({ paginated = false } = {}) {
  let pages = 0;
  return liveHarness({ intercept(path) {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.includes("/assets?")) { pages += 1; return response(200, { assets: [libraryAsset(pages === 1 ? 801 : 802)], hasMore: paginated && pages === 1, nextCursor: paginated && pages === 1 ? id(801) : null }); }
    if (path.endsWith("/full") || path.endsWith("/thumb")) return photoResponse();
    return undefined;
  } });
}

test("media pagination ending focuses its newly loaded photo and does not move focus outside the dialog", async () => {
  const f = libraryHarness({ paginated: true }); await flush(); await f.click("open-library");
  f.element("more-media").focus(); await f.click("more-media");
  assert.equal(f.element("more-media").hidden, true); assert.equal(f.document.activeElement.classList.contains("photo-open"), true);
  assert.equal(f.document.activeElement.parentElement.dataset.mediaKey, id(802)); assert.equal(f.element("media-dialog").contains(f.document.activeElement), true);
});

test("a lightbox whose photo opener was replaced returns to the same current photo, respecting the active dialog", async () => {
  const f = libraryHarness(); await flush(); await f.click("open-library");
  const opener = f.element("media-grid").children[0].querySelector(".photo-open"); opener.focus(); for (const handler of opener.events.get("click")) handler({}); await flush();
  assert.equal(f.element("lightbox").open, true); assert.equal(f.document.activeElement, f.element("close-lightbox"));
  f.run("renderMediaPanel()"); await flush();
  const current = f.element("media-grid").children[0].querySelector(".photo-open"); assert.notEqual(current, opener);
  assert.equal(f.document.activeElement, f.element("close-lightbox"));
  f.element("lightbox").close(); await flush();
  assert.equal(f.document.activeElement, current); assert.equal(f.element("media-dialog").open, true);
  assert.equal(f.element("media-dialog").contains(f.document.activeElement), true);
});

test("closing a media dialog whose original opener became disabled uses a visible current fallback", async () => {
  const f = libraryHarness(); await flush(); await f.click("open-library");
  f.run("currentState().conversation.canSend = false; renderMeta(currentState());");
  assert.equal(f.element("open-library").disabled, true); f.element("close-media").focus();
  f.element("media-dialog").close(); await flush();
  assert.equal(f.document.activeElement, f.element("open-gallery")); assert.equal(f.document.activeElement.disabled, false);
});

test("deleting an expanded received photo closes it with a visible logical focus target and no new-message announcement", async () => {
  let f;
  f = liveHarness({ intercept(path) {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.endsWith("/messages?limit=50")) return response(200, { conversation: f.conversation(), messages: [message(1, "peer", { body: "Synthetic caption never spoken", media: libraryAsset() })], eventCursor: "1", hasMoreBefore: false });
    if (path.endsWith("/full") || path.endsWith("/thumb")) return photoResponse();
    return undefined;
  } }); await flush();
  const opener = f.element("messages").children[0].querySelector(".photo-open"); opener.focus(); for (const handler of opener.events.get("click")) handler({}); await flush();
  assert.equal(f.element("lightbox").open, true);
  f.push([event(2, message(1, "peer", { body: null, deletedAt: now }), "delete")]); await f.fetchEvents();
  assert.equal(f.element("lightbox").open, false); assert.equal(opener.isConnected, false);
  assert.ok([f.element("open-gallery"), f.element("message-scroll"), f.element("messages").children[0]].includes(f.document.activeElement));
  assert.notEqual(f.document.activeElement, f.document.body); assert.equal(announcement(f).textContent, "");
});

test("removing a focused image draft returns to the composer without changing its caption or posting", async () => {
  const f = libraryHarness(); await flush();
  f.element("message-body").value = "Keep this synthetic caption";
  f.run("currentState().imageDraft = { file: null, asset: { id:'00000000000000000000000000000321', thumbnailUrl:'/api/media/client/assets/00000000000000000000000000000321/thumb', fullUrl:'/api/media/client/assets/00000000000000000000000000000321/full', width:1000,height:800,thumbnailWidth:400,thumbnailHeight:320 } }; renderMeta(currentState());"); await flush();
  f.element("cancel-image").focus(); const before = messagePosts(f).length; await f.click("cancel-image");
  assert.equal(f.element("image-draft").hidden, true); assert.equal(f.document.activeElement, f.element("message-body"));
  assert.equal(f.element("message-body").value, "Keep this synthetic caption"); assert.equal(messagePosts(f).length, before);
});

test("a completed button-initiated send restores composer focus only if the user has not moved elsewhere", async () => {
  for (const move of [false, true]) {
    const gate = pause(); const f = liveHarness({ intercept: (path, options) => path.endsWith("/messages") && options.method === "POST" ? gate.promise : undefined }); await flush();
    f.element("send").focus(); await f.send("Synthetic sent text");
    const pending = f.inspect().states.get(f.inspect().selected).pending;
    if (move) f.element("logout").focus();
    gate.resolve(response(201, { message: message(11, "me", { body: "Synthetic sent text", clientMessageId: pending.clientMessageId }) })); await flush();
    assert.equal(f.document.activeElement, move ? f.element("logout") : f.element("message-body"));
    assert.equal(f.element("message-body").value, ""); assert.equal(messagePosts(f).length, 1); assert.equal(announcement(f).textContent, "");
  }
});

test("CRM-backed inbox pagination has the same focused final-page fallback", async () => {
  const f = twoConversationHarness({ mobile: false }); await flush();
  f.run(`inboxMore = true; crm = { displayName: (item) => item.peerName, async loadInbox() {
    inbox.set('00000000000000000000000000000067', { ...inbox.values().next().value, id:'00000000000000000000000000000067' });
    inboxMore = false; renderInbox();
  } }; renderInbox();`);
  f.element("more-conversations").focus(); await f.click("more-conversations");
  assert.equal(f.element("more-conversations").hidden, true);
  assert.equal(f.document.activeElement.dataset.conversationId, id(103));
});
