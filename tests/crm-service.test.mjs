import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createCrmService, CrmError } from "../server/crm/service.mjs";
import { sealNotes, openNotes } from "../server/crm/crypto.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";

const now = 1750000000000;
const adminId = Buffer.alloc(16, 0x11), clientId = Buffer.alloc(16, 0x22), conversationId = Buffer.alloc(16, 0x33), labelId = Buffer.alloc(16, 0x44);
const adminHex = adminId.toString("hex"), conversationHex = conversationId.toString("hex"), labelHex = labelId.toString("hex");
const hasCode = (code) => (error) => error instanceof CrmError && error.code === code;
const label = (overrides = {}) => ({ id: labelId, kind: "tag", name: "Synthetic tag", version: "1",
  createdAt: now - 1000, updatedAt: now - 1000, memberCount: 1,
  ownerAdminId: adminId, normalizedName: "synthetic tag", internal: "private-label-field", ...overrides });
const contact = () => ({ id: conversationId, clientId, clientPseudonym: "Synthetic client", peerPseudonym: "Synthetic client",
  createdAt: now - 20000, closedAt: null, lastActivityAt: now - 1000, latestSequence: "9007199254740993",
  latestEventSequence: "9007199254740994", lastReadSequence: "0", peerReadSequence: "9007199254740993", unreadCount: 2, canSend: true,
  nickname: "Private nickname", labels: [label()], reminderAt: now + 1000, version: "5", access: { state: "active", expiresAt: null },
  email: "private-client@example.invalid", notes: "private-contact-plaintext", notesEncrypted: "private-contact-ciphertext", notesRevision: "3" });

async function fixture() {
  const key = randomBytes(32), token = newToken(), calls = [], authCalls = [], rateCalls = [];
  const state = { admin: true, role: "admin", id: adminHex, authError: null, rawError: null, rateResults: [],
    profile: { conversationId, client: { id: clientId, pseudonym: "Synthetic client", email: "private-client@example.invalid", status: "active", credentialVersion: "private-proof" },
      access: { state: "active", expiresAt: null }, nickname: "Private nickname", notesEncrypted: null, notesRevision: "3", reminderAt: now + 1000,
      version: "5", updatedAt: now - 1000, labels: [label()], privateProof: "private-profile-proof" } };
  state.profile.notesEncrypted = sealNotes("  Private notes\n<b>literal</b>  ", key, { adminId, conversationId, version: "3" });
  const record = (name, options) => { calls.push({ name, options }); if (state.rawError) throw state.rawError; };
  const store = {
    listLabels: async (options) => { record("listLabels", options); return { labels: state.labels ?? [label()], nextCursor: labelId, hasMore: true, internal: "private-page-field" }; },
    createLabel: async (options) => { record("createLabel", options); return { label: label({ id: options.label.id, kind: options.label.kind, name: options.label.name }), duplicate: false, internal: "private-page-field" }; },
    renameLabel: async (options) => { record("renameLabel", options); return label({ name: options.name, version: "2" }); },
    deleteLabel: async (options) => { record("deleteLabel", options); return { deleted: true, privateProof: "private-delete-proof" }; },
    getProfile: async (options) => { record("getProfile", options); return state.profile; },
    saveProfile: async (options) => {
      record("saveProfile", options);
      if (options.expectedVersion !== state.profile.version) throw Object.assign(new Error("private-conflict-details"), { code: "CRM_CONFLICT" });
      state.profile = { ...state.profile, nickname: options.nickname, notesEncrypted: options.notesEncrypted, notesRevision: String(Number(options.expectedVersion) + 1),
        reminderAt: options.reminderAt, version: String(Number(options.expectedVersion) + 1), updatedAt: now,
        labels: options.labelIds.map((id) => label({ id })) };
      return state.profile;
    },
    listContacts: async (options) => { record("listContacts", options); return { contacts: state.contacts ?? [contact()], nextCursor: conversationId, hasMore: true, internal: "private-page-field" }; },
  };
  const authService = { session: async (raw) => {
    authCalls.push(raw); if (state.authError) throw state.authError;
    return state.admin ? { user: { id: state.id, role: state.role, pseudonym: "Jessie", email: "private-admin@example.invalid" }, csrf: newToken(), expiresAt: now + 10000 } : null;
  } };
  const authStore = { consumeRateLimit: async (bucket, options) => {
    rateCalls.push({ bucket, options }); return state.rateResults.shift() ?? { allowed: true, retryAfter: 0 };
  } };
  const options = { store, authService, authStore, key, clock: () => now };
  return { key, token, state, calls, authCalls, rateCalls, options, store, service: await createCrmService(options) };
}
const saveInput = (overrides = {}) => ({ expectedVersion: "5", nickname: "  Private\u00a0 nickname  ", notes: "  Exact notes\r\nالعربية <b>literal</b>  ", reminderAt: now + 60000, labelIds: [labelHex], ...overrides });

