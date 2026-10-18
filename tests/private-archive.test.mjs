import test from "node:test";
import assert from "node:assert/strict";
import { readPrivateArchive, PRIVATE_ARCHIVE_MAX_BYTES } from "../public/private-archive.js";

const zip = Uint8Array.from([0x50, 0x4b, 3, 4, ...Array(36).fill(17)]);
function response({ chunks = [zip.slice(0, 1), zip.slice(1, 3), zip.slice(3)], length = zip.length, type = "application/zip" } = {}) {
  let cancelled = false, released = false; const used = [...chunks];
  const reader = { async read() { return used.length ? { value: used.shift(), done: false } : { done: true }; }, async cancel() { cancelled = true; }, releaseLock() { released = true; } };
  return { headers: new Headers({ "Content-Length": String(length), "Content-Type": type }), body: { getReader: () => reader, async cancel() { cancelled = true; } }, state: () => ({ cancelled, released }), chunks };
}
test("private ZIP reader bounds the transfer, handles split signatures and wipes temporary chunks", async () => {
  const source = response(), result = await readPrivateArchive(source);
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), zip); assert.equal(result.type, "application/zip");
  assert.equal(source.chunks.every(chunk => chunk.every(byte => byte === 0)), true); assert.equal(source.state().released, true);
});
test("invalid size, MIME, signature, truncation and extra bytes cannot become a download", async t => {
  for (const options of [{ length: PRIVATE_ARCHIVE_MAX_BYTES + 1 }, { length: "invalid" }, { type: "text/html" }, { chunks: [zip.slice(0, 6)] }, { length: zip.length - 1 }, { chunks: [Uint8Array.from(Array(40).fill(99))] }]) await t.test(JSON.stringify(options), async () => {
    const source = response(options); await assert.rejects(readPrivateArchive(source)); assert.equal(source.state().cancelled, true);
  });
});
test("an aborted transfer cannot produce a private blob", async () => {
  const controller = new AbortController(); controller.abort(); const source = response();
  await assert.rejects(readPrivateArchive(source, controller.signal)); assert.equal(source.state().cancelled, true);
});
