import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { makeTotpSecret, newToken, sealTotpSecret, tokenDigest } from "../server/auth/crypto.mjs";
import { sealVerificationPayload } from "../server/mail/crypto.mjs";
import { encryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";
import { parseArguments, readFrozenBackup, dumpCloneSql, inspectClone, run, main } from "../scripts/verify-text-clone.mjs";

const base = fileURLToPath(new URL("../../audit/", import.meta.url));
const key = (number) => Buffer.alloc(32, number).toString("base64url");
const id = (number) => Buffer.alloc(16, number);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sql = Buffer.from("CREATE TABLE synthetic (id INT);\nINSERT INTO synthetic VALUES (1);\n");
const origin = "https://recette.jessiemessage.com";
const source = () => ({
  database: { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306", database: "only_source", user: "runtime_user", password: "synthetic-runtime-password", privilegeProfile: "infomaniak-shared-pattern" },
  authentication: { format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) },
  messaging: { format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(2), messageKey: key(3), smtpHost: "smtp.example.invalid", smtpPort: "587", smtpUser: "synthetic-smtp-user", smtpPassword: "synthetic-smtp-password" },
});
const neutral = (code) => (error) => {
  assert.equal(error.code, code); assert.equal(error.message, code);
  assert.doesNotMatch(JSON.stringify(error), /synthetic|example\.invalid|only_source|only_clone|runtime_user|operator_user/);
  assert.equal(error.cause, undefined); return true;
};

async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "text-clone-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = gzipSync(sql), backup = "synthetic.sql.gz";
  await writeFile(join(directory, backup), archive, { mode: 0o600 });
  const scope = { path: directory, file: (name) => join(directory, name), assertReady: () => lstat(directory, { bigint: true }), sync: async () => {} };
  const selected = parseArguments(["verify", "--private-directory", directory, "--private-path-mode", "linux-dirfd", "--database", "only_clone", "--confirm-database", "only_clone", "--user", "operator_user", "--backup", backup, "--backup-sha256", hash(archive)]);
  const migrations = await loadMigrations(), tables = [...createdMigrationTables(migrations), "schema_migrations"];
  const admin = id(1), client = id(2), conversation = id(3), mail = id(4), message = id(5), token = newToken(), email = "synthetic@example.invalid", body = "Synthetic text content";
  const binding = { conversationId: conversation, messageId: message, senderId: admin };
  const rows = {
    mfa: [{ id: admin, encrypted: sealTotpSecret(makeTotpSecret(), Buffer.from(key(1), "base64url"), admin) }],
    mail: [{ id: mail, encrypted: sealVerificationPayload({ email, token }, Buffer.from(key(2), "base64url"), mail), recipient_user_id: client, challenge_user_id: client, token_hash: tokenDigest(token), recipient_email: email }],
    messages: [{ id: message, conversation_id: conversation, sender_id: admin, sender_role: "admin", admin_id: admin, client_id: client, encrypted: encryptMessageBody(body, Buffer.from(key(3), "base64url"), binding), body_fingerprint: messageFingerprint(body, Buffer.from(key(3), "base64url"), binding), deleted_at: null, media_id: null, media_owner_id: null }],
  };
  const calls = [], connected = [], events = [], bundle = source();
  const connection = { async query(statement, parameters) {
    calls.push({ statement, parameters });
    if (statement.startsWith("SET TRANSACTION") || statement.startsWith("START TRANSACTION")) return [];
    if (statement.startsWith("SELECT DATABASE()")) return [{ name: selected.database, version: "10.11.14-MariaDB" }];
    if (statement.startsWith("SHOW SESSION")) return [{ Variable_name: "Ssl_cipher", Value: "TLS_AES_256_GCM_SHA384" }];
    if (statement.includes("information_schema.TABLES")) return tables.map((name) => ({ name, kind: "BASE TABLE", engine: "InnoDB" }));
    if (statement.includes("FROM schema_migrations")) return migrations.map((migration) => ({ ...migration, state: "applied", attempts: 1 }));
    if (statement.includes("information_schema.KEY_COLUMN_USAGE")) return [{ parent_schema: selected.database }];
    if (statement.startsWith("SELECT EXISTS")) return [{ present: 0 }];
    if (statement.includes("FROM admin_mfa ")) return rows.mfa;
    if (statement.includes("FROM mail_outbox ")) return rows.mail;
    if (statement.includes("FROM messages ")) return rows.messages;
    throw new Error("unexpected query");
  }, async rollback() { events.push("rollback"); }, async end() { events.push("end"); } };
  const dependencies = { inheritedEnv: { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, execArgv: [],
    readBundle: async () => bundle, scopeOperation: async (_directory, callback) => callback(scope), inspectClient: async () => { events.push("client"); },
    readSecret: async () => { events.push("password"); return "synthetic operator \\\" password"; },
    dump: async () => { events.push("dump"); return { sqlBytes: sql.length, sqlSha256: hash(sql) }; },
    connect: async (env) => { connected.push(env); events.push("connect"); return connection; } };
  return { directory, scope, selected, archive, bundle, rows, calls, connected, events, connection, dependencies, tables, migrations };
}

test("clone guards reject source identity, unconfirmed targets and ambient configuration before credentials or any SQL access", async (t) => {
  const f = await fixture(t);
  for (const selected of [{ ...f.selected, database: "only_source", confirmation: "only_source" }, { ...f.selected, user: "runtime_user" }]) {
    await assert.rejects(run(selected, f.dependencies), neutral("TEXT_CLONE_CONFIGURATION"));
  }
  await assert.rejects(run({ ...f.selected, confirmation: "other_clone" }, f.dependencies), neutral("TEXT_CLONE_USAGE"));
  await assert.rejects(run(f.selected, { ...f.dependencies, inheritedEnv: { ...f.dependencies.inheritedEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" } }), neutral("TEXT_CLONE_ENVIRONMENT"));
  assert.deepEqual(f.events, []); assert.deepEqual(f.connected, []);
});

test("preflight verifies the frozen gzip but never consumes a password or opens the database", async (t) => {
  const f = await fixture(t), report = await run({ ...f.selected, command: "check" }, f.dependencies);
  assert.deepEqual(report, { status: "ready_for_input", backupBytes: f.archive.length, sqlBytes: sql.length, backupSha256: hash(f.archive), sqlSha256: hash(sql), databaseConnected: false });
  assert.deepEqual(f.events, ["client"]);
});

test("frozen backups require exact compressed hash, regular owner0600, one link and valid gzip", async (t) => {
  const f = await fixture(t), path = join(f.directory, f.selected.backup);
  assert.equal((await readFrozenBackup(f.scope, f.selected)).sqlSha256, hash(sql));
  await assert.rejects(readFrozenBackup(f.scope, { ...f.selected, backupSha256: "0".repeat(64) }), neutral("TEXT_CLONE_BACKUP"));
  await chmod(path, 0o640); await assert.rejects(readFrozenBackup(f.scope, f.selected), neutral("TEXT_CLONE_BACKUP")); await chmod(path, 0o600);
  await link(path, join(f.directory, "second")); await assert.rejects(readFrozenBackup(f.scope, f.selected), neutral("TEXT_CLONE_BACKUP")); await unlink(join(f.directory, "second"));
  const invalid = Buffer.from("synthetic invalid gzip"); await writeFile(path, invalid);
  await assert.rejects(readFrozenBackup(f.scope, { ...f.selected, backupSha256: hash(invalid) }), neutral("TEXT_CLONE_BACKUP"));
});

test("native dump sees only the canonical private0600 config path, bounded options and no credential in argv/env", async (t) => {
  const f = await fixture(t), password = 'synthetic \\ " password', observed = [];
  const spawnClient = (command, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    observed.push({ command, args, options });
    setImmediate(async () => {
      try {
        const filename = args[0].slice("--defaults-file=".length), metadata = await lstat(filename);
        assert.equal(resolve(filename), filename); assert.equal(metadata.mode & 0o7777, 0o600); assert.equal(metadata.nlink, 1);
        const config = await readFile(filename, "utf8"); assert.match(config, /\[client\]/); assert.match(config, /password="synthetic \\\\ \\" password"/);
        child.stdout.end(Buffer.from(sql)); child.stderr.end(Buffer.from("synthetic driver secret")); child.emit("close", 0, null);
      } catch (error) { child.emit("error", error); child.emit("close", 1, null); }
    }); return child;
  };
  assert.deepEqual(await dumpCloneSql(f.scope, f.selected, f.bundle.database, password, { spawnClient }), { sqlBytes: sql.length, sqlSha256: hash(sql) });
  const [{ command, args, options }] = observed;
  assert.equal(command, "/usr/bin/mariadb-dump"); assert.ok(args[0].startsWith(`--defaults-file=${f.directory}/`));
  assert.deepEqual(args.slice(1), ["--single-transaction", "--quick", "--skip-lock-tables", "--skip-add-locks", "--skip-add-drop-table", "--skip-comments", "--skip-triggers", "--hex-blob", "--no-tablespaces", "--protocol=TCP", "--ssl-ca=/etc/ssl/certs/ca-certificates.crt", "--ssl-verify-server-cert", "only_clone"]);
  assert.doesNotMatch(JSON.stringify({ args, options }), /synthetic|runtime_user|operator_user|example\.invalid/);
  assert.deepEqual(await readdir(f.directory), [f.selected.backup]);
});

test("a synchronous private dump sink receives every original chunk before its buffer is erased", async (t) => {
  const f = await fixture(t), captured = [], observed = [], chunks = [Buffer.from(sql.subarray(0, 17)), Buffer.from(sql.subarray(17))];
  const spawnClient = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => assert.fail("a successful synchronous sink must not stop the dump");
    setImmediate(() => { for (const chunk of chunks) child.stdout.write(chunk); child.stdout.end(); child.emit("close", 0, null); });
    return child;
  };
  const report = await dumpCloneSql(f.scope, f.selected, f.bundle.database, "synthetic-password", {
    spawnClient, onSqlChunk(chunk) { observed.push(chunk); captured.push(Buffer.from(chunk)); },
  });
  assert.deepEqual(report, { sqlBytes: sql.length, sqlSha256: hash(sql) });
  assert.deepEqual(Buffer.concat(captured), sql); assert.equal(observed.length, chunks.length);
  assert.ok(observed.every((chunk) => chunk.every((byte) => byte === 0)));
  assert.ok(chunks.every((chunk) => chunk.every((byte) => byte === 0)));
  assert.deepEqual(await readdir(f.directory), [f.selected.backup]);
});

test("invalid dump sinks are refused before any private path or temporary credential is accessed", async (t) => {
  const f = await fixture(t); let accessed = false, spawned = false;
  const scope = { get path() { accessed = true; throw new Error("private path must remain unread"); } };
  for (const onSqlChunk of [null, false, 1, "synthetic-secret", {}]) {
    await assert.rejects(dumpCloneSql(scope, f.selected, f.bundle.database, "synthetic-password", {
      spawnClient() { spawned = true; assert.fail("an invalid sink must not spawn a dump"); }, onSqlChunk,
    }), neutral("TEXT_CLONE_DUMP"));
  }
  assert.equal(accessed, false); assert.equal(spawned, false);
  assert.deepEqual(await readdir(f.directory), [f.selected.backup]);
});

test("throwing, thenable and value-returning dump sinks stop the child, erase chunks and wait for close before credential cleanup", async (t) => {
  for (const outcome of ["throw", "thenable", "value"]) {
    const f = await fixture(t), chunk = Buffer.from(sql), events = []; let invoked = 0, thenRead = false;
    const spawnClient = (_command, args) => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = (signal) => {
        assert.equal(signal, "SIGKILL"); events.push("kill");
        setImmediate(async () => {
          try {
            assert.equal((await lstat(args[0].slice("--defaults-file=".length))).isFile(), true);
            assert.ok(chunk.every((byte) => byte === 0));
            events.push("close"); child.emit("close", null, "SIGKILL");
          } catch (error) { child.emit("error", error); child.emit("close", 1, null); }
        });
      };
      setImmediate(() => child.stdout.write(chunk)); return child;
    };
    await assert.rejects(dumpCloneSql(f.scope, f.selected, f.bundle.database, "synthetic-password", {
      spawnClient, onSqlChunk() {
        invoked++;
        if (outcome === "throw") throw new Error("synthetic-private-sink-error");
        if (outcome === "thenable") return { get then() { thenRead = true; throw new Error("do not resolve a rejected sink result"); } };
        return 123;
      },
    }), neutral("TEXT_CLONE_DUMP"));
    assert.equal(invoked, 1); assert.equal(thenRead, false); assert.deepEqual(events, ["kill", "close"]);
    assert.ok(chunk.every((byte) => byte === 0)); assert.deepEqual(await readdir(f.directory), [f.selected.backup]);
  }
});

test("failed native dump redacts stderr and removes only its own temporary client file", async (t) => {
  const f = await fixture(t);
  const spawnClient = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    setImmediate(() => { child.stderr.end(Buffer.from("synthetic secret SQL password")); child.emit("close", 2, null); }); return child;
  };
  await assert.rejects(dumpCloneSql(f.scope, f.selected, f.bundle.database, "synthetic-password", { spawnClient }), neutral("TEXT_CLONE_DUMP"));
  assert.deepEqual(await readdir(f.directory), [f.selected.backup]);
});

test("native authentication, access and missing-database failures expose only a neutral code across split stderr chunks", async (t) => {
  for (const [number, expected] of [[1045, "AUTHENTICATION"], [1044, "ACCESS"], [1142, "ACCESS"], [1049, "DATABASE"], [9999, "DUMP"]]) {
    const f = await fixture(t), chunks = [Buffer.from("mariadb-dump: Got er"),
      Buffer.from(`ror: ${number}: synthetic-password synthetic@example.invalid only_clone`)];
    const spawnClient = () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
      setImmediate(() => { for (const bytes of chunks) child.stderr.write(bytes); child.stderr.end(); child.emit("close", 2, null); });
      return child;
    };
    await assert.rejects(dumpCloneSql(f.scope, f.selected, f.bundle.database, "synthetic-password", { spawnClient }), neutral(`TEXT_CLONE_${expected}`));
    assert.ok(chunks.every((bytes) => bytes.every((byte) => byte === 0)));
    assert.deepEqual(await readdir(f.directory), [f.selected.backup]);
  }
});

test("oversized native stderr stays generic, wipes input and cleans the private configuration", async (t) => {
  const f = await fixture(t), bytes = Buffer.concat([Buffer.from("Got error: 1045: synthetic-private"), Buffer.alloc(9000, 65)]);
  let killed = false;
  const spawnClient = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { killed = true; };
    setImmediate(() => { child.stderr.end(bytes); child.emit("close", 2, null); }); return child;
  };
  await assert.rejects(dumpCloneSql(f.scope, f.selected, f.bundle.database, "synthetic-password", { spawnClient }), neutral("TEXT_CLONE_DUMP"));
  assert.equal(killed, true); assert.ok(bytes.every((byte) => byte === 0));
  assert.deepEqual(await readdir(f.directory), [f.selected.backup]);
});

test("cancellation waits for native child closure then removes the secret client file", async (t) => {
  const f = await fixture(t), cancellation = new AbortController(), events = [];
  const spawnClient = (_command, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = (signal) => {
      assert.equal(signal, "SIGKILL"); events.push("kill");
      setImmediate(async () => {
        assert.equal((await lstat(args[0].slice("--defaults-file=".length))).isFile(), true, "config remains pinned until child is closed");
        events.push("close"); child.emit("close", null, "SIGKILL");
      });
    };
    setImmediate(() => cancellation.abort()); return child;
  };
  await assert.rejects(dumpCloneSql(f.scope, f.selected, f.bundle.database, "synthetic-secret", { spawnClient, signal: cancellation.signal }), neutral("TEXT_CLONE_CANCELLED"));
  assert.deepEqual(events, ["kill", "close"]); assert.deepEqual(await readdir(f.directory), [f.selected.backup]);
});

test("exact dump mismatch prevents the crypto connection and produces no success output", async (t) => {
  const f = await fixture(t); let output = "";
  await assert.rejects(main(["verify", "--private-directory", f.directory, "--private-path-mode", "linux-dirfd", "--database", "only_clone", "--confirm-database", "only_clone", "--user", "operator_user", "--backup", f.selected.backup, "--backup-sha256", hash(f.archive)], {
    ...f.dependencies, outputStream: { write: (text) => { output += text; } }, dump: async () => ({ sqlBytes: sql.length, sqlSha256: "0".repeat(64) }),
  }), neutral("TEXT_CLONE_DUMP_MISMATCH"));
  assert.equal(output, ""); assert.deepEqual(f.connected, []);
});

test("one TLS clone connection checks immutable migration checksums and real MFA/mail/message crypto then rolls back", async (t) => {
  const f = await fixture(t), report = await run(f.selected, f.dependencies);
  assert.equal(report.status, "verified"); assert.equal(report.tables, 30); assert.equal(report.migrations, 30);
  assert.deepEqual(report.counts, { rows: 3, mfa: 1, mail: 1, reset: 0, messages: 1, crm: 0, broadcast: 0, broadcastRecipients: 0, media: 0, mediaFiles: 0 });
  assert.equal(report.httpStarted, false); assert.equal(report.smtpStarted, false);
  assert.deepEqual(f.events, ["client", "password", "dump", "connect", "rollback", "end"]);
  assert.equal(f.connected.length, 1); assert.equal(f.connected[0].JESSIEMESSAGE_DB_NAME, "only_clone"); assert.equal(f.connected[0].JESSIEMESSAGE_DB_HOST, f.bundle.database.host);
  assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, ""); assert.equal(f.connected[0].JESSIEMESSAGE_DB_TLS_CA_PATH, "/etc/ssl/certs/ca-certificates.crt");
  assert.ok(f.calls.every(({ statement }) => /^(?:SELECT|SHOW SESSION|SET TRANSACTION|START TRANSACTION)/.test(statement)));
  assert.doesNotMatch(JSON.stringify(report), /synthetic|example\.invalid|only_clone|only_source|user/);
});