test("CRM service requires explicit valid key, clock and complete dependencies", async () => {
  const f = await fixture();
  for (const key of [undefined, null, f.key.toString("hex"), Buffer.alloc(31), Buffer.alloc(33)]) {
    await assert.rejects(createCrmService({ ...f.options, key }), hasCode("CRM_CONFIG"));
  }
  for (const dependency of ["store", "authStore", "authService"]) await assert.rejects(createCrmService({ ...f.options, [dependency]: null }), hasCode("CRM_CONFIG"));
  for (const method of Object.keys(f.store)) await assert.rejects(createCrmService({ ...f.options, store: { ...f.store, [method]: undefined } }), hasCode("CRM_CONFIG"));
  await assert.rejects(createCrmService({ ...f.options, clock: null }), hasCode("CRM_CONFIG"));
  assert.ok(Object.isFrozen(f.service));
});

test("all CRM operations recheck administrator session and forward only hashed actor proof", async () => {
  const f = await fixture();
  await f.service.listLabels(f.token, { kind: "tag", afterId: "43".repeat(16), limit: 10 });
  await f.service.createLabel(f.token, { kind: "group", name: "Synthetic group" });
  await f.service.renameLabel(f.token, labelHex, { name: "Renamed", expectedVersion: "1" });
  await f.service.deleteLabel(f.token, labelHex, { expectedVersion: "1" });
  await f.service.profile(f.token, conversationHex);
  await f.service.saveProfile(f.token, conversationHex, saveInput());
  await f.service.contacts(f.token);
  assert.equal(f.authCalls.length, 7); assert.ok(f.authCalls.every((value) => value === f.token));
  assert.equal(f.calls.length, 7);
  for (const { options } of f.calls) {
    assert.deepEqual(options.tokenHash, tokenDigest(f.token)); assert.equal(options.now, now);
    for (const forbidden of ["token", "session", "userId", "adminId", "email", "notes"]) assert.equal(options[forbidden], undefined);
  }
  assert.deepEqual(f.calls[0].options.afterId, Buffer.alloc(16, 0x43));
  assert.deepEqual(f.calls.find((call) => call.name === "getProfile").options.conversationId, conversationId);
});

test("clients, revoked administrators and malformed principal/token data cannot reach CRM store", async () => {
  const f = await fixture();
  f.state.admin = false; await assert.rejects(f.service.profile(f.token, conversationHex), hasCode("CRM_UNAUTHORIZED"));
  f.state.admin = true; f.state.role = "client"; await assert.rejects(f.service.actor(f.token), hasCode("CRM_UNAUTHORIZED"));
  f.state.role = "admin"; f.state.authError = Object.assign(new Error("private-session-details"), { code: "AUTH_INVALID" });
  await assert.rejects(f.service.contacts(f.token), hasCode("CRM_UNAUTHORIZED"));
  f.state.authError = null; f.state.id = "invalid-private-principal";
  await assert.rejects(f.service.actor(f.token), hasCode("CRM_UNAVAILABLE"));
  f.state.id = adminHex;
  for (const token of [undefined, null, "", `${f.token}=`, `${f.token}\n`, "A".repeat(42)]) {
    await assert.rejects(f.service.actor(token), hasCode("CRM_UNAUTHORIZED"));
  }
  assert.equal(f.calls.length, 0); assert.equal(f.rateCalls.length, 0);
});

