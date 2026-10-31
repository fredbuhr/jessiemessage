import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAppServer } from "../server/index.mjs";

async function fixture(t, enabled) {
  const server = createAppServer(enabled ? { mediaHandler: async () => false } : {});
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

test("HEIC decoder public code is available only with the media feature and its WASM permission stays in the worker", async t => {
  const off = await fixture(t, false), on = await fixture(t, true);
  const paths = ["/heic-decoder-worker.js", "/heic-codec-1.23.5.mjs", "/heic-codec-1.23.5-LICENSE.txt"];
  for (const path of paths) assert.equal((await fetch(off + path)).status, 404, path);
  const worker = await fetch(on + paths[0]); assert.equal(worker.status, 200);
  const policy = worker.headers.get("content-security-policy");
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(policy, /'unsafe-eval'/);
  assert.match(policy, /connect-src 'none'/); assert.match(policy, /worker-src 'none'/);
  assert.equal(worker.headers.get("cache-control"), "no-store");
  assert.equal(hash(Buffer.from(await worker.arrayBuffer())), hash(await readFile(new URL("../public/heic-decoder-worker.js", import.meta.url))));
  const codec = await fetch(on + paths[1]); assert.equal(codec.status, 200);
  assert.match(codec.headers.get("content-type"), /javascript/);
  assert.equal(codec.headers.get("cache-control"), "public, max-age=31536000, immutable");
  const bytes = Buffer.from(await codec.arrayBuffer());
  assert.equal(hash(bytes), hash(await readFile(new URL("../node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs", import.meta.url))));
  assert.doesNotMatch(codec.headers.get("content-security-policy"), /wasm-unsafe-eval/);
  const license = await fetch(on + paths[2]); assert.equal(license.status, 200); assert.ok((await license.text()).length > 100);
  const home = await fetch(on + "/"); assert.doesNotMatch(home.headers.get("content-security-policy"), /unsafe-eval|wasm-unsafe-eval/);
  assert.equal((await fetch(on + "/heic-codec-1.23.5.mjs/extra")).status, 404);
  assert.equal((await fetch(on + paths[1], { method: "POST", body: "x" })).status, 405);
  const head = await fetch(on + paths[1], { method: "HEAD" }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
});
