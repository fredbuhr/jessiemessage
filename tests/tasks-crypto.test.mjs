import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openTask, sealTask, taskFingerprint } from "../server/tasks/crypto.mjs";
import { fields, titleText, validateList, validateSave, version } from "../server/tasks/validation.mjs";

const key = randomBytes(32), binding = { adminId: randomBytes(16), conversationId: randomBytes(16), taskId: randomBytes(16),
  version: "1", dueAt: 1780000000123, done: false };
const title = "Envoyer les photos promises 💋\nPuis préparer le rendez-vous privé";
const input = { conversationId: binding.conversationId.toString("hex"), expectedVersion: "0", title, dueAt: binding.dueAt, done: false };
const invalid = error => error?.code === "TASKS_INPUT";

test("private task titles round-trip with randomized encryption without changing the shared CRM key", () => {
  const original = Buffer.from(key), first = sealTask(title, key, binding), second = sealTask(title, key, binding);
  assert.notEqual(first, second); assert.ok(!first.includes(title)); assert.ok(first.length <= 4096);
  assert.equal(openTask(first, key, binding), title); assert.deepEqual(key, original);
  assert.equal(openTask(sealTask("  contenu exact <b> & 👋🏿  ", key, binding), key, binding), "  contenu exact <b> & 👋🏿  ");
});

test("task ciphertext rejects another account, conversation, id, revision, deadline, completion state or key", () => {
  const encrypted = sealTask(title, key, binding);
  for (const changes of [{ adminId: randomBytes(16) }, { conversationId: randomBytes(16) }, { taskId: randomBytes(16) },
    { version: "2" }, { dueAt: binding.dueAt + 1 }, { dueAt: null }, { done: true }]) {
    assert.throws(() => openTask(encrypted, key, { ...binding, ...changes }), error => error?.code === "TASKS_UNAVAILABLE");
  }
  assert.throws(() => openTask(encrypted, randomBytes(32), binding));
  for (const malformed of [null, "", encrypted + "=", "v0." + encrypted.slice(3), encrypted.slice(0, -2), "v1." + "A".repeat(4097)]) {
    assert.throws(() => openTask(malformed, key, binding));
  }
});

test("retry fingerprints bind the full requested version and payload to the task owner and stable id", () => {
  const context = { adminId: binding.adminId, taskId: binding.taskId }, fingerprint = taskFingerprint(input, key, context);
  assert.equal(fingerprint.length, 32);
  assert.deepEqual(taskFingerprint({ done: false, title, dueAt: binding.dueAt, expectedVersion: "0", conversationId: input.conversationId }, key, context), fingerprint);
  for (const changes of [{ title: title + "!" }, { conversationId: randomBytes(16).toString("hex") }, { expectedVersion: "1" }, { dueAt: null }, { done: true }]) {
    assert.notDeepEqual(taskFingerprint({ ...input, ...changes }, key, context), fingerprint);
  }
  assert.notDeepEqual(taskFingerprint(input, key, { ...context, adminId: randomBytes(16) }), fingerprint);
  assert.notDeepEqual(taskFingerprint(input, key, { ...context, taskId: randomBytes(16) }), fingerprint);
});

test("task validation preserves useful text but bounds payloads, dates and exact uint32 versions", () => {
  assert.deepEqual(validateSave(input), input); assert.equal(titleText("x".repeat(500)).length, 500);
  for (const badTitle of ["", " \t\n", "\u200b", "x".repeat(501), "\ud800", "secret\u0000", "title\u202e"]) assert.throws(() => titleText(badTitle), invalid);
  for (const expectedVersion of [1, "01", "-1", "1.0", "4294967296"]) assert.throws(() => validateSave({ ...input, expectedVersion }), invalid);
  assert.equal(version("4294967295", false), "4294967295");
  for (const dueAt of [-1, NaN, Infinity, 1.5, 253402300800000, "1780000000123"]) assert.throws(() => validateSave({ ...input, dueAt }), invalid);
  for (const changed of [{ done: 1 }, { extra: "field" }, { conversationId: "A".repeat(32) }]) assert.throws(() => validateSave({ ...input, ...changed }), invalid);
  assert.deepEqual(validateList(), { filter: "open", conversationId: null, afterId: null, limit: 50 });
  for (const bad of [{ filter: "all" }, { limit: 101 }, { limit: 0 }, { unknown: 1 }, { afterId: "no" }]) assert.throws(() => validateList(bad), invalid);
});

test("task input shapes reject inherited, accessor and symbol fields without evaluating getters", () => {
  let invoked = false;
  const getter = Object.defineProperty({}, "title", { enumerable: true, get() { invoked = true; return "secret"; } });
  assert.throws(() => fields(getter, ["title"]), invalid); assert.equal(invoked, false);
  assert.throws(() => fields({ [Symbol("hidden")]: "value" }, []), invalid);
  assert.throws(() => fields(Object.create({ title: "inherited" }), ["title"]), invalid);
});