test("actor DTO omits private principal fields and service retains a private key copy", async () => {
  const f = await fixture(), actor = await f.service.actor(f.token);
  assert.deepEqual(Object.keys(actor).sort(), ["csrf", "expiresAt", "user"]);
  assert.deepEqual(Object.keys(actor.user).sort(), ["id", "pseudonym", "role"]);
  assert.equal(JSON.stringify(actor).includes("private-admin@example.invalid"), false);
  f.key.fill(0);
  assert.equal((await f.service.profile(f.token, conversationHex)).notes, "  Private notes\n<b>literal</b>  ");
});

test("profile notes decrypt with notes revision after a label deletion changes optimistic version", async () => {
  const f = await fixture(), profile = await f.service.profile(f.token, conversationHex);
  assert.equal(profile.version, "5"); assert.equal(profile.notes, "  Private notes\n<b>literal</b>  ");
  assert.equal(profile.client.email, "private-client@example.invalid");
  assert.deepEqual(Object.keys(profile).sort(), ["access", "client", "conversationId", "labels", "nickname", "notes", "reminderAt", "updatedAt", "version"]);
  assert.deepEqual(Object.keys(profile.client).sort(), ["email", "id", "pseudonym", "status"]);
  const json = JSON.stringify(profile);
  for (const secret of ["notesRevision", "notesEncrypted", f.state.profile.notesEncrypted, "private-proof", "private-profile-proof"]) assert.equal(json.includes(secret), false);
});

test("an absent profile is returned empty without decrypting a nonexistent revision zero", async () => {
  const f = await fixture();
  f.state.profile = { ...f.state.profile, nickname: "", notesEncrypted: null, notesRevision: "0", reminderAt: null, version: "0", updatedAt: null, labels: [] };
  const profile = await f.service.profile(f.token, conversationHex);
  assert.equal(profile.version, "0"); assert.equal(profile.notes, ""); assert.deepEqual(profile.labels, []); assert.equal(profile.updatedAt, null);
});

test("full profile save encrypts exact notes for next revision and never stores claimed administrator data", async () => {
  const f = await fixture(), input = saveInput(), result = await f.service.saveProfile(f.token, conversationHex, input);
  const command = f.calls.at(-1).options;
  assert.equal(command.expectedVersion, "5"); assert.equal(command.nickname, "Private nickname");
  assert.equal(command.reminderAt, input.reminderAt); assert.deepEqual(command.labelIds, [labelId]);
  assert.equal(openNotes(command.notesEncrypted, f.key, { adminId, conversationId, version: "6" }), input.notes);
  assert.throws(() => openNotes(command.notesEncrypted, f.key, { adminId: clientId, conversationId, version: "6" }));
  assert.throws(() => openNotes(command.notesEncrypted, f.key, { adminId, conversationId, version: "5" }));
  assert.equal(JSON.stringify(command).includes(input.notes), false); assert.equal(result.notes, input.notes); assert.equal(result.version, "6");
  await assert.rejects(f.service.saveProfile(f.token, conversationHex, saveInput()), hasCode("CRM_CONFLICT"));
  assert.equal(f.state.profile.version, "6");
});

test("empty notes persist as null and first explicit save advances new profile from zero to one", async () => {
  const f = await fixture();
  f.state.profile = { ...f.state.profile, notesEncrypted: null, notesRevision: "0", version: "0", updatedAt: null, labels: [] };
  const result = await f.service.saveProfile(f.token, conversationHex, saveInput({ expectedVersion: "0", notes: "", nickname: "", reminderAt: null, labelIds: [] }));
  assert.equal(f.calls.at(-1).options.notesEncrypted, null); assert.equal(result.notes, ""); assert.equal(result.version, "1");
});

