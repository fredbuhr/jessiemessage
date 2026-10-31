import test from "node:test";
import assert from "node:assert/strict";
import { AccessPaginationError, decodeAccessCursor, encodeAccessCursor, validateAccessPage } from "../server/access/pagination.mjs";

const position = { createdAt: "2026-10-15 06:00:00.123456", id: "0123456789abcdef0123456789abcdef" };
const encoded = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const invalid = (operation) => assert.throws(operation, (error) => error instanceof AccessPaginationError && error.code === "ACCESS_INPUT");

test("access cursors preserve exact SQL microseconds and scope without depending on a surviving row", () => {
  for (const kind of ["invitations", "clients"]) {
    const cursor = encodeAccessCursor(kind, position);
    assert.deepEqual(decodeAccessCursor(kind, cursor), position);
    assert.deepEqual(validateAccessPage(kind, { cursor, limit: 100 }), { position, limit: 100 });
    assert.notEqual(cursor, encodeAccessCursor(kind, { ...position, createdAt: "2026-10-15 06:00:00.123457" }));
    invalid(() => decodeAccessCursor(kind === "clients" ? "invitations" : "clients", cursor));
  }
});

test("access page defaults and bounds are explicit", () => {
  assert.deepEqual(validateAccessPage("clients"), { limit: 50, position: null });
  assert.deepEqual(validateAccessPage("invitations", { cursor: null, limit: 1 }), { limit: 1, position: null });
  for (const limit of [0, -1, 101, 1.5, "50", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) invalid(() => validateAccessPage("clients", { limit }));
  for (const options of [null, [], "", { after: "unexpected" }, { now: 1 }]) invalid(() => validateAccessPage("clients", options));
  for (const kind of [undefined, null, "client", "Clients", ""]) invalid(() => validateAccessPage(kind));
});

test("access cursors reject noncanonical Base64, JSON and version aliases", () => {
  const cursor = encodeAccessCursor("clients", position);
  const raw = JSON.stringify([1, "clients", position.createdAt, position.id]);
  for (const value of [null, undefined, "", 1, {}, cursor + "=", cursor + "\n", "x".repeat(257), "/+", "a",
    Buffer.from(raw + " ").toString("base64url"), Buffer.from(raw.replace("clients", "clien\\u0074s")).toString("base64url"),
    encoded([2, "clients", position.createdAt, position.id]), encoded(["1", "clients", position.createdAt, position.id]),
    encoded([1, "clients", position.createdAt, position.id, null]), encoded({ kind: "clients", ...position }), encoded(null)]) {
    invalid(() => decodeAccessCursor("clients", value));
  }
  const alias = cursor.slice(0, -1) + ({ A: "B", Q: "R", g: "h", w: "x" }[cursor.at(-1)] ?? "!");
  invalid(() => decodeAccessCursor("clients", alias));
});

test("access cursor timestamps reject normalized or out-of-range calendars and retain six decimals", () => {
  for (const createdAt of ["1969-12-31 23:59:59.999999", "2025-02-29 12:00:00.000000", "2026-02-30 12:00:00.000000",
    "2026-13-01 00:00:00.000000", "2026-01-01 24:00:00.000000", "2026-01-01 00:00:60.000000", "2026-00-01 00:00:00.000000",
    "2026-01-00 00:00:00.000000", "2026-01-01 00:00:00.123", "2026-01-01T00:00:00.123456", "10000-01-01 00:00:00.000000", "2026-01-01 00:00:00.1234567"]) {
    invalid(() => encodeAccessCursor("clients", { ...position, createdAt }));
    invalid(() => decodeAccessCursor("clients", encoded([1, "clients", createdAt, position.id])));
  }
  for (const createdAt of ["1970-01-01 00:00:00.000000", "2024-02-29 23:59:59.999999", "9999-12-31 23:59:59.999999"]) {
    assert.equal(decodeAccessCursor("clients", encodeAccessCursor("clients", { ...position, createdAt })).createdAt, createdAt);
  }
});

test("access cursor ids and position shapes have one canonical representation", () => {
  for (const id of ["", "ab", "a".repeat(33), "A".repeat(32), "g".repeat(32), position.id + "\n", null, Buffer.alloc(16)]) {
    invalid(() => encodeAccessCursor("clients", { ...position, id }));
    invalid(() => decodeAccessCursor("clients", encoded([1, "clients", position.createdAt, id])));
  }
  invalid(() => encodeAccessCursor("clients", { ...position, createdAt: position.createdAt + "\n" }));
  invalid(() => decodeAccessCursor("clients", encoded([1, "clients", position.createdAt + "\n", position.id])));
  for (const value of [null, [], { ...position, token: "private" }, { id: position.id }]) invalid(() => encodeAccessCursor("clients", value));
});


test("invitation status cursors remain scoped to their global filter and reject cross-filter reuse", () => {
  for (const state of ["pending", "used", "expired", "revoked"]) {
    const cursor = encodeAccessCursor("invitations", position, state);
    assert.deepEqual(validateAccessPage("invitations", { cursor, state, limit: 25 }), { position, state, limit: 25 });
    assert.deepEqual(decodeAccessCursor("invitations", cursor, state), position);
    invalid(() => decodeAccessCursor("invitations", cursor));
    for (const other of ["pending", "used", "expired", "revoked"].filter(value => value !== state)) invalid(() => decodeAccessCursor("invitations", cursor, other));
    invalid(() => validateAccessPage("clients", { state, cursor }));
    invalid(() => validateAccessPage("invitations", { state, cursor: encodeAccessCursor("invitations", position) }));
  }
  for (const state of ["", "available", "Pending", null, 1, [], "all\n"]) invalid(() => validateAccessPage("invitations", { state }));
});
