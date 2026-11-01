// A single disposable worker owns the optional local HEVC decoder. Original
// bytes, filenames and decoder diagnostics are never returned. Output is a JPEG
// or an explicitly negotiated small RGBA plane for document-canvas encoding.
import { decodeHeicPixels, MAX_HEIC_INPUT_BYTES } from "./heic-decoder-core.js";
export { decodeHeicPixels, shrinkHeicPlane, limitHeicDecoder } from "./heic-decoder-core.js";

const TARGET_UPLOAD_BYTES = 2 * 1024 * 1024;
const fail = code => { throw Object.assign(new Error("Photo decoding failed."), { code }); };

if (typeof self !== "undefined") {
  let accepted = false;
  self.onmessage = async event => {
    if (accepted) return; accepted = true;
    let canvas, sourceCanvas, bytes, pixels;
    try {
      if (!(event.data?.bytes instanceof ArrayBuffer)) fail("media_heic");
      bytes = new Uint8Array(event.data.bytes);
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_HEIC_INPUT_BYTES) fail("media_heic");
      // Native decoding is tried first; only this disposable worker loads the
      // codec. The shared core validates the container through libheif itself.
      const { default: factory } = await import("/heic-codec-1.23.7.mjs");
      const lib = await factory({ print() {}, printErr() {} });
      const result = await decodeHeicPixels(bytes, lib);
      bytes.fill(0); bytes = null;
      pixels = result.pixels;
      let sourceContext;
      if (typeof OffscreenCanvas === "function" && typeof ImageData === "function") {
        try {
          sourceCanvas = new OffscreenCanvas(result.width, result.height);
          if (typeof sourceCanvas.convertToBlob === "function") sourceContext = sourceCanvas.getContext("2d", { alpha: false });
        } catch { /* Older workers can lack 2D canvas despite exposing its constructor. */ }
      }
      if (!sourceContext) {
        // Callers from an already-open 1.14.0 tab keep the JPEG-only contract.
        // Only the new preparer accepts these reduced, bounded pixels.
        if (event.data.acceptPixels !== true) fail("media_heic");
        self.postMessage({ ok: true, pixels: pixels.buffer, width: result.width, height: result.height }, [pixels.buffer]);
        pixels = null; return;
      }
      sourceContext.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
      pixels.fill(0); pixels = null;
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
      pixels?.fill?.(0);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      if (sourceCanvas) { sourceCanvas.width = 0; sourceCanvas.height = 0; }
      self.close();
    }
  };
}
