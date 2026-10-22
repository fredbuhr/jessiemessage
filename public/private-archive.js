export const PRIVATE_ARCHIVE_MAX_BYTES = 32 * 1024 * 1024;
export const VIDEO_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;

// The video exporter streams the ZIP and can omit Content-Length. Bound both
// bytes and chunk bookkeeping, then verify the ZIP end record before download.
export async function readVideoArchive(response, signal) {
  const length = response.headers.get("Content-Length");
  if (length !== null && (!/^[1-9]\d{1,8}$/.test(length) || Number(length) < 22 || Number(length) > VIDEO_ARCHIVE_MAX_BYTES)
    || response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/zip"
    || !response.body?.getReader) {
    try { await response.body?.cancel?.(); } catch {}
    throw new Error("invalid_archive");
  }
  const reader = response.body.getReader(), chunks = []; let size = 0, completed = false, cancelled = false;
  const cancel = () => { cancelled = true; try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {} };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted || cancelled) throw new Error("archive_cancelled");
      const { value, done } = await reader.read();
      if (signal?.aborted || cancelled) { value?.fill?.(0); throw new Error("archive_cancelled"); }
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("invalid_archive");
      if (chunks.length >= 65536 || value.byteLength > (length === null ? VIDEO_ARCHIVE_MAX_BYTES : Number(length)) - size) {
        value.fill(0); throw new Error("archive_too_large");
      }
      size += value.byteLength; chunks.push(value);
    }
    if (size < 22 || length !== null && size !== Number(length)) throw new Error("incomplete_archive");
    const signature = new Uint8Array(4), tail = new Uint8Array(Math.min(size, 65557)); let position = 0;
    for (const chunk of chunks) {
      if (position < 4) signature.set(chunk.subarray(0, Math.min(4 - position, chunk.length)), position);
      const start = Math.max(0, size - tail.length - position);
      if (start < chunk.length) tail.set(chunk.subarray(start), Math.max(0, position - (size - tail.length)));
      position += chunk.length;
    }
    try {
      if (signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) throw new Error("invalid_archive");
      const view = new DataView(tail.buffer); let end = -1;
      for (let index = tail.length - 22; index >= 0; index--) if (view.getUint32(index, true) === 0x06054b50
        && index + 22 + view.getUint16(index + 20, true) === tail.length) { end = index; break; }
      if (end < 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0
        || view.getUint16(end + 8, true) !== view.getUint16(end + 10, true)
        || view.getUint32(end + 12, true) + view.getUint32(end + 16, true) !== size - tail.length + end) throw new Error("incomplete_archive");
    } finally { signature.fill(0); tail.fill(0); }
    if (signal?.aborted || cancelled) throw new Error("archive_cancelled");
    const blob = new Blob(chunks, { type: "application/zip" }); completed = true; return blob;
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!completed) { try { await reader.cancel(); } catch {} }
    reader.releaseLock(); for (const chunk of chunks) chunk.fill(0);
  }
}

export async function readPrivateArchive(response, signal) {
  const length = response.headers.get("Content-Length");
  if (!/^\d{1,9}$/.test(length ?? "") || Number(length) < 22 || Number(length) > PRIVATE_ARCHIVE_MAX_BYTES
    || response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/zip"
    || !response.body?.getReader) {
    try { await response.body?.cancel?.(); } catch {}
    throw new Error("invalid_archive");
  }
  const reader = response.body.getReader(), chunks = []; let size = 0, completed = false;
  try {
    while (true) {
      if (signal?.aborted) throw new Error("archive_cancelled");
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > Number(length) - size) throw new Error("archive_too_large");
      size += value.byteLength; chunks.push(value);
    }
    if (signal?.aborted || size !== Number(length)) throw new Error("incomplete_archive");
    const signature = new Uint8Array(4); let copied = 0;
    for (const chunk of chunks) { const part = Math.min(4 - copied, chunk.length); signature.set(chunk.subarray(0, part), copied); copied += part; if (copied === 4) break; }
    if (signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) throw new Error("invalid_archive");
    const blob = new Blob(chunks, { type: "application/zip" }); completed = true; return blob;
  } finally {
    if (!completed) { try { await reader.cancel(); } catch {} }
    reader.releaseLock(); for (const chunk of chunks) chunk.fill(0);
  }
}
