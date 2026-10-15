import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";
import { AdminBootstrapError, main as existingBootstrapMain } from "../scripts/admin-bootstrap.mjs";
import { AdminSetupInputError, failureResult, main, parseArguments, run } from "../scripts/admin-bootstrap-stdin.mjs";

const password = " Synthetic admin 'quotes' \\\" $() ` # é 😀 42! ";
const options = { command: "initialize", privateDirectory: "/private/administrator-fixture", privatePathMode: "linux-dirfd" };
const args = () => ["--private-directory", options.privateDirectory, "--private-path-mode", "linux-dirfd"];
const codeIs = (code) => (error) => error instanceof AdminSetupInputError && error.code === code && error.message === code;
const flags = ["AUTH", "ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST", "MAIL_DELIVERY"];
const environment = () => ({ PORT: "3000", JESSIEMESSAGE_SITE_ORIGIN: "https://preprod.jessiemessage.com",
  JESSIEMESSAGE_MFA_KEY: Buffer.alloc(32, 18).toString("base64url"), JESSIEMESSAGE_DB_HOST: "sql.example.invalid",
  JESSIEMESSAGE_DB_PORT: "3306", JESSIEMESSAGE_DB_NAME: "jessiemessage_test", JESSIEMESSAGE_APPLICATION_DATABASE: "jessiemessage_test",
  JESSIEMESSAGE_RUNTIME_DB_USER: "fixture_runtime", JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-runtime-secret",
  JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: "infomaniak-shared", JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd",
  ...Object.fromEntries(flags.map((name) => [`JESSIEMESSAGE_ENABLE_${name}`, name === "AUTH" ? "1" : "0"])) });
const passed = () => ({ valid: true, checks: DATABASE_CHECK_NAMES.map((name) => ({ name, status: "pass" })),
  privilegeObservation: { profile: "infomaniak-shared", source: "show_grants", ledgerWritable: true,
    tempTables: true, tableLocks: true, permanentDdl: false } });

function fixture() {
  const observed = { events: [], queries: [], envs: [], loaded: null, json: null };
  const connection = { query: async (command) => {
    observed.queries.push(command);
    return typeof command === "object" && command.sql.includes("COUNT(*)") ? [{ administrator_count: "0" }] : [];
  }, release: async () => { observed.events.push("release"); } };
  const pool = { getConnection: async () => connection, end: async () => { observed.events.push("end"); } };
  const dependencies = {
    guard: () => ({ port: "3000" }),
    load: async (directory, parameters) => {
      observed.events.push("load"); assert.equal(directory, options.privateDirectory);
      assert.deepEqual(parameters, { port: "3000" });
      observed.loaded = environment(); return observed.loaded;
    },
    checkOutput: async () => { observed.events.push("output"); },
    inspect: async ({ env, databaseName }) => {
      observed.events.push("inspect"); observed.envs.push(env);
      assert.equal(databaseName, "jessiemessage_test"); return passed();
    },
    createPool: async (env) => { observed.events.push("pool"); observed.envs.push(env); return pool; },
    createStore: (guardedPool) => ({ assertSchema: async () => {
      observed.events.push("schema"); const selected = await guardedPool.getConnection();
      await selected.query("synthetic-schema-read"); selected.release(); return true;
    } }),
    initialize: async (selectedArgs, env, io) => {
      observed.events.push("initialize"); observed.envs.push(env);
      assert.deepEqual(selectedArgs, ["--output", path.join(options.privateDirectory, "admin-setup.json")]);
      const chunks = []; for await (const chunk of io.inputStream) chunks.push(chunk);
      observed.json = chunks[0]; observed.input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      io.outputStream.write(`suppressed ${password}`);
      return { created: true, mfaEnrollmentPending: true, recoveryCodeCount: 8, unexpected: password };
    },
  };
  return { observed, connection, pool, dependencies };
}

test("masked administrator arguments accept only a canonical private directory, Linux mode and optional first check", async () => {
  assert.deepEqual(parseArguments(args()), options);
  assert.deepEqual(parseArguments(["check", ...args()]), { ...options, command: "check" });
  const invalid = [[], ["initialize", ...args()], [...args(), "check"], [...args(), "--password", password],
    [...args(), "--email", "other@example.invalid"], [...args(), "--private-directory", "/other"], args().slice(0, -1)];
  for (const directory of ["/", "relative", "/one/../two", "/private/", "/private\\fixture", "/private\nfixture"])
    invalid.push(["--private-directory", directory, "--private-path-mode", "linux-dirfd"]);
  invalid.push(["--private-directory", options.privateDirectory, "--private-path-mode", "strict"]);
  let consumed = false;
  for (const selected of invalid) {
    assert.throws(() => parseArguments(selected), codeIs("ADMIN_SETUP_USAGE"));
    await assert.rejects(main(selected, { inputStream: { async *[Symbol.asyncIterator]() { consumed = true; yield password; } } }), codeIs("ADMIN_SETUP_USAGE"));
  }
  assert.equal(consumed, false);
  await assert.rejects(run({ ...options, password }, password), codeIs("ADMIN_SETUP_USAGE"));
});

