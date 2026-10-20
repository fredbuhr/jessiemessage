// Real readiness markup and scripts with loopback-only synthetic status data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const names = ["readiness.html", "readiness.js", "readiness-model.js", "readiness.css", "i18n.js", "i18n.css", "i18n-readiness.js", "help-link.js", "session-clock.js", "brand/brand.css", "brand/icon-128.png", "brand/icon-32.png", "favicon.ico", "apple-touch-icon.png", "manifest.webmanifest"];
const types = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png", ico: "image/x-icon", webmanifest: "application/manifest+json" };
async function fixture() {
  const resources = new Map(await Promise.all(names.map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  const requests = [], now = Date.now(); let snapshots = 0;
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    requests.push({ path, method: request.method }); response.setHeader("Cache-Control", "no-store");
    const send = (status, type, body) => { response.writeHead(status, { "Content-Type": type }); response.end(body); };
    if (request.method !== "GET") { request.resume(); send(405, "application/json", "{}"); return; }
    if (path === "/__fixture") { send(200, "text/html", "<!doctype html><title>Local fixture</title>"); return; }
    if (path === "/admin/readiness") { send(200, "text/html", resources.get("/readiness.html")); return; }
    if (path === "/api/auth/session") {
      send(200, "application/json", JSON.stringify({ user: { id: "1".repeat(32), role: "admin", pseudonym: "Synthetic operator" }, csrf: "A".repeat(43), expiresAt: now + 3600000 })); return;
    }
    if (path === "/api/admin/readiness") {
      snapshots++;
      const workers = ["verification", "recovery", "broadcasts", "notifications"].map(name => ({ name, state: "idle", lastCompletedAt: now, lastErrorAt: null, consecutiveFailures: 0, processed: 2, failures: 0 }));
      const depth = count => ({ count, truncated: count === 1000 });
      send(200, "application/json", JSON.stringify({ contactEmail: "contact@jessiemessage.com", release: { version: "1.0.0", commit: "b".repeat(40), nodeVersion: "v24.22.0", startedAt: now }, mail: { configured: true, sender: "private-marker@example.invalid", replyTo: "private-marker@example.invalid" },
        features: { clientAccess: true, chat: true, photos: true, clientFiles: false, passwordRecovery: true, broadcasts: false, notifications: true },
        checks: { admissionPolicy: "manual_invitation", ageAssurance: "not_integrated", smtpDelivery: "not_checked", deviceAcceptance: "pending" },
        operations: { status: "ready", database: { state: "ok", checkedAt: now }, workers, queuesCheckedAt: now,
          private: "private-marker", queues: workers.map(({ name }) => ({ name, pending: depth(1000), sending: depth(0), failed: depth(0), oldestDueAt: now - 60000 })) } })); return;
    }
    if (resources.has(path)) { send(200, types[path.split(".").at(-1)] ?? "application/octet-stream", resources.get(path)); return; }
    send(404, "application/json", "{}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, snapshots: () => snapshots,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test("real Chrome: private diagnostic is translated, bounded and downloadable by keyboard on narrow and wide screens", { timeout: 120000 }, async t => {
  const driver = await startWebDriver(); let source;
  try {
    source = await fixture();
    for (const language of ["fr", "en"]) for (const width of [320, 375, 1280]) await t.test(`${language}, ${width}px`, async () => {
      const page = await driver.browser({ origin: source.origin, width });
      try {
        await page.navigate("/__fixture"); await page.execute("sessionStorage.setItem('jessiemessage.language', arguments[0])", language);
        await page.navigate("/admin/readiness");
        await waitUntil(() => page.execute("return !document.getElementById('readiness-content').hidden && !document.getElementById('download-operations').disabled && document.getElementById('operations-workers').children.length === 4"), "all four operations loaded");
        assert.equal(await page.execute("return document.querySelector('h1').textContent"), language === "fr" ? "État du service" : "Service status");
        assert.equal(await page.execute("return document.querySelector('#readiness-content > :first-child').getAttribute('aria-labelledby')"), "operations-title");
        assert.equal(await page.execute("return document.getElementById('operations-title').textContent"), language === "fr" ? "Mesures du serveur" : "Server measurements");
        assert.equal(await page.execute("return document.querySelector('a[href=\"/admin/messages\"]').textContent"), language === "fr" ? "Ouvrir la messagerie" : "Open messaging");
        assert.deepEqual(await page.execute("return {measures:document.getElementById('operations-details').open,manual:document.getElementById('manual-checks').open,downloadVisible:document.getElementById('download-operations').checkVisibility()}"),
          { measures: false, manual: false, downloadVisible: false });
        const beforeOpen = source.snapshots();
        await tabUntil(page, "#manual-checks > summary"); await page.key("\uE007");
        assert.equal(await page.execute("return document.getElementById('manual-checks').open && document.querySelector('#manual-checks .remaining-list').checkVisibility()"), true);
        assert.equal(await page.execute("return document.querySelector('#manual-checks > summary').textContent.trim()"), language === "fr" ? "Contrôles ponctuels" : "Occasional checks");
        await tabUntil(page, "#operations-details > summary"); await page.key("\uE007");
        assert.equal(await page.execute("return document.getElementById('operations-details').open && document.getElementById('download-operations').checkVisibility()"), true);
        assert.equal(source.snapshots(), beforeOpen, "opening optional details needs no new server check");
        const release = await page.execute("return document.getElementById('release-details').textContent");
        assert.ok(release.includes(language === "fr" ? "Version de l’application1.0.0" : "Application version1.0.0"));
        assert.ok(release.includes("b".repeat(40))); assert.ok(release.includes("v24.22.0"));
        assert.equal(await page.execute("return document.getElementById('download-operations').textContent"), language === "fr" ? "Télécharger le diagnostic" : "Download diagnostic");
        assert.equal(await page.execute("const button = document.getElementById('download-operations'); return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && button.getBoundingClientRect().height >= 44 && button.scrollWidth <= button.clientWidth + 1"), true);
        await page.execute(`document.addEventListener('click', event => { const link = event.target.closest('a[download]'); if (!link) return; event.preventDefault(); window.__diagnostic = { name: link.download, text: decodeURIComponent(link.getAttribute('href').split(',').slice(1).join(',')) }; });`);
        const before = source.snapshots();
        await tabUntil(page, "#download-operations"); await page.key("\uE007");
        await waitUntil(() => page.execute("return !!window.__diagnostic"), "prepared plaintext diagnostic download");
        const output = await page.execute("return window.__diagnostic");
        assert.equal(output.name, "JessieMessage-diagnostic.txt");
        assert.ok(output.text.includes(language === "fr" ? "JessieMessage — État du service" : "JessieMessage — Service status"));
        assert.ok(output.text.includes(language === "fr" ? "au moins 1000" : "at least 1000"));
        assert.doesNotMatch(output.text, /private-marker|Synthetic operator|A{43}|1{32}|csrf/);
        assert.equal(source.snapshots(), before + 1, "download uses a fresh cached-server snapshot");
        assert.equal(await page.execute("return document.querySelectorAll('a[download]').length"), 0);
        assert.equal(source.requests.some(request => request.method !== "GET" || request.path.endsWith("/smtp")), false);
        assert.equal(await page.execute("return Object.keys(localStorage).length"), 0);
      } finally { await page.close(); }
    });
  } finally { await source?.close(); await driver.close(); }
});
