import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore, ChatStoreError } from "../server/chat/store.mjs";
import { createCrmStore, CrmStoreError } from "../server/crm/store.mjs";
import { sealNotes, openNotes } from "../server/crm/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1", id = () => randomBytes(16), digest = () => randomBytes(32);
const now = Date.UTC(2026, 9, 15, 12), key = digest();
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const code = (expected) => (error) => error instanceof ChatStoreError && error.code === expected && error.cause === undefined;

test("real MariaDB private CRM ownership, optimistic saves and inbox filters (synthetic disposable schema only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 180000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "runtime DML credentials must be separately provisioned");
  const migrations = await loadMigrations(); assert.equal(migrations.length, 33);
  const ownedTables = createdMigrationTables(migrations).reverse();
  const allowedTables = [...ownedTables, "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool, fixtureNumber = 0;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const chat = createChatStore(pool), crm = createCrmStore({ pool, chatStore: chat });
    async function user(role, extra = {}) {
      const result = { id: id(), sessionId: id(), tokenHash: digest(), role, pseudonym: `Synthetic ${role} ${fixtureNumber++}`, ...extra };
      result.email = `crm-${fixtureNumber}@example.invalid`;
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [result.id, role, result.pseudonym, result.email, role === "client" ? sqlDate(now) : null,
        null, role === "client" ? sqlDate(now) : null, sqlDate(now), sqlDate(now)]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-encrypted-secret', 1, 1, ?)", [result.id, sqlDate(now)]);
      else await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [result.id, sqlDate(now)]);
      if (role === "client") await consumeSyntheticInvitation(connection, result.id, now);
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [result.sessionId, result.id, result.tokenHash, sqlDate(now), sqlDate(now + 8 * 3600000)]);
      if (role === "admin") await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [result.sessionId, sqlDate(now), sqlDate(now)]);
      else await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [result.sessionId, sqlDate(now)]);
      return result;
    }
    async function pair(admin = null, extra = {}) {
      const fixture = { admin: admin ?? await user("admin"), client: await user("client", extra), conversationId: id() };
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [fixture.conversationId, fixture.client.id, fixture.admin.id, sqlDate(now)]);
      return fixture;
    }
    const actor = (fixture, extra = {}) => ({ tokenHash: fixture.admin.tokenHash, now, ...extra });
    const request = (fixture, extra = {}) => ({ ...actor(fixture), conversationId: fixture.conversationId, ...extra });
    const makeLabel = (name = "Fidèle", kind = "tag", extra = {}) => ({ id: id(), kind, name, normalizedName: name.normalize("NFKC").toLowerCase(), ...extra });
    const label = async (fixture, name, kind) => (await crm.createLabel({ ...actor(fixture), label: makeLabel(name, kind) })).label;
    const save = (fixture, extra = {}) => crm.saveProfile({ ...request(fixture), expectedVersion: "0", nickname: "", notesEncrypted: null, reminderAt: null, labelIds: [], ...extra });
    const seal = (fixture, notes, version) => sealNotes(notes, key, { adminId: fixture.admin.id, conversationId: fixture.conversationId, version });
    const open = (fixture, profile) => openNotes(profile.notesEncrypted, key, { adminId: fixture.admin.id, conversationId: fixture.conversationId, version: profile.notesRevision });
    const contacts = (fixture, extra = {}) => crm.listContacts({ ...actor(fixture), ...extra });
    const payload = () => ({ id: id(), clientMessageId: id(), bodyEncrypted: "v1.synthetic-private-message", bodyFingerprint: digest() });
    const send = (fixture, role = "client") => chat.sendMessage({ role, tokenHash: fixture[role].tokenHash, now, conversationId: fixture.conversationId, message: payload() });

    await t.test("all twenty migrations and read-only schema verification reject dirty ledgers and column, key, FK and CHECK drift", async () => {
      assert.equal(await crm.assertSchema(), true);
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = ?", [migrations.at(-1).version]);
      try { await assert.rejects(crm.assertSchema(), code("CHAT_DATABASE_STATE")); }
      finally { await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = ?", [migrations.at(-1).version]); }
      await connection.query("ALTER TABLE crm_profiles MODIFY notes_revision INT NOT NULL");
      try { await assert.rejects(crm.assertSchema(), code("CRM_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE crm_profiles MODIFY notes_revision INT UNSIGNED NOT NULL"); }
      await connection.query("ALTER TABLE crm_labels DROP INDEX crm_labels_owner_name");
      try { await assert.rejects(crm.assertSchema(), code("CRM_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE crm_labels ADD UNIQUE KEY crm_labels_owner_name (owner_admin_id, kind, normalized_name)"); }
      await connection.query("ALTER TABLE crm_profiles DROP CONSTRAINT crm_profiles_version");
      await connection.query("ALTER TABLE crm_profiles ADD CONSTRAINT crm_profiles_version CHECK (1)");
      try { await assert.rejects(crm.assertSchema(), code("CRM_DATABASE_STATE")); }
      finally {
        await connection.query("ALTER TABLE crm_profiles DROP CONSTRAINT crm_profiles_version");
        await connection.query("ALTER TABLE crm_profiles ADD CONSTRAINT crm_profiles_version CHECK (version >= 1 AND notes_revision >= 1 AND notes_revision <= version)");
      }
      await connection.query("ALTER TABLE crm_memberships DROP FOREIGN KEY crm_memberships_label_fk");
      try { await assert.rejects(crm.assertSchema(), code("CRM_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE crm_memberships ADD CONSTRAINT crm_memberships_label_fk FOREIGN KEY (admin_id, label_id) REFERENCES crm_labels (owner_admin_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT"); }
      assert.equal(await crm.assertSchema(), true);
    });

    await t.test("labels and profiles require the current administrator session, MFA and assignment", async () => {
      const a = await pair(), b = await pair();
      const tag = await label(a, "Interne");
      await assert.rejects(crm.listLabels(actor(a, { tokenHash: a.client.tokenHash })), code("CHAT_FORBIDDEN"));
      await assert.rejects(crm.listLabels(actor(a, { tokenHash: digest() })), code("CHAT_UNAUTHORIZED"));
      await assert.rejects(crm.getProfile(request(b, { conversationId: a.conversationId })), code("CHAT_NOT_FOUND"));
      await assert.rejects(crm.renameLabel({ ...actor(b), labelId: tag.id, expectedVersion: "1", name: "X", normalizedName: "x" }), code("CRM_NOT_FOUND"));
      await assert.rejects(crm.deleteLabel({ ...actor(b), labelId: tag.id, expectedVersion: "1" }), code("CRM_NOT_FOUND"));
      await assert.rejects(contacts(b, { tagId: tag.id }), code("CRM_NOT_FOUND"));
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sqlDate(now), a.admin.sessionId]);
      await assert.rejects(crm.listLabels(actor(a)), code("CHAT_UNAUTHORIZED"));
      await assert.rejects(crm.getProfile(request(a)), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE sessions SET revoked_at = NULL WHERE id = ?", [a.admin.sessionId]);
      await connection.query("UPDATE admin_mfa SET version = version + 1 WHERE user_id = ?", [a.admin.id]);
      await assert.rejects(contacts(a), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE admin_mfa SET version = version - 1 WHERE user_id = ?", [a.admin.id]);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [a.admin.id]);
      await assert.rejects(crm.listLabels(actor(a)), code("CHAT_FORBIDDEN"));
    });

    await t.test("concurrent normalized-name creation deduplicates privately and tag/group names remain distinct", async () => {
      const a = await pair(), b = await pair(), value = makeLabel("Préféré");
      const results = await Promise.all([crm.createLabel({ ...actor(a), label: value }), crm.createLabel({ ...actor(a), label: { ...value, id: id(), name: "PRÉFÉRÉ" } })]);
      assert.equal(results.filter((item) => item.duplicate).length, 1); assert.ok(results[0].label.id.equals(results[1].label.id));
      assert.equal((await label(a, "Préféré", "group")).kind, "group");
      assert.ok(!(await label(b, "Préféré")).id.equals(results[0].label.id));
      assert.equal((await crm.listLabels({ ...actor(a), kind: "tag" })).labels.length, 1);
      assert.equal((await crm.listLabels(actor(a))).labels.length, 2);
    });

    await t.test("label caps are per owner and kind, with safe duplicate retries even at the cap", async () => {
      const fixture = await pair(); let first;
      for (let index = 0; index < 100; index++) { const result = await label(fixture, `Tag ${index}`); first ??= result; }
      await assert.rejects(label(fixture, "One too many"), code("CRM_LIMIT"));
      const retry = await crm.createLabel({ ...actor(fixture), label: makeLabel("TAG 0") });
      assert.equal(retry.duplicate, true); assert.ok(retry.label.id.equals(first.id));
      assert.equal((await label(fixture, "Independent group", "group")).kind, "group");
      const page1 = await crm.listLabels({ ...actor(fixture), kind: "tag", limit: 37 });
      const page2 = await crm.listLabels({ ...actor(fixture), kind: "tag", limit: 37, afterId: page1.nextCursor });
      const page3 = await crm.listLabels({ ...actor(fixture), kind: "tag", limit: 37, afterId: page2.nextCursor });
      assert.equal(page1.hasMore, true); assert.equal(page3.hasMore, false);
      assert.equal(new Set([...page1.labels, ...page2.labels, ...page3.labels].map((item) => item.id.toString("hex"))).size, 100);
    });

    await t.test("label renames use optimistic versions and reject name collisions without changing memberships", async () => {
      const fixture = await pair(), one = await label(fixture, "One"), two = await label(fixture, "Two");
      await save(fixture, { labelIds: [one.id] });
      const results = await Promise.allSettled([
        crm.renameLabel({ ...actor(fixture), labelId: one.id, expectedVersion: "1", name: "First", normalizedName: "first" }),
        crm.renameLabel({ ...actor(fixture), labelId: one.id, expectedVersion: "1", name: "Other", normalizedName: "other" }),
      ]);
      assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(results.find((item) => item.status === "rejected").reason.code, "CRM_CONFLICT");
      await assert.rejects(crm.renameLabel({ ...actor(fixture), labelId: one.id, expectedVersion: "2", name: two.name, normalizedName: "two" }), code("CRM_NAME_CONFLICT"));
      const profile = await crm.getProfile(request(fixture)); assert.equal(profile.labels.length, 1); assert.equal(profile.version, "1");
      await connection.query("UPDATE crm_labels SET version = 4294967295 WHERE id = ?", [one.id]);
      await assert.rejects(crm.renameLabel({ ...actor(fixture), labelId: one.id, expectedVersion: "4294967295", name: "Overflow", normalizedName: "overflow" }), code("CRM_LIMIT"));
    });

    await t.test("GET of an absent private profile does not create any stored record", async () => {
      const fixture = await pair(), profile = await crm.getProfile(request(fixture));
      assert.equal(profile.version, "0"); assert.equal(profile.notesRevision, "0"); assert.equal(profile.notesEncrypted, null);
      assert.equal(profile.nickname, ""); assert.deepEqual(profile.labels, []); assert.equal(profile.updatedAt, null);
      assert.equal(profile.client.email, fixture.client.email); assert.equal(profile.access.state, "active");
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM crm_profiles WHERE conversation_id = ?", [fixture.conversationId]))[0].value), 0);
    });

    await t.test("explicit full saves atomically replace profile fields and memberships while notes stay encrypted in MariaDB", async () => {
      const fixture = await pair(), tag = await label(fixture, "VIP"), group = await label(fixture, "Week-end", "group"), note = "Private synthetic note <script>plain text</script>\nExact spaces  ";
      const first = await save(fixture, { nickname: "Alias privé", notesEncrypted: seal(fixture, note, "1"), reminderAt: now + 86400000, labelIds: [tag.id, group.id] });
      assert.equal(first.version, "1"); assert.equal(first.notesRevision, "1"); assert.equal(open(fixture, first), note); assert.equal(first.labels.length, 2);
      const stored = (await connection.query("SELECT notes_encrypted FROM crm_profiles WHERE admin_id = ? AND conversation_id = ?", [fixture.admin.id, fixture.conversationId]))[0];
      assert.ok(!stored.notes_encrypted.includes("Private synthetic"));
      const second = await save(fixture, { expectedVersion: "1", nickname: "Nouveau", notesEncrypted: seal(fixture, "Replacement", "2"), reminderAt: null, labelIds: [group.id] });
      assert.equal(second.version, "2"); assert.equal(second.notesRevision, "2"); assert.equal(open(fixture, second), "Replacement");
      assert.equal(second.reminderAt, null); assert.deepEqual(second.labels.map((item) => item.kind), ["group"]);
      assert.equal((await crm.listLabels(actor(fixture))).labels.find((item) => item.id.equals(tag.id)).memberCount, 0);
      assert.equal((await crm.listLabels(actor(fixture))).labels.find((item) => item.id.equals(group.id)).memberCount, 1);
    });

    await t.test("foreign and missing memberships roll back the complete save, including initial creation", async () => {
      const a = await pair(), b = await pair(), foreign = await label(b, "Foreign");
      await assert.rejects(save(a, { nickname: "Must not save", notesEncrypted: seal(a, "Secret", "1"), labelIds: [foreign.id] }), code("CRM_NOT_FOUND"));
      assert.equal((await crm.getProfile(request(a))).version, "0");
      const own = await label(a, "Own"); await save(a, { nickname: "Original", labelIds: [own.id] });
      await assert.rejects(save(a, { expectedVersion: "1", nickname: "Must not overwrite", labelIds: [own.id, id()] }), code("CRM_NOT_FOUND"));
      const current = await crm.getProfile(request(a)); assert.equal(current.version, "1"); assert.equal(current.nickname, "Original"); assert.equal(current.labels.length, 1);
      await assert.rejects(save(a, { expectedVersion: "1", labelIds: [own.id, own.id] }), code("CRM_INPUT"));
      await assert.rejects(save(a, { expectedVersion: "1", labelIds: Array.from({ length: 33 }, id) }), code("CRM_INPUT"));
    });

    await t.test("two concurrent tabs cannot silently overwrite a profile or its encrypted notes", async () => {
      const fixture = await pair(); await save(fixture, { notesEncrypted: seal(fixture, "Original", "1") });
      const attempts = ["Tab A", "Tab B"].map((notes) => save(fixture, { expectedVersion: "1", nickname: notes, notesEncrypted: seal(fixture, notes, "2") }));
      const results = await Promise.allSettled(attempts); assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(results.find((item) => item.status === "rejected").reason.code, "CRM_CONFLICT");
      const stored = await crm.getProfile(request(fixture)); assert.equal(stored.version, "2"); assert.equal(open(fixture, stored), stored.nickname);
      await assert.rejects(save(fixture, { expectedVersion: "0" }), code("CRM_CONFLICT"));
    });

    await t.test("deleting a label invalidates all affected profile versions but preserves notes encryption revisions and other owners", async () => {
      const a = await pair(), a2 = await pair(a.admin), b = await pair(), tag = await label(a, "Shared own label"), other = await label(b, "Shared own label");
      await save(a, { notesEncrypted: seal(a, "Notes A", "1"), labelIds: [tag.id] });
      await save(a2, { notesEncrypted: seal(a2, "Notes A2", "1"), labelIds: [tag.id] });
      await save(b, { notesEncrypted: seal(b, "Other owner", "1"), labelIds: [other.id] });
      assert.equal((await crm.listLabels(actor(a))).labels[0].memberCount, 2);
      assert.deepEqual(await crm.deleteLabel({ ...actor(a), labelId: tag.id, expectedVersion: "1" }), { deleted: true });
      for (const fixture of [a, a2]) {
        const profile = await crm.getProfile(request(fixture)); assert.equal(profile.version, "2"); assert.equal(profile.notesRevision, "1"); assert.equal(profile.labels.length, 0);
        assert.equal(open(fixture, profile), fixture === a ? "Notes A" : "Notes A2");
        await assert.rejects(save(fixture, { expectedVersion: "1" }), code("CRM_CONFLICT"));
      }
      assert.equal((await crm.getProfile(request(b))).version, "1");
      const after = await save(a, { expectedVersion: "2", notesEncrypted: seal(a, "Fresh save", "3") });
      assert.equal(after.notesRevision, "3"); assert.equal(open(a, after), "Fresh save");
      await assert.rejects(crm.deleteLabel({ ...actor(a), labelId: tag.id, expectedVersion: "1" }), code("CRM_NOT_FOUND"));
    });

    await t.test("label deletion waiting for a profile save uses the current SQL authorization time and preserves encrypted notes", async () => {
      const fixture = await pair(), tag = await label(fixture, "Waiting deletion");
      await save(fixture, { notesEncrypted: seal(fixture, "Initial notes", "1"), labelIds: [tag.id] });
      let at = now, observed;
      const lockRequested = new Promise(resolve => { observed = resolve; });
      const observedChat = createChatStore({ getConnection: async () => {
        const runtimeConnection = await pool.getConnection();
        return { ...runtimeConnection, query: (...arguments_) => {
          const result = runtimeConnection.query(...arguments_);
          if (arguments_[0].startsWith("SELECT id, role, status, pseudonym")
            && arguments_[1]?.[0]?.equals(fixture.admin.id)) observed();
          return result;
        } };
      } }, { clock: () => at });
      const observedCrm = createCrmStore({ pool, chatStore: observedChat });
      let pending, timer;
      await connection.beginTransaction();
      try {
        await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [fixture.admin.id]);
        pending = observedCrm.deleteLabel({ ...actor(fixture), labelId: tag.id, expectedVersion: "1" });
        void pending.catch(() => {});
        await Promise.race([lockRequested, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("The synthetic CRM deletion did not request its owner lock.")), 5000);
        })]);
        clearTimeout(timer);
        const encrypted = seal(fixture, "Concurrent notes", "2");
        await connection.query(`UPDATE crm_profiles SET notes_encrypted = ?, notes_revision = 2, version = 2, updated_at = ?
          WHERE admin_id = ? AND conversation_id = ?`, [encrypted, sqlDate(now + 1000), fixture.admin.id, fixture.conversationId]);
        at = now + 2000;
        await connection.commit();
        assert.deepEqual(await pending, { deleted: true });
        const profile = await observedCrm.getProfile(request(fixture));
        assert.equal(profile.version, "3"); assert.equal(profile.notesRevision, "2");
        assert.equal(profile.notesEncrypted, encrypted); assert.equal(open(fixture, profile), "Concurrent notes");
        assert.equal(profile.updatedAt, at); assert.equal(profile.labels.length, 0);
        assert.equal((await observedCrm.listLabels(actor(fixture))).labels.length, 0);
      } finally {
        clearTimeout(timer);
        try { await connection.rollback(); } catch {}
        if (pending) await pending.catch(() => {});
      }
    });

    await t.test("a truly future profile date still blocks label deletion without changing notes or memberships", async () => {
      const fixture = await pair(), tag = await label(fixture, "Future date guard");
      const encrypted = seal(fixture, "Future protected notes", "1");
      await save(fixture, { notesEncrypted: encrypted, labelIds: [tag.id] });
      await connection.query("UPDATE crm_profiles SET updated_at = ? WHERE admin_id = ? AND conversation_id = ?",
        [sqlDate(now + 1), fixture.admin.id, fixture.conversationId]);
      await assert.rejects(crm.deleteLabel({ ...actor(fixture), labelId: tag.id, expectedVersion: "1" }), code("CRM_DATABASE_STATE"));
      const profile = await crm.getProfile(request(fixture, { now: now + 1 }));
      assert.equal(profile.version, "1"); assert.equal(profile.notesRevision, "1");
      assert.equal(profile.notesEncrypted, encrypted); assert.equal(open(fixture, profile), "Future protected notes");
      assert.equal(profile.labels.length, 1);
      assert.equal((await crm.listLabels(actor(fixture))).labels[0].memberCount, 1);
    });

    await t.test("profile or affected-profile overflow aborts the whole mutation", async () => {
      const fixture = await pair(), tag = await label(fixture, "Overflow guard"); await save(fixture, { labelIds: [tag.id] });
      await connection.query("UPDATE crm_profiles SET version = 4294967295 WHERE admin_id = ? AND conversation_id = ?", [fixture.admin.id, fixture.conversationId]);
      await assert.rejects(save(fixture, { expectedVersion: "4294967295" }), code("CRM_LIMIT"));
      await assert.rejects(crm.deleteLabel({ ...actor(fixture), labelId: tag.id, expectedVersion: "1" }), code("CRM_LIMIT"));
      const profile = await crm.getProfile(request(fixture)); assert.equal(profile.labels.length, 1); assert.equal(profile.version, "4294967295"); assert.equal(profile.notesRevision, "1");
      assert.equal((await crm.listLabels(actor(fixture))).labels[0].memberCount, 1);
    });

    await t.test("a failed membership insert rolls back profile, revision and previous bindings", async () => {
      const fixture = await pair(), one = await label(fixture, "One"), two = await label(fixture, "Two");
      await save(fixture, { nickname: "Original", labelIds: [one.id] });
      await connection.query("CREATE TRIGGER synthetic_fail_crm BEFORE INSERT ON crm_memberships FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic private failure'");
      try { await assert.rejects(save(fixture, { expectedVersion: "1", nickname: "Failed", labelIds: [two.id] }), code("CHAT_DATABASE_OPERATION")); }
      finally { await connection.query("DROP TRIGGER synthetic_fail_crm"); }
      const profile = await crm.getProfile(request(fixture)); assert.equal(profile.version, "1"); assert.equal(profile.nickname, "Original"); assert.ok(profile.labels[0].id.equals(one.id));
    });

    await t.test("inbox searches pseudonym, private alias and email literally without exposing notes or email", async () => {
      const a = await pair(null, { pseudonym: "Literal %_ client" }), b = await pair(a.admin, { pseudonym: "Ordinary client" });
      await save(a, { nickname: "Alias introuvable", notesEncrypted: seal(a, "SecretNotSearchable", "1") }); await save(b);
      for (const query of ["%_", "LITERAL", "introuvable", a.client.email]) {
        const page = await contacts(a, { q: query }); assert.equal(page.contacts.length, 1); assert.ok(page.contacts[0].id.equals(a.conversationId));
      }
      assert.equal((await contacts(a, { q: "SecretNotSearchable" })).contacts.length, 0);
      const page = await contacts(a); assert.equal(page.contacts.length, 2);
      for (const contact of page.contacts) for (const name of ["email", "notes", "notesEncrypted", "notesRevision", "password_hash", "bodyEncrypted"]) assert.equal(Object.hasOwn(contact, name), false);
    });

    await t.test("tag/group filters combine with AND and reject wrong-kind or foreign filter IDs", async () => {
      const a = await pair(), b = await pair(a.admin), c = await pair(a.admin), tag = await label(a, "Fidèle"), group = await label(a, "Soir", "group");
      await save(a, { labelIds: [tag.id, group.id] }); await save(b, { labelIds: [tag.id] }); await save(c, { labelIds: [group.id] });
      assert.equal((await contacts(a, { tagId: tag.id })).contacts.length, 2);
      assert.equal((await contacts(a, { groupId: group.id })).contacts.length, 2);
      const both = await contacts(a, { tagId: tag.id, groupId: group.id }); assert.equal(both.contacts.length, 1); assert.ok(both.contacts[0].id.equals(a.conversationId));
      await assert.rejects(contacts(a, { tagId: group.id }), code("CRM_NOT_FOUND"));
      await assert.rejects(contacts(a, { groupId: id() }), code("CRM_NOT_FOUND"));
    });

    await t.test("reminder filters use the current instant and unread counts exclude own and deleted messages", async () => {
      const a = await pair(), b = await pair(a.admin), c = await pair(a.admin);
      await save(a, { reminderAt: now }); await save(b, { reminderAt: now + 1000 });
      assert.ok((await contacts(a, { reminder: "due" })).contacts[0].id.equals(a.conversationId));
      assert.ok((await contacts(a, { reminder: "upcoming" })).contacts[0].id.equals(b.conversationId));
      assert.ok((await contacts(a, { reminder: "none" })).contacts[0].id.equals(c.conversationId));
      const incoming = await send(a); await send(b, "admin");
      const unread = await contacts(a, { unread: true }); assert.equal(unread.contacts.length, 1); assert.equal(unread.contacts[0].unreadCount, 1);
      await chat.markRead({ role: "admin", ...request(a), through: incoming.message.sequence });
      assert.equal((await contacts(a, { unread: true })).contacts.length, 0);
      const removed = await send(a); await chat.deleteMessage({ role: "client", tokenHash: a.client.tokenHash, now, conversationId: a.conversationId, messageId: removed.message.id });
      assert.equal((await contacts(a, { unread: true })).contacts.length, 0);
    });

    await t.test("live expiry/revocation filters preserve administrative history editing without granting message send", async () => {
      const a = await pair(), b = await pair(a.admin), c = await pair(a.admin), d = await pair(a.admin);
      await save(a); await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(now + 1), a.client.id]);
      await connection.query("UPDATE users SET status = 'revoked' WHERE id = ?", [b.client.id]);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [c.client.id]);
      await connection.query("UPDATE users SET status = 'pending', access_approved_at = NULL WHERE id = ?", [d.client.id]);
      const later = now + 2;
      for (const [fixture, expected] of [[a, "expired"], [b, "revoked"], [c, "suspended"], [d, "pending"]]) {
        const page = await contacts(a, { now: later, access: expected }); assert.equal(page.contacts.length, 1); assert.ok(page.contacts[0].id.equals(fixture.conversationId)); assert.equal(page.contacts[0].canSend, false);
        assert.equal((await crm.getProfile(request(fixture, { now: later }))).access.state, expected);
        const current = await crm.getProfile(request(fixture, { now: later }));
        assert.equal((await save(fixture, { now: later, expectedVersion: current.version, nickname: "History remains private" })).nickname, "History remains private");
        await assert.rejects(chat.sendMessage({ role: "admin", ...request(fixture, { now: later }), message: payload() }), code("CHAT_FORBIDDEN"));
      }
    });

    await t.test("contact keyset pages are stable, assigned-only and carry batched labels without sensitive projections", async () => {
      const first = await pair(), second = await pair(first.admin), third = await pair(first.admin), stranger = await pair();
      const tag = await label(first, "Page metadata"); for (const fixture of [first, second, third]) await save(fixture, { labelIds: [tag.id] });
      await save(stranger, { nickname: "Must not appear" });
      const all = [], cursors = []; let afterId = null;
      do {
        const page = await contacts(first, { limit: 1, afterId }); all.push(...page.contacts); cursors.push(page.nextCursor); afterId = page.nextCursor;
        assert.equal(page.contacts.length, 1); assert.equal(page.contacts[0].labels[0].memberCount, 3);
      } while (afterId !== null);
      assert.equal(all.length, 3); assert.equal(cursors.at(-1), null);
      const ordered = [first, second, third].map((fixture) => fixture.conversationId.toString("hex")).sort(); assert.deepEqual(all.map((contact) => contact.id.toString("hex")), ordered);
      await connection.query("UPDATE conversations SET admin_id = ? WHERE id = ?", [stranger.admin.id, first.conversationId]);
      assert.equal((await contacts(first)).contacts.length, 2);
      assert.equal((await crm.listLabels(actor(first))).labels[0].memberCount, 2);
      await assert.rejects(crm.getProfile(request(first)), code("CHAT_NOT_FOUND"));
      assert.equal((await crm.getProfile(request(stranger, { conversationId: first.conversationId }))).version, "0", "new owner cannot read old owner's private profile");
    });

    await t.test("latest activity diagnostics retain exact results, bounded contact pages and owner isolation on long synthetic histories", { timeout: 60000 }, async context => {
      const first = await pair(), fixtures = [first], metricNow = now + 60000;
      for (let index = 1; index < 51; index++) fixtures.push(await pair(first.admin));
      const stranger = await pair(), histories = [{ fixture: first, count: 1000 }, { fixture: fixtures[1], count: 10000 }];
      await connection.beginTransaction();
      try {
        for (const { fixture, count } of histories) {
          for (let offset = 0; offset < count; offset += 200) {
            const batch = Array.from({ length: Math.min(200, count - offset) }, (_, index) => {
              const sequence = offset + index + 1;
              return { id: id(), sequence: String(sequence), occurredAt: sqlDate(now + sequence) };
            });
            await connection.query(`INSERT INTO messages (id, conversation_id, sequence_no, sender_id, sender_role,
              client_message_id, body_encrypted, body_fingerprint, created_at) VALUES ${batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
            batch.flatMap(row => [row.id, fixture.conversationId, row.sequence, fixture.client.id, "client", id(),
              "v1.synthetic-capacity-message", digest(), row.occurredAt]));
            await connection.query(`INSERT INTO chat_events (conversation_id, event_sequence, message_id, kind, occurred_at)
              VALUES ${batch.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
            batch.flatMap(row => [fixture.conversationId, row.sequence, row.id, "message", row.occurredAt]));
          }
        }
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }

      // Observe only store query calls, not fixture seeding, driver transaction
      // methods or the pool's own connection setup. Never log SQL parameters.
      let queries = [];
      const observedPool = { getConnection: async () => {
        const native = await pool.getConnection();
        return { ...native, query: async (sql, parameters) => {
          queries.push({ sql, parameters }); return native.query(sql, parameters);
        } };
      } };
      const observedChat = createChatStore(observedPool), observedCrm = createCrmStore({ pool: observedPool, chatStore: observedChat });
      const measurements = [], plans = [];
      async function measure(operation, details, work) {
        queries = []; const started = performance.now(), result = await work();
        measurements.push({ operation, ...details, queryCalls: queries.length, elapsedMs: Number((performance.now() - started).toFixed(3)) });
        return { result, statements: queries };
      }
      async function explain(operation, statement, details = {}) {
        assert.ok(statement && typeof statement.sql === "string", "the actual store statement must have been observed");
        const rows = await connection.query(`EXPLAIN ${statement.sql}`, statement.parameters);
        assert.ok(Array.isArray(rows) && rows.length > 0, "native EXPLAIN must return a plan");
        plans.push({ operation, ...details, plan: rows.map(row => ({ selectType: row.select_type ?? null,
          table: row.table ?? null, type: row.type ?? null, key: row.key ?? null,
          rows: row.rows == null ? null : Number(row.rows), extra: row.Extra ?? null })) });
      }
      for (const { fixture, count } of histories) {
        const measured = await measure("conversationLatestActivity", { historyEvents: count }, () => observedChat.readMessages({
          ...request(fixture, { now: metricNow }), role: "admin", limit: 1,
        }));
        const page = measured.result;
        assert.equal(page.conversation.lastActivityAt, now + count);
        assert.equal(page.conversation.latestEventSequence, String(count));
        assert.equal(page.conversation.latestSequence, String(count)); assert.equal(page.conversation.unreadCount, count);
        assert.equal(page.messages.length, 1); assert.equal(page.messages[0].sequence, String(count));
        assert.equal(page.hasMoreBefore, true); assert.equal(page.hasMoreAfter, false);
        await explain("conversationSummary", measured.statements.find(statement => statement.sql.includes("AS lastActivityAt")), { historyEvents: count });
        await explain("latestActivityMaximum", { sql: "SELECT MAX(occurred_at) AS lastActivityAt FROM chat_events WHERE conversation_id = ?",
          parameters: [fixture.conversationId] }, { historyEvents: count });
      }
      const firstPage = await measure("contactsFirstPage", { requestedLimit: 50 }, () => observedCrm.listContacts({ ...actor(first, { now: metricNow }), limit: 50 }));
      assert.equal(firstPage.result.contacts.length, 50); assert.equal(firstPage.result.hasMore, true);
      assert.ok(firstPage.result.nextCursor.equals(firstPage.result.contacts.at(-1).id));
      await explain("contactsFirstPage", firstPage.statements.find(statement => statement.sql.includes("AS last_activity_at")));
      const secondPage = await measure("contactsNextPage", { requestedLimit: 50 }, () => observedCrm.listContacts({
        ...actor(first, { now: metricNow }), limit: 50, afterId: firstPage.result.nextCursor,
      }));
      assert.equal(secondPage.result.contacts.length, 1); assert.equal(secondPage.result.hasMore, false); assert.equal(secondPage.result.nextCursor, null);
      const contacts = [...firstPage.result.contacts, ...secondPage.result.contacts];
      assert.deepEqual(contacts.map(row => row.id.toString("hex")), fixtures.map(fixture => fixture.conversationId.toString("hex")).sort());
      for (const { fixture, count } of histories) {
        const contact = contacts.find(row => row.id.equals(fixture.conversationId));
        assert.equal(contact.lastActivityAt, now + count); assert.equal(contact.latestSequence, String(count)); assert.equal(contact.unreadCount, count);
      }
      const other = await observedCrm.listContacts(actor(stranger, { now: metricNow }));
      assert.equal(other.contacts.length, 1); assert.ok(other.contacts[0].id.equals(stranger.conversationId));
      await assert.rejects(observedCrm.getProfile(request(stranger, { now: metricNow, conversationId: first.conversationId })), code("CHAT_NOT_FOUND"));
      await assert.rejects(observedCrm.getProfile(request(first, { now: metricNow, conversationId: stranger.conversationId })), code("CHAT_NOT_FOUND"));
      const mariaDbVersion = (await connection.query("SELECT VERSION() AS version"))[0].version;
      context.diagnostic(JSON.stringify({ type: "latest-activity-capacity-synthetic-metrics", mariaDbVersion,
        data: { ownerContacts: 51, otherOwnerContacts: 1, histories: histories.map(row => row.count) }, measurements, plans,
        limits: { syntheticOnly: true, loopbackOnly: true, elapsedTimesInformational: true, noHostingConcurrencyClaim: true,
          queryCountsExcludePoolSetupAndDriverTransactionMethods: true } }));
    });

    await t.test("database constraints prevent malformed IDs, wrong owners and impossible note revisions", async () => {
      const a = await pair(), b = await pair(), tag = await label(a, "Owner FK"), foreign = await label(b, "Other FK"); await save(a, { labelIds: [tag.id] });
      await assert.rejects(connection.query("UPDATE crm_profiles SET notes_revision = version + 1 WHERE admin_id = ? AND conversation_id = ?", [a.admin.id, a.conversationId]));
      await assert.rejects(connection.query("UPDATE crm_profiles SET version = 0 WHERE admin_id = ? AND conversation_id = ?", [a.admin.id, a.conversationId]));
      await assert.rejects(connection.query("INSERT INTO crm_memberships (admin_id, conversation_id, label_id, created_at) VALUES (?, ?, ?, ?)", [a.admin.id, a.conversationId, foreign.id, sqlDate(now)]));
      await assert.rejects(connection.query("UPDATE crm_labels SET kind = 'room' WHERE id = ?", [tag.id]));
      await assert.rejects(connection.query("UPDATE crm_labels SET id = ? WHERE id = ?", [Buffer.alloc(1), tag.id]));
      await assert.rejects(crm.renameLabel({ ...actor(a), labelId: tag.id, expectedVersion: "01", name: "No", normalizedName: "no" }), code("CRM_INPUT"));
      assert.ok(new CrmStoreError("CRM_INPUT") instanceof ChatStoreError);
    });
  } finally {
    if (pool) await pool.end();
    await reset(); await connection.end();
  }
});
