import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { dumpCloneSql } from "../scripts/verify-text-clone.mjs";

const base = fileURLToPath(new URL("../../audit/", import.meta.url));
const tables = [...createdMigrationTables(await loadMigrations()), "schema_migrations"].sort();
const sql = Buffer.from("CREATE TABLE synthetic (id INT);\n");
const report = { sqlBytes: sql.length, sqlSha256: createHash("sha256").update(sql).digest("hex") };
const selected = { database: "only_selected", user: "synthetic_operator" };
const configuration = { host: "sql.example.invalid", port: "3306" };
const neutral = (code) => (error) => {
  assert.equal(error.code, code); assert.equal(error.message, code);
  assert.doesNotMatch(JSON.stringify(error), /synthetic|example\.invalid|only_selected/);
  assert.equal(error.cause, undefined); return true;
};

async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "application-dump-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = { path: directory, file: (name) => join(directory, name), assertReady: () => lstat(directory, { bigint: true }), sync: async () => {} };
  return { directory, scope };
}

function successfulSpawn(observed, inspect = async () => {}) {
  return (command, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => assert.fail("a successful table dump must not be killed");
    observed.push({ command, args, options });
    setImmediate(async () => {
      try {
        await inspect(args);
        child.stdout.end(Buffer.from(sql)); child.stderr.end(); child.emit("close", 0, null);
      } catch (error) { child.emit("error", error); child.emit("close", 1, null); }
    });
    return child;
  };
}

