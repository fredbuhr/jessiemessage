import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { formatInvitationCode, invitationDigest, isInvitationSecret, newInvitationCode, normalizeInvitationCode } from "../server/access/invitation-code.mjs";
import { tokenDigest } from "../server/auth/crypto.mjs";
import { isToken } from "../server/auth/http.mjs";

const canonical = "0123456789ABCDEFGHJK";
const displayed = "0123-4567-89AB-CDEF-GHJK";

test("invitation codes contain twenty Crockford symbols and normalize bounded ASCII separators and case", () => {
  const seen = new Set();
  for (let i = 0; i < 32; i += 1) {
    const code = newInvitationCode();
    assert.match(code, /^(?:[0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(normalizeInvitationCode(code).length, 20);
    assert.equal(formatInvitationCode(code), code);
    seen.add(code);
  }
  assert.equal(seen.size, 32);
  assert.equal(normalizeInvitationCode(" 0123 4567 89ab cdef ghjk "), canonical);
  assert.equal(formatInvitationCode("0123456789abcdefghjk"), displayed);
  for (const invalid of [null, 20, {}, "", "A".repeat(19), "A".repeat(21), "A".repeat(65),
    "AAAA-AAAA-AAAA-AAAA-AAAO", "AAAA-AAAA-AAAA-AAAA-AAAI", "AAAA-AAAA-AAAA-AAAA-AAAL", "AAAA-AAAA-AAAA-AAAA-AAAU",
    "AAAA\tAAAA-AAAA-AAAA-AAAA", "AAAA\nAAAA-AAAA-AAAA-AAAA", "Ａ".repeat(20), "AAAA_ AAAA AAAA AAAA AAAA"]) {
    assert.equal(normalizeInvitationCode(invalid), null);
    assert.equal(isInvitationSecret(invalid), false);
  }
});

test("code digest is namespaced while legacy canonical tokens always retain their old digest", () => {
  const raw = "0123456789ABCDEFGHJK";
  const expected = createHash("sha256").update("jessiemessage:invitation-code:v1\0").update(raw, "ascii").digest();
  assert.deepEqual(invitationDigest(raw), expected);
  assert.deepEqual(invitationDigest(displayed.toLowerCase()), expected);
  assert.deepEqual(invitationDigest(" 0123 4567 89ab cdef ghjk "), expected);
  assert.equal(isToken(displayed), false);
  assert.throws(() => tokenDigest(displayed));
  const legacy = "-----------------------AAAAAAAAAAAAAAAAAAAA";
  assert.equal(legacy.length, 43); assert.equal(isToken(legacy), true);
  assert.deepEqual(invitationDigest(legacy), tokenDigest(legacy));
  assert.notDeepEqual(invitationDigest(legacy), invitationDigest("A".repeat(20)));
  assert.equal(isInvitationSecret("A".repeat(42) + "B"), false);
  const zeroToken = Buffer.alloc(32).toString("base64url");
  assert.deepEqual(invitationDigest(zeroToken), tokenDigest(zeroToken));
  assert.notDeepEqual(invitationDigest("0".repeat(20)), tokenDigest(zeroToken));
});
