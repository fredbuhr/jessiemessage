import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RAW_IMAGE_HINTS } from "../server/media/image.mjs";

// OS file pickers may not associate newer formats or camera RAW extensions
// with image/*. Their explicit extensions must reach the byte-checked pipeline.
test("all four photo pickers expose the supported raster and RAW extensions without a video filter", async () => {
  const required = ["image/*", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif", ".jxl", ".bmp", ".tif", ".tiff",
    ...RAW_IMAGE_HINTS.map(format => `.${format}`)];
  const pickers = [];
  for (const [file, id] of [["chat.html", "image-file"], ["media-library-page.html", "photo-file"], ["broadcast.html", "photo-file"]]) {
    const source = await readFile(new URL(`../public/${file}`, import.meta.url), "utf8");
    const tag = source.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `${file}: photo input exists`);
    pickers.push([file, /\baccept="([^"]*)"/.exec(tag)?.[1]]);
  }
  const profile = await readFile(new URL("../public/profile.js", import.meta.url), "utf8");
  pickers.push(["profile.js", /file\.accept = "([^"]*)"/.exec(profile)?.[1]]);
  for (const [file, accept] of pickers) {
    assert.equal(typeof accept, "string", `${file}: explicit picker formats`);
    assert.deepEqual(accept.split(",").sort(), [...required].sort(), file);
    assert.equal(new Set(accept.split(",")).size, required.length, `${file}: no duplicate extensions`);
  }
});
