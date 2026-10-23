import test from "node:test";
import assert from "node:assert/strict";
import { validatePublicProfile } from "../public/public-profile-model.js";
import catalogue from "../public/preferences-catalogue.json" with { type: "json" };

const publicView = () => ({ displayName: "Jessie", bio: "Quelques mots\nUne seconde ligne.", catalogueVersion: catalogue.meta.version, selectedIds: [catalogue.categories[0].preferences[0].id] });
test("public profile client model accepts bounded public snapshots without treating user text as markup", () => {
  const value = publicView(); value.displayName = "<img onerror=alert(1)>";
  assert.deepEqual(validatePublicProfile(value), value);
  const admin = { ...value, version: "5", published: true };
  assert.deepEqual(validatePublicProfile(admin, true), admin);
  const copy = validatePublicProfile(admin, true); copy.selectedIds.push("pref_c01_example"); assert.equal(admin.selectedIds.length, 1);
});
test("public profile client model rejects private fields, malformed versions and unbounded or duplicate choices", () => {
  for (const change of [{ ownerId: "a".repeat(32) }, { displayName: "" }, { bio: "x".repeat(1001) }, { bio: "bad\u0000text" }, { catalogueVersion: "old" }, { selectedIds: ["bad"] }, { selectedIds: [publicView().selectedIds[0], publicView().selectedIds[0]] }]) assert.throws(() => validatePublicProfile({ ...publicView(), ...change }));
  assert.throws(() => validatePublicProfile({ ...publicView(), version: "4294967296", published: true }, true));
  assert.throws(() => validatePublicProfile({ ...publicView(), version: "1", published: "yes" }, true));
});
