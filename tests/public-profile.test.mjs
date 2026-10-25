import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicProfileStore } from "../server/public-profile/store.mjs";
import { createPublicProfileService } from "../server/public-profile/service.mjs";
import { PublicProfileError, PREFERENCES_CATALOGUE_VERSION, validatePublicProfileInput, validatePublicProfileState } from "../server/public-profile/validation.mjs";
import { preferencesIndex } from "../server/preferences/validation.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const token = Buffer.alloc(32, 8).toString("base64url"), owner = "a".repeat(32), now = 1792769486560;
const ids = [...preferencesIndex.keys()].slice(0, 2), catalogueVersion = PREFERENCES_CATALOGUE_VERSION;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const input = (expectedVersion = "0", published = true) => ({ expectedVersion, published, displayName: "Jessie", bio: "Présentation publique.\nBienvenue.", catalogueVersion, selectedIds: [ids[0]] });
async function fixture(t) {
  const directory = await erasureDirectory(t); let authorized = true, checks = 0;
  const store = createPublicProfileStore(directory, { withDirectory: withErasureDirectory });
  const chatService = { async actor(role, value) {
    checks++; assert.equal(role, "admin"); assert.equal(value, token);
    if (!authorized) throw Object.assign(new Error("private authentication detail"), { code: "CHAT_UNAUTHORIZED" });
    return { user: { role: "admin", id: owner }, csrf: token };
  } };
  const make = (overrides = {}) => createPublicProfileService({ directory, chatService, authStore: { async consumeRateLimit() { return { allowed: true }; } }, key: Buffer.alloc(32, 7), clock: () => now, ...overrides }, { store });
  const service = make(); t.after(() => service.close());
  return { directory, store, service, make, revoke() { authorized = false; }, get checks() { return checks; } };
}

test("public profile starts hidden and explicit snapshots survive reload, private edits and unpublishing", async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.publicView(), { code: "PUBLIC_PROFILE_NOT_FOUND" });
  assert.equal((await f.service.read(token)).published, false);
  assert.deepEqual(await readdir(f.directory), []);
  const saved = await f.service.save(token, input()); assert.equal(saved.version, "1"); assert.equal(f.checks, 4);
  const publicView = await f.service.publicView();
  assert.deepEqual(publicView, { displayName: "Jessie", bio: input().bio, catalogueVersion, selectedIds: [ids[0]], avatarVersion: null });
  assert.deepEqual(Object.keys(publicView).sort(), ["avatarVersion", "bio", "catalogueVersion", "displayName", "selectedIds"]);
  assert.equal((await lstat(path.join(f.directory, "jessie-public-profile.json"))).mode & 0o7777, 0o600);
  const fresh = f.make(); t.after(() => fresh.close()); assert.deepEqual(await fresh.publicView(), publicView);
  const privateSelection = [ids[1]]; privateSelection.push(ids[0]); // A private selection is not a publication input.
  assert.deepEqual(await fresh.publicView(), publicView);
  const hidden = await fresh.save(token, input("1", false)); assert.equal(hidden.version, "2"); assert.deepEqual(hidden.selectedIds, [ids[0]]);
  await assert.rejects(f.service.publicView(), { code: "PUBLIC_PROFILE_NOT_FOUND" });
  assert.deepEqual(await readdir(f.directory), ["jessie-public-profile.json"]);
});

test("public profile CAS refuses a stale device and revoked authorization before commit preserves prior publication", async t => {
  const f = await fixture(t); await f.service.save(token, input());
  await assert.rejects(f.service.save(token, input()), { code: "PUBLIC_PROFILE_CONFLICT" });
  const before = await readFile(path.join(f.directory, "jessie-public-profile.json"));
  let revoked = false;
  const service = createPublicProfileService({ directory: f.directory, chatService: { async actor() {
    // Use an independent authority to revoke precisely in beforeCommit.
    if (revoked) throw Object.assign(new Error("private detail"), { code: "CHAT_UNAUTHORIZED" });
    return { user: { role: "admin", id: owner }, csrf: token };
  } }, authStore: { async consumeRateLimit() { return { allowed: true }; } }, key: Buffer.alloc(32), clock: () => now }, {
    store: { read: f.store.read, save: (value, revision, beforeCommit) => f.store.save(value, revision, async () => { revoked = true; await beforeCommit(); }) },
  });
  t.after(() => service.close());
  await assert.rejects(service.save(token, input("1", false)), error => error instanceof PublicProfileError && error.code === "PUBLIC_PROFILE_UNAUTHORIZED" && !error.message.includes("private detail"));
  assert.deepEqual(await readFile(path.join(f.directory, "jessie-public-profile.json")), before);
  assert.equal((await f.service.publicView()).displayName, "Jessie");
  assert.deepEqual(await readdir(f.directory), ["jessie-public-profile.json"]);
});

