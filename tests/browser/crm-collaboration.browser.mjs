// Real CRM module, styles and translation on loopback with synthetic records.
// This fixture tests UI collaboration; real SQL authorization/transactions are
// covered separately by the existing CRM store and HTTP integration groups.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const id = n => n.toString(16).padStart(32, "0");
const conversationId = id(100);
const files = ["crm.js", "crm-model.js", "crm.css", "chat.css", "i18n.js", "i18n-tools.js", "i18n.css", "brand/brand.css"];
const profileSelector = ".crm-profile-form textarea[name=notes]";
const managerSelector = ".crm-filter-actions > button:last-child";
const createSelector = ".crm-create-label button[type=submit]";
const bootstrap = `import { createCrmUI } from "/crm.js";
window.__errors = []; window.__authFailures = []; window.__responses = [];
window.addEventListener("error", event => window.__errors.push(String(event.message)));
window.addEventListener("unhandledrejection", event => window.__errors.push(String(event.reason?.message)));
const crm = createCrmUI({ inboxHead: document.querySelector(".inbox-head"), chatHead: document.querySelector(".chat-head"),
  async request(path, options = {}) {
    const response = await fetch(path, { method: options.mutation ? "POST" : "GET", signal: options.signal,
      headers: options.mutation ? { "Content-Type": "application/json" } : {},
      body: options.mutation ? JSON.stringify(options.body) : undefined });
    const result = await response.json(); window.__responses.push({ name: options.body?.name, status: response.status });
    if (!response.ok) throw Object.assign(new Error("fixture_response"), { status: response.status, code: result.error }); return result;
  },
  onContacts(rows) { window.__contactPage = rows.map(row => row.id); }, onError(error) { window.__authFailures.push(error.status); }
});
window.crmFixture = crm;
await crm.initialize(); await crm.loadInbox(); crm.selectConversation("${conversationId}"); document.body.dataset.ready = "true";`;
const html = `<!doctype html><html lang=fr><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Synthetic CRM rehearsal</title><link rel=stylesheet href=/chat.css><link rel=stylesheet href=/brand/brand.css><link rel=stylesheet href=/crm.css><link rel=stylesheet href=/i18n.css>
<script src=/i18n.js defer></script><script src=/i18n-tools.js defer></script><script type=module src=/fixture.js></script></head>
<body><main class=page><header class=inbox-head><h1>Jessie · fixture</h1></header><header class=chat-head><h2>AlexFixture</h2></header></main></body></html>`;

