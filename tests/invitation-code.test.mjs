import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { formatInvitationCode, invitationDigest, isInvitationSecret, newInvitationCode, normalizeInvitationCode } from "../server/access/invitation-code.mjs";
import { tokenDigest } from "../server/auth/crypto.mjs";
import { isToken } from "../server/auth/http.mjs";
import { normalizeInvitationCode as normalizePublicCode } from "../public/invitation-code.js";

const canonical = "0123456789ABCDEFGHJK";
const displayed = "0123-4567-89AB-CDEF-GHJK";

test("invitation codes contain twenty Crockford symbols and share the public normalizer", () => {
  assert.equal(normalizeInvitationCode, normalizePublicCode);
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
});

test("mobile copy separators and Crockford aliases preserve the canonical code and digest", () => {
  for (const separator of ["-", " ", "\t", "\r", "\n", "\r\n", "\u00a0", "\u202f", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"]) {
    const copied = `${separator}${["ol23", "4567", "89ab", "cdef", "ghjk"].join(separator)}${separator}`;
    assert.equal(normalizeInvitationCode(copied), canonical);
    assert.equal(formatInvitationCode(copied), displayed);
    assert.deepEqual(invitationDigest(copied), invitationDigest(canonical));
  }
  assert.equal(normalizeInvitationCode("OiLl" + "A".repeat(16)), "0111" + "A".repeat(16));
  assert.equal(normalizeInvitationCode(" ".repeat(44) + canonical), canonical);
});

test("code normalization rejects unlisted Unicode, controls, punctuation and incorrect lengths", () => {
  for (const invalid of [null, 20, {}, [], "", "A".repeat(19), "A".repeat(21), "A".repeat(65),
    " ".repeat(45) + canonical, "AAAA-AAAA-AAAA-AAAA-AAAU", "AAAA-AAAA-AAAA-AAAA-AAAu",
    "Ａ".repeat(20), "AAAA_ AAAA AAAA AAAA AAAA",
    ...["\u0000", "\v", "\f", "\u0085", "\u2000", "\u2009", "\u200b", "\u200c", "\u200d", "\u2060", "\ufeff", "/", ":", ".", "\u2015", "\u2043", "\uff0d", "Ο", "О", "İ"].map(symbol => "A".repeat(19) + symbol)]) {
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
  for (const alias of ["O", "I", "L", "o", "i", "l"]) {
    const codeAlias = alias.repeat(19) + "A";
    const legacyAlias = "-".repeat(23) + codeAlias;
    assert.equal(isToken(legacyAlias), true);
    assert.deepEqual(invitationDigest(legacyAlias), tokenDigest(legacyAlias));
    assert.notDeepEqual(invitationDigest(legacyAlias), invitationDigest(codeAlias));
  }
});
