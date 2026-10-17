import test from "node:test";
import assert from "node:assert/strict";
import { parseEntry, createEntryState, clearEntry, currentEntry, beginEntryCheck, acceptEntry, rejectEntry } from "../public/entry-model.js";

const entry = (client = null, administrator = null) => ({ status: client || administrator ? "available" : "unavailable", client, administrator });
const clientStates = [{ state: "signed_out", href: "/access" }, { state: "pending", href: "/access" }, { state: "expired", href: "/access" }, { state: "active", href: "/access" }, { state: "active", href: "/messages" }];
const adminStates = [{ state: "signed_out", href: "/admin/login" }, { state: "connected", href: "/admin" }, { state: "connected", href: "/admin/messages" }];

test("entry accepts every configured client and administrator destination, including two explicit roles", () => {
  for (const client of [null, ...clientStates]) for (const administrator of [null, ...adminStates]) {
    const input = entry(client, administrator); assert.deepEqual(parseEntry(input), input);
  }
});

test("entry rejects role and destination contradictions, arbitrary redirects and forged availability", () => {
  const invalid = [entry({ state: "pending", href: "/messages" }), entry({ state: "expired", href: "/messages" }), entry({ state: "signed_out", href: "/messages" }),
    entry({ state: "active", href: "/admin/messages" }), entry({ state: "approved", href: "/messages" }), entry(null, { state: "signed_out", href: "/admin" }),
    entry(null, { state: "connected", href: "/admin/login" }), entry(null, { state: "active", href: "/admin/messages" }),
    { status: "available", client: null, administrator: null }, { status: "unavailable", client: clientStates[0], administrator: null }, { status: "ready", client: null, administrator: null }];
  for (const href of ["https://example.invalid/", "//example.invalid", "javascript:alert(1)", "/access?next=/admin", "/access#invitation=secret", "/messages\n", " /messages", null, ["/messages"]]) invalid.push(entry({ state: "active", href }));
  for (const input of invalid) assert.throws(() => parseEntry(input), /invalid_entry/);
});

test("entry requires only the exact public whitelist and never accepts identity or token fields", () => {
  const valid = entry(clientStates[4], adminStates[2]);
  for (const value of [null, {}, [], true, { ...valid, name: "private" }, { ...valid, client: { ...valid.client, id: "private" } },
    { ...valid, administrator: { ...valid.administrator, csrf: "private" } }, { status: "available", client: valid.client }, { ...valid, client: undefined }, { ...valid, administrator: [] }]) assert.throws(() => parseEntry(value), /invalid_entry/);
  const input = entry({ ...clientStates[4] }, { ...adminStates[2] }), parsed = parseEntry(input);
  input.client.href = "/access"; input.administrator.state = "signed_out";
  assert.deepEqual(parsed, valid); assert.deepEqual(Object.keys(parsed).sort(), ["administrator", "client", "status"]);
});

test("entry parsing rejects accessors, symbols and custom objects without executing getters", () => {
  let calls = 0; const input = entry(clientStates[4]);
  Object.defineProperty(input, "client", { enumerable: true, get() { calls += 1; return clientStates[4]; } });
  assert.throws(() => parseEntry(input), /invalid_entry/); assert.equal(calls, 0);
  const withSymbol = entry(clientStates[4]); withSymbol[Symbol("private")] = "private";
  assert.throws(() => parseEntry(withSymbol), /invalid_entry/);
  const custom = Object.assign(Object.create({ inherited: true }), entry(clientStates[4])); assert.throws(() => parseEntry(custom), /invalid_entry/);
});

test("hidden or replaced checks cannot restore entry links and errors never imply a signed-out session", () => {
  const state = createEntryState(); assert.equal(state.entry, null); assert.equal(state.visible, false);
  const old = beginEntryCheck(state); assert.equal(currentEntry(state, old), true);
  clearEntry(state); assert.equal(acceptEntry(state, old, entry(clientStates[4])), false); assert.equal(rejectEntry(state, old), false);
  const current = beginEntryCheck(state); assert.equal(acceptEntry(state, old, entry(clientStates[4])), false);
  assert.equal(rejectEntry(state, current), true); assert.equal(state.phase, "error"); assert.equal(state.entry, null);
  const offline = beginEntryCheck(state); assert.equal(rejectEntry(state, offline, { offline: true }), true); assert.equal(state.phase, "offline"); assert.equal(state.entry, null);
});

test("successful entry remains a choice and clearing the page discards every previous destination", () => {
  const state = createEntryState(), ticket = beginEntryCheck(state);
  assert.equal(acceptEntry(state, ticket, entry(clientStates[4], adminStates[2])), true); assert.equal(state.phase, "available");
  assert.equal(state.entry.client.href, "/messages"); assert.equal(state.entry.administrator.href, "/admin/messages");
  clearEntry(state); assert.equal(state.phase, "idle"); assert.equal(state.entry, null);
  const next = beginEntryCheck(state); assert.equal(acceptEntry(state, next, entry()), true); assert.equal(state.phase, "unavailable");
  assert.equal(state.entry.client, null); assert.equal(state.entry.administrator, null);
});

test("device resume links are exact local choices for the corresponding signed-out role", () => {
  const value = entry({ state: "signed_out", href: "/connect-device/client" }, { state: "signed_out", href: "/connect-device/admin" });
  assert.deepEqual(parseEntry(value), value);
  for (const state of ["active", "pending", "expired"]) assert.throws(() => parseEntry(entry({ state, href: "/connect-device/client" })), /invalid_entry/);
  for (const href of ["/connect-device/admin", "/connect-device/client?next=/messages", "https://jessiemessage.com/connect-device/client"])
    assert.throws(() => parseEntry(entry({ state: "signed_out", href })), /invalid_entry/);
  assert.throws(() => parseEntry(entry(null, { state: "connected", href: "/connect-device/admin" })), /invalid_entry/);
});