test("labels canonicalize display/name keys and response DTOs omit ownership and normalization internals", async () => {
  const f = await fixture();
  const result = await f.service.createLabel(f.token, { kind: "tag", name: "  CAFE\u0301\u00a0 clients  " });
  const command = f.calls.at(-1).options;
  assert.equal(command.label.name, "CAFÉ clients"); assert.equal(command.label.normalizedName, "café clients");
  assert.ok(Buffer.isBuffer(command.label.id)); assert.equal(command.label.id.length, 16);
  assert.deepEqual(Object.keys(result).sort(), ["duplicate", "label"]);
  assert.deepEqual(Object.keys(result.label).sort(), ["createdAt", "id", "kind", "memberCount", "name", "updatedAt", "version"]);
  const page = await f.service.listLabels(f.token);
  assert.deepEqual(Object.keys(page).sort(), ["hasMore", "labels", "nextCursor"]); assert.equal(page.nextCursor, labelHex);
  assert.equal(JSON.stringify(page).includes("private-label-field"), false); assert.equal(JSON.stringify(page).includes("normalizedName"), false);
});

test("contact filtering passes literal search and current ownership options while excluding notes and email from inbox", async () => {
  const f = await fixture();
  const result = await f.service.contacts(f.token, { q: "  client%_  ", tagId: labelHex, groupId: "55".repeat(16), access: "expired", unread: true,
    reminder: "due", afterId: "32".repeat(16), limit: 3 });
  const command = f.calls.at(-1).options;
  assert.equal(command.q, "client%_"); assert.deepEqual(command.tagId, labelId); assert.deepEqual(command.groupId, Buffer.alloc(16, 0x55));
  assert.equal(command.access, "expired"); assert.equal(command.unread, true); assert.equal(command.reminder, "due"); assert.equal(command.limit, 3);
  const row = result.contacts[0];
  assert.equal(row.latestSequence, "9007199254740993"); assert.equal(row.crm.nickname, "Private nickname"); assert.equal(row.crm.version, "5");
  assert.deepEqual(Object.keys(row.crm).sort(), ["labels", "nickname", "reminderAt", "version"]);
  const json = JSON.stringify(result);
  for (const secret of ["private-client@example.invalid", "private-contact-plaintext", "private-contact-ciphertext", "notesEncrypted", "notesRevision", "private-page-field"]) assert.equal(json.includes(secret), false);
});

test("persistent CRM quotas use opaque distinct scoped buckets and reject before data access", async () => {
  const f = await fixture();
  await f.service.contacts(f.token, { q: "private-search@example.invalid" });
  assert.equal(f.rateCalls.length, 2);
  assert.deepEqual(f.rateCalls[0].options, { now, windowSeconds: 60, limit: 300 });
  assert.deepEqual(f.rateCalls[1].options, { now, windowSeconds: 60, limit: 180 });
  assert.notDeepEqual(f.rateCalls[0].bucket, f.rateCalls[1].bucket);
  await f.service.createLabel(f.token, { kind: "tag", name: "Private quota tag" });
  assert.deepEqual(f.rateCalls.at(-1).options, { now, windowSeconds: 60, limit: 120 });
  assert.notDeepEqual(f.rateCalls[1].bucket, f.rateCalls.at(-1).bucket);
  for (const { bucket } of f.rateCalls) { assert.ok(Buffer.isBuffer(bucket)); assert.equal(bucket.length, 32); }
  const json = JSON.stringify(f.rateCalls);
  for (const secret of [f.token, adminHex, "private-search@example.invalid", "Private quota tag"]) assert.equal(json.includes(secret), false);
  const before = f.calls.length;
  f.state.rateResults = [{ allowed: false, retryAfter: 37 }];
  await assert.rejects(f.service.profile(f.token, conversationHex), (error) => hasCode("CRM_RATE_LIMIT")(error) && error.retryAfter === 37);
  f.state.rateResults = [{ allowed: false, retryAfter: 17 }];
  await assert.rejects(f.service.saveProfile(f.token, conversationHex, saveInput()), (error) => hasCode("CRM_RATE_LIMIT")(error) && error.retryAfter === 17);
  assert.equal(f.calls.length, before);
});

