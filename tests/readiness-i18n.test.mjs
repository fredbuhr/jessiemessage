import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (name) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
const [html, runtime, catalogue, model, controller] = await Promise.all([read("readiness.html"), read("i18n.js"), read("i18n-readiness.js"), read("readiness-model.js"), read("readiness.js")]);
const now = 1750000000000;
const flush = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const dictionaries = {};
vm.runInNewContext(catalogue, { JessieI18n: { register(value) { Object.assign(dictionaries, value); } } });

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attributes = new Map(); this.dataset = {};
    this.events = new Map(); this.value = ""; this.hidden = false; this.disabled = false; this._text = "";
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
  matches(selector) { return selector.startsWith("[") ? this.hasAttribute(selector.slice(1, -1)) : this.tagName.toLowerCase() === selector.toLowerCase(); }
  querySelectorAll(selector) { return this.children.flatMap((node) => [selector.split(",").some((part) => node.matches(part.trim())) ? node : null, ...node.querySelectorAll(selector)]).filter(Boolean); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
}
function parse() {
  const container = new Element("root"); container.root = true;
  const stack = [container], nodes = new Map(); const voids = new Set(["meta", "link", "input", "img", "br"]);
  for (const match of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const token = match[0]; if (/^<!/.test(token)) continue;
    if (token.startsWith("</")) { stack.pop(); continue; }
    if (token.startsWith("<")) {
      const tag = /^<([a-z0-9-]+)/i.exec(token)?.[1]; if (!tag) continue;
      const node = new Element(tag);
      for (const attribute of token.matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)(?:="([^"]*)")?/g)) {
        const name = attribute[1]; if (name !== tag) node.setAttribute(name, attribute[2] ?? "");
      }
      const identifier = node.getAttribute("id"); if (identifier) nodes.set(identifier, node);
      stack.at(-1).append(node); if (!voids.has(tag)) stack.push(node);
    } else stack.at(-1)._text += token;
  }
  return { container, nodes };
}
const count = (value, truncated = false) => ({ count: value, truncated });
const operations = () => ({ status: "unavailable", database: { state: "stale", checkedAt: now - 90000 }, queuesCheckedAt: now,
  workers: [
    { name: "verification", state: "error", lastCompletedAt: now - 60000, lastErrorAt: now - 30000, consecutiveFailures: 2, processed: 1234567, failures: 1234 },
    { name: "recovery", state: "starting", lastCompletedAt: null, lastErrorAt: null, consecutiveFailures: 0, processed: 0, failures: 0 },
    { name: "broadcasts", state: "idle", lastCompletedAt: now - 1000, lastErrorAt: null, consecutiveFailures: 0, processed: 3650, failures: 0 },
  ],
  queues: [
    { name: "verification", pending: count(1000, true), sending: count(12), failed: count(3), oldestDueAt: now - 1234 * 60000 },
    { name: "recovery", pending: count(0), sending: count(0), failed: count(0), oldestDueAt: null },
    { name: "broadcasts", pending: count(2), sending: count(0), failed: count(0), oldestDueAt: now + 60000 },
  ] });
const summary = () => ({ contactEmail: "contact@jessiemessage.com", mail: { configured: true, sender: "private-sender@example.invalid", replyTo: "private-sender@example.invalid" },
  features: { clientAccess: true, chat: true, photos: false, clientFiles: true, passwordRecovery: false, broadcasts: true },
  checks: { ageAssurance: "pending", smtpDelivery: "not_checked", deviceAcceptance: "pending" }, operations: operations() });
