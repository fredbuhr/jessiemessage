import { crc32 } from "node:zlib";

export const MAX_ZIP_STREAM_BYTES = 256 * 1024 * 1024;
export const MAX_ZIP_STREAM_CHUNK_BYTES = 256 * 1024;
export class ZipStreamError extends Error {
  constructor(code = "ZIP_STREAM_UNAVAILABLE") { super("Conversation archive stream unavailable."); this.name = "ZipStreamError"; this.code = code; }
}
const fail = (code) => { throw new ZipStreamError(code); };
const validSignal = (signal) => signal === undefined || signal instanceof AbortSignal;
const namePattern = /^(?:Conversation\.html|conversation\.json|LIRE-MOI\.txt|photos\/[a-f0-9]{32}\.jpg|videos\/[a-f0-9]{32}\.mp4)$(?![\s\S])/;
const FLAGS = 0x0808;
function local(entry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(FLAGS, 6);
  header.writeUInt16LE(0x21, 12); header.writeUInt16LE(entry.name.length, 26);
  return header;
}
function descriptor(entry) {
  const result = Buffer.alloc(16);
  result.writeUInt32LE(0x08074b50); result.writeUInt32LE(entry.crc, 4);
  result.writeUInt32LE(entry.bytes, 8); result.writeUInt32LE(entry.bytes, 12);
  return result;
}
function central(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6);
  header.writeUInt16LE(FLAGS, 8); header.writeUInt16LE(0x21, 14); header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.bytes, 20); header.writeUInt32LE(entry.bytes, 24);
  header.writeUInt16LE(entry.name.length, 28); header.writeUInt32LE(entry.offset, 42);
  return header;
}

/** ZIP32/STORED with known sizes and deferred, sequential sources.
 *
 * Each open({signal}) must return {source: AsyncIterable<Buffer>, close()}.
 * Source buffers transfer to this ZIP and must not be reused by the producer.
 * They are wiped after their independent output copy is consumed or cancelled.
 * Output buffers transfer to the consumer and are never modified by this ZIP.
 * The handle's close must release I/O and unblock a pending next(). Every opened
 * handle is closed exactly once; unopened entries need no cleanup. An opener
 * that rejects retains responsibility for resources it has not handed over.
 */
