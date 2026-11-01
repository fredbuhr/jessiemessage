// Try device-native preparation first. A caller can provide an authenticated
// conversion fallback; uploaded images are independently validated and normalized.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// These are software-inspection/HEVC budgets, not a format allowlist for the
// browser's native image decoder. Normalized output keeps its separate limits.
export const MAX_SOURCE_IMAGE_BYTES = 128 * 1024 * 1024;
export const TARGET_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_PIXELS = 256_000_000;
// Full-resolution native fallback and software HEVC decoding need an explicit
// allocation bound. High-definition JPEG uses native decoder shrink first.
export const MAX_HEIC_IMAGE_PIXELS = 64_000_000;
const MAX_NATIVE_FALLBACK_PIXELS = 64_000_000;
export const MAX_SOURCE_IMAGE_SIDE = 32_768;
const MAX_PREPARED_IMAGE_SIDE = 2048;
const NATIVE_HINT_BYTES = 512 * 1024;


export class ImagePreparationError extends Error {
  constructor(code) { super("Image preparation failed."); this.name = "ImagePreparationError"; this.code = code; }
}
const fail = (code) => { throw new ImagePreparationError(code); };
const ascii = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));

function orientation(bytes, start, end) {
  const base = ascii(bytes, start, 6) === "Exif\0\0" ? start + 6 : start;
  if (base + 8 > end) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = ascii(bytes, base, 2), little = order === "II";
  if (order !== "II" && order !== "MM" || view.getUint16(base + 2, little) !== 42) return 1;
  const directory = base + view.getUint32(base + 4, little);
  if (directory < base + 8 || directory + 2 > end) return 1;
  const count = view.getUint16(directory, little);
  if (count > 256 || directory + 2 + count * 12 > end) return 1;
  for (let index = 0; index < count; index += 1) {
    const entry = directory + 2 + index * 12;
    if (view.getUint16(entry, little) !== 0x112) continue;
    if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) return 1;
    const value = view.getUint16(entry + 8, little);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

function jpegInfo(bytes, view, nativeHint = false) {
  let cursor = 2, width, height, exif = 1, hasExif = false;
  while (cursor + 1 < bytes.length) {
    if (bytes[cursor++] !== 0xff) fail("media_format");
    while (bytes[cursor] === 0xff) cursor += 1;
    const marker = bytes[cursor++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (cursor + 2 > bytes.length) fail("media_format");
    const length = view.getUint16(cursor), end = cursor + length;
    if (length < 2 || end > bytes.length) fail("media_format");
    if (marker === 0xe1 && ascii(bytes, cursor + 2, 6) === "Exif\0\0") {
      const next = orientation(bytes, cursor + 2, end);
      if (hasExif && (!nativeHint || exif !== next)) fail("media_format");
      hasExif = true; exif = next;
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8 || width !== undefined) fail("media_format");
      height = view.getUint16(cursor + 3); width = view.getUint16(cursor + 5);
    }
    cursor = end;
  }
  return { width, height, type: "image/jpeg", orientation: exif };
}

function pngInfo(bytes, view, nativeHint = false) {
  if (bytes.length < 33 || ascii(bytes, 12, 4) !== "IHDR" || view.getUint32(8) !== 13) fail("media_format");
  let cursor = 8, ended = false, exif = 1;
  while (cursor + 12 <= bytes.length) {
    const length = view.getUint32(cursor), end = cursor + length + 12;
    if (end > bytes.length) fail("media_format");
    const chunk = ascii(bytes, cursor + 4, 4);
    if (chunk === "IHDR" && cursor !== 8) fail("media_format");
    if (!nativeHint && ["acTL", "fcTL", "fdAT"].includes(chunk)) fail("media_format");
    if (chunk === "eXIf") exif = orientation(bytes, cursor + 8, end - 4);
    if (chunk === "IEND") { ended = true; break; }
    cursor = end;
  }
  if (!ended) fail("media_format");
  return { width: view.getUint32(16), height: view.getUint32(20), type: "image/png", orientation: exif };
}

function webpInfo(bytes, view, nativeHint = false) {
  if (view.getUint32(4, true) + 8 !== bytes.length) fail("media_format");
  let cursor = 12, width, height, imageWidth, imageHeight, exif = 1;
  while (cursor + 8 <= bytes.length) {
    const length = view.getUint32(cursor + 4, true), start = cursor + 8, end = start + length;
    if (end > bytes.length) fail("media_format");
    const chunk = ascii(bytes, cursor, 4);
    if (!nativeHint && ["ANIM", "ANMF"].includes(chunk)) fail("media_format");
    if (chunk === "EXIF") exif = orientation(bytes, start, end);
    if (chunk === "VP8X") {
      if (length !== 10 || !nativeHint && bytes[start] & 0x02 || width !== undefined) fail("media_format");
      width = 1 + bytes[start + 4] + bytes[start + 5] * 256 + bytes[start + 6] * 65536;
      height = 1 + bytes[start + 7] + bytes[start + 8] * 256 + bytes[start + 9] * 65536;
    } else if (chunk === "VP8 ") {
      if (length < 10 || imageWidth !== undefined || ascii(bytes, start + 3, 3) !== "\x9d\x01\x2a") fail("media_format");
      imageWidth = view.getUint16(start + 6, true) & 0x3fff; imageHeight = view.getUint16(start + 8, true) & 0x3fff;
    } else if (chunk === "VP8L") {
      if (length < 5 || imageWidth !== undefined || bytes[start] !== 0x2f) fail("media_format");
      const bits = view.getUint32(start + 1, true);
      imageWidth = 1 + (bits & 0x3fff); imageHeight = 1 + ((bits >>> 14) & 0x3fff);
    }
    cursor = end + length % 2;
  }
  if (cursor !== bytes.length) fail("media_format");
  if (nativeHint && imageWidth === undefined) return { width, height, type: "image/webp", orientation: exif };
  if (width !== undefined && (width !== imageWidth || height !== imageHeight)) fail("media_format");
  return { width: imageWidth, height: imageHeight, type: "image/webp", orientation: exif };
}

// Inspect only the container metadata, never search compressed image payloads
// for a magic word. Every walked ISO-BMFF box is range/depth/count bounded.
function heifInfo(bytes, view, nativeHint = false) {
  let count = 0;
  const boxes = (start, end) => {
    const result = [];
    while (start < end) {
      if (++count > 4096 || end - start < 8) fail("media_format");
      let size = view.getUint32(start), header = 8;
      if (size === 1) {
        if (end - start < 16 || view.getUint32(start + 8) !== 0) fail("media_format");
        size = view.getUint32(start + 12); header = 16;
      } else if (size === 0) size = end - start;
      if (size < header || size > end - start) fail("media_format");
      result.push({ type: ascii(bytes, start + 4, 4), start: start + header, end: start + size });
      start += size;
    }
    return result;
  };
  const top = boxes(0, bytes.length), ftyp = top.find(box => box.type === "ftyp");
  if (!ftyp || ftyp.end - ftyp.start < 8 || (ftyp.end - ftyp.start) % 4) fail("media_format");
  const brands = [ascii(bytes, ftyp.start, 4)];
  for (let start = ftyp.start + 8; start < ftyp.end; start += 4) brands.push(ascii(bytes, start, 4));
  if (!nativeHint && brands.some(brand => ["avis", "msf1", "hevc", "hevx"].includes(brand))) fail("media_format");
  const type = brands.includes("avif") || nativeHint && brands.includes("avis") ? "image/avif"
    : brands.some(brand => ["heic", "heix", "mif1"].includes(brand)) ? "image/heic" : null;
  if (!type) fail("media_format");
  const meta = top.filter(box => box.type === "meta");
  if (meta.length !== 1 || meta[0].end - meta[0].start < 4) fail("media_format");
  const children = boxes(meta[0].start + 4, meta[0].end), pitm = children.find(box => box.type === "pitm");
  if (!pitm || pitm.end - pitm.start < 6) fail("media_format");
  const version = bytes[pitm.start];
  if (version > 1 || pitm.end - pitm.start < (version ? 8 : 6)) fail("media_format");
  const primary = version ? view.getUint32(pitm.start + 4) : view.getUint16(pitm.start + 4);
  const iprp = children.find(box => box.type === "iprp");
  if (!iprp) fail("media_format");
  const propertyBoxes = boxes(iprp.start, iprp.end), ipco = propertyBoxes.find(box => box.type === "ipco");
  if (!ipco) fail("media_format");
  const properties = boxes(ipco.start, ipco.end), associations = [];
  for (const ipma of propertyBoxes.filter(box => box.type === "ipma")) {
    if (ipma.end - ipma.start < 8 || bytes[ipma.start] > 1) fail("media_format");
    const version = bytes[ipma.start], flags = view.getUint32(ipma.start) & 0xffffff;
    if (flags & ~1) fail("media_format");
    const entries = view.getUint32(ipma.start + 4); if (entries > 1024) fail("media_format");
    let cursor = ipma.start + 8;
    for (let entry = 0; entry < entries; entry += 1) {
      const idBytes = version ? 4 : 2;
      if (cursor + idBytes + 1 > ipma.end) fail("media_format");
      const id = version ? view.getUint32(cursor) : view.getUint16(cursor); cursor += idBytes;
      const amount = bytes[cursor++], associationBytes = flags & 1 ? 2 : 1;
      if (cursor + amount * associationBytes > ipma.end) fail("media_format");
      for (let index = 0; index < amount; index += 1) {
        const property = associationBytes === 2 ? view.getUint16(cursor) & 0x7fff : bytes[cursor] & 0x7f;
        cursor += associationBytes;
        if (property > properties.length) fail("media_format");
        if (id === primary && property) associations.push(properties[property - 1]);
      }
    }
    if (cursor !== ipma.end) fail("media_format");
  }
  const sizes = associations.filter(box => box.type === "ispe");
  if (sizes.length !== 1 || sizes[0].end - sizes[0].start !== 12) fail("media_format");
  const rotations = associations.filter(box => box.type === "irot");
  if (rotations.length > 1 || rotations.some(box => box.end - box.start !== 1 || bytes[box.start] > 3)) fail("media_format");
  const rotated = rotations.length && bytes[rotations[0].start] % 2;
  const width = view.getUint32(sizes[0].start + 4), height = view.getUint32(sizes[0].start + 8);
  return { width: rotated ? height : width, height: rotated ? width : height, type, orientation: 1 };
}

// Strict metadata inspection for callers that need a bounded known format.
// Native preparation treats source parsing as an advisory hint instead.
export function inspectImageInput(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 3) fail("media_format");
  if (bytes.length > MAX_SOURCE_IMAGE_BYTES) fail("image_source_too_large");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let info;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) info = jpegInfo(bytes, view);
  else if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") info = pngInfo(bytes, view);
  else if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") info = webpInfo(bytes, view);
  else if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") info = heifInfo(bytes, view);
  else fail("media_format");
  if (![info.width, info.height].every((value) => Number.isSafeInteger(value) && value >= 1)) fail("media_format");
  if (info.width > MAX_SOURCE_IMAGE_SIDE || info.height > MAX_SOURCE_IMAGE_SIDE
    || info.width * info.height > MAX_SOURCE_IMAGE_PIXELS) fail("media_dimensions");
  return info;
}

