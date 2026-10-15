import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";
import { main, parseArguments, run } from "../scripts/diagnose-runtime-stdin.mjs";

const password = " Synthetic-only 'quoted' \\\" $() # é secret 42! ";
const options = { host: "sql.example.invalid", port: "3306", database: "jessiemessage_test",
  confirmation: "jessiemessage_test", user: "fixture_runtime", privateDirectory: "/private/runtime-fixture",
  privilegeProfile: "infomaniak-shared", privatePathMode: "linux-dirfd" };
const args = () => ["--host", options.host, "--database", options.database, "--confirm-database", options.confirmation,
  "--user", options.user, "--private-directory", options.privateDirectory,
  "--privilege-profile", options.privilegeProfile, "--private-path-mode", options.privatePathMode];
const codeIs = (code) => (error) => error.code === code;
const createdAt = "2026-10-15T18:50:00.000Z";
const passed = (privileges = "fail") => ({ valid: privileges === "pass",
  checks: DATABASE_CHECK_NAMES.map((name) => ({ name, status: name === "privileges" ? privileges : "pass" })),
  privilegeObservation: { profile: "infomaniak-shared", source: privileges === "pass" ? "show_grants" : "unverified",
    ledgerWritable: privileges === "pass" ? true : null, tempTables: privileges === "pass" ? true : null,
    tableLocks: privileges === "pass" ? true : null, permanentDdl: privileges === "pass" ? false : null } });

function fixture() {
  const observed = { events: [], envs: [] };
  const rows = [{ grants: "GRANT USAGE ON *.* TO `fixture`@`%`" },
    { grants: "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES ON `jessiemessage_test`.* TO `fixture`@`%`" }];
  const connection = { query: async (query) => {
    observed.events.push("query"); assert.equal(query, "SHOW GRANTS FOR CURRENT_USER"); return rows;
  }, release: () => { observed.events.push("release"); } };
  const pool = { getConnection: async () => { observed.events.push("connection"); return connection; },
    end: async () => { observed.events.push("end"); } };
  const dependencies = {
    inspect: async ({ env, databaseName }) => {
      observed.events.push("inspect"); observed.envs.push(env);
      assert.equal(databaseName, options.database); assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, password);
      return passed();
    },
    createPool: async (env) => { observed.events.push("pool"); observed.envs.push(env); return pool; },
    now: () => createdAt,
    writeConfiguration: async (directory, record) => {
      observed.events.push("write"); assert.equal(directory, options.privateDirectory);
      observed.record = record; observed.saved = structuredClone(record); return { saved: true };
    },
    readConfiguration: async (directory) => {
      observed.events.push("read"); assert.equal(directory, options.privateDirectory);
      observed.readBack = structuredClone(observed.saved); return observed.readBack;
    },
  };
  return { observed, connection, pool, dependencies, rows };
}

test("diagnostic metadata reuses the exact normal contract before consuming any password", async () => {
  assert.deepEqual(parseArguments(args()), options);
  let consumed = false;
  for (const selected of [[], args().slice(0, -1), [...args(), "--password", password], [...args(), "--user", "duplicate"]]) {
    await assert.rejects(main(selected, { inputStream: { async *[Symbol.asyncIterator]() { consumed = true; yield password; } } }),
      codeIs("RUNTIME_DIAGNOSTIC_USAGE"));
  }
  const f = fixture();
  await assert.rejects(run({ ...options, command: password }, password, f.dependencies), codeIs("RUNTIME_DIAGNOSTIC_USAGE"));
  assert.equal(consumed, false); assert.deepEqual(f.observed.events, []);
});

test("diagnostic capture accepts only its distinct typed record after drained read-only inspection and never approves activation", async () => {
  const f = fixture(), output = [], chunk = Buffer.from(password);
  const result = await main(args(), { ...f.dependencies, inputStream: Readable.from([chunk]), outputStream: { write: (value) => output.push(value) } });
  assert.deepEqual(f.observed.events, ["inspect", "pool", "connection", "query", "release", "end", "write", "read"]);
  assert.equal(result.status, "diagnostic_only"); assert.equal(result.diagnosticSaved, true);
  assert.equal(result.configSaved, false); assert.equal(result.launchApproved, false);
  assert.equal(result.databaseChecks.find((check) => check.name === "privileges").status, "fail");
  assert.deepEqual(Object.keys(f.observed.saved).sort(), ["createdAt", "credentials", "format", "version"]);
  assert.equal(f.observed.saved.format, "jessiemessage-runtime-diagnostic"); assert.equal(f.observed.saved.version, 1);
  assert.equal(f.observed.saved.createdAt, createdAt); assert.equal(f.observed.saved.credentials.password, password);
  assert.equal(f.observed.saved.credentials.format, "jessiemessage-runtime-database");
  assert.ok(chunk.every((byte) => byte === 0));
  assert.equal(f.observed.record.credentials.password, ""); assert.equal(f.observed.readBack.credentials.password, "");
  for (const env of f.observed.envs) assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
  for (const value of [password, options.host, options.database, options.user, options.privateDirectory, ...f.rows.map((row) => row.grants)]) {
    assert.equal(output.join("").includes(value), false);
  }
});