test("raw stdin preserves exact password bytes, uses the fixed identity, filters results and clears owned secret references", async () => {
  const f = fixture(), output = [], chunk = Buffer.from(password);
  const result = await main(args(), { ...f.dependencies, inputStream: Readable.from([chunk]), outputStream: { write: (value) => output.push(value) } });
  assert.deepEqual(f.observed.input, { email: "contact@jessiemessage.com", pseudonym: "Jess", password });
  assert.equal(result.status, "prepared"); assert.equal(result.administratorCreated, true);
  assert.equal(result.mfaEnrollmentPending, true); assert.equal(result.recoveryCodeCount, 8);
  assert.equal(result.launchApproved, false); assert.equal(result.serverStarted, false);
  assert.deepEqual(f.observed.events, ["load", "output", "inspect", "pool", "schema", "release", "release", "end", "initialize"]);
  assert.ok(chunk.every((byte) => byte === 0)); assert.ok(f.observed.json.every((byte) => byte === 0));
  for (const env of [f.observed.loaded, ...f.observed.envs]) {
    assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, ""); assert.equal(env.JESSIEMESSAGE_MFA_KEY, "");
  }
  for (const secret of [password, "synthetic-runtime-secret", "fixture_runtime", "sql.example.invalid", options.privateDirectory, "totp", "unexpected"]) {
    assert.equal(output.join("").includes(secret), false);
  }
});

test("check mode consumes no password and never enters the administrator initializer", async () => {
  const f = fixture(), output = [];
  const result = await main(["check", ...args()], { ...f.dependencies,
    inputStream: { async *[Symbol.asyncIterator]() { assert.fail("Check mode must not read stdin"); } }, outputStream: { write: (value) => output.push(value) } });
  assert.equal(result.status, "checked"); assert.equal(result.administratorCreated, false);
  assert.equal(result.administratorPreviouslyAbsent, true); assert.equal(result.authSchemaVerified, true);
  assert.equal(f.observed.events.includes("initialize"), false); assert.equal(f.observed.events.at(-1), "end");
  assert.deepEqual(JSON.parse(output[0]), result);
});

test("process configuration is checked before password input or private files, with a validated port handed to the loader", async () => {
  let consumed = false, loaded = false;
  const noInput = { async *[Symbol.asyncIterator]() { consumed = true; yield password; } };
  for (const guard of [() => { throw new Error(password); }, () => ({ port: "03306" }), () => ({ port: "3000", unexpected: password }),
    () => Object.defineProperty({}, "port", { get() { assert.fail("Process option getter must not run"); } })]) {
    await assert.rejects(main(args(), { inputStream: noInput, guard, load: async () => { loaded = true; } }), codeIs("ADMIN_SETUP_CONFIG"));
  }
  assert.equal(consumed, false); assert.equal(loaded, false);
  const f = fixture(); f.dependencies.guard = () => ({ port: "4567" });
  f.dependencies.load = async (directory, parameters) => { assert.deepEqual(parameters, { port: "4567" }); return { ...environment(), PORT: "4567" }; };
  assert.equal((await run(options, password, f.dependencies)).administratorCreated, true);
});

test("single-line UTF-8 and the existing JavaScript password bounds are enforced before private reads", async () => {
  const f = fixture();
  for (const source of ["", "short", "a".repeat(129), "x\ny", "x\ry", "x\0y", "\ud800", undefined])
    await assert.rejects(run(options, source, f.dependencies), codeIs("ADMIN_SETUP_PASSWORD"));
  for (const source of ["", Buffer.from([255]), "a".repeat(4097), "a\nb", "a\0b"])
    await assert.rejects(main(args(), { ...f.dependencies, inputStream: Readable.from([source]) }), codeIs("ADMIN_SETUP_PASSWORD"));
  await assert.rejects(main(args(), { ...f.dependencies, inputStream: { isTTY: true } }), codeIs("ADMIN_SETUP_PASSWORD"));
  assert.deepEqual(f.observed.events, []);
  for (const source of ["x".repeat(14), "😀".repeat(7), "😀".repeat(64)]) {
    const next = fixture(); await run(options, source, next.dependencies); assert.equal(next.observed.input.password, source);
  }
});

