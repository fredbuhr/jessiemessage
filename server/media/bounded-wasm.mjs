import { createHash } from "node:crypto";

const fail = () => { throw Object.assign(new Error("Photo conversion unavailable."), { code: "MEDIA_UNAVAILABLE" }); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function uint(bytes, offset) {
  let value = 0, shift = 0;
  for (let index = 0; index < 5; index++, shift += 7) {
    if (offset >= bytes.length) fail();
    const byte = bytes[offset++]; value += (byte & 127) * 2 ** shift;
    if (!(byte & 128)) { if (value > 0xffffffff) fail(); return [value, offset]; }
  }
  fail();
}
function encoded(value) {
  const bytes = [];
  do { const byte = value & 127; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}

// Only a pinned, non-shared wasm32 module with one defined memory is accepted.
// No instruction/import/export changes: lower its engine-enforced maximum.
export function boundWasmMemory(bytes, { expectedSha256, expectedMinimumPages, expectedMaximumPages,
  maximumPages = 8192, expectedBoundedSha256 } = {}) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
      || ![expectedSha256, expectedBoundedSha256].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))
      || ![expectedMinimumPages, expectedMaximumPages, maximumPages].every(Number.isSafeInteger)
      || expectedMinimumPages < 1 || maximumPages < expectedMinimumPages || maximumPages > 8192
      || maximumPages >= expectedMaximumPages || expectedMaximumPages > 65536 || digest(bytes) !== expectedSha256) fail();
    const chunks = [bytes.subarray(0, 8)]; let offset = 8, memories = 0;
    while (offset < bytes.length) {
      const start = offset, kind = bytes[offset++]; let length;
      [length, offset] = uint(bytes, offset);
      const end = offset + length; if (end > bytes.length) fail();
      if (kind !== 5) chunks.push(bytes.subarray(start, end));
      else {
        if (++memories !== 1) fail();
        const payload = bytes.subarray(offset, end); let cursor = 0, count, flags, minimum, maximum;
        [count, cursor] = uint(payload, cursor); [flags, cursor] = uint(payload, cursor);
        [minimum, cursor] = uint(payload, cursor); [maximum, cursor] = uint(payload, cursor);
        if (count !== 1 || flags !== 1 || minimum !== expectedMinimumPages || maximum !== expectedMaximumPages || cursor !== payload.length) fail();
        const bounded = Buffer.concat([encoded(count), encoded(flags), encoded(minimum), encoded(maximumPages)]);
        chunks.push(Buffer.from([5]), encoded(bounded.length), bounded);
      }
      offset = end;
    }
    if (memories !== 1 || WebAssembly.Module.imports(new WebAssembly.Module(bytes)).some(entry => entry.kind === "memory")) fail();
    const result = Buffer.concat(chunks);
    if (digest(result) !== expectedBoundedSha256) fail();
    return result;
  } catch { fail(); }
}
