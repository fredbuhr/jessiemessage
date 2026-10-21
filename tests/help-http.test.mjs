import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import vm from "node:vm";
import { createAppServer } from "../server/index.mjs";
import { createEntryHandler } from "../server/entry/http.mjs";

const primary = "https://jessiemessage.com", recipe = "https://recette.jessiemessage.com";
const assets = [["/help", "help.html", "text/html; charset=utf-8"],
  ["/help.css", "help.css", "text/css; charset=utf-8"],
  ["/help.js", "help.js", "text/javascript; charset=utf-8"],
  ["/help-link.js", "help-link.js", "text/javascript; charset=utf-8"]];

async function listening(t, options = {}) {
  const server = createAppServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return server.address().port;
}

function wire(port, path, { method = "GET", host = "127.0.0.1", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers: { host, ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.on("error", reject); request.end();
  });
}

function privateSafeHeaders(response, type) {
  assert.equal(response.headers["content-type"], type);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["cross-origin-resource-policy"], "same-origin");
  assert.match(response.headers["content-security-policy"], /default-src 'self'; script-src 'self'/);
  assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(response.headers["set-cookie"], undefined);
}

test("public help delivers exact GET/HEAD assets without enabling a private feature or setting a cookie", async (t) => {
  let sessions = 0, admissions = 0;
  const port = await listening(t, {
    entryHandler: createEntryHandler({ clientSession() { sessions++; throw new Error("private fixture"); },
      adminSession() { sessions++; throw new Error("private fixture"); } }),
    admission: { enter() { admissions++; throw new Error("private fixture"); } },
  });
  const token = Buffer.alloc(32, 7).toString("base64url");
  for (const [route, file, type] of assets) {
    const response = await wire(port, route, { headers: { cookie: `__Host-jessie_client=${token}; __Host-jessie_session=${token}` } });
    assert.equal(response.status, 200, route); privateSafeHeaders(response, type);
    assert.deepEqual(response.body, await readFile(new URL(`../public/${file}`, import.meta.url)), route);
    const head = await wire(port, route, { method: "HEAD" });
    assert.equal(head.status, 200, route); privateSafeHeaders(head, type); assert.equal(head.body.length, 0);
  }
  assert.equal(sessions, 0); assert.equal(admissions, 0);
  for (const path of ["/access", "/admin/login", "/messages", "/admin/messages", "/recover", "/api/access/recovery/capabilities"]) {
    assert.equal((await wire(port, path)).status, 404, path);
  }
});

test("help remains read only and cannot expose adjacent files through unknown or traversing paths", async (t) => {
  const port = await listening(t);
  for (const [route] of assets) {
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const response = await wire(port, route, { method });
      assert.equal(response.status, 405, `${method} ${route}`);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers["set-cookie"], undefined);
    }
  }
  for (const path of ["/help.html", "/help/", "/help/private", "/help.js.map", "/help/../server/index.mjs",
    "/help/%2e%2e/server/index.mjs", "/help/%2e%2e%2fserver%2findex.mjs", "/%2e%2e/server/index.mjs",
    "/help/../../.env", "/server/index.mjs", "/.env"]) {
    const response = await wire(port, path);
    assert.equal(response.status, 404, path); assert.equal(response.body.toString(), "Not found", path);
  }
});

