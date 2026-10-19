import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const names = ["backups.html", "backups.js", "backups.css", "readiness.css", "readiness-model.js", "i18n.js", "i18n-backups.js", "i18n.css", "session-clock.js", "brand/brand.css", "brand/icon-128.png", "favicon.ico", "manifest.webmanifest"];
async function fixture(controlClock = false, paired = false) {
  const resources = new Map(await Promise.all(names.map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  const id = "1".repeat(32), csrf = "A".repeat(43), requests = []; let sessionChanged = false, changeOnKit = false;
  let destination = { id: "2".repeat(32), label: "PC personnel", kind: "computer", enabled: true, paired: false, pairedAt: null, pairingExpiresAt: null, lastSeenAt: null, lastReceipt: null };
  let latestArchive = { id: "capture-1792340000000-cccccccccccccccc", startedAt: 1792340000000, bytes: 1000, sha256: "a".repeat(64) }, scheduleEnabled = true;
  if (paired) destination = { ...destination, paired: true, pairedAt: 1792340000000, lastSeenAt: 1792340300000,
    lastReceipt: { captureId: "capture-1792340000000-cccccccccccccccc", bytes: 1000, sha256: "a".repeat(64), receivedAt: 1792340300000 } };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname; let text = "";
    for await (const chunk of request) text += chunk;
    requests.push({ path, method: request.method, text });
    const send = (status, type, body) => { response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(body); };
    const json = body => send(200, "application/json", JSON.stringify(body));
    if (path === "/__fixture") return send(200, "text/html", "<!doctype html><title>Local fixture</title>");
    if (path === "/session-clock.js" && controlClock) return send(200, "text/javascript", "globalThis.JessieSessionClock={scheduleSessionCheck(expiry,callback){window.__sessionCheck=callback;return()=>{};}};");
    if (path === "/api/auth/session") return json({ user: { id, role: "admin", pseudonym: "Synthetic" }, csrf: sessionChanged ? "C".repeat(43) : csrf, expiresAt: Date.now() + 3600000 });
    if (path === "/api/admin/backups") return json({ version: 1, checkedAt: Date.now(), archiveCount: latestArchive ? 2 : 0, latestArchive, schedule: { enabled: scheduleEnabled, hourUtc: 5, minuteUtc: 15 }, destinations: destination ? [destination] : [], decryptionStatus: "not_checked" });
    if (path.endsWith("/settings")) { destination = { ...destination, ...JSON.parse(text) }; return json({}); }
    if (path.endsWith("/windows-kit") || path.endsWith("/windows-update-kit")) { if (changeOnKit) sessionChanged = true; return send(200, "application/zip", "PK synthetic kit"); }
    if (path.endsWith("/verification-kit")) { if (changeOnKit) sessionChanged = true; return send(200, "application/zip", "PK synthetic verification kit"); }
    if (path.endsWith("/revoke")) { destination = null; return json({ revoked: true }); }
    if (path === "/admin/backups") return send(200, "text/html", resources.get("/backups.html"));
    if (resources.has(path)) return send(200, path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "application/octet-stream", resources.get(path));
    send(404, "application/json", "{}");
  });
  await new Promise(yes => server.listen(0, "127.0.0.1", yes));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, changeOnKit() { changeOnKit = true; }, changeSession() { sessionChanged = true; destination.label = "Second session"; },
    changeReceipt() { destination.lastReceipt.bytes = 999; },
    pauseSchedule() { scheduleEnabled = false; }, removeArchive() { latestArchive = null; },
    async close() { server.closeAllConnections(); await new Promise(yes => server.close(yes)); } };
}
test("real Chrome: backup destinations, keyboard controls, translations and kit download at three widths", { timeout: 150000 }, async t => {
  const driver = await startWebDriver();
  try {
    for (const language of ["fr", "en"]) for (const width of [320, 375, 1280]) await t.test(`${language} ${width}px`, async () => {
      const source = await fixture(); let page;
      try {
        page = await driver.browser({ origin: source.origin, width });
        await page.navigate("/__fixture"); await page.execute("sessionStorage.setItem('jessiemessage.language',arguments[0])", language); await page.navigate("/admin/backups");
        await waitUntil(() => page.execute("return !document.getElementById('backup-content').hidden && document.querySelectorAll('.destination').length === 1"), "private destinations");
        assert.equal(await page.execute("return document.querySelector('h1').textContent"), language === "fr" ? "Sauvegardes" : "Backups");
        assert.equal(await page.execute("return document.getElementById('recovery-title').textContent"), language === "fr" ? "En cas de panne du site" : "If the site goes down");
        assert.equal(await page.execute("return document.querySelector('.recovery-help').textContent.includes(arguments[0])", language === "fr" ? "encore en préparation" : "still being prepared"), true);
        assert.equal(await page.execute("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && [...document.querySelectorAll('.backup-actions button')].every(b => b.getBoundingClientRect().height >= 44)"), true);
        await tabUntil(page, '[data-action="toggle"]'); await page.key("\uE007");
        await waitUntil(() => page.execute("return document.querySelector('.copy-badge')?.textContent === arguments[0]", language === "fr" ? "Copies suspendues" : "Copies paused"), "paused status");
        await page.execute("document.addEventListener('click', e => { const a=e.target.closest('a[download]'); if(a){e.preventDefault();window.__kitName=a.download;}})");
        await tabUntil(page, '[data-action="kit"]'); await page.key("\uE007");
        await waitUntil(() => page.execute("return !!window.__kitName"), "explicit kit download");
        assert.equal(await page.execute("return window.__kitName"), "JessieMessage-sauvegardes-Windows.zip");
        assert.equal(source.requests.filter(r => r.path.endsWith("/windows-kit")).length, 1);
        await page.execute("window.__kitName=null");
        await page.click('#backup-technical > summary'); await page.click('#verification-panel > summary');
        await tabUntil(page, '#verify-archive'); await page.key("\uE007");
        await waitUntil(() => page.execute("return window.__kitName === 'JessieMessage-verifier-Windows.zip'"), "offline verification download");
        const verification = source.requests.filter(r => r.path.endsWith("/verification-kit")); assert.equal(verification.length, 1);
        assert.deepEqual(JSON.parse(verification[0].text), { captureId: "capture-1792340000000-cccccccccccccccc" });
        assert.equal(await page.execute("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.getElementById('verify-archive').getBoundingClientRect().height >= 44"), true);
        assert.equal(await page.execute("return document.body.textContent.includes('A'.repeat(43)) || Object.keys(localStorage).length > 0"), false);
      } finally { try { await page?.close(); } finally { await source.close(); } }
    });
  } finally { await driver.close(); }
});
test("real Chrome: copied backups show a simple overview and keep technical controls closed", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(); let source, page;
  try {
    source = await fixture(false, true);
    page = await driver.browser({ origin: source.origin, width: 320 }); await page.navigate("/admin/backups");
    await waitUntil(() => page.execute("return document.getElementById('backup-overview-title').textContent === 'La dernière sauvegarde est copiée'"), "confirmed copy overview");
    assert.equal(await page.execute("return ['verification-panel','backup-technical'].every(id=>!document.getElementById(id).open) && !document.querySelector('.destination-settings').open"), true);
    assert.equal(await page.execute("return [...document.querySelectorAll('#backup-overview-details dd')].every(item=>item.getBoundingClientRect().height>0 && item.textContent.includes('2026')) && document.querySelector('.folder-help').getBoundingClientRect().height>0 && document.querySelector('.folder-help').textContent.includes('Bureau')"), true);
    assert.equal(await page.execute("return document.getElementById('verify-archive').getBoundingClientRect().height === 0 && document.querySelector('[data-action=update-kit]').getBoundingClientRect().height === 0"), true);
    assert.equal(source.requests.some(item => item.method !== "GET"), false, "opening the simple page neither re-pairs nor checks decryption");
    const confirmedDate = await page.execute("return document.querySelector('#backup-overview-details > div:last-child dd').textContent");
    await page.click('.destination-settings > summary'); await tabUntil(page, '[data-action="toggle"]'); await page.key("\uE007");
    await waitUntil(() => page.execute("return document.querySelector('.copy-badge').textContent === 'Copies suspendues'"), "pause future copies");
    assert.equal(await page.execute("return document.querySelector('#backup-overview-details > div:last-child dd').textContent"), confirmedDate);
    assert.equal(await page.execute("return document.getElementById('backup-overview-copy').textContent.startsWith('Les copies sont suspendues.') && document.getElementById('backup-overview-title').textContent === 'La dernière sauvegarde est copiée'"), true);
    await page.click('.destination-settings > summary'); await tabUntil(page, '[data-action="toggle"]'); await page.key("\uE007");
    await waitUntil(() => page.execute("return document.querySelector('.copy-badge').textContent === 'Dernière archive copiée'"), "resume future copies");
    source.changeReceipt(); await page.click('#refresh');
    await waitUntil(() => page.execute("return document.getElementById('backup-overview-title').textContent === 'Copie sur le PC en attente'"), "mismatched receipt is not confirmed");
    assert.equal(await page.execute("return document.querySelector('.copy-badge').textContent === 'Copie en attente' && !document.getElementById('backup-overview-copy').textContent.includes('Rien à faire')"), true);
    assert.equal(await page.execute("return document.querySelector('#backup-overview-details > div:last-child dd')?.textContent"), "Aucune copie confirmée");
    source.pauseSchedule(); await page.click('#refresh');
    await waitUntil(() => page.execute("return document.getElementById('backup-schedule-note').textContent === 'La sauvegarde quotidienne est suspendue.'"), "paused capture is explicit");
    source.removeArchive(); await page.click('#refresh');
    await waitUntil(() => page.execute("return document.getElementById('backup-overview-title').textContent === 'Aucune sauvegarde disponible' && document.getElementById('verify-archive').disabled"), "missing archive cannot be verified");
    assert.equal(source.requests.filter(item => item.method !== "GET").length, 2);
    assert.equal(source.requests.filter(item => item.method !== "GET").every(item => item.path.endsWith('/settings')), true);
    await page.execute("Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));JessieI18n.setLanguage('en')");
    assert.equal(await page.execute("return document.getElementById('backup-content').hidden && ['destinations','backup-overview-details','verification-archive-name','pc-tools'].every(id=>document.getElementById(id).textContent==='')"), true);
  } finally { try { await page?.close(); } finally { try { await source?.close(); } finally { await driver.close(); } } }
});
test("real Chrome: a login change during any kit suppresses its download and never repeats the request", { timeout: 90000 }, async () => {
  const driver = await startWebDriver();
  try {
    for (const [selector, suffix] of [['[data-action="kit"]', "/windows-kit"], ["#verify-archive", "/verification-kit"], ['[data-action="update-kit"]', "/windows-update-kit"]]) {
      const source = await fixture(false, selector.includes("update-kit")); source.changeOnKit(); let page;
      try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate("/admin/backups");
    await waitUntil(() => page.execute("return !document.getElementById('backup-content').hidden"), "initial session");
    await page.execute("document.addEventListener('click',e=>{if(e.target.closest('a[download]')){e.preventDefault();window.__downloaded=true;}})");
    if (selector === '#verify-archive') { await page.click('#backup-technical > summary'); await page.click('#verification-panel > summary'); }
    if (selector.includes('update-kit')) await page.click('#backup-technical > summary');
    await tabUntil(page, selector); await page.key("\uE007");
    await waitUntil(() => page.execute("return !document.getElementById('backup-content').hidden && document.getElementById('backup-status').textContent.length > 0 && !document.querySelector('[data-action=kit]').disabled"), "fresh session after rejected old response");
    assert.equal(await page.execute("return !!window.__downloaded"), false); assert.equal(source.requests.filter(r => r.path.endsWith(suffix)).length, 1);
      } finally { try { await page?.close(); } finally { await source.close(); } }
    }
  } finally { await driver.close(); }
});
test("real Chrome: periodic proof replaces private settings after another login without a mutation", { timeout: 60000 }, async () => {
  const driver = await startWebDriver(), source = await fixture(true); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 375 }); await page.navigate("/admin/backups");
    await waitUntil(() => page.execute("return !!window.__sessionCheck && !document.getElementById('backup-content').hidden"), "periodic session proof armed");
    source.changeSession(); await page.execute("window.__sessionCheck()");
    await waitUntil(() => page.execute("return document.querySelector('.destination h3')?.textContent === 'Second session'"), "settings from proved replacement login");
    assert.equal(source.requests.some(request => request.method !== "GET"), false);
  } finally {
    try { await page?.close(); }
    finally { try { await source.close(); } finally { await driver.close(); } }
  }
});