const timedOperations = [
  ["listLabels", false, (service, token) => service.listLabels(token)],
  ["createLabel", true, (service, token) => service.createLabel(token, { kind: "tag", name: "Synthetic boundary tag" })],
  ["renameLabel", true, (service, token) => service.renameLabel(token, labelHex, { name: "Synthetic rename", expectedVersion: "1" })],
  ["deleteLabel", true, (service, token) => service.deleteLabel(token, labelHex, { expectedVersion: "1" })],
  ["getProfile", false, (service, token) => service.profile(token, conversationHex)],
  ["saveProfile", true, (service, token) => service.saveProfile(token, conversationHex, saveInput())],
  ["listContacts", false, (service, token) => service.contacts(token)],
];

test("each CRM operation reauthorizes at the session deadline reached while awaiting quotas", async () => {
  for (const [method, mutation, operation] of timedOperations) for (const offset of [0, 1]) {
    const f = await fixture(), expiresAt = now + 10000, checked = [];
    let current = now, decisions = 0, privateOperations = 0;
    const store = { ...f.store, async [method](request) {
      checked.push(request.now);
      if (request.now >= expiresAt) throw Object.assign(new Error("Private expired administrator session"), { code: "CHAT_UNAUTHORIZED" });
      privateOperations += 1; return f.store[method](request);
    } };
    const service = await createCrmService({ ...f.options, store, clock: () => current, authStore: { async consumeRateLimit() {
      current = expiresAt + offset; decisions += 1; return { allowed: true };
    } } });
    await assert.rejects(operation(service, f.token), hasCode("CRM_UNAUTHORIZED"), `${method}/${offset}`);
    assert.deepEqual(checked, [expiresAt + offset], method);
    assert.equal(decisions, mutation ? 1 : 2);
    assert.equal(privateOperations, 0); assert.equal(f.calls.length, 0, "an expired request cannot expose or modify CRM data");
  }
});

test("each CRM operation fails closed before persistence if the post-quota clock becomes invalid", async () => {
  for (const [method, mutation, operation] of timedOperations) for (const invalidTime of [-1, NaN, 1.5, 253402300800000]) {
    const f = await fixture(); let current = now, decisions = 0;
    const service = await createCrmService({ ...f.options, clock: () => current, authStore: { async consumeRateLimit() {
      current = invalidTime; decisions += 1; return { allowed: true };
    } } });
    await assert.rejects(operation(service, f.token), hasCode("CRM_UNAVAILABLE"), `${method}/${invalidTime}`);
    assert.equal(decisions, mutation ? 1 : 2); assert.equal(f.calls.length, 0);
  }
});

