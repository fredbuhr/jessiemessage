import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { parseArguments, readPassword } from "../scripts/migration-input.mjs";
import { main, run } from "../scripts/migrate-stdin.mjs";

const password = " Synthetic-only 'quoted' \\\" $() # é secret 42! ";
const options = { command: "initialize", host: "sql.example.invalid", database: "jessiemessage_test",
  confirmation: "jessiemessage_test", user: "fixture_migrator", port: "3306" };
const args = (command = "initialize") => [command, "--host", options.host, "--database", options.database,
  "--confirm-database", options.confirmation, "--user", options.user];
const plan = [1, 2].map((version) => ({ version, name: `000${version}_fixture.sql`, checksum: String(version).repeat(64) }));
const rows = (state) => plan.map((migration) => ({ ...migration, state }));
const codeIs = (code) => (error) => error.code === code;

function fixture({ before = rows("pending"), after = rows("applied"), cipher = "TLS_AES_256_GCM_SHA384", migrations = plan } = {}) {
  const observed = { status: 0, apply: 0, ended: false, env: null };
  const connection = { query: async (sql) => {
    assert.equal(sql, "SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    return [{ Variable_name: "Ssl_cipher", Value: cipher }];
  }, end: async () => { observed.ended = true; } };
  const dependencies = {
    connect: async (env) => { observed.env = env; return connection; }, loadPlan: async () => migrations,
    status: async (_connection, context) => {
      assert.equal(_connection, connection);
      assert.equal(context.database, options.database);
      return observed.status++ === 0 ? before : after;
    },
    apply: async (_connection, context) => {
      assert.equal(_connection, connection); assert.equal(context.database, options.database);
      observed.apply += 1;
      const applied = before.filter((row) => row.state === "pending").map((row) => row.version);
      return { applied, unchanged: migrations.length - applied.length };
    },
  };
  return { dependencies, observed, connection };
}

test("stdin migration requires exact target confirmation and refuses secrets or transport overrides in arguments", () => {
  assert.deepEqual(parseArguments(args()), options);
  const mismatch = args(); mismatch[mismatch.indexOf("--confirm-database") + 1] = "other";
  for (const value of [[], mismatch, ["up", ...args().slice(1)],
    [...args(), "--password", password], [...args(), "--allow-insecure", "1"],
    [...args(), "--user", "duplicate"], args().slice(0, -1)]) {
    assert.throws(() => parseArguments(value), codeIs("MIGRATION_INPUT_USAGE"));
  }
});

test("raw password input preserves spaces, shell characters, Unicode and an initial BOM", async () => {
  assert.equal(await readPassword(Readable.from([password])), password);
  assert.equal(await readPassword(Readable.from([`\ufeff${password}`])), `\ufeff${password}`);
});

test("raw password input refuses direct TTY, invalid UTF-8, oversized input and line terminators", async () => {
  await assert.rejects(readPassword({ isTTY: true }), codeIs("MIGRATION_INPUT_PASSWORD"));
  for (const source of ["", "a\nb", "a\rb", "a\0b", "a".repeat(4097), Buffer.from([255])]) {
    await assert.rejects(readPassword(Readable.from([source])), codeIs("MIGRATION_INPUT_PASSWORD"));
  }
  const chunk = Buffer.from(password);
  assert.equal(await readPassword(Readable.from([chunk])), password);
  assert.ok(chunk.every((byte) => byte === 0));
});

test("invalid metadata is rejected before consuming stdin or connecting", async () => {
  let read = false;
  await assert.rejects(main(["--password", password], { inputStream: {
    async *[Symbol.asyncIterator]() { read = true; yield password; },
  } }), codeIs("MIGRATION_INPUT_USAGE"));
  assert.equal(read, false);
});

test("status is read-only, returns only fixed report fields and closes its connection", async () => {
  const { dependencies, observed } = fixture();
  const result = await run({ ...options, command: "status" }, password, dependencies);
  assert.deepEqual(result, { status: "checked", engineVerified: true, transportVerified: true,
    migrations: 2, applied: 0, pending: 2, interrupted: false });
  assert.equal(observed.apply, 0);
  assert.equal(observed.status, 1);
  assert.equal(observed.ended, true);
  for (const secret of [password, options.host, options.database, options.user]) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("initialize checks an empty history, delegates existing migration machinery and verifies the final history", async () => {
  const { dependencies, observed } = fixture();
  assert.deepEqual(await run(options, password, dependencies), { status: "prepared", engineVerified: true,
    transportVerified: true, migrations: 2, applied: 2, unchanged: 0 });
  assert.equal(observed.status, 2);
  assert.equal(observed.apply, 1);
  assert.equal(observed.ended, true);
  assert.equal(observed.env.JESSIEMESSAGE_DB_PASSWORD, "");
  assert.equal(Object.keys(observed.env).length, 6);
  assert.equal(Object.hasOwn(observed.env, "JESSIEMESSAGE_ENABLE_AUTH"), false);
});

test("initialize is idempotent for an entirely applied history without executing DDL again", async () => {
  const { dependencies, observed } = fixture({ before: rows("applied") });
  const result = await run(options, password, dependencies);
  assert.equal(result.applied, 0);
  assert.equal(result.unchanged, 2);
  assert.equal(observed.apply, 0);
  assert.equal(observed.status, 2);
});

test("partial or interrupted histories refuse initialize before application", async () => {
  for (const before of [[rows("applied")[0], rows("pending")[1]], rows("running"), rows("failed"), rows("retry")]) {
    const { dependencies, observed } = fixture({ before });
    await assert.rejects(run(options, password, dependencies), codeIs("MIGRATION_INPUT_NOT_FRESH"));
    assert.equal(observed.apply, 0);
    assert.equal(observed.ended, true);
  }
});

test("upgrade delegates only the pending suffix of an immutable 27-migration history", async () => {
  const migrations = Array.from({ length: 28 }, (_, index) => ({ version: index + 1,
    name: `${String(index + 1).padStart(4, "0")}_fixture.sql`, checksum: String(index + 1).padStart(64, "0") }));
  const before = migrations.map((row) => ({ ...row, state: row.version <= 27 ? "applied" : "pending" }));
  const { dependencies, observed } = fixture({ migrations, before,
    after: migrations.map((row) => ({ ...row, state: "applied" })) });
  assert.deepEqual(parseArguments(args("upgrade")), { ...options, command: "upgrade" });
  assert.deepEqual(await run({ ...options, command: "upgrade" }, password, dependencies), {
    status: "upgraded", engineVerified: true, transportVerified: true, migrations: 28, applied: 1, unchanged: 27,
  });
  assert.equal(observed.apply, 1);
  assert.equal(observed.status, 2);
  assert.equal(observed.ended, true);
  assert.equal(observed.env.JESSIEMESSAGE_DB_PASSWORD, "");
  assert.deepEqual(before.map((row) => row.state), [...Array(27).fill("applied"), "pending"]);
});

test("upgrade is idempotent when every migration is already applied", async () => {
  const { dependencies, observed } = fixture({ before: rows("applied") });
  const result = await run({ ...options, command: "upgrade" }, password, dependencies);
  assert.deepEqual(result, { status: "upgraded", engineVerified: true, transportVerified: true,
    migrations: 2, applied: 0, unchanged: 2 });
  assert.equal(observed.apply, 0);
  assert.equal(observed.status, 2);
});

test("upgrade refuses empty, interrupted and non-prefix histories without applying DDL", async () => {
  for (const before of [rows("pending"), [rows("pending")[0], rows("applied")[1]],
    ...["running", "failed", "retry"].flatMap((state) => [rows(state),
      [rows("applied")[0], rows(state)[1]], [rows(state)[0], rows("pending")[1]]])]) {
    const { dependencies, observed } = fixture({ before });
    await assert.rejects(run({ ...options, command: "upgrade" }, password, dependencies),
      codeIs("MIGRATION_INPUT_NOT_UPGRADABLE"));
    assert.equal(observed.apply, 0);
    assert.equal(observed.ended, true);
  }
});

test("upgrade refuses drift, failed post-checks and migration errors without retrying", async () => {
  for (const change of [{ checksum: "wrong" }, { version: 9 }, { name: "other.sql" }, { state: "unknown" }]) {
    const before = [rows("applied")[0], { ...rows("pending")[1], ...change }];
    const { dependencies, observed } = fixture({ before });
    await assert.rejects(run({ ...options, command: "upgrade" }, password, dependencies), codeIs("MIGRATION_INPUT_HISTORY"));
    assert.equal(observed.apply, 0);
  }
  const before = [rows("applied")[0], rows("pending")[1]];
  const failedCheck = fixture({ before, after: before });
  await assert.rejects(run({ ...options, command: "upgrade" }, password, failedCheck.dependencies), codeIs("MIGRATION_INPUT_HISTORY"));
  assert.equal(failedCheck.observed.apply, 1);
  const failedApply = fixture({ before });
  failedApply.dependencies.apply = async () => { failedApply.observed.apply += 1; throw new Error("synthetic interruption"); };
  await assert.rejects(run({ ...options, command: "upgrade" }, password, failedApply.dependencies), /synthetic interruption/);
  assert.equal(failedApply.observed.apply, 1);
  assert.equal(failedApply.observed.status, 1);
  assert.equal(failedApply.observed.ended, true);
  assert.equal(failedApply.observed.env.JESSIEMESSAGE_DB_PASSWORD, "");
});

test("an absent TLS cipher refuses history inspection and migrations", async () => {
  const { dependencies, observed } = fixture({ cipher: "" });
  await assert.rejects(run(options, password, dependencies), codeIs("MIGRATION_INPUT_TRANSPORT"));
  assert.equal(observed.status, 0);
  assert.equal(observed.apply, 0);
  assert.equal(observed.ended, true);
});

test("divergent history fields and unknown states refuse application", async () => {
  for (const change of [{ checksum: "wrong" }, { version: 9 }, { name: "other.sql" }, { state: "unknown" }]) {
    const before = rows("pending"); before[0] = { ...before[0], ...change };
    const { dependencies, observed } = fixture({ before });
    await assert.rejects(run(options, password, dependencies), codeIs("MIGRATION_INPUT_HISTORY"));
    assert.equal(observed.apply, 0);
    assert.equal(observed.ended, true);
  }
});

test("the post-migration history must be complete before reporting prepared", async () => {
  const { dependencies, observed } = fixture({ after: rows("pending") });
  await assert.rejects(run(options, password, dependencies), codeIs("MIGRATION_INPUT_HISTORY"));
  assert.equal(observed.apply, 1);
  assert.equal(observed.ended, true);
});

test("migration failure closes the connection, clears the environment reference and performs no retry", async () => {
  const { dependencies, observed } = fixture();
  dependencies.apply = async () => { observed.apply += 1; throw new Error("synthetic SQL failure"); };
  await assert.rejects(run(options, password, dependencies), /synthetic SQL failure/);
  assert.equal(observed.apply, 1);
  assert.equal(observed.ended, true);
  assert.equal(observed.env.JESSIEMESSAGE_DB_PASSWORD, "");
});

test("connection closure failure prevents a successful result", async () => {
  const { dependencies, connection, observed } = fixture();
  connection.end = async () => { throw new Error("synthetic close failure"); };
  await assert.rejects(run(options, password, dependencies), /synthetic close failure/);
  assert.equal(observed.env.JESSIEMESSAGE_DB_PASSWORD, "");
});

test("a connection failure still clears the supplied password environment", async () => {
  const { dependencies, observed } = fixture();
  dependencies.connect = async (env) => { observed.env = env; throw new Error("synthetic connect failure"); };
  await assert.rejects(run(options, password, dependencies), /synthetic connect failure/);
  assert.equal(observed.env.JESSIEMESSAGE_DB_PASSWORD, "");
  assert.equal(observed.apply, 0);
});

test("an empty migration plan is refused before connection", async () => {
  const { dependencies, observed } = fixture();
  dependencies.loadPlan = async () => [];
  dependencies.connect = async () => assert.fail("Must not connect");
  await assert.rejects(run(options, password, dependencies), codeIs("MIGRATION_INPUT_HISTORY"));
  assert.equal(observed.apply, 0);
});

test("the Bash capture helper refuses noninteractive input without echoing it", () => {
  const result = spawnSync("bash", ["scripts/capture-migration.sh", ...args()], { input: password, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^MIGRATION_CAPTURE_TTY:/);
  assert.equal(result.stderr.includes(password), false);
});

test("CLI refuses password arguments and emits no secret or hosting metadata", () => {
  const result = spawnSync(process.execPath, ["scripts/migrate-stdin.mjs", ...args(), "--password", password],
    { input: password, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^MIGRATION_INPUT_USAGE:/);
  assert.equal(result.stdout, "");
  for (const value of [password, options.host, options.database, options.user]) assert.equal(result.stderr.includes(value), false);
});
