import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { boundWasmMemory } from "./bounded-wasm.mjs";
import { shrinkHeicPlane } from "../../public/heic-decoder-core.js";

const MAX_INPUT = 128 * 1024 * 1024, MAX_PIXELS = 64_000_000;
const fail = code => { throw Object.assign(new Error("Photo conversion failed."), { code }); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
let decoderTask;
async function decoder() {
  if (!decoderTask) decoderTask = (async () => {
    const base = import.meta.resolve("@phenomen/libavif-wasm/decode");
    const glue = new URL("./codec/decode.mjs", base), wasm = new URL("./decode.wasm", base);
    if (digest(await readFile(glue)) !== "9a005bb8209388479101680344c7ef2123625d08af699ff32bbcd85c198f0d07") fail("MEDIA_UNAVAILABLE");
    const bounded = boundWasmMemory(await readFile(wasm), {
      expectedSha256: "10cd87f2c5cd865a3c4fcfde30cc9611387bebe91e4eae7d62b62ef17c27279e",
      expectedMinimumPages: 256, expectedMaximumPages: 32768, maximumPages: 8192,
      expectedBoundedSha256: "466508b384cd81c60dd8fb490f17e986bdd88bf56ebf47ae396ca34aac246436",
    });
    const compiled = await WebAssembly.compile(bounded);
    const factory = (await import(glue.href)).default;
    // Use only the upstream low-level pointer API: the published decode()
    // wrapper otherwise copies the entire RGBA image into JavaScript memory.
    return factory({ instantiateWasm(imports, ready) {
      const instance = new WebAssembly.Instance(compiled, imports);
      ready(instance, compiled); return instance.exports;
    } });
  })();
  try { return await decoderTask; } catch { fail("MEDIA_UNAVAILABLE"); }
}

// Advisory primary-item properties only. Unknown container metadata never
// prevents the native decoder from trying; pixel/memory limits remain native.
function hints(bytes) {
  try {
    let count = 0;
    const boxes = (start, end) => {
      const result = [];
      while (start < end) {
        if (++count > 4096 || end - start < 8) throw new Error();
        let size = bytes.readUInt32BE(start), header = 8;
        if (size === 1) { if (end - start < 16) throw new Error(); size = Number(bytes.readBigUInt64BE(start + 8)); header = 16; }
        else if (size === 0) size = end - start;
        if (!Number.isSafeInteger(size) || size < header || size > end - start) throw new Error();
        result.push({ type: bytes.toString("ascii", start + 4, start + 8), start: start + header, end: start + size }); start += size;
      }
      return result;
    };
    const meta = boxes(0, bytes.length).find(box => box.type === "meta"); if (!meta) return {};
    const children = boxes(meta.start + 4, meta.end), pitm = children.find(box => box.type === "pitm");
    if (!pitm || bytes[pitm.start] > 1) return {};
    const primary = bytes[pitm.start] ? bytes.readUInt32BE(pitm.start + 4) : bytes.readUInt16BE(pitm.start + 4);
    const iprp = children.find(box => box.type === "iprp"); if (!iprp) return {};
    const members = boxes(iprp.start, iprp.end), ipco = members.find(box => box.type === "ipco"); if (!ipco) return {};
    const properties = boxes(ipco.start, ipco.end), selected = [];
    for (const ipma of members.filter(box => box.type === "ipma")) {
      const version = bytes[ipma.start], flags = bytes.readUInt32BE(ipma.start) & 0xffffff;
      const entries = bytes.readUInt32BE(ipma.start + 4); if (version > 1 || flags > 1 || entries > 1024) return {};
      let cursor = ipma.start + 8;
      for (let entry = 0; entry < entries; entry++) {
        const id = version ? bytes.readUInt32BE(cursor) : bytes.readUInt16BE(cursor); cursor += version ? 4 : 2;
        const amount = bytes[cursor++];
        for (let item = 0; item < amount; item++) {
          if (cursor + (flags ? 2 : 1) > ipma.end) return {};
          const index = flags ? bytes.readUInt16BE(cursor) & 0x7fff : bytes[cursor] & 127; cursor += flags ? 2 : 1;
          if (id === primary && index) { if (index > properties.length) return {}; selected.push(properties[index - 1]); }
        }
      }
      if (cursor !== ipma.end) return {};
    }
    const transforms = [], seen = new Set(); let width, height;
    for (const property of selected) {
      if (["ispe", "irot", "imir"].includes(property.type)) {
        if (seen.has(property.type)) return {};
        seen.add(property.type);
      }
      if (property.type === "ispe" && property.end - property.start === 12) {
        width = bytes.readUInt32BE(property.start + 4); height = bytes.readUInt32BE(property.start + 8);
      }
      if (["irot", "imir"].includes(property.type) && property.end - property.start === 1) {
        const value = bytes[property.start];
        if (value <= (property.type === "irot" ? 3 : 1)) transforms.push({ type: property.type, value });
      }
    }
    return { width, height, transforms };
  } catch { return {}; }
}

function transform(image, transforms = []) {
  for (const { type, value } of transforms) {
    if (type === "irot" && value === 0) continue;
    const { width, height, data } = image, quarter = type === "irot" && value % 2;
    const nextWidth = quarter ? height : width, nextHeight = quarter ? width : height;
    const next = Buffer.allocUnsafe(data.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let nx = x, ny = y;
      if (type === "imir") { if (value === 0) ny = height - 1 - y; else nx = width - 1 - x; }
      else if (value === 1) { nx = y; ny = width - 1 - x; }
      else if (value === 2) { nx = width - 1 - x; ny = height - 1 - y; }
      else { nx = height - 1 - y; ny = x; }
      const source = (y * width + x) * 4, target = (ny * nextWidth + nx) * 4;
      next.writeUInt32LE(data.readUInt32LE(source), target);
    }
    data.fill(0); image = { data: next, width: nextWidth, height: nextHeight, channels: 4 };
  }
  return image;
}

export async function decodeAvifOriginal(bytes, { maxPixels = MAX_PIXELS, maxSide = null, targetSide = 2048 } = {}) {
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > MAX_PIXELS
    || maxSide !== null && (!Number.isSafeInteger(maxSide) || maxSide < 1)
    || !Number.isSafeInteger(targetSide) || targetSide < 1 || targetSide > 2048) fail("MEDIA_INPUT");
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_INPUT) fail("MEDIA_INPUT");
  const metadata = hints(bytes);
  if (metadata.width && metadata.height && (metadata.width * metadata.height > maxPixels
    || maxSide !== null && (metadata.width > maxSide || metadata.height > maxSide))) fail("MEDIA_DIMENSIONS");
  const api = await decoder(); let input = 0, output = 0;
  try {
    input = api._avif_wasm_malloc(bytes.length); if (!input) fail("MEDIA_UNAVAILABLE");
    api.HEAPU8.set(bytes, input); output = api._avif_wasm_decode(input, bytes.length);
    if (!output) fail("MEDIA_FORMAT");
    const heap = api.HEAPU8;
    if (!Number.isSafeInteger(output) || output < 1 || output + 8 > heap.length) fail("MEDIA_UNAVAILABLE");
    const header = new DataView(heap.buffer, heap.byteOffset + output, 8), width = header.getInt32(0, true), height = header.getInt32(4, true);
    if (width < 1 || height < 1 || width * height > maxPixels || maxSide !== null && (width > maxSide || height > maxSide)) fail("MEDIA_DIMENSIONS");
    const length = width * height * 4;
    if (length > heap.length - output - 8) fail("MEDIA_UNAVAILABLE");
    const small = shrinkHeicPlane({ width, height, stride: width * 4, data: heap.subarray(output + 8, output + 8 + length) }, targetSide);
    return transform({ data: Buffer.from(small.pixels), width: small.width, height: small.height, channels: 4 }, metadata.transforms);
  } catch (error) {
    if (["MEDIA_INPUT", "MEDIA_FORMAT", "MEDIA_DIMENSIONS", "MEDIA_UNAVAILABLE"].includes(error?.code)) throw error;
    fail(error?.code === "media_dimensions" ? "MEDIA_DIMENSIONS" : "MEDIA_UNAVAILABLE");
  } finally {
    try { if (output) api._avif_wasm_free(output); if (input) api._avif_wasm_free(input); } catch { /* The disposable child owns failed native state. */ }
  }
}
