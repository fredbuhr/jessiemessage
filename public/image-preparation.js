// All preparation stays on this device. The server still validates, rotates,
// strips metadata and normalizes every uploaded image independently.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Camera originals can be much larger than the upload. Inspect their compressed
// headers first, then resize locally; the server's independent 10 MiB cap stays.
export const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;
export const TARGET_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_PIXELS = 64_000_000;
export const MAX_SOURCE_IMAGE_SIDE = 16_384;
const MAX_PREPARED_IMAGE_SIDE = 2048;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const GENERIC_TYPES = new Set(["", "application/octet-stream"]);
const JPEG_TYPES = new Set(["image/jpg", "image/pjpeg"]);

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

function jpegInfo(bytes, view) {
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
      if (hasExif) fail("media_format");
      hasExif = true; exif = orientation(bytes, cursor + 2, end);
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8 || width !== undefined) fail("media_format");
      height = view.getUint16(cursor + 3); width = view.getUint16(cursor + 5);
    }
    cursor = end;
  }
  return { width, height, type: "image/jpeg", orientation: exif };
}

function pngInfo(bytes, view) {
  if (bytes.length < 33 || ascii(bytes, 12, 4) !== "IHDR" || view.getUint32(8) !== 13) fail("media_format");
  let cursor = 8, ended = false, exif = 1;
  while (cursor + 12 <= bytes.length) {
    const length = view.getUint32(cursor), end = cursor + length + 12;
    if (end > bytes.length) fail("media_format");
    const chunk = ascii(bytes, cursor + 4, 4);
    if (chunk === "IHDR" && cursor !== 8) fail("media_format");
    if (["acTL", "fcTL", "fdAT"].includes(chunk)) fail("media_format");
    if (chunk === "eXIf") exif = orientation(bytes, cursor + 8, end - 4);
    if (chunk === "IEND") { ended = true; break; }
    cursor = end;
  }
  if (!ended) fail("media_format");
  return { width: view.getUint32(16), height: view.getUint32(20), type: "image/png", orientation: exif };
}

function webpInfo(bytes, view) {
  if (view.getUint32(4, true) + 8 !== bytes.length) fail("media_format");
  let cursor = 12, width, height, imageWidth, imageHeight, exif = 1;
  while (cursor + 8 <= bytes.length) {
    const length = view.getUint32(cursor + 4, true), start = cursor + 8, end = start + length;
    if (end > bytes.length) fail("media_format");
    const chunk = ascii(bytes, cursor, 4);
    if (["ANIM", "ANMF"].includes(chunk)) fail("media_format");
    if (chunk === "EXIF") exif = orientation(bytes, start, end);
    if (chunk === "VP8X") {
      if (length !== 10 || bytes[start] & 0x02 || width !== undefined) fail("media_format");
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
  if (width !== undefined && (width !== imageWidth || height !== imageHeight)) fail("media_format");
  return { width: imageWidth, height: imageHeight, type: "image/webp", orientation: exif };
}

// Inspect bounded compressed bytes before calling any browser image decoder.
// This does not trust the filename or MIME type as proof of an image format.
export function inspectImageInput(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 3) fail("media_format");
  if (bytes.length > MAX_SOURCE_IMAGE_BYTES) fail("image_source_too_large");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let info;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) info = jpegInfo(bytes, view);
  else if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") info = pngInfo(bytes, view);
  else if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") info = webpInfo(bytes, view);
  else if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp"
    && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(ascii(bytes, 8, 4))) fail("media_heic");
  else fail("media_format");
  if (![info.width, info.height].every((value) => Number.isSafeInteger(value) && value >= 1)) fail("media_format");
  if (info.width > MAX_SOURCE_IMAGE_SIDE || info.height > MAX_SOURCE_IMAGE_SIDE
    || info.width * info.height > MAX_SOURCE_IMAGE_PIXELS) fail("media_dimensions");
  return info;
}

function dimensions(width, height, maximum = MAX_PREPARED_IMAGE_SIDE) {
  const ratio = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}
function aborted(signal) { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); }
function canvasBlob(canvas, type) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob && blob.type === type) resolve(blob); else reject(new ImagePreparationError("media_unavailable"));
  }, type, type === "image/jpeg" ? 0.88 : undefined));
}

async function decodedImage(file, target, signal) {
  let bitmapError;
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      const image = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: target.width,
        resizeHeight: target.height, resizeQuality: "high" });
      return { image, width: image.width, height: image.height, dispose: () => image.close?.() };
    } catch (error) { bitmapError = error; aborted(signal); }
  }
  // Some phone browsers have no ImageBitmap API or reject its resize options.
  // The source header/pixel guard has already run before this native decoder.
  if (typeof globalThis.Image !== "function" || typeof globalThis.URL?.createObjectURL !== "function") {
    if (bitmapError) throw bitmapError;
    fail("media_unavailable");
  }
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

export async function prepareImageUpload(file, { signal } = {}) {
  aborted(signal);
  if (!(file instanceof Blob) || file.size < 1) fail("media_format");
  if (file.size > MAX_SOURCE_IMAGE_BYTES) fail("image_source_too_large");
  const declaredType = JPEG_TYPES.has(file.type) ? "image/jpeg" : file.type;
  if (["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"].includes(declaredType)) fail("media_heic");
  if (!GENERIC_TYPES.has(declaredType) && !TYPES.has(declaredType)) fail("media_format");
  let bitmap, canvas;
  try {
    const info = inspectImageInput(new Uint8Array(await file.arrayBuffer()));
    if (!GENERIC_TYPES.has(declaredType) && declaredType !== info.type) fail("media_format");
    aborted(signal);
    if (typeof globalThis.document?.createElement !== "function") fail("media_unavailable");
    const oriented = info.orientation >= 5 && info.orientation <= 8
      ? { width: info.height, height: info.width } : info;
    const target = dimensions(oriented.width, oriented.height);
    // Some mobile file pickers report no MIME type (or a generic one). Decode
    // with the format proved by the bytes rather than the picker's label.
    const decodable = file.type === info.type ? file : new Blob([file], { type: info.type });
    bitmap = await decodedImage(decodable, target, signal);
    aborted(signal);
    // Older decoders may ignore resize options; the header guard above still
    // bounds that fallback, and canvas dimensions remain independently bounded.
    if (!Number.isInteger(bitmap.width) || !Number.isInteger(bitmap.height) || bitmap.width < 1 || bitmap.height < 1
      || bitmap.width > MAX_SOURCE_IMAGE_SIDE || bitmap.height > MAX_SOURCE_IMAGE_SIDE
      || bitmap.width * bitmap.height > MAX_SOURCE_IMAGE_PIXELS) fail("media_dimensions");
    canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: info.type !== "image/jpeg" });
    if (!context) fail("media_unavailable");
    // PNG also retains alpha from WebP, avoiding a hidden opaque background.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = Math.max(1, Math.floor(target.width * 0.75 ** attempt));
      canvas.height = Math.max(1, Math.floor(target.height * 0.75 ** attempt));
      context.drawImage(bitmap.image, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas, info.type === "image/jpeg" ? "image/jpeg" : "image/png");
      aborted(signal);
      if (blob.size > 0 && blob.size <= TARGET_UPLOAD_BYTES) return blob;
    }
    fail("request_too_large");
  } catch (error) {
    if (error instanceof ImagePreparationError || error?.name === "AbortError") throw error;
    fail("media_format");
  } finally {
    bitmap?.dispose?.();
    // Release the canvas backing store promptly, especially on phones.
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