test("missing configuration, malformed environments, private output and any failed database check block initialization", async () => {
  for (const kind of ["load", "flags", "origin", "key", "tls", "getter", "output", ...DATABASE_CHECK_NAMES, "malformed-report"]) {
    const f = fixture();
    if (kind === "load") f.dependencies.load = async () => { throw new Error(password); };
    if (["flags", "origin", "key", "tls", "getter"].includes(kind)) f.dependencies.load = async () => {
      const env = environment();
      if (kind === "flags") env.JESSIEMESSAGE_ENABLE_CHAT = "1";
      if (kind === "origin") env.JESSIEMESSAGE_SITE_ORIGIN = "https://jessiemessage.com";
      if (kind === "key") env.JESSIEMESSAGE_MFA_KEY = "bad";
      if (kind === "tls") { env.JESSIEMESSAGE_DB_HOST = "127.0.0.1"; env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL = "1"; }
      if (kind === "getter") Object.defineProperty(env, "JESSIEMESSAGE_MFA_KEY", { get() { assert.fail("Accessor must not run"); } });
      return env;
    };
    if (kind === "output") f.dependencies.checkOutput = async () => { throw new Error(password); };
    if (DATABASE_CHECK_NAMES.includes(kind)) f.dependencies.inspect = async () => {
      const report = passed(); report.valid = false; report.checks.find((check) => check.name === kind).status = "fail";
      if (kind === "privileges") report.privilegeObservation = { profile: "infomaniak-shared", source: "unverified",
        ledgerWritable: null, tempTables: null, tableLocks: null, permanentDdl: null };
      return report;
    };
    if (kind === "malformed-report") f.dependencies.inspect = async () => ({ ...passed(), checks: [{ name: password, status: "pass" }] });
    await assert.rejects(run(options, password, f.dependencies), (error) => {
      assert.ok(error instanceof AdminSetupInputError); assert.equal(error.message.includes(password), false);
      assert.equal(JSON.stringify(failureResult(error)).includes(password), false); return true;
    });
    assert.equal(f.observed.events.includes("initialize"), false);
    assert.equal(f.observed.events.includes("pool"), false);
  }
});

test("physical schema, administrator absence and all connection cleanup must succeed before bootstrap", async () => {
  for (const kind of ["schema", "schema-false", "exists", "malformed-count", "index-getter", "query", "release", "end"]) {
    const f = fixture();
    if (kind === "schema") f.dependencies.createStore = () => ({ assertSchema: async () => { throw new Error(password); } });
    if (kind === "schema-false") f.dependencies.createStore = () => ({ assertSchema: async () => false });
    if (kind === "exists") f.connection.query = async () => [{ administrator_count: 1n }];
    if (kind === "malformed-count") f.connection.query = async () => [{ administrator_count: false }];
    if (kind === "index-getter") f.connection.query = async (command) => {
      if (typeof command !== "object") return [];
      const rows = [null]; Object.defineProperty(rows, "0", { get() { assert.fail("SQL row index getter must not run"); } }); return rows;
    };
    if (kind === "query") f.connection.query = async () => { throw new Error(password); };
    if (kind === "release") f.connection.release = async () => { throw new Error(password); };
    if (kind === "end") f.pool.end = async () => { f.observed.events.push("end"); throw new Error(password); };
    await assert.rejects(run(options, password, f.dependencies), codeIs(["exists", "malformed-count", "index-getter"].includes(kind) ? "ADMIN_SETUP_EXISTS" : "ADMIN_SETUP_SCHEMA"));
    assert.equal(f.observed.events.includes("initialize"), false); assert.equal(f.observed.events.at(-1), "end");
  }
});

test("initialization waits for real readiness releases and pool closure rather than merely scheduling cleanup", async () => {
  const f = fixture(); let resolveRelease, resolveEnd;
  const release = new Promise((resolve) => { resolveRelease = resolve; }), end = new Promise((resolve) => { resolveEnd = resolve; });
  f.connection.release = () => release; f.pool.end = () => { f.observed.events.push("end"); return end; };
  const pending = run(options, password, f.dependencies);
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(f.observed.events.includes("initialize"), false);
  resolveRelease(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.observed.events.includes("end"), true); assert.equal(f.observed.events.includes("initialize"), false);
  resolveEnd(); await pending; assert.equal(f.observed.events.includes("initialize"), true);
});

