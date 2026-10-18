import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const names = ["backups.html", "backups.js", "backups.css", "readiness.css", "readiness-model.js", "i18n.js", "i18n-backups.js", "i18n.css", "session-clock.js", "brand/brand.css", "brand/icon-128.png", "favicon.ico", "manifest.webmanifest"];
async function fixture(controlClock = false) {
  const resources = new Map(await Promise.all(names.map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  const id = "1".repeat(32), csrf = "A".repeat(43), requests = []; let sessionChanged = false, changeOnKit = false;
  let destination = { id: "2".repeat(32), label: "PC personnel", kind: "computer", enabled: true, paired: false, pairedAt: null, pairingExpiresAt: null, lastSeenAt: null, lastReceipt: null };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname; let text = "";
    for await (const chunk of request) text += chunk;
    requests.push({ path, method: request.method, text });
    const send = (status, type, body) => { response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(body); };
    const json = body => send(200, "application/json", JSON.stringify(body));
    if (path === "/__fixture") return send(200, "text/html", "<!doctype html><title>Local fixture</title>");
    if (path === "/session-clock.js" && controlClock) return send(200, "text/javascript", "globalThis.JessieSessionClock={scheduleSessionCheck(expiry,callback){window.__sessionCheck=callback;return()=>{};}};");
    if (path === "/api/auth/session") return json({ user: { id, role: "admin", pseudonym: "Synthetic" }, csrf: sessionChanged ? "C".repeat(43) : csrf, expiresAt: Date.now() + 3600000 });
    if (path === "/api/admin/backups") return json({ version: 1, checkedAt: Date.now(), archiveCount: 2, latestArchive: { id: "capture-1792340000000-cccccccccccccccc", startedAt: 1792340000000 }, schedule: { enabled: true, hourUtc: 5, minuteUtc: 15 }, destinations: destination ? [destination] : [], decryptionStatus: "not_checked" });
    if (path.endsWith("/settings")) { destination = { ...destination, ...JSON.parse(text) }; return json({}); }
    if (path.endsWith("/windows-kit")) { if (changeOnKit) sessionChanged = true; return send(200, "application/zip", "PK synthetic kit"); }
    if (path.endsWith("/revoke")) { destination = null; return json({ revoked: true }); }
    if (path === "/admin/backups") return send(200, "text/html", resources.get("/backups.html"));
    if (resources.has(path)) return send(200, path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "application/octet-stream", resources.get(path));
    send(404, "application/json", "{}");
  });
  await new Promise(yes => server.listen(0, "127.0.0.1", yes));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, changeOnKit() { changeOnKit = true; }, changeSession() { sessionChanged = true; destination.label = "Second session"; },
    async close() { server.closeAllConnections(); await new Promise(yes => server.close(yes)); } };
}
test("real Chrome: backup destinations, keyboard controls, translations and kit download at three widths", { timeout: 150000 }, async t => {
  const driver = await startWebDriver();
  try {
    for (const language of ["fr", "en"]) for (const width of [320, 375, 1280]) await t.test(`${language} ${width}px`, async () => {
      const source = await fixture(), page = await driver.browser({ origin: source.origin, width });
      try {
        await page.navigate("/__fixture"); await page.execute("sessionStorage.setItem('jessiemessage.language',arguments[0])", language); await page.navigate("/admin/backups");
        await waitUntil(() => page.execute("return !document.getElementById('backup-content').hidden && document.querySelectorAll('.destination').length === 1"), "private destinations");
        assert.equal(await page.execute("return document.querySelector('h1').textContent"), language === "fr" ? "Sauvegardes" : "Backups");
        assert.equal(await page.execute("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && [...document.querySelectorAll('.backup-actions button')].every(b => b.getBoundingClientRect().height >= 44)"), true);
        await tabUntil(page, '[data-action="toggle"]'); await page.key("\uE007");
        await waitUntil(() => page.execute("return document.querySelector('.copy-badge')?.textContent === arguments[0]", language === "fr" ? "Copies suspendues" : "Copies paused"), "paused status");
        await page.execute("document.addEventListener('click', e => { const a=e.target.closest('a[download]'); if(a){e.preventDefault();window.__kitName=a.download;}})");
        await tabUntil(page, '[data-action="kit"]'); await page.key("\uE007");
        await waitUntil(() => page.execute("return !!window.__kitName"), "explicit kit download");
        assert.equal(await page.execute("return window.__kitName"), "JessieMessage-sauvegardes-Windows.zip");
        assert.equal(source.requests.filter(r => r.path.endsWith("/windows-kit")).length, 1);
        assert.equal(await page.execute("return document.body.textContent.includes('A'.repeat(43)) || Object.keys(localStorage).length > 0"), false);
      } finally { await page.close(); await source.close(); }
    });
  } finally { await driver.close(); }
});
test("real Chrome: a login change during kit creation suppresses the download and never repeats the mutation", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(); source.changeOnKit(); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate("/admin/backups");
    await waitUntil(() => page.execute("return !document.getElementById('backup-content').hidden"), "initial session");
    await page.execute("document.addEventListener('click',e=>{if(e.target.closest('a[download]')){e.preventDefault();window.__downloaded=true;}})");
    await tabUntil(page, '[data-action="kit"]'); await page.key("\uE007");
    await waitUntil(() => page.execute("return !document.getElementById('backup-content').hidden && document.getElementById('backup-status').textContent.length > 0 && !document.querySelector('[data-action=kit]').disabled"), "fresh session after rejected old response");
    assert.equal(await page.execute("return !!window.__downloaded"), false); assert.equal(source.requests.filter(r => r.path.endsWith("/windows-kit")).length, 1);
  } finally { await page?.close(); await source.close(); await driver.close(); }
});
test("real Chrome: periodic proof replaces private settings after another login without a mutation", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(true); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate("/admin/backups");
    await waitUntil(() => page.execute("return !!window.__sessionCheck && !document.getElementById('backup-content').hidden"), "periodic session proof armed");
    source.changeSession(); await page.execute("window.__sessionCheck()");
    await waitUntil(() => page.execute("return document.querySelector('.destination h3')?.textContent === 'Second session'"), "settings from proved replacement login");
    assert.equal(source.requests.some(request => request.method !== "GET"), false);
  } finally { await page?.close(); await source.close(); await driver.close(); }
});