test("the existing authority guard serves help on both enabled origins and rejects forwarded or foreign authorities", async (t) => {
  let admitted = 0;
  const port = await listening(t, { requestOrigin: primary,
    legacyHandlers: { entryHandler: createEntryHandler() },
    admission: { enter() { admitted++; throw new Error("help must not allocate private work"); } },
  });
  for (const origin of [primary, recipe]) {
    for (const [route, , type] of assets) {
      for (const method of ["GET", "HEAD"]) {
        const response = await wire(port, route, { method, host: new URL(origin).host });
        assert.equal(response.status, 200, `${origin}${route}`); privateSafeHeaders(response, type);
        if (method === "HEAD") assert.equal(response.body.length, 0);
      }
    }
  }
  for (const host of ["www.jessiemessage.com", "jessiemessage.com.attacker.invalid", "attacker.invalid", "127.0.0.1"]) {
    const response = await wire(port, "/help", { host, headers: { "x-forwarded-host": "jessiemessage.com", "x-forwarded-proto": "https" } });
    assert.equal(response.status, 421, host); assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.equal(admitted, 0);
});

test("help offers fixed destinations, official contact subjects and the shared translation runtime", async () => {
  const html = await readFile(new URL("../public/help.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="/i18n.js"') < html.indexOf('src="/help.js"'));
  assert.match(html, /<html lang="fr">/); assert.match(html, /<h1 data-jm-i18n="Un coup de main \?">/);
  assert.match(html, /href="https:\/\/jessiemessage\.com\/recover"/);
  assert.doesNotMatch(html, /href="\/recover"/);
  assert.doesNotMatch(html, /<form\b|<iframe\b|<script[^>]+src="https?:|\b(?:onclick|onerror)=/i);
  assert.doesNotMatch(html, /(?:[?&]|&amp;)body=|returnTo=|next=/i);
  const destinations = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1]);
  for (const href of destinations) {
    assert.ok(href === "/app" || ["#access", "#notifications", "#privacy", "#contact"].includes(href)
      || href === "https://jessiemessage.com/recover"
      || /^mailto:contact@jessiemessage\.com\?subject=(?:Aide%20JessieMessage|Mes%20donn%C3%A9es%20JessieMessage|Signalement%20JessieMessage)$/.test(href), href);
  }
  assert.equal([...html.matchAll(/<details>/g)].length, 9);
  for (const section of ["access", "notifications", "privacy", "contact", "report"]) assert.match(html, new RegExp(`id="${section}"`));
});

const sharedTranslation = await readFile(new URL("../public/i18n.js", import.meta.url), "utf8");
const helpController = await readFile(new URL("../public/help.js", import.meta.url), "utf8");

function controllerPage({ fragment = "", stored = "fr", storageBlocked = false, shared = true } = {}) {
  const calls = [], metadata = new Map(), sections = ["access", "notifications", "privacy", "contact", "report"];
  const document = { documentElement: { lang: "fr" }, title: "Jessie — Aide et confidentialité",
    querySelectorAll() { return []; }, addEventListener() {},
    getElementById(id) {
      if (id === "help-description") return { setAttribute(name, value) { metadata.set(name, value); } };
      if (sections.includes(id)) return { scrollIntoView() { calls.push(["scroll", id]); } };
      return null;
    },
  };
  Object.defineProperty(document, "cookie", { get() { throw new Error("Help must not read a private cookie"); } });
  const context = vm.createContext({ document, location: { hash: fragment }, navigator: { language: "fr-FR" },
    history: { replaceState(...args) { calls.push(["replace", ...args]); } },
    window: { addEventListener() {} },
    sessionStorage: {
      getItem(key) { calls.push(["get", key]); if (storageBlocked) throw new Error("Synthetic storage blocked"); return stored; },
      setItem(key, value) { calls.push(["set", key, value]); if (storageBlocked) throw new Error("Synthetic storage blocked"); },
    },
  });
  for (const name of ["fetch", "localStorage", "indexedDB"]) Object.defineProperty(context, name, { get() { throw new Error(`Unexpected help boundary: ${name}`); } });
  if (shared) vm.runInContext(sharedTranslation, context);
  calls.length = 0;
  vm.runInContext(helpController, context);
  return { calls, document, metadata, ui: context.JessieI18n };
}

test("the real shared language accepts only the two exact hints after clearing every URL suffix", () => {
  for (const language of ["fr", "en"]) {
    const p = controllerPage({ fragment: `#lang=${language}`, stored: language === "fr" ? "en" : "fr" });
    assert.deepEqual(p.calls[0], ["replace", null, "", "/help"]);
    assert.deepEqual(p.calls[1], ["set", "jessiemessage.language", language]);
    assert.equal(p.ui.getLanguage(), language); assert.equal(p.document.documentElement.lang, language);
    assert.equal(p.document.title, language === "fr" ? "Jessie — Aide et confidentialité" : "Jessie — Help and privacy");
    assert.ok(p.metadata.get("content").length > 0);
    p.ui.setLanguage(language === "fr" ? "en" : "fr");
    assert.equal(p.document.title, language === "fr" ? "Jessie — Help and privacy" : "Jessie — Aide et confidentialité");
  }
});

test("unknown, mixed, encoded, uppercase and newline fragment hints never change a stored preference or navigate", () => {
  for (const fragment of ["", "#lang=EN", "#LANG=en", "#lang=en\n", "#lang=en\r", "#lang=en&next=https://attacker.invalid",
    "#lang=en&lang=fr", "#lang=en#privacy", "#lang=%65n", "#privacy&lang=en", "#privacy\n", "#notification=11111111111111111111111111111111",
    "#token=private-synthetic-fixture", "#next=//attacker.invalid", "#https://attacker.invalid"]) {
    const p = controllerPage({ fragment, stored: "fr" });
    assert.deepEqual(p.calls, [["replace", null, "", "/help"]], fragment);
    assert.equal(p.ui.getLanguage(), "fr", fragment);
    assert.equal(p.document.title, "Jessie — Aide et confidentialité", fragment);
  }
});

test("only known incoming section anchors cause a local scroll after URL clearing without changing a language", () => {
  for (const section of ["access", "notifications", "privacy", "contact", "report"]) {
    const p = controllerPage({ fragment: `#${section}`, stored: "en" });
    assert.deepEqual(p.calls, [["replace", null, "", "/help"], ["scroll", section]]);
    assert.equal(p.ui.getLanguage(), "en");
  }
});

test("every marked help text and accessible label has an English translation in the real shared catalogue", async () => {
  const html = await readFile(new URL("../public/help.html", import.meta.url), "utf8"), p = controllerPage({ stored: "en" });
  const sources = [...new Set([...html.matchAll(/data-jm-i18n(?:-aria-label)?="([^"]+)"/g)].map((match) => match[1]))];
  assert.ok(sources.length > 40);
  for (const french of sources) {
    const english = p.ui.t(french);
    assert.equal(typeof english, "string"); assert.ok(english.length > 0);
    if (french !== "Notifications") assert.notEqual(english, french, french);
  }
});

test("blocked language storage keeps the supplied language usable without any second store", () => {
  const p = controllerPage({ fragment: "#lang=en", storageBlocked: true });
  assert.equal(p.ui.getLanguage(), "en"); assert.equal(p.document.title, "Jessie — Help and privacy");
  assert.deepEqual(p.calls, [["replace", null, "", "/help"], ["set", "jessiemessage.language", "en"]]);
});

test("help still clears the URL and preserves static French content without a translation runtime", () => {
  const p = controllerPage({ fragment: "#lang=en", shared: false });
  assert.deepEqual(p.calls, [["replace", null, "", "/help"]]);
  assert.equal(p.document.title, "Jessie — Aide et confidentialité");
});

test("public help describes the confirmed private-space choices without promising an implemented account erasure", async () => {
  const html = await readFile(new URL("../public/help.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/help.js", import.meta.url), "utf8");
  assert.match(html, /Jessie est responsable de cet espace privé sur invitation/);
  assert.doesNotMatch(html, /Jessie, en France|Jessie et les personnes autorisées à gérer cet espace peuvent lire les échanges/);
  assert.match(html, /Le service chiffre les messages et les photos sur le serveur/);
  assert.match(html, /Il ne s’agit pas d’un chiffrement de bout en bout/);
  assert.match(html, /Je conserve notre conversation jusqu’à la fermeture définitive de ton compte/);
  assert.match(html, /sauf les messages et photos supprimés volontairement/);
  assert.match(html, /Une déconnexion, une expiration ou une suspension de l’accès ne ferme pas définitivement le compte/);
  assert.match(html, /La suppression du compte n’est pas disponible directement dans l’application/);
  assert.match(html, /Ces copies sont traitées séparément/);
  assert.doesNotMatch(html, /Les durées de conservation du compte, des échanges et des sauvegardes ne sont pas encore fixées/);
  assert.match(script, /Jessie is responsible/); assert.match(script, /until your account is permanently closed/);
  assert.doesNotMatch(script, /Jessie, in France|Jessie and the people authorised to manage this space can read the exchanges/);
  assert.match(script, /The service encrypts messages and photos on the server/);
  assert.match(script, /This is not end-to-end encryption/);
  assert.doesNotMatch(html, /exempt.{0,20}RGPD|GDPR.{0,20}exempt|suppression automatique immédiate/i);
});
