import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { quickReplyOptions, appendQuickReply } from "../public/quick-replies.js";
import { emojiCategories, emojiOptions, emojiSkinTones, insertEmoji } from "../public/emoji-catalog.js";
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
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector.split(",").some(part => part.trim().startsWith(".") ? node.classList.contains(part.trim().slice(1)) : node.tagName === part.trim())) return node;
    }
    return null;
  }
  getBoundingClientRect() { return { top: 0, bottom: 100, height: 100 }; }
  focus() { if (this.isConnected && this.registry?.document) this.registry.document.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  showModal() { this.open = true; }
  close() { this.open = false; for (const handler of this.events.get("close") ?? []) handler({}); }
}
function harness({ currentSession = session(), visible = true, intercept = null, quickReplies = null, prepare = async (file) => file, notification = null, profileFactory = null, profileLoader = null } = {}) {
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
    querySelector: (selector) => selector === "dialog[open]" ? [...nodes.values()].find(node => node.open) ?? null : new Element("div", nodes),
    addEventListener: (name, handler) => documentEvents.set(name, handler) };
  nodes.document = document; document.activeElement = body; document.head._connected = true;
  const state = { currentSession, conversations: new Map(), messages: new Map(), posts: 0, quickReplies: quickReplies ?? { version: "0", replies: [] }, quickReplyWrites: 0 };
  const conversation = (owner = state.currentSession?.user.id) => {
    if (!state.conversations.has(owner)) state.conversations.set(owner, { id: id(100 + Number.parseInt(owner, 16)), clientId: owner, clientPseudonym: `Synthetic ${owner}`,
      peerName: `Peer ${owner}`, createdAt: now, closedAt: null, lastActivityAt: now, latestSequence: "1", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 1, canSend: true });
    return state.conversations.get(owner);
  };
  const storedMessages = (conv) => { if (!state.messages.has(conv.id)) state.messages.set(conv.id, [{ id: id(500 + Number.parseInt(conv.clientId, 16)), sequence: "1", sender: "peer", body: `Private ${conv.clientId}`, createdAt: now, deletedAt: null, clientMessageId: null }]); return state.messages.get(conv.id); };
  const worker = {}, workerEvents = new Map(), acknowledgements = [];
  const location = { origin: "https://example.invalid", pathname: currentSession?.user.role === "admin" ? "/admin/messages" : "/messages", hash: notification ? `#notification=${notification}` : "", replace: (path) => redirects.push(path), reload() { redirects.push("reload"); } };
  const history = { replaceState(_state, _title, path) { const next = new URL(path, location.origin); location.pathname = next.pathname; location.hash = next.hash; } };
  const context = vm.createContext({ __loadProfile: async () => { if (profileLoader) return profileLoader(); if (!profileFactory) throw new Error("Optional profile disabled in fixture"); return { createProfileUI: profileFactory }; }, __emojis: { emojiCategories, emojiOptions, emojiSkinTones, insertEmoji }, __quickReplies: { quickReplyOptions, appendQuickReply }, __prepareImageUpload: prepare, document, window: { addEventListener: (name, handler) => windowEvents.set(name, handler) },
    location, history, navigator: { serviceWorker: { controller: worker, addEventListener: (name, handler) => workerEvents.set(name, handler) } },
    Date: class extends Date { static now() { return time; } }, AbortController, TextEncoder, Uint8Array, Blob, crypto: webcrypto, queueMicrotask,
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
  vm.runInContext(sessionClockSource, context, { filename: "public/session-clock.js" });
  vm.runInContext(notificationLinkSource, context, { filename: "public/notification-link.js" });
  vm.runInContext(`globalThis.__model = (() => {${modelSource.replaceAll("export function ", "function ")}\nreturn {${modelExports.join(",")}};})();`, context, { filename: "public/chat-model.js" });
  const executable = source.replace('await import("/profile.js")', 'await __loadProfile()').replace('import { emojiCategories, emojiOptions, emojiSkinTones, insertEmoji } from "/emoji-catalog.js";', 'const {emojiCategories,emojiOptions,emojiSkinTones,insertEmoji} = __emojis;').replace('import { quickReplyOptions, appendQuickReply } from "/quick-replies.js";', 'const {quickReplyOptions,appendQuickReply} = __quickReplies;').replace('import { prepareImageUpload } from "/image-preparation.js";', 'const prepareImageUpload = __prepareImageUpload;').replace(/^import \{([^\n]+)\} from "\/chat-model\.js";/, "const {$1} = __model;") +
    "\nglobalThis.__inspect = () => ({ready, sessionOwner, selected, states, inbox, sendBusy, cycleRunning, generation, visibilityGeneration, pendingNotification, fetchProfileBinary, avatarImageUrl, avatarContainers});";
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

// Controllable transport keeps progress, an uncertain response and a late abort
// independent of fetch; the UI must preserve the message identity in each case.
function videoTransport(f) {
  const uploads = [];
  f.context.XMLHttpRequest = class {
    constructor() { this.events = new Map(); this.headers = {}; this.upload = { addEventListener: (name, handler) => { this.progress = handler; } }; uploads.push(this); }
    open(method, path) { this.method = method; this.path = path; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    addEventListener(name, handler) { this.events.set(name, handler); }
    send(file) { this.file = file; }
    abort() { this.aborted = true; this.events.get("abort")?.(); }
    complete(videoId = id(902)) { this.status = 201; this.responseText = JSON.stringify({ id: videoId, bytes: this.file.size, mime: "video/mp4" }); this.events.get("load")(); }
  };
  return uploads;
}
const videoCapability = path => path === "/api/chat/client/capabilities"
  ? response(200, { enabled: true, video: { enabled: true, maxBytes: 104857600, mime: "video/mp4" } }) : undefined;
async function selectVideo(f) {
  const file = new Blob(["synthetic video payload"], { type: "video/mp4" });
  f.element("video-file").files = [file];
  for (const handler of f.element("video-file").events.get("change")) handler({});
  const preview = f.element("video-preview").querySelector("video");
  for (const handler of preview.events.get("loadedmetadata")) handler({});
  await flush(); return { file, preview };
}

test("video selection is a local draft and cancelling upload never submits a message", async () => {
  const f = harness({ intercept: videoCapability }); await flush(); const uploads = videoTransport(f);
  const { file, preview } = await selectVideo(f);
  assert.equal(f.element("pick-video").hidden, false); assert.equal(f.element("send").disabled, false);
  assert.match(preview.src, /^blob:/); assert.equal(uploads.length, 0); assert.equal(posts(f).length, 0);
  await f.send("Keep this caption"); assert.equal(uploads.length, 1);
  assert.equal(uploads[0].file, file); assert.equal(uploads[0].headers["Content-Type"], "video/mp4");
  assert.equal(uploads[0].headers["Content-Length"], undefined, "the browser supplies native framing");
  uploads[0].progress({ loaded: file.size / 2 }); assert.equal(f.element("video-progress").value, 50);
  await f.click("cancel-video"); assert.equal(uploads[0].aborted, true); assert.equal(posts(f).length, 0);
  const state = f.inspect().states.get(f.inspect().selected);
  assert.equal(state.pending, null); assert.equal(state.videoDraft.file, file); assert.equal(state.draft, "Keep this caption");
  assert.equal(f.element("message-body").disabled, false); assert.equal(f.element("send").disabled, false);
});

test("an uncertain video message response retries the same asset and identity without uploading again", async () => {
  let f, attempts = 0; const commands = [];
  f = harness({ intercept: (path, options) => {
    const capability = videoCapability(path); if (capability) return capability;
    if (path.startsWith("/api/video/client/") && path.endsWith("/messages")) {
      const command = JSON.parse(options.body); commands.push(command); attempts++;
      if (attempts === 1) throw new Error("synthetic lost response");
      return response(200, { duplicate: true, message: { id: id(903), sequence: "2", sender: "me", body: command.caption,
        createdAt: now, deletedAt: null, clientMessageId: command.clientMessageId,
        video: { id: command.videoId, bytes: 23, mime: "video/mp4", contentUrl: "/api/video/client/conversations/" + f.conversation().id + "/messages/" + id(903) + "/content" } } });
    }
    return undefined;
  } });
  await flush(); const uploads = videoTransport(f); await selectVideo(f); await f.send("Caption remains exact");
  uploads[0].complete(); await flush();
  const state = f.inspect().states.get(f.inspect().selected);
  assert.equal(state.pending.status, "retry"); assert.equal(state.pending.videoId, id(902)); assert.equal(state.pending.file, null);
  assert.equal(f.element("pending-controls").hidden, false);
  await f.click("retry-send"); assert.equal(uploads.length, 1); assert.deepEqual(commands[1], commands[0]);
  assert.equal(state.pending, null); assert.equal(state.videoDraft, null); assert.equal(f.element("message-body").value, "");
  assert.match(contents(f.element("messages")), /Caption remains exact/);
  const player = f.element("messages").querySelector("video");
  assert.equal(player.controls, true); assert.equal(player.preload, "none"); assert.equal(player.autoplay, undefined);
  assert.match(player.src, /^\/api\/video\/client\/conversations\//);
  await f.hide(); assert.equal(player.src, "");
  await f.show(); assert.match(player.src, /^\/api\/video\/client\/conversations\//);
});

test("video players never adopt foreign origin, role, conversation or message URLs", async () => {
  const f = harness({ intercept: videoCapability }); await flush(); const state = f.inspect().states.get(f.inspect().selected);
  const path = "/api/video/client/conversations/" + state.id + "/messages/" + id(903) + "/content";
  const urls = ["https://other.invalid" + path, "https://example.invalid" + path, "//other.invalid" + path,
    path.replace("/client/", "/admin/"), path.replace(state.id, id(999)), path.replace(id(903), id(998)), path + "?x=1"];
  for (const url of urls) {
    f.context.__candidate = url;
    assert.equal(vm.runInContext("validVideoUrl(__candidate,currentState(),'" + id(903) + "')", f.context), false);
  }
  f.context.__candidate = path;
  assert.equal(vm.runInContext("validVideoUrl(__candidate,currentState(),'" + id(903) + "')", f.context), true);
});

test("hidden video uploads abort and old acknowledgements cannot submit for another session", async () => {
  const f = harness({ intercept: videoCapability }); await flush(); const uploads = videoTransport(f);
  const { preview } = await selectVideo(f); const oldUrl = preview.src; await f.send("Private pending caption");
  await f.hide(); assert.equal(uploads[0].aborted, true); assert.ok(f.revoked.includes(oldUrl));
  assert.equal(preview.src, ""); assert.equal(f.element("video-preview").children.length, 0);
  const pending = f.inspect().states.get(f.inspect().selected).pending; assert.equal(pending.status, "retry");
  f.state.currentSession = session(2, "B".repeat(43)); await f.show(); uploads[0].complete(); await flush();
  assert.equal(posts(f).length, 0); assert.equal(f.inspect().sessionOwner.id, id(2));
  assert.equal(f.element("video-draft").hidden, true); assert.equal(f.element("message-body").value, "");
});

test("late video gallery pages respect tombstones and queued close events cannot close a new gallery", async () => {
  let f; const delayed = pause();
  f = harness({ intercept: path => videoCapability(path) ?? (path.includes("/gallery?") ? delayed.promise : undefined) });
  await flush(); await f.click("open-video-gallery");
  const state = f.inspect().states.get(f.inspect().selected);
  vm.runInContext("mergeMessages(currentState(), [{id:'" + id(904) + "',sequence:'2',sender:'peer',body:null,deletedAt:123}])", f.context);
  delayed.resolve(response(200, { items: [{ messageId: id(904), sequence: "2", createdAt: now,
    video: { id: id(905), bytes: 20, mime: "video/mp4", contentUrl: "/api/video/client/conversations/" + state.id + "/messages/" + id(904) + "/content" } }], nextBefore: null, hasMore: false }));
  await flush(); assert.equal(f.element("video-grid").children.length, 0);
  const dialog = f.element("video-gallery"), queued = [];
  dialog.close = () => { dialog.open = false; queued.push(...dialog.events.get("close")); };
  await f.click("close-video-gallery"); await f.click("open-video-gallery");
  for (const handler of queued) handler({}); await flush(); assert.equal(dialog.open, true);
});

test("due task counts stay in the admin menu and a late result cannot survive logout", async () => {
  const delayed = pause();
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin"), intercept: path =>
    path === "/api/chat/admin/capabilities" ? response(200, { enabled: true, tasks: { enabled: true } })
      : path === "/api/admin/crm/tasks/summary" ? delayed.promise : undefined });
  await flush();
  const link = f.element("tasks-nav");
  assert.equal(link.href, "/admin/tasks");
  assert.equal(link.parentElement.id, "readiness-nav");
  assert.equal(link.textContent, "Mes tâches");
  await f.click("logout");
  delayed.resolve(response(200, { dueCount: 7, serverTime: now })); await flush();
  assert.equal(link.isConnected, false);
  assert.equal(link.textContent, "Mes tâches");
  assert.equal(posts(f).length, 0);
});

test("due task count refreshes while admin is active and never mounts for a client", async () => {
  let dueCount = 2;
  const intercept = path => path.endsWith("/capabilities") && path.startsWith("/api/chat/")
    ? response(200, { enabled: true, tasks: { enabled: true } })
    : path === "/api/admin/crm/tasks/summary" ? response(200, { dueCount, serverTime: now }) : undefined;
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin"), intercept }); await flush();
  assert.match(f.element("tasks-nav").textContent, /2 à traiter/);
  dueCount = 0; await f.advance(31000);
  assert.equal(f.element("tasks-nav").textContent, "Mes tâches");
  const client = harness({ intercept }); await flush();
  assert.equal(client.element("tasks-nav"), undefined);
  assert.equal(client.calls.some(call => call.path === "/api/admin/crm/tasks/summary"), false);
});
function avatarResponse({ chunks = [new Uint8Array([255, 216, 255, 217])], declared = null, type = "image/jpeg", read = null } = {}) {
  let index = 0, cancelled = false;
  return { ok: true, status: 200, headers: { get: name => name === "Content-Type" ? type : name === "Content-Length" ? declared : null },
    body: { getReader: () => ({ read: async () => read ? read(index++) : index < chunks.length ? { value: chunks[index++], done: false } : { done: true }, cancel: async () => { cancelled = true; } }) },
    get cancelled() { return cancelled; } };
}

test("the optional profile adapter belongs to the account and survives same-owner visibility resume without changing chat drafts", async t => {
  for (const role of ["client", "admin"]) await t.test(role, async () => {
    const adapters = []; let suspended = 0, destroyed = 0;
    const f = harness({ currentSession: session(1, "A".repeat(43), role), profileFactory: adapter => { adapters.push(adapter); return { suspend() { suspended++; }, destroy() { destroyed++; } }; },
      intercept: path => path === `/api/chat/${role}/capabilities` ? response(200, { enabled: true, profile: { enabled: true, avatars: false } })
        : path === `/api/profile/${role}` ? response(200, { pseudonym: "Synthetic name", version: "1", avatarId: null, avatarUrl: null }) : undefined });
    await flush();
    assert.equal(adapters.length, 1); const adapter = adapters[0];
    assert.equal(f.element("open-profile").hidden, false); assert.equal(adapter.role, role); assert.equal(adapter.avatarsEnabled, false); assert.equal(adapter.isCurrent(), true);
    if (role === "admin") { for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush(); }
    f.element("message-body").value = "Keep this private draft"; for (const handler of f.element("message-body").events.get("input")) handler({});
    const first = f.calls.length; await adapter.request(`/api/profile/${role}`, { account: true });
    assert.ok(f.calls.slice(first).some(call => call.path === `${role === "admin" ? "/api/auth" : "/api/access"}/session`));
    await f.hide(); assert.equal(suspended, 1); assert.equal(adapter.isCurrent(), false);
    await f.show(); assert.equal(adapter.isCurrent(), true); assert.equal(adapters.length, 1); assert.equal(f.element("message-body").value, "Keep this private draft");
    await f.click("logout"); assert.equal(destroyed, 1); assert.equal(adapter.isCurrent(), false); assert.equal(f.element("open-profile").hidden, true); assert.equal(posts(f).length, 0);
  });
  let mounts = 0; const disabled = harness({ profileFactory: () => { mounts++; } }); await flush();
  assert.equal(mounts, 0); assert.equal(disabled.element("open-profile").hidden, true);
});

test("avatar bytes accept only canonical role-scoped JPEG URLs and enforce the thumbnail size while streaming", async () => {
  const results = []; const f = harness({ intercept: path => path.includes("/avatar?") ? results.shift() : undefined }); await flush();
  const load = f.inspect().fetchProfileBinary, path = "/api/profile/client/avatar?v=1", first = f.calls.length;
  for (const invalid of ["https://example.invalid" + path, path + "&extra=1", "/api/profile/admin/avatar?v=1", "/api/profile/client/avatar?v=01", "/api/profile/client/avatar?v=4294967296", "/api/profile/client/conversations/invalid/avatar?v=1"]) await assert.rejects(load(invalid), /invalid_avatar_request/);
  await assert.rejects(load(path, { maxBytes: 262145 }), /invalid_avatar_request/); assert.equal(f.calls.length, first);
  const valid = avatarResponse({ declared: "4" }); results.push(valid); const blob = await load(path);
  assert.equal(blob.type, "image/jpeg"); assert.equal(blob.size, 4); assert.equal(valid.cancelled, true);
  const oversized = avatarResponse({ chunks: [new Uint8Array(131072), new Uint8Array(1)] }); results.push(oversized);
  await assert.rejects(load(path, { maxBytes: 262144 }), /invalid_avatar_response/); assert.equal(oversized.cancelled, true);
  for (const result of [avatarResponse({ declared: "5" }), avatarResponse({ declared: "131073" }), avatarResponse({ type: "image/png" })]) {
    results.push(result); await assert.rejects(load(path), /invalid_avatar_response/);
  }
  assert.equal(f.createdUrls.length, 0); assert.equal(posts(f).length, 0);
});

test("a delayed profile module from a hidden page cannot block mounting after visibility resumes", async () => {
  const gate = pause(); let imports = 0, mounts = 0;
  const module = { createProfileUI() { mounts++; return { suspend() {}, destroy() {} }; } };
  const f = harness({ profileLoader: () => ++imports === 1 ? gate.promise : module,
    intercept: path => path === "/api/chat/client/capabilities" ? response(200, { enabled: true, profile: { enabled: true, avatars: true } }) : undefined });
  await flush(); assert.equal(imports, 1); assert.equal(mounts, 0); assert.equal(f.element("open-profile").hidden, true);
  await f.hide(); await f.show(); assert.equal(imports, 2); assert.equal(mounts, 1); assert.equal(f.element("open-profile").hidden, false);
  gate.resolve(module); await flush(); assert.equal(mounts, 1); assert.equal(f.element("open-profile").hidden, false);
});

test("an avatar cached hit proves the current owner and cannot reuse a blob after a cookie replacement", async () => {
  const f = harness({ intercept: path => path.includes("/avatar?") ? avatarResponse() : undefined }); await flush();
  const cid = f.conversation().id, path = `/api/profile/client/conversations/${cid}/avatar?v=1`, load = f.inspect().avatarImageUrl;
  const url = await load(path, cid); assert.match(url, /^blob:/); const before = f.calls.length;
  assert.equal(await load(path, cid), url);
  assert.ok(f.calls.slice(before).some(call => call.path === "/api/access/session")); assert.equal(f.calls.slice(before).filter(call => call.path === path).length, 0);
  f.state.currentSession = session(2, "B".repeat(43)); await assert.rejects(load(path, cid), error => error.stale === true); await flush();
  assert.ok(f.revoked.includes(url)); assert.equal(f.createdUrls.length, 1); assert.equal(f.inspect().sessionOwner.id, id(2)); assert.equal(f.redirects.length, 0);
});

test("late unauthorized avatar headers and late bytes cannot sign out a new owner or create private blob URLs", async t => {
  for (const phase of ["headers", "bytes", "hide"]) await t.test(phase, async () => {
    const gate = pause(); let reads = 0;
    const f = harness({ intercept: path => path.includes("/avatar?") ? phase === "headers" ? gate.promise : avatarResponse({ read: async () => ++reads === 1 ? gate.promise : { done: true } }) : undefined }); await flush();
    const path = `/api/profile/client/conversations/${f.conversation().id}/avatar?v=1`;
    const pending = f.inspect().avatarImageUrl(path, f.conversation().id); const rejected = assert.rejects(pending, error => error.stale === true); await flush();
    if (phase === "hide") await f.hide(); else f.state.currentSession = session(2, "B".repeat(43));
    gate.resolve(phase === "headers" ? response(401, { error: "authentication_required" }) : { value: new Uint8Array([255, 216, 255, 217]), done: false });
    await rejected; await flush(); assert.equal(f.createdUrls.length, 0); assert.equal(f.redirects.length, 0);
    if (phase !== "hide") assert.equal(f.inspect().sessionOwner.id, id(2));
  });
});

test("peer avatars use guarded blobs and keep initials when absent, removed, stale or replaced while loading", async () => {
  const gate = pause(); const f = harness({ intercept: path => path === "/api/chat/client/capabilities" ? response(200, { enabled: true, profile: { enabled: true, avatars: true } })
    : path.includes("/avatar?v=1") ? gate.promise : path.includes("/avatar?v=2") ? avatarResponse() : undefined }); await flush();
  const conv = f.conversation(), container = f.element("peer-avatar"), render = () => f.context.renderPeerAvatar(container, conv);
  conv.peerName = "Synthetic Peer"; render(); assert.equal(container.textContent, "SP");
  conv.peerAvatar = { version: "1", url: `/api/profile/client/conversations/${conv.id}/avatar?v=1` }; render(); await flush();
  assert.equal(container.children.length, 0);
  conv.peerAvatar = { version: "2", url: `/api/profile/client/conversations/${conv.id}/avatar?v=2` }; render(); await flush();
  const image = container.querySelector("img"); assert.match(image.src, /^blob:/); assert.equal(f.createdUrls.length, 1);
  gate.resolve(avatarResponse()); await flush(); assert.equal(container.querySelector("img"), image); assert.equal(f.createdUrls.length, 1);
  delete conv.peerAvatar; render(); assert.equal(container.textContent, "SP"); assert.equal(container.children.length, 0); assert.ok(f.revoked.includes(image.src));
  conv.peerAvatar = { version: "1", url: `/api/profile/client/conversations/${conv.id}/avatar?v=1` }; render(); await flush();
  assert.equal(container.textContent, "SP"); assert.equal(container.children.length, 0);
  await f.hide(); assert.equal(f.inspect().avatarContainers.size, 0); assert.equal(posts(f).length, 0);
});

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
for (const role of ["client", "admin"]) test(`${role}: emojis replace the selected draft text without media, network or automatic sending`, async () => {
  const f = harness({ currentSession: session(1, "A".repeat(43), role) }); await flush();
  if (role === "admin") {
    for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush();
  }
  assert.equal(f.element("open-emojis").disabled, false);
  assert.equal(f.element("pick-image").hidden, true, "emoji availability is independent from photos");
  f.element("message-body").value = "Bonjour toi !"; f.element("message-body").setSelectionRange(8, 11);
  const before = f.calls.length; await f.click("open-emojis");
  assert.equal(f.element("emoji-dialog").open, true); assert.equal(f.document.activeElement, f.element("emoji-search"));
  assert.ok(f.element("emoji-list").children.length >= 150);
  const kiss = f.element("emoji-list").children.find(button => button.dataset.emojiId === "kiss-face");
  assert.ok(kiss.getAttribute("aria-label"));
  for (const handler of kiss.events.get("click")) handler({}); await flush();
  assert.equal(f.element("message-body").value, "Bonjour 😘 !");
  assert.equal(f.element("message-body").selectionStart, 10); assert.equal(f.element("message-body").selectionEnd, 10);
  assert.equal(f.inspect().states.get(f.inspect().selected).draft, "Bonjour 😘 !");
  assert.equal(f.document.activeElement, f.element("message-body")); assert.equal(f.element("emoji-dialog").open, false);
  assert.equal(f.element("emoji-list").children.length, 0); assert.equal(f.element("send").disabled, false);
  assert.equal(f.calls.length, before); assert.equal(f.state.posts, 0);
});

for (const role of ["client", "admin"]) test(`${role}: secondary panels close on Escape, outside interaction, hiding and owner replacement without sending`, async () => {
  const f = harness({ currentSession: session(1, "A".repeat(43), role),
    intercept: path => path === `/api/media/${role}/capabilities` ? response(200, { enabled: true }) : undefined });
  await flush();
  if (role === "admin") { for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush(); }
  f.element("message-body").value = "A private draft stays unchanged";
  for (const handler of f.element("message-body").events.get("input")) handler({});
  await f.click("open-conversation-menu");
  assert.equal(f.element("chat-menu").hidden, false); assert.equal(f.element("open-conversation-menu").getAttribute("aria-expanded"), "true");
  assert.equal(f.document.activeElement.id, "close-chat-menu");
  let prevented = false; await f.event("keydown", { key: "Escape", preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.element("chat-menu").hidden, true);
  assert.equal(f.element("open-conversation-menu").getAttribute("aria-expanded"), "false");
  assert.equal(f.document.activeElement.id, "open-conversation-menu");

  await f.click("open-conversation-menu"); await f.click("open-composer-tools");
  assert.equal(f.element("chat-menu").hidden, true); assert.equal(f.element("composer-tools").hidden, false);
  assert.equal(f.element("open-composer-tools").getAttribute("aria-expanded"), "true");
  assert.equal(f.document.activeElement.id, "close-composer-tools");
  await f.event("pointerdown", { target: f.element("message-body") });
  assert.equal(f.element("composer-tools").hidden, true); assert.equal(f.element("open-composer-tools").getAttribute("aria-expanded"), "false");
  assert.equal(f.element("message-body").value, "A private draft stays unchanged");

  await f.click("open-composer-tools"); await f.hide();
  assert.equal(f.element("chat-menu").hidden, true); assert.equal(f.element("composer-tools").hidden, true);
  await f.show(); assert.equal(f.element("message-body").value, "A private draft stays unchanged");
  if (role === "admin") {
    await f.click("open-composer-tools"); await f.click("back-to-inbox");
    assert.equal(f.element("chat-menu").hidden, true); assert.equal(f.element("composer-tools").hidden, true);
    for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush();
    assert.equal(f.element("message-body").value, "A private draft stays unchanged");
  }
  await f.click("open-conversation-menu"); await f.hide(); f.state.currentSession = session(2, "B".repeat(43), role); await f.show();
  assert.equal(f.element("chat-menu").hidden, true); assert.equal(f.element("composer-tools").hidden, true);
  assert.equal(f.element("message-body").value, ""); assert.equal(f.state.posts, 0);
  assert.equal(f.calls.filter(call => call.options.method === "POST" && /\/export$/.test(call.path)).length, 0);
});

test("emoji selection preserves full drafts and photo captions without truncation or a request", async () => {
  for (const image of [false, true]) {
    const f = harness({ intercept: path => path === "/api/media/client/capabilities" ? response(200, { enabled: true }) : undefined }); await flush();
    if (image) {
      f.element("image-file").files = [new Blob(["Synthetic image"], { type: "image/jpeg" })];
      for (const handler of f.element("image-file").events.get("change")) handler({}); await flush();
      assert.ok(f.inspect().states.get(f.inspect().selected).imageDraft);
    }
    const draft = "x".repeat(image ? 999 : 4095); f.element("message-body").value = draft;
    f.element("message-body").setSelectionRange(draft.length, draft.length);
    const before = f.calls.length; await f.click("open-emojis");
    const kiss = f.element("emoji-list").children.find(button => button.dataset.emojiId === "kiss-face");
    for (const handler of kiss.events.get("click")) handler({}); await flush();
    assert.equal(f.element("message-body").value, draft); assert.equal(f.element("emoji-dialog").open, true);
    assert.match(f.element("emoji-status").textContent, /Raccourcis le brouillon/);
    assert.equal(f.calls.length, before); assert.equal(f.state.posts, 0);
  }
});

test("emoji dialogs close and forget searches on hide or account change, and old choices cannot alter a new dialog", async () => {
  const f = harness(); await flush(); await f.click("open-emojis");
  f.element("emoji-skin-tone").value = "dark";
  for (const handler of f.element("emoji-skin-tone").events.get("change")) handler({}); await flush();
  assert.equal(f.element("emoji-list").children.find(button => button.dataset.emojiId === "thumbs-up").textContent, "👍🏿");
  const old = f.element("emoji-list").children.find(button => button.dataset.emojiId === "kiss-face");
  f.element("emoji-search").value = "A private search";
  await f.hide();
  assert.equal(f.element("emoji-dialog").open, false); assert.equal(f.element("emoji-list").children.length, 0);
  assert.equal(f.element("emoji-search").value, "");
  for (const handler of old.events.get("click")) handler({}); await flush(); assert.equal(f.element("message-body").value, "");
  await f.show(); await f.click("open-emojis");
  assert.equal(f.element("emoji-skin-tone").value, "dark", "same-owner visibility resume retains the preference");
  assert.equal(f.element("emoji-list").children.find(button => button.dataset.emojiId === "thumbs-up").textContent, "👍🏿");
  await f.hide();
  f.state.currentSession = session(2, "B".repeat(43)); await f.show(); await f.click("open-emojis");
  assert.equal(f.element("emoji-dialog").open, true);
  assert.equal(f.element("emoji-skin-tone").value, "default", "a different account starts with the neutral preference");
  assert.equal(f.element("emoji-list").children.find(button => button.dataset.emojiId === "thumbs-up").textContent, "👍");
  for (const handler of old.events.get("click")) handler({}); await flush();
  assert.equal(f.element("emoji-dialog").open, true); assert.equal(f.element("message-body").value, "");
  await f.click("close-emojis"); assert.equal(f.document.activeElement, f.element("open-emojis"));
  assert.equal(f.element("emoji-categories").children.length, 0); assert.equal(f.state.posts, 0);
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
  await revealMessageDetails(article); remove.focus(); assert.equal(f.document.activeElement, remove);
  await f.advance(3000);
  assert.ok(f.calls.some((call) => call.path.includes("/events?")), "a real polling cycle completed");
  assert.equal(f.document.activeElement, remove);
  assert.equal(messages.children.at(-1), article);
  assert.equal(article.querySelector(".delete-message"), remove);
  assert.equal(remove.isConnected, true); assert.equal(f.document.activeElement, remove);
  assert.match(contents(article), /Keep my keyboard position/);
  assert.equal(article.classList.contains("is-selected"), true); assert.equal(article.querySelector(".message-meta").hidden, false);
});

for (const role of ["client", "admin"]) test(`${role}: one message at a time exposes details and selection is cleared across content, visibility and account changes`, async () => {
  const f = harness({ currentSession: session(1, "A".repeat(43), role) }); await flush();
  if (role === "admin") { for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush(); }
  await f.send("A synthetic own message");
  const rows = () => f.element("messages").children;
  const selected = () => rows().filter(row => row.classList.contains("is-selected"));
  const toggle = async row => { const button = row.querySelector(".message-details-toggle"); for (const handler of button.events.get("click")) handler({ target: button }); await flush(); };
  assert.ok(rows().every(row => row.querySelector(".message-meta").hidden));
  const peer = rows()[0], own = rows().at(-1), oldToggle = own.querySelector(".message-details-toggle");
  await toggle(peer); assert.equal(selected().length, 1); assert.equal(peer.querySelector(".message-meta").hidden, false);
  assert.equal(peer.querySelector(".delete-message"), null, "a peer message never gains an own-message delete action");
  await toggle(own); assert.equal(selected().length, 1); assert.equal(peer.querySelector(".message-meta").hidden, true);
  assert.equal(own.querySelector(".message-meta").hidden, false); assert.ok(own.querySelector(".delete-message"));
  assert.equal(oldToggle.getAttribute("aria-expanded"), "true");
  assert.equal(oldToggle.getAttribute("aria-controls"), own.querySelector(".message-meta").id);
  await toggle(own); assert.equal(selected().length, 0); assert.equal(oldToggle.getAttribute("aria-expanded"), "false");
  await toggle(own); await f.event("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(selected().length, 0); assert.equal(f.document.activeElement, oldToggle);
  await toggle(own); await f.event("click", { target: f.element("message-body") });
  assert.equal(selected().length, 0); assert.equal(own.querySelector(".message-meta").hidden, true);

  await toggle(own);
  const current = f.inspect().states.get(f.inspect().selected);
  current.messages.get(own.dataset.sequence).body = "Changed synthetic content";
  vm.runInContext("renderMessages(currentState())", f.context); await flush();
  assert.equal(selected().length, 0, "replaced content cannot retain an old selection");
  for (const handler of oldToggle.events.get("click")) handler({ target: oldToggle }); await flush();
  assert.equal(selected().length, 0, "an obsolete details control cannot select its replacement");

  if (role === "admin") {
    await toggle(rows().at(-1)); await f.click("back-to-inbox");
    assert.equal(selected().length, 0);
    for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush();
    assert.ok(rows().every(row => row.querySelector(".message-meta").hidden));
  }
  await toggle(rows().at(-1)); await f.hide(); assert.equal(selected().length, 0);
  await f.show(); assert.ok(rows().every(row => row.querySelector(".message-meta").hidden));
  await toggle(rows().at(-1)); await f.hide(); f.state.currentSession = session(2, "B".repeat(43), role); await f.show();
  assert.equal(selected().length, 0); assert.ok(rows().every(row => row.querySelector(".message-meta").hidden));
  assert.equal(posts(f).length, 1); assert.equal(f.calls.filter(call => call.path.endsWith("/delete")).length, 0);
});

function photoFixture(f, { sender = "me", messageId = id(800), sequence = "1" } = {}) {
  const conv = f.conversation(), role = f.state.currentSession.user.role;
  return { id: messageId, sequence, sender, body: "A private photo", createdAt: now, deletedAt: null, clientMessageId: null,
    media: { id: id(801), width: 1000, height: 800, thumbnailWidth: 400, thumbnailHeight: 320,
      fullUrl: `/api/media/${role}/conversations/${conv.id}/messages/${messageId}/full`, thumbnailUrl: `/api/media/${role}/conversations/${conv.id}/messages/${messageId}/thumb` } };
}
const photoResponse = () => ({ ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => new Blob(["synthetic private photo"], { type: "image/jpeg" }) });

for (const role of ["client", "admin"]) test(`${role}: a receipt-only poll preserves the photo and focus while exposing reads only to Jessie`, async () => {
  let f;
  f = harness({ currentSession: session(1, "A".repeat(43), role), intercept: (path) => {
    if (path === `/api/media/${role}/capabilities`) return response(200, { enabled: true });
    if (path.endsWith("/messages?limit=50")) return response(200, { conversation: f.conversation(), messages: [photoFixture(f)], eventCursor: "1", hasMoreBefore: false });
    if (path.endsWith("/thumb")) return photoResponse();
    return undefined;
  } }); await flush();
  if (role === "admin") {
    for (const handler of f.element("conversations").children[0].events.get("click")) handler({});
    await flush();
  }
  const article = f.element("messages").children[0], photo = article.querySelector(".photo-open"), image = photo.querySelector("img"), remove = article.querySelector(".delete-message");
  assert.ok(image); await revealMessageDetails(article); assert.match(contents(article), /Envoyé/); photo.focus();
  f.conversation().peerReadSequence = "1";
  await f.advance(3000);
  assert.equal(f.element("messages").children[0], article);
  assert.equal(article.querySelector(".photo-open"), photo); assert.equal(photo.querySelector("img"), image);
  assert.equal(article.querySelector(".delete-message"), remove); assert.equal(f.document.activeElement, photo);
  const receipt = article.querySelector(".message-meta").children[1];
  assert.equal(receipt.textContent, role === "admin" ? "Lu" : "Envoyé");
  assert.equal(article.classList.contains("is-selected"), true); assert.equal(article.querySelector(".message-meta").hidden, false);
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
  const messages = f.element("messages"), article = messages.children[0], remove = article.querySelector(".delete-message"); await revealMessageDetails(article); remove.focus();
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
  const button = f.element("messages").children[0].querySelector(".delete-message"); await revealMessageDetails(button.parentElement.parentElement); button.focus();
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
  const opener = f.element("messages").children[0].querySelector(".delete-message"); await revealMessageDetails(opener.parentElement.parentElement); opener.focus();
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

async function openPersonalReplies(f) {
  await flush();
  if (!f.inspect().selected) { for (const handler of f.element("conversations").children[0].events.get("click")) handler({}); await flush(); }
  await f.click("open-quick-replies");
}
async function submitPersonalReply(f, title, body, language = "fr") {
  f.element("personal-reply-title").value = title; f.element("personal-reply-body").value = body; f.element("personal-reply-language").value = language;
  for (const handler of f.element("personal-reply-editor").events.get("submit")) handler({ preventDefault() {} }); await flush();
}
async function clickPersonalNode(node) { for (const handler of node.events.get("click") ?? []) handler({}); await flush(); }
function personalRow(f, replyId) { return f.element("personal-replies-list").children.find(node => node.dataset.personalId === replyId); }
function personalAction(row, name) { return row.querySelectorAll("button").find(node => node.dataset.personalAction === name); }

test("personal quick replies create, edit, insert without sending and delete across independent administrator sessions", async () => {
  const catalogue = { version: "0", replies: [] }, first = harness({ currentSession: session(1, "A".repeat(43), "admin"), quickReplies: catalogue });
  await openPersonalReplies(first); await first.click("new-personal-reply");
  await submitPersonalReply(first, "Mon accueil 👩‍💻", "Texte personnel <b>brut</b> 😊");
  assert.equal(catalogue.version, "1"); assert.equal(catalogue.replies.length, 1); assert.equal(first.state.posts, 0);
  assert.equal(first.element("personal-reply-editor").hidden, true); assert.equal(first.element("personal-reply-body").value, "");
  const replyId = catalogue.replies[0].id; assert.match(replyId, /^[0-9a-f]{32}$/);
  const second = harness({ currentSession: session(1, "B".repeat(43), "admin"), quickReplies: catalogue }); await openPersonalReplies(second);
  const insert = personalRow(second, replyId).querySelector(".personal-reply-insert"); second.element("message-body").value = "Brouillon";
  await clickPersonalNode(insert); assert.equal(second.element("message-body").value, "Brouillon\nTexte personnel <b>brut</b> 😊"); assert.equal(second.state.posts, 0);
  await second.click("open-quick-replies"); await clickPersonalNode(personalAction(personalRow(second, replyId), "edit"));
  await submitPersonalReply(second, "Accueil modifié", "Texte modifié"); assert.equal(catalogue.version, "2");
  await first.click("close-quick-replies"); await first.click("open-quick-replies"); assert.equal(personalRow(first, replyId).querySelector("strong").textContent, "Accueil modifié");
  await clickPersonalNode(personalAction(personalRow(first, replyId), "delete")); assert.equal(catalogue.replies.length, 1);
  await clickPersonalNode(personalAction(personalRow(first, replyId), "confirm-delete")); assert.equal(catalogue.version, "3"); assert.equal(catalogue.replies.length, 0);
  assert.equal(first.state.posts + second.state.posts, 0); assert.equal(first.state.quickReplyWrites + second.state.quickReplyWrites, 3);
});

test("personal quick reply CAS conflicts preserve the editor and merge only after explicit reload and save", async () => {
  const catalogue = { version: "1", replies: [{ id: id(901), title: "Initial", body: "Texte initial", language: "fr" }] };
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin"), quickReplies: catalogue }); await openPersonalReplies(f);
  await clickPersonalNode(personalAction(personalRow(f, id(901)), "edit"));
  catalogue.version = "2"; catalogue.replies.push({ id: id(902), title: "Autre session", body: "À conserver", language: "en" });
  await submitPersonalReply(f, "Mon titre", "Mon brouillon"); assert.equal(catalogue.version, "2"); assert.equal(f.element("personal-reply-body").value, "Mon brouillon");
  assert.match(f.element("personal-replies-status").textContent, /changé ailleurs/); assert.equal(f.element("personal-reply-save").disabled, true); assert.equal(f.state.quickReplyWrites, 1);
  await submitPersonalReply(f, "Mon titre", "Mon brouillon"); assert.equal(f.state.quickReplyWrites, 1, "conflict never retries a mutation");
  await f.click("reload-personal-replies"); assert.equal(f.element("personal-reply-body").value, "Mon brouillon"); assert.equal(f.element("personal-reply-save").disabled, false);
  await submitPersonalReply(f, "Mon titre", "Mon brouillon"); assert.equal(catalogue.version, "3"); assert.equal(catalogue.replies.length, 2);
  assert.equal(catalogue.replies.find(reply => reply.id === id(902)).body, "À conserver"); assert.equal(catalogue.replies.find(reply => reply.id === id(901)).body, "Mon brouillon");
});

test("an uncertain personal reply save requires explicit reload and never automatically repeats a POST", async () => {
  let lost = true;
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin"), intercept: (path, options, state) => {
    if (path !== "/api/admin/quick-replies" || options.method !== "POST" || !lost) return;
    lost = false; const command = JSON.parse(options.body); state.quickReplies.version = "1"; state.quickReplies.replies = structuredClone(command.replies);
    return Promise.reject(new Error("synthetic_lost_ack"));
  } });
  await openPersonalReplies(f); await f.click("new-personal-reply"); await submitPersonalReply(f, "Titre", "Réponse incertaine");
  const mutations = () => f.calls.filter(call => call.path === "/api/admin/quick-replies" && call.options.method === "POST");
  assert.equal(mutations().length, 1); assert.equal(f.element("personal-reply-body").value, "Réponse incertaine"); assert.equal(f.element("personal-reply-save").disabled, true);
  await f.advance(60000); assert.equal(mutations().length, 1); await f.click("reload-personal-replies");
  assert.equal(f.element("personal-reply-body").value, "Réponse incertaine"); assert.equal(f.state.quickReplies.replies.length, 1); assert.equal(mutations().length, 1);
});

test("personal replies respect caption limits and are erased on hide, stale network completion and owner replacement", async () => {
  const catalogue = { version: "1", replies: [{ id: id(901), title: "Private title", body: "x".repeat(1001), language: "fr" }] };
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin"), quickReplies: catalogue }); await openPersonalReplies(f);
  f.inspect().states.get(f.inspect().selected).videoDraft = { file: {} }; await clickPersonalNode(personalRow(f, id(901)).querySelector(".personal-reply-insert"));
  assert.equal(f.element("message-body").value, ""); assert.match(f.element("quick-replies-status").textContent, /ne peut pas être ajoutée/);
  await clickPersonalNode(personalAction(personalRow(f, id(901)), "edit")); assert.equal(f.element("personal-reply-body").value.length, 1001);
  await f.hide(); assert.equal(f.element("personal-reply-body").value, ""); assert.equal(f.element("personal-replies-list").children.length, 0);
  f.state.currentSession = session(2, "B".repeat(43), "admin"); await f.show(); assert.equal(f.element("personal-reply-title").value, ""); assert.equal(f.state.posts, 0);
  const pending = pause(); const delayed = harness({ currentSession: session(1, "C".repeat(43), "admin"), intercept: path => path === "/api/admin/quick-replies" ? pending.promise : undefined });
  await openPersonalReplies(delayed); await delayed.hide(); pending.resolve(response(200, catalogue)); await flush();
  assert.equal(delayed.element("personal-replies-list").children.length, 0); assert.equal(delayed.element("quick-replies-dialog").open, false);
  const client = harness(); await flush(); await client.click("open-quick-replies"); assert.equal(client.calls.some(call => call.path === "/api/admin/quick-replies"), false);
});

test("compatibility video capabilities preserve existing players and gallery while refusing every new draft/send", async () => {
  const f = harness({ intercept: path => path === "/api/chat/client/capabilities" ? response(200, { enabled: true, video: { enabled: true, creationEnabled: false, maxBytes: 104857600, mime: "video/mp4" } }) : undefined });
  await flush(); const state = f.inspect().states.get(f.inspect().selected), item = state.messages.get("1");
  item.video = { id: id(902), bytes: 23, mime: "video/mp4", contentUrl: "/api/video/client/conversations/" + state.id + "/messages/" + item.id + "/content" };
  await f.hide(); await f.show();
  assert.equal(f.element("pick-video").hidden, true); assert.equal(f.element("open-video-gallery").hidden, false);
  const player = f.element("messages").querySelector("video"); assert.ok(player); assert.equal(player.controls, true); assert.equal(player.src, item.video.contentUrl);
  const uploads = videoTransport(f); f.element("video-file").files = [new Blob(["synthetic"], { type: "video/mp4" })];
  for (const handler of f.element("video-file").events.get("change")) handler({}); await flush(); assert.equal(state.videoDraft, null);
  state.videoDraft = { file: new Blob(["synthetic"], { type: "video/mp4" }), ready: true, invalid: false };
  await f.send("No new video"); assert.equal(uploads.length, 0); assert.equal(state.pending, null); assert.equal(posts(f).length, 0); assert.equal(f.element("send").disabled, true);
});

test("read-only personal replies still insert saved text but expose no editing or mutation", async () => {
  const catalogue = { version: "1", replies: [{ id: id(901), title: "Saved title", body: "Saved private reply", language: "fr" }], writable: false };
  const f = harness({ currentSession: session(1, "A".repeat(43), "admin"), quickReplies: catalogue }); await openPersonalReplies(f);
  const row = personalRow(f, id(901)); assert.ok(row); assert.equal(row.querySelector(".personal-reply-actions").hidden, true);
  assert.equal(f.element("new-personal-reply").hidden, true); await f.click("new-personal-reply"); assert.equal(f.element("personal-reply-editor").hidden, true);
  await clickPersonalNode(personalAction(row, "edit")); assert.equal(f.element("personal-reply-editor").hidden, true); assert.equal(f.state.quickReplyWrites, 0);
  f.element("message-body").value = "Draft"; await clickPersonalNode(row.querySelector(".personal-reply-insert"));
  assert.equal(f.element("message-body").value, "Draft\nSaved private reply"); assert.equal(f.state.posts, 0); assert.equal(f.state.quickReplyWrites, 0);
});

test("a read-only capability change preserves an unsaved reply draft for copying or explicit cancellation", async () => {
  const catalogue = { version: "0", replies: [] }, f = harness({ currentSession: session(1, "A".repeat(43), "admin"), quickReplies: catalogue });
  await openPersonalReplies(f); await f.click("new-personal-reply"); f.element("personal-reply-title").value = "Unsent title"; f.element("personal-reply-body").value = "Unsent private draft";
  catalogue.writable = false; await f.click("reload-personal-replies");
  assert.equal(f.element("personal-reply-editor").hidden, false); assert.equal(f.element("personal-reply-body").value, "Unsent private draft");
  assert.equal(f.element("personal-reply-body").readOnly, true); assert.equal(f.element("personal-reply-body").disabled, false); assert.equal(f.element("personal-reply-save").hidden, true);
  assert.match(f.element("personal-replies-status").textContent, /lecture seule.*brouillon est conservé/); assert.equal(f.state.quickReplyWrites, 0);
  await submitPersonalReply(f, "Unsent title", "Unsent private draft"); assert.equal(f.state.quickReplyWrites, 0);
  await f.click("personal-reply-cancel"); assert.equal(f.element("personal-reply-body").value, ""); assert.equal(f.element("personal-reply-editor").hidden, true);
});