// A bounded hint can help a native JPEG decoder shrink before allocating its
// output. Missing, redundant or unfamiliar metadata never rejects an image.
function nativeImageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return "image/gif";
  if (ascii(bytes, 0, 2) === "BM") return "image/bmp";
  if (["II\x2a\0", "MM\0\x2a", "II\x2b\0", "MM\0\x2b"].includes(ascii(bytes, 0, 4))) return "image/tiff";
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === "ftyp") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = view.getUint32(0), start = size === 1 ? 16 : 8;
    const end = Math.min(bytes.length, size === 1 && bytes.length >= 24 ? view.getUint32(12) : size);
    const brands = [];
    for (let offset = start; offset + 4 <= end; offset += 4) if (offset !== start + 4) brands.push(ascii(bytes, offset, 4));
    if (brands.some(brand => ["avif", "avis"].includes(brand))) return "image/avif";
    if (brands.some(brand => ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand))) return "image/heic";
  }
  return undefined;
}
async function nativeImageHint(file, signal) {
  let bytes, type;
  try {
    bytes = await readImageBytes(file.size > NATIVE_HINT_BYTES ? file.slice(0, NATIVE_HINT_BYTES) : file, signal, 1000);
    type = nativeImageType(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let info;
    if (type === "image/jpeg") info = jpegInfo(bytes, view, true);
    else if (type === "image/png") info = pngInfo(bytes, view, true);
    else if (type === "image/webp") info = webpInfo(bytes, view, true);
    else if (["image/heic", "image/avif"].includes(type)) info = heifInfo(bytes, view, true);
    else if (type === "image/gif" && bytes.length >= 10) info = { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    else if (type === "image/bmp" && bytes.length >= 26 && view.getUint32(14, true) >= 40) info = { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
    if (info && [info.width, info.height].every(value => Number.isSafeInteger(value) && value > 0)) return { ...info, type };
  } catch { aborted(signal); }
  finally { bytes?.fill(0); }
  return { type };
}

function dimensions(width, height, maximum = MAX_PREPARED_IMAGE_SIDE) {
  const ratio = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}
function aborted(signal) { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); }
function readImageBytes(file, signal, timeout = 60000) {
  return new Promise((resolve, reject) => {
    let reader, done = false;
    const finish = (error, buffer) => {
      if (done) {
        // arrayBuffer() itself has no abort API. Discard and clear a late
        // result after the caller has already abandoned this private read.
        if (buffer) { try { new Uint8Array(buffer).fill(0); } catch {} }
        return;
      }
      done = true; clearTimeout(timer); signal?.removeEventListener("abort", cancel);
      if (reader) {
        reader.onload = reader.onerror = reader.onabort = null;
        if (error) { try { reader.abort(); } catch {} }
      }
      error ? reject(error) : resolve(new Uint8Array(buffer));
    };
    const cancel = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(new ImagePreparationError("media_unavailable")), timeout);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    try {
      if (typeof globalThis.FileReader === "function") {
        reader = new FileReader();
        reader.onload = () => finish(null, reader.result);
        reader.onerror = () => finish(new ImagePreparationError("media_unavailable"));
        reader.onabort = cancel;
        reader.readAsArrayBuffer(file);
      } else Promise.resolve(file.arrayBuffer()).then(buffer => finish(null, buffer), () => finish(new ImagePreparationError("media_unavailable")));
    } catch { finish(new ImagePreparationError("media_unavailable")); }
  });
}
function canvasBlob(canvas, type, signal) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, blob) => {
      if (done) return; done = true;
      clearTimeout(timer); signal?.removeEventListener("abort", cancel);
      error ? reject(error) : resolve(blob);
    };
    const cancel = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(new ImagePreparationError("media_unavailable")), 60000);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    try {
      canvas.toBlob((blob) => {
        if (blob && blob.type === type) finish(null, blob);
        else finish(new ImagePreparationError("media_unavailable"));
      }, type, type === "image/jpeg" ? 0.88 : undefined);
    } catch { finish(new ImagePreparationError("media_unavailable")); }
  });
}

