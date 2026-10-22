import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import * as readiness from "../../public/readiness-model.js";

const read = name => readFile(new URL(`../../public/${name}`, import.meta.url), "utf8");
export const [html, runtime, catalogue, controller] = await Promise.all([read("manual-backups.html"), read("i18n.js"), read("i18n-manual-backups.js"), read("manual-backups.js")]);
export const now = 1792660000000;
export const flush = async () => { for (let index = 0; index < 10; index++) await new Promise(resolve => setImmediate(resolve)); };
export const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
export const archive = () => ({ id: "capture-1792340000000-cccccccccccccccc", startedAt: 1792340000000, bytes: 104857600, sha256: "b".repeat(64), filename: "JessieMessage-capture-1792340000000-cccccccccccccccc.tar.gz.gpg" });
export const backupRequest = (requestId = "d".repeat(32), status = "queued", code = null) => ({ version: 1, requestId, status, requestedAt: now - 5000,
  startedAt: status === "queued" ? null : now - 4000, finishedAt: ["complete", "failed"].includes(status) ? now - 1000 : null,
  captureId: status === "complete" ? archive().id : null, code });
export const snapshot = (request = null, latestArchive = null) => ({ version: 1, mode: "manual", checkedAt: now, request, latestArchive,
  archiveCount: latestArchive ? 1 : 0, archives: latestArchive ? [latestArchive] : [], decryptionStatus: "not_checked" });

class Element {
  constructor(tag = "div", downloads = []) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map(); this.events = new Map(); this.parentElement = null;
    this.hidden = false; this.disabled = false; this._text = ""; this.downloads = downloads;
    const classes = new Set(); this.classList = { add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name), toggle(name, force) { const include = force ?? !classes.has(name); if (include) classes.add(name); else classes.delete(name); return include; } };
  }
  get isConnected() { return this.root === true || Boolean(this.parentElement?.isConnected); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = String(value); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.textContent = ""; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "hidden") this.hidden = true; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selector) { return selector.startsWith("[") ? this.hasAttribute(selector.slice(1, -1)) : selector.toUpperCase() === this.tagName; }
  querySelectorAll(selector) { return this.children.flatMap(child => [selector.split(",").some(part => child.matches(part.trim())) ? child : null, ...child.querySelectorAll(selector)]).filter(Boolean); }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
  click() { if (this.tagName === "A") this.downloads.push({ href: this.href, filename: this.download }); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
}
function parse(downloads) {
  const root = new Element("root", downloads); root.root = true;
  const stack = [root], nodes = new Map(), voids = new Set(["meta", "link", "img", "input", "br"]);
  for (const match of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const token = match[0]; if (/^<!/.test(token)) continue;
    if (token.startsWith("</")) { stack.pop(); continue; }
    if (token.startsWith("<")) {
      const tag = /^<([a-z0-9-]+)/i.exec(token)?.[1]; if (!tag) continue;
      const node = new Element(tag, downloads);
      for (const attribute of token.matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)(?:="([^"]*)")?/g)) if (attribute[1] !== tag) node.setAttribute(attribute[1], attribute[2] ?? "");
      if (node.hasAttribute("id")) nodes.set(node.getAttribute("id"), node);
      stack.at(-1).append(node); if (!voids.has(tag)) stack.push(node);
    } else stack.at(-1)._text += token;
  }
  return { root, nodes };
}
export async function harness({ summary: initial = snapshot(), post, auth } = {}) {
  const downloads = [], { root, nodes } = parse(downloads), documentEvents = new Map(), windowEvents = new Map(), calls = [], timers = new Map(), writes = [], storage = new Map();
  let input = initial, session = { user: { id: "1".repeat(32), role: "admin" }, csrf: "A".repeat(43), expiresAt: Date.now() + 3600000 }, timerId = 0;
  const redirects = [], add = (map, name, callback) => { if (!map.has(name)) map.set(name, []); map.get(name).push(callback); };
  const document = { visibilityState: "visible", readyState: "complete", documentElement: root.querySelectorAll("html")[0], body: root.querySelectorAll("body")[0],
    getElementById: id => nodes.get(id), querySelectorAll: selector => root.querySelectorAll(selector), createElement: tag => new Element(tag, downloads), addEventListener: (name, callback) => add(documentEvents, name, callback) };
  const context = vm.createContext({ ...readiness, document, window: { addEventListener: (name, callback) => add(windowEvents, name, callback) },
    location: { replace: value => redirects.push(value) }, navigator: { language: "fr-FR" }, AbortController, crypto: webcrypto, Intl,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem(key, value) { writes.push([key, value]); storage.set(key, value); } },
    JessieSessionClock: { scheduleSessionCheck(expiry, callback) { context.sessionCheck = callback; return () => {}; } },
    setTimeout(callback, duration) { const id = ++timerId; timers.set(id, { callback, duration }); return id; }, clearTimeout: id => timers.delete(id),
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === "/api/auth/session") return auth ? auth(session, calls) : response(session);
      if (path === "/api/admin/backups") return typeof input === "function" ? input() : response(input);
      if (path === "/api/admin/backups/captures") return post ? post(path, options) : response({ version: 1, mode: "manual", request: backupRequest(JSON.parse(options.body).requestId) }, 202);
      throw new Error(`Unexpected local request: ${path}`);
    } });
  vm.runInContext(runtime, context); vm.runInContext(catalogue, context);
  vm.runInContext(controller.replace(/^import[^\n]+\n/, ""), context, { filename: "public/manual-backups.js" }); await flush();
  const dispatch = async (map, name, event = {}) => { for (const callback of map.get(name) ?? []) callback(event); await flush(); };
  return { context, calls, document, nodes, downloads, redirects, timers, root, writes,
    get: id => nodes.get(id), language: value => context.JessieI18n.setLanguage(value), setSummary: value => { input = value; }, setSession: value => { session = value; }, session: () => session,
    click: id => dispatch(nodes.get(id).events, "click"),
    async visibility(value) { document.visibilityState = value; await dispatch(documentEvents, "visibilitychange"); },
    online: () => dispatch(windowEvents, "online"),
    async tick(duration = 5000) { const next = [...timers].find(([, timer]) => timer.duration === duration); assert.ok(next, `Expected ${duration}ms timer`); timers.delete(next[0]); next[1].callback(); await flush(); }
  };
}
