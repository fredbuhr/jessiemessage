import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { startWebDriver, waitUntil } from "./webdriver.mjs";
import catalogue from "../../public/preferences-catalogue.json" with { type: "json" };
const entry = catalogue.categories[0].preferences[0], second = catalogue.categories[0].preferences[1];
const files = ["preferences.js", "preferences-model.js", "preferences-catalogue.json", "preferences.css", "i18n-preferences.js", "i18n.js"];
const markup = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/preferences.css"><script src="/i18n.js" defer></script><script type="module" src="/fixture.js"></script></head><body><main id="host"></main></body></html>`;
const module = `import {createPreferencesUI} from '/preferences.js';
const params=new URLSearchParams(location.search); JessieI18n.setLanguage(params.get('lang')||'fr');
window.__preferencesErrors=[];window.addEventListener('error',()=>__preferencesErrors.push('error'));window.addEventListener('unhandledrejection',()=>__preferencesErrors.push('unhandled'));
window.__owner=true;window.__ui=createPreferencesUI({role:params.get('role')||'client',host:document.getElementById('host'),isCurrent:()=>window.__owner,
...(params.get('readonly')?{conversationId:'c'.repeat(32),readOnly:true}:{}),request:async(path,options)=>{const response=await fetch(path,{method:options.mutation?'POST':'GET',headers:{'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});const value=await response.json();if(!response.ok)throw Object.assign(new Error('request'),{status:response.status,code:value.error});return value;}});window.__ui.load();`;
async function fixture() {
  const resources = new Map(await Promise.all(files.map(async file => [`/${file}`, await readFile(new URL(`../../public/${file}`, import.meta.url))]))), calls = [], failures = [];
  const rows = new Map(); let hold = null;
  const view = role => rows.get(role) ?? { version: "0", catalogueVersion: catalogue.meta.version, selectedIds: [] };
  const server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url, "http://localhost"); response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'");
    if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(markup); return; }
    if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(module); return; }
    if (resources.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : url.pathname.endsWith(".json") ? "application/json" : "text/javascript"); response.end(resources.get(url.pathname)); return; }
    const match = /^\/api\/profile\/(admin|client)(?:\/conversations\/[a-f0-9]{32})?\/preferences$/.exec(url.pathname);
    if (match) {
      response.setHeader("Content-Type", "application/json"); const role = match[1];
      if (request.method === "POST") {
        let raw = ""; for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw); calls.push(body); const current = view(role);
        if (hold) await hold;
        if (body.expectedVersion !== current.version) { response.writeHead(409); response.end(JSON.stringify({ error: "preferences_changed" })); return; }
        const next = { version: String(Number(current.version) + 1), catalogueVersion: body.catalogueVersion, selectedIds: body.selectedIds }; rows.set(role, next);
      }
      response.end(JSON.stringify(view(role))); return;
    }
    response.writeHead(404); response.end();
  })().catch(error => { failures.push(error.message); response.destroy(); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, calls, failures, rows, hold(value) { hold = value; }, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
const ready = page => waitUntil(() => page.execute("return !document.querySelector('.preferences-search').disabled"), "preferences loaded");
test("real Chrome preferences: full catalogue, search, selection, save, reconnect, privacy and FR/EN on phone/desktop", { timeout: 120000 }, async t => {
  const driver = await startWebDriver(); let source;
  try {
    source = await fixture();
    for (const role of ["client", "admin"]) for (const width of [320, 1280]) await t.test(`${role}, ${width}px`, async () => {
      source.rows.delete(role); const page = await driver.browser({ origin: source.origin, width });
      try {
        await page.navigate(`/?role=${role}`); await ready(page);
        assert.equal(await page.execute("return document.querySelectorAll('.preference-category').length"), 25);
        assert.equal(await page.execute("return document.querySelectorAll('.preference-grid button').length"), 0, "691 options are not opened on phone");
        await page.type(".preferences-search", entry.aliases[0].toUpperCase());
        const selector = `[data-preference-id="${entry.id}"]`;
        await waitUntil(() => page.execute(`return !!document.querySelector(${JSON.stringify(selector)})`), "alias finds canonical button");
        await page.click(selector);
        assert.equal(await page.execute(`return document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')`), "true");
        assert.equal(await page.execute(`return document.activeElement===document.querySelector(${JSON.stringify(selector)})`), true, "selection preserves keyboard focus");
        const before = source.calls.length;
        await page.execute("document.querySelector('.preferences-actions button').click();document.querySelector('.preferences-actions button').click()");
        await waitUntil(() => page.execute("return document.querySelector('.preferences-status').textContent==='Préférences enregistrées.'"), "explicit save confirmed");
        assert.equal(source.calls.length, before + 1); assert.deepEqual(source.calls.at(-1).selectedIds, [entry.id]);
        await page.navigate(`/?role=${role}&lang=en`); await ready(page);
        assert.equal(await page.execute("return document.querySelector('.preferences-selected').textContent"), entry.en);
        assert.equal(await page.execute("return document.querySelector('.preferences-section h3').textContent"), "My tastes & fantasies");
        assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth"), true);
        await page.execute("JessieI18n.setLanguage('fr')");
        assert.equal(await page.execute("return document.querySelector('.preferences-selected').textContent"), entry.fr);
        await page.execute("window.__ui.close()");
        assert.equal(await page.execute("return document.querySelector('.preferences-selected').textContent"), "");
        assert.equal(await page.execute("return document.querySelector('.preferences-categories').textContent"), "");
        assert.deepEqual(await page.execute("return window.__preferencesErrors"), []);
      } finally { await page.close(); }
    });
    assert.deepEqual(source.failures, []);
  } finally { await source?.close(); await driver.close(); }
});
test("real Chrome preferences: concurrent device changes preserve a draft until explicit resolution; admin peer view is read-only", { timeout: 120000 }, async () => {
  const driver = await startWebDriver(); let source, first, other;
  try {
    source = await fixture(); first = await driver.browser({ origin: source.origin, width: 1280 }); other = await driver.browser({ origin: source.origin, width: 320 });
    await first.navigate("/?role=client"); await other.navigate("/?role=client"); await ready(first); await ready(other);
    for (const [page, item] of [[first, entry], [other, second]]) { await page.type(".preferences-search", item.fr); await page.click(`[data-preference-id="${item.id}"]`); }
    await first.click(".preferences-actions button"); await waitUntil(() => first.execute("return document.querySelector('.preferences-status').textContent==='Préférences enregistrées.'"), "first device saved");
    await other.click(".preferences-actions button"); await waitUntil(() => other.execute("return !document.querySelector('.preferences-conflict').hidden"), "stale device conflict");
    assert.equal(await other.execute("return document.querySelector('.preferences-selected').textContent"), second.fr);
    await other.click(".preferences-conflict button:last-child"); await ready(other);
    assert.equal(await other.execute("return document.querySelector('.preferences-selected').textContent"), second.fr);
    await other.click(".preferences-actions button"); await waitUntil(() => other.execute("return document.querySelector('.preferences-status').textContent==='Préférences enregistrées.'"), "explicit replacement saved");
    assert.deepEqual(source.rows.get("client").selectedIds, [second.id]);
    source.rows.set("admin", { version: "1", catalogueVersion: catalogue.meta.version, selectedIds: [entry.id] });
    await first.navigate("/?role=admin&readonly=1"); await waitUntil(() => first.execute("return document.querySelector('.preferences-selected').textContent.length>0"), "read-only peer selection");
    assert.equal(await first.execute("return document.querySelector('.preferences-actions').hidden"), true);
    assert.equal(await first.execute("return document.querySelectorAll('.preference-grid button').length"), 0);
    assert.deepEqual(source.failures, []);
  } finally { await first?.close(); await other?.close(); await source?.close(); await driver.close(); }
});
