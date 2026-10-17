import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const runtime = await readFile(new URL("../public/i18n.js", import.meta.url), "utf8");
const helper = await readFile(new URL("../public/help-link.js", import.meta.url), "utf8");
const french = "Aide et confidentialité", frenchAria = `${french} (nouvel onglet)`;

function page({ stored = "fr", preferred = "fr-FR", storageBlocked = false, shared = true } = {}) {
  const storageCalls = [], events = new Map();
  const link = {
    tagName: "A", textContent: french, isConnected: true, children: [],
    attributes: new Map([["href", "/help"], ["target", "_blank"], ["rel", "noopener noreferrer"], ["data-help-link", ""],
      ["data-jm-i18n", french], ["aria-label", frenchAria], ["data-jm-i18n-aria-label", frenchAria]]),
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
    querySelectorAll() { return []; },
  };
  const document = {
    documentElement: { lang: "fr" },
    querySelectorAll(selector) {
      return selector.split(",").some((part) => {
        const match = /^(a)?\[([^\]]+)\]$/.exec(part);
        return match && link.getAttribute(match[2]) !== null;
      }) ? [link] : [];
    },
    addEventListener(name, callback) { events.set(name, callback); },
  };
  const context = vm.createContext({ document, navigator: { language: preferred }, window: { addEventListener() {} },
    sessionStorage: {
      getItem(key) { storageCalls.push(["get", key]); if (storageBlocked) throw new Error("Synthetic storage denied"); return stored; },
      setItem(key, value) { storageCalls.push(["set", key, value]); if (storageBlocked) throw new Error("Synthetic storage denied"); },
    },
  });
  // The helper must never inspect private navigation, contact servers, or write a
  // draft/token. A real shared translation runtime is the only storage reader.
  for (const name of ["location", "history", "localStorage", "fetch"]) {
    Object.defineProperty(context, name, { get() { throw new Error(`Unexpected private boundary: ${name}`); } });
  }
  Object.defineProperty(document, "cookie", { get() { throw new Error("Unexpected cookie read"); } });
  if (shared) vm.runInContext(runtime, context);
  vm.runInContext(helper, context);
  return { link, storageCalls, api: context.JessieI18n };
}

test("help carries only the shared language and translates the new-tab hint on first render and changes", () => {
  const p = page({ stored: "en" });
  assert.equal(p.link.getAttribute("href"), "/help#lang=en");
  assert.equal(p.link.textContent, "Help and privacy");
  assert.equal(p.link.getAttribute("aria-label"), "Help and privacy (new tab)");
  assert.equal(p.link.getAttribute("target"), "_blank");
  assert.equal(p.link.getAttribute("rel"), "noopener noreferrer");
  assert.deepEqual(p.storageCalls, [["get", "jessiemessage.language"]], "initialization does not write a preference");
  p.api.setLanguage("fr");
  assert.equal(p.link.getAttribute("href"), "/help#lang=fr");
  assert.equal(p.link.textContent, french);
  assert.equal(p.link.getAttribute("aria-label"), frenchAria);
  p.api.setLanguage("en");
  assert.equal(p.link.getAttribute("href"), "/help#lang=en");
  assert.equal(p.link.textContent, "Help and privacy");
  assert.ok(p.storageCalls.every((call) => call[1] === "jessiemessage.language"));
});

test("blocked preference storage keeps help usable in the current language without a second store", () => {
  const p = page({ preferred: "en-US", storageBlocked: true });
  assert.equal(p.link.getAttribute("href"), "/help#lang=en");
  assert.equal(p.link.textContent, "Help and privacy");
  p.api.setLanguage("fr");
  assert.equal(p.link.getAttribute("href"), "/help#lang=fr");
  assert.equal(p.link.getAttribute("aria-label"), frenchAria);
});

test("an unavailable translation runtime preserves the static help link and French labels", () => {
  const p = page({ shared: false });
  assert.equal(p.link.getAttribute("href"), "/help");
  assert.equal(p.link.textContent, french);
  assert.equal(p.link.getAttribute("aria-label"), frenchAria);
  assert.deepEqual(p.storageCalls, []);
});

test("all existing entry, account and chat pages expose safe help without requiring JavaScript or leaving the page", async () => {
  for (const name of ["index", "entry", "access", "admin-login", "chat", "recover", "readiness", "broadcast", "device-transition"]) {
    const html = await readFile(new URL(`../public/${name}.html`, import.meta.url), "utf8");
    const links = [...html.matchAll(/<a\b[^>]*\bdata-help-link\b[^>]*>([^<]*)<\/a>/gu)];
    assert.equal(links.length, 1, name);
    const [link, label] = links[0];
    assert.equal(label, french, name);
    for (const attr of ['href="/help"', 'target="_blank"', 'rel="noopener noreferrer"', `aria-label="${frenchAria}"`, `data-jm-i18n="${french}"`]) assert.ok(link.includes(attr), `${name}: ${attr}`);
    assert.ok(html.includes('href="mailto:contact@jessiemessage.com"'), `${name}: existing contact remains available`);
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gu)];
    const runtimeIndex = scripts.findIndex((item) => item[1] === "/i18n.js");
    const helpers = scripts.filter((item) => item[1] === "/help-link.js");
    assert.equal(helpers.length, 1, name);
    assert.ok(scripts.indexOf(helpers[0]) > runtimeIndex && runtimeIndex !== -1, `${name}: shared runtime precedes helper`);
    assert.match(helpers[0][0], /\bdefer\b/u);
    assert.ok(!link.includes("onclick") && !link.includes("returnTo") && !link.includes("token="), name);
  }
});
