import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { VIDEO_CREATION_ENABLED, QUICK_REPLIES_WRITABLE } from "../server/release-features.mjs";

test("technical 1.7.2 leaves new writers dormant; product releases enable their authored creation gates", async () => {
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const productRelease = version !== "1.7.2";
  assert.equal(VIDEO_CREATION_ENABLED, productRelease);
  assert.equal(QUICK_REPLIES_WRITABLE, productRelease);
});
