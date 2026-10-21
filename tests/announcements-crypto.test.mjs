import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sealAnnouncement, openAnnouncement, announcementFingerprint } from "../server/announcements/crypto.mjs";
import { validateSave, validateRemove } from "../server/announcements/validation.mjs";

const key = randomBytes(32), adminId = randomBytes(16);
const binding = { adminId, id: randomBytes(16), revision: "1", startsAt: 1792594800000, expiresAt: 1792598400000, sendPrivateMessage: false };
const body = "Je commence à 22 h 💋\n<script>ceci reste du texte</script>";
const input = changes => ({ mutationId: "a".repeat(32), expectedRevision: "0", body, startsAt: null,
  expiresAt: binding.expiresAt, sendPrivateMessage: false, previewToken: null, ...changes });

test("announcement encryption round-trips plain Unicode and authenticates every immutable binding", () => {
  const encrypted = sealAnnouncement({ body }, key, binding);
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+$/);
  assert.ok(encrypted.length < 8192); assert.ok(!encrypted.includes("commence"));
  assert.deepEqual(openAnnouncement(encrypted, key, binding), { body });
  for (const changed of [{ adminId: randomBytes(16) }, { id: randomBytes(16) }, { revision: "2" }, { startsAt: binding.startsAt + 1 },
    { expiresAt: binding.expiresAt + 1 }, { sendPrivateMessage: true }]) assert.throws(() => openAnnouncement(encrypted, key, { ...binding, ...changed }));
  assert.throws(() => openAnnouncement(encrypted, randomBytes(32), binding));
  const bytes = Buffer.from(encrypted.slice(3), "base64url"); bytes[20] ^= 1;
  assert.throws(() => openAnnouncement("v1." + bytes.toString("base64url"), key, binding));
  for (const value of [encrypted + "=", encrypted.replace("v1.", "v2."), "v1.AA", null, "v1." + "a".repeat(8192)]) assert.throws(() => openAnnouncement(value, key, binding));
});
test("announcement ciphertext is randomized while retry fingerprints are stable, scoped and complete", () => {
  assert.notEqual(sealAnnouncement({ body }, key, binding), sealAnnouncement({ body }, key, binding));
  const value = { kind: "save", ...input() }, first = announcementFingerprint(value, key, { adminId });
  assert.ok(first.equals(announcementFingerprint(value, key, { adminId })));
  for (const changed of [{ body: body + "!" }, { startsAt: binding.startsAt }, { expectedRevision: "1" }, { mutationId: "b".repeat(32) }]) {
    assert.ok(!first.equals(announcementFingerprint({ ...value, ...changed }, key, { adminId })));
  }
  assert.ok(!first.equals(announcementFingerprint(value, key, { adminId: randomBytes(16) })));
  assert.throws(() => sealAnnouncement({ body, secret: true }, key, binding));
});
test("announcement input is bounded, canonical and getter-free, with explicit private-message confirmation", () => {
  assert.deepEqual(validateSave(input()), input());
  const valid = input({ body: "a".repeat(1000), sendPrivateMessage: true, previewToken: "token" }); assert.deepEqual(validateSave(valid), valid);
  const invalid = [input({ body: "a".repeat(1001) }), input({ body: "\u200b" }), input({ body: "\ud800" }), input({ body: "x\0y" }),
    input({ expectedRevision: "01" }), input({ expectedRevision: "18446744073709551616" }), input({ expectedRevision: 0 }),
    input({ mutationId: "A".repeat(32) }), input({ startsAt: binding.expiresAt }), input({ expiresAt: NaN }),
    input({ sendPrivateMessage: true }), input({ previewToken: "unexpected" }), input({ sendPrivateMessage: 1 }), { ...input(), extra: 1 }];
  for (const value of invalid) assert.throws(() => validateSave(value), { code: "ANNOUNCEMENTS_INPUT" });
  const getter = input(); Object.defineProperty(getter, "body", { enumerable: true, get() { throw new Error("getter invoked"); } });
  assert.throws(() => validateSave(getter), { code: "ANNOUNCEMENTS_INPUT" });
  assert.deepEqual(validateRemove({ mutationId: "a".repeat(32), expectedRevision: "18446744073709551615" }), { mutationId: "a".repeat(32), expectedRevision: "18446744073709551615" });
  assert.throws(() => validateRemove({ mutationId: "a".repeat(32), expectedRevision: "0", body }));
});
