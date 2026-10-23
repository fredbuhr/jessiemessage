import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicProfileStore } from "../server/public-profile/store.mjs";
import { createPublicProfileService } from "../server/public-profile/service.mjs";
import { PublicProfileError, PREFERENCES_CATALOGUE_VERSION, validatePublicProfileInput } from "../server/public-profile/validation.mjs";
import { preferencesIndex } from "../server/preferences/validation.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const token = Buffer.alloc(32, 8).toString("base64url"), owner = "a".repeat(32), now = 1792769486560;
const ids = [...preferencesIndex.keys()].slice(0, 2), catalogueVersion = PREFERENCES_CATALOGUE_VERSION;
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
  assert.deepEqual(publicView, { displayName: "Jessie", bio: input().bio, catalogueVersion, selectedIds: [ids[0]] });
  assert.deepEqual(Object.keys(publicView).sort(), ["bio", "catalogueVersion", "displayName", "selectedIds"]);
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
    if (defect === "duplicate") await writeFile(filename, before.replace('"format":1', '"format":1,"format":1'));
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
