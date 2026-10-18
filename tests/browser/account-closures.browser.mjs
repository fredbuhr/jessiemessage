import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const clientId = "2".repeat(32), endpoint = `/api/admin/closures/clients/${clientId}`;
async function fixture({ enabled = true, name = "Client fictif" } = {}) {
  const names = ["closures.html", "closures.js", "closures.css", "i18n-closures.js", "i18n.js", "i18n.css", "readiness-model.js", "brand/brand.css", "brand/icon-64.png", "favicon.ico"];
  const resources = new Map(await Promise.all(names.map(async file => [`/${file}`, await readFile(new URL(`../../public/${file}`, import.meta.url))])));
  const requests = []; let phase = "none", changed = false, changeNextProof = false, changeOnPost = false, dropPost = false, unavailable = false;
  const closure = () => ({ clientId, phase, updatedAt: phase === "none" ? null : Date.now(), scope: "active_database_and_client_owned_media", backupCopies: "separate_not_erased", externalCopies: "not_checked" });
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname; let text = ""; for await (const chunk of request) text += chunk;
    requests.push({ path, method: request.method, text, csrf: request.headers["x-csrf-token"] });
    const send = (status, type, body) => { response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(body); };
    const json = (body, status = 200) => send(status, "application/json", JSON.stringify(body));
    if (path === "/__fixture") return send(200, "text/html", "<!doctype html><title>Local closure fixture</title>");
    if (path === "/session-clock.js") return send(200, "text/javascript", "globalThis.JessieSessionClock={scheduleSessionCheck(expiry,callback){window.__sessionCheck=callback;return()=>{};}};");
    if (path.startsWith("/api/") && unavailable) return send(503, "text/plain", "Maintenance");
    if (path === "/api/auth/session") {
      if (changeNextProof) { changed = true; changeNextProof = false; }
      return json({ user: { id: "1".repeat(32), role: "admin", pseudonym: "Synthetic administrator" }, csrf: (changed ? "C" : "A").repeat(43), expiresAt: Date.now() + 3600000 });
    }
    if (path === "/api/admin/closures") return json({ version: 1, enabled, jobs: phase === "none" ? [] : [closure()], nextCursor: null });
    if (path === endpoint && request.method === "GET") return json({ version: 1, client: phase === "completed" ? null : { id: clientId, pseudonym: changed ? "Replacement account view" : name, status: phase === "prepared" ? "deleted" : "active" }, closure: closure() });
    if (path === endpoint && request.method === "POST") {
      phase = "requested"; if (changeOnPost) changed = true;
      if (dropPost) {
        // Lose an acknowledged partial response, rather than an empty reused
        // socket which Chrome itself can retry below the fetch API.
        response.writeHead(202, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": "2048" });
        response.flushHeaders(); response.write('{"version":1,'); setTimeout(() => response.destroy(), 25); return;
      }
      return json({ version: 1, accepted: true, closure: closure() }, 202);
    }
    if (path === "/admin/closures") return send(200, "text/html", resources.get("/closures.html"));
    if (resources.has(path)) return send(200, path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "application/octet-stream", resources.get(path));
    send(404, "application/json", "{}");
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, complete: () => { phase = "completed"; },
    changeSession: () => { changeNextProof = true; }, changeOnPost: () => { changeOnPost = true; }, dropPost: () => { dropPost = true; },
    maintenance: value => { unavailable = value; }, async close() { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}
const posts = source => source.requests.filter(item => item.path === endpoint && item.method === "POST");
const ready = page => waitUntil(() => page.execute("return !document.getElementById('selected').hidden && !document.getElementById('prepare').hidden && !document.getElementById('refresh').disabled"), "selected closure account");
async function confirm(page) {
  await page.click("#prepare"); await page.click("#acknowledge"); await page.type("#confirmation", "FERMER");
  await page.click("#confirm");
}

test("real Chrome: closure preview, separate confirmation and status at mobile and desktop widths in FR/EN", { timeout: 180000 }, async t => {
  const driver = await startWebDriver();
  try {
    for (const language of ["fr", "en"]) for (const width of [320, 375, 1280]) await t.test(`${language} ${width}px`, async () => {
      const source = await fixture(); let page;
      try {
        page = await driver.browser({ origin: source.origin, width }); await page.navigate("/__fixture");
        await page.execute("sessionStorage.setItem('jessiemessage.language',arguments[0])", language);
        await page.navigate(`/admin/closures?client=${clientId}`); await ready(page);
        assert.equal(await page.execute("return document.querySelector('h1').textContent"), language === "fr" ? "Fermeture des comptes" : "Account closures");
        assert.equal(posts(source).length, 0);
        await page.click("#prepare"); assert.equal(await page.execute("return document.activeElement.id"), "cancel");
        assert.equal(await page.execute("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.getElementById('confirm-dialog').scrollWidth <= document.getElementById('confirm-dialog').clientWidth + 1"), true);
        await page.type("#confirmation", "FERMER"); assert.equal(await page.execute("return document.getElementById('confirm').disabled"), true);
        await page.key("\uE007"); assert.equal(posts(source).length, 0);
        await page.click("#acknowledge"); await tabUntil(page, "#confirm"); await page.key("\uE007");
        await waitUntil(() => posts(source).length === 1 && page.execute("return !document.getElementById('confirm-dialog').open && document.getElementById('prepare').hidden && !document.getElementById('refresh').disabled"), "recorded closure");
        assert.deepEqual(JSON.parse(posts(source)[0].text), { confirmation: "FERMER", expectedPseudonym: "Client fictif" }); assert.equal(posts(source)[0].csrf, "A".repeat(43));
        source.complete(); await page.click("#refresh");
        await waitUntil(() => page.execute("return document.getElementById('selected-state').textContent===arguments[0]", language === "fr" ? "Effacement terminé dans l’application" : "Erasure completed in the application"), "completed receipt");
        assert.equal(posts(source).length, 1);
        assert.equal(await page.execute("return !document.getElementById('confirmation').value && !document.getElementById('acknowledge').checked && document.getElementById('prepare').hidden"), true);
        assert.equal(await page.execute("return Object.keys(localStorage).length === 0 && Object.keys(sessionStorage).every(key=>key==='jessiemessage.language') && !document.body.textContent.includes('A'.repeat(43))"), true);
      } finally { try { await page?.close(); } finally { await source.close(); } }
    });
  } finally { await driver.close(); }
});

test("real Chrome: cancel, hide and BFCache clear names and confirmation without submitting", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate(`/admin/closures?client=${clientId}`); await ready(page);
    await page.click("#prepare"); await page.type("#confirmation", "FERMER"); await page.click("#cancel"); assert.equal(posts(source).length, 0);
    await page.click("#prepare"); assert.equal(await page.execute("return !document.getElementById('confirmation').value && document.getElementById('confirm').disabled"), true);
    await page.execute("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__hidden?'hidden':'visible'});window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'))");
    assert.equal(await page.execute("return !document.getElementById('client-name').textContent && !document.getElementById('confirm-name').textContent && !document.getElementById('confirmation').value && !document.getElementById('confirm-dialog').open && document.getElementById('content').hidden"), true);
    await page.execute("window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'))"); await ready(page);
    await page.execute("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))"); await ready(page);
    assert.equal(posts(source).length, 0); assert.equal(await page.execute("return !document.getElementById('confirm-dialog').open"), true);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});

test("real Chrome: a replacement proof before confirmation cancels the old action", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate(`/admin/closures?client=${clientId}`); await ready(page);
    source.changeSession(); await confirm(page);
    await waitUntil(() => page.execute("return document.getElementById('client-name').textContent==='Replacement account view' && !document.getElementById('prepare').hidden"), "replacement proof");
    assert.equal(posts(source).length, 0); assert.equal(await page.execute("return !document.getElementById('confirm-dialog').open && !document.getElementById('confirmation').value"), true);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});

