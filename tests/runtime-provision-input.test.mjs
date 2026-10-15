import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";
import { main, parseArguments, run } from "../scripts/provision-runtime-stdin.mjs";

const password = " Synthetic-only 'quoted' \\\" $() # é secret 42! ";
const options = { host: "sql.example.invalid", port: "3306", database: "jessiemessage_test",
  confirmation: "jessiemessage_test", user: "fixture_runtime", privateDirectory: "/private/runtime-fixture",
  privilegeProfile: "infomaniak-shared", privatePathMode: "linux-dirfd" };
const args = () => ["--host", options.host, "--database", options.database, "--confirm-database", options.confirmation,
  "--user", options.user, "--private-directory", options.privateDirectory,
  "--privilege-profile", options.privilegeProfile, "--private-path-mode", options.privatePathMode];
const codeIs = (code) => (error) => error.code === code;
const passed = () => ({ valid: true, checks: DATABASE_CHECK_NAMES.map((name) => ({ name, status: "pass" })),
  privilegeObservation: { profile: "infomaniak-shared", source: "show_grants", ledgerWritable: true,
    tempTables: true, tableLocks: true, permanentDdl: false } });

function fixture() {
  const observed = { events: [], envs: [], config: null, readBack: null };
  const connection = { query: async () => [], release: () => { observed.events.push("release"); } };
  const pool = { getConnection: async () => connection, end: async () => { observed.events.push("end"); } };
  const dependencies = {
    inspect: async ({ env, databaseName }) => {
      observed.events.push("inspect"); observed.envs.push(env);
      assert.equal(databaseName, options.database); assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, password);
      return passed();
    },
    createPool: async (env) => { observed.events.push("pool"); observed.envs.push(env); return pool; },
    createStore: (selectedPool) => ({ assertSchema: async () => {
      observed.events.push("schema"); const selectedConnection = await selectedPool.getConnection();
      await selectedConnection.query("read-only-fixture");
      try { selectedConnection.release(); } catch {}
      return true;
    } }),
    writeConfiguration: async (directory, config) => {
      observed.events.push("write"); assert.equal(directory, options.privateDirectory);
      observed.config = config; observed.saved = { ...config }; return { saved: true };
    },
    readConfiguration: async (directory) => {
      observed.events.push("read"); assert.equal(directory, options.privateDirectory);
      observed.readBack = { ...observed.saved }; return observed.readBack;
    },
  };
  return { observed, connection, pool, dependencies };
}

test("runtime metadata requires explicit exact database, privilege profile and Linux dirfd mode before reading input", async () => {
  assert.deepEqual(parseArguments(args()), options);
  const malformed = [[], args().slice(0, -1), [...args(), "--password", password], [...args(), "--user", "duplicate"],
    [...args(), "--allow-insecure", "1"], [...args(), "--port", "03306"], [...args(), "--port", "65536"]];
  for (const [flag, value] of [["--confirm-database", "other"], ["--private-path-mode", "strict"],
    ["--privilege-profile", "unknown"], ["--private-directory", "/"], ["--private-directory", "/one/../two"],
    ["--private-directory", "/private\nfixture"], ["--private-directory", "/private\\fixture"],
    ["--host", "host\ninvalid"], ["--user", "user@host"]]) {
    const selected = args(); selected[selected.indexOf(flag) + 1] = value; malformed.push(selected);
  }
  let consumed = false;
  for (const selected of malformed) {
    assert.throws(() => parseArguments(selected), codeIs("RUNTIME_INPUT_USAGE"));
    await assert.rejects(main(selected, { inputStream: { async *[Symbol.asyncIterator]() { consumed = true; yield password; } } }),
      codeIs("RUNTIME_INPUT_USAGE"));
  }
  assert.equal(consumed, false);
});

test("runtime stdin preserves exact password bytes and clears consumed input and local configuration references", async () => {
  const f = fixture(), output = [], chunk = Buffer.from(password);
  const result = await main(args(), { ...f.dependencies, inputStream: Readable.from([chunk]), outputStream: { write: (value) => output.push(value) } });
  assert.deepEqual(f.observed.events, ["inspect", "pool", "schema", "release", "end", "write", "read"]);
  assert.equal(result.status, "prepared"); assert.equal(result.configSaved, true); assert.equal(result.authSchemaVerified, true);
  assert.equal(result.databaseChecks.length, DATABASE_CHECK_NAMES.length);
  assert.ok(chunk.every((byte) => byte === 0));
  assert.equal(f.observed.config.password, ""); assert.equal(f.observed.readBack.password, "");
  for (const env of f.observed.envs) assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
  for (const value of [password, options.host, options.database, options.user, options.privateDirectory]) {
    assert.equal(output.join("").includes(value), false);
  }
});

