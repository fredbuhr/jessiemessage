import test from "node:test";
import assert from "node:assert/strict";
import { createCrmStore, CrmStoreError } from "../server/crm/store.mjs";

const id = value => Buffer.alloc(16, value);
const now = Date.UTC(2026, 9, 22, 12);
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");

function labelDeletion({ profileUpdatedAt = now + 1000 } = {}) {
  const ownerId = id(1), labelId = id(2), writes = [];
  const profile = { version: "2", notesRevision: "2", notesEncrypted: "synthetic unchanged ciphertext", updatedAt: profileUpdatedAt };
  const connection = { async query(sql, parameters) {
    if (sql.startsWith("SELECT l.id")) return [{ id: labelId, version: "1" }];
    if (sql.startsWith("SELECT p.version")) {
      const currentTime = Date.parse(parameters[2].replace(" ", "T") + "Z");
      return profile.updatedAt > currentTime ? [{ version: profile.version, updated_at: new Date(profile.updatedAt) }] : [];
    }
    if (sql.startsWith("UPDATE crm_profiles")) {
      writes.push(sql);
      profile.version = String(BigInt(profile.version) + 1n);
      profile.updatedAt = Date.parse(parameters[0].replace(" ", "T") + "Z");
      return { affectedRows: 1 };
    }
    if (sql.startsWith("DELETE FROM crm_memberships") || sql.startsWith("DELETE FROM crm_labels")) {
      writes.push(sql); return { affectedRows: 1 };
    }
    throw new Error("Unexpected synthetic CRM query.");
  } };
  const chatStore = {
    withActor: async (_request, operation) => operation(connection, { actor: { id: ownerId }, now: now + 2000 }),
    withConversation() { throw new Error("Unused conversation fixture."); },
  };
  const store = createCrmStore({ pool: { getConnection() { throw new Error("Unused pool fixture."); } }, chatStore });
  return { profile, writes, run: () => store.deleteLabel({ tokenHash: Buffer.alloc(32, 3), now, labelId, expectedVersion: "1" }) };
}

test("a label deletion uses the live authorization time after a concurrent profile save", async () => {
  const fixture = labelDeletion(), ciphertext = fixture.profile.notesEncrypted;
  assert.deepEqual(await fixture.run(), { deleted: true });
  assert.equal(fixture.writes.length, 3);
  assert.equal(fixture.profile.version, "3");
  assert.equal(fixture.profile.notesRevision, "2");
  assert.equal(fixture.profile.notesEncrypted, ciphertext);
  assert.equal(sqlDate(fixture.profile.updatedAt), sqlDate(now + 2000));
});

test("a profile date beyond the live authorization time still refuses the entire label deletion", async () => {
  const fixture = labelDeletion({ profileUpdatedAt: now + 3000 });
  await assert.rejects(fixture.run(), error => error instanceof CrmStoreError && error.code === "CRM_DATABASE_STATE");
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.profile.version, "2");
  assert.equal(fixture.profile.notesRevision, "2");
});