async function harness({ input = summary(), language = "fr", smtp = () => response({ status: "verified", scope: "smtp_authentication", delivery: "not_checked", checkedAt: now + 5000 }) } = {}) {
  const { container, nodes } = parse(), documentEvents = new Map(), windowEvents = new Map(), calls = [], storage = new Map([["jessiemessage.language", language]]), writes = [], timers = new Map(), redirects = [];
  const add = (map, name, callback) => { if (!map.has(name)) map.set(name, []); map.get(name).push(callback); };
  const document = { visibilityState: "visible", readyState: "complete", documentElement: container.querySelectorAll("html")[0], body: container.querySelectorAll("body")[0],
    getElementById: (id) => nodes.get(id), querySelectorAll: (selector) => container.querySelectorAll(selector),
    createElement: (tag) => new Element(tag), addEventListener: (name, callback) => add(documentEvents, name, callback) };
  const session = { user: { id: "1".repeat(32), role: "admin", pseudonym: "Vérification en cours…" }, csrf: "A".repeat(43), expiresAt: now + 28800000 };
  let timerId = 0;
  const context = vm.createContext({ document, window: { addEventListener: (name, callback) => add(windowEvents, name, callback) },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { writes.push([key, value]); storage.set(key, value); } },
    navigator: { language: "fr-FR", languages: ["fr-FR"] }, location: { pathname: "/admin/readiness", replace: (value) => redirects.push(value) }, AbortController, Intl,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, duration) => { const key = ++timerId; timers.set(key, { callback, duration }); return key; }, clearTimeout: (key) => timers.delete(key),
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === "/api/auth/session") return response(session);
      if (path === "/api/admin/readiness") return response(input);
      if (path === "/api/admin/readiness/smtp") return smtp(path, options);
      throw new Error("Unexpected synthetic request");
    } });
  vm.runInContext(runtime, context, { filename: "public/i18n.js" });
  vm.runInContext(catalogue, context, { filename: "public/i18n-readiness.js" });
  // An account value that happens to match a catalog key must still remain raw.
  vm.runInContext('JessieI18n.register({"private-sender@example.invalid":"THIS ACCOUNT VALUE MUST STAY RAW"})', context);
  vm.runInContext(model.replace(/^export\s+/gm, ""), context, { filename: "public/readiness-model.js" });
  vm.runInContext(controller.replace(/^import\s*\{[\s\S]*?\}\s*from\s*"\/readiness-model\.js";\s*/, ""), context, { filename: "public/readiness.js" });
  await flush();
  return { context, nodes, calls, storage, writes, document, container, redirects,
    language(value) { context.JessieI18n.setLanguage(value); },
    async click(id) { for (const callback of nodes.get(id).events.get("click") ?? []) callback({}); await flush(); },
    async hide() { document.visibilityState = "hidden"; for (const callback of documentEvents.get("visibilitychange") ?? []) callback({}); await flush(); },
    async pagehide() { for (const callback of windowEvents.get("pagehide") ?? []) callback({}); await flush(); },
  };
}
const formatNumber = (value, language) => value.toLocaleString(language === "en" ? "en-US" : "fr-FR");
const formatDate = (value, language) => new Date(value).toLocaleString(language === "en" ? "en-US" : "fr-FR");
const smtpCalls = (f) => f.calls.filter((call) => call.path === "/api/admin/readiness/smtp");

