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
function controller(name, fetchHandler, { language = "fr", hash = "", pathname = `/${name}` } = {}) {
  const document = new Document(read(`${name}.html`)); const window = new EventTarget(); const calls = []; const storage = new Map([["jessiemessage.language", language]]); const writes = []; const timers = new Map(); let timer = 0;
  const navigations = [];
  const location = { hash, pathname, replace(value) { navigations.push(value); const target = new URL(value, "https://example.invalid"); this.pathname = target.pathname; this.hash = target.hash; } };
  const history = { replaceState(_state, _title, path) { const target = new URL(path, "https://example.invalid"); location.hash = target.hash; location.pathname = target.pathname; } };
  const context = createContext({ document, window, location, history, navigator: { language: "fr-FR", languages: ["fr-FR"] }, URLSearchParams, AbortController, Event, Intl,
    __recoveryModel: recoveryModel,
    sessionStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { writes.push([key, value]); storage.set(key, String(value)); } },
    setTimeout(callback, milliseconds) { const id = ++timer; timers.set(id, { callback, milliseconds }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(path, options = {}) { calls.push({ path, options }); return Promise.resolve().then(() => fetchHandler(path, options, calls)); } });
  for (const script of ["notification-link.js", "i18n.js", "help-link.js", "i18n-access.js", "session-clock.js"]) new Script(read(script), { filename: `public/${script}` }).runInContext(context);
  let source = read(`${name}.js`);
  if (name === "recover") source = source.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*"\/recover-model\.js";/, "const {$1} = __recoveryModel;");
  new Script(source, { filename: `public/${name}.js`, importModuleDynamically: async () => { throw new Error("optional feature unavailable in fixture"); } }).runInContext(context);
  return { document, context, calls, writes, location, navigations, timers, async tick(milliseconds) { const timer = [...timers].find(([, value]) => value.milliseconds === milliseconds); assert.ok(timer, `timer ${milliseconds}`); timers.delete(timer[0]); timer[1].callback(); await flush(); }, async online() { window.dispatchEvent(new Event("online")); await flush(); }, get: (id) => document.getElementById(id), language: (value) => context.JessieI18n.setLanguage(value),
    input(id, value) { const node = document.getElementById(id); node.value = value; node.dispatchEvent(new Event("input")); },
    submit(id) { document.getElementById(id).dispatchEvent(new Event("submit", { cancelable: true })); },
    hide() { document.visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange")); },
    async show() { document.visibilityState = "visible"; document.dispatchEvent(new Event("visibilitychange")); await flush(); },
    dispose() { window.dispatchEvent(new Event("pagehide")); } };
}
const user = (state = "pending", pseudonym = "Bienvenue.") => ({ user: { id: "a".repeat(32), role: "client", pseudonym }, csrf: "A".repeat(43), expiresAt: Date.now() + 3600000,
  access: { state, admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: false, ageAssured: false, approved: false, expiresAt: null } });

for (const language of ["fr", "en"]) for (const refusalStatus of [400, 401]) test(`a refused verification link returns to credential sign-in and resend in ${language} (HTTP ${refusalStatus})`, async () => {
  const token = "A".repeat(43);
  const f = controller("access", path => path === "/api/access/verify-email" ? response({ error: "invalid_credentials" }, refusalStatus)
    : path === "/api/access/session" ? response({}, 401) : capability(), { language, hash: `#verification=${token}` });
  try {
    await flush(); assert.equal(f.get("email-verification").hidden, false);
    f.get("verify-email-button").dispatchEvent(new Event("click")); await flush();
    assert.equal(f.get("client-login-form").hidden, false, "an already used/expired/revoked link must not trap the user before sign-in");
    assert.equal(f.get("email-verification").hidden, true); assert.equal(f.get("resend-section").hidden, false);
    assert.equal(f.document.activeElement, f.get("login-email"));
    assert.equal(f.get("access-status").classList.contains("is-error"), true);
    assert.match(f.get("access-status").textContent, language === "fr" ? /déjà utilisé.*Connecte-toi/ : /already used.*Sign in/);
    assert.equal(f.calls.filter(call => call.path === "/api/access/verify-email").length, 1);
    assert.equal(f.calls.filter(call => call.path === "/api/access/resend-verification" || call.path === "/api/access/login").length, 0);
    assert.equal(f.location.hash, ""); assert.equal(f.writes.some(([, value]) => value.includes(token)), false);
  } finally { f.dispose(); }
});

for (const verifiedStatus of [200, 401]) test(`verification intent cannot adopt another client's cookie before explicit sign-in (HTTP ${verifiedStatus})`, async () => {
  let signedIn = false;
  const oldOwner = user("active", "Other client must stay hidden");
  const newOwner = { ...user("active", "New invited client"), user: { id: "b".repeat(32), role: "client", pseudonym: "New invited client" } };
  oldOwner.access.emailVerified = oldOwner.access.approved = true;
  newOwner.access.emailVerified = newOwner.access.approved = true;
  const f = controller("access", (path, options) => {
    if (path === "/api/access/session") return response(signedIn ? newOwner : oldOwner);
    if (path === "/api/access/verify-email") return response(verifiedStatus === 200 ? { status: "email_verified" } : { error: "invalid_credentials" }, verifiedStatus);
    if (path === "/api/access/login") { assert.deepEqual(JSON.parse(options.body), { email: "new-client@example.invalid", password: "synthetic password" }); signedIn = true; return response(newOwner); }
    if (path === "/api/chat/client/capabilities") return response({ enabled: true });
    return capability();
  }, { hash: `#verification=${"A".repeat(43)}` });
  try {
    await flush(); assert.equal(f.get("client-connected").hidden, true); assert.equal(f.get("client-name").textContent, "");
    assert.equal(f.calls.filter(call => call.path === "/api/access/session").length, 0, "a verification link does not select a pre-existing client session");
    f.get("verify-email-button").dispatchEvent(new Event("click")); await flush();
    assert.equal(f.get("client-login-form").hidden, false); assert.equal(f.get("client-connected").hidden, true);
    if (verifiedStatus === 200) {
      assert.equal(f.get("access-status").textContent, "Ton adresse e-mail est vérifiée. Connecte-toi pour ouvrir ta conversation.");
      const count = f.calls.length;
      f.language("en");
      assert.equal(f.get("access-status").textContent, "Your email address is verified. Sign in to open your conversation.");
      assert.equal(f.calls.length, count, "translating the verification result must not repeat a request");
      f.language("fr");
    }
    f.hide(); await f.show(); await f.online();
    assert.equal(f.get("client-login-form").hidden, false); assert.equal(f.calls.filter(call => call.path === "/api/access/session").length, 0);
    f.input("login-email", "new-client@example.invalid"); f.input("login-password", "synthetic password"); f.submit("client-login-form"); await flush();
    assert.equal(f.calls.filter(call => call.path === "/api/access/login").length, 1);
    assert.equal(f.calls.filter(call => call.path === "/api/access/session").length, 1, "sign-in is followed by the actual current owner proof");
    assert.equal(f.get("client-name").textContent, "New invited client"); assert.deepEqual(f.navigations, ["/messages"]);
  } finally { f.dispose(); }
});

test("a verification response lost while hidden leaves an explicit sign-in path without replaying the token", async () => {
  const verification = deferred();
  const f = controller("access", path => path === "/api/access/verify-email" ? verification.promise
    : path === "/api/access/session" ? response({}, 401) : capability(), { hash: `#verification=${"A".repeat(43)}` });
  try {
    await flush(); f.get("verify-email-button").dispatchEvent(new Event("click")); await flush(); f.hide();
    verification.resolve(response({ status: "email_verified" })); await flush(); await f.show();
    assert.equal(f.get("email-verification").hidden, false);
    assert.ok(f.get("verification-login-button"), "the user can leave an uncertain verification without consuming the link again");
    f.get("verification-login-button").dispatchEvent(new Event("click")); await flush();
    assert.equal(f.get("client-login-form").hidden, false); assert.equal(f.get("email-verification").hidden, true);
    assert.equal(f.document.activeElement, f.get("login-email"));
    assert.equal(f.calls.filter(call => call.path === "/api/access/verify-email").length, 1);
  } finally { f.dispose(); }
});

test("the explicit verification sign-in choice does not submit the token or silently log in", async () => {
  const f = controller("access", () => capability(), { hash: `#verification=${"A".repeat(43)}` });
  try {
    await flush(); assert.ok(f.get("verification-login-button")); f.get("verification-login-button").dispatchEvent(new Event("click")); await flush();
    assert.equal(f.get("client-login-form").hidden, false); assert.equal(f.get("email-verification").hidden, true);
    assert.equal(f.calls.some(call => call.options.method === "POST"), false);
  } finally { f.dispose(); }
});

test("an unavailable verification remains retryable and offers sign-in without declaring the token invalid", async () => {
  const f = controller("access", path => path === "/api/access/verify-email" ? response({ error: "authentication_unavailable" }, 503) : capability(), { hash: `#verification=${"A".repeat(43)}` });
  try {
    await flush(); f.get("verify-email-button").dispatchEvent(new Event("click")); await flush();
    assert.equal(f.get("email-verification").hidden, false); assert.equal(f.get("verify-email-button").disabled, false); assert.ok(f.get("verification-login-button"));
    assert.match(f.get("access-status").textContent, /indisponible/);
    assert.equal(f.calls.some(call => call.path === "/api/access/login" || call.path === "/api/access/resend-verification"), false);
  } finally { f.dispose(); }
});

test("access and recovery catalogs cover every declared UI leaf and load before their controllers", () => {
  const catalog = {}, catalogContext = {
    JessieI18n: { register(value) { Object.assign(catalog, value); }, getLanguage: () => "fr", onChange() {} },
    document: { querySelectorAll: () => [] },
  };
  for (const script of ["help-link.js", "i18n-access.js"]) new Script(read(script)).runInNewContext(catalogContext);
  for (const page of ["access", "recover"]) {
    const html = read(`${page}.html`); const document = new Document(html);
    assert.ok(html.indexOf('src="/i18n.js"') < html.indexOf('src="/i18n-access.js"'));
    assert.ok(html.indexOf('src="/i18n-access.js"') < html.indexOf(`src="/${page}.js"`));
    assert.ok(html.includes('href="/i18n.css"')); assert.equal(document.querySelectorAll("[data-jm-language]").length, 1);
    for (const node of document.root.descendants()) for (const [name, source] of node.attributes) if (name.startsWith("data-jm-i18n")) assert.equal(typeof catalog[source], "string", source);
    for (const node of document.querySelectorAll("input")) assert.equal(node.hasAttribute("data-jm-i18n"), false, "credentials are not UI text sources");
  }
  assert.match(catalog["Cette déclaration ne vérifie pas ta majorité. Ton accès nécessite la vérification de ton e-mail et ma validation manuelle."], /does not verify your age/);
});

for (const state of ["pending", "expired"]) test(`access ${state} switches live without another HTTP request or translating a UI-like pseudonym`, async () => {
  const f = controller("access", (path) => path === "/api/access/session" ? response(user(state)) : capability(), { language: "en" });
  try {
    await flush(); const count = f.calls.length; assert.equal(f.get("client-name").textContent, "Bienvenue.");
    assert.match(f.get("client-access-state").textContent, state === "pending" ? /Confirm your email/ : /has ended/);
    assert.equal(f.get("client-checks").children.length, 0);
    f.language("fr"); assert.match(f.get("client-access-state").textContent, state === "pending" ? /Confirme ton e-mail/ : /arrivé à son terme/);
    assert.equal(f.get("client-checks").children.length, 0); assert.equal(f.get("client-name").textContent, "Bienvenue.");
    f.hide(); f.language("en"); f.language("fr"); assert.equal(f.get("client-name").textContent, ""); assert.equal(f.get("client-access-state").textContent, "");
    assert.equal(f.get("client-checks").children.length, 0); assert.equal(f.calls.length, count);
    assert.ok(f.writes.every(([key, value]) => key === "jessiemessage.language" && ["fr", "en"].includes(value)));
  } finally { f.dispose(); }
});

for (const ageAssured of [false, true]) test(`active access shows its conversation without admission jargon or an age-verification badge (observation ${ageAssured})`, async () => {
  const input = user("active"); Object.assign(input.access, { emailVerified: true, approved: true, ageAssured });
  const f = controller("access", (path) => path === "/api/access/session" ? response(input) : capability(), { language: "en" });
  try {
    await flush();
    assert.equal(f.get("client-checks").children.length, 0); assert.equal(f.get("client-checks").hidden, true);
    assert.match(f.get("client-access-state").textContent, /conversation/);
    assert.equal(f.get("client-chat-link").hidden, false); assert.deepEqual(f.navigations, [], "direct account access stays available");
    f.language("fr"); assert.match(f.get("client-access-state").textContent, /conversation/);
    assert.doesNotMatch(f.get("client-checks").textContent, /majorité/i);
  } finally { f.dispose(); }
});

test("client access rejects missing or unknown admission fields before rendering account data", async () => {
  for (const changes of [{ admissionPolicy: undefined }, { admissionPolicy: "unknown" }, { invitationConsumed: undefined }, { invitationConsumed: "true" }]) {
    const input = user(); Object.assign(input.access, changes);
    const f = controller("access", (path) => path === "/api/access/session" ? response(input) : capability());
    try {
      await flush(); assert.equal(f.get("client-name").textContent, ""); assert.equal(f.get("client-checks").children.length, 0);
      assert.equal(f.get("client-chat-link").hidden, true); assert.match(f.get("access-status").textContent, /interrompue/);
    } finally { f.dispose(); }
  }
});

test("access malformed session error switches live and preserves untouched credentials", async () => {
  const f = controller("access", (path) => path === "/api/access/session" ? malformed() : capability(), { language: "en" });
  try {
    await flush(); assert.equal(f.get("access-status").textContent, "The connection was interrupted. Try again when the network is back.");
    f.input("login-email", "Bienvenue."); f.input("login-password", " Mot de passe "); const count = f.calls.length;
    f.language("fr"); assert.equal(f.get("access-status").textContent, "La connexion est interrompue. Réessaie dès que le réseau revient.");
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

test("invitation code validates explicitly in either language and reuses registration without URL or storage exposure", async () => {
  const code = "ABCDEFGHJKMNPQRSTVWX", expiresAt = Date.now() + 3600000;
  const f = controller("access", path => path === "/api/access/session" ? response({}, 401) : path === "/api/access/invitation" ? response({ expiresAt, accessDays: 30 }) : path === "/api/access/register" ? response({ status: "verification_pending" }) : capability());
  try {
    await flush(); f.get("show-invitation-code").dispatchEvent(new Event("click"));
    assert.equal(f.get("client-login-form").hidden, true); assert.equal(f.get("invitation-code-form").hidden, false);
    f.input("invitation-code", "abcd efgh-jkmn-pqrs tvwx"); f.language("en");
    assert.equal(f.get("invitation-code").value, "abcd efgh-jkmn-pqrs tvwx"); assert.equal(f.get("validate-invitation-code").textContent, "Validate my code");
    f.submit("invitation-code-form"); await flush();
    assert.equal(f.get("registration-form").hidden, false); assert.equal(f.get("invitation-code-form").hidden, true); assert.equal(f.get("invitation-code").value, "");
    const inspection = f.calls.filter(call => call.path === "/api/access/invitation"); assert.equal(inspection.length, 1); assert.deepEqual(JSON.parse(inspection[0].options.body), { token: code });
    assert.equal(f.calls.filter(call => call.path === "/api/access/register").length, 0);
    f.input("registration-email", "synthetic@example.invalid"); f.input("registration-name", "Synthetic client"); f.input("registration-password", "synthetic password"); f.get("age-declared").checked = true;
    f.submit("registration-form"); await flush();
    const registration = f.calls.find(call => call.path === "/api/access/register"); assert.equal(JSON.parse(registration.options.body).invitationToken, code);
    assert.equal(f.location.hash, ""); assert.equal(f.get("registration-form").hidden, true); assert.equal(f.get("invitation-code").value, "");
    assert.ok(f.writes.every(([key]) => key === "jessiemessage.language")); assert.ok(!f.document.root.textContent.includes(code));
  } finally { f.dispose(); }
});

test("invalid invitation code has one generic retryable message and accepts only ASCII spaces and hyphens", async () => {
  const f = controller("access", path => path === "/api/access/session" ? response({}, 401) : path === "/api/access/invitation" ? response({ error: "invalid_invitation" }, 401) : capability());
  try {
    await flush(); f.get("show-invitation-code").dispatchEvent(new Event("click"));
    for (const input of ["bad", "ABCD\u00a0EFGH-JKMN-PQRS-TVWX", "A".repeat(18) + "ß", "A".repeat(17) + "ﬃ", "ABCD EFGH-JKMN-PQRS-TVWX"]) {
      f.input("invitation-code", input); f.submit("invitation-code-form"); await flush();
      assert.equal(f.get("access-status").textContent, "Ce code est invalide, expiré ou déjà utilisé."); assert.equal(f.get("invitation-code-form").hidden, false);
      assert.equal(f.get("validate-invitation-code").disabled, false);
    }
    assert.equal(f.calls.filter(call => call.path === "/api/access/invitation").length, 1);
    f.language("en"); assert.equal(f.get("access-status").textContent, "This code is invalid, expired or already used.");
    f.get("cancel-invitation-code").dispatchEvent(new Event("click")); assert.equal(f.get("invitation-code").value, ""); assert.equal(f.get("client-login-form").hidden, false);
  } finally { f.dispose(); }
});

test("a hidden invitation code inspection cannot reveal registration or replay itself after return", async () => {
  const pending = deferred(), f = controller("access", path => path === "/api/access/session" ? response({}, 401) : path === "/api/access/invitation" ? pending.promise : capability());
  try {
    await flush(); f.get("show-invitation-code").dispatchEvent(new Event("click")); f.input("invitation-code", "ABCD-EFGH-JKMN-PQRS-TVWX"); f.submit("invitation-code-form"); await flush();
    f.hide(); pending.resolve(response({ expiresAt: Date.now() + 3600000, accessDays: 30 })); await flush();
    assert.equal(f.get("registration-form").hidden, true); assert.equal(f.get("invitation-code").value, ""); await f.show();
    assert.equal(f.calls.filter(call => call.path === "/api/access/invitation").length, 1); assert.equal(f.get("registration-form").hidden, true); assert.equal(f.get("invitation-code-form").hidden, false);
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


test("legacy pending access checks are visible, bounded and reveal automatic activation", async () => {
  let current = user(); current.access.emailVerified = true;
  const f = controller("access", (path) => path === "/api/access/session" ? response(current) : capability());
  try {
    await flush(); assert.match(f.get("client-access-state").textContent, /Reconnecte-toi pour activer/);
    const originalStateNode = f.get("client-access-state");
    await f.tick(15000); assert.equal(f.get("client-access-state"), originalStateNode);
    current = user("active"); Object.assign(current.access, { emailVerified: true, approved: true });
    await f.tick(15000); assert.equal(f.get("client-chat-link").hidden, false); assert.equal(f.get("check-client-access").hidden, true);
    f.hide(); assert.equal(f.timers.size, 0); assert.equal(f.get("client-name").textContent, "");
  } finally { f.dispose(); }
  const pending = controller("access", (path) => path === "/api/access/session" ? response(user()) : capability());
  try {
    await flush(); for (let index = 0; index < 60; index++) await pending.tick(15000);
    assert.ok([...pending.timers.values()].some((timer) => timer.milliseconds === 300000));
    assert.equal([...pending.timers.values()].some((timer) => timer.milliseconds === 15000), false);
    assert.equal(pending.get("check-client-access").hidden, false);
  } finally { pending.dispose(); }
});

test("an interrupted session proof hides private access and reconnects online without logging in again", async () => {
  let failed = true; const current = user("active"); Object.assign(current.access, { emailVerified: true, approved: true, expiresAt: Date.now() + 86400000 });
  const f = controller("access", (path) => path === "/api/access/session" ? failed ? Promise.reject(new TypeError("offline")) : response(current) : capability());
  try {
    await flush(); assert.equal(f.get("client-login-form").hidden, true); assert.equal(f.get("access-retry").hidden, false);
    assert.equal(f.get("client-connected").hidden, true); assert.equal(f.get("client-name").textContent, "");
    failed = false; await f.online(); assert.equal(f.get("client-connected").hidden, false); assert.equal(f.get("client-chat-link").hidden, false);
    assert.equal(f.get("client-validity").hidden, false); assert.match(f.get("client-validity").textContent, /jusqu’au/);
    f.language("en"); assert.match(f.get("client-validity").textContent, /open until/);
    assert.equal(f.calls.filter((call) => call.options.method === "POST").length, 0);
  } finally { f.dispose(); }
});


test("public client entry shows one login form without a migration hop, and explicit login opens the current conversation once", async () => {
  let loggedIn = false;
  const active = user("active"); Object.assign(active.access, { emailVerified: true, approved: true });
  const f = controller("access", (path, options) => {
    if (path === "/api/entry") return response({ status: "available", client: { state: "signed_out", href: "/access" }, administrator: null });
    if (path === "/api/access/login") { assert.deepEqual(JSON.parse(options.body), { email: "client@example.invalid", password: "synthetic password" }); loggedIn = true; return response(active); }
    if (path === "/api/access/session") return response(active, loggedIn ? 200 : 401);
    return capability();
  }, { pathname: "/" });
  try {
    await flush(); assert.equal(f.get("client-login-form").hidden, false); assert.deepEqual(f.navigations, []);
    assert.equal(f.calls.some(call => call.path === "/api/access/session"), false);
    f.input("login-email", "client@example.invalid"); f.input("login-password", "synthetic password"); f.submit("client-login-form"); await flush();
    assert.deepEqual(f.navigations, ["/messages"]);
    assert.equal(f.calls.filter(call => call.path === "/api/access/login").length, 1);
    assert.equal(f.calls.filter(call => call.path === "/api/access/session").length, 1, "login is followed by a fresh owner proof");
    assert.equal(f.get("login-password").value, "");
    assert.equal(f.calls.some(call => call.path.includes("connect-device")), false);
  } finally { f.dispose(); }
});

test("public entry sends a single authenticated role straight to its own destination and keeps both roles explicit", async () => {
  const reference = "b".repeat(32);
  for (const roles of ["client", "admin", "both"]) {
    const f = controller("access", () => response({ status: "available", client: { state: roles === "admin" ? "signed_out" : "active", href: roles === "admin" ? "/access" : "/messages" },
      administrator: roles === "client" ? null : { state: "connected", href: "/admin" } }), { pathname: "/app", hash: `#notification=${reference}` });
    try {
      await flush();
      if (roles === "both") {
        assert.deepEqual(f.navigations, []); assert.equal(f.get("entry-role-choice").hidden, false); assert.equal(f.get("client-login-form").hidden, true);
        assert.equal(f.get("entry-client-link").href, `/messages#notification=${reference}`);
        assert.equal(f.get("entry-admin-link").href, `/admin/messages#notification=${reference}`);
      } else assert.deepEqual(f.navigations, [`${roles === "admin" ? "/admin/messages" : "/messages"}#notification=${reference}`]);
      assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, "/api/entry");
      assert.deepEqual(f.writes, [], "a role is never selected through persisted identity state");
    } finally { f.dispose(); }
  }
});

test("public entry returns from the two-role choice to neutral sign-in copy after the sessions end elsewhere", async () => {
  let authenticated = true;
  const f = controller("access", (path) => path === "/api/entry" ? response({ status: "available",
    client: { state: authenticated ? "active" : "signed_out", href: authenticated ? "/messages" : "/access" },
    administrator: authenticated ? { state: "connected", href: "/admin" } : null }) : capability(), { pathname: "/" });
  const intro = f.get("access-intro").textContent;
  try {
    await flush(); assert.equal(f.get("entry-role-choice").hidden, false); assert.equal(f.get("access-intro").textContent, intro);
    f.hide(); authenticated = false; await f.show();
    assert.equal(f.get("entry-role-choice").hidden, true); assert.equal(f.get("client-login-form").hidden, false);
    assert.equal(f.get("access-intro").textContent, intro); assert.equal(f.get("access-title").textContent, "Bienvenue.");
    assert.deepEqual(f.navigations, []);
    assert.equal(f.calls.filter(call => call.path === "/api/entry").length, 2);
    assert.equal(f.calls.some(call => call.options.method === "POST"), false);
  } finally { f.dispose(); }
});

test("an invalid or late public entry decision cannot navigate or expose a login guessed from a failed proof", async () => {
  for (const value of [{ status: "available", client: { state: "active", href: "https://attacker.invalid" }, administrator: null },
    { status: "available", client: null, administrator: { state: "connected", href: "/admin/messages" } }]) {
    const f = controller("access", () => response(value), { pathname: "/" });
    try { await flush(); assert.deepEqual(f.navigations, []); assert.equal(f.get("client-login-form").hidden, true); assert.equal(f.get("access-retry").hidden, false); }
    finally { f.dispose(); }
  }
  const pending = deferred(), f = controller("access", () => pending.promise, { pathname: "/" });
  try {
    await flush(); f.hide(); pending.resolve(response({ status: "available", client: { state: "active", href: "/messages" }, administrator: null })); await flush();
    assert.deepEqual(f.navigations, []); assert.equal(f.get("entry-role-choice").hidden, true);
  } finally { f.dispose(); }
});