test("real Chrome: a lost response reloads the durable status with GET only, including after navigation", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate(`/admin/closures?client=${clientId}`); await ready(page); source.dropPost(); await confirm(page);
    await waitUntil(() => page.execute("return document.getElementById('selected-state').textContent==='Demande enregistrée · en attente' && document.getElementById('prepare').hidden"), "recovered durable intent");
    assert.equal(posts(source).length, 1); await page.navigate(`/admin/closures?client=${clientId}`);
    await waitUntil(() => page.execute("return document.getElementById('selected-state').textContent==='Demande enregistrée · en attente'"), "reloaded pending intent"); assert.equal(posts(source).length, 1);
    source.maintenance(true); await page.click("#refresh");
    await waitUntil(() => page.execute("return document.getElementById('status').textContent.includes('indisponible')"), "maintenance feedback");
    assert.equal(posts(source).length, 1); source.maintenance(false); source.complete(); await page.click("#refresh");
    await waitUntil(() => page.execute("return document.getElementById('selected-state').textContent==='Effacement terminé dans l’application'"), "status after restart"); assert.equal(posts(source).length, 1);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});

test("real Chrome: a session replaced during the POST response discards the obsolete view and never resubmits", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate(`/admin/closures?client=${clientId}`); await ready(page); source.changeOnPost(); await confirm(page);
    await waitUntil(() => page.execute("return document.getElementById('client-name').textContent==='Replacement account view' && document.getElementById('prepare').hidden"), "current session status"); assert.equal(posts(source).length, 1);
    assert.equal(await page.execute("return !document.getElementById('confirm-name').textContent && !document.getElementById('confirmation').value && !document.getElementById('confirm-dialog').open"), true);
  } finally { try { await page?.close(); } finally { try { await source.close(); } finally { await driver.close(); } } }
});

test("real Chrome: unactivated mode never reads a target or offers erasure, and private names remain literal", { timeout: 60000 }, async () => {
  const driver = await startWebDriver();
  try {
    for (const enabled of [false, true]) {
      const name = '<img src=x onerror="window.__unsafe=true">', source = await fixture({ enabled, name }); let page;
      try {
        page = await driver.browser({ origin: source.origin, width: 320 }); await page.navigate(`/admin/closures?client=${clientId}`);
        if (!enabled) {
          await waitUntil(() => page.execute("return !document.getElementById('disabled').hidden"), "unactivated erasure");
          assert.equal(source.requests.some(item => item.path === endpoint), false); assert.equal(await page.execute("return document.getElementById('content').hidden && document.getElementById('prepare').hidden"), true);
        } else {
          await ready(page); assert.equal(await page.execute("return document.getElementById('client-name').textContent"), name); await page.click("#prepare"); await page.click("#cancel"); await page.click("[data-jm-language]"); await page.click("#prepare");
          assert.equal(await page.execute("return !window.__unsafe && !document.querySelector('#client-name img') && !document.querySelector('#confirm-name img')"), true);
        }
        assert.equal(posts(source).length, 0);
      } finally { try { await page?.close(); } finally { await source.close(); } }
    }
  } finally { await driver.close(); }
});
