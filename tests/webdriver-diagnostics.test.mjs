import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createWebDriverNavigationPolicy, createWebDriverRequester } from "./browser/webdriver.mjs";

const secret = "synthetic-sensitive-value";

test("WebDriver timeout names the command without disclosing its session, element, body or transport error", async () => {
  let calls = 0;
  const request = createWebDriverRequester("http://127.0.0.1:12345", async (_url, options) => {
    calls += 1;
    assert.equal(options.method, "POST"); assert.ok(options.signal instanceof AbortSignal);
    throw new DOMException(`transport details ${secret}`, "TimeoutError");
  });
  await assert.rejects(request("POST", `/session/${secret}/element/${secret}/value`, { text: secret }), (error) => {
    assert.equal(error.message, "WebDriver POST /session/:session/element/:element/value: request timed out");
    assert.equal(error.cause, undefined); assert.equal(error.stack.includes(secret), false); return true;
  });
  assert.equal(calls, 1, "a timed-out command is never retried");
});

test("WebDriver non-timeout transport failures also discard raw error details", async () => {
  const request = createWebDriverRequester("http://127.0.0.1:12345", async () => { throw new Error(secret); });
  await assert.rejects(request("POST", "/session", { capabilities: { secret } }), { message: "WebDriver POST /session: request unavailable" });
});

test("WebDriver real loopback responses preserve success while protocol failures never echo driver messages", async () => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/status") response.end(JSON.stringify({ value: { ready: true } }));
    else { response.statusCode = 500; response.end(JSON.stringify({ value: { error: secret, message: secret, stacktrace: secret } })); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const request = createWebDriverRequester(`http://127.0.0.1:${server.address().port}`);
    assert.deepEqual(await request("GET", "/status"), { ready: true });
    await assert.rejects(request("POST", `/session/${secret}/url`, { url: `http://127.0.0.1/${secret}` }), (error) => {
      assert.equal(error.message, "WebDriver POST /session/:session/url: command failed (HTTP 500)");
      assert.equal(error.stack.includes(secret), false); return true;
    });
  } finally {
    const closed = new Promise((resolve) => server.close(resolve)); server.closeAllConnections(); await closed;
  }
});

test("WebDriver diagnostic transport refuses non-loopback origins and unsupported commands before fetch", async () => {
  let calls = 0; const fetchRequest = async () => { calls += 1; throw new Error("must not be reached"); };
  for (const origin of ["https://external.example.invalid", "http://127.0.0.1.example.invalid", `http://${secret}@127.0.0.1`, "http://127.0.0.1/path", "http://jessiemessage.localhost:4444"]) {
    assert.throws(() => createWebDriverRequester(origin, fetchRequest));
  }
  const request = createWebDriverRequester("http://127.0.0.1:12345", fetchRequest);
  await assert.rejects(request("POST", `/session/${secret}/unknown?${secret}`), { message: "Unsupported WebDriver command" });
  assert.equal(calls, 0);
});

test("browser navigation permits only its explicit fixed HTTPS loopback sibling on the same port", () => {
  const primary = "https://jessiemessage.localhost:4444", source = "https://recette.jessiemessage.localhost:4444";
  const policy = createWebDriverNavigationPolicy(primary, [source]);
  assert.equal(policy.url("/migration#state=test"), `${primary}/migration#state=test`);
  assert.equal(policy.url(`${source}/migration`), `${source}/migration`);
  assert.equal(policy.transitionAlias, true);
  assert.throws(() => createWebDriverNavigationPolicy(primary).url(source));
  for (const foreign of ["https://jessiemessage.com", "https://recette.jessiemessage.com", "https://other.localhost:4444", "https://127.0.0.1:4444", "http://recette.jessiemessage.localhost:4444", "https://recette.jessiemessage.localhost:5555", `${source}/path`, `https://${secret}@recette.jessiemessage.localhost:4444`]) {
    assert.throws(() => createWebDriverNavigationPolicy(primary, [foreign]));
  }
  assert.throws(() => policy.url("https://jessiemessage.com/migration"));
  assert.throws(() => policy.url(`https://${secret}@jessiemessage.localhost:4444/`));
  assert.throws(() => createWebDriverNavigationPolicy("http://127.0.0.1:4444", [source]));
  assert.throws(() => createWebDriverNavigationPolicy(primary, [source, source]));
  const ordinary = createWebDriverNavigationPolicy("http://127.0.0.1:4444");
  assert.equal(ordinary.url("/app"), "http://127.0.0.1:4444/app");
  assert.throws(() => ordinary.url("http://localhost:4444/app"));
});
