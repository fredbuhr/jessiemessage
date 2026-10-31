import test from "node:test";
import assert from "node:assert/strict";
import { encodeInboxCursor, decodeInboxCursor } from "../server/chat/inbox-cursor.mjs";

const value = [2, "2026-10-31 12:34:56.123456", "a".repeat(32)];
const raw = value => Buffer.from(JSON.stringify(value)).toString("base64url");

test("conversation inbox cursor preserves SQL microseconds and has one bounded versioned spelling", () => {
  const cursor = encodeInboxCursor(value);
  assert.ok(cursor.length <= 160);
  assert.deepEqual(decodeInboxCursor(cursor), value);
  assert.notEqual(cursor, encodeInboxCursor([2, "2026-10-31 12:34:56.123457", "a".repeat(32)]));
  assert.notEqual(cursor, encodeInboxCursor([2, value[1], "b".repeat(32)]));
});

test("conversation inbox cursor refuses incoming-only legacy positions, impossible calendars and aliases", () => {
  const invalid = [
    [0, value[1], value[2]], [1, value[1], value[2]], [3, value[1], value[2]],
    [2, "2026-02-30 12:34:56.123456", value[2]], [2, "2026-13-01 12:34:56.123456", value[2]],
    [2, "2026-10-31 24:00:00.000000", value[2]], [2, "2026-10-31 12:34:56.123", value[2]],
    [2, "1969-12-31 23:59:59.999999", value[2]], [2, value[1], "A".repeat(32)],
    [2, value[1]], [2, value[1], value[2], "extra"], { version: 2 }, null,
  ];
  for (const item of invalid) {
    assert.throws(() => encodeInboxCursor(item), TypeError);
    assert.throws(() => decodeInboxCursor(raw(item)), TypeError);
  }
  const cursor = encodeInboxCursor(value);
  for (const item of ["", "x".repeat(161), cursor + "=", raw(value) + "\n", Buffer.from(JSON.stringify(value) + " ").toString("base64url"), "invalid"]) {
    assert.throws(() => decodeInboxCursor(item));
  }
});
