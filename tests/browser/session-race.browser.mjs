// Native cookie replacement on local HTTPS only; synthetic services/accounts.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";
import { sessionCookie } from "../../server/auth/http.mjs";
import { raceCases, sessionRace, oldToken, newToken } from "../helpers/session-race-fixture.mjs";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

test("real Chrome: late 401 responses preserve the newer native admin/client cookie on every shared surface", { timeout: 90000 }, async () => {
  const driver = await startWebDriver();
  let directory, server, page, active;
  try {
    directory = await mkdtemp(join(tmpdir(), "jessiemessage-session-race-")); await chmod(directory, 0o700);
    const keyPath = join(directory, "key.pem"), certPath = join(directory, "cert.pem");
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1", "-subj", "/CN=jessiemessage.com", "-addext", "subjectAltName=DNS:jessiemessage.com", "-keyout", keyPath, "-out", certPath],
      { timeout: 10000, maxBuffer: 65536, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", OPENSSL_CONF: "/dev/null" } });
    await chmod(keyPath, 0o600); await chmod(certPath, 0o600);
    const seen = [];
    server = createServer({ key: await readFile(keyPath), cert: await readFile(certPath), minVersion: "TLSv1.2" }, async (request, response) => {
      const path = new URL(request.url, "https://jessiemessage.com").pathname;
      if (path === "/fixture") { response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); response.end("<!doctype html><title>Synthetic session race</title>"); return; }
      if (path === "/install-A" || path === "/install-B") {
        response.writeHead(200, { "Set-Cookie": sessionCookie(path === "/install-A" ? oldToken : newToken, Date.now() + 3600000, active.cookie, { role: active.cookie.includes("client") ? "client" : "admin" }), "Cache-Control": "no-store" }); response.end(); return;
      }
      if (path === "/cookie-proof") { seen.push(request.headers.cookie); response.writeHead(200, { "Cache-Control": "no-store" }); response.end(); return; }
      if (!await active.handler(request, response)) { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    page = await driver.browser({ origin: "https://jessiemessage.com", primaryFixturePort: server.address().port, acceptInsecureCerts: true });
    await page.navigate("/fixture");
    for (const item of raceCases) {
      active = sessionRace(item);
      await page.execute("return fetch('/install-A').then(() => true)");
      await page.execute("window.raceStatus=null;fetch(arguments[0]).then(r=>r.arrayBuffer().then(()=>{window.raceStatus=r.status}));return true", active.path);
      await active.arrived;
      await page.execute("return fetch('/install-B').then(() => true)");
      assert.equal((await page.cookies()).find(cookie => cookie.name === active.cookie)?.value, newToken);
      active.release();
      await waitUntil(() => page.execute("return window.raceStatus===401"), `${item.kind}/${item.role} late 401`);
      const cookie = (await page.cookies()).find(cookie => cookie.name === active.cookie);
      assert.equal(cookie?.value, newToken, `${item.kind}/${item.role}: B survives the older response A`);
      assert.equal(cookie.secure && cookie.httpOnly && cookie.sameSite === "Strict", true);
      await page.execute("return fetch('/cookie-proof').then(() => true)");
      assert.ok(seen.at(-1)?.includes(`${active.cookie}=${newToken}`), "the next request carries B");
      active.handler.close?.();
    }
  } finally {
    active?.release(); active?.handler.close?.();
    try { await page?.close(); } finally {
      try { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
      finally { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { await driver.close(); } }
    }
  }
});