test("real Chrome: updating a paired PC is explicit, translated and does not start a new pairing", { timeout: 90000 }, async () => {
  const driver = await startWebDriver();
  try {
    for (const language of ["fr", "en"]) {
      const source = await fixture(false, true); let page;
      try {
        page = await driver.browser({ origin: source.origin, width: 320 });
        await page.navigate("/__fixture"); await page.execute("sessionStorage.setItem('jessiemessage.language',arguments[0])", language); await page.navigate("/admin/backups");
        await waitUntil(() => page.execute("return !!document.querySelector('[data-action=update-kit]')"), "paired PC update control");
        assert.equal(source.requests.some(r => r.method !== "GET"), false);
        await page.execute("document.addEventListener('click',e=>{const a=e.target.closest('a[download]');if(a){e.preventDefault();window.__kitName=a.download;}})");
        await page.click("#backup-technical > summary");
        assert.equal(await page.execute("return document.querySelector('[data-action=update-kit]').textContent"), language === "fr" ? "Mettre à jour le PC" : "Update this PC");
        await tabUntil(page, '[data-action="update-kit"]'); await page.key("\uE007");
        await waitUntil(() => page.execute("return window.__kitName === 'JessieMessage-mise-a-jour-Windows.zip'"), "PC update ZIP");
        assert.equal(source.requests.filter(r => r.path.endsWith("/windows-update-kit")).length, 1);
        assert.equal(source.requests.some(r => r.path.endsWith("/windows-kit")), false);
        assert.equal(await page.execute("return document.getElementById('backup-status').textContent.includes('Mettre-a-jour.cmd') && !document.getElementById('backup-status').textContent.includes('Installer.cmd')"), true);
        await page.click('.destination-settings > summary');
        assert.equal(await page.execute("return document.querySelector('.pairing-panel').open"), false, "changing devices stays separate from ordinary settings");
        await page.click('.pairing-panel > summary'); await tabUntil(page, '[data-action="kit"]');
        assert.equal(await page.execute("return document.querySelector('[data-action=kit]').textContent"), language === "fr" ? "Télécharger le kit pour un autre PC" : "Download the kit for another PC");
        assert.equal(source.requests.some(r => r.path.endsWith("/windows-kit")), false, "opening the change-device help does not reconnect the PC");
        assert.equal(await page.execute("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), true);
      } finally { try { await page?.close(); } finally { await source.close(); } }
    }
  } finally { await driver.close(); }
});