test("publication validation rejects unknown IDs, duplicates, hidden owner fields, getters, malformed versions and oversized text", () => {
  for (const value of [{ ...input(), userId: owner }, { ...input(), selectedIds: [ids[0], ids[0]] }, { ...input(), selectedIds: ["pref_c01_missing"] },
    { ...input(), expectedVersion: "01" }, { ...input(), expectedVersion: "4294967295" }, { ...input(), displayName: "" }, { ...input(), bio: "a".repeat(1001) },
    { ...input(), displayName: "Jessie\u0000" }, { ...input(), get bio() { assert.fail("Getter invoked"); } }]) {
    assert.throws(() => validatePublicProfileInput(value), { code: "PUBLIC_PROFILE_INPUT" });
  }
});

test("competing publication writers cannot silently overwrite an acknowledged snapshot", async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.service.save(token, input()), f.service.save(token, { ...input(), bio: "Other device" })]);
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(results.filter(value => value.status === "rejected").length, 1);
  assert.equal((await f.service.read(token)).version, "1");
  assert.deepEqual(await readdir(f.directory), ["jessie-public-profile.json"]);
});

test("untrusted published files fail closed and preserve bytes", async t => {
  for (const defect of ["duplicate", "permissions", "symlink"]) {
    const f = await fixture(t); await f.service.save(token, input());
    const filename = path.join(f.directory, "jessie-public-profile.json"), before = await readFile(filename, "utf8");
    if (defect === "duplicate") await writeFile(filename, before.replace(/"format":([12])/, '"format":$1,"format":$1'));
    if (defect === "permissions") await chmod(filename, 0o644);
    if (defect === "symlink") { const other = path.join(f.directory, "other.json"); await writeFile(other, before, { mode: 0o600 }); const { unlink } = await import("node:fs/promises"); await unlink(filename); await symlink(other, filename); }
    const bytes = await readFile(filename);
    await assert.rejects(f.service.publicView());
    assert.deepEqual(await readFile(filename), bytes);
  }
});

test("public-profile budgets reject denied reads and shutdown never returns saved content", async t => {
  const f = await fixture(t);
  const denied = f.make({ authStore: { async consumeRateLimit() { return { allowed: false, retryAfter: 5 }; } } }); t.after(() => denied.close());
  await assert.rejects(denied.publicView(), { code: "PUBLIC_PROFILE_RATE_LIMIT" });
  f.service.close(); await assert.rejects(f.service.publicView(), { code: "PUBLIC_PROFILE_UNAVAILABLE" });
});

test("public avatar is an explicit immutable snapshot and public reads never consult the private avatar", async t => {
  const f = await fixture(t); let privateImage = Buffer.from(jpeg), profileReads = 0, avatarReads = 0;
  const profileService = {
    async profile(role, value) { profileReads++; assert.equal(role, "admin"); assert.equal(value, token); return { pseudonym: "Jessie", version: "7", avatarId: "b".repeat(32), avatarUrl: "/api/profile/admin/avatar?v=7" }; },
    async avatar(role, value, version) { avatarReads++; assert.equal(role, "admin"); assert.equal(value, token); assert.equal(version, "7"); return { bytes: Buffer.from(privateImage), mime: "image/jpeg" }; },
  };
  const service = f.make({ profileService }); t.after(() => service.close());
  await assert.rejects(service.publicAvatar("1"), { code: "PUBLIC_PROFILE_NOT_FOUND" });
  assert.equal(profileReads, 0); assert.equal(avatarReads, 0);
  await service.save(token, input());
  assert.equal(profileReads, 1); assert.equal(avatarReads, 1);
  const publicView = await service.publicView(); assert.equal(publicView.avatarVersion, "1");
  assert.equal(JSON.stringify(publicView).includes("b".repeat(32)), false, "private media identifiers never enter the public DTO");
  privateImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 0xff, 0xd9]);
  assert.deepEqual((await service.publicAvatar("1")).bytes, jpeg);
  assert.equal(profileReads, 1); assert.equal(avatarReads, 1, "public GET uses only the saved publication");
  const fresh = f.make({ profileService }); t.after(() => fresh.close());
  assert.deepEqual((await fresh.publicAvatar("1")).bytes, jpeg, "snapshot survives a service reload");
  await service.save(token, input("1", false));
  assert.equal(profileReads, 1); assert.equal(avatarReads, 1, "unpublishing does not recopy a private photo");
  await assert.rejects(service.publicAvatar("1"), { code: "PUBLIC_PROFILE_NOT_FOUND" });
  await assert.rejects(service.publicAvatar("2"), { code: "PUBLIC_PROFILE_NOT_FOUND" });
  await service.save(token, input("2", true));
  assert.deepEqual((await service.publicAvatar("3")).bytes, privateImage);
  await assert.rejects(service.publicAvatar("1"), { code: "PUBLIC_PROFILE_NOT_FOUND" });
  assert.equal(profileReads, 2); assert.equal(avatarReads, 2);
  const state = JSON.parse(await readFile(path.join(f.directory, "jessie-public-profile.json"), "utf8"));
  assert.equal(state.format, 2); assert.equal(state.avatar, privateImage.toString("base64"));
});

