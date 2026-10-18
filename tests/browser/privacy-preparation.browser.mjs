import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

async function fixture() {
  const names = ["privacy.html", "privacy.js", "privacy.css", "i18n-privacy.js", "i18n.js", "i18n.css", "readiness-model.js", "brand/brand.css", "brand/icon-64.png", "favicon.ico"];
  const resources = new Map(await Promise.all(names.map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  const requests = [], draft = { answers: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`D0${i + 1}`, ""])), notice: { fr: "Texte français — À COMPLÉTER D01", en: "English text — TO COMPLETE D01" } };
  let version = 0, changed = false, hidden = false, changeOnSave = false, delayedRead = null;
  const value = () => ({ version: 1, revision: version, updatedAt: version ? Date.now() : null, publication: "draft_only", retention: "not_enabled", answered: [], draft });
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname; let text = ""; for await (const chunk of request) text += chunk;
    requests.push({ path, method: request.method, text, csrf: request.headers["x-csrf-token"] });
    const send = (status, type, body) => { response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(body); };
    const json = (body, status = 200) => send(status, "application/json", JSON.stringify(body));
    if (path === "/__fixture") return send(200, "text/html", "<!doctype html><title>Local fixture</title>");
    if (path === "/session-clock.js") return send(200, "text/javascript", "globalThis.JessieSessionClock={scheduleSessionCheck(expiry,callback){window.__sessionCheck=callback;return()=>{};}};");
    if (path === "/api/auth/session") return json({ user: { id: "1".repeat(32), role: "admin", pseudonym: "Synthetic" }, csrf: (changed ? "C" : "A").repeat(43), expiresAt: Date.now() + 3600000 });
    if (path === "/api/admin/privacy" && request.method === "GET") {
      if (delayedRead) { const delayed = delayedRead; delayedRead = null; await delayed; }
      return json(value());
    }
    if (path === "/api/admin/privacy" && request.method === "POST") {
      const body = JSON.parse(text); if (body.revision !== version) return json({ error: "preparation_changed" }, 409);
      draft.answers = body.draft.answers; draft.notice = body.draft.notice; version++; if (changeOnSave) { changed = true; draft.answers.D01 = "Replacement session"; }
      return json(value());
    }
    if (path === "/admin/privacy") return send(200, "text/html", resources.get("/privacy.html"));
    if (resources.has(path)) return send(200, path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "application/octet-stream", resources.get(path));
    send(404, "application/json", "{}");
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests,
    changeRemote() { draft.answers.D01 = "Other device"; version++; }, changeSession() { changed = true; draft.answers.D01 = "Replacement session"; }, changeOnSave() { changeOnSave = true; },
    delayRead() { let release; delayedRead = new Promise(done => { release = done; }); return release; },
    async close() { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}
async function ready(page) { await waitUntil(() => page.execute("return !document.getElementById('privacy-content').hidden && document.querySelectorAll('#decision-groups textarea').length === 8"), "private preparation"); }
async function edit(page, text) { await page.click("#decision-groups details:first-child > summary"); await page.type("#answer-D01", text); }
const posts = source => source.requests.filter(item => item.path === "/api/admin/privacy" && item.method === "POST");

