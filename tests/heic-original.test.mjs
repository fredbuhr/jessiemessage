import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { decodeHeicOriginal } from "../server/media/heic-original.mjs";

test("the pinned server HEVC fallback decodes actual pixels without a browser or modifying the original", async () => {
  const source = Buffer.from((await readFile(new URL("./fixtures/photo-1140.heic.b64", import.meta.url), "utf8")).trim(), "base64");
  const before = createHash("sha256").update(source).digest("hex");
  const result = await decodeHeicOriginal(source);
  assert.equal(result.width, 64); assert.equal(result.height, 48); assert.equal(result.channels, 4);
  assert.ok(Buffer.isBuffer(result.data)); assert.equal(result.data.length, 64 * 48 * 4);
  assert.equal(createHash("sha256").update(result.data).digest("hex"), "cc3b578e5e4325f1d791ecfdb52b1ae290466a38bca6a8b69b368a843eba1696");
  assert.equal(createHash("sha256").update(source).digest("hex"), before);
  result.data.fill(0);
});

test("the server HEVC fallback refuses nonimages with a sanitized media error", async () => {
  await assert.rejects(decodeHeicOriginal(Buffer.from("not a photo")), error => {
    assert.equal(error.code, "MEDIA_FORMAT");
    assert.equal(error.message, "Photo conversion failed."); return true;
  });
});
