import test from "node:test";
import assert from "node:assert/strict";
import { readVideoArchive, VIDEO_ARCHIVE_MAX_BYTES, readPrivateArchive } from "../public/private-archive.js";
import { createZipStream } from "../server/chat/zip-stream.mjs";

const stream = createZipStream([{ name: "Conversation.html", bytes: 4, open: async () => ({ source: (async function* () { yield Buffer.from("test"); })(), close: async () => {} }) }]);
const parts = []; for await (const chunk of stream.stream()) parts.push(chunk);
const zip = Buffer.concat(parts);
function response({ bytes = zip, length = null, type = "application/zip", chunks = null, read = null } = {}) {
  const data = chunks ?? [Uint8Array.from(bytes.subarray(0, 1)), Uint8Array.from(bytes.subarray(1, 3)), Uint8Array.from(bytes.subarray(3))];
  let index = 0, cancelled = false, released = false;
  const headers = new Headers({ "Content-Type": type }); if (length !== null) headers.set("Content-Length", String(length));
  const reader = { read: async () => read ? read(index++) : index < data.length ? { done: false, value: data[index++] } : { done: true },
    cancel: async () => { cancelled = true; }, releaseLock: () => { released = true; } };
  return { headers, body: { getReader: () => reader, cancel: reader.cancel }, data, state: () => ({ cancelled, released }) };
}
test("video ZIP streaming accepts an omitted length and preserves the exact completed archive", async () => {
  const source = response(), blob = await readVideoArchive(source);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), zip); assert.equal(blob.type, "application/zip");
  assert.equal(source.state().released, true); assert.ok(source.data.every(chunk => chunk.every(byte => byte === 0)));
});
test("declared video ZIP lengths are exact and the historical photo reader still requires one", async () => {
  assert.equal((await readVideoArchive(response({ length: zip.length }))).size, zip.length);
  await assert.rejects(readPrivateArchive(response()), /invalid_archive/);
  await assert.rejects(readVideoArchive(response({ length: 33 * 1024 * 1024 })), /incomplete_archive/);
  assert.equal(VIDEO_ARCHIVE_MAX_BYTES, 268435456);
});
test("oversize, invalid MIME, truncation, invalid end record and extra bytes never become a video download", async t => {
  const badEnd = Buffer.from(zip); badEnd.writeUInt32LE(1, badEnd.length - 10);
  for (const options of [{ length: VIDEO_ARCHIVE_MAX_BYTES + 1 }, { length: "invalid" }, { length: "01" }, { type: "text/html" },
    { bytes: zip.subarray(0, zip.length - 1) }, { bytes: Buffer.concat([zip, Buffer.from([1])]) }, { bytes: badEnd }, { length: zip.length - 1 }, { length: zip.length + 1 }]) {
    await t.test(JSON.stringify(Object.keys(options)), async () => { const source = response(options); await assert.rejects(readVideoArchive(source)); assert.equal(source.state().cancelled, true); });
  }
});
test("ZIP streaming bounds chunk bookkeeping even when a hostile stream sends empty chunks", async () => {
  const source = response({ read: async () => ({ done: false, value: new Uint8Array() }) });
  await assert.rejects(readVideoArchive(source), /archive_too_large/); assert.equal(source.state().cancelled, true);
});
test("aborting a pending read cancels the reader immediately and never yields a download", async () => {
  const controller = new AbortController(); let release;
  const source = response({ read: () => new Promise(resolve => { release = resolve; }) });
  const result = readVideoArchive(source, controller.signal); await Promise.resolve(); controller.abort();
  assert.equal(source.state().cancelled, true); release({ done: true });
  await assert.rejects(result, /archive_cancelled/); assert.equal(source.state().released, true);
});