test("malformed mutation shapes, versions, labels and filters fail before SQL or rate consumption", async () => {
  const f = await fixture();
  for (const input of [undefined, null, [], {}, { kind: "room", name: "x" }, { kind: "tag", name: "x", adminId: adminHex }]) {
    await assert.rejects(f.service.createLabel(f.token, input), hasCode("CRM_INPUT"));
  }
  for (const input of [undefined, null, [], {}, saveInput({ expectedVersion: "01" }), saveInput({ expectedVersion: 5 }), saveInput({ expectedVersion: "4294967296" }),
    saveInput({ expectedVersion: "5\n" }), saveInput({ labelIds: [labelHex, labelHex] }), saveInput({ notes: "x".repeat(8001) }), saveInput({ adminId: adminHex })]) {
    await assert.rejects(f.service.saveProfile(f.token, conversationHex, input), hasCode("CRM_INPUT"));
  }
  for (const id of [undefined, null, "A".repeat(32), `${conversationHex}\n`, `${conversationHex}\r`, Buffer.alloc(16)]) await assert.rejects(f.service.profile(f.token, id), hasCode("CRM_INPUT"));
  for (const options of [null, [], "invalid", { limit: 0 }, { limit: 101 }, { limit: "50" }, { q: "x".repeat(81) }, { access: "unknown" }, { reminder: "yesterday" }, { unread: "1" }, { adminId: adminHex }]) {
    await assert.rejects(f.service.contacts(f.token, options), hasCode("CRM_INPUT"));
  }
  for (const options of [null, [], "invalid", { kind: "room" }, { adminId: adminHex }]) await assert.rejects(f.service.listLabels(f.token, options), hasCode("CRM_INPUT"));
  await assert.rejects(f.service.renameLabel(f.token, labelHex, { name: "x", expectedVersion: "0" }), hasCode("CRM_INPUT"));
  await assert.rejects(f.service.deleteLabel(f.token, labelHex, { expectedVersion: "1", adminId: adminHex }), hasCode("CRM_INPUT"));
  assert.equal(f.calls.length, 0); assert.equal(f.rateCalls.length, 0);
});

test("corrupt ciphertext or note revision and unexpected backend details produce sanitized unavailable errors", async () => {
  const f = await fixture(), original = { ...f.state.profile };
  for (const corruption of [{ notesEncrypted: "private-corrupted-envelope" }, { notesRevision: "4" }, { conversationId: clientId }, { notesRevision: "0" },
    { version: "0", notesRevision: "0", notesEncrypted: original.notesEncrypted }]) {
    f.state.profile = { ...original, ...corruption };
    await assert.rejects(f.service.profile(f.token, conversationHex), (error) => {
      assert.ok(hasCode("CRM_UNAVAILABLE")(error)); assert.equal(error.cause, undefined);
      assert.equal(error.message.includes("private-corrupted-envelope"), false); assert.equal(error.message.includes("Private notes"), false); return true;
    });
  }
  f.state.profile = original;
  f.state.rawError = Object.assign(new Error("SQL password=private-secret private-client@example.invalid"), { code: "ER_PRIVATE_DATABASE_ERROR" });
  await assert.rejects(f.service.contacts(f.token), (error) => hasCode("CRM_UNAVAILABLE")(error) && !error.message.includes("private-secret") && error.cause === undefined);
});

test("known scope and optimistic conflict errors retain only safe public codes", async () => {
  const f = await fixture();
  for (const code of ["CRM_NOT_FOUND", "CRM_CONFLICT", "CRM_NAME_CONFLICT", "CRM_LIMIT", "CHAT_NOT_FOUND", "CHAT_FORBIDDEN"]) {
    f.state.rawError = Object.assign(new Error("private-client@example.invalid secret-notes"), { code });
    await assert.rejects(f.service.profile(f.token, conversationHex), (error) => {
      assert.ok(hasCode(code)(error)); assert.equal(error.message.includes("secret-notes"), false); assert.equal(error.cause, undefined); return true;
    });
  }
});

test("invalid clocks and malformed raw DTOs cannot report a successful CRM read", async () => {
  const f = await fixture();
  for (const clock of [() => -1, () => NaN, () => 1.5, () => 253402300800000]) {
    const service = await createCrmService({ ...f.options, clock }), before = f.calls.length;
    await assert.rejects(service.contacts(f.token), hasCode("CRM_UNAVAILABLE")); assert.equal(f.calls.length, before);
  }
  f.state.labels = [label({ id: Buffer.alloc(15) })];
  await assert.rejects(f.service.listLabels(f.token), hasCode("CRM_UNAVAILABLE"));
  f.state.contacts = [{ ...contact(), canSend: "true" }];
  await assert.rejects(f.service.contacts(f.token), hasCode("CRM_UNAVAILABLE"));
});
