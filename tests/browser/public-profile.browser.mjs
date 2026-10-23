import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { startWebDriver, waitUntil } from "./webdriver.mjs";
import catalogue from "../../public/preferences-catalogue.json" with { type: "json" };
const entry = catalogue.categories[0].preferences[0], second = catalogue.categories[1].preferences[0];
const files = ["public-profile.html", "public-profile.js", "public-profile.css", "public-profile-model.js", "profile-publication.js", "i18n-public-profile.js", "preferences-model.js", "preferences-catalogue.json", "i18n-preferences.js", "i18n.js", "i18n.css", "entry.css", "brand/brand.css", "brand/icon-128.png", "brand/icon-192.png"];
async function capture(page, name) {
  const directory = new URL("../../artifacts/public-profile/", import.meta.url); await mkdir(directory, { recursive: true });
  await writeFile(new URL(name, directory), Buffer.from(await page.screenshot(), "base64"));
}
async function fixture() {
  const resources = new Map(await Promise.all(files.map(async file => [`/${file}`, await readFile(new URL(`../../public/${file}`, import.meta.url))])));
  const calls = [], failures = []; let state = { version: "0", published: false, displayName: "Jessie", bio: "", catalogueVersion: catalogue.meta.version, selectedIds: [] }, mode = "normal";
  const publicValue = () => ({ displayName: state.displayName, bio: state.bio, catalogueVersion: state.catalogueVersion, selectedIds: state.selectedIds });
  const adminHTML = '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"><link rel="stylesheet" href="/public-profile.css"><script src="/i18n.js" defer></script><script type="module" src="/fixture.js"></script></head><body><main id="host"></main></body></html>';
  const script = `import {createPublicationUI} from '/profile-publication.js';window.__owner=true;window.__selection=${JSON.stringify([entry.id])};window.__publicationErrors=[];window.addEventListener('error',()=>__publicationErrors.push('error'));window.addEventListener('unhandledrejection',()=>__publicationErrors.push('unhandled'));window.__publication=createPublicationUI({host:document.getElementById('host'),getName:()=>'<img src=x onerror=alert(1)>',getSelection:()=>window.__selection,isCurrent:()=>window.__owner,request:async(path,options)=>{const response=await fetch(path,{method:options.mutation?'POST':'GET',signal:options.signal,headers:{'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});const value=await response.json();if(!response.ok)throw Object.assign(new Error('request'),{status:response.status,code:value.error});return value;}});window.__publication.load();`;
  const server = createServer((request, response) => { void (async () => {
    const path = new URL(request.url, "http://localhost").pathname; response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'");
    if (path === "/admin-fixture") { response.setHeader("Content-Type", "text/html"); response.end(adminHTML); return; }
    if (path === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); return; }
    if (path === "/api/profile/admin/publication") {
      response.setHeader("Content-Type", "application/json");
      if (request.method === "POST") {
        let raw = ""; for await (const chunk of request) raw += chunk; const body = JSON.parse(raw); calls.push(body);
        if (mode === "conflict" || body.expectedVersion !== state.version) { response.writeHead(409); response.end(JSON.stringify({ error: "public_profile_changed" })); return; }
        if (mode === "uncertain") { response.writeHead(503); response.end(JSON.stringify({ error: "public_profile_unavailable" })); return; }
        const { expectedVersion, ...snapshot } = body; state = { ...snapshot, version: String(Number(state.version) + 1) };
      }
      response.end(JSON.stringify(state)); return;
    }
    if (path === "/api/public/jessie") { response.setHeader("Content-Type", "application/json"); if (!state.published) { response.writeHead(404); response.end(JSON.stringify({ error: "not_found" })); } else response.end(JSON.stringify(publicValue())); return; }
    const file = path === "/jessie" ? "/public-profile.html" : path;
    if (resources.has(file)) { response.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : file.endsWith(".png") ? "image/png" : "text/javascript"); response.end(resources.get(file)); return; }
    response.writeHead(404); response.end();
  })().catch(error => { failures.push(error.message); response.destroy(); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, calls, failures, get state() { return state; }, set state(value) { state = value; }, mode(value) { mode = value; }, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
test("real Chrome public Jessie profile: public snapshot only, safe text, FR/EN and mobile width; unpublish is unavailable", { timeout: 120000 }, async () => {
  const driver = await startWebDriver(); let source;
  try {
    source = await fixture(); source.state = { ...source.state, version: "1", published: true, displayName: "Jessie <img src=x>", bio: "Première ligne\n<script>bad()</script>", selectedIds: [entry.id, second.id] };
    for (const width of [320, 1280]) {
      const page = await driver.browser({ origin: source.origin, width });
      try {
        await page.navigate("/jessie"); await waitUntil(() => page.execute("return !document.getElementById('public-profile-content').hidden"), "public profile displayed");
        assert.equal(await page.execute("return document.getElementById('public-profile-name').textContent"), source.state.displayName);
        assert.equal(await page.execute("return document.querySelectorAll('#public-profile-bio script,#public-profile-name img').length"), 0);
        assert.equal(await page.execute("return document.querySelectorAll('.public-preference-list li').length"), 2);
        assert.equal(await page.execute("return document.querySelector('.public-preference-list li').textContent"), entry.fr);
        assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth"), true);
        await page.execute("JessieI18n.setLanguage('en')");
        assert.equal(await page.execute("return document.querySelector('.public-preference-list li').textContent"), entry.en);
        assert.equal(await page.execute("return document.getElementById('public-preferences-title').textContent"), "My tastes & fantasies");
        source.state = { ...source.state, displayName: "Jessie", bio: "Bienvenue dans mon univers.\nRetrouvons-nous dans notre espace privé." };
        await page.navigate("/jessie"); await waitUntil(() => page.execute("return !document.getElementById('public-profile-content').hidden"), "neutral public profile capture");
        await page.execute("JessieI18n.setLanguage('fr')"); await capture(page, `public-${width}-fr.png`);
        await page.execute("JessieI18n.setLanguage('en')"); await capture(page, `public-${width}-en.png`);
        source.state = { ...source.state, published: false }; await page.navigate("/jessie");
        await waitUntil(() => page.execute("return !document.getElementById('public-profile-retry').hidden"), "hidden profile unavailable");
        assert.equal(await page.execute("return document.getElementById('public-profile-content').hidden"), true);
        assert.equal(await page.execute("return document.getElementById('public-profile-name').textContent"), ""); source.state = { ...source.state, published: true };
      } finally { await page.close(); }
    }
    assert.deepEqual(source.calls, []); assert.deepEqual(source.failures, []);
  } finally { await source?.close(); await driver.close(); }
});
test("real Chrome publication requires explicit snapshot, preserves hidden draft and blocks replay after conflict or uncertain save", { timeout: 120000 }, async () => {
  const driver = await startWebDriver(); let source, page;
  try {
    source = await fixture(); page = await driver.browser({ origin: source.origin, width: 320 }); await page.navigate("/admin-fixture");
    await waitUntil(() => page.execute("return !document.querySelector('.profile-publication input').disabled"), "publication loaded"); assert.equal(source.calls.length, 0);
    await page.type(".profile-publication textarea", "Présentation personnelle");
    await page.execute("JessieI18n.setLanguage('en')");
    assert.equal(await page.execute("return document.querySelector('.profile-publication textarea').value"), "Présentation personnelle");
    await page.execute("JessieI18n.setLanguage('fr')");
    await page.execute("document.querySelector('.profile-publication input').value='Jessie'"); await capture(page, "publication-320-fr.png");
    const desktop = await driver.browser({ origin: source.origin, width: 1280 });
    try { await desktop.navigate("/admin-fixture"); await waitUntil(() => desktop.execute("return !document.querySelector('.profile-publication input').disabled"), "desktop publication loaded"); await desktop.execute("document.querySelector('.profile-publication input').value='Jessie'"); await capture(desktop, "publication-1280-fr.png"); }
    finally { await desktop.close(); }
    await page.execute("window.__publication.suspend();window.__publication.resume()");
    assert.equal(await page.execute("return document.querySelector('.profile-publication textarea').value"), "Présentation personnelle");
    await page.click(".profile-publication-actions button:first-child");
    await waitUntil(() => page.execute("return document.querySelector('.profile-publication-status').textContent==='Profil public publié.'"), "publication confirmed");
    assert.equal(source.calls.length, 1); assert.deepEqual(source.state.selectedIds, [entry.id]);
    await page.execute(`window.__selection=${JSON.stringify([second.id])}`); assert.deepEqual(source.state.selectedIds, [entry.id], "later private draft edits do not change public snapshot");
    await page.click(".profile-publication-actions button:nth-child(2)");
    await waitUntil(() => page.execute("return document.querySelector('.profile-publication-status').textContent==='Profil public retiré.'"), "unpublished");
    assert.equal(source.state.published, false); assert.deepEqual(source.state.selectedIds, [entry.id]);
    source.mode("conflict"); await page.click(".profile-publication-actions button:first-child");
    await waitUntil(() => page.execute("return document.querySelector('.profile-publication-status').textContent.includes('a changé sur un autre appareil')"), "conflict blocks publication");
    const count = source.calls.length; await page.execute("document.querySelector('.profile-publication-actions button:first-child').click()"); assert.equal(source.calls.length, count);
    await page.click(".profile-publication-actions button:last-child"); await waitUntil(() => page.execute("return !document.querySelector('.profile-publication-actions button:first-child').disabled"), "explicit reload resolves conflict");
    source.mode("uncertain"); await page.click(".profile-publication-actions button:first-child");
    await waitUntil(() => page.execute("return document.querySelector('.profile-publication-status').textContent.includes('n’a pas pu être confirmée')"), "uncertain save reported");
    assert.equal(await page.execute("return document.querySelector('.profile-publication-actions button:first-child').disabled"), true);
    assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth"), true);
    await page.execute("window.__publication.close()"); assert.equal(await page.execute("return document.querySelector('.profile-publication textarea').value"), "");
    assert.deepEqual(await page.execute("return window.__publicationErrors"), []); assert.deepEqual(source.failures, []);
  } finally { await page?.close(); await source?.close(); await driver.close(); }
});