test("runtime stdin rejects direct TTY, invalid UTF-8, empty/oversized passwords and line terminators with fixed errors", async () => {
  for (const source of ["", "a\nb", "a\rb", "a\0b", "x".repeat(4097), Buffer.from([255])]) {
    await assert.rejects(main(args(), { inputStream: Readable.from([source]) }), codeIs("RUNTIME_INPUT_PASSWORD"));
  }
  await assert.rejects(main(args(), { inputStream: { isTTY: true } }), codeIs("RUNTIME_INPUT_PASSWORD"));
  const f = fixture();
  for (const source of [undefined, "", "x\n", "\ud800", "x".repeat(4097)]) {
    await assert.rejects(run(options, source, f.dependencies), codeIs("RUNTIME_INPUT_PASSWORD"));
  }
  assert.deepEqual(f.observed.events, []);
});

test("runtime connection receives explicit TLS and all private features disabled without inheriting process credentials", async () => {
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

test("the explicit strict privilege profile is supported without weakening its observation", async () => {
  const f = fixture();
  f.dependencies.inspect = async () => ({ ...passed(), privilegeObservation: { profile: "strict", source: "show_grants",
    ledgerWritable: false, tempTables: false, tableLocks: false, permanentDdl: false } });
  const result = await run({ ...options, privilegeProfile: "strict" }, password, f.dependencies);
  assert.equal(result.privilegeObservation.profile, "strict"); assert.equal(result.privilegeObservation.ledgerWritable, false);
  assert.equal(f.observed.saved.privilegeProfile, "strict");
});

test("oversized serialized configuration and unknown programmatic options fail before connecting", async () => {
  const f = fixture();
  await assert.rejects(run(options, "\u0001".repeat(4096), f.dependencies), codeIs("RUNTIME_INPUT_CONFIG"));
  await assert.rejects(run({ ...options, password }, password, f.dependencies), codeIs("RUNTIME_INPUT_USAGE"));
  assert.deepEqual(f.observed.events, []);
});

test("runtime provisioning refuses any failed, incomplete, malformed or mismatched preflight before schema or file access", async () => {
  for (const kind of ["failed", "incomplete", "disabled", "malformed", "profile", "throws"]) {
    const f = fixture();
    f.dependencies.inspect = async ({ env }) => {
      f.observed.envs.push(env);
      if (kind === "throws") throw new Error(password);
      const result = passed();
      if (kind === "failed") { result.valid = false; result.checks[1].status = "fail"; }
      if (kind === "incomplete") result.checks.pop();
      if (kind === "disabled") result.checks[0].status = "disabled";
      if (kind === "malformed") result.checks[0].name = password;
      if (kind === "profile") result.privilegeObservation = { profile: "strict", source: "show_grants",
        ledgerWritable: false, tempTables: false, tableLocks: false, permanentDdl: false };
      return result;
    };
    await assert.rejects(run(options, password, f.dependencies), (error) => {
      assert.equal(error.code, "RUNTIME_INPUT_DATABASE"); assert.equal(JSON.stringify(error).includes(password), false); return true;
    });
    assert.deepEqual(f.observed.events, []);
    assert.equal(f.observed.envs[0].JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
  }
});

test("runtime provisioning drains schema release and pool close before publishing credentials", async () => {
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

test("schema rejection, suppressed release errors and close failures all prevent credential persistence", async () => {
  for (const kind of ["connect", "schema", "schema-false", "release-throw", "release-reject", "end"]) {
    const f = fixture();
    if (kind === "connect") f.dependencies.createPool = async () => { throw new Error(password); };
    if (kind === "schema") f.dependencies.createStore = () => ({ assertSchema: async () => { throw new Error(password); } });
    if (kind === "schema-false") f.dependencies.createStore = () => ({ assertSchema: async () => false });
    if (kind === "release-throw") f.connection.release = () => { throw new Error(password); };
    if (kind === "release-reject") f.connection.release = () => Promise.reject(new Error(password));
    if (kind === "end") f.pool.end = async () => { throw new Error(password); };
    await assert.rejects(run(options, password, f.dependencies), (error) => {
      assert.equal(error.code, "RUNTIME_INPUT_SCHEMA"); assert.equal(error.message.includes(password), false); return true;
    });
    assert.equal(f.observed.events.includes("write"), false);
    if (kind !== "connect") assert.equal(f.observed.events.includes("end") || kind === "end", true);
    assert.equal(f.observed.envs[0].JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
  }
});

test("readback must validate and equal the exact configuration before a success can be emitted", async () => {
  for (const kind of ["write", "write-false", "read", "mismatch", "malformed"]) {
    const f = fixture(), output = [];
    if (kind === "write") f.dependencies.writeConfiguration = async () => { throw new Error(password); };
    if (kind === "write-false") f.dependencies.writeConfiguration = async () => ({ saved: false });
    if (kind === "read") f.dependencies.readConfiguration = async () => { throw new Error(password); };
    if (kind === "mismatch") f.dependencies.readConfiguration = async () => ({ ...f.observed.saved, user: "another_fixture" });
    if (kind === "malformed") f.dependencies.readConfiguration = async () => ({ ...f.observed.saved, password: "" });
    await assert.rejects(main(args(), { ...f.dependencies, inputStream: Readable.from([password]),
      outputStream: { write: (value) => output.push(value) } }), codeIs("RUNTIME_INPUT_CONFIG"));
    assert.deepEqual(output, []);
    assert.equal(f.observed.events.indexOf("end") >= 0, true);
    if (f.observed.config) assert.equal(f.observed.config.password, "");
  }
});

test("runtime CLI and noninteractive Bash failures expose no password or hosting metadata", () => {
  const cli = spawnSync(process.execPath, ["scripts/provision-runtime-stdin.mjs", ...args(), "--password", password],
    { input: password, encoding: "utf8", timeout: 5000 });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /^RUNTIME_INPUT_USAGE:/);
  assert.deepEqual(JSON.parse(cli.stdout), { status: "blocked", configSaved: null, error: "RUNTIME_INPUT_USAGE" });
  const bash = spawnSync("bash", ["scripts/capture-runtime.sh", ...args()], { input: password, encoding: "utf8", timeout: 5000 });
  assert.equal(bash.status, 2); assert.equal(bash.stdout, ""); assert.match(bash.stderr, /^RUNTIME_CAPTURE_TTY:/);
  for (const value of [password, options.host, options.database, options.user, options.privateDirectory]) {
    assert.equal(`${cli.stdout}${cli.stderr}${bash.stdout}${bash.stderr}`.includes(value), false);
  }
});

test("interactive Bash validates metadata before prompting and pipes an exact hidden password without argument or environment exposure", async (t) => {
  const root = await mkdtemp(path.join(process.cwd(), ".jm-runtime-capture-")); t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin"); await mkdir(bin);
  const probe = spawnSync("python3", ["-c", "import json, shutil, sys; print(json.dumps({'python': sys.executable, 'node': shutil.which('node')}))"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") { t.skip("Python PTY driver unavailable"); return; }
  assert.equal(probe.status, 0);
  const { python, node } = JSON.parse(probe.stdout);
  assert.equal(typeof node, "string");
  await writeFile(path.join(bin, "node"), `#!${python}\nimport json, os, sys\nif sys.argv[1] == '--input-type=module':\n os.execv(${JSON.stringify(node)}, [${JSON.stringify(node)}] + sys.argv[1:])\nsource = sys.stdin.buffer.read()\nexpected = ${JSON.stringify(password)}\nprint(json.dumps({'stdinExact': source == expected.encode('utf-8'), 'argumentLeak': expected in ' '.join(sys.argv), 'environmentLeak': any(expected in v for v in os.environ.values())}))\n`, { mode: 0o700 });
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
  for (const selected of [args(), [...args(), "--password", "forbidden"]]) {
    const result = spawnSync(python, ["-c", driver, JSON.stringify(["bash", "scripts/capture-runtime.sh", ...selected]), JSON.stringify(password)],
      { encoding: "utf8", timeout: 15000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr); const captured = JSON.parse(result.stdout);
    if (captured.unavailable) { t.skip("PTY devices unavailable"); return; }
    assert.equal(captured.output.includes(password), false);
    if (selected.length === args().length) {
      assert.equal(captured.status, 0, captured.output); assert.equal(captured.sent, true);
      assert.match(captured.output, /"stdinExact": true, "argumentLeak": false, "environmentLeak": false/);
    } else {
      assert.equal(captured.status, 2); assert.equal(captured.sent, false);
      assert.match(captured.output, /RUNTIME_INPUT_USAGE:/); assert.equal(captured.output.includes("Mot de passe"), false);
    }
  }
});