function decodedHeicPixels(result, signal) {
  const pixels = new Uint8ClampedArray(result.pixels);
  let image;
  try {
    aborted(signal);
    image = document.createElement("canvas"); image.width = result.width; image.height = result.height;
    const context = image.getContext("2d", { alpha: false });
    if (!context || typeof globalThis.ImageData !== "function") fail("media_unavailable");
    context.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
    return { image, width: result.width, height: result.height, dispose: () => { image.width = 0; image.height = 0; } };
  } catch (error) {
    if (image) { image.width = 0; image.height = 0; }
    if (error instanceof ImagePreparationError || error?.name === "AbortError") throw error;
    fail("media_unavailable");
  } finally { pixels.fill(0); }
}

async function decodedImage(file, target, signal) {
  let bitmapError;
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      const image = await new Promise((resolve, reject) => {
        let done = false;
        const finish = (error, bitmap) => {
          if (done) { bitmap?.close?.(); return; } done = true;
          clearTimeout(timer); signal?.removeEventListener("abort", cancel);
          error ? reject(error) : resolve(bitmap);
        };
        const cancel = () => finish(new DOMException("Aborted", "AbortError"));
        const timer = setTimeout(() => finish(new ImagePreparationError("media_unavailable")), 60000);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        try {
          const options = { imageOrientation: "from-image" };
          if (target.width && target.height) Object.assign(options, { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: "high" });
          Promise.resolve(createImageBitmap(file, options)).then(bitmap => finish(null, bitmap), error => finish(error));
        } catch (error) { finish(error); }
      });
      return { image, width: image.width, height: image.height, dispose: () => image.close?.() };
    } catch (error) { bitmapError = error; aborted(signal); }
  }
  // Some phone browsers have no ImageBitmap API or reject its resize options.
  // Avoid a known oversized full-resolution fallback when native resize failed.
  if (typeof globalThis.Image !== "function" || typeof globalThis.URL?.createObjectURL !== "function") {
    if (bitmapError) throw bitmapError;
    fail("media_unavailable");
  }
  if (target.sourcePixels > MAX_NATIVE_FALLBACK_PIXELS) fail("media_unavailable");
  const image = new Image(), url = URL.createObjectURL(file);
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true;
    image.onload = image.onerror = null; image.src = ""; URL.revokeObjectURL(url);
  };
  try {
    await new Promise((resolve, reject) => {
      let done = false;
      const finish = (error) => {
        if (done) return; done = true;
        clearTimeout(timer); signal?.removeEventListener("abort", cancel);
        image.onload = image.onerror = null;
        error ? reject(error) : resolve();
      };
      const cancel = () => finish(new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(() => finish(new ImagePreparationError("media_unavailable")), 15000);
      image.onload = () => finish(); image.onerror = () => finish(new ImagePreparationError("media_format"));
      signal?.addEventListener("abort", cancel, { once: true });
      image.decoding = "async"; image.src = url;
      if (signal?.aborted) cancel();
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, dispose };
  } catch (error) { dispose(); throw error; }
}

let heicTail = Promise.resolve();
async function decodeHeic(bytes, signal) {
  const prior = heicTail; let release;
  const turn = new Promise(resolve => { release = resolve; });
  heicTail = prior.then(() => turn);
  try {
    await new Promise((resolve, reject) => {
      const cancel = () => { signal?.removeEventListener("abort", cancel); reject(new DOMException("Aborted", "AbortError")); };
      signal?.addEventListener("abort", cancel, { once: true });
      prior.then(() => { signal?.removeEventListener("abort", cancel); resolve(); });
      if (signal?.aborted) cancel();
    });
    aborted(signal);
    if (typeof globalThis.Worker !== "function") fail("media_heic");
    return await new Promise((resolve, reject) => {
      let worker, timer, settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true;
        clearTimeout(timer); signal?.removeEventListener("abort", cancel);
        if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); }
        error ? reject(error) : resolve(result);
      };
      const cancel = () => finish(new DOMException("Aborted", "AbortError"));
      try {
        worker = new Worker("/heic-decoder-worker.js", { type: "module", name: "JessieMessage photo" });
        timer = setTimeout(() => finish(new ImagePreparationError("media_unavailable")), 60000);
        signal?.addEventListener("abort", cancel, { once: true });
        worker.onerror = worker.onmessageerror = () => finish(new ImagePreparationError("media_heic"));
        worker.onmessage = event => {
          const message = event.data;
          if (message?.ok !== true) return finish(new ImagePreparationError(message?.code === "media_dimensions" ? "media_dimensions" : "media_heic"));
          const blob = message.blob;
          if (blob !== undefined) {
            if (!(blob instanceof Blob) || blob.type !== "image/jpeg" || blob.size < 1 || blob.size > TARGET_UPLOAD_BYTES || message.pixels !== undefined) {
              finish(new ImagePreparationError("media_unavailable")); return;
            }
            finish(null, blob); return;
          }
          const { pixels, width, height } = message;
          if (!(pixels instanceof ArrayBuffer) || !Number.isInteger(width) || !Number.isInteger(height)
            || width < 1 || height < 1 || width > MAX_PREPARED_IMAGE_SIDE || height > MAX_PREPARED_IMAGE_SIDE
            || pixels.byteLength !== width * height * 4) {
            finish(new ImagePreparationError("media_unavailable")); return;
          }
          finish(null, { pixels, width, height });
        };
        aborted(signal); worker.postMessage({ bytes: bytes.buffer, acceptPixels: true }, [bytes.buffer]);
      } catch (error) { finish(error?.name === "AbortError" ? error : new ImagePreparationError("media_heic")); }
    });
  } finally { release(); }
}

