// Minimal W3C WebDriver client for local-only Chrome rehearsals. No CDP calls,
// npm browser dependency, implicit skip or external network is supported.
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

const transitionHosts = new Set(["jessiemessage.localhost", "recette.jessiemessage.localhost"]);
const crossSiteHosts = new Set(["127.0.0.1", "localhost"]);
function browserOrigin(value) {
  const url = new URL(value);
  if (!transitionHosts.has(url.hostname)) return localOrigin(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("WebDriver requires a fixed HTTPS loopback test alias");
  }
  return url.origin;
}

// Cross-origin rehearsals use one of two fixed HTTPS loopback pairs on one port:
// the transition aliases or 127.0.0.1/localhost for native cross-site cookie tests.
// The WebDriver command transport stays numeric/localhost HTTP loopback only.
export function createWebDriverNavigationPolicy(origin, siblingOrigins = [], primaryFixturePort = null) {
  if (primaryFixturePort !== null && (!Number.isSafeInteger(primaryFixturePort) || primaryFixturePort < 1024
    || primaryFixturePort > 65535 || origin !== "https://jessiemessage.com" || !Array.isArray(siblingOrigins) || siblingOrigins.length)) {
    throw new Error("Primary rehearsal requires one fixed authority mapped to an explicit loopback port");
  }
  const base = primaryFixturePort === null ? browserOrigin(origin) : origin, parsed = new URL(base);
  if (!Array.isArray(siblingOrigins) || siblingOrigins.length > 1) throw new Error("WebDriver requires a bounded sibling-origin allowlist");
  const origins = new Set([base]);
  for (const sibling of siblingOrigins) {
    const selected = browserOrigin(sibling), url = new URL(selected);
    const fixedPair = transitionHosts.has(parsed.hostname) && transitionHosts.has(url.hostname)
      || crossSiteHosts.has(parsed.hostname) && crossSiteHosts.has(url.hostname);
    if (!fixedPair || parsed.protocol !== "https:" || url.protocol !== "https:"
      || parsed.hostname === url.hostname || url.port !== parsed.port) throw new Error("WebDriver sibling navigation requires a fixed HTTPS loopback pair on one port");
    origins.add(selected);
  }
  return Object.freeze({ origin: base, transitionAlias: transitionHosts.has(parsed.hostname),
    primaryFixturePort, resolverRules: primaryFixturePort === null ? null
      : "MAP jessiemessage.com 127.0.0.1:" + primaryFixturePort + ", MAP * ~NOTFOUND", url(path) {
    const url = new URL(path, base);
    if (!origins.has(url.origin) || url.username || url.password) throw new Error("WebDriver navigation must stay on its allowed loopback origins");
    return url.href;
  } });
}

