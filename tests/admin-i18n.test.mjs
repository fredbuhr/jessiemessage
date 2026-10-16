import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../public/admin-login.html", import.meta.url), "utf8");
const controller = await readFile(new URL("../public/admin-login.js", import.meta.url), "utf8");
const catalogue = await readFile(new URL("../public/i18n-admin.js", import.meta.url), "utf8");
const now = 1750000000000;
const flush = async () => { for (let index = 0; index < 8; index++) await new Promise((resolve) => setImmediate(resolve)); };
const dictionaries = {};
vm.runInNewContext(catalogue, { JessieI18n: { register(value) { Object.assign(dictionaries, value); } } });

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attributes = new Map(); this.dataset = {};
    this.events = new Map(); this.value = ""; this.defaultValue = ""; this.hidden = false; this.checked = false; this.disabled = false; this._text = "";
    const classes = new Set();
    this.classList = { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name),
      toggle(name, force) { const include = force ?? !classes.has(name); if (include) classes.add(name); else classes.delete(name); return include; } };
  }
  get isConnected() { return this.root === true || Boolean(this.parentElement?.isConnected); }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join(""); }
  set textContent(value) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = String(value); }
  get childElementCount() { return this.children.length; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ""; this.append(...nodes); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "hidden") this.hidden = true; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, handler) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(handler); }
  matches(selector) {
    if (selector.startsWith("[")) return this.hasAttribute(selector.slice(1, -1));
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelectorAll(selector) { return this.children.flatMap((node) => [selector.split(",").some((part) => node.matches(part.trim())) ? node : null, ...node.querySelectorAll(selector)]).filter(Boolean); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  reset() { for (const node of this.querySelectorAll("input")) { node.value = node.defaultValue; node.checked = false; } }
  focus() {} select() {}
}
function parse() {
  const container = new Element("root"); container.root = true;
  const stack = [container], nodes = new Map();
  const voids = new Set(["meta", "link", "input", "img", "br"]);
  for (const match of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const token = match[0];
    if (/^<!/.test(token)) continue;
    if (token.startsWith("</")) { stack.pop(); continue; }
    if (token.startsWith("<")) {
      const tag = /^<([a-z0-9-]+)/i.exec(token)?.[1]; if (!tag) continue;
      const node = new Element(tag);
      for (const attribute of token.matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)(?:="([^"]*)")?/g)) {
        const name = attribute[1]; if (name === tag) continue;
        node.setAttribute(name, attribute[2] ?? "");
      }
      const identifier = node.getAttribute("id"); if (identifier) nodes.set(identifier, node);
      if (tag === "input") { node.value = node.defaultValue = node.getAttribute("value") ?? ""; }
      stack.at(-1).append(node);
      if (!voids.has(tag)) stack.push(node);
    } else stack.at(-1)._text += token;
  }
  return { container, nodes };
}
const client = (index = 3, changes = {}) => ({ id: index.toString(16).padStart(32, "0"), pseudonym: "Bienvenue, Jessie.", email: "private-client@example.invalid",
  status: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, createdAt: now - 1000, accessExpiresAt: now - 100, ...changes });
async function harness({ clients = [client(), client(4, { status: "pending", emailVerified: false, ageAssured: false, approved: false, accessExpiresAt: null })] } = {}) {
  const runtime = await readFile(new URL("../public/i18n.js", import.meta.url), "utf8");
  const { container, nodes } = parse(), documentEvents = new Map(), windowEvents = new Map(), calls = [], storage = new Map(), timers = new Map();
  const add = (map, name, callback) => { if (!map.has(name)) map.set(name, []); map.get(name).push(callback); };
  const document = { visibilityState: "visible", readyState: "complete", documentElement: container.querySelectorAll("html")[0], body: container.querySelectorAll("body")[0],
    getElementById: (id) => nodes.get(id), querySelectorAll: (selector) => container.querySelectorAll(selector),
    createElement: (tag) => new Element(tag), addEventListener: (name, callback) => add(documentEvents, name, callback) };
  const invitations = ["pending", "used", "expired", "revoked"].map((state, index) => ({ id: String(index + 6).repeat(32), state, createdAt: now - 1000, expiresAt: now + 3600000, accessDays: 3650 }));
  const session = { user: { id: "1".repeat(32), role: "admin", pseudonym: "Se connecter" }, csrf: "A".repeat(43), expiresAt: now + 28800000 };
  const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  let timerId = 0;
  const context = vm.createContext({ document, window: { addEventListener: (name, callback) => add(windowEvents, name, callback) },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    navigator: { language: "fr-FR", languages: ["fr-FR"], clipboard: { async writeText() {} } },
    location: { pathname: "/admin" }, history: { replaceState() {} }, AbortController, Intl,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, duration) => { const key = ++timerId; timers.set(key, { callback, duration }); return key; }, clearTimeout: (key) => timers.delete(key),
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === "/api/auth/session") return response(200, session);
      if (path === "/api/admin/access") return response(200, { capabilities: {} });
      if (path === "/api/chat/admin/capabilities") return response(200, { enabled: true });
      if (path.startsWith("/api/admin/clients?")) return response(200, { clients, hasMore: false, nextCursor: null });
      if (path.startsWith("/api/admin/invitations?")) return response(200, { invitations, hasMore: false, nextCursor: null });
      throw new Error("Unexpected synthetic request");
    } });
  vm.runInContext(runtime, context, { filename: "public/i18n.js" });
  vm.runInContext(catalogue, context, { filename: "public/i18n-admin.js" });
  vm.runInContext(controller, context, { filename: "public/admin-login.js" });
  await flush();
  return { context, nodes, calls, storage, document,
    language(value) { context.JessieI18n.setLanguage(value); },
    async hide() { document.visibilityState = "hidden"; for (const callback of documentEvents.get("visibilitychange") ?? []) callback({}); await flush(); },
  };
}

