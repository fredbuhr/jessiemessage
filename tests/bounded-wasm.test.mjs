import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { boundWasmMemory } from "../server/media/bounded-wasm.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const header = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const source = Buffer.concat([header, Buffer.from([5, 6, 1, 1, 1, 128, 128, 2, 7, 5, 1, 1, 109, 2, 0])]);
const target = Buffer.concat([header, Buffer.from([5, 5, 1, 1, 1, 128, 64, 7, 5, 1, 1, 109, 2, 0])]);
const options = { expectedSha256: hash(source), expectedBoundedSha256: hash(target), expectedMinimumPages: 1, expectedMaximumPages: 32768 };
const unavailable = error => error.code === "MEDIA_UNAVAILABLE" && error.message === "Photo conversion unavailable.";

test("the pinned memory transform preserves code/exports and enforces a physical 512 MiB maximum", () => {
  const before = Buffer.from(source), bounded = boundWasmMemory(source, options);
  assert.deepEqual(source, before); assert.deepEqual(bounded, target);
  const original = new WebAssembly.Instance(new WebAssembly.Module(source));
  const limited = new WebAssembly.Instance(new WebAssembly.Module(bounded));
  assert.deepEqual(WebAssembly.Module.exports(new WebAssembly.Module(bounded)), WebAssembly.Module.exports(new WebAssembly.Module(source)));
  assert.equal(original.exports.m.buffer.byteLength, 65536); assert.equal(limited.exports.m.buffer.byteLength, 65536);
  assert.throws(() => limited.exports.m.grow(8192), RangeError);
});

test("unknown hashes, memory layouts, bounds, shared/memory64 or imported memories fail closed", () => {
  for (const invalid of [{ expectedSha256: "0".repeat(64) }, { expectedBoundedSha256: "0".repeat(64) }, { expectedMinimumPages: 2 },
    { expectedMaximumPages: 65536 }, { maximumPages: 8193 }, { maximumPages: 32768 }, { maximumPages: 0 }]) {
    assert.throws(() => boundWasmMemory(source, { ...options, ...invalid }), unavailable);
  }
  for (const flags of [0, 3, 5]) {
    const unknown = Buffer.from(source); unknown[11] = flags;
    assert.throws(() => boundWasmMemory(unknown, { ...options, expectedSha256: hash(unknown) }), unavailable);
  }
  for (const unknown of [header, source.subarray(0, -1), Buffer.from("private-secret"), Buffer.alloc(0)]) {
    assert.throws(() => boundWasmMemory(unknown, { ...options, expectedSha256: hash(unknown) }), unavailable);
  }
});

test("the installed AVIF module has the expected original and bounded hashes and retains its minimum", async () => {
  const location = new URL("./decode.wasm", import.meta.resolve("@phenomen/libavif-wasm/decode"));
  const bytes = await readFile(location);
  const bounded = boundWasmMemory(bytes, { expectedSha256: "10cd87f2c5cd865a3c4fcfde30cc9611387bebe91e4eae7d62b62ef17c27279e",
    expectedMinimumPages: 256, expectedMaximumPages: 32768, maximumPages: 8192,
    expectedBoundedSha256: "466508b384cd81c60dd8fb490f17e986bdd88bf56ebf47ae396ca34aac246436" });
  assert.equal(bounded.length, bytes.length - 1);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(bounded)), WebAssembly.Module.imports(new WebAssembly.Module(bytes)));
});