async function convertedImage(file, convert, signal) {
  // The caller owns authentication, owner proofs and the HTTP deadline. Keep
  // cancellation effective even when an adapter settles after it was aborted.
  const blob = await new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => {
      if (done) return; done = true;
      signal?.removeEventListener("abort", cancel);
      error ? reject(error) : resolve(value);
    };
    const cancel = () => finish(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    try { Promise.resolve(convert(file, { signal })).then(value => finish(null, value), error => finish(error)); }
    catch (error) { finish(error); }
  });
  aborted(signal);
  if (!(blob instanceof Blob) || blob.type !== "image/jpeg" || blob.size < 1 || blob.size > TARGET_UPLOAD_BYTES) fail("media_unavailable");
  let bytes;
  try {
    bytes = await readImageBytes(blob, signal);
    const info = inspectImageInput(bytes);
    if (info.type !== "image/jpeg" || info.width > MAX_PREPARED_IMAGE_SIDE || info.height > MAX_PREPARED_IMAGE_SIDE) fail("media_unavailable");
    return blob;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    fail("media_unavailable");
  } finally { bytes?.fill(0); }
}

export async function prepareImageUpload(file, { signal, convert } = {}) {
  aborted(signal);
  if (!(file instanceof Blob) || file.size < 1) fail("media_format");
  if (convert !== undefined && typeof convert !== "function") fail("media_unavailable");
  let bitmap, canvas, bytes;
  let conversionAttempted = false, conversionMissing = false;
  try {
    const info = await nativeImageHint(file, signal);
    aborted(signal);
    if (typeof globalThis.document?.createElement !== "function") fail("media_unavailable");
    const oriented = info.orientation >= 5 && info.orientation <= 8
      ? { width: info.height, height: info.width } : info;
    // HEIF spatial extents can precede clean-aperture cropping or derived-image
    // transforms. Let the native decoder report the actual displayed ratio.
    const resizeHint = !["image/heic", "image/avif"].includes(info.type) && info.width && info.height;
    const target = { ...(resizeHint ? dimensions(oriented.width, oriented.height) : {}), sourcePixels: info.width * info.height };
    // The bytes prove the format. Camera/cloud pickers often supply a generic
    // or simply incorrect MIME label; that label must not reject a real photo.
    const decodable = !info.type || file.type === info.type ? file : new Blob([file], { type: info.type });
    try { bitmap = await decodedImage(decodable, target, signal); }
    catch (error) {
      aborted(signal);
      if (info.type !== "image/heic") throw error;
      if (convert) {
        // Avoid a full original read and a large local HEVC plane when the
        // authenticated converter is available. Only an old route's404 falls
        // back to software; other HTTP/owner failures must remain visible.
        conversionAttempted = true;
        try { return await convertedImage(file, convert, signal); }
        catch (error) {
          aborted(signal);
          if (error?.name === "AbortError" || error?.stale || error?.status !== 404) throw error;
          conversionMissing = true;
        }
      }
      if (file.size > MAX_SOURCE_IMAGE_BYTES) fail("image_source_too_large");
      bytes = await readImageBytes(file, signal);
      const result = await decodeHeic(bytes, signal);
      if (result instanceof Blob) { aborted(signal); return result; }
      bitmap = decodedHeicPixels(result, signal);
    }
    aborted(signal);
    if (!Number.isSafeInteger(bitmap.width) || !Number.isSafeInteger(bitmap.height) || bitmap.width < 1 || bitmap.height < 1) fail("media_dimensions");
    canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: !["image/jpeg", "image/heic"].includes(info.type) });
    if (!context) fail("media_unavailable");
    const actual = dimensions(bitmap.width, bitmap.height);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = Math.max(1, Math.floor(actual.width * 0.75 ** attempt));
      canvas.height = Math.max(1, Math.floor(actual.height * 0.75 ** attempt));
      context.drawImage(bitmap.image, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas, ["image/jpeg", "image/heic"].includes(info.type) ? "image/jpeg" : "image/png", signal);
      aborted(signal);
      if (blob.size > 0 && blob.size <= TARGET_UPLOAD_BYTES) return blob;
    }
    fail("request_too_large");
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    aborted(signal);
    if (conversionAttempted && !conversionMissing) throw error;
    if (convert && !conversionAttempted) {
      bitmap?.dispose?.(); bitmap = null;
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas = null; }
      if (bytes?.byteLength) bytes.fill(0); bytes = null;
      return await convertedImage(file, convert, signal);
    }
    if (error instanceof ImagePreparationError || error?.name === "AbortError") throw error;
    fail("media_format");
  } finally {
    bitmap?.dispose?.(); if (bytes?.byteLength) bytes.fill(0); bytes = null;
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