test("even all passing privileges produce only diagnostic storage", async () => {
  const f = fixture(); f.dependencies.inspect = async () => passed("pass");
  const result = await run(options, password, f.dependencies);
  assert.equal(result.configSaved, false); assert.equal(result.launchApproved, false); assert.equal(result.status, "diagnostic_only");
});

test("diagnostic password input rejects direct TTY, malformed UTF-8, line delimiters and oversized input", async () => {
  for (const source of ["", "a\nb", "a\rb", "a\0b", "x".repeat(4097), Buffer.from([255])]) {
    await assert.rejects(main(args(), { inputStream: Readable.from([source]) }), codeIs("RUNTIME_DIAGNOSTIC_PASSWORD"));
  }
  await assert.rejects(main(args(), { inputStream: { isTTY: true } }), codeIs("RUNTIME_DIAGNOSTIC_PASSWORD"));
  const f = fixture();
  for (const source of [undefined, "", "x\n", "\ud800", "x".repeat(4097)]) {
    await assert.rejects(run(options, source, f.dependencies), codeIs("RUNTIME_DIAGNOSTIC_PASSWORD"));
  }
  assert.deepEqual(f.observed.events, []);
});

test("diagnostic environment enforces TLS and all eight flags off without inherited bypasses", async () => {
  const inherited = { JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1", JESSIEMESSAGE_DB_TLS_CA_PATH: "/fixture/certificate",
    JESSIEMESSAGE_DB_USER: "migration_fixture", JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_ENABLE_CHAT: "1" };
  const previous = Object.fromEntries(Object.keys(inherited).map((key) => [key, process.env[key]]));
  Object.assign(process.env, inherited);
  try {
    const f = fixture(); await run(options, password, f.dependencies);
    for (const env of f.observed.envs) {
      for (const name of ["JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL", "JESSIEMESSAGE_DB_TLS_CA_PATH", "JESSIEMESSAGE_DB_USER"]) {
        assert.equal(Object.hasOwn(env, name), false);
      }
      for (const name of ["AUTH", "ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST", "MAIL_DELIVERY"]) {
        assert.equal(env[`JESSIEMESSAGE_ENABLE_${name}`], "0");
      }
      assert.equal(env.JESSIEMESSAGE_PRIVATE_PATH_MODE, "linux-dirfd");
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("wrong database, transport, cleanup and every other nonprivilege failure prevent diagnostic persistence", async () => {
  for (const name of DATABASE_CHECK_NAMES.filter((name) => name !== "privileges")) {
    const f = fixture(); f.dependencies.inspect = async () => {
      const result = passed(); result.checks.find((check) => check.name === name).status = "fail"; return result;
    };
    await assert.rejects(run(options, password, f.dependencies), codeIs("RUNTIME_DIAGNOSTIC_DATABASE"));
    assert.deepEqual(f.observed.events, []);
  }
  for (const kind of ["incomplete", "disabled", "malformed", "profile", "throws"]) {
    const f = fixture(); f.dependencies.inspect = async () => {
      if (kind === "throws") throw new Error(password);
      const result = passed();
      if (kind === "incomplete") result.checks.pop();
      if (kind === "disabled") result.checks.find((check) => check.name === "privileges").status = "disabled";
      if (kind === "malformed") result.checks[0].name = password;
      if (kind === "profile") result.privilegeObservation.profile = "strict";
      return result;
    };
    await assert.rejects(run(options, password, f.dependencies), codeIs("RUNTIME_DIAGNOSTIC_DATABASE"));
    assert.deepEqual(f.observed.events, []);
  }
});

test("diagnostic storage waits for asynchronous release and pool end", async () => {
  const f = fixture(); let finishRelease, finishEnd;
  f.connection.release = () => new Promise((resolve) => { finishRelease = resolve; });
  f.pool.end = () => { f.observed.events.push("end-start"); return new Promise((resolve) => { finishEnd = resolve; }); };
  const pending = run(options, password, f.dependencies);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.observed.events.includes("write"), false); assert.equal(finishEnd, undefined);
  finishRelease(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.observed.events.includes("write"), false); assert.equal(typeof finishEnd, "function");
  finishEnd(); await pending;
  assert.deepEqual(f.observed.events.slice(-3), ["end-start", "write", "read"]);
});

test("diagnostic query, classification, release and close failures never persist credentials or expose native errors", async () => {
  for (const kind of ["pool", "connection", "query", "describe", "release-throw", "release-reject", "end"]) {
    const f = fixture();
    if (kind === "pool") f.dependencies.createPool = async () => { throw new Error(password); };
    if (kind === "connection") f.pool.getConnection = async () => { throw new Error(password); };
    if (kind === "query") f.connection.query = async () => { throw new Error(password); };
    if (kind === "describe") f.dependencies.describe = async () => { throw new Error(password); };
    if (kind === "release-throw") f.connection.release = () => { throw new Error(password); };
    if (kind === "release-reject") f.connection.release = () => Promise.reject(new Error(password));
    if (kind === "end") f.pool.end = async () => { throw new Error(password); };
    await assert.rejects(run(options, password, f.dependencies), (error) => {
      assert.equal(error.code, "RUNTIME_DIAGNOSTIC_PRIVILEGES"); assert.equal(JSON.stringify(error).includes(password), false); return true;
    });
    assert.equal(f.observed.events.includes("write"), false);
    if (kind !== "pool") assert.equal(f.observed.events.includes("end") || kind === "end", true);
    for (const env of f.observed.envs) assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
  }
});

test("malformed, unavailable and injected diagnostic component fields cannot cross the bounded DTO", async () => {
  for (const value of [null, {}, { available: true }, { available: false }, { available: password }]) {
    const f = fixture(); f.dependencies.describe = async () => value;
    await assert.rejects(run(options, password, f.dependencies), codeIs("RUNTIME_DIAGNOSTIC_PRIVILEGES"));
    assert.equal(f.observed.events.includes("write"), false); assert.equal(f.observed.events.includes("end"), true);
  }
  const f = fixture();
  f.dependencies.describe = async () => ({ ...await import("../server/preflight/privilege-diagnostics.mjs")
    .then(({ describeRuntimePrivileges }) => describeRuntimePrivileges(f.rows, options.database)), raw: password });
  // Closed-schema validation rejects unexpected native/error/identity payloads.
  await assert.rejects(run(options, password, f.dependencies), codeIs("RUNTIME_DIAGNOSTIC_PRIVILEGES"));
  assert.equal(f.observed.events.includes("write"), false);
});

test("diagnostic readback must equal every envelope and credential field before confirmation", async () => {
  for (const kind of ["write", "write-false", "read", "createdAt", "format", "user", "password", "extra"]) {
    const f = fixture(), output = [];
    if (kind === "write") f.dependencies.writeConfiguration = async () => { throw new Error(password); };
    if (kind === "write-false") f.dependencies.writeConfiguration = async () => ({ saved: false });
    if (kind === "read") f.dependencies.readConfiguration = async () => { throw new Error(password); };
    if (!["write", "write-false", "read"].includes(kind)) f.dependencies.readConfiguration = async () => {
      const value = structuredClone(f.observed.saved);
      if (kind === "createdAt") value.createdAt = "2026-10-15T18:50:01.000Z";
      if (kind === "format") value.format = "jessiemessage-runtime-database";
      if (kind === "user") value.credentials.user = "another_fixture";
      if (kind === "password") value.credentials.password = "different-fixture";
      if (kind === "extra") value.active = true;
      f.observed.readBack = value; return value;
    };
    await assert.rejects(main(args(), { ...f.dependencies, inputStream: Readable.from([password]),
      outputStream: { write: (value) => output.push(value) } }), codeIs("RUNTIME_DIAGNOSTIC_CONFIG"));
    assert.deepEqual(output, []); assert.equal(f.observed.events.indexOf("end") >= 0, true);
    if (f.observed.record) assert.equal(f.observed.record.credentials.password, "");
    if (f.observed.readBack) assert.equal(f.observed.readBack.credentials.password, "");
  }
});

test("diagnostic CLI and noninteractive capture emit only fixed error DTOs", () => {
  const cli = spawnSync(process.execPath, ["scripts/diagnose-runtime-stdin.mjs", ...args(), "--password", password],
    { input: password, encoding: "utf8", timeout: 5000 });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /^RUNTIME_DIAGNOSTIC_USAGE:/);
  assert.deepEqual(JSON.parse(cli.stdout), { status: "blocked", diagnosticSaved: null, configSaved: false,
    launchApproved: false, error: "RUNTIME_DIAGNOSTIC_USAGE" });
  const bash = spawnSync("bash", ["scripts/capture-runtime.sh", "diagnose", ...args()], { input: password, encoding: "utf8", timeout: 5000 });
  assert.equal(bash.status, 2); assert.equal(bash.stdout, ""); assert.match(bash.stderr, /^RUNTIME_CAPTURE_TTY:/);
  for (const value of [password, options.host, options.database, options.user, options.privateDirectory]) {
    assert.equal(`${cli.stdout}${cli.stderr}${bash.stdout}${bash.stderr}`.includes(value), false);
  }
});

test("interactive diagnostic Bash validates before warning and transfers hidden input only to its constant diagnostic entry", async (t) => {
  const root = await mkdtemp(path.join(process.cwd(), ".jm-runtime-diagnostic-")); t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin"); await mkdir(bin);
  const probe = spawnSync("python3", ["-c", "import json, shutil, sys; print(json.dumps({'python': sys.executable, 'node': shutil.which('node')}))"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") { t.skip("Python PTY driver unavailable"); return; }
  assert.equal(probe.status, 0); const { python, node } = JSON.parse(probe.stdout);
  await writeFile(path.join(bin, "node"), `#!${python}\nimport json, os, sys\nif sys.argv[1] == '--input-type=module':\n os.execv(${JSON.stringify(node)}, [${JSON.stringify(node)}] + sys.argv[1:])\nsource = sys.stdin.buffer.read()\nexpected = ${JSON.stringify(password)}\nprint(json.dumps({'stdinExact': source == expected.encode('utf-8'), 'diagnosticEntry': sys.argv[1].endswith('/diagnose-runtime-stdin.mjs'), 'argumentLeak': expected in ' '.join(sys.argv), 'environmentLeak': any(expected in v for v in os.environ.values())}))\n`, { mode: 0o700 });
  const driver = `import errno, json, os, pty, select, subprocess, sys, time
try:
 master, slave = pty.openpty()
except OSError:
 print(json.dumps({'unavailable': True})); sys.exit(0)
argv = json.loads(sys.argv[1]); secret = json.loads(sys.argv[2]); limit = time.monotonic() + 10
child = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, env=os.environ.copy()); os.close(slave)
output = b''; sent = False
while time.monotonic() < limit:
 ready, _, _ = select.select([master], [], [], .05)
 if ready:
  try: chunk = os.read(master, 65536)
  except OSError as error:
   if error.errno == errno.EIO: break
   raise
  if not chunk: break
  output += chunk
  if b'saisie masquee' in output and not sent:
   os.write(master, secret.encode('utf-8') + b'\\n'); sent = True
 if child.poll() is not None and not ready: break
if child.poll() is None: child.kill()
status = child.wait(); os.close(master)
print(json.dumps({'status': status, 'sent': sent, 'output': output.decode('utf-8', 'replace')}))`;
  for (const selected of [["diagnose", ...args()], ["diagnose", ...args(), "--password", "forbidden"], ["/untrusted/command", ...args()]]) {
    const result = spawnSync(python, ["-c", driver, JSON.stringify(["bash", "scripts/capture-runtime.sh", ...selected]), JSON.stringify(password)],
      { encoding: "utf8", timeout: 15000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr); const captured = JSON.parse(result.stdout);
    if (captured.unavailable) { t.skip("PTY devices unavailable"); return; }
    assert.equal(captured.output.includes(password), false);
    if (selected.length === args().length + 1 && selected[0] === "diagnose") {
      assert.equal(captured.status, 0, captured.output); assert.equal(captured.sent, true);
      assert.match(captured.output, /copie privee du mot de passe SQL sera conservee pour investigation, sans activation/);
      assert.match(captured.output, /"stdinExact": true, "diagnosticEntry": true, "argumentLeak": false, "environmentLeak": false/);
    } else {
      assert.equal(captured.status, 2); assert.equal(captured.sent, false);
      assert.match(captured.output, /RUNTIME_INPUT_USAGE:/); assert.equal(captured.output.includes("saisie masquee"), false);
    }
  }
});
