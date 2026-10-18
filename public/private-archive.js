export const PRIVATE_ARCHIVE_MAX_BYTES = 32 * 1024 * 1024;

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