test("wrong real text key and altered message binding fail closed and still roll back/end", async (t) => {
  for (const change of ["key", "binding"]) {
    const f = await fixture(t);
    if (change === "key") f.bundle.messaging.messageKey = key(9); else f.rows.messages[0].conversation_id = id(9);
    await assert.rejects(run(f.selected, f.dependencies), neutral("TEXT_CLONE_CRYPTO"));
    assert.deepEqual(f.events.slice(-2), ["rollback", "end"]); assert.equal(f.connected[0].JESSIEMESSAGE_DB_PASSWORD, "");
  }
});

test("rollback/end failure suppresses success and wipes key buffers", async (t) => {
  const f = await fixture(t); let keys;
  f.connection.rollback = async () => { f.events.push("rollback"); throw new Error("synthetic secret rollback"); };
  await assert.rejects(run(f.selected, { ...f.dependencies, verify: async (options) => {
    keys = options.keys;
    const { verifyTextBackupData } = await import("../server/backup/verify.mjs"); return verifyTextBackupData(options);
  } }), neutral("TEXT_CLONE_CLEANUP"));
  assert.deepEqual(f.events.slice(-2), ["rollback", "end"]); assert.ok(Object.values(keys).every((bytes) => bytes.every((byte) => byte === 0)));
});

test("schema inspection refuses missing tables and cross-schema foreign keys", async (t) => {
  for (const failure of ["tables", "foreign", "checksum"]) {
    const f = await fixture(t), original = f.connection.query.bind(f.connection);
    f.connection.query = async (statement, parameters) => {
      const rows = await original(statement, parameters);
      if (failure === "tables" && statement.includes("information_schema.TABLES")) return rows.slice(1);
      if (failure === "foreign" && statement.includes("KEY_COLUMN_USAGE")) return [{ parent_schema: "only_source" }];
      if (failure === "checksum" && statement.includes("FROM schema_migrations")) rows[27].checksum = "0".repeat(64);
      return rows;
    };
    await assert.rejects(inspectClone(f.connection, f.selected.database), neutral("TEXT_CLONE_SCHEMA"));
  }
});