async function fixture({ contactCount = 0 } = {}) {
  const resources = new Map(await Promise.all(files.map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  const now = Date.now(), requests = [], writes = [], holds = new Set(), pending = new Map();
  let profile = { conversationId, client: { id: id(2), pseudonym: "AlexFixture", email: "synthetic@example.invalid", status: "active" },
    access: { state: "active", expiresAt: null }, nickname: "", notes: "Notes partagées fictives", reminderAt: null,
    labels: [], version: "1", updatedAt: now };
  const labels = new Map([[id(1), { id: id(1), kind: "tag", name: "Étiquette fixture", version: "1", memberCount: 0, createdAt: now, updatedAt: now }]]);
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url, "http://localhost").pathname; requests.push({ path, method: request.method });
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'");
      const send = (status, body, type = "application/json") => { response.writeHead(status, { "Content-Type": type }); response.end(type === "application/json" ? JSON.stringify(body) : body); };
      if (path === "/__seed") { send(200, "<!doctype html><title>Local fixture</title>", "text/html"); return; }
      if (path === "/fixture") { send(200, html, "text/html"); return; }
      if (path === "/fixture.js") { send(200, bootstrap, "text/javascript"); return; }
      if (resources.has(path)) { send(200, resources.get(path), path.endsWith(".js") ? "text/javascript" : "text/css"); return; }
      if (path === "/api/admin/crm/contacts") {
        const after = new URL(request.url, "http://localhost").searchParams.get("afterId");
        const start = after ? Number.parseInt(after, 16) + 1 : 1;
        const contacts = Array.from({ length: Math.max(0, Math.min(50, contactCount - start + 1)) }, (_, index) => ({ id: id(start + index), peerName: `Synthetic client ${start + index}`, unreadCount: 0 }));
        const hasMore = start + contacts.length <= contactCount;
        send(200, { contacts, hasMore, nextCursor: hasMore ? contacts.at(-1).id : null }); return;
      }
      if (path === "/api/admin/crm/labels" && request.method === "GET") { send(200, { labels: [...labels.values()], hasMore: false, nextCursor: null }); return; }
      if (path === `/api/admin/crm/conversations/${conversationId}` && request.method === "GET") { send(200, profile); return; }
      if (request.method === "POST") {
        let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 65536) throw new Error("fixture_budget"); }
        const body = JSON.parse(raw); writes.push({ path, body });
        if (path === `/api/admin/crm/conversations/${conversationId}`) {
          if (body.expectedVersion !== profile.version) { send(409, { error: "record_changed" }); return; }
          profile = { ...profile, nickname: body.nickname, notes: body.notes, reminderAt: body.reminderAt,
            labels: body.labelIds.map(key => labels.get(key)), version: String(Number(profile.version) + 1), updatedAt: Date.now() };
          send(200, profile); return;
        }
        if (path === "/api/admin/crm/labels") {
          const finish = (status = 201) => {
            if (status >= 400) { send(status, { error: "authentication_required" }); return; }
            const entry = { id: id(labels.size + 1), kind: body.kind, name: body.name, version: "1", memberCount: 0, createdAt: now, updatedAt: now };
            labels.set(entry.id, entry); send(201, { label: entry, duplicate: false });
          };
          if (holds.has(body.name)) { pending.set(body.name, finish); return; }
          finish(); return;
        }
      }
      send(404, { error: "not_found" });
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, writes, holds, pending, profile: () => profile,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

async function openPage(driver, source, language, width) {
  const page = await driver.browser({ origin: source.origin, width });
  try {
    await page.navigate("/__seed"); await page.execute("sessionStorage.setItem('jessiemessage.language', arguments[0])", language);
    await page.navigate("/fixture"); await waitUntil(() => page.execute("return document.body.dataset.ready === 'true'"), "CRM fixture ready"); return page;
  } catch (error) { await page.close(); throw error; }
}

test("real Chrome: a queued CRM close cannot dismiss the reopened profile or clear its draft", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(); let page;
  const draft = "Brouillon privé conservé après réouverture";
  try {
    page = await openPage(driver, source, "fr", 375); await page.click(".crm-fiche-button");
    await waitUntil(() => page.execute("return !document.querySelector('.crm-profile-form fieldset').hidden"), "profile loaded before close race");
    await page.type(profileSelector, draft);
    assert.deepEqual(await page.execute(`
      const dialog = document.querySelector('.crm-profile-form').closest('dialog');
      window.__crmOldClose = null;
      dialog.addEventListener('close', event => { window.__crmOldClose = { trusted: event.isTrusted }; }, { once: true });
      dialog.querySelector('.dialog-head button').click();
      document.querySelector('.crm-fiche-button').click();
      return { open: dialog.open, closeObserved: window.__crmOldClose !== null };
    `), { open: true, closeObserved: false }, "both real button handlers run before the queued native close");
    await waitUntil(() => page.execute("return window.__crmOldClose !== null"), "old native CRM close observed");
    assert.equal(await page.execute("return window.__crmOldClose.trusted"), true);
    assert.equal(await page.execute("return document.querySelector('.crm-profile-form').closest('dialog').open"), true);
    await waitUntil(() => page.execute("return !document.querySelector('.crm-profile-form fieldset').hidden"), "reopened profile remains loaded");
    assert.equal(await page.execute("return document.querySelector(arguments[0]).value", profileSelector), draft);
    assert.equal(await page.execute("return window.crmFixture.hasUnsavedWork()"), true);
    assert.equal(source.writes.length, 0, "close and reopen never save implicitly");
    await page.key("\uE00C");
    await waitUntil(() => page.execute("return !document.querySelector('.crm-profile-form').closest('dialog').open && document.activeElement?.matches('.crm-fiche-button')"), "Escape still closes and restores focus");
    assert.equal(source.writes.length, 0); assert.deepEqual(await page.execute("return window.__errors"), []);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});

