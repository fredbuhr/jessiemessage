import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import * as recoveryModel from "../public/recover-model.js";

const read = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const decode = (value) => value.replace(/&(?:quot|apos|amp|lt|gt|#(\d+)|#x([a-f\d]+));/gi, (whole, decimal, hex) => decimal ? String.fromCodePoint(Number(decimal)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ "&quot;": '"', "&apos;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">" })[whole] ?? whole);
const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const malformed = () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError("synthetic malformed JSON"); } });
const capability = () => response({ enabled: true, password: { minLength: 8, maxLength: 128 } });
const flush = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

class Classes {
  values = new Set();
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, force = !this.values.has(value)) { if (force) this.values.add(value); else this.values.delete(value); return force; }
  contains(value) { return this.values.has(value); }
}
class Element extends EventTarget {
  constructor(document, tag, attrs = {}) {
    super(); this.ownerDocument = document; this.localName = tag; this.tagName = tag.toUpperCase(); this.nodeType = 1;
    this.children = []; this.parentElement = null; this.attributes = new Map(Object.entries(attrs)); this._text = "";
    this.id = attrs.id ?? ""; this.type = attrs.type ?? ""; this.disabled = Object.hasOwn(attrs, "disabled"); this.readOnly = false;
    this.defaultValue = attrs.value ?? ""; this.value = this.defaultValue; this.defaultChecked = Object.hasOwn(attrs, "checked"); this.checked = this.defaultChecked;
    this.classList = new Classes(); this.style = {};
  }
  get dataset() { return Object.fromEntries([...this.attributes].filter(([key]) => key.startsWith("data-")).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_whole, letter) => letter.toUpperCase()), value])); }
  get hidden() { return this.attributes.has("hidden"); }
  set hidden(value) { if (value) this.attributes.set("hidden", ""); else this.attributes.delete("hidden"); }
  get lang() { return this.getAttribute("lang") ?? ""; }
  set lang(value) { this.setAttribute("lang", value); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get childElementCount() { return this.children.length; }
  append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
  replaceChildren(...items) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...items); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.ownerDocument.activeElement = this; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = null; }
  reset() { for (const node of this.descendants()) if (["input", "textarea", "select"].includes(node.localName)) { node.value = node.defaultValue; node.checked = node.defaultChecked; } }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  matches(selector) {
    const match = /^(\w+)?(?:\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\])?$/.exec(selector.trim());
    assert.ok(match, `unsupported synthetic selector: ${selector}`);
    return (!match[1] || this.localName === match[1]) && (!match[2] || this.hasAttribute(match[2]) && (match[3] === undefined || this.getAttribute(match[2]) === match[3]));
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) {
    return this.descendants().filter((node) => selector.split(",").some((part) => {
      const pieces = part.trim().split(/\s+/); if (!node.matches(pieces.at(-1))) return false;
      if (pieces.length === 1) return true;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.matches(pieces[0])) return true;
      return false;
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  get isConnected() { return this === this.ownerDocument.root || Boolean(this.parentElement?.isConnected); }
}
class Document extends EventTarget {
  constructor(html) {
    super(); this.visibilityState = "visible"; this.readyState = "complete"; this.root = new Element(this, "document"); const stack = [this.root];
    const voids = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
    for (const token of html.matchAll(/<(\/?)([a-z][\w:-]*)([^>]*)>|([^<]+)/gi)) {
      if (token[4] !== undefined) { stack.at(-1)._text += decode(token[4]); continue; }
      const [, closing, rawTag, rawAttrs] = token; const tag = rawTag.toLowerCase();
      if (closing) { while (stack.length > 1 && stack.at(-1).localName !== tag) stack.pop(); if (stack.length > 1) stack.pop(); continue; }
      const attrs = {};
      for (const attr of rawAttrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[attr[1]] = decode(attr[2] ?? attr[3] ?? attr[4] ?? "");
      const node = new Element(this, tag, attrs); stack.at(-1).append(node);
      if (tag === "html") this.documentElement = node; if (tag === "body") this.body = node;
      if (!voids.has(tag) && !rawAttrs.endsWith("/")) stack.push(node);
    }
  }
  createElement(tag) { return new Element(this, tag); }
  getElementById(id) { return this.root.descendants().find((node) => node.id === id) ?? null; }
  querySelectorAll(selector) { return this.root.querySelectorAll(selector); }
  querySelector(selector) { return this.root.querySelector(selector); }
}
function controller(name, fetchHandler, { language = "fr", hash = "" } = {}) {
  const document = new Document(read(`${name}.html`)); const window = new EventTarget(); const calls = []; const storage = new Map([["jessiemessage.language", language]]); const writes = []; const timers = new Map(); let timer = 0;
  const location = { hash, pathname: `/${name}` }; const history = { replaceState(_state, _title, path) { location.hash = ""; location.pathname = path; } };
  const context = createContext({ document, window, location, history, navigator: { language: "fr-FR", languages: ["fr-FR"] }, URLSearchParams, AbortController, Event, Intl,
    __recoveryModel: recoveryModel,
    sessionStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { writes.push([key, value]); storage.set(key, String(value)); } },
    setTimeout(callback, milliseconds) { const id = ++timer; timers.set(id, { callback, milliseconds }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(path, options = {}) { calls.push({ path, options }); return Promise.resolve().then(() => fetchHandler(path, options, calls)); } });
  for (const script of ["i18n.js", "i18n-access.js"]) new Script(read(script), { filename: `public/${script}` }).runInContext(context);
  let source = read(`${name}.js`);
  if (name === "recover") source = source.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*"\/recover-model\.js";/, "const {$1} = __recoveryModel;");
  new Script(source, { filename: `public/${name}.js`, importModuleDynamically: async () => { throw new Error("optional feature unavailable in fixture"); } }).runInContext(context);
  return { document, context, calls, writes, location, get: (id) => document.getElementById(id), language: (value) => context.JessieI18n.setLanguage(value),
    input(id, value) { const node = document.getElementById(id); node.value = value; node.dispatchEvent(new Event("input")); },
    submit(id) { document.getElementById(id).dispatchEvent(new Event("submit", { cancelable: true })); },
    hide() { document.visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange")); },
    dispose() { window.dispatchEvent(new Event("pagehide")); } };
}
const user = (state = "pending", pseudonym = "Bienvenue.") => ({ user: { id: "a".repeat(32), role: "client", pseudonym }, csrf: "A".repeat(43), expiresAt: Date.now() + 3600000,
  access: { state, admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: false, ageAssured: false, approved: false, expiresAt: null } });

test("access and recovery catalogs cover every declared UI leaf and load before their controllers", () => {
  let catalog; new Script(read("i18n-access.js")).runInNewContext({ JessieI18n: { register(value) { catalog = value; } } });
  for (const page of ["access", "recover"]) {
    const html = read(`${page}.html`); const document = new Document(html);
    assert.ok(html.indexOf('src="/i18n.js"') < html.indexOf('src="/i18n-access.js"'));
    assert.ok(html.indexOf('src="/i18n-access.js"') < html.indexOf(`src="/${page}.js"`));
    assert.ok(html.includes('href="/i18n.css"')); assert.equal(document.querySelectorAll("[data-jm-language]").length, 1);
    for (const node of document.root.descendants()) for (const [name, source] of node.attributes) if (name.startsWith("data-jm-i18n")) assert.equal(typeof catalog[source], "string", source);
    for (const node of document.querySelectorAll("input")) assert.equal(node.hasAttribute("data-jm-i18n"), false, "credentials are not UI text sources");
  }
  assert.match(catalog["Cette déclaration ne vérifie pas ta majorité. Ton accès nécessite la vérification de ton e-mail et l’approbation manuelle de Jess."], /does not verify your age/);
});

for (const state of ["pending", "expired"]) test(`access ${state} switches live without another HTTP request or translating a UI-like pseudonym`, async () => {
  const f = controller("access", (path) => path === "/api/access/session" ? response(user(state)) : capability(), { language: "en" });
  try {
    await flush(); const count = f.calls.length; assert.equal(f.get("client-name").textContent, "Bienvenue.");
    assert.match(f.get("client-access-state").textContent, state === "pending" ? /awaiting approval/ : /has expired/);
    assert.equal(f.get("client-checks").children[1].textContent, "Email address: pending");
    f.language("fr"); assert.match(f.get("client-access-state").textContent, state === "pending" ? /en attente/ : /a expiré/);
    assert.equal(f.get("client-checks").children[0].textContent, "Admission manuelle"); assert.equal(f.get("client-name").textContent, "Bienvenue.");
    f.hide(); f.language("en"); f.language("fr"); assert.equal(f.get("client-name").textContent, ""); assert.equal(f.get("client-access-state").textContent, "");
    assert.equal(f.get("client-checks").children.length, 0); assert.equal(f.calls.length, count);
    assert.ok(f.writes.every(([key, value]) => key === "jessiemessage.language" && ["fr", "en"].includes(value)));
  } finally { f.dispose(); }
});

for (const ageAssured of [false, true]) test(`manual admission displays Jess approval without an age-verification badge (observation ${ageAssured})`, async () => {
  const input = user("active"); Object.assign(input.access, { emailVerified: true, approved: true, ageAssured });
  const f = controller("access", (path) => path === "/api/access/session" ? response(input) : capability(), { language: "en" });
  try {
    await flush();
    assert.match(f.get("client-checks").textContent, /Manual admission/); assert.match(f.get("client-checks").textContent, /Invitation used/);
    assert.match(f.get("client-checks").textContent, /Access approved by Jess/); assert.doesNotMatch(f.get("client-checks").textContent, /age|Adult status/i);
    assert.equal(f.get("client-chat-link").hidden, false);
    f.language("fr"); assert.match(f.get("client-checks").textContent, /Accès approuvé par Jess/);
    assert.doesNotMatch(f.get("client-checks").textContent, /majorité/i);
  } finally { f.dispose(); }
});

test("client access rejects missing or unknown admission fields before rendering account data", async () => {
  for (const changes of [{ admissionPolicy: undefined }, { admissionPolicy: "unknown" }, { invitationConsumed: undefined }, { invitationConsumed: "true" }]) {
    const input = user(); Object.assign(input.access, changes);
    const f = controller("access", (path) => path === "/api/access/session" ? response(input) : capability());
    try {
      await flush(); assert.equal(f.get("client-name").textContent, ""); assert.equal(f.get("client-checks").children.length, 0);
      assert.equal(f.get("client-chat-link").hidden, true); assert.match(f.get("access-status").textContent, /indisponible/);
    } finally { f.dispose(); }
  }
});

test("access malformed session error switches live and preserves untouched credentials", async () => {
  const f = controller("access", (path) => path === "/api/access/session" ? malformed() : capability(), { language: "en" });
  try {
    await flush(); assert.equal(f.get("access-status").textContent, "Access is currently unavailable. Try again in a few moments.");
    f.input("login-email", "Bienvenue."); f.input("login-password", " Mot de passe "); const count = f.calls.length;
    f.language("fr"); assert.equal(f.get("access-status").textContent, "L’accès est indisponible pour le moment. Réessaie dans quelques instants.");
    assert.equal(f.get("login-email").value, "Bienvenue."); assert.equal(f.get("login-password").value, " Mot de passe "); assert.equal(f.calls.length, count);
  } finally { f.dispose(); }
});

test("invitation date and duration are reformatted live without repeating or exposing its token", async () => {
  const expiresAt = Date.UTC(2027, 1, 12, 15, 4, 5); const token = "A".repeat(43);
  const f = controller("access", (path) => path === "/api/access/session" ? response({}, 401) : path === "/api/access/invitation" ? response({ expiresAt, accessDays: 1234 }) : capability(), { hash: `#invitation=${token}` });
  try {
    await flush(); const count = f.calls.length; const french = f.get("invitation-summary").textContent;
    assert.ok(french.includes(new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(expiresAt).slice(0, 2)));
    assert.match(french, /Invitation valable/); f.language("en"); const english = f.get("invitation-summary").textContent;
    assert.match(english, /Invitation valid until/); assert.match(english, /1,234 days/); assert.notEqual(english, french);
    assert.equal(f.calls.length, count); assert.equal(f.location.hash, ""); assert.ok(!f.document.root.textContent.includes(token)); assert.ok(f.writes.every(([key]) => key === "jessiemessage.language"));
  } finally { f.dispose(); }
});

test("recovery malformed capability switches its retry error without another HTTP request", async () => {
  const f = controller("recover", () => malformed(), { language: "en" });
  try {
    await flush(); const count = f.calls.length; assert.equal(f.get("recovery-status").textContent, "Availability could not be checked. Try again in a few moments.");
    f.language("fr"); assert.equal(f.get("recovery-status").textContent, "La disponibilité n’a pas pu être vérifiée. Réessaie dans quelques instants."); assert.equal(f.calls.length, count);
  } finally { f.dispose(); }
});

test("recovery password counters and validation translate in place while password bytes remain unchanged", async () => {
  const f = controller("recover", () => capability(), { language: "en", hash: `#reset=${"A".repeat(43)}` });
  try {
    await flush(); f.input("recovery-password", " Secret"); f.input("recovery-confirmation", "different"); const count = f.calls.length;
    assert.equal(f.get("recovery-password-help").textContent, "1 more character to reach the minimum of 8.");
    assert.equal(f.get("recovery-confirmation-help").textContent, "The two passwords do not match yet.");
    f.language("fr"); assert.equal(f.get("recovery-password-help").textContent, "1 caractère encore pour atteindre le minimum de 8.");
    assert.equal(f.get("recovery-password").value, " Secret"); assert.equal(f.get("recovery-confirmation").value, "different");
    f.input("recovery-password", "ab"); f.language("en"); assert.equal(f.get("recovery-password-help").textContent, "6 more characters to reach the minimum of 8.");
    assert.equal(f.calls.length, count); f.hide(); f.language("fr"); assert.equal(f.get("recovery-password").value, ""); assert.equal(f.get("recovery-confirmation").value, "");
    assert.equal(f.get("recovery-password-help").textContent, "Entre 8 et 128 caractères. Les espaces et les accents sont conservés.");
  } finally { f.dispose(); }
});

test("language switches during recovery POST neither repeat the request nor reset its pending form", async () => {
  const pending = deferred(); const f = controller("recover", (path) => path.endsWith("capabilities") ? capability() : pending.promise, { language: "en" });
  try {
    await flush(); f.input("recovery-email", "synthetic@example.invalid"); f.submit("recovery-request-form"); await flush(); const count = f.calls.length;
    assert.equal(f.get("recovery-status").textContent, "Sending your request…"); f.language("fr"); assert.equal(f.get("recovery-status").textContent, "Demande en cours…");
    assert.equal(f.get("recovery-email").value, "synthetic@example.invalid"); assert.equal(f.get("recovery-email").readOnly, true); assert.equal(f.calls.length, count);
    pending.resolve(response({ status: "accepted" })); await flush(); assert.match(f.get("recovery-status").textContent, /Si cette adresse/); f.language("en"); assert.match(f.get("recovery-status").textContent, /If this address/);
    assert.equal(f.calls.length, count);
  } finally { f.dispose(); }
});

test("an expired recovery link translates its error while preserving the submitted token and exact password", async () => {
  const token = "A".repeat(43); const password = "  Mot de passe é  ";
  const f = controller("recover", (path) => path.endsWith("capabilities") ? capability() : response({ error: "invalid_reset_link" }, 401), { language: "en", hash: `#reset=${token}` });
  try {
    await flush(); f.input("recovery-password", password); f.input("recovery-confirmation", password); f.submit("recovery-reset-form"); await flush();
    const post = f.calls.find((call) => call.options.method === "POST"); assert.deepEqual(JSON.parse(post.options.body), { token, password });
    assert.match(f.get("recovery-status").textContent, /This link is invalid, has expired/); const count = f.calls.length;
    f.language("fr"); assert.match(f.get("recovery-status").textContent, /Ce lien est invalide, expiré/); assert.equal(f.calls.length, count);
    assert.ok(!f.document.root.textContent.includes(token)); assert.ok(!f.document.root.textContent.includes(password));
  } finally { f.dispose(); }
});
