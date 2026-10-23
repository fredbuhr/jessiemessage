import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import catalogue from "../public/preferences-catalogue.json" with { type: "json" };
import { buildPreferencesIndex, matchesPreference, normalizePreferenceSearch } from "../public/preferences-model.js";
import { createPreferencesService } from "../server/preferences/service.mjs";
import { openPreferences, sealPreferences } from "../server/preferences/crypto.mjs";
import { PreferencesError, validatePreferencesSave, PREFERENCES_CATALOGUE_VERSION } from "../server/preferences/validation.mjs";
const ids = [...buildPreferencesIndex(catalogue).keys()], token = randomBytes(32).toString("base64url"), key = Buffer.alloc(32, 11), owner = "a".repeat(32);
const rejected = code => error => error instanceof PreferencesError && error.code === code && !error.message.includes(ids[0]);
const selection = (selectedIds = ids.slice(0, 2), expectedVersion = "0") => ({ expectedVersion, catalogueVersion: PREFERENCES_CATALOGUE_VERSION, selectedIds });

test("the complete supplied preferences catalogue is byte exact, has stable IDs and all 934 aliases are searchable", async () => {
  const raw = await readFile(new URL("../public/preferences-catalogue.json", import.meta.url));
  assert.equal(createHash("sha256").update(raw).digest("hex"), "5ce26f14f15fb9c3447b07777aa5c8d17a6e823e8099dbb37959fc48f00f93cb");
  const index = buildPreferencesIndex(catalogue); assert.equal(index.size, 691); assert.equal(catalogue.categories.length, 25);
  let count = 0;
  for (const category of catalogue.categories) for (const entry of category.preferences) {
    for (const alias of entry.aliases) { assert.equal(matchesPreference(index.get(entry.id), alias), true); count++; }
    assert.equal(matchesPreference(index.get(entry.id), entry.fr), true); assert.equal(matchesPreference(index.get(entry.id), entry.en), true);
  }
  assert.equal(count, 934); assert.equal(normalizePreferenceSearch("  ÉCOLE—d’été! "), "ecole d ete");
});
test("unknown IDs, extra claimed identity and stale catalogue versions are rejected; duplicates canonicalize", () => {
  assert.deepEqual(validatePreferencesSave(selection([ids[1], ids[0], ids[1]])).selectedIds, ids.slice(0, 2));
  for (const value of [selection(["pref_c01_not-a-real-choice"]), { ...selection(), userId: "b".repeat(32) }, selection(ids, "01"), null]) assert.throws(() => validatePreferencesSave(value), rejected("PREFERENCES_INPUT"));
  assert.throws(() => validatePreferencesSave({ ...selection(), catalogueVersion: "old" }), rejected("PREFERENCES_CATALOGUE_CHANGED"));
});
test("private selections encrypt with an owner/version binding; edits and empty clearing remain encrypted", () => {
  for (const selectedIds of [ids.slice(0, 3), []]) {
    const value = { catalogueVersion: PREFERENCES_CATALOGUE_VERSION, selectedIds }, encrypted = sealPreferences(value, key, owner, "1");
    assert.equal(encrypted.includes(ids[0]), false); assert.deepEqual(openPreferences(encrypted, key, owner, "1"), value);
    for (const [otherKey, otherOwner, version] of [[key, "b".repeat(32), "1"], [Buffer.alloc(32, 12), owner, "1"], [key, owner, "2"]]) assert.throws(() => openPreferences(encrypted, otherKey, otherOwner, version), rejected("PREFERENCES_UNAVAILABLE"));
    assert.throws(() => openPreferences(encrypted.slice(0, -3) + "bad", key, owner, "1"), rejected("PREFERENCES_UNAVAILABLE"));
  }
});
test("a choice removed in a future catalogue is retained on reads rather than silently dropped", () => {
  const value = { catalogueVersion: "old-catalogue", selectedIds: ["pref_c01_retired-choice"] };
  assert.deepEqual(openPreferences(sealPreferences(value, key, owner, "1"), key, owner, "1"), value);
});
function fixture() {
  const rows = new Map(), state = { revoked: false, limited: false }, calls = [];
  const actors = { admin: "a".repeat(32), client: "b".repeat(32) };
  const empty = id => ({ userId: Buffer.from(id, "hex"), version: "0", encrypted: null });
  const own = request => actors[request.role];
  const store = {
    async read(request) { calls.push(["read", request]); if (state.revoked) throw { code: "CHAT_UNAUTHORIZED" }; return rows.get(own(request)) ?? empty(own(request)); },
    async peer(request) { calls.push(["peer", request]); if (request.conversationId.toString("hex") !== "c".repeat(32)) throw { code: "CHAT_NOT_FOUND" }; return rows.get(actors.client) ?? empty(actors.client); },
    async save(request) {
      const id = own(request), current = rows.get(id) ?? empty(id); calls.push(["save", request]);
      if (current.version !== request.expectedVersion) { if (String(Number(request.expectedVersion) + 1) === current.version && request.same(current)) return current; throw new PreferencesError("PREFERENCES_CONFLICT"); }
      const version = String(Number(current.version) + 1), row = { userId: Buffer.from(id, "hex"), version, encrypted: request.encrypt(id, version) }; rows.set(id, row); return row;
    },
  };
  const service = createPreferencesService({ store, key, clock: () => 1792748656772,
    chatService: { async actor(role) { if (state.revoked) throw { code: "CHAT_UNAUTHORIZED" }; return { user: { id: actors[role], role }, csrf: token }; } },
    authStore: { async consumeRateLimit() { return { allowed: !state.limited }; } },
  });
  return { service, store, rows, state, calls, actors };
}
test("own admin/client selections survive service reads across sessions, clear independently and never trust claimed IDs", async () => {
  const f = fixture();
  for (const role of ["admin", "client"]) {
    assert.deepEqual((await f.service.read(role, token)).selectedIds, []);
    const result = await f.service.save(role, token, selection()); assert.deepEqual(result.selectedIds, ids.slice(0, 2));
    assert.deepEqual(await f.service.read(role, randomBytes(32).toString("base64url")), result);
    assert.deepEqual(await f.service.save(role, token, selection()), result, "lost response replay is idempotent");
  }
  await f.service.save("client", token, selection([], "1"));
  assert.deepEqual((await f.service.read("client", token)).selectedIds, []);
  assert.equal((await f.service.read("admin", token)).selectedIds.length, 2);
  await assert.rejects(f.service.save("client", token, { ...selection(), userId: f.actors.admin }), rejected("PREFERENCES_INPUT"));
  assert.ok(f.calls.every(([, request]) => request.userId === undefined));
});
test("only authorised administrators can read a client's selection through its conversation", async () => {
  const f = fixture(); await f.service.save("client", token, selection());
  assert.deepEqual((await f.service.peer("admin", token, "c".repeat(32))).selectedIds, ids.slice(0, 2));
  await assert.rejects(f.service.peer("client", token, "c".repeat(32)), rejected("PREFERENCES_FORBIDDEN"));
  await assert.rejects(f.service.peer("admin", token, "d".repeat(32)), rejected("PREFERENCES_NOT_FOUND"));
});
test("stale concurrent selections conflict without overwrite, and revoked/limited requests cannot write", async () => {
  const f = fixture(); await f.service.save("client", token, selection());
  await assert.rejects(f.service.save("client", token, selection([ids[2]], "0")), rejected("PREFERENCES_CONFLICT"));
  f.state.limited = true; await assert.rejects(f.service.save("client", token, selection([], "1")), rejected("PREFERENCES_RATE_LIMIT"));
  f.state.limited = false; f.state.revoked = true; await assert.rejects(f.service.read("client", token), rejected("PREFERENCES_UNAUTHORIZED"));
  f.state.revoked = false; assert.equal((await f.service.read("client", token)).version, "1");
  f.service.close(); await assert.rejects(f.service.read("client", token), rejected("PREFERENCES_UNAVAILABLE"));
});
