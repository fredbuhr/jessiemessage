import test from "node:test";
import assert from "node:assert/strict";
import { createQuickRepliesService } from "../server/quick-replies/service.mjs";

const token = Buffer.alloc(32, 1).toString("base64url"), csrf = Buffer.alloc(32, 2).toString("base64url"), owner = "a".repeat(32), now = 1792350000000;
const replies = [{ id: "b".repeat(32), title: "Saved", body: "Synthetic personal reply", language: "en" }];
function fixture(overrides = {}) {
  const state = { role: "admin", liveOwner: owner, fileReads: 0, fileSaves: 0, factoryCalls: 0, closedFiles: 0, lock: false, rate: true, now, authWait: null };
  const session = () => ({ user: { id: owner, role: state.role }, csrf, expiresAt: now + 60000 });
  const service = createQuickRepliesService({ directory: "/synthetic/private", key: Buffer.alloc(32, 7), clock: () => state.now,
    chatService: { async actor(role, value) { assert.equal(role, "admin"); assert.equal(value, token); if (state.authWait) await state.authWait; return session(); } },
    chatStore: { async withActor(request, work) { assert.equal(request.role, "admin"); assert.equal(request.tokenHash.length, 32); state.lock = true; try { return await work({}, { actor: { id: Buffer.from(state.liveOwner, "hex"), role: "admin" } }); } finally { state.lock = false; } } },
    authStore: { async consumeRateLimit() { return { allowed: state.rate, retryAfter: 17 }; } }, ...overrides },
  { filesFor(id) { state.factoryCalls++; assert.equal(id, owner); return {
    async read() { assert.equal(state.lock, true); state.fileReads++; state.onRead?.(); return { revision: 1, ownerId: owner, replies }; },
    async save(value, expected, authorize) { assert.equal(state.lock, true); state.fileSaves++; assert.deepEqual(value, replies); assert.equal(expected, 1); state.onSave?.(); await authorize(); return { revision: 2, ownerId: owner, replies }; },
    close() { state.closedFiles++; },
  }; } });
  return { state, service };
}
test("saved replies are private to the authenticated admin and authorized under the SQL account lock", async () => {
  const f = fixture(); assert.deepEqual(await f.service.read(token), { version: "1", replies });
  assert.deepEqual(await f.service.save(token, { expectedVersion: "1", replies }), { version: "2", replies });
  assert.equal(f.state.factoryCalls, 1); assert.equal(f.state.fileReads, 1); assert.equal(f.state.fileSaves, 1);
  f.service.close(); f.service.close(); assert.equal(f.state.closedFiles, 1);
  await assert.rejects(f.service.read(token), { code: "QUICK_REPLIES_UNAVAILABLE" });
});
test("clients, invalid sessions and changed owner identities never touch catalogue files", async () => {
  for (const defect of ["client", "owner", "token"]) {
    const f = fixture(); if (defect === "client") f.state.role = "client"; if (defect === "owner") f.state.liveOwner = "c".repeat(32);
    await assert.rejects(f.service.read(defect === "token" ? "bad" : token), { code: "QUICK_REPLIES_UNAUTHORIZED" }); assert.equal(f.state.factoryCalls, 0); f.service.close();
  }
});
test("bounded rate budgets and expiry are enforced without exposing private errors", async () => {
  const f = fixture(); f.state.rate = false; await assert.rejects(f.service.read(token), error => error.code === "QUICK_REPLIES_RATE_LIMIT" && error.retryAfter === 17); assert.equal(f.state.factoryCalls, 0);
  f.state.rate = true; f.state.now = now + 60000; await assert.rejects(f.service.save(token, { expectedVersion: "1", replies }), { code: "QUICK_REPLIES_UNAUTHORIZED" }); f.service.close();
  const broken = fixture({ chatService: { async actor() { throw new Error("private-path/SQL/user@example.invalid"); } } });
  await assert.rejects(broken.service.read(token), error => error.code === "QUICK_REPLIES_UNAVAILABLE" && !error.message.includes("private-path") && error.cause === undefined); broken.service.close();
});
test("closing during authentication prevents later creation or publication of a catalogue handle", async () => {
  const f = fixture(); let release; f.state.authWait = new Promise(resolve => { release = resolve; });
  const reading = f.service.read(token); f.service.close(); release(); await assert.rejects(reading, { code: "QUICK_REPLIES_UNAVAILABLE" }); assert.equal(f.state.factoryCalls, 0);
});
test("expiry during file work prevents publication and the final write authorization", async () => {
  const reading = fixture(); reading.state.onRead = () => { reading.state.now += 60000; };
  await assert.rejects(reading.service.read(token), { code: "QUICK_REPLIES_UNAUTHORIZED" }); assert.equal(reading.state.fileReads, 1); reading.service.close();
  const saving = fixture(); saving.state.onSave = () => { saving.state.now += 60000; };
  await assert.rejects(saving.service.save(token, { expectedVersion: "1", replies }), { code: "QUICK_REPLIES_UNAUTHORIZED" }); assert.equal(saving.state.fileSaves, 1); saving.service.close();
});