test("real Chrome: shared administrator CRM drafts, conflicts and paused label requests", { timeout: 180000 }, async t => {
  const driver = await startWebDriver();
  try {
    for (const language of ["fr", "en"]) for (const width of [375, 1280]) await t.test(`two editors, ${language}, ${width}px`, async () => {
      const source = await fixture(); let first, second;
      const noteA = "Version A fictive <script>literal</script>", noteB = "  Version B fictive\navec espaces  ";
      try {
        first = await openPage(driver, source, language, width); second = await openPage(driver, source, language, width);
        await tabUntil(first, ".crm-fiche-button"); await first.key("\uE007"); await second.click(".crm-fiche-button");
        for (const page of [first, second]) await waitUntil(() => page.execute("return !document.querySelector('.crm-profile-form fieldset').hidden"), "profile loaded");
        assert.equal(await first.execute("return document.querySelector('.crm-fiche-button').textContent"), language === "fr" ? "Profil du client" : "Client profile");
        await first.type(profileSelector, noteA); await second.type(profileSelector, noteB);
        await first.click(".crm-profile-form button[type=submit]");
        await waitUntil(() => first.execute("return document.querySelector('.crm-dialog > .crm-status').textContent === arguments[0]", language === "fr" ? "Fiche enregistrée." : "Profile saved."), "first saved");
        await second.click(".crm-profile-form button[type=submit]");
        await waitUntil(() => second.execute("return !document.querySelector('.crm-conflict').hidden"), "concurrent conflict visible");
        assert.equal(await second.execute("return document.querySelector(arguments[0]).value", profileSelector), noteB);
        assert.equal(await second.execute("return document.querySelector('.crm-conflict textarea').value"), noteA);
        assert.equal(await second.execute("return document.querySelector('.crm-conflict h3').textContent"), language === "fr" ? "La fiche a été modifiée ailleurs" : "The profile was changed elsewhere");
        assert.equal(source.profile().notes, noteA); assert.equal(source.writes.length, 2, "no implicit overwrite");
        const overflow = await second.execute("const root=document.documentElement, dialog=document.querySelector('.crm-dialog'); return { page: root.scrollWidth-root.clientWidth, dialog: dialog.scrollWidth-dialog.clientWidth }");
        assert.ok(overflow.page <= 1 && overflow.dialog <= 1, JSON.stringify(overflow));
        if (width === 375) {
          await second.click(".crm-conflict .crm-actions button:first-child");
          assert.equal(await second.execute("return document.querySelector(arguments[0]).value", profileSelector), noteA);
          await second.type(profileSelector, noteB); await second.click(".crm-profile-form button[type=submit]");
        } else await second.click(".crm-conflict .crm-actions button:last-child");
        await waitUntil(() => source.profile().version === "3", "explicit choice saved against current version");
        await waitUntil(() => second.execute("return !document.querySelector('.crm-profile-form fieldset').disabled && document.querySelector('.crm-conflict').hidden"), "save unlocked");
        assert.equal(source.profile().notes, noteB); assert.deepEqual(source.writes.map(item => item.body.expectedVersion), ["1", "1", "2"]);
        await second.key("\uE00C");
        await waitUntil(() => second.execute("return document.activeElement?.matches('.crm-fiche-button')"), "focus returns after Escape");
        for (const page of [first, second]) {
          assert.deepEqual(await page.execute("return window.__errors"), []); assert.deepEqual(await page.execute("return window.__authFailures"), []);
          assert.equal(await page.execute("return Object.keys(localStorage).length"), 0);
        }
      } finally { await first?.close(); await second?.close(); await source.close(); }
    });
    for (const language of ["fr", "en"]) await t.test(`old label failure after pause, ${language}`, async () => {
      const source = await fixture(); let page;
      source.holds.add("Ancien"); source.holds.add("Actuel");
      try {
        page = await openPage(driver, source, language, 375); await page.click(managerSelector);
        await waitUntil(() => page.execute("return document.querySelectorAll('.crm-label-row').length === 1"), "labels loaded");
        await page.type(".crm-create-label input", "Ancien"); await page.click(createSelector);
        await waitUntil(() => source.pending.has("Ancien"), "old creation pending");
        await page.execute("window.crmFixture.suspend()");
        await page.executeAsync("window.crmFixture.resume().then(arguments[arguments.length-1])");
        await page.click(managerSelector);
        await waitUntil(() => page.execute("return !document.querySelector(arguments[0]).disabled && document.querySelector('.crm-label-dialog .crm-status').textContent === ''", createSelector), "resumed manager loaded");
        await page.type(".crm-create-label input", "Actuel"); await page.click(createSelector);
        await waitUntil(() => source.pending.has("Actuel"), "new creation pending");
        source.pending.get("Ancien")(401);
        // Observe the browser after the actual network rejection has settled.
        await waitUntil(() => page.execute("return window.__responses.some(result => result.name === 'Ancien' && result.status === 401)"), "old network failure received");
        assert.deepEqual(await page.execute("return window.__authFailures"), []);
        assert.equal(await page.execute("return document.querySelector(arguments[0]).disabled", createSelector), true);
        assert.equal(await page.execute("return document.querySelector('.crm-label-dialog .crm-status').textContent"), language === "fr" ? "Création…" : "Creating…");
        assert.equal(await page.execute("return document.querySelector('.crm-create-label input').value"), "Actuel");
        source.pending.get("Actuel")();
        await waitUntil(() => page.execute("return !document.querySelector(arguments[0]).disabled", createSelector), "current creation completed");
        assert.equal(source.writes.length, 2); assert.deepEqual(await page.execute("return window.__errors"), []);
        assert.equal(source.requests.some(item => /smtp|mail|notification|broadcast/.test(item.path)), false);
      } finally { await page?.close(); await source.close(); }
    });
  } finally { await driver.close(); }
});