test("administrator HTML translations cover static labels, MFA help and native hints without translating form values or URLs", () => {
  const sources = [...html.matchAll(/data-jm-i18n(?:-aria-label|-title|-placeholder)?="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(sources.length > 35);
  for (const source of sources) assert.equal(typeof dictionaries[source], "string", source);
  assert.equal(dictionaries["Code de sécurité"], "Security code");
  assert.match(dictionaries["Les 6 chiffres de ton application d’authentification, ou un code de récupération."], /authenticator app/);
  assert.equal(dictionaries["Saisis ton mot de passe administrateur."], "Enter your administrator password.");
  assert.ok(html.indexOf('src="/i18n.js"') < html.indexOf('src="/i18n-admin.js"'));
  assert.ok(html.indexOf('src="/i18n-admin.js"') < html.indexOf('src="/admin-login.js"'));
  assert.match(html, /button[^>]+data-jm-language/); assert.match(html, /mailto:contact@jessiemessage\.com/);
  assert.doesNotMatch(html, /(?:href|value)="[^"]*"\s+data-jm-i18n-(?:href|value)/);
});
test("administrator language switches update static and loaded private UI in place while names, values and requests remain unchanged", async () => {
  const f = await harness(), clientList = f.nodes.get("clients-list"), invitationList = f.nodes.get("invitations-list");
  assert.equal(clientList.children.length, 2); assert.equal(invitationList.children.length, 4);
  const originalCard = clientList.children[0], originalHeading = originalCard.children[0], email = originalCard.children[1];
  const privateInput = originalCard.querySelectorAll("input")[0]; privateInput.value = "75";
  const beforeCalls = f.calls.length;
  f.language("en");
  assert.equal(f.nodes.get("login-button").textContent, "Sign in");
  assert.equal(f.nodes.get("factor-help").textContent, "The 6 digits from your authenticator app, or a recovery code.");
  assert.equal(f.nodes.get("connected-name").textContent, "Se connecter");
  assert.equal(originalHeading.textContent, "Bienvenue, Jessie."); assert.equal(email.textContent, "private-client@example.invalid");
  assert.equal(clientList.children[0], originalCard); assert.equal(privateInput.value, "75");
  assert.match(originalCard.textContent, /Status: Access expired · Email: verified/);
  assert.match(originalCard.textContent, /Manual admission/); assert.match(originalCard.textContent, /Access approved by Jess/);
  assert.doesNotMatch(originalCard.textContent, /Age assurance/);
  assert.match(originalCard.textContent, /Renew expired access/);
  assert.equal(privateInput.getAttribute("aria-label"), "Duration to add for Bienvenue, Jessie., in days");
  assert.match(invitationList.textContent, /Invitation · Available/); assert.match(invitationList.textContent, /Invitation · Revoked/);
  assert.match(invitationList.textContent, /Access for 3,650 days after approval/);
  assert.match(invitationList.textContent, new RegExp(new Date(now - 1000).toLocaleString("en-US").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(f.nodes.get("clients-page-note").textContent, /Most recent client accounts · 2 on this page · end of the list/);
  f.language("fr");
  assert.equal(f.nodes.get("login-button").textContent, "Se connecter"); assert.equal(originalHeading.textContent, "Bienvenue, Jessie.");
  assert.match(originalCard.textContent, /État : Accès expiré/); assert.equal(privateInput.value, "75");
  assert.equal(f.calls.length, beforeCalls); assert.ok([...f.storage.values()].every((value) => ["fr", "en"].includes(value)));
});
test("administrator private bindings are cleared on hide and language changes cannot restore a cleared account or issue requests", async () => {
  const f = await harness(); f.language("en");
  const privateList = f.nodes.get("clients-list"), privateCard = privateList.children[0];
  assert.match(privateCard.textContent, /private-client@example.invalid/);
  await f.hide(); const calls = f.calls.length;
  f.language("fr"); f.language("en");
  assert.equal(privateList.children.length, 0); assert.equal(f.nodes.get("invitations-list").children.length, 0);
  assert.equal(f.nodes.get("connected-name").textContent, ""); assert.equal(f.nodes.get("clients-page-note").textContent, "");
  assert.equal(f.nodes.get("admin-session-note").textContent, ""); assert.equal(f.nodes.get("connected").hidden, true);
  assert.equal(f.calls.length, calls); assert.equal(privateCard.isConnected, false);
});