test("legacy format1 remains readable without an image and is replaced only by explicit publication", async t => {
  const f = await fixture(t), filename = path.join(f.directory, "jessie-public-profile.json");
  const legacy = { format: 1, revision: 4, published: true, displayName: "Jessie", bio: input().bio, catalogueVersion, selectedIds: [ids[0]] };
  const bytes = Buffer.from(JSON.stringify(legacy) + "\n"); await writeFile(filename, bytes, { mode: 0o600 });
  assert.deepEqual(validatePublicProfileState(legacy), legacy, "reader does not silently upgrade the canonical historical format");
  assert.equal((await f.service.publicView()).avatarVersion, null);
  await assert.rejects(f.service.publicAvatar("4"), { code: "PUBLIC_PROFILE_NOT_FOUND" });
  assert.deepEqual(await readFile(filename), bytes, "anonymous reads never rewrite old publication files");
  await f.service.save(token, input("4"));
  assert.equal(JSON.parse(await readFile(filename, "utf8")).format, 2);
});

test("the largest permitted avatar thumbnail fits in one bounded atomic publication file", async t => {
  const f = await fixture(t), image = Buffer.alloc(131072, 9);
  jpeg.copy(image); image[image.length - 2] = 0xff; image[image.length - 1] = 0xd9;
  const service = f.make({ profileService: {
    async profile() { return { pseudonym: "Jessie", version: "3", avatarId: "b".repeat(32), avatarUrl: "/api/profile/admin/avatar?v=3" }; },
    async avatar() { return { bytes: Buffer.from(image), mime: "image/jpeg" }; },
  } }); t.after(() => service.close());
  await service.save(token, input());
  const bytes = await readFile(path.join(f.directory, "jessie-public-profile.json"));
  assert.ok(bytes.length > 131072 && bytes.length <= 262144, "base64 is held under the publication-specific file bound");
  assert.deepEqual((await service.publicAvatar("1")).bytes, image);
  assert.deepEqual(await readdir(f.directory), ["jessie-public-profile.json"], "photo and text commit as one publication");
});

test("public snapshot validation accepts only bounded canonical JPEG bytes in format2", () => {
  const base = { format: 2, revision: 1, published: true, displayName: "Jessie", bio: "", catalogueVersion, selectedIds: [], avatar: jpeg.toString("base64") };
  assert.deepEqual(validatePublicProfileState(base), base);
  assert.equal(validatePublicProfileState({ ...base, avatar: null }).avatar, null);
  const oversized = Buffer.alloc(131073); jpeg.copy(oversized); oversized[oversized.length - 2] = 0xff; oversized[oversized.length - 1] = 0xd9;
  for (const avatar of ["", jpeg.toString("base64") + "\n", "data:image/jpeg;base64," + jpeg.toString("base64"), Buffer.from("<svg onload=alert(1)>").toString("base64"), oversized.toString("base64"), jpeg.subarray(0, -1).toString("base64"), { bytes: jpeg.toString("base64") }]) {
    assert.throws(() => validatePublicProfileState({ ...base, avatar }), { code: "PUBLIC_PROFILE_INPUT" });
  }
  assert.throws(() => validatePublicProfileState({ ...base, mediaId: "b".repeat(32) }), { code: "PUBLIC_PROFILE_INPUT" });
  assert.throws(() => validatePublicProfileState({ ...base, format: 1 }), { code: "PUBLIC_PROFILE_INPUT" }, "format1 cannot hide a newly introduced field");
});

test("revocation during avatar copy cannot replace the previous published state", async t => {
  const f = await fixture(t); await f.service.save(token, input());
  const filename = path.join(f.directory, "jessie-public-profile.json"), before = await readFile(filename);
  const service = f.make({ profileService: {
    async profile() { return { pseudonym: "Jessie", version: "9", avatarId: "b".repeat(32), avatarUrl: "/api/profile/admin/avatar?v=9" }; },
    async avatar() { f.revoke(); return { bytes: Buffer.from(jpeg), mime: "image/jpeg" }; },
  } }); t.after(() => service.close());
  await assert.rejects(service.save(token, input("1")), { code: "PUBLIC_PROFILE_UNAUTHORIZED" });
  assert.deepEqual(await readFile(filename), before);
});
