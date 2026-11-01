import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { decodeAvifOriginal } from "../server/media/avif-original.mjs";

const transforms = JSON.parse(await readFile(new URL("./fixtures/photo-1150-avif-transforms.json", import.meta.url), "utf8"));
const originals = JSON.parse(await readFile(new URL("./fixtures/photo-extra-codecs.json", import.meta.url), "utf8"));
const families = JSON.parse(await readFile(new URL("./fixtures/photo-acceptance-formats.json", import.meta.url), "utf8"));
const fixture = name => { const source = Buffer.from(transforms[name].base64, "base64");
  assert.equal(createHash("sha256").update(source).digest("hex"), transforms[name].sha256); return source; };
const rejected = expected => error => error.code === expected && error.message === "Photo conversion failed.";

test("the modern bounded AVIF decoder accepts static and sequence sources, returning only a reduced first image", async () => {
  const staticSource = Buffer.from(originals.avif.base64, "base64"), unchanged = Buffer.from(staticSource);
  const small = await decodeAvifOriginal(staticSource, { targetSide: 32 });
  assert.deepEqual([small.width, small.height, small.channels], [32, 24, 4]); assert.deepEqual(staticSource, unchanged);
  assert.equal(small.data.length, 32 * 24 * 4);
  const sequence = Buffer.from(families.fixtures.find(value => value.name === "avif-two-frames").base64, "base64");
  const first = await decodeAvifOriginal(sequence);
  assert.deepEqual([first.width, first.height], [32, 24]);
  assert.ok(first.data[0] > 210 && first.data[2] < 110, "first red frame rather than the following blue frame");
});

test("AVIF primary rotation and both mirror axes map the actual decoded pixels; unrelated properties do not transform", async () => {
  const base = await decodeAvifOriginal(fixture("base")); assert.deepEqual([base.width, base.height], [16, 8]);
  for (const [name, width, height, map] of [["rotate90ccw", 8, 16, (x, y) => [y, 15 - x]],
    ["mirrorTopBottom", 16, 8, (x, y) => [x, 7 - y]], ["mirrorLeftRight", 16, 8, (x, y) => [15 - x, y]],
    ["unassociatedRotation", 16, 8, (x, y) => [x, y]]]) {
    const image = await decodeAvifOriginal(fixture(name)); assert.deepEqual([image.width, image.height], [width, height], name);
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
      const [nx, ny] = map(x, y);
      assert.equal(image.data.readUInt32LE((ny * width + nx) * 4), base.data.readUInt32LE((y * base.width + x) * 4), `${name}:${x},${y}`);
    }
  }
});

test("AVIF caller limits only restrict native defaults and corrupt/nonimage inputs expose sanitized errors", async () => {
  const source = fixture("base");
  for (const options of [{ maxPixels: 64000001 }, { targetSide: 0 }, { targetSide: 2049 }, { maxSide: 0 }]) await assert.rejects(decodeAvifOriginal(source, options), rejected("MEDIA_INPUT"));
  for (const options of [{ maxPixels: 100 }, { maxSide: 8 }]) await assert.rejects(decodeAvifOriginal(source, options), rejected("MEDIA_DIMENSIONS"));
  for (const bytes of [Buffer.from("private-secret-svg"), source.subarray(0, 24)]) await assert.rejects(decodeAvifOriginal(bytes), rejected("MEDIA_FORMAT"));
});