test("real Chrome mobile FR/EN: CRM pages replace contacts and keep an open client's unsaved notes", { timeout: 90000 }, async () => {
  const driver = await startWebDriver();
  try {
    for (const [language, width] of [["fr", 320], ["en", 390]]) {
      const source = await fixture({ contactCount: 1000 }); let page;
      try {
        page = await openPage(driver, source, language, width);
        assert.equal(await page.execute("return window.__contactPage.length"), 50);
        await page.click(".crm-fiche-button");
        await waitUntil(() => page.execute("return !document.querySelector('.crm-profile-form fieldset').hidden"), "CRM notes ready");
        await page.type(profileSelector, "Unsent synthetic notes to preserve");
        await page.key("\uE00C");
        for (let index = 0; index < 5; index++) await page.executeAsync("window.crmFixture.loadInbox(true).then(arguments[arguments.length-1])");
        assert.equal(await page.execute("return window.__contactPage.length"), 50);
        assert.equal(await page.execute("return window.__contactPage[0]"), id(251));
        await page.click(".crm-pagination button:nth-child(2)");
        await waitUntil(() => page.execute("return window.__contactPage[0]===arguments[0]", id(201)), "previous CRM page replaces the current page");
        assert.equal(await page.execute("return document.documentElement.scrollWidth <= innerWidth"), true);
        assert.equal(await page.execute("return document.querySelector('.crm-page-label').textContent"), "Page 5");
        await mkdir(new URL("../../artifacts/homepage/", import.meta.url), { recursive: true });
        await writeFile(new URL(`../../artifacts/homepage/crm-pagination-${language}-${width}.png`, import.meta.url), Buffer.from(await page.screenshot(), "base64"));
        await page.click(".crm-pagination button:first-child");
        await waitUntil(() => page.execute("return window.__contactPage[0]===arguments[0]", id(1)), "first CRM page accessible");
        await page.click(".crm-fiche-button");
        await waitUntil(() => page.execute("return !document.querySelector('.crm-profile-form fieldset').hidden"), "pinned CRM notes reopened");
        assert.equal(await page.execute("return document.querySelector(arguments[0]).value", profileSelector), "Unsent synthetic notes to preserve");
        assert.equal(await page.execute("return window.crmFixture.hasUnsavedWork()"), true);
        assert.equal(source.writes.length, 0); assert.deepEqual(await page.execute("return window.__errors"), []);
      } finally { await page?.close(); await source.close(); }
    }
  } finally { await driver.close(); }
});
