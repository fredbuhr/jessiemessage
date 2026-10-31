// A single disposable worker owns the optional local HEVC decoder. No photo
// bytes, filenames or decoder diagnostics leave this worker except a JPEG.
import { inspectImageInput, MAX_HEIC_IMAGE_PIXELS, TARGET_UPLOAD_BYTES } from "./image-preparation.js";

const MAX_SIDE = 32768;
const SIZE = 2048;
const fail = code => { throw Object.assign(new Error("Photo decoding failed."), { code }); };
const validSize = (width, height) => Number.isInteger(width) && Number.isInteger(height)
  && width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE && width * height <= MAX_HEIC_IMAGE_PIXELS;

// The pinned 1.23.5 package mixes Embind handles and raw C exports. This one
// raw setter needs the opaque numeric pointer, never the Embind object. Set
// only the codec's pixel-area limit; preserve every other native security cap.
export function limitHeicDecoder(context, lib, maximumWidth = 8000) {
  const pointer = context?.$$?.ptr;
  if (lib.heif_get_version?.() !== "1.23.5" || typeof lib._heif_context_set_maximum_image_size_limit !== "function"
    || !Number.isSafeInteger(pointer) || pointer < 1 || pointer > 0xffffffff
    || !Number.isSafeInteger(maximumWidth) || maximumWidth < 1 || maximumWidth > 8000) fail("media_heic");
  lib._heif_context_set_maximum_image_size_limit(pointer, maximumWidth);
}

// The pinned libheif API returns its RGBA plane. Sample it directly into the
// small output; never copy the full plane into another RGBA buffer or canvas.
export function shrinkHeicPlane(channel) {
  const { width, height, stride, data } = channel ?? {};
  if (!validSize(width, height) || !Number.isInteger(stride) || stride < width * 4
    || !ArrayBuffer.isView(data) || data.BYTES_PER_ELEMENT !== 1
    || data.byteLength < stride * (height - 1) + width * 4) fail("media_dimensions");
  const ratio = Math.min(1, SIZE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.floor(width * ratio)), targetHeight = Math.max(1, Math.floor(height * ratio));
  const pixels = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.max(0, (y + 0.5) * height / targetHeight - 0.5), y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.max(0, (x + 0.5) * width / targetWidth - 0.5), x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      const a = y0 * stride + x0 * 4, b = y0 * stride + x1 * 4, c = y1 * stride + x0 * 4, d = y1 * stride + x1 * 4;
      const offset = (y * targetWidth + x) * 4;
      const sample = component => (data[a + component] * (1 - fx) + data[b + component] * fx) * (1 - fy)
        + (data[c + component] * (1 - fx) + data[d + component] * fx) * fy;
      const alpha = sample(3) / 255;
      for (let component = 0; component < 3; component += 1) {
        pixels[offset + component] = sample(component) * alpha + [245, 238, 242][component] * (1 - alpha);
      }
      pixels[offset + 3] = 255;
    }
  }
  return { pixels, width: targetWidth, height: targetHeight };
}

export async function decodeHeicPixels(bytes, lib) {
  const header = inspectImageInput(bytes);
  if (header.type !== "image/heic" || !validSize(header.width, header.height)) fail("media_dimensions");
  let context, handle, decoded;
  try {
    context = lib.heif_context_alloc(); if (!context) fail("media_heic");
    limitHeicDecoder(context, lib);
    const parsed = lib.heif_context_read_from_memory(context, bytes);
    if (!parsed || parsed.code !== lib.heif_error_code.heif_error_Ok) fail("media_heic");
    if (lib.heif_context_get_number_of_items(context) > 1024) fail("media_heic");
    handle = lib.heif_js_context_get_primary_image_handle(context);
    if (!handle || handle.code) fail("media_heic");
    // Header limits are repeated against the decoder's primary-image handle
    // before any pixel allocation. Auxiliary/depth images are never displayed.
    if (!validSize(lib.heif_image_handle_get_width(handle), lib.heif_image_handle_get_height(handle))) fail("media_dimensions");
    decoded = await lib.heif_js_decode_image2(handle, lib.heif_colorspace.heif_colorspace_RGB, lib.heif_chroma.heif_chroma_interleaved_RGBA);
    if (!decoded || decoded.code || !Array.isArray(decoded.channels) || decoded.channels.length > 4) fail("media_heic");
    const channel = decoded.channels.find(item => item.id === lib.heif_channel.heif_channel_interleaved);
    return shrinkHeicPlane(channel);
  } finally {
    if (decoded?.image) lib.heif_image_release(decoded.image);
    if (handle && !handle.code) lib.heif_image_handle_release(handle);
    if (context) lib.heif_context_free(context);
  }
}

if (typeof self !== "undefined") {
  let accepted = false;
  self.onmessage = async event => {
    if (accepted) return; accepted = true;
    let canvas, sourceCanvas, bytes;
    try {
      if (!(event.data?.bytes instanceof ArrayBuffer)) fail("media_heic");
      bytes = new Uint8Array(event.data.bytes);
      // Native decoding is tried by the caller first; this code and its 2 MiB
      // codec are downloaded only for a real HEIC fallback on this device.
      const header = inspectImageInput(bytes);
      if (header.type !== "image/heic" || !validSize(header.width, header.height)) fail("media_dimensions");
      const { default: factory } = await import("/heic-codec-1.23.5.mjs");
      const lib = await factory({ print() {}, printErr() {} });
      const result = await decodeHeicPixels(bytes, lib);
      bytes.fill(0); bytes = null;
      sourceCanvas = new OffscreenCanvas(result.width, result.height);
      const sourceContext = sourceCanvas.getContext("2d", { alpha: false }); if (!sourceContext) fail("media_heic");
      sourceContext.putImageData(new ImageData(result.pixels, result.width, result.height), 0, 0);
      result.pixels.fill(0);
      canvas = new OffscreenCanvas(result.width, result.height);
      let blob;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        canvas.width = Math.max(1, Math.floor(result.width * 0.75 ** attempt));
        canvas.height = Math.max(1, Math.floor(result.height * 0.75 ** attempt));
        const context = canvas.getContext("2d", { alpha: false }); if (!context) fail("media_heic");
        context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
        blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
        if (blob instanceof Blob && blob.type === "image/jpeg" && blob.size > 0 && blob.size <= TARGET_UPLOAD_BYTES) break;
        blob = null;
      }
      if (!blob) fail("media_heic");
      self.postMessage({ ok: true, blob });
    } catch (error) {
      self.postMessage({ ok: false, code: error?.code === "media_dimensions" ? "media_dimensions" : "media_heic" });
    } finally {
      bytes?.fill?.(0);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      if (sourceCanvas) { sourceCanvas.width = 0; sourceCanvas.height = 0; }
      self.close();
    }
  };
}
