import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const runtime = await readFile(new URL("../public/i18n.js", import.meta.url), "utf8");
const homepage = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const entryController = await readFile(new URL("../public/entry.js", import.meta.url), "utf8");
const entryModel = await readFile(new URL("../public/entry-model.js", import.meta.url), "utf8");
const entryHTML = await readFile(new URL("../public/entry.html", import.meta.url), "utf8");
const flush = async () => { for (let index = 0; index < 8; index++) await new Promise((resolve) => setImmediate(resolve)); };
class Node {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.attributes = new Map(); this.children = []; this.parentElement = null; this.hidden = false; this.disabled = false; this.dataset = {}; this.value = ""; this._text = ""; this._connected = false; this.writes = 0; this.events = new Map(); this.classes = new Set(); this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
  get isConnected() { return this.parentElement ? this.parentElement.isConnected : this._connected; }
  set textContent(value) { this.writes++; this._text = String(value); for (const child of this.children) child.parentElement = null; this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  set href(value) { this.setAttribute("href", value); } get href() { return this.getAttribute("href"); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = null; this._connected = false; }
  matches(selector) { return selector.split(",").some((part) => { part = part.trim(); if (part.startsWith("#")) return this.getAttribute("id") === part.slice(1); const attribute = /^\[([^\]]+)\]$/.exec(part); return attribute ? this.getAttribute(attribute[1]) !== null : this.tagName.toLowerCase() === part; }); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) { return this.children.flatMap((node) => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
}
function harness({ stored, preferred = "fr-FR", blocked = false, storageMap = new Map(), visible = true } = {}) {
  if (stored !== undefined) storageMap.set("jessiemessage.language", stored);
  const html = new Node("html"); html._connected = true; const body = new Node("body"); html.append(body);
  const documentEvents = new Map(), windowEvents = new Map(), storageCalls = [], requests = [], navigation = [];
  const register = (events, name, callback) => { if (!events.has(name)) events.set(name, []); events.get(name).push(callback); };
  const document = { documentElement: html, body, visibilityState: visible ? "visible" : "hidden", title: "", querySelectorAll: (selector) => html.querySelectorAll(selector), querySelector: (selector) => html.querySelectorAll(selector)[0] ?? null,
    getElementById: (id) => html.querySelectorAll(`#${id}`)[0] ?? null, addEventListener: (name, callback) => register(documentEvents, name, callback) };
  const context = vm.createContext({ document, navigator: { language: preferred, onLine: true }, AbortController, setTimeout, clearTimeout,
    sessionStorage: { getItem(key) { storageCalls.push(["get", key]); if (blocked) throw new Error("storage blocked"); return storageMap.get(key) ?? null; }, setItem(key, value) { storageCalls.push(["set", key, value]); if (blocked) throw new Error("storage blocked"); storageMap.set(key, value); } },
    location: { replace(path) { navigation.push(path); } },
    history: { replaceState() {} }, window: { addEventListener: (name, callback) => register(windowEvents, name, callback), matchMedia: () => ({ matches: false, addEventListener() {} }) },
    fetch: async (path, options) => { requests.push({ path, options }); return { status: 200, ok: true, json: async () => vm.runInContext('({status:"available",client:{state:"active",href:"/messages"},administrator:null})', context) }; } });
  const f = { context, document, body, storageMap, storageCalls, requests, navigation, run: (code) => vm.runInContext(code, context),
    node(source = null, parent = body, tag = "span") { const node = new Node(tag); if (source !== null) { node.textContent = source; node.setAttribute("data-jm-i18n", source); } parent?.append(node); return node; },
    expose(name, value) { context[name] = value; },
    event(name, value = {}) { for (const callback of documentEvents.get(name) ?? windowEvents.get(name) ?? []) callback(value); },
    click(node) { const event = { target: node, preventDefault() {} }; for (const callback of node.events.get("click") ?? []) callback(event); for (const callback of documentEvents.get("click") ?? []) callback(event); },
    hide() { document.visibilityState = "hidden"; this.event("visibilitychange"); }, show() { document.visibilityState = "visible"; this.event("visibilitychange"); },
    load() { vm.runInContext(runtime, context, { filename: "public/i18n.js" }); this.api = context.JessieI18n; return this; }
  };
  return f;
}

test("language preference reads only its own key, falls back safely and survives same-tab navigation", () => {
  const shared = new Map([["other-private-key", "untouched"]]), first = harness({ preferred: "en-CA", storageMap: shared }).load();
  assert.equal(first.api.getLanguage(), "en"); assert.deepEqual(first.storageCalls, [["get", "jessiemessage.language"]]);
  first.api.setLanguage("fr"); assert.equal(shared.get("jessiemessage.language"), "fr"); assert.equal(shared.get("other-private-key"), "untouched");
  const next = harness({ preferred: "en-US", storageMap: shared }).load(); assert.equal(next.api.getLanguage(), "fr");
  assert.equal(next.api.setLanguage("ko"), false); assert.equal(next.api.getLanguage(), "fr"); assert.ok([...first.storageCalls, ...next.storageCalls].every((call) => call[1] === "jessiemessage.language"));
  assert.equal(harness({ stored: "invalid", preferred: "fr-CA" }).load().api.getLanguage(), "fr");
  const blocked = harness({ preferred: "en-US", blocked: true }).load(); assert.equal(blocked.api.getLanguage(), "en"); assert.equal(blocked.api.setLanguage("fr"), true); assert.equal(blocked.api.getLanguage(), "fr");
});

test("registration is atomic, accepts identical catalog entries and rejects accessors or conflicting translations", () => {
  const f = harness().load(); f.run('JessieI18n.register({"Bonjour":"Hello","Compte {name}":"Account {name}"})');
  f.run('JessieI18n.register({"Bonjour":"Hello"})');
  assert.throws(() => f.run('JessieI18n.register({"Nouveau":"New","Bonjour":"Different"})'), /invalid_interface_translation/);
  assert.throws(() => f.run('JessieI18n.register({"Compte {name}":"Account {other}"})'), /invalid_interface_translation/);
  f.run('globalThis.getterCalls=0; globalThis.bad={}; Object.defineProperty(bad,"Secret",{enumerable:true,get(){getterCalls++;return "private"}})');
  assert.throws(() => f.run("JessieI18n.register(bad)"), /invalid_interface_translation/); assert.equal(f.context.getterCalls, 0);
  f.api.setLanguage("en"); assert.equal(f.api.t("Bonjour"), "Hello"); assert.equal(f.api.t("Nouveau"), "Nouveau");
});

test("only explicit leaf UI is translated; a UI-like username, message or input value remains untouched", () => {
  const f = harness(), label = f.node("Envoyer"), message = f.node(), input = f.node(null, f.body, "input"), card = f.node("Envoyer");
  message.textContent = "Envoyer"; input.value = "Envoyer"; const child = f.node(null, card); child.textContent = "private child";
  f.load(); f.run('JessieI18n.register({"Envoyer":"Send"})'); f.api.setLanguage("en");
  assert.equal(label.textContent, "Send"); assert.equal(message.textContent, "Envoyer"); assert.equal(input.value, "Envoyer"); assert.equal(card.textContent, "Envoyerprivate child");
  const collision = f.node("Envoyer"); f.api.apply(); f.api.rawText(collision, "Envoyer"); f.api.setLanguage("fr"); f.api.setLanguage("en");
  assert.equal(collision.textContent, "Envoyer"); assert.equal(collision.getAttribute("data-jm-i18n"), null); assert.equal(collision.getAttribute("data-jm-i18n-bound"), null);
});

test("unchanged bindings update in place while cleared or externally replaced values lose their binding", () => {
  const f = harness().load(), label = f.node(); f.run('JessieI18n.register({"Envoyer":"Send"})');
  f.api.text(label, "Envoyer"); const writes = label.writes; f.api.text(label, "Envoyer"); assert.equal(label.writes, writes, "identical rebinding preserves the existing text node");
  f.api.setLanguage("en"); assert.equal(label.textContent, "Send"); label.textContent = ""; f.api.setLanguage("fr"); assert.equal(label.textContent, "");
  f.api.text(label, "Envoyer"); label.textContent = "private"; f.api.setLanguage("en"); assert.equal(label.textContent, "private");
});

test("explicit static HTML labels tolerate layout whitespace but an emptied label is never restored", () => {
  const f = harness(), label = f.node(); label.textContent = "\n    Votre accès\n      privé.\n  "; label.setAttribute("data-jm-i18n", "Votre accès privé.");
  f.load(); f.run('JessieI18n.register({"Votre accès privé.":"Your private access."})'); f.api.setLanguage("en"); assert.equal(label.textContent, "Your private access.");
  label.textContent = ""; f.api.setLanguage("fr"); f.api.setLanguage("en"); assert.equal(label.textContent, ""); assert.equal(label.getAttribute("data-jm-i18n"), null);
});

test("date, number and nested UI descriptors reformat live while literal private parameters are never translated", () => {
  const f = harness().load(), label = f.node(); f.expose("target", label);
  f.run('JessieI18n.register({"Nom {name} · {date} · {count} · {state}":"Name {name} · {date} · {count} · {state}","Envoyer":"Send","En attente":"Pending"}); globalThis.instant=1750000000000; JessieI18n.text(target,"Nom {name} · {date} · {count} · {state}",{name:"Envoyer",date:JessieI18n.dateParam(instant),count:JessieI18n.numberParam(1234.5),state:JessieI18n.messageParam("En attente")})');
  assert.equal(label.textContent, `Nom Envoyer · ${new Date(1750000000000).toLocaleString("fr-FR", {})} · ${(1234.5).toLocaleString("fr-FR")} · En attente`);
  f.api.setLanguage("en"); assert.equal(label.textContent, `Name Envoyer · ${new Date(1750000000000).toLocaleString("en-US", {})} · ${(1234.5).toLocaleString("en-US")} · Pending`);
  assert.equal(f.run('Object.keys(JessieI18n.dateParam(instant)).length'), 0);
  assert.equal(f.run('Object.keys(JessieI18n.messageParam("En attente")).length'), 0);
});

test("parameters and Intl options reject getters, arbitrary objects and unbounded nested UI descriptors", () => {
  const f = harness().load(); f.run('globalThis.getterCalls=0;globalThis.bad={};Object.defineProperty(bad,"name",{enumerable:true,get(){getterCalls++;return "private"}})');
  assert.throws(() => f.run('JessieI18n.t("Bonjour {name}",bad)'), /invalid_interface_translation/); assert.equal(f.context.getterCalls, 0);
  for (const code of ['JessieI18n.t("{name}",{name:{private:"value"}})', 'JessieI18n.dateParam(null)', 'JessieI18n.dateParam(-1)', 'JessieI18n.dateParam(253402300800000)', 'JessieI18n.numberParam(NaN)', 'JessieI18n.numberParam(Infinity)', 'JessieI18n.dateParam(0,{private:"value"})']) assert.throws(() => f.run(code), /invalid_interface_translation/);
  assert.throws(() => f.run('let nested=JessieI18n.messageParam("UI");for(let i=0;i<20;i++)nested=JessieI18n.messageParam("UI {label}",{label:nested})'), /invalid_interface_translation/);
});

test("attribute translation is confined to UI hints and cannot modify href, src or form values", () => {
  const f = harness().load(), input = f.node(null, f.body, "input"); f.expose("target", input);
  f.run('JessieI18n.register({"Votre message":"Your message","Supprimer {name}":"Delete {name}"}); JessieI18n.attr(target,"placeholder","Votre message");JessieI18n.attr(target,"aria-label","Supprimer {name}",{name:"Envoyer"})');
  input.value = "private draft"; f.api.setLanguage("en"); assert.equal(input.getAttribute("placeholder"), "Your message"); assert.equal(input.getAttribute("aria-label"), "Delete Envoyer"); assert.equal(input.value, "private draft");
  for (const name of ["href", "src", "value", "onerror", "alt"]) assert.throws(() => f.api.attr(input, name, "Votre message"), /invalid_interface_translation/);
});

test("constant marked labels can initialize hidden forms without translating hidden private parameters", () => {
  const f = harness(), form = f.node(), label = f.node("Envoyer", form), privateNode = f.node(null, form); form.hidden = true; f.load();
  f.run('JessieI18n.register({"Envoyer":"Send","Compte {name}":"Account {name}"})'); f.api.setLanguage("en"); assert.equal(label.textContent, "Send");
  f.expose("target", privateNode); f.run('JessieI18n.text(target,"Compte {name}",{name:"secret"})'); assert.equal(privateNode.textContent, "Account secret", "explicit initialization is allowed before showing a freshly built UI");
  f.api.setLanguage("fr"); assert.equal(privateNode.textContent, "Account secret"); form.hidden = false; f.api.setLanguage("en"); f.api.setLanguage("fr"); assert.equal(privateNode.textContent, "Account secret", "a hidden private binding is discarded rather than restored");
});

test("visibility and pagehide purge parameterized records even when a node was detached", () => {
  for (const pagehide of [false, true]) {
    const f = harness().load(), label = f.node(); f.expose("target", label); f.run('JessieI18n.register({"Compte {name}":"Account {name}"});JessieI18n.text(target,"Compte {name}",{name:"secret"})');
    label.remove(); if (pagehide) f.event("pagehide"); else f.hide(); label.textContent = ""; f.body.append(label); f.show(); f.api.setLanguage("en");
    assert.equal(label.textContent, ""); assert.equal(label.getAttribute("data-jm-i18n-bound"), null);
  }
});

test("forget recursively clears bindings and rawText handles a username equal to a UI source", () => {
  const f = harness().load(), panel = f.node(), label = f.node("Envoyer", panel), other = f.node(null, panel); f.expose("target", other);
  f.run('JessieI18n.register({"Envoyer":"Send","Compte {name}":"Account {name}"});JessieI18n.text(target,"Compte {name}",{name:"secret"})');
  f.api.forget(panel); f.api.rawText(label, "Envoyer"); other.textContent = ""; f.api.setLanguage("en");
  assert.equal(label.textContent, "Envoyer"); assert.equal(other.textContent, ""); assert.equal(f.document.querySelectorAll("[data-jm-i18n-bound]").length, 0);
});

test("the delegated language button toggles once and notifications never perform network work", () => {
  const f = harness(), button = f.node(null, f.body, "button"); button.setAttribute("data-jm-language", ""); f.load();
  f.run('globalThis.changes=[];globalThis.unsub=JessieI18n.onChange(value=>changes.push(value))');
  f.click(button); assert.equal(f.api.getLanguage(), "en"); assert.equal(button.textContent, "FR"); assert.deepEqual(Array.from(f.context.changes), ["en"]);
  f.run("unsub()"); f.click(button); assert.equal(f.api.getLanguage(), "fr"); assert.deepEqual(Array.from(f.context.changes), ["en"]); assert.equal(f.requests.length, 0);
});

test("homepage and entry share the language choice without double toggles or new access checks", async () => {
  const shared = new Map(), home = harness({ storageMap: shared }), switcher = home.node(null, home.body, "button"); switcher.setAttribute("id", "language-switch"); switcher.setAttribute("data-jm-language", "");
  home.load(); home.run(homepage); home.click(switcher); assert.equal(home.api.getLanguage(), "en"); assert.equal(home.document.documentElement.lang, "en"); assert.equal(shared.get("jessiemessage.language"), "en");
  const entry = harness({ storageMap: shared });
  for (const match of entryHTML.matchAll(/\bid="([^"]+)"/g)) { const node = entry.node(); node.setAttribute("id", match[1]); if (match[1] === "language-switch") node.setAttribute("data-jm-language", ""); }
  entry.load(); const modelExports = [...entryModel.matchAll(/export function (\w+)\(/g)].map((match) => match[1]);
  entry.run(`globalThis.__entry = (()=>{${entryModel.replaceAll("export function ", "function ")}\nreturn {${modelExports.join(",")}}})()`);
  entry.run(entryController.replace(/^import \{([^\n]+)\} from "\/entry-model\.js";/, "const {$1}=__entry;")); await flush();
  assert.equal(entry.document.getElementById("client-link").textContent, "Return to my conversation"); assert.equal(entry.requests.length, 1); assert.deepEqual(entry.navigation, ["/messages"]);
  entry.click(entry.document.getElementById("language-switch")); assert.equal(entry.api.getLanguage(), "fr"); assert.equal(entry.document.getElementById("client-link").textContent, "Reprendre ma conversation"); assert.equal(entry.requests.length, 1);
});

test("shared runtime has no network, arbitrary text scan, observers or storage other than its language key", () => {
  assert.doesNotMatch(runtime, /\b(?:fetch|XMLHttpRequest|MutationObserver|TreeWalker|localStorage|indexedDB|innerHTML|eval)\b/);
  assert.match(runtime, /new WeakMap\(\)/); assert.match(runtime, /jessiemessage\.language/);
  assert.doesNotMatch(runtime, /sessionStorage\?\.(?:key|clear|removeItem)|document\.cookie|location\./);
});
