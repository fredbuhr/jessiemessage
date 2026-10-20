import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createAccessService } from "../server/access/service.mjs";
import { createAccessHandler } from "../server/access/http.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createChatService } from "../server/chat/service.mjs";
import { createChatHandler } from "../server/chat/http.mjs";
import { createCrmStore } from "../server/crm/store.mjs";
import { createCrmService } from "../server/crm/service.mjs";
import { createCrmHandler } from "../server/crm/http.mjs";
import { createConversationExporter } from "../server/chat/conversation-export.mjs";
import { createAppServer } from "../server/index.mjs";
import { createRecoveryCodes, hashPassword, makeTotpSecret, recoveryCodeDigest, sealTotpSecret, totpCode } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const hex = (value) => value.toString("hex");
const cookieToken = (cookie) => cookie.slice(cookie.indexOf("=") + 1);

test("real HTTP private CRM, encrypted notes, scoped labels and current authorization (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "separately provisioned runtime DML credentials are required");
  const migrations = await loadMigrations();
  assert.equal(migrations.length, 31);
  const allowedTables = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase();
  let pool;
  let server;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset();
    await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const authStore = createAuthStore(pool);
    const accessStore = createAccessStore(pool);
    const chatStore = createChatStore(pool);
    const crmStore = createCrmStore({ pool, chatStore });
    for (const store of [authStore, accessStore, chatStore, crmStore]) assert.equal(await store.assertSchema(), true);
    let now = Date.now();
    const clock = () => now;
    const totpKey = randomBytes(32);
    const mailKey = randomBytes(32);
    const messageKey = randomBytes(32);
    const crmKey = randomBytes(32);
    const origin = "https://example.invalid";
    const adminPassword = "Synthetic CRM administrator password 2026!";
    const clientPassword = "Synthetic CRM client password 2026!";
    const adminHash = await hashPassword(adminPassword);
    const admins = ["primary", "other"].map((suffix) => ({ id: randomBytes(16),
      email: `crm-flow-admin-${suffix}@example.invalid`, pseudonym: `Synthetic CRM administrator ${suffix}`, secret: makeTotpSecret() }));
    const [owner, otherOwner] = admins;
    await authStore.initializeAdmin({ id: owner.id, email: owner.email, pseudonym: owner.pseudonym,
      passwordHash: adminHash, secretEncrypted: sealTotpSecret(owner.secret, totpKey, owner.id),
      recoveryDigests: createRecoveryCodes().map(recoveryCodeDigest), now });
    // A second administrator is an isolated SQL ownership fixture, not another bootstrap or an account-management API.
    await connection.query("INSERT INTO users (id, role, status, pseudonym, email, password_hash, created_at, updated_at) VALUES (?, 'admin', 'active', ?, ?, ?, ?, ?)",
      [otherOwner.id, otherOwner.pseudonym, otherOwner.email, adminHash, sqlDate(now), sqlDate(now)]);
    await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step) VALUES (?, ?, 1, -1)",
      [otherOwner.id, sealTotpSecret(otherOwner.secret, totpKey, otherOwner.id)]);
    const clientHash = await hashPassword(clientPassword);
    const clients = ["a", "b", "unassigned"].map((suffix) => ({ id: randomBytes(16), conversationId: randomBytes(16),
      email: `crm-flow-client-${suffix}@example.invalid`, pseudonym: `Synthetic CRM client ${suffix.toUpperCase()}` }));
    const [clientA, clientB, otherClient] = clients;
    // Synthetic invitation, e-mail and administrator approval exercise manual admission.
    // This suite does not create real accounts, send mail, or provide an age-proof API.
    for (const client of clients) {
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash,
        email_verified_at, age_assured_at, access_approved_at, created_at, updated_at)
        VALUES (?, 'client', 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client.id, client.pseudonym, client.email, clientHash, sqlDate(now), null, sqlDate(now), sqlDate(now), sqlDate(now)]);
      await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [client.id, sqlDate(now)]);
      await consumeSyntheticInvitation(connection, client.id, now);
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)",
        [client.conversationId, client.id, client === otherClient ? otherOwner.id : owner.id, sqlDate(now)]);
    }
    const authService = await createAuthService({ store: authStore, totpKey, clock });
    const accessService = await createAccessService({ store: accessStore, authStore, authService, totpKey, mailKey, origin, clock });
    const chatService = await createChatService({ store: chatStore, authStore, authService, accessService, key: messageKey, clock });
    const crmService = await createCrmService({ store: crmStore, authService, authStore, key: crmKey, clock });
    const conversationExporter = createConversationExporter({ history: (token, id, options) => chatService.messages("admin", token, id, options), clock });
    server = createAppServer({ authHandler: createAuthHandler(authService, { origin }),
      accessHandler: createAccessHandler(accessService, { origin }), chatHandler: createChatHandler(chatService, { origin }),
      crmHandler: createCrmHandler(crmService, { origin, conversationExporter }) });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, { method = "GET", body, headers = {} } = {}) {
      const response = await fetch(`${base}${path}`, { method, redirect: "manual",
        headers: { ...(method === "POST" ? { Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1" } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      let value;
      try { value = JSON.parse(text); } catch { value = text; }
      return { status: response.status, headers: response.headers, body: value };
    }
    const headersFor = (session) => ({ Cookie: session.cookie, "X-CSRF-Token": session.csrf });
    const crm = (suffix) => `/api/admin/crm/${suffix}`;
    const profilePath = (client = clientA) => crm(`conversations/${hex(client.conversationId)}`);
    const chatPath = (role, client = clientA) => `/api/chat/${role}/conversations/${hex(client.conversationId)}/messages`;
    const save = (session, client, input) => request(profilePath(client), { method: "POST", headers: headersFor(session), body: input });
    const labels = (profile) => profile.labels.map((label) => label.id).sort();
    const ids = (result) => result.body.contacts.map((contact) => contact.id).sort();
    const rowFor = async (client) => (await connection.query("SELECT version, notes_revision, notes_encrypted FROM crm_profiles WHERE admin_id = ? AND conversation_id = ?", [owner.id, client.conversationId]))[0];
    const contacts = (query = "", session = admin) => request(crm(`contacts${query ? `?${query}` : ""}`), { headers: headersFor(session) });
    let admin;
    let otherAdmin;
    let a;
    let b;
    let tag;
    let group;
    let foreignTag;
    let profileA;
    let profileB;
    const notesA = "  Private CRM-only marker NOTES_SEARCH_MUST_STAY_PRIVATE\n<script>window.crmLeak=true</script> — exact 💬 whitespace.  ";
    const notesB = "Synthetic private second-client note; never sent to the client.";
    const inputA = (overrides = {}) => ({ expectedVersion: profileA?.version ?? "0", nickname: "Private Alpha%_Alias", notes: notesA,
      reminderAt: now - 1, labelIds: [tag.id, group.id], ...overrides });
    const inputB = (overrides = {}) => ({ expectedVersion: profileB?.version ?? "0", nickname: "Private Beta", notes: notesB,
      reminderAt: now + 3600000, labelIds: [tag.id], ...overrides });

    await t.test("real MFA and client logins establish separate roles and assigned CRM scopes", async () => {
      for (const actor of admins) {
        const login = await request("/api/auth/login", { method: "POST", body: { email: actor.email, password: adminPassword, factor: totpCode(actor.secret, { now }) } });
        assert.equal(login.status, 200);
        const session = { cookie: login.headers.get("set-cookie").split(";")[0], csrf: login.body.csrf };
        if (actor === owner) admin = session;
        else otherAdmin = session;
      }
      for (const client of [clientA, clientB]) {
        const login = await request("/api/access/login", { method: "POST", body: { email: client.email, password: clientPassword } });
        assert.equal(login.status, 200);
        assert.equal(login.body.access.state, "active");
        const session = { cookie: login.headers.get("set-cookie").split(";")[0], csrf: login.body.csrf };
        if (client === clientA) a = session;
        else b = session;
      }
      const capability = await request(crm("capabilities"), { headers: headersFor(admin) });
      assert.equal(capability.status, 200);
      assert.deepEqual(capability.body, { enabled: true, limits: { labelsPerKind: 100, labelsPerClient: 32, noteCharacters: 8000 }, conversationExport: { enabled: true, photos: false, maxBytes: 33554432 } });
      assert.deepEqual(ids(await contacts()), [hex(clientA.conversationId), hex(clientB.conversationId)].sort());
      assert.deepEqual(ids(await contacts("", otherAdmin)), [hex(otherClient.conversationId)]);
      assert.equal((await request(profilePath(otherClient), { headers: headersFor(admin) })).status, 404);
      assert.equal((await request(profilePath(), { headers: headersFor(otherAdmin) })).status, 404);
    });

    await t.test("CRM source assets and APIs reject anonymous clients and forged administrator cookies", async () => {
      const forged = { Cookie: `__Host-jessie_session=${cookieToken(a.cookie)}` };
      for (const path of ["/crm.js", "/crm-model.js", "/crm.css", "/private-archive.js", crm("capabilities"), crm("contacts"), crm("labels"), profilePath()]) {
        for (const headers of [{}, headersFor(a), forged]) {
          const denied = await request(path, { headers });
          assert.equal(denied.status, 401, path);
          assert.equal(JSON.stringify(denied.body).includes("Private Alpha"), false);
          assert.match(denied.headers.get("cache-control"), /no-store/);
        }
        assert.equal((await request(path, { headers: headersFor(admin) })).status, 200, path);
      }
      for (const path of ["/crm.js", "/crm-model.js", "/crm.css"]) {
        assert.equal((await request(path, { method: "HEAD", headers: headersFor(a) })).status, 401);
        assert.equal((await request(path, { method: "HEAD", headers: headersFor(admin) })).status, 200);
      }
    });

    await t.test("label names normalize for retry deduplication without changing existing display names", async () => {
      const created = await request(crm("labels"), { method: "POST", headers: headersFor(admin), body: { kind: "tag", name: "  VIP\u00a0 Friends  " } });
      assert.equal(created.status, 201);
      assert.equal(created.body.duplicate, false);
      tag = created.body.label;
      assert.equal(tag.name, "VIP Friends");
      assert.equal(tag.version, "1");
      const duplicate = await request(crm("labels"), { method: "POST", headers: headersFor(admin), body: { kind: "tag", name: "vip  friends" } });
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body.duplicate, true);
      assert.equal(duplicate.body.label.id, tag.id);
      assert.equal(duplicate.body.label.name, "VIP Friends");
      const madeGroup = await request(crm("labels"), { method: "POST", headers: headersFor(admin), body: { kind: "group", name: "Inner Circle" } });
      assert.equal(madeGroup.status, 201);
      const renamed = await request(crm(`labels/${madeGroup.body.label.id}/rename`), { method: "POST", headers: headersFor(admin), body: { expectedVersion: "1", name: " Close\u00a0 circle " } });
      assert.equal(renamed.status, 200);
      group = renamed.body.label;
      assert.equal(group.name, "Close circle");
      assert.equal(group.version, "2");
      const other = await request(crm("labels"), { method: "POST", headers: headersFor(admin), body: { kind: "group", name: "Other Group" } });
      const clash = await request(crm(`labels/${other.body.label.id}/rename`), { method: "POST", headers: headersFor(admin), body: { expectedVersion: "1", name: "close circle" } });
      assert.equal(clash.status, 409);
      assert.deepEqual(clash.body, { error: "name_in_use" });
      const racers = await Promise.all(["First candidate", "Second candidate"].map((name) => request(crm(`labels/${other.body.label.id}/rename`),
        { method: "POST", headers: headersFor(admin), body: { expectedVersion: "1", name } })));
      assert.deepEqual(racers.map((result) => result.status).sort(), [200, 409]);
      assert.deepEqual(racers.find((result) => result.status === 409).body, { error: "record_changed" });
      const foreign = await request(crm("labels"), { method: "POST", headers: headersFor(otherAdmin), body: { kind: "tag", name: "Other owner only" } });
      assert.equal(foreign.status, 201);
      foreignTag = foreign.body.label;
      assert.equal((await contacts(`tagId=${foreignTag.id}`)).status, 404);
      for (const [action, body] of [["rename", { expectedVersion: foreignTag.version, name: "Unauthorized rename" }], ["delete", { expectedVersion: foreignTag.version }]]) {
        assert.equal((await request(crm(`labels/${foreignTag.id}/${action}`), { method: "POST", headers: headersFor(admin), body })).status, 404);
      }
      assert.equal((await request(crm("labels"), { method: "POST", headers: { Cookie: admin.cookie }, body: { kind: "tag", name: "No CSRF" } })).status, 403);
      assert.equal((await request(crm("labels"), { method: "POST", headers: { ...headersFor(admin), Origin: "https://foreign.invalid" }, body: { kind: "tag", name: "Wrong origin" } })).status, 403);
    });

    await t.test("profile reads do not create rows and atomic saves persist authenticated ciphertext only", async () => {
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM crm_profiles"))[0].count), 0);
      const empty = await request(profilePath(), { headers: headersFor(admin) });
      assert.equal(empty.status, 200);
      assert.equal(empty.body.version, "0");
      assert.equal(empty.body.notes, "");
      assert.equal(empty.body.client.email, clientA.email);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM crm_profiles"))[0].count), 0);
      const savedA = await save(admin, clientA, inputA());
      const savedB = await save(admin, clientB, inputB());
      assert.equal(savedA.status, 200);
      assert.equal(savedB.status, 200);
      profileA = savedA.body;
      profileB = savedB.body;
      assert.equal(profileA.version, "1");
      assert.equal(profileA.notes, notesA);
      assert.equal(profileB.notes, notesB);
      assert.deepEqual(labels(profileA), [tag.id, group.id].sort());
      for (const [client, notes] of [[clientA, notesA], [clientB, notesB]]) {
        const row = await rowFor(client);
        assert.match(row.notes_encrypted, /^v1\./);
        assert.equal(row.notes_encrypted.includes(notes), false);
        assert.equal(row.notes_encrypted.includes("Synthetic private"), false);
        assert.equal(Number(row.version), 1);
        assert.equal(Number(row.notes_revision), 1);
      }
      assert.equal(Object.hasOwn(profileA, "notesRevision"), false);
      assert.equal(Object.hasOwn(profileA, "notesEncrypted"), false);
      const ownLabels = await request(crm("labels"), { headers: headersFor(admin) });
      assert.equal(ownLabels.body.labels.find((label) => label.id === tag.id).memberCount, 2);
      assert.equal(ownLabels.body.labels.find((label) => label.id === group.id).memberCount, 1);
      const otherSaved = await save(otherAdmin, otherClient, { expectedVersion: "0", nickname: "Other owner private alias", notes: "Unassigned encrypted private note", reminderAt: null, labelIds: [foreignTag.id] });
      assert.equal(otherSaved.status, 200);
    });

    await t.test("foreign or missing labels and stale versions roll back the full profile save", async () => {
      const before = await rowFor(clientA);
      const denied = await save(admin, clientA, inputA({ nickname: "Must roll back", notes: "Must never persist", labelIds: [tag.id, foreignTag.id] }));
      assert.equal(denied.status, 404);
      const after = await rowFor(clientA);
      assert.equal(after.notes_encrypted, before.notes_encrypted);
      assert.equal(Number(after.version), Number(before.version));
      const unchanged = await request(profilePath(), { headers: headersFor(admin) });
      assert.equal(unchanged.body.nickname, profileA.nickname);
      assert.equal(unchanged.body.notes, notesA);
      assert.deepEqual(labels(unchanged.body), [tag.id, group.id].sort());
      const stale = await save(admin, clientA, inputA({ expectedVersion: "0", notes: "Stale draft must not overwrite" }));
      assert.equal(stale.status, 409);
      assert.deepEqual(stale.body, { error: "record_changed" });
      assert.equal((await save(admin, clientA, { ...inputA(), adminId: hex(otherOwner.id) })).status, 400);
      assert.equal((await save(admin, otherClient, inputA())).status, 404);
    });

    await t.test("concurrent profile drafts resolve to one versioned save without losing the winner's note", async () => {
      const drafts = ["First concurrent private note", "Second concurrent private note"];
      const results = await Promise.all(drafts.map((notes) => save(admin, clientA, inputA({ notes }))));
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
      assert.deepEqual(results.find((result) => result.status === 409).body, { error: "record_changed" });
      profileA = results.find((result) => result.status === 200).body;
      assert.equal(profileA.version, "2");
      assert.ok(drafts.includes(profileA.notes));
      const fresh = await request(profilePath(), { headers: headersFor(admin) });
      assert.equal(fresh.body.notes, profileA.notes);
      assert.equal(fresh.body.version, "2");
      assert.equal(Number((await rowFor(clientA)).notes_revision), 2);
    });

    await t.test("inbox filters combine literal search, tag/group membership, unread status and private reminders", async () => {
      const sent = await request(chatPath("client"), { method: "POST", headers: headersFor(a), body: { clientMessageId: hex(randomBytes(16)), body: "Synthetic incoming unread CRM filter text" } });
      assert.equal(sent.status, 201);
      const all = await contacts();
      assert.equal(all.status, 200);
      assert.deepEqual(ids(all), [hex(clientA.conversationId), hex(clientB.conversationId)].sort());
      assert.deepEqual(ids(await contacts(`q=${encodeURIComponent("%_")}`)), [hex(clientA.conversationId)]);
      assert.deepEqual(ids(await contacts(`q=${encodeURIComponent("private beta")}`)), [hex(clientB.conversationId)]);
      assert.deepEqual(ids(await contacts(`q=${encodeURIComponent(clientA.pseudonym.toLowerCase())}`)), [hex(clientA.conversationId)]);
      assert.deepEqual(ids(await contacts(`q=${encodeURIComponent(clientB.email)}`)), [hex(clientB.conversationId)]);
      assert.deepEqual(ids(await contacts(`q=${encodeURIComponent(profileA.notes)}`)), [], "notes are never searched");
      assert.deepEqual(ids(await contacts(`tagId=${tag.id}&groupId=${group.id}`)), [hex(clientA.conversationId)]);
      assert.equal((await contacts(`groupId=${tag.id}`)).status, 404, "a tag cannot act as a group filter");
      assert.deepEqual(ids(await contacts("unread=1")), [hex(clientA.conversationId)]);
      assert.deepEqual(ids(await contacts("reminder=due")), [hex(clientA.conversationId)]);
      assert.deepEqual(ids(await contacts("reminder=upcoming")), [hex(clientB.conversationId)]);
      assert.deepEqual(ids(await contacts("reminder=none")), []);
      assert.deepEqual(ids(await contacts("access=active")), [hex(clientA.conversationId), hex(clientB.conversationId)].sort());
      const paged = await contacts("limit=1");
      assert.equal(paged.body.contacts.length, 1);
      assert.equal(paged.body.hasMore, true);
      const next = await contacts(`limit=1&afterId=${paged.body.nextCursor}`);
      assert.equal(next.body.contacts.length, 1);
      assert.equal(next.body.hasMore, false);
      assert.notEqual(next.body.contacts[0].id, paged.body.contacts[0].id);
      for (const contact of all.body.contacts) {
        assert.equal(Object.hasOwn(contact, "notes"), false);
        assert.equal(Object.hasOwn(contact, "email"), false);
        assert.equal(Object.hasOwn(contact.crm, "notes"), false);
        assert.equal(Object.hasOwn(contact.client, "email"), false);
      }
      const wire = JSON.stringify(all.body);
      for (const secret of [clientA.email, clientB.email, notesB, profileA.notes, (await rowFor(clientA)).notes_encrypted]) assert.equal(wire.includes(secret), false);
      const acknowledged = await request(`/api/chat/admin/conversations/${hex(clientA.conversationId)}/read`, { method: "POST", headers: headersFor(admin), body: { throughSequence: sent.body.message.sequence } });
      assert.equal(acknowledged.status, 200);
      assert.deepEqual(ids(await contacts("unread=1")), []);
    });

    await t.test("shared chat and client responses contain no administrator-only CRM data", async () => {
      const responses = [await request("/api/chat/client/conversation", { headers: headersFor(a) }),
        await request(chatPath("client"), { headers: headersFor(a) }),
        await request("/api/access/session", { headers: headersFor(a) }),
        await request("/api/chat/admin/conversations", { headers: headersFor(admin) })];
      for (const result of responses) {
        assert.equal(result.status, 200);
        const wire = JSON.stringify(result.body);
        for (const secret of [profileA.nickname, profileA.notes, notesB, "VIP Friends", "Close circle", clientA.email, clientB.email]) assert.equal(wire.includes(secret), false);
        for (const privateKey of ["crm", "notes", "nickname", "reminderAt", "notesEncrypted", "notesRevision"]) assert.equal(wire.includes(`"${privateKey}"`), false);
      }
    });

    await t.test("deleting a referenced label changes profile versions while preserving note revisions and ciphertext", async () => {
      const renamed = await request(crm(`labels/${tag.id}/rename`), { method: "POST", headers: headersFor(admin), body: { expectedVersion: tag.version, name: "VIP Friends renamed" } });
      assert.equal(renamed.status, 200);
      const currentTag = renamed.body.label;
      const beforeA = await rowFor(clientA);
      const beforeB = await rowFor(clientB);
      const beforeOther = (await connection.query("SELECT version, notes_revision, notes_encrypted FROM crm_profiles WHERE admin_id = ? AND conversation_id = ?", [otherOwner.id, otherClient.conversationId]))[0];
      const stale = await request(crm(`labels/${tag.id}/delete`), { method: "POST", headers: headersFor(admin), body: { expectedVersion: tag.version } });
      assert.equal(stale.status, 409);
      assert.equal(Number((await rowFor(clientA)).version), Number(beforeA.version));
      const deleted = await request(crm(`labels/${tag.id}/delete`), { method: "POST", headers: headersFor(admin), body: { expectedVersion: currentTag.version } });
      assert.equal(deleted.status, 200);
      assert.deepEqual(deleted.body, { deleted: true });
      for (const [client, previous] of [[clientA, beforeA], [clientB, beforeB]]) {
        const row = await rowFor(client);
        assert.equal(Number(row.version), Number(previous.version) + 1);
        assert.equal(Number(row.notes_revision), Number(previous.notes_revision));
        assert.equal(row.notes_encrypted, previous.notes_encrypted);
      }
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM crm_memberships WHERE label_id = ?", [Buffer.from(tag.id, "hex")]))[0].count), 0);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM crm_labels WHERE id = ?", [Buffer.from(tag.id, "hex")]))[0].count), 0);
      const afterOther = (await connection.query("SELECT version, notes_revision, notes_encrypted FROM crm_profiles WHERE admin_id = ? AND conversation_id = ?", [otherOwner.id, otherClient.conversationId]))[0];
      assert.deepEqual(afterOther, beforeOther);
      const oldVersion = profileA.version;
      const freshA = await request(profilePath(), { headers: headersFor(admin) });
      const freshB = await request(profilePath(clientB), { headers: headersFor(admin) });
      assert.equal(freshA.status, 200);
      assert.equal(freshB.status, 200);
      assert.equal(freshA.body.notes, profileA.notes, "old note revision still decrypts after membership deletion");
      assert.equal(freshB.body.notes, notesB);
      assert.deepEqual(labels(freshA.body), [group.id]);
      assert.deepEqual(labels(freshB.body), []);
      const staleSave = await save(admin, clientA, inputA({ expectedVersion: oldVersion, labelIds: [group.id] }));
      assert.equal(staleSave.status, 409);
      assert.deepEqual(staleSave.body, { error: "record_changed" });
      profileA = freshA.body;
      profileB = freshB.body;
      assert.equal((await contacts(`tagId=${tag.id}`)).status, 404);
    });

    await t.test("corrupt private notes fail generically without preventing metadata-only inbox reads", async () => {
      const row = await rowFor(clientA);
      const parts = row.notes_encrypted.split(".");
      parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
      await connection.query("UPDATE crm_profiles SET notes_encrypted = ? WHERE admin_id = ? AND conversation_id = ?", [parts.join("."), owner.id, clientA.conversationId]);
      try {
        const failed = await request(profilePath(), { headers: headersFor(admin) });
        assert.equal(failed.status, 503);
        assert.deepEqual(failed.body, { error: "crm_unavailable" });
        assert.equal(JSON.stringify(failed.body).includes(row.notes_encrypted), false);
        assert.equal(JSON.stringify(failed.body).includes(profileA.notes), false);
        assert.equal((await contacts()).status, 200);
      } finally {
        await connection.query("UPDATE crm_profiles SET notes_encrypted = ? WHERE admin_id = ? AND conversation_id = ?", [row.notes_encrypted, owner.id, clientA.conversationId]);
      }
      assert.equal((await request(profilePath(), { headers: headersFor(admin) })).body.notes, profileA.notes);
    });

    await t.test("conversation archive uses real scoped decryption without private CRM fields or read receipts", async () => {
      for (const [session, client] of [[otherAdmin, clientA], [admin, otherClient], [a, clientA]]) {
        const denied = await request(`${profilePath(client)}/export`, { method: "POST", headers: headersFor(session), body: { includePhotos: false } });
        assert.equal(denied.status, session === a ? 401 : 404);
      }
      const receipts = await connection.query("SELECT user_id, last_read_sequence, updated_at FROM chat_receipts WHERE conversation_id = ? ORDER BY user_id", [clientA.conversationId]);
      const response = await fetch(`${base}${profilePath()}/export`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headersFor(admin) }, body: JSON.stringify({ includePhotos: false }) });
      assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/zip");
      const archive = Buffer.from(await response.arrayBuffer()); assert.equal(archive.readUInt32LE(), 0x04034b50);
      assert.ok(archive.includes(Buffer.from("Synthetic incoming unread CRM filter text")));
      for (const marker of [notesA, notesB, clientA.email, clientB.email, "NOTES_SEARCH_MUST_STAY_PRIVATE", "Private Alpha%_Alias", "bodyEncrypted", "broadcast_preferences", "campaignId", "clientMessageId"]) assert.equal(archive.includes(Buffer.from(marker)), false, marker);
      assert.deepEqual(await connection.query("SELECT user_id, last_read_sequence, updated_at FROM chat_receipts WHERE conversation_id = ? ORDER BY user_id", [clientA.conversationId]), receipts);
    });

    await t.test("expired client access permits assigned private CRM edits but cannot authorize chat sends", async () => {
      const boundary = now + 60000;
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(boundary), clientA.id]);
      now = boundary;
      const expired = await contacts("access=expired");
      assert.equal(expired.status, 200);
      assert.deepEqual(ids(expired), [hex(clientA.conversationId)]);
      assert.equal(expired.body.contacts[0].canSend, false);
      const profile = await request(profilePath(), { headers: headersFor(admin) });
      assert.equal(profile.status, 200);
      assert.equal(profile.body.access.state, "expired");
      const edited = await save(admin, clientA, inputA({ nickname: "Private expired contact", notes: "Private note after access expiration", labelIds: [group.id], reminderAt: null }));
      assert.equal(edited.status, 200);
      assert.equal(edited.body.notes, "Private note after access expiration");
      assert.equal(Number((await rowFor(clientA)).notes_revision), Number(edited.body.version));
      profileA = edited.body;
      assert.equal((await request(chatPath("client"), { headers: headersFor(a) })).status, 403);
      assert.equal((await request(chatPath("admin"), { method: "POST", headers: headersFor(admin), body: { clientMessageId: hex(randomBytes(16)), body: "Must not send to expired client" } })).status, 403);
      assert.equal((await request(profilePath(), { headers: headersFor(a) })).status, 401);
    });

    await t.test("revoked client access preserves assigned CRM history without restoring client or send authority", async () => {
      const revoked = await request(`/api/admin/clients/${hex(clientB.id)}/revoke`, { method: "POST", headers: headersFor(admin), body: {} });
      assert.equal(revoked.status, 200);
      const result = await contacts("access=revoked");
      assert.equal(result.status, 200);
      assert.deepEqual(ids(result), [hex(clientB.conversationId)]);
      assert.equal(result.body.contacts[0].canSend, false);
      const edited = await save(admin, clientB, inputB({ notes: "Private retained note after revocation", labelIds: [], reminderAt: null }));
      assert.equal(edited.status, 200);
      assert.equal(edited.body.access.state, "revoked");
      assert.equal(edited.body.notes, "Private retained note after revocation");
      profileB = edited.body;
      assert.equal((await request(chatPath("client", clientB), { headers: headersFor(b) })).status, 401);
      assert.equal((await request(chatPath("admin", clientB), { method: "POST", headers: headersFor(admin), body: { clientMessageId: hex(randomBytes(16)), body: "Must not send to revoked client" } })).status, 403);
      assert.equal((await request(profilePath(clientB), { headers: headersFor(otherAdmin) })).status, 404);
    });

    await t.test("administrator logout immediately removes all private CRM reads writes and assets", async () => {
      const logout = await request("/api/auth/logout-all", { method: "POST", headers: headersFor(admin), body: {} });
      assert.equal(logout.status, 200);
      for (const path of [crm("capabilities"), crm("contacts"), crm("labels"), profilePath(), "/crm.js", "/crm-model.js", "/crm.css"]) {
        const denied = await request(path, { headers: headersFor(admin) });
        assert.equal(denied.status, 401, path);
        assert.match(denied.headers.get("set-cookie"), /^__Host-jessie_session=; /);
        assert.equal(JSON.stringify(denied.body).includes(profileA.notes), false);
      }
      assert.equal((await save(admin, clientA, { expectedVersion: profileA.version, nickname: "Unauthorized overwrite", notes: "Must never save", reminderAt: null, labelIds: [] })).status, 401);
      const other = await request(profilePath(otherClient), { headers: headersFor(otherAdmin) });
      assert.equal(other.status, 200);
      assert.equal(other.body.notes, "Unassigned encrypted private note");
      assert.equal((await contacts("", otherAdmin)).body.contacts.length, 1);
    });
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    try { if (pool) await pool.end(); }
    finally { try { await reset(); } finally { await connection.end(); } }
  }
});