test("real Chrome: private preparation at mobile and desktop widths, FR/EN, keyboard save and independent notice language", { timeout: 150000 }, async t => {
  const driver = await startWebDriver();
  try {
    for (const language of ["fr", "en"]) for (const width of [320, 375, 1280]) await t.test(`${language} ${width}px`, async () => {
      const source = await fixture(); let page;
      try {
        page = await driver.browser({ origin: source.origin, width }); await page.navigate("/__fixture"); await page.execute("sessionStorage.setItem('jessiemessage.language',arguments[0])", language); await page.navigate("/admin/privacy"); await ready(page);
        assert.equal(await page.execute("return document.querySelector('h1').textContent"), language === "fr" ? "Confidentialité et conservation" : "Privacy and retention");
        assert.equal(await page.execute("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.getElementById('save').getBoundingClientRect().height >= 44"), true);
        assert.equal(posts(source).length, 0); assert.equal(await page.execute("return document.getElementById('save').disabled"), true);
        await edit(page, "Private synthetic identity");
        await page.click("#preview-en"); assert.equal(await page.execute("return document.getElementById('notice-preview').textContent"), "English text — TO COMPLETE D01");
        await page.click("[data-jm-language]"); assert.equal(await page.execute("return document.getElementById('answer-D01').value"), "Private synthetic identity");
        assert.equal(await page.execute("return document.getElementById('notice-preview').textContent"), "English text — TO COMPLETE D01");
        await tabUntil(page, "#save"); await page.key("\uE007"); await waitUntil(() => page.execute("return document.getElementById('save').disabled && !document.querySelector('textarea').disabled"), "saved private draft");
        assert.equal(posts(source).length, 1); assert.equal(posts(source)[0].csrf, "A".repeat(43));
        await page.navigate("/admin/privacy"); await ready(page); assert.equal(await page.execute("return document.getElementById('answer-D01').value"), "Private synthetic identity");
        assert.equal(await page.execute("return Object.keys(localStorage).length === 0 && Object.keys(sessionStorage).every(key=>key==='jessiemessage.language') && !document.body.textContent.includes('A'.repeat(43))"), true);
      } finally { try { await page?.close(); } finally { await source.close(); } }
    });
  } finally { await driver.close(); }
});
test("real Chrome: conflict preserves edits, compares saved data and requires a separate explicit save", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate("/admin/privacy"); await ready(page); await edit(page, "Local edits"); source.changeRemote(); await page.click("#save");
    await waitUntil(() => page.execute("return !document.getElementById('conflict').hidden && !document.getElementById('keep-local').disabled"), "visible conflict");
    assert.equal(await page.execute("return document.getElementById('answer-D01').value"), "Local edits"); assert.equal(posts(source).length, 1);
    assert.equal(await page.execute("return document.getElementById('remote-preview').textContent.includes('Other device') && document.getElementById('save').disabled"), true);
    await page.click("#keep-local"); assert.equal(posts(source).length, 1); assert.equal(await page.execute("return document.getElementById('save').disabled"), false);
    await page.click("#save"); await waitUntil(() => posts(source).length === 2, "explicit second save"); assert.equal(JSON.parse(posts(source)[1].text).revision, 1);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});
test("real Chrome: hiding clears private DOM and restores unsaved edits only for the same proved login", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate("/admin/privacy"); await ready(page); await edit(page, "Unsaved private identity");
    await page.execute("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__hidden?'hidden':'visible'});window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'))");
    assert.equal(await page.execute("return document.getElementById('privacy-content').hidden && !document.getElementById('notice-fr').value && !document.getElementById('notice-preview').textContent && !document.querySelector('#answer-D01')"), true);
    await page.execute("window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'))"); await ready(page); assert.equal(await page.execute("return document.getElementById('answer-D01').value"), "Unsaved private identity");
    await page.execute("window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'))"); source.changeSession();
    await page.execute("window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'))"); await ready(page); assert.equal(await page.execute("return document.getElementById('answer-D01').value"), "Replacement session"); assert.equal(posts(source).length, 0);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});
test("real Chrome: a replacement login during save discards the obsolete response and never repeats the write", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate("/admin/privacy"); await ready(page); await edit(page, "Old login edits"); source.changeOnSave(); await page.click("#save");
    await waitUntil(() => page.execute("return document.getElementById('answer-D01')?.value==='Replacement session' && !document.getElementById('privacy-content').hidden"), "proved replacement session"); assert.equal(posts(source).length, 1);
    assert.equal(await page.execute("return !document.body.textContent.includes('Old login edits') && !document.getElementById('notice-preview').textContent.includes('Old login edits')"), true);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});
test("real Chrome: markup in drafts stays literal and never executes when previewing or changing UI language", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate("/admin/privacy"); await ready(page); await page.click("#notice-editor > summary");
    const markup = '<img src=x onerror="window.__unsafe=true">'; await page.type("#notice-fr", markup);
    assert.equal(await page.execute("return document.getElementById('notice-preview').textContent"), markup); assert.equal(await page.execute("return !window.__unsafe && !document.querySelector('#notice-preview img')"), true);
    await page.click("[data-jm-language]"); assert.equal(await page.execute("return document.getElementById('notice-fr').value"), markup);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});
