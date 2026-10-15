// Minimal W3C WebDriver client for local-only Chrome rehearsals. No CDP calls,
// npm browser dependency, implicit skip or production origin is supported.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const elementKey = "element-6066-11e4-a52e-4f735466cecf";

export async function waitUntil(check, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  do { if (await check()) return; await delay(100); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}

export async function tabUntil(page, selector) {
  for (let count = 0; count < 45; count += 1) {
    await page.key("\uE004");
    if (await page.execute("return document.activeElement?.matches(arguments[0])", selector)) return;
  }
  const active = await page.execute("return {tag: document.activeElement?.tagName, id: document.activeElement?.id}");
  assert.fail(`Real Tab navigation did not reach ${selector}; active element: ${JSON.stringify(active)}`);
}

async function freePort() {
  const socket = createServer();
  await new Promise((resolveReady, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolveReady); });
  const port = socket.address().port;
  await new Promise((resolveClosed) => socket.close(resolveClosed));
  return port;
}
async function executable(candidate, label) {
  try { await access(candidate, constants.X_OK); if (!(await stat(candidate)).isFile()) throw new Error(); }
  catch { throw new Error(`${label} unavailable. Install Chrome and ChromeDriver, and set CHROME_BIN / CHROMEWEBDRIVER; browser tests never skip this prerequisite.`); }
  return candidate;
}
function localOrigin(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("WebDriver requires a loopback test origin");
  return url.origin;
}

// The driver can create Chrome before POST /session returns its session id.
// Killing only the driver then leaves descendants holding its output pipes.
// Keep ownership in this closure: callers cannot supply a PID or process group.
export function spawnWebDriverProcess(command, args) {
  const grouped = process.platform === "linux";
  const child = spawn(command, args, { detached: grouped, stdio: ["ignore", "pipe", "pipe"] });
  const pid = child.pid;
  const owned = Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid;
  let exited = false, pipesClosed = false, closing;
  child.once("error", () => { if (!owned) exited = true; });
  child.once("exit", () => { exited = true; });
  child.once("close", () => { pipesClosed = true; });
  const present = () => {
    if (!owned) return false;
    if (!grouped) return !exited;
    try { process.kill(-pid, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; throw error; }
  };
  const signal = (name) => {
    if (!owned) return;
    try { if (grouped) process.kill(-pid, name); else if (!exited) child.kill(name); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const waitFor = async (condition, milliseconds) => {
    const deadline = Date.now() + milliseconds;
    while (!condition()) {
      if (Date.now() >= deadline) return false;
      await delay(Math.min(25, deadline - Date.now()));
    }
    return true;
  };
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      try {
        signal("SIGTERM");
        if (!await waitFor(() => !present(), 3000)) signal("SIGKILL");
        // A dead descendant may remain a zombie until its new parent reaps it;
        // wait for our own child and inherited stdio closure, rather than
        // treating kill(group, 0) as proof that a member is still executing.
        if (!await waitFor(() => exited && pipesClosed, 1000)) throw new Error();
      } catch {
        throw new Error("WebDriver process cleanup could not be completed");
      } finally {
        // Escaped/crashed descendants must not keep the test runner alive by
        // retaining inherited pipe handles after the bounded teardown.
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
      }
    })();
    return closing;
  };
  return { child, close };
}

