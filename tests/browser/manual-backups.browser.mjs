import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";
import { archive, backupRequest, snapshot } from "../helpers/manual-backups-ui.mjs";

const names = ["manual-backups.html", "manual-backups.js", "manual-backups.css", "i18n-manual-backups.js", "readiness.css", "readiness-model.js", "i18n.js", "i18n.css", "session-clock.js", "brand/brand.css", "brand/icon-128.png", "favicon.ico", "manifest.webmanifest"];
async function fixture({ loseAcknowledgement = false, availableArchive = false } = {}) {
  const resources = new Map(await Promise.all(names.map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  let current = snapshot(null, availableArchive ? archive() : null), changed = false, unavailable = false;
  const requests = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname; let text = ""; for await (const chunk of request) text += chunk;
    requests.push({ path, method: request.method, text });
    const send = (status, type, body) => { response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(body); };
    const json = (body, status = 200) => send(status, "application/json", JSON.stringify(body));
    if (path === "/__fixture") return send(200, "text/html", "<!doctype html><title>Local fixture</title>");
    if (path === "/api/auth/session") return json({ user: { id: "1".repeat(32), role: "admin" }, csrf: (changed ? "B" : "A").repeat(43), expiresAt: Date.now() + 3600000 });
    if (path === "/api/admin/backups") return unavailable ? json({ error: "backups_unavailable" }, 503) : json(current);
    if (path === "/api/admin/backups/captures") {
      assert.equal(request.headers["x-csrf-token"], "A".repeat(43));
      const { requestId } = JSON.parse(text); assert.match(requestId, /^[0-9a-f]{32}$/);
      current = snapshot(backupRequest(requestId, "running"), current.latestArchive);
      const acknowledgement = { version: 1, mode: "manual", request: current.request };
      if (loseAcknowledgement) {
        // Start the actual response before severing its body. Closing a socket
        // without headers can make Chrome retry the transport itself, which is
        // distinct from an application replay after a lost acknowledgement.
        const body = JSON.stringify(acknowledgement);
        response.writeHead(202, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
        response.flushHeaders(); response.write(body.slice(0, 16), () => response.destroy()); return;
      }
      return json(acknowledgement, 202);
    }
    if (path === `/api/admin/backups/archives/${archive().id}`) {
      response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${archive().filename}"`, "Cache-Control": "no-store" });
      response.end("synthetic encrypted archive"); return;
    }
    if (path === "/admin/backups") return send(200, "text/html", resources.get("/manual-backups.html"));
    if (resources.has(path)) return send(200, path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "application/octet-stream", resources.get(path));
    send(404, "application/json", "{}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests,
    complete() { current = snapshot(backupRequest(current.request?.requestId, "complete"), archive()); },
    unavailable(value) { unavailable = value; }, changeSession() { changed = true; },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  };
}
const countPosts = source => source.requests.filter(request => request.method === "POST").length;
test("real Chrome: manual backup creation and encrypted download are explicit, translated and keyboard accessible at three widths", { timeout: 150000 }, async t => {
  const driver = await startWebDriver();
  try {
    for (const language of ["fr", "en"]) for (const width of [320, 375, 1280]) await t.test(`${language} ${width}px`, async () => {
      const source = await fixture(); let page;
      try {
        page = await driver.browser({ origin: source.origin, width }); await page.navigate("/__fixture");
        await page.execute("sessionStorage.setItem('jessiemessage.language',arguments[0])", language); await page.navigate("/admin/backups");
        await waitUntil(() => page.execute("return !document.getElementById('backup-content').hidden"), "private backup controls");
        assert.equal(await page.execute("return document.querySelector('h1').textContent"), language === "fr" ? "Sauvegardes" : "Backups");
        assert.equal(countPosts(source), 0, "opening the page does not create a backup");
        assert.equal(await page.execute("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && [...document.querySelectorAll('main button')].filter(b=>!b.hidden).every(b=>b.getBoundingClientRect().height>=44)"), true);
        await tabUntil(page, "#create-backup"); await page.key("\uE007");
        await waitUntil(() => page.execute("return document.getElementById('create-backup').disabled && document.getElementById('capture-state').textContent.includes(arguments[0])", language === "fr" ? "Sauvegarde en cours" : "Backup in progress"), "running backup");
        assert.equal(countPosts(source), 1);
        source.complete(); await page.click("#refresh");
        await waitUntil(() => page.execute("return !document.getElementById('download-backup').hidden && !document.getElementById('download-backup').disabled"), "completed encrypted archive");
        const beforeDate = await page.execute("return document.getElementById('archive-details').textContent");
        await page.execute("document.addEventListener('click',event=>{const a=event.target.closest('a[download]');if(a){event.preventDefault();window.__backupLink={href:a.getAttribute('href'),filename:a.download};}})");
        await tabUntil(page, "#download-backup"); await page.key("\uE007");
        await waitUntil(() => page.execute("return !!window.__backupLink"), "native download link after session proof");
        assert.deepEqual(await page.execute("return window.__backupLink"), { href: `/api/admin/backups/archives/${archive().id}`, filename: archive().filename });
        assert.equal(source.requests.at(-1).path, "/api/auth/session");
        assert.equal(source.requests.some(request => request.path.startsWith("blob:")), false);
        assert.equal(countPosts(source), 1);
        const requestCount = source.requests.length; await page.execute("JessieI18n.setLanguage(arguments[0])", language === "fr" ? "en" : "fr");
        assert.notEqual(await page.execute("return document.getElementById('archive-details').textContent"), beforeDate);
        assert.equal(source.requests.length, requestCount, "language changes do not repeat a request");
        assert.equal(await page.execute("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && !document.body.textContent.includes('A'.repeat(43)) && Object.keys(localStorage).length===0"), true);
      } finally { try { await page?.close(); } finally { await source.close(); } }
    });
  } finally { await driver.close(); }
});
test("real Chrome: a lost capture acknowledgement survives a visibility handoff and a server interruption without a replay", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture({ loseAcknowledgement: true }); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate("/admin/backups");
    await waitUntil(() => page.execute("return !document.getElementById('backup-content').hidden"), "initial backup page");
    await page.execute("const nativeFetch=window.fetch;window.__captureFetches=[];window.fetch=function(path,options){if(path==='/api/admin/backups/captures')window.__captureFetches.push(JSON.parse(options.body).requestId);return nativeFetch.call(this,path,options);};");
    await page.click("#create-backup");
    await waitUntil(() => page.execute("return document.getElementById('backup-status').textContent.includes('pas encore confirmé')"), "lost acknowledgement remains unconfirmed");
    const requestId = JSON.parse(source.requests.find(request => request.method === "POST").text).requestId;
    assert.deepEqual(await page.execute("return window.__captureFetches"), [requestId], "one explicit application fetch with the exact received identifier");
    assert.equal(countPosts(source), 1);
    await page.execute("Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));JessieI18n.setLanguage('en')");
    assert.equal(await page.execute("return document.getElementById('backup-content').hidden && document.getElementById('capture-details').textContent==='' && document.getElementById('archive-details').textContent===''"), true);
    source.unavailable(true);
    await page.execute("Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))");
    await waitUntil(() => page.execute("return document.getElementById('backup-status').textContent.includes('temporarily unavailable')"), "temporary service interruption");
    assert.equal(await page.execute("return !document.getElementById('backup-status').classList.contains('is-error')"), true);
    source.unavailable(false); source.complete(); await page.click("#refresh");
    await waitUntil(() => page.execute("return document.getElementById('capture-state').textContent==='Backup complete.' && !document.getElementById('download-backup').hidden"), "durable completed state");
    assert.deepEqual(await page.execute("return window.__captureFetches"), [requestId], "visibility and refresh never replay the application capture request");
    assert.equal(countPosts(source), 1);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});
test("real Chrome: a changed administrator session suppresses a pending archive download", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture({ availableArchive: true }); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 320 }); await page.navigate("/admin/backups");
    await waitUntil(() => page.execute("return !document.getElementById('download-backup').hidden"), "available archive");
    await page.execute("document.addEventListener('click',event=>{if(event.target.closest('a[download]')){event.preventDefault();window.__downloaded=true;}})");
    source.changeSession(); await page.click("#download-backup");
    await waitUntil(() => page.execute("return document.getElementById('backup-status').textContent.includes('session a changé') && !document.getElementById('backup-content').hidden"), "replacement session proof");
    assert.equal(await page.execute("return !!window.__downloaded"), false); assert.equal(countPosts(source), 0);
    assert.equal(source.requests.some(request => request.path.includes("/archives/")), false);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});