test("readiness static sources cover the whole page and preserve the scope of its checks in English", () => {
  const sources = [...html.matchAll(/data-jm-i18n(?:-aria-label|-title|-placeholder)?="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(sources.length > 30); for (const source of sources) assert.equal(typeof dictionaries[source], "string", source);
  assert.match(dictionaries["Cette vérification contrôle la connexion chiffrée et l’authentification. Elle n’envoie aucun e-mail et ne confirme pas la réception des invitations ou des liens de récupération."], /sends no email and does not confirm receipt/);
  assert.match(dictionaries["Instantané global de ce processus serveur. Les compteurs de traitement repartent à zéro à son redémarrage. Ces mesures ne certifient pas la mise en production ni la réception des messages."], /do not certify production readiness or message receipt/);
  assert.ok(html.indexOf('src="/i18n.js"') < html.indexOf('src="/i18n-readiness.js"'));
  assert.ok(html.indexOf('src="/i18n-readiness.js"') < html.indexOf('src="/readiness.js"'));
  assert.match(html, /button[^>]+data-jm-language/); assert.match(html, /href="\/i18n.css"/);
  assert.match(html, /href="mailto:contact@jessiemessage\.com"/); assert.doesNotMatch(html, /data-jm-i18n-(?:value|href)/);
});

test("readiness operations translate typed worker and queue dates/counts in place while the sender stays raw", async () => {
  const f = await harness(), workers = f.nodes.get("operations-workers"), queues = f.nodes.get("operations-queues");
  const worker = workers.children[0], queue = queues.children[0], countNode = worker.querySelectorAll("dd")[0]; const calls = f.calls.length;
  assert.equal(f.nodes.get("operations-status").textContent, "Signal de service : indisponible.");
  assert.equal(countNode.textContent, formatNumber(1234567, "fr")); assert.ok(queue.textContent.includes(`au moins ${formatNumber(1000, "fr")}`));
  f.language("en");
  assert.equal(f.document.documentElement.lang, "en"); assert.equal(f.nodes.get("mail-title").textContent, "Site emails");
  assert.equal(f.nodes.get("mail-sender").textContent, "private-sender@example.invalid"); assert.equal(f.nodes.get("operations-status").textContent, "Service signal: unavailable.");
  assert.equal(f.nodes.get("feature-list").children[0].textContent, "Invitation-only accessEnabled");
  assert.equal(f.nodes.get("feature-list").children[2].textContent, "Private photosDisabled");
  assert.ok(f.nodes.get("operations-database").textContent.includes("DatabaseStale measurement"));
  assert.ok(f.nodes.get("operations-database").textContent.includes(formatDate(now - 90000, "en")));
  assert.ok(worker.textContent.includes("Email verificationError")); assert.equal(countNode.textContent, "1,234,567");
  assert.ok(worker.textContent.includes(`Last completed cycle: ${formatDate(now - 60000, "en")}. Last error: ${formatDate(now - 30000, "en")}.`));
  assert.ok(workers.children[1].textContent.includes("Last completed cycle: no measurement available. Last error: no measurement available."));
  assert.ok(queue.textContent.includes("at least 1,000")); assert.ok(queue.textContent.includes("Scheduled delay at measurement: 1,234 min."));
  assert.ok(queues.children[1].textContent.includes("Oldest pending due time: unavailable."));
  assert.ok(queues.children[2].textContent.includes("Scheduled after the measurement."));
  assert.ok(f.nodes.get("operations-sample").textContent.includes(`Queue measurement: ${formatDate(now, "en")}.`));
  assert.equal(workers.children[0], worker); assert.equal(queues.children[0], queue);
  f.language("fr"); assert.equal(countNode.textContent, formatNumber(1234567, "fr"));
  assert.ok(worker.textContent.includes(`Dernier cycle terminé : ${formatDate(now - 60000, "fr")}`));
  assert.ok(queue.textContent.includes(`Retard planifié à la mesure : ${formatNumber(1234, "fr")} min.`));
  assert.equal(f.nodes.get("mail-sender").textContent, "private-sender@example.invalid"); assert.equal(f.calls.length, calls); assert.equal(smtpCalls(f).length, 0);
  assert.ok(f.writes.every(([key, value]) => key === "jessiemessage.language" && ["fr", "en"].includes(value)));
});

test("readiness empty measurements translate nested null dates and empty workers/queues without inventing a healthy signal", async () => {
  const input = summary(); input.operations = { status: "unavailable", database: { state: "starting", checkedAt: null }, workers: [], queues: [], queuesCheckedAt: null };
  const f = await harness({ input, language: "en" }), calls = f.calls.length;
  assert.equal(f.nodes.get("operations-status").textContent, "Service signal: unavailable.");
  assert.ok(f.nodes.get("operations-database").textContent.includes("Last database checkno measurement available"));
  assert.equal(f.nodes.get("operations-workers").textContent, "No workers tracked in this measurement.");
  assert.equal(f.nodes.get("operations-queues").textContent, "No queues tracked in this measurement.");
  assert.ok(f.nodes.get("operations-sample").textContent.startsWith("Queue measurement: no measurement available."));
  f.language("fr"); assert.ok(f.nodes.get("operations-sample").textContent.startsWith("Mesure des files : aucune mesure disponible."));
  assert.equal(f.nodes.get("operations-workers").textContent, "Aucun traitement suivi dans cette mesure."); assert.equal(f.calls.length, calls);
});

test("readiness without operations translates its unavailable measurement without requesting another snapshot", async () => {
  const input = summary(); delete input.operations; const f = await harness({ input }), calls = f.calls.length;
  assert.equal(f.nodes.get("operations-details").hidden, true); f.language("en"); assert.equal(f.nodes.get("operations-status").textContent, "No measurement available.");
  f.language("fr"); assert.equal(f.nodes.get("operations-status").textContent, "Mesure non disponible."); assert.equal(f.calls.length, calls);
});

test("language switches during and after one explicit SMTP check preserve its pending state and never repeat SMTP", async () => {
  const pending = deferred(), f = await harness({ smtp: () => pending.promise });
  await f.click("verify-smtp"); assert.equal(smtpCalls(f).length, 1); const calls = f.calls.length;
  assert.equal(f.nodes.get("verify-smtp").disabled, true); assert.equal(f.nodes.get("verify-smtp").textContent, "Vérification en cours…");
  f.language("en"); assert.equal(f.nodes.get("verify-smtp").textContent, "Checking…");
  assert.equal(f.nodes.get("smtp-status").textContent, "Checking the secure connection… No email is being sent.");
  await f.click("verify-smtp"); assert.equal(f.calls.length, calls); assert.equal(smtpCalls(f).length, 1);
  pending.resolve(response({ status: "verified", scope: "smtp_authentication", delivery: "not_checked", checkedAt: now + 5000 })); await flush();
  assert.equal(smtpCalls(f).length, 1); assert.equal(f.nodes.get("verify-smtp").disabled, false);
  assert.equal(f.nodes.get("smtp-status").textContent, "Encrypted connection and authentication succeeded. Email receipt still needs testing.");
  assert.equal(f.nodes.get("smtp-proof-date").textContent, `Verification for this session: ${formatDate(now + 5000, "en")}.`);
  const finalCalls = f.calls.length; f.language("fr");
  assert.equal(f.nodes.get("smtp-proof-date").textContent, `Vérification de cette session : ${formatDate(now + 5000, "fr")}.`);
  assert.equal(f.nodes.get("smtp-status").textContent, "Connexion chiffrée et authentification réussies. La réception d’un e-mail reste à tester.");
  assert.equal(f.calls.length, finalCalls); assert.equal(smtpCalls(f).length, 1);
  assert.equal(smtpCalls(f)[0].options.body, "{}"); assert.equal(smtpCalls(f)[0].options.headers["X-CSRF-Token"], "A".repeat(43));
});

for (const lifecycle of ["hide", "pagehide"]) test(`readiness ${lifecycle} clears private measurements and language changes cannot restore them`, async () => {
  const f = await harness({ language: "en" }); await f.click("verify-smtp");
  const detachedWorker = f.nodes.get("operations-workers").children[0]; assert.equal(f.nodes.get("smtp-proof-date").hidden, false);
  await f[lifecycle](); const calls = f.calls.length; f.language("fr"); f.language("en");
  assert.equal(f.nodes.get("readiness-content").hidden, true); assert.equal(f.nodes.get("mail-sender").textContent, "");
  for (const id of ["feature-list", "operations-database", "operations-workers", "operations-queues"]) assert.equal(f.nodes.get(id).children.length, 0, id);
  for (const id of ["mail-status", "operations-sample", "smtp-status", "smtp-proof-date", "session-status"]) assert.equal(f.nodes.get(id).textContent, "", id);
  assert.equal(f.nodes.get("smtp-proof-date").hidden, true); assert.equal(f.nodes.get("operations-details").hidden, true);
  assert.equal(detachedWorker.isConnected, false); assert.ok(!f.container.textContent.includes("private-sender@example.invalid"));
  assert.equal(f.calls.length, calls); assert.equal(smtpCalls(f).length, 1);
});

test("an SMTP result arriving after hide cannot restore proof or measurements across language changes", async () => {
  const pending = deferred(), f = await harness({ smtp: () => pending.promise, language: "en" });
  await f.click("verify-smtp"); const smtp = smtpCalls(f)[0]; await f.hide(); assert.equal(smtp.options.signal.aborted, true);
  const calls = f.calls.length; f.language("fr"); pending.resolve(response({ status: "verified", scope: "smtp_authentication", delivery: "not_checked", checkedAt: now + 5000 })); await flush(); f.language("en");
  assert.equal(f.nodes.get("readiness-content").hidden, true); assert.equal(f.nodes.get("smtp-proof-date").textContent, ""); assert.equal(f.nodes.get("smtp-proof-date").hidden, true);
  assert.equal(f.nodes.get("mail-sender").textContent, ""); assert.equal(f.nodes.get("operations-workers").children.length, 0); assert.equal(f.nodes.get("smtp-status").textContent, "");
  assert.equal(f.calls.length, calls); assert.equal(smtpCalls(f).length, 1);
});