test("uncertain commits, post-bootstrap path/cleanup failures and malformed results preserve a fixed uncertainty result", async () => {
  for (const kind of ["commit", "path", "cleanup", "result", "getter"]) {
    const f = fixture();
    f.dependencies.initialize = async () => {
      if (kind === "commit") throw new AdminBootstrapError("SETUP_UNCERTAIN", password);
      if (kind === "path") throw new AdminBootstrapError("SETUP_PATH", password);
      if (kind === "cleanup") throw new Error(password);
      if (kind === "getter") return Object.defineProperty({}, "created", { get() { throw new Error(password); } });
      return { created: false, recoveryCodes: [password] };
    };
    await assert.rejects(run(options, password, f.dependencies), codeIs("ADMIN_SETUP_UNCERTAIN"));
  }
  const f = fixture(); f.dependencies.initialize = async () => { throw new AdminBootstrapError("SETUP_FILE", password); };
  await assert.rejects(run(options, password, f.dependencies), codeIs("ADMIN_SETUP_BOOTSTRAP"));
  assert.deepEqual(failureResult(new Error(password)), { status: "blocked", administratorCreated: null,
    launchApproved: false, serverStarted: false, error: "ADMIN_SETUP_OPERATION" });
  const malformed = new AdminSetupInputError("ADMIN_SETUP_UNCERTAIN");
  malformed.code = password; assert.equal(failureResult(malformed).error, "ADMIN_SETUP_OPERATION");
  Object.defineProperty(malformed, "code", { get() { assert.fail("Error code accessor must not run"); } });
  assert.equal(failureResult(malformed).error, "ADMIN_SETUP_OPERATION");
});

