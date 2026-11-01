import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createContext, Script, runInContext } from "node:vm";
import { decodeHeicPixels, MAX_HEIC_INPUT_BYTES } from "../../public/heic-decoder-core.js";

const CODEC_URL = new URL("../../node_modules/heic-to/src/lib/libheif-without-unsafe-eval.js", import.meta.url);
const CODEC_SHA256 = "75aaf03816c22f8cf40dbcaeb22bee83f2e1c5da4b7417577a7883b296348734";
const unavailable = () => Object.assign(new Error("Photo conversion unavailable."), { code: "MEDIA_UNAVAILABLE" });
const invalid = () => Object.assign(new Error("Photo conversion failed."), { code: "MEDIA_FORMAT" });

async function decoder() {
  try {
    const bytes = await readFile(CODEC_URL);
    if (createHash("sha256").update(bytes).digest("hex") !== CODEC_SHA256) throw unavailable();
    const source = bytes.toString("utf8");
    // This pinned browser-only factory has no runtime Node entry point. Keep
    // its code intact apart from the single ESM export and supply no Node,
    // filesystem, network or host-function bindings. This adapts a trusted
    // dependency; vm is not the decoder's resource/security boundary. Its
    // caller always runs in the bounded, one-job image child process.
    const wrapped = source.replace(/export default buildLibheif\s*;?\s*$/, "globalThis.__codecFactory = buildLibheif;");
    if (wrapped === source) throw unavailable();
    const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    new Script(wrapped, { filename: "JessieMessage-heif-1.23.7" }).runInContext(context, { timeout: 5000 });
    const lib = await runInContext("__codecFactory({print(){},printErr(){}})", context, { timeout: 5000 });
    if (lib.heif_get_version?.() !== "1.23.7") throw unavailable();
    return lib;
  } catch { throw unavailable(); }
}

export async function decodeHeicOriginal(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_HEIC_INPUT_BYTES) throw invalid();
  const lib = await decoder();
  let image;
  try {
    image = await decodeHeicPixels(bytes, lib);
    const data = Buffer.from(image.pixels);
    return { data, width: image.width, height: image.height, channels: 4 };
  } catch (error) {
    throw Object.assign(invalid(), { code: error?.code === "media_dimensions" ? "MEDIA_DIMENSIONS" : "MEDIA_FORMAT" });
  } finally {
    image?.pixels?.fill(0);
  }
}