export async function startWebDriver() {
  let driverPath = process.env.CHROMEWEBDRIVER ?? "/usr/local/share/chromedriver-linux64";
  if ((await stat(driverPath).catch(() => null))?.isDirectory()) driverPath = join(driverPath, "chromedriver");
  await executable(driverPath, "ChromeDriver");
  const chromeBin = await executable(process.env.CHROME_BIN ?? "/usr/bin/google-chrome", "Chrome");
  const port = await freePort();
  const driverUrl = `http://127.0.0.1:${port}`;
  const sessions = new Set();
  let driverLog = "", driverExited = false, closed = false;
  const processOwner = spawnWebDriverProcess(driverPath, [`--port=${port}`, "--allowed-ips=127.0.0.1"]);
  const { child } = processOwner;
  const capture = (chunk) => { driverLog = (driverLog + chunk.toString()).slice(-8000); };
  child.stdout.on("data", capture); child.stderr.on("data", capture);
  child.on("error", (error) => { driverExited = true; capture(error.message); });
  child.on("exit", () => { driverExited = true; });

  async function request(method, path, body) {
    const response = await fetch(`${driverUrl}${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) });
    const data = await response.json();
    // Driver messages can echo typed credentials / cookie values. Keep failure
    // diagnostics to protocol metadata; never print requests or response bodies.
    if (!response.ok || data.value?.error) throw new Error(`WebDriver ${method} ${path}: ${data.value?.error ?? response.status}`);
    return data.value;
  }
  async function close() {
    if (closed) return; closed = true;
    for (const sessionId of sessions) { try { await request("DELETE", `/session/${sessionId}`); } catch {} }
    sessions.clear();
    await processOwner.close();
  }
  try {
    await waitUntil(async () => {
      if (driverExited) throw new Error(`ChromeDriver exited before readiness: ${driverLog}`);
      try { return (await request("GET", "/status"))?.ready === true; } catch { return false; }
    }, "ChromeDriver startup", 15000);
  } catch (error) { await close(); throw error; }

  return {
    close,
    async browser({ origin, width = 1280, acceptInsecureCerts = false } = {}) {
      if (closed) throw new Error("WebDriver already closed");
      const baseUrl = localOrigin(origin);
      if (acceptInsecureCerts && !baseUrl.startsWith("https:")) throw new Error("Insecure test certificates require HTTPS loopback");
      const value = await request("POST", "/session", { capabilities: { alwaysMatch: { browserName: "chrome", acceptInsecureCerts, "goog:chromeOptions": {
        binary: chromeBin, args: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-sync", "--no-first-run", "--lang=fr-FR", "--window-size=1280,900"],
        prefs: { "intl.accept_languages": "fr-FR,fr" },
        ...(width < 800 ? { mobileEmulation: { deviceMetrics: { width, height: 844, pixelRatio: 1, mobile: true, touch: true } } } : {})
      } } } });
      const sessionId = value.sessionId; assert.ok(sessionId, "W3C session id"); sessions.add(sessionId);
      const endpoint = `/session/${sessionId}`;
      const closeSession = async () => { if (!sessions.has(sessionId)) return; try { await request("DELETE", endpoint); } finally { sessions.delete(sessionId); } };
      const find = async (selector) => (await request("POST", `${endpoint}/element`, { using: "css selector", value: selector }))[elementKey];
      try { await request("POST", `${endpoint}/timeouts`, { implicit: 0, pageLoad: 20000, script: 10000 }); }
      catch (error) { await closeSession(); throw error; }
      return {
        execute: (script, ...args) => request("POST", `${endpoint}/execute/sync`, { script, args }),
        executeAsync: (script, ...args) => request("POST", `${endpoint}/execute/async`, { script, args }),
        navigate: (path) => {
          const url = new URL(path, baseUrl); if (url.origin !== baseUrl) throw new Error("WebDriver navigation must stay on its loopback origin");
          return request("POST", `${endpoint}/url`, { url: url.href });
        },
        async click(selector) { await request("POST", `${endpoint}/element/${await find(selector)}/click`, {}); },
        async type(selector, text) {
          const element = await find(selector);
          await request("POST", `${endpoint}/element/${element}/clear`, {});
          await request("POST", `${endpoint}/element/${element}/value`, { text });
        },
        cookies: () => request("GET", `${endpoint}/cookie`),
        key: (key) => request("POST", `${endpoint}/actions`, { actions: [{ type: "key", id: "keyboard", actions: [{ type: "keyDown", value: key }, { type: "keyUp", value: key }] }] }),
        close: closeSession
      };
    }
  };
}