test("an explicit application dump passes exactly the sorted migration tables after the database with unchanged TLS and read-only native flags", async (t) => {
  const f = await fixture(t), observed = [], password = "synthetic private password";
  assert.equal(tables.length, 33); assert.equal(new Set(tables).size, 33);
  const spawnClient = successfulSpawn(observed, async (args) => {
    const filename = args[0].slice("--defaults-file=".length), stats = await lstat(filename);
    assert.equal(stats.mode & 0o7777, 0o600); assert.equal(stats.nlink, 1);
    assert.match(await readFile(filename, "utf8"), /password="synthetic private password"/);
  });
  assert.deepEqual(await dumpCloneSql(f.scope, selected, configuration, password, { spawnClient, tables }), report);
  assert.equal(observed[0].command, "/usr/bin/mariadb-dump");
  assert.deepEqual(observed[0].args.slice(1), ["--single-transaction", "--quick", "--skip-lock-tables", "--skip-add-locks", "--skip-add-drop-table",
    "--skip-comments", "--skip-triggers", "--hex-blob", "--no-tablespaces", "--protocol=TCP", "--ssl-ca=/etc/ssl/certs/ca-certificates.crt",
    "--ssl-verify-server-cert", selected.database, ...tables]);
  assert.deepEqual(observed[0].options, { env: { PATH: "/usr/bin:/bin", HOME: "/", LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
  assert.doesNotMatch(JSON.stringify(observed), /synthetic|example\.invalid|--(?:all-databases|databases|routines|events)(?:[",=]|$)/);
  assert.deepEqual(await readdir(f.directory), []);
});

test("omitted and explicitly undefined table options preserve the full-database dump argv", async (t) => {
  const f = await fixture(t);
  for (const extra of [{}, { tables: undefined }]) {
    const observed = [];
    assert.deepEqual(await dumpCloneSql(f.scope, selected, configuration, "synthetic-password", {
      spawnClient: successfulSpawn(observed), ...extra,
    }), report);
    assert.equal(observed[0].args.at(-1), selected.database);
    assert.equal(observed[0].args.length, 14);
  }
  assert.deepEqual(await readdir(f.directory), []);
});

test("application table selection rejects missing, additional, duplicated, unsorted and arbitrary native arguments before private-file access", async () => {
  let accessed = false;
  const scope = { get path() { accessed = true; throw new Error("private path must remain unread"); } };
  const duplicate = [...tables]; duplicate[1] = duplicate[0];
  const injected = [...tables]; injected[0] = "--all-databases";
  const altered = [...tables]; altered[0] = "synthetic_other_table";
  for (const value of [null, false, "synthetic", {}, [], tables.slice(1), [...tables, "synthetic_other_table"], duplicate, [...tables].reverse(), injected, altered]) {
    await assert.rejects(dumpCloneSql(scope, selected, configuration, "synthetic-password", {
      tables: value, spawnClient() { assert.fail("an invalid table list must not spawn"); },
    }), neutral("TEXT_CLONE_DUMP"));
  }
  assert.equal(accessed, false);
});

test("application table selection rejects holes and non-string values without coercion", async () => {
  let accessed = false, coerced = false;
  const scope = { get path() { accessed = true; throw new Error("private path must remain unread"); } };
  const sparse = [...tables]; delete sparse[4];
  const number = [...tables]; number[4] = 4;
  const wrapped = [...tables]; wrapped[4] = { toString() { coerced = true; return tables[4]; } };
  for (const value of [sparse, number, wrapped]) {
    await assert.rejects(dumpCloneSql(scope, selected, configuration, "synthetic-password", { tables: value }), neutral("TEXT_CLONE_DUMP"));
  }
  assert.equal(accessed, false); assert.equal(coerced, false);
});

test("application table selection rejects element accessors, symbols, extra properties, custom prototypes and proxies without invoking getters", async () => {
  let accessed = false, getterRead = false;
  const scope = { get path() { accessed = true; throw new Error("private path must remain unread"); } };
  const accessor = [...tables]; Object.defineProperty(accessor, "4", { get() { getterRead = true; return tables[4]; } });
  const symbol = [...tables]; symbol[Symbol("synthetic")] = true;
  const extra = [...tables]; extra.synthetic = true;
  const custom = [...tables]; Object.setPrototypeOf(custom, Object.create(Array.prototype));
  const proxied = new Proxy([...tables], { get() { getterRead = true; throw new Error("do not read proxy values"); } });
  for (const value of [accessor, symbol, extra, custom, proxied]) {
    await assert.rejects(dumpCloneSql(scope, selected, configuration, "synthetic-password", { tables: value }), neutral("TEXT_CLONE_DUMP"));
  }
  assert.equal(accessed, false); assert.equal(getterRead, false);
});

test("the tables option itself must be an own data property and never invokes its accessor", async () => {
  let accessed = false, getterRead = false;
  const scope = { get path() { accessed = true; throw new Error("private path must remain unread"); } };
  for (const options of [{ get tables() { getterRead = true; return tables; } }, Object.create({ tables }), Object.create({ get tables() { getterRead = true; return tables; } })]) {
    await assert.rejects(dumpCloneSql(scope, selected, configuration, "synthetic-password", options), neutral("TEXT_CLONE_DUMP"));
  }
  assert.equal(accessed, false); assert.equal(getterRead, false);
});

test("a frozen exact table list is accepted and a caller mutation after validation cannot change native arguments", async (t) => {
  const f = await fixture(t), supplied = [...tables], observed = [];
  const scope = { ...f.scope, get path() { supplied.fill("--all-databases"); return f.directory; } };
  assert.deepEqual(await dumpCloneSql(scope, selected, configuration, "synthetic-password", {
    tables: supplied, spawnClient: successfulSpawn(observed),
  }), report);
  assert.deepEqual(observed[0].args.slice(-33), tables);
  assert.deepEqual(await dumpCloneSql(f.scope, selected, configuration, "synthetic-password", {
    tables: Object.freeze([...tables]), spawnClient: successfulSpawn([]),
  }), report);
  assert.deepEqual(await readdir(f.directory), []);
});

test("an application dump still erases synchronous sink chunks and removes its private credential after native close", async (t) => {
  const f = await fixture(t), events = [], chunk = Buffer.from(sql); let config;
  const spawnClient = (_command, args) => {
    config = args[0].slice("--defaults-file=".length);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => {
      events.push("kill");
      setImmediate(async () => {
        assert.equal((await lstat(config)).isFile(), true);
        assert.ok(chunk.every((byte) => byte === 0)); events.push("close"); child.emit("close", null, "SIGKILL");
      });
    };
    setImmediate(() => child.stdout.write(chunk)); return child;
  };
  await assert.rejects(dumpCloneSql(f.scope, selected, configuration, "synthetic-password", {
    tables, spawnClient, onSqlChunk() { throw new Error("synthetic-private-sink"); },
  }), neutral("TEXT_CLONE_DUMP"));
  assert.deepEqual(events, ["kill", "close"]); assert.deepEqual(await readdir(f.directory), []);
});

test("an application dump cancellation remains neutral and stops before private paths or table accessors", async () => {
  const abort = new AbortController(); abort.abort(); let accessed = false, getterRead = false;
  await assert.rejects(dumpCloneSql({ get path() { accessed = true; } }, selected, configuration, "synthetic-password", {
    signal: abort.signal, get tables() { getterRead = true; return tables; },
  }), neutral("TEXT_CLONE_CANCELLED"));
  assert.equal(accessed, false); assert.equal(getterRead, false);
});
