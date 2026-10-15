import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createAppServer } from "../server/index.mjs";

const catalogues = ["access", "admin", "chat", "tools", "readiness"];
const decode = (value) => value.replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|lt|gt|quot|apos);/gi,
  (_, numeric, name) => numeric ? String.fromCodePoint(numeric[0].toLowerCase() === "x" ? parseInt(numeric.slice(1), 16) : Number(numeric))
    : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name.toLowerCase()]);

test("all private UI catalogues can coexist and each HTML source has an English translation in its loaded catalogues", async () => {
  const all = new Map(), perCatalogue = new Map();
  for (const name of catalogues) {
    const own = new Map();
    vm.runInNewContext(await readFile(new URL(`../public/i18n-${name}.js`, import.meta.url), "utf8"), {
      JessieI18n: { register(entries) {
        for (const [source, english] of Object.entries(entries)) {
          if (all.has(source)) assert.equal(english, all.get(source), `conflicting translation: ${source}`);
          all.set(source, english); own.set(source, english);
        }
      } },
    });
    perCatalogue.set(name, own);
  }
  assert.ok(all.size > 500);
  for (const [page, names] of [["access", ["access", "tools"]], ["recover", ["access"]], ["admin-login", ["admin"]],
    ["chat", ["chat", "tools"]], ["broadcast", ["tools"]], ["readiness", ["readiness"]]]) {
    const html = await readFile(new URL(`../public/${page}.html`, import.meta.url), "utf8");
    const loaded = new Map(names.flatMap((name) => [...perCatalogue.get(name)]));
    const runtime = html.indexOf('src="/i18n.js"'); assert.ok(runtime >= 0, page);
    for (const name of names) {
      const script = html.indexOf(`src="/i18n-${name}.js"`);
      assert.ok(script > runtime, `${page}: runtime before ${name}`);
      assert.ok(script < html.indexOf(`src="/${page === "admin-login" ? "admin-login" : page}.js"`), `${page}: catalogue before controller`);
    }
    for (const marker of html.matchAll(/data-jm-i18n(?:-aria-label|-title|-placeholder)?="([^"]*)"/g)) {
      const source = decode(marker[1]); assert.equal(typeof loaded.get(source), "string", `${page}: ${source}`);
    }
    assert.match(html, /data-jm-language/); assert.match(html, /href="\/i18n\.css"/);
    assert.doesNotMatch(html, /data-jm-i18n-(?:value|href|src|action)\b/);
  }
});

test("translation assets are public UI only, served without storage or private feature activation", async (t) => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ["i18n.js", "i18n.css", ...catalogues.map((name) => `i18n-${name}.js`)]) {
    const response = await fetch(`${base}/${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal(await response.text(), await readFile(new URL(`../public/${path}`, import.meta.url), "utf8"));
    const head = await fetch(`${base}/${path}`, { method: "HEAD" });
    assert.equal(head.status, 200); assert.equal(await head.text(), "");
  }
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/ready`)).status, 503);
  assert.equal((await fetch(`${base}/access`)).status, 404);
  assert.equal((await fetch(`${base}/admin/login`)).status, 404);
});