export function createZipStream(rawEntries, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) fail();
  const { signal, maxBytes = MAX_ZIP_STREAM_BYTES } = options;
  if (!Array.isArray(rawEntries) || !validSignal(signal)
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ZIP_STREAM_BYTES) fail();
  if (rawEntries.length > 65535) fail("ZIP_LIMIT");
  for (let index = 0; index < rawEntries.length; index++) if (!Object.hasOwn(rawEntries, index)) fail();
  const names = new Set(); let offset = 0, directoryBytes = 0;
  const entries = rawEntries.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.name !== "string" || !namePattern.test(raw.name)
      || names.has(raw.name) || !Number.isSafeInteger(raw.bytes) || raw.bytes < 0 || raw.bytes > MAX_ZIP_STREAM_BYTES || typeof raw.open !== "function") fail();
    names.add(raw.name);
    const entry = { name: Buffer.from(raw.name, "ascii"), bytes: raw.bytes, open: raw.open, offset, crc: null };
    offset += 30 + entry.name.length + entry.bytes + 16; directoryBytes += 46 + entry.name.length;
    if (offset + directoryBytes + 22 > maxBytes) fail("ZIP_LIMIT");
    return entry;
  });
  const bytes = offset + directoryBytes + 22, centralOffset = offset;
  if (bytes > maxBytes) fail("ZIP_LIMIT");
  const controller = new AbortController();
  let started = false, closed = false, opening = null, active = null, closing = null, combined, onAbort;
  const check = () => { if (closed || combined?.aborted) fail(); };
  async function stop(record) {
    if (!record) return;
    if (!record.stopping) record.stopping = (async () => {
      let failed = false;
      try { if (typeof record.handle?.close === "function") await record.handle.close(); else failed = true; }
      catch { failed = true; }
      finally { record.chunk?.fill(0); record.chunk = null; }
      if (record.iterator && !record.done && typeof record.iterator.return === "function") {
        try { await record.iterator.return(); } catch { failed = true; }
      }
      if (active === record) active = null;
      if (failed) fail();
    })();
    return record.stopping;
  }
  function close() {
    if (!closing) {
      closed = true;
      // Assign the promise before abort listeners can call close again.
      closing = Promise.resolve().then(async () => {
        if (combined && onAbort) combined.removeEventListener("abort", onAbort);
        controller.abort();
        if (opening) { try { await opening; } catch {} }
        await stop(active);
      });
    }
    return closing;
  }
  async function* produce() {
    try {
      check();
      for (const entry of entries) {
        check(); yield local(entry); check(); yield Buffer.from(entry.name); check();
        let record;
        try {
          opening = Promise.resolve().then(() => { check(); return entry.open({ signal: combined }); }).then((handle) => {
            const current = { handle, iterator: null, done: false, chunk: null, stopping: null };
            active = current; return current;
          });
          try { record = await opening; } finally { opening = null; }
          check();
          if (!record.handle || typeof record.handle.close !== "function" || typeof record.handle.source?.[Symbol.asyncIterator] !== "function") fail();
          record.iterator = record.handle.source[Symbol.asyncIterator]();
          if (!record.iterator || typeof record.iterator.next !== "function") fail();
          let copied = 0, checksum = 0;
          for (;;) {
            check(); const next = await record.iterator.next();
            if (!next || typeof next !== "object") fail();
            if (next.done) { record.done = true; check(); break; }
            const chunk = next.value;
            if (Buffer.isBuffer(chunk)) record.chunk = chunk;
            try {
              check();
              if (!Buffer.isBuffer(chunk) || !chunk.length || chunk.length > MAX_ZIP_STREAM_CHUNK_BYTES || copied + chunk.length > entry.bytes) fail();
              checksum = crc32(chunk, checksum); copied += chunk.length;
              // A socket can retain its output buffer after write() returns
              // true. Transfer an independent copy instead of wiping that one.
              yield Buffer.from(chunk); check();
            } finally { record.chunk?.fill(0); record.chunk = null; }
          }
          if (copied !== entry.bytes) fail();
          entry.crc = checksum;
        } finally { await stop(record ?? active); }
        check(); yield descriptor(entry); check();
      }
      // No central directory or success footer is emitted until every source
      // has supplied its exact length and closed successfully.
      for (const entry of entries) { check(); yield central(entry); check(); yield Buffer.from(entry.name); check(); }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(directoryBytes, 12); end.writeUInt32LE(centralOffset, 16);
      check(); yield end;
    } catch { fail(); }
    finally { await close(); }
  }
  return Object.freeze({ bytes,
    stream(options = {}) {
      if (!options || typeof options !== "object" || Array.isArray(options)) fail();
      const { signal: streamSignal } = options;
      if (started || closed || !validSignal(streamSignal)) fail();
      started = true;
      combined = AbortSignal.any([controller.signal, signal, streamSignal].filter(Boolean));
      onAbort = () => { void close().catch(() => {}); };
      combined.addEventListener("abort", onAbort, { once: true });
      const iterator = produce();
      return Object.freeze({
        [Symbol.asyncIterator]() { return this; },
        next(value) { return iterator.next(value); },
        async return(value) {
          let failed = false;
          try { await close(); } catch { failed = true; }
          try { const result = await iterator.return(value); if (failed) fail(); return result; }
          catch { fail(); }
        },
        async throw(error) {
          try { await close(); } catch { /* Still terminate the generator. */ }
          try { return await iterator.throw(error); } catch { fail(); }
        },
      });
    },
    close,
  });
}
