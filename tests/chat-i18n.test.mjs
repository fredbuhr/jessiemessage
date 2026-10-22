import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { quickReplyOptions, appendQuickReply } from "../public/quick-replies.js";
import { emojiCategories, emojiOptions, emojiSkinTones, insertEmoji } from "../public/emoji-catalog.js";
import { webcrypto } from "node:crypto";
import { createChatDrafts } from "../public/chat-drafts.js";

const source = await readFile(new URL("../public/chat.js", import.meta.url), "utf8");
const sessionClockSource = await readFile(new URL("../public/session-clock.js", import.meta.url), "utf8");
const modelSource = await readFile(new URL("../public/chat-model.js", import.meta.url), "utf8");
const modelExports = [...modelSource.matchAll(/export function ([a-zA-Z0-9_]+)\(/g)].map((match) => match[1]);
const html = await readFile(new URL("../public/chat.html", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../public/i18n.js", import.meta.url), "utf8");
const helpLinksSource = await readFile(new URL("../public/help-link.js", import.meta.url), "utf8");
const catalogueSource = await readFile(new URL("../public/i18n-chat.js", import.meta.url), "utf8");
const now = 1750000000000;
const id = (value) => value.toString(16).padStart(32, "0");
const session = (value = 1, csrf = "A".repeat(43), role = "client") => ({ user: { id: id(value), role, pseudonym: `Synthetic ${value}` },
  csrf, expiresAt: now + 28800000, ...(role === "client" ? { access: { state: "active" } } : {}) });
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const pause = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 12; index++) await new Promise((resolve) => setImmediate(resolve)); };
async function revealMessageDetails(article) {
  if (!article.querySelector(".message-meta").hidden) return;
  const toggle = article.querySelector(".message-details-toggle");
  for (const handler of toggle.events.get("click")) handler({ currentTarget: toggle, target: toggle });
  await flush();
}

class Element {
  constructor(tag = "div", registry = null) {
    this.tagName = tag; this.registry = registry; this.children = []; this.parentElement = null; this._connected = false; this.events = new Map();
    this.attributes = new Map(); this.dataset = {}; this.style = {}; this.hidden = false; this.disabled = false; this.value = ""; this.files = [];
    this.open = false; this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100; this._text = "";
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
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
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
    if (value === "a[data-help-link]") return this.tagName === "a" && this.getAttribute("data-help-link") !== null;
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
  showModal() { this.open = true; }
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
function harness({ currentSession = session(), visible = true, intercept = null, quickReplies = null, language = "fr" } = {}) {
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
  const state = { currentSession, conversations: new Map(), messages: new Map(), posts: 0, quickReplies: quickReplies ?? { version: "0", replies: [] }, quickReplyWrites: 0 };
  const conversation = (owner = state.currentSession?.user.id) => {
    if (!state.conversations.has(owner)) state.conversations.set(owner, { id: id(100 + Number.parseInt(owner, 16)), clientId: owner, clientPseudonym: `Synthetic ${owner}`,
      peerName: "Messages privés", createdAt: now, closedAt: null, lastActivityAt: now, latestSequence: "1", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 1, canSend: true });
    return state.conversations.get(owner);
  };
  const storedMessages = (conv) => { if (!state.messages.has(conv.id)) state.messages.set(conv.id, [{ id: id(500 + Number.parseInt(conv.clientId, 16)), sequence: "1", sender: "peer", body: "Envoyer", createdAt: now, deletedAt: null, clientMessageId: null }]); return state.messages.get(conv.id); };
  const context = vm.createContext({ __chatDrafts: { createChatDrafts }, __emojis: { emojiCategories, emojiOptions, emojiSkinTones, insertEmoji }, __quickReplies: { quickReplyOptions, appendQuickReply }, document, window: { addEventListener: (name, handler) => addEvent(windowEvents, name, handler) }, navigator: { language: language === "fr" ? "fr-FR" : "en-US" },
    sessionStorage: { getItem: () => null, setItem() {} },
    location: { pathname: currentSession?.user.role === "admin" ? "/admin/messages" : "/messages", replace: (path) => redirects.push(path), reload() { redirects.push("reload"); } },
    Date: class extends Date { static now() { return time; } }, AbortController, TextEncoder, Blob, crypto: webcrypto, queueMicrotask,
    URL: { createObjectURL: () => { const value = `blob:synthetic-${++blobId}`; createdUrls.push(value); return value; }, revokeObjectURL: (url) => revoked.push(url) },
    setTimeout: (handler, delay) => { const value = ++timerId; timers.set(value, { handler, at: time + delay }); return value; }, clearTimeout: (value) => timers.delete(value),
    fetch: async (path, options = {}) => {
      const call = { path, options, ownerAtDispatch: state.currentSession?.user.id, csrfAtDispatch: state.currentSession?.csrf }; calls.push(call);
      // Intercepts deliberately can complete after abort, exercising the real
      // controller's generation checks rather than relying on fetch alone.
      const value = intercept?.(path, options, state, calls); if (value !== undefined) return await value;
      if (path === "/api/admin/quick-replies") {
        if (options.method !== "POST") return response(200, structuredClone(state.quickReplies));
        state.quickReplyWrites += 1; const command = JSON.parse(options.body);
        if (command.expectedVersion !== state.quickReplies.version) return response(409, { error: "quick_replies_conflict" });
        state.quickReplies.version = String(BigInt(state.quickReplies.version) + 1n); state.quickReplies.replies = structuredClone(command.replies);
        return response(200, structuredClone(state.quickReplies));
      }
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
  vm.runInContext(helpLinksSource, context, { filename: "public/help-link.js" });
  vm.runInContext(catalogueSource, context, { filename: "public/i18n-chat.js" });
  vm.runInContext(sessionClockSource, context, { filename: "public/session-clock.js" });
  vm.runInContext(`globalThis.__model = (() => {${modelSource.replaceAll("export function ", "function ")}\nreturn {${modelExports.join(",")}};})();`, context, { filename: "public/chat-model.js" });
  const executable = source.replace('import { createChatDrafts } from "/chat-drafts.js";', 'const {createChatDrafts} = __chatDrafts;').replace('import { emojiCategories, emojiOptions, emojiSkinTones, insertEmoji } from "/emoji-catalog.js";', 'const {emojiCategories,emojiOptions,emojiSkinTones,insertEmoji} = __emojis;').replace('import { quickReplyOptions, appendQuickReply } from "/quick-replies.js";', 'const {quickReplyOptions,appendQuickReply} = __quickReplies;').replace('import { prepareImageUpload } from "/image-preparation.js";', 'const prepareImageUpload = async (file) => file;').replace(/^import \{([^\n]+)\} from "\/chat-model\.js";/, "const {$1} = __model;") +
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

const messages = (f) => f.element("messages");
const contentPosts = (f) => f.calls.filter((call) => call.options.method === "POST" && /\/(messages|assets)$/.test(call.path));
const dateOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
const dateText = (language) => new Date(now).toLocaleString(language === "fr" ? "fr-FR" : "en-US", dateOptions);
const photoResponse = () => ({ ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => new Blob(["synthetic private photo"], { type: "image/jpeg" }) });
function photoFixture(f, sender = "me") {
  const conversation = f.conversation(), messageId = id(800);
  return { id: messageId, sequence: "1", sender, body: "Envoyer", createdAt: now, deletedAt: null, clientMessageId: null,
    media: { id: id(801), width: 1000, height: 800, thumbnailWidth: 400, thumbnailHeight: 320,
      fullUrl: `/api/media/client/conversations/${conversation.id}/messages/${messageId}/full`, thumbnailUrl: `/api/media/client/conversations/${conversation.id}/messages/${messageId}/thumb` } };
}

test("chat HTML loads explicit catalogues before its controller and marks UI leaves without user content", () => {
  const scripts = ["/i18n.js", "/help-link.js", "/i18n-chat.js", "/i18n-tools.js", "/chat.js"];
  for (let index = 1; index < scripts.length; index++) assert.ok(html.indexOf(`src="${scripts[index - 1]}"`) < html.indexOf(`src="${scripts[index]}"`));
  assert.match(html, /href="\/i18n\.css"/); assert.match(html, /data-jm-language/);
  const f = harness({ visible: false });
  for (const node of f.document.querySelectorAll("[data-jm-i18n]")) assert.equal(node.children.length, 0, node.getAttribute("data-jm-i18n"));
  for (const node of f.document.querySelectorAll("[data-jm-i18n],[data-jm-i18n-placeholder],[data-jm-i18n-aria-label]")) {
    for (const attr of ["data-jm-i18n", "data-jm-i18n-placeholder", "data-jm-i18n-aria-label"]) {
      const source = node.getAttribute(attr); if (!source) continue;
      f.language("en"); const translated = f.context.JessieI18n.t(source);
      if (!["Messages", "Photos", "Contact", "Notifications", "Emojis", "Options", "Conversation"].includes(source)) assert.notEqual(translated, source, source);
    }
  }
  // The new gallery tab uses the same word in French and English; its sibling
  // still proves the video-library controls use the registered catalogue.
  assert.equal(f.element("video-gallery-conversation").textContent, "Conversation");
  assert.equal(f.element("video-gallery-library").textContent, "My videos");
});

test("live chat switching preserves raw user phrases, drafts, focused controls and read receipt rows", async () => {
  const f = harness({ language: "en" }); await flush();
  assert.equal(f.inspect().ready, true); assert.equal(f.element("send").textContent, "Send");
  assert.equal(f.element("peer-name").textContent, "Messages privés");
  assert.equal(messages(f).children[0].querySelector(".bubble").textContent, "Envoyer");
  await f.send("Message supprimé");
  const article = messages(f).children.at(-1), remove = article.querySelector(".delete-message"), time = article.querySelector("time");
  const receipt = article.querySelector(".message-meta").children[1];
  assert.equal(receipt.textContent, "Sent"); assert.equal(time.textContent, dateText("en"));
  assert.equal(article.querySelector(".bubble").textContent, "Message supprimé");
  f.element("message-body").value = "Draft: Envoyer"; await revealMessageDetails(article); remove.focus(); const before = f.calls.length;
  for (const language of ["fr", "en", "fr", "en"]) {
    f.language(language);
    assert.equal(messages(f).children.at(-1), article); assert.equal(article.querySelector(".delete-message"), remove);
    assert.equal(f.document.activeElement, remove); assert.equal(f.element("message-body").value, "Draft: Envoyer");
    assert.equal(article.querySelector(".bubble").textContent, "Message supprimé");
    assert.equal(messages(f).children[0].querySelector(".bubble").textContent, "Envoyer");
    assert.equal(f.element("peer-name").textContent, "Messages privés");
    assert.equal(time.textContent, dateText(language));
    assert.equal(remove.textContent, language === "fr" ? "Supprimer" : "Delete");
    assert.equal(receipt.textContent, language === "fr" ? "Envoyé" : "Sent");
    assert.equal(remove.getAttribute("aria-label"), `${language === "fr" ? "Supprimer mon message du" : "Delete my message from"} ${dateText(language)}`);
  }
  assert.equal(f.calls.length, before); assert.equal(contentPosts(f).length, 1);
  f.conversation().peerReadSequence = "2"; await f.advance(3000);
  assert.equal(messages(f).children.at(-1), article); assert.equal(receipt.textContent, "Sent");
  f.language("fr"); assert.equal(receipt.textContent, "Envoyé"); assert.equal(f.document.activeElement, remove);
});

test("Jessie's read receipt updates and translates in place after a metadata-only poll", async () => {
  const f = harness({ language: "en", currentSession: session(1, "A".repeat(43), "admin") }); await flush();
  for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush();
  await f.send("A synthetic message from Jessie");
  const article = messages(f).children.at(-1), remove = article.querySelector(".delete-message");
  const receipt = article.querySelector(".message-meta").children[1];
  assert.equal(receipt.textContent, "Sent"); await revealMessageDetails(article); remove.focus();
  f.conversation().peerReadSequence = "2"; await f.advance(3000);
  assert.equal(messages(f).children.at(-1), article); assert.equal(receipt.textContent, "Read");
  f.language("fr"); assert.equal(receipt.textContent, "Lu"); assert.equal(f.document.activeElement, remove);
  assert.equal(contentPosts(f).length, 1);
});

test("uncertain send IDs, retry state, raw text and errors survive language changes without another POST", async () => {
  const gate = pause();
  const f = harness({ intercept: (path, options) => options.method === "POST" && path.endsWith("/messages") ? gate.promise : undefined });
  await flush(); await f.send("Envoyer");
  const state = f.inspect().states.get(f.inspect().selected), pending = state.pending, key = pending.clientMessageId;
  assert.equal(f.element("chat-status").textContent, "Envoi en cours…");
  const before = f.calls.length; f.language("en");
  assert.equal(f.element("chat-status").textContent, "Sending…"); assert.equal(f.calls.length, before);
  assert.equal(state.pending, pending); assert.equal(state.pending.clientMessageId, key); assert.equal(f.element("message-body").value, "Envoyer");
  gate.reject(new Error("synthetic interrupted transport")); await flush();
  assert.equal(state.pending.status, "retry"); assert.equal(f.element("retry-send").textContent, "Try sending again");
  assert.match(f.element("chat-status").textContent, /^The connection was interrupted/);
  const settled = f.calls.length; f.language("fr"); f.language("en");
  assert.equal(state.pending.clientMessageId, key); assert.equal(state.pending.status, "retry"); assert.equal(contentPosts(f).length, 1); assert.equal(f.calls.length, settled);
});

test("emoji search and category labels change language without changing a draft or issuing a request", async () => {
  const f = harness({ language: "en" }); await flush();
  f.element("message-body").value = "Bisou, a private draft 😘"; const before = f.calls.length;
  await f.click("open-emojis");
  f.element("emoji-search").value = "bisou";
  for (const handler of f.element("emoji-search").events.get("input")) handler({});
  let kiss = f.element("emoji-list").children.find(button => button.dataset.emojiId === "kiss-face");
  assert.equal(kiss.getAttribute("aria-label"), "Blowing a kiss"); kiss.focus();
  assert.equal(f.element("emoji-categories").children[0].textContent, "All");
  f.language("fr");
  kiss = f.element("emoji-list").children.find(button => button.dataset.emojiId === "kiss-face");
  assert.equal(kiss.getAttribute("aria-label"), "Bisou envoyé"); assert.equal(f.document.activeElement, kiss);
  assert.equal(f.element("emoji-categories").children[0].textContent, "Tous");
  assert.equal(f.element("emoji-search").value, "bisou"); assert.equal(f.element("message-body").value, "Bisou, a private draft 😘");
  assert.equal(f.calls.length, before); assert.equal(contentPosts(f).length, 0);
});

test("photo rows, images, gallery cards and accessibility names translate in place without a refetch", async () => {
  let f;
  f = harness({ intercept: (path) => {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.endsWith("/messages?limit=50")) return response(200, { conversation: f.conversation(), messages: [photoFixture(f)], eventCursor: "1", hasMoreBefore: false });
    if (path.includes("/gallery?")) { const item = photoFixture(f); return response(200, { items: [{ messageId: item.id, createdAt: now, media: item.media }], hasMore: false, nextBefore: null }); }
    if (path.endsWith("/thumb")) return photoResponse();
    return undefined;
  } }); await flush();
  const article = messages(f).children[0], photo = article.querySelector(".photo-open"), image = photo.querySelector("img");
  assert.ok(image); await f.click("open-gallery");
  const card = f.element("media-grid").children[0], galleryPhoto = card.querySelector(".photo-open"), galleryImage = galleryPhoto.querySelector("img");
  assert.ok(galleryImage); galleryPhoto.focus(); const before = f.calls.length, urls = [...f.createdUrls];
  f.language("en");
  assert.equal(messages(f).children[0], article); assert.equal(photo.querySelector("img"), image);
  assert.equal(f.element("media-grid").children[0], card); assert.equal(galleryPhoto.querySelector("img"), galleryImage);
  assert.equal(f.document.activeElement, galleryPhoto); assert.equal(article.querySelector(".photo-caption").textContent, "Envoyer");
  assert.equal(photo.getAttribute("aria-label"), "Enlarge this message’s photo"); assert.equal(image.getAttribute("aria-label"), "Private photo");
  assert.equal(galleryPhoto.getAttribute("aria-label"), "Enlarge this private photo"); assert.equal(galleryImage.getAttribute("aria-label"), "Private photo");
  assert.equal(f.element("media-title").textContent, "Conversation photos"); assert.match(card.textContent, new RegExp(dateText("en").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  f.language("fr"); assert.equal(f.element("media-title").textContent, "Photos de la conversation");
  assert.equal(f.calls.length, before); assert.deepEqual(f.createdUrls, urls); assert.equal(f.revoked.length, 0);
});

test("image draft captions and uploading state remain unchanged while UI labels switch", async () => {
  const upload = pause();
  const f = harness({ intercept: (path, options) => {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.endsWith("/assets") && options.method === "POST") return upload.promise;
    return undefined;
  } }); await flush();
  const file = new Blob(["synthetic upload"], { type: "image/png" });
  f.element("image-file").files = [file]; for (const handler of f.element("image-file").events.get("change")) handler({});
  const preview = f.element("image-preview").querySelector("img"); assert.ok(preview);
  f.element("message-body").value = "Envoyer";
  for (const handler of f.element("composer").events.get("submit")) handler({ preventDefault() {} }); await flush();
  const state = f.inspect().states.get(f.inspect().selected), pending = state.pending, key = pending.clientMessageId;
  const before = f.calls.length; f.language("en");
  assert.equal(f.element("image-draft-status").textContent, "Preparing photo…");
  assert.equal(f.element("message-body").placeholder, "Add a caption (optional)…");
  assert.equal(f.element("image-preview").querySelector("img"), preview); assert.equal(preview.getAttribute("aria-label"), "Selected photo preview");
  assert.equal(state.pending, pending); assert.equal(state.pending.caption, "Envoyer"); assert.equal(state.pending.clientMessageId, key);
  assert.equal(f.element("message-body").value, "Envoyer"); assert.equal(f.calls.length, before); assert.equal(contentPosts(f).length, 1);
  upload.reject(new Error("synthetic upload interruption")); await flush();
  f.language("fr"); assert.equal(f.element("message-body").placeholder, "Ajoute une légende (facultatif)…");
  assert.equal(state.pending.clientMessageId, key); assert.equal(state.pending.caption, "Envoyer"); assert.equal(contentPosts(f).length, 1);
});

test("hidden date parameters do not reappear on a language switch and a new owner cannot restore old rows", async () => {
  const f = harness(); await flush(); const old = messages(f).children[0], time = old.querySelector("time"), french = time.textContent;
  await f.hide(); f.language("en");
  assert.equal(time.textContent, french); assert.equal(time.getAttribute("data-jm-i18n-bound"), null); assert.equal(f.element("workspace").hidden, true);
  f.state.currentSession = session(2, "B".repeat(43)); await f.show();
  assert.equal(old.isConnected, false); assert.notEqual(messages(f).children[0], old);
  assert.equal(messages(f).children[0].querySelector("time").textContent, dateText("en"));
  f.language("fr"); assert.equal(old.isConnected, false); assert.equal(time.textContent, french);
  assert.equal(messages(f).children[0].querySelector(".bubble").textContent, "Envoyer"); assert.equal(contentPosts(f).length, 0);
});

test("unread counts and reminders translate while raw CRM names and labels keep their exact text", async () => {
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin") }); await flush();
  const serviceLink = f.element("readiness-nav").querySelector("a");
  assert.equal(serviceLink.href, "/admin/readiness"); assert.equal(serviceLink.textContent, "État du service");
  f.conversation().unreadCount = 1200;
  f.run(`crm = { displayName: (conversation) => conversation.peerName }; const contact = [...inbox.values()][0]; contact.unreadCount = 1200; contact.crm = { labels: [{name:"Envoyer"},{name:"Messages privés"}], reminderAt: Date.now() }; renderInbox();`);
  const button = f.element("conversations").children[0], count = button.querySelector(".unread"), details = button.querySelector(".crm-contact-meta"), name = button.querySelector("strong");
  button.focus(); const before = f.calls.length;
  assert.equal(count.textContent, (1200).toLocaleString("fr-FR")); assert.match(details.textContent, /Envoyer · Messages privés · Rappel à traiter/);
  f.language("en");
  assert.equal(serviceLink.textContent, "Service status"); assert.equal(serviceLink.href, "/admin/readiness");
  assert.equal(f.element("conversations").children[0], button); assert.equal(f.document.activeElement, button);
  assert.equal(name.textContent, "Messages privés"); assert.equal(count.textContent, "1,200"); assert.equal(count.getAttribute("aria-label"), "1,200 unread messages");
  assert.equal(details.textContent, "Envoyer · Messages privés · Reminder due"); assert.equal(f.calls.length, before);
  f.language("fr"); assert.equal(count.getAttribute("aria-label"), `${(1200).toLocaleString("fr-FR")} messages non lus`);
  assert.equal(serviceLink.textContent, "État du service");
  assert.equal(details.textContent, "Envoyer · Messages privés · Rappel à traiter");
});

test("translated tombstones remain distinct from live user text matching the same French UI phrase", async () => {
  let f;
  f = harness({ language: "en", intercept: (path) => path.endsWith("/messages?limit=50") ? response(200, {
    conversation: f.conversation(), messages: [
      { id: id(900), sequence: "1", sender: "peer", body: "Message supprimé", createdAt: now, deletedAt: null },
      { id: id(901), sequence: "2", sender: "peer", body: null, createdAt: now, deletedAt: now },
    ], eventCursor: "1", hasMoreBefore: false,
  }) : undefined }); await flush();
  const [live, deleted] = messages(f).children;
  assert.equal(live.querySelector(".bubble").textContent, "Message supprimé"); assert.equal(deleted.querySelector(".bubble").textContent, "Message deleted");
  const before = f.calls.length;
  f.language("fr"); assert.equal(deleted.querySelector(".bubble").textContent, "Message supprimé");
  f.language("en"); assert.equal(live.querySelector(".bubble").textContent, "Message supprimé"); assert.equal(deleted.querySelector(".bubble").textContent, "Message deleted");
  assert.equal(messages(f).children[0], live); assert.equal(messages(f).children[1], deleted); assert.equal(f.calls.length, before);
});

test("photo loading and failure states translate without retrying or replacing their message", async () => {
  const gate = pause(); let f;
  f = harness({ intercept: (path) => {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.endsWith("/messages?limit=50")) return response(200, { conversation: f.conversation(), messages: [photoFixture(f)], eventCursor: "1", hasMoreBefore: false });
    if (path.endsWith("/thumb")) return gate.promise;
    return undefined;
  } }); await flush();
  const article = messages(f).children[0], photo = article.querySelector(".photo-open"), loading = photo.firstChild;
  const before = f.calls.length; photo.focus(); f.language("en");
  assert.equal(photo.firstChild, loading); assert.equal(photo.textContent, "Loading photo…"); assert.equal(f.document.activeElement, photo); assert.equal(f.calls.length, before);
  gate.resolve({ ok: false, status: 503 }); await flush();
  assert.equal(photo.textContent, "Photo unavailable"); const afterFailure = f.calls.length;
  f.language("fr"); assert.equal(photo.textContent, "Photo indisponible");
  assert.equal(messages(f).children[0], article); assert.equal(article.querySelector(".photo-open"), photo); assert.equal(f.calls.length, afterFailure);
  assert.equal(f.calls.filter((call) => call.path.endsWith("/thumb")).length, 1);
});

test("photo library controls and metadata switch in place without changing the selected asset", async () => {
  let f;
  f = harness({ intercept: (path) => {
    if (path === "/api/media/client/capabilities") return response(200, { enabled: true });
    if (path.includes("/assets?")) return response(200, { assets: [{ ...photoFixture(f).media, createdAt: now, sharedHere: true }], hasMore: false, nextCursor: null });
    if (path.endsWith("/thumb")) return photoResponse();
    return undefined;
  } }); await flush(); await f.click("open-library");
  const card = f.element("media-grid").children[0], choose = card.querySelector(".media-actions").children[0], remove = card.querySelector(".media-actions").children[1], image = card.querySelector("img");
  assert.ok(image); choose.focus(); const before = f.calls.length;
  f.language("en");
  assert.equal(f.element("media-title").textContent, "My photos"); assert.equal(choose.textContent, "Send again"); assert.equal(remove.textContent, "Delete photo");
  assert.equal(card.querySelector(".shared-photo").textContent, "Already sent here. Sending again creates a new message.");
  assert.equal(f.element("media-grid").children[0], card); assert.equal(card.querySelector("img"), image); assert.equal(f.document.activeElement, choose); assert.equal(f.calls.length, before);
  for (const handler of choose.events.get("click")) handler({}); await flush();
  const state = f.inspect().states.get(f.inspect().selected), asset = state.imageDraft.asset;
  assert.equal(f.element("image-draft-status").textContent, "Already sent here · send again");
  f.element("message-body").value = "Mes photos"; const selectedCalls = f.calls.length;
  f.language("fr"); assert.equal(state.imageDraft.asset, asset); assert.equal(f.element("message-body").value, "Mes photos");
  assert.equal(f.element("image-draft-status").textContent, "Déjà envoyée ici · nouvel envoi"); assert.equal(f.calls.length, selectedCalls); assert.equal(contentPosts(f).length, 0);
});

test("all controller message and photo error variants retain reactive translated UI sources", async () => {
  const f = harness(); await flush();
  const cases = [
    ["errorText", { status: 429 }, "Trop de demandes. Patiente un moment avant de réessayer."],
    ["errorText", { status: 409 }, "Cet envoi a déjà été enregistré avec un contenu différent. Actualise l’historique avant de poursuivre."],
    ["errorText", { status: 400 }, "Vérifie ton message : 1 à 4 096 caractères, avec du texte."],
    ["errorText", { status: 403 }, "L’envoi n’est pas autorisé pour le moment."],
    ["errorText", {}, "La connexion est interrompue. Ton texte reste ici ; tu peux réessayer."],
    ["mediaErrorText", { status: 507, code: "storage_limit" }, "Le stockage des photos a atteint sa limite."],
    ["mediaErrorText", { status: 409, code: "media_in_use" }, "Cette photo est utilisée dans une conversation ou comme avatar. Retire ces utilisations avant de la supprimer."],
    ["mediaErrorText", { status: 404 }, "Cette photo n’est plus disponible."],
    ["mediaErrorText", { status: 415 }, "Photo refusée. Utilise une image JPEG, PNG ou WebP de 10 Mo maximum, avec une légende de 1 000 caractères maximum."],
    ["mediaErrorText", { status: 429 }, "Patiente un moment avant de réessayer cet envoi."],
    ["mediaErrorText", {}, "La photo n’a pas pu être chargée. Réessaie dans un moment."],
  ];
  const before = f.calls.length;
  for (const [helper, error, french] of cases) {
    f.language("fr"); f.run(`notice(${helper}(${JSON.stringify(error)}), true);`);
    assert.equal(f.element("chat-status").textContent, french);
    f.language("en"); assert.notEqual(f.element("chat-status").textContent, french);
    assert.equal(f.element("chat-status").textContent, f.context.JessieI18n.t(french));
    assert.equal(f.element("chat-status").classList.contains("is-error"), true);
  }
  assert.equal(f.calls.length, before);
});

test("personal replies keep their title and body verbatim while management controls change language", async () => {
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin"), quickReplies: { version: "1", replies: [{ id: id(901), title: "Envoyer", body: "Mes photos <b>texte brut</b>", language: "fr" }] } }); await flush();
  for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush(); await f.click("open-quick-replies");
  const row = f.element("quick-replies-list").children.find(node => node.dataset.personalId === id(901));
  assert.equal(row.getAttribute("role"), "group"); assert.equal(row.getAttribute("aria-label"), "Envoyer");
  assert.equal(row.querySelector(".personal-reply-insert").textContent, "Mes photos <b>texte brut</b>");
  f.language("en"); assert.equal(f.element("personal-replies-title"), undefined);
  assert.equal(f.element("new-personal-reply").textContent, "New reply"); assert.equal(row.getAttribute("aria-label"), "Envoyer");
  assert.equal(row.querySelector(".personal-reply-insert").textContent, "Mes photos <b>texte brut</b>"); assert.equal(row.querySelectorAll("b").length, 0);
  assert.equal(row.querySelector("strong"), null);
  for (const handler of row.querySelector(".personal-reply-insert").events.get("click")) handler({}); await flush();
  assert.equal(f.element("message-body").value, "Mes photos <b>texte brut</b>"); assert.equal(f.state.posts, 0);
});