function commandRoute(path) {
  if (path === "/status" || path === "/session") return path;
  const match = typeof path === "string" && /^\/session\/[^/?#]+(\/.*)?$/.exec(path);
  const suffix = match?.[1] ?? "";
  if (match && ["", "/timeouts", "/element", "/url", "/cookie", "/actions", "/execute/sync", "/execute/async", "/screenshot"].includes(suffix)) return `/session/:session${suffix}`;
  const element = /^\/element\/[^/?#]+\/(click|clear|value)$/.exec(suffix);
  if (match && element) return `/session/:session/element/:element/${element[1]}`;
  throw new Error("Unsupported WebDriver command");
}

// Export only the local transport seam so failures can be exercised without
// starting Chrome or connecting to the authentication fixture's database.
export function createWebDriverRequester(driverUrl, fetchRequest = globalThis.fetch) {
  const origin = localOrigin(driverUrl);
  if (!origin.startsWith("http:") || typeof fetchRequest !== "function") throw new Error("WebDriver requires an HTTP loopback transport");
  return async (method, path, body) => {
    if (!["GET", "POST", "DELETE"].includes(method)) throw new Error("Unsupported WebDriver method");
    const label = `WebDriver ${method} ${commandRoute(path)}`;
    let response, data;
    try {
      // A cold Chrome process can take longer than an ordinary command on CI.
      // Keep that allowance specific to session creation; commands stay bounded.
      const deadline = method === "POST" && path === "/session" ? 45000 : 25000;
      response = await fetchRequest(`${origin}${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(deadline) });
      data = await response.json();
    } catch (error) {
      // Transport errors can contain URLs or request details. Preserve only a
      // fixed failure category and the route template, never their raw cause.
      throw new Error(`${label}: ${error?.name === "TimeoutError" ? "request timed out" : "request unavailable"}`);
    }
    // Driver messages can echo typed credentials / cookie values. Keep failure
    // diagnostics to protocol metadata; never print requests or response bodies.
    if (!response.ok || data?.value?.error) throw new Error(`${label}: command failed (HTTP ${response.status})`);
    return data?.value;
  };
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

  const request = createWebDriverRequester(driverUrl);
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
    async browser({ origin, siblingOrigins = [], width = 1280, height = width < 800 ? 844 : 900, acceptInsecureCerts = false, primaryFixturePort = null } = {}) {
      if (closed) throw new Error("WebDriver already closed");
      const navigation = createWebDriverNavigationPolicy(origin, siblingOrigins, primaryFixturePort), baseUrl = navigation.origin;
      if (acceptInsecureCerts && !baseUrl.startsWith("https:")) throw new Error("Insecure test certificates require HTTPS loopback");
      const value = await request("POST", "/session", { capabilities: { alwaysMatch: { browserName: "chrome", acceptInsecureCerts, "goog:chromeOptions": {
        binary: chromeBin, args: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-sync", "--no-first-run", "--lang=fr-FR", "--window-size=1280,900", ...(navigation.resolverRules ? ["--no-proxy-server", "--host-resolver-rules=" + navigation.resolverRules] : navigation.transitionAlias ? ["--no-proxy-server", "--host-resolver-rules=MAP jessiemessage.localhost 127.0.0.1, MAP recette.jessiemessage.localhost 127.0.0.1, MAP * ~NOTFOUND"] : [])],
        prefs: { "intl.accept_languages": "fr-FR,fr" },
        ...(width < 800 ? { mobileEmulation: { deviceMetrics: { width, height, pixelRatio: 1, mobile: true, touch: true } } } : {})
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
          return request("POST", `${endpoint}/url`, { url: navigation.url(path) });
        },
        async click(selector) { await request("POST", `${endpoint}/element/${await find(selector)}/click`, {}); },
        async type(selector, text) {
          const element = await find(selector);
          await request("POST", `${endpoint}/element/${element}/clear`, {});
          await request("POST", `${endpoint}/element/${element}/value`, { text });
        },
        cookies: () => request("GET", `${endpoint}/cookie`),
        screenshot: () => request("GET", `${endpoint}/screenshot`),
        key: (key) => request("POST", `${endpoint}/actions`, { actions: [{ type: "key", id: "keyboard", actions: [{ type: "keyDown", value: key }, { type: "keyUp", value: key }] }] }),
        swipe: (startX, startY, endX, endY) => {
          if (![startX,startY,endX,endY].every(value => Number.isInteger(value) && value >= 0 && value <= 10000)) throw new TypeError("Bounded viewport coordinates required");
          return request("POST", `${endpoint}/actions`, { actions: [{ type: "pointer", id: "touch", parameters: { pointerType: "touch" }, actions: [
            { type: "pointerMove", duration: 0, x: startX, y: startY }, { type: "pointerDown", button: 0 },
            { type: "pointerMove", duration: 250, x: endX, y: endY }, { type: "pointerUp", button: 0 }
          ] }] });
        },
        pinch: (centerX, centerY, startSpread, endSpread) => {
          const coordinates=[centerY,centerX-startSpread,centerX+startSpread,centerX-endSpread,centerX+endSpread];
          if (![centerX,centerY,startSpread,endSpread].every(Number.isInteger) || startSpread<1 || endSpread<1
            || !coordinates.every(value=>value>=0&&value<=10000)) throw new TypeError("Bounded viewport coordinates required");
          return request("POST", `${endpoint}/actions`, { actions: [-1,1].map((direction,index)=>({type:"pointer",id:`pinch-${index}`,parameters:{pointerType:"touch"},actions:[
            {type:"pointerMove",duration:0,x:centerX+direction*startSpread,y:centerY},{type:"pointerDown",button:0},
            {type:"pointerMove",duration:500,x:centerX+direction*endSpread,y:centerY},{type:"pointerUp",button:0}
          ]})) });
        },
        close: closeSession
      };
    }
  };
}