test("the existing bootstrap writes its sole private enrollment copy before SQL and reports success after its pool drains", {
  skip: process.platform !== "linux" || !await statfs("/proc/self/fd", { bigint: true }).then((value) => value.type === 0x9fa0n, () => false),
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jm-admin-input-")); await chmod(directory, 0o700);
  try {
    const f = fixture(), selected = { ...options, privateDirectory: directory };
    f.dependencies.load = async () => environment();
    let saved = false, ended = false;
    f.dependencies.initialize = (bootstrapArgs, env, io) => existingBootstrapMain(bootstrapArgs, env, { ...io,
      createPool: async () => ({ end: async () => { assert.equal(saved, true); ended = true; } }),
      makeStore: () => ({ assertSchema: async () => true, initializeAdmin: async (record) => {
        const output = path.join(directory, "admin-setup.json"), document = await readFile(output, "utf8");
        assert.equal((await lstat(output)).mode & 0o777, 0o600);
        assert.equal(document.includes(password), false); assert.equal(document.includes(env.JESSIEMESSAGE_MFA_KEY), false);
        assert.equal(JSON.parse(document).recoveryCodes.length, 8); assert.equal(record.email, "contact@jessiemessage.com");
        saved = true;
      } }),
    });
    const result = await run(selected, password, f.dependencies);
    assert.equal(result.administratorCreated, true); assert.equal(ended, true);
    const uncertainDirectory = path.join(directory, "uncertain"); await mkdir(uncertainDirectory, { mode: 0o700 });
    f.dependencies.initialize = (bootstrapArgs, env, io) => existingBootstrapMain(bootstrapArgs, env, { ...io,
      createPool: async () => ({ end: async () => { throw new Error("synthetic post-commit close failure"); } }),
      makeStore: () => ({ assertSchema: async () => true, initializeAdmin: async () => {} }),
    });
    await assert.rejects(run({ ...selected, privateDirectory: uncertainDirectory }, password, f.dependencies), codeIs("ADMIN_SETUP_UNCERTAIN"));
    assert.equal((await lstat(path.join(uncertainDirectory, "admin-setup.json"))).mode & 0o777, 0o600,
      "a successful commit followed by failed pool cleanup retains its sole private enrollment file");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI misuse and noninteractive capture never expose supplied passwords", () => {
  const cli = spawnSync(process.execPath, ["scripts/admin-bootstrap-stdin.mjs", ...args(), "--password", password], { encoding: "utf8", input: password, timeout: 5000 });
  assert.equal(cli.status, 1); assert.equal(JSON.parse(cli.stdout).error, "ADMIN_SETUP_USAGE");
  const bash = spawnSync("bash", ["scripts/capture-admin.sh", ...args()], { encoding: "utf8", input: password, timeout: 5000 });
  assert.equal(bash.status, 2); assert.equal(bash.stdout, ""); assert.match(bash.stderr, /^ADMIN_CAPTURE_TTY:/);
  assert.equal(`${cli.stdout}${cli.stderr}${bash.stdout}${bash.stderr}`.includes(password), false);
});

test("interactive capture checks readiness first, confirms exact hidden input and refuses mismatch or cancellation", async (t) => {
  const root = await mkdtemp(path.join(process.cwd(), ".jm-admin-capture-")); t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin"); await mkdir(bin);
  const probe = spawnSync("python3", ["-c", "import json, shutil, sys; print(json.dumps({'python':sys.executable,'node':shutil.which('node')}))"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") { t.skip("Python PTY driver unavailable"); return; }
  assert.equal(probe.status, 0); const { python, node } = JSON.parse(probe.stdout);
  const checkSource = "import {pathToFileURL} from 'node:url'; try { const {parseArguments}=await import(pathToFileURL(process.argv[2])); parseArguments(process.argv.slice(3)); process.stdout.write('CHECK_READY\\n'); } catch { process.stderr.write('ADMIN_SETUP_USAGE\\n'); process.exitCode=2; }";
  await writeFile(path.join(bin, "node"), `#!${python}\nimport json, os, subprocess, sys\nif len(sys.argv)>2 and sys.argv[2]=='check':\n result=subprocess.run([${JSON.stringify(node)},'--input-type=module','-e',${JSON.stringify(checkSource)},'metadata-validation',sys.argv[1]]+sys.argv[2:]); sys.exit(result.returncode)\nsource=sys.stdin.buffer.read(); expected=${JSON.stringify(password)}.encode('utf-8')\nprint(json.dumps({'stdinExact':source==expected,'argumentLeak':expected.decode() in ' '.join(sys.argv),'environmentLeak':any(expected.decode() in v for v in os.environ.values()),'mode':os.environ.get('JESSIEMESSAGE_PRIVATE_PATH_MODE')}))\n`, { mode: 0o700 });
  const driver = `import errno, json, os, pty, select, subprocess, sys, time
try: master, slave=pty.openpty()
except OSError: print(json.dumps({'unavailable':True})); sys.exit(0)
argv=json.loads(sys.argv[1]); secret=json.loads(sys.argv[2]); mode=sys.argv[3]; limit=time.monotonic()+10
child=subprocess.Popen(argv,stdin=slave,stdout=slave,stderr=slave,env=os.environ.copy()); os.close(slave)
output=b''; sent=0
try:
 while time.monotonic()<limit:
  available,_,_=select.select([master],[],[],.05)
  if available:
   try: chunk=os.read(master,65536)
   except OSError as error:
    if error.errno==errno.EIO: break
    raise
   if not chunk: break
   output+=chunk
   if b'Mot de passe administrateur,' in output and sent==0:
    os.write(master,secret.encode('utf-8')+b'\\n'); sent=1
   if b'Confirmer le mot de passe administrateur' in output and sent==1:
    os.write(master,b'\\x04' if mode=='cancel' else (secret if mode=='match' else 'different synthetic password').encode('utf-8')+b'\\n'); sent=2
  if child.poll() is not None and not available: break
finally:
 if child.poll() is None: child.kill()
 status=child.wait(); os.close(master)
print(json.dumps({'status':status,'sent':sent,'output':output.decode('utf-8','replace')}))`;
  for (const mode of ["match", "mismatch", "cancel", "invalid"]) {
    const selected = mode === "invalid" ? [...args(), "--password", "forbidden"] : args();
    const result = spawnSync(python, ["-c", driver, JSON.stringify(["bash", "scripts/capture-admin.sh", ...selected]), JSON.stringify(password), mode],
      { encoding: "utf8", timeout: 15000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr); const captured = JSON.parse(result.stdout);
    if (captured.unavailable) { t.skip("PTY devices unavailable"); return; }
    assert.equal(captured.output.includes(password), false);
    if (mode === "match") {
      assert.equal(captured.status, 0, captured.output); assert.equal(captured.sent, 2);
      assert.match(captured.output, /"stdinExact": true, "argumentLeak": false, "environmentLeak": false, "mode": "linux-dirfd"/);
    } else {
      assert.equal(captured.status, mode === "invalid" ? 2 : 1, captured.output);
      assert.equal(captured.output.includes("stdinExact"), false, "a refusal never invokes the initializer");
      assert.match(captured.output, mode === "mismatch" ? /ADMIN_CAPTURE_MISMATCH/ : mode === "cancel" ? /ADMIN_CAPTURE_CANCELLED/ : /ADMIN_SETUP_USAGE/);
    }
  }
});
