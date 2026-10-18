import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { main, parseArguments, run } from "../scripts/prepare-runtime-auth.mjs";

const options = { privateDirectory: "/private/runtime-fixture", origin: "https://recette.jessiemessage.com", privatePathMode: "linux-dirfd" };
const args = () => ["--private-directory", options.privateDirectory, "--origin", options.origin, "--private-path-mode", options.privatePathMode];
const key = Buffer.alloc(32, 29).toString("base64url");
const codeIs = (code) => (error) => error.code === code;

function fixture() {
  const observed = { events: [], bytes: Buffer.alloc(32, 29) };
  return { observed, dependencies: {
    exists: async (directory) => { observed.events.push("exists"); assert.equal(directory, options.privateDirectory); return false; },
    random: (length) => { observed.events.push("random"); assert.equal(length, 32); return observed.bytes; },
    writeConfiguration: async (directory, config) => {
      observed.events.push("write"); assert.equal(directory, options.privateDirectory);
      observed.written = config; observed.saved = structuredClone(config); return { saved: true };
    },
    readConfiguration: async (directory) => {
      observed.events.push("read"); assert.equal(directory, options.privateDirectory);
      observed.readBack = structuredClone(observed.saved); return observed.readBack;
    },
  } };
}

test("authentication preparation validates the exact origin/path contract before file access or key generation", async () => {
  assert.deepEqual(parseArguments(args()), options);
  const malformed = [[], args().slice(0, -1), [...args(), "--key", key], [...args(), "--origin", options.origin]];
  for (const [name, value] of [["--private-directory", "/"], ["--private-directory", "/private/../other"],
    ["--private-directory", "/private\nfixture"], ["--private-path-mode", "strict"], ["--origin", "https://jessiemessage.com"],
    ["--origin", "https://www.jessiemessage.com"], ["--origin", "https://recette.jessiemessage.com/"],
    ["--origin", "http://recette.jessiemessage.com"], ["--origin", "https://recette.jessiemessage.com:8443"],
    ["--origin", "https://foreign.invalid"]]) {
    const selected = args(); selected[selected.indexOf(name) + 1] = value; malformed.push(selected);
  }
  for (const selected of malformed) {
    const f = fixture(); await assert.rejects(main(selected, f.dependencies), codeIs("RUNTIME_AUTH_PREPARATION_USAGE"));
    assert.deepEqual(f.observed.events, []);
  }
  const f = fixture(); await assert.rejects(run({ ...options, mfaKey: key }, f.dependencies), codeIs("RUNTIME_AUTH_PREPARATION_USAGE"));
  assert.deepEqual(f.observed.events, []);
});

test("preparation generates one 32-byte key only after absence and confirms exclusive durable save by exact readback", async () => {
  const f = fixture(), output = [];
  const result = await main(args(), { ...f.dependencies, outputStream: { write: (value) => output.push(value) } });
  assert.deepEqual(f.observed.events, ["exists", "random", "write", "read"]);
  assert.deepEqual(f.observed.saved, { format: "jessiemessage-runtime-auth", version: 1, origin: options.origin, mfaKey: key });
  assert.deepEqual(result, { status: "prepared", authConfigSaved: true, launchApproved: false });
  assert.deepEqual(JSON.parse(output[0]), result); assert.equal(output.join("").includes(key), false);
  assert.equal(output.join("").includes(options.privateDirectory), false); assert.equal(output.join("").includes(options.origin), false);
  assert.equal(f.observed.written.mfaKey, ""); assert.ok(f.observed.bytes.every((byte) => byte === 0));
  // An injected reader retains ownership of its source, which is never mutated.
  assert.equal(f.observed.readBack.mfaKey, key);
});

test("every existing name blocks generation and overwrite, including invalid or symlink entries reported by the anchored checker", async () => {
  const f = fixture(); f.dependencies.exists = async () => { f.observed.events.push("exists"); return true; };
  await assert.rejects(run(options, f.dependencies), codeIs("RUNTIME_AUTH_PREPARATION_EXISTS"));
  assert.deepEqual(f.observed.events, ["exists"]); assert.ok(f.observed.bytes.every((byte) => byte === 29));
});

test("failed or malformed existence checks block before random generation and persistence", async () => {
  for (const source of [undefined, null, "false", 0, {}]) {
    const f = fixture(); f.dependencies.exists = async () => source;
    await assert.rejects(run(options, f.dependencies), codeIs("RUNTIME_AUTH_PREPARATION_CONFIG"));
    assert.deepEqual(f.observed.events, []);
  }
  const f = fixture(); f.dependencies.exists = async () => { throw new Error(key); };
  await assert.rejects(run(options, f.dependencies), codeIs("RUNTIME_AUTH_PREPARATION_CONFIG")); assert.deepEqual(f.observed.events, []);
});

test("random failures and invalid buffers cannot publish authentication configuration", async () => {
  for (const source of [null, "not-a-buffer", Buffer.alloc(31, 17), Buffer.alloc(33, 17)]) {
    const f = fixture(); f.dependencies.random = () => source;
    await assert.rejects(run(options, f.dependencies), codeIs("RUNTIME_AUTH_PREPARATION_CONFIG"));
    assert.deepEqual(f.observed.events, ["exists"]);
    if (Buffer.isBuffer(source)) assert.ok(source.every((byte) => byte === 0));
  }
  const f = fixture(); f.dependencies.random = () => { throw new Error(key); };
  await assert.rejects(run(options, f.dependencies), codeIs("RUNTIME_AUTH_PREPARATION_CONFIG"));
  assert.deepEqual(f.observed.events, ["exists"]);
});

test("ambiguous write errors preserve the published copy and emit no success while owned key references are cleared", async () => {
  const f = fixture(), output = [];
  f.dependencies.writeConfiguration = async (_directory, config) => {
    f.observed.written = config; f.observed.saved = structuredClone(config); f.observed.events.push("write"); throw new Error(key);
  };
  await assert.rejects(main(args(), { ...f.dependencies, outputStream: { write: (value) => output.push(value) } }), (error) => {
    assert.equal(error.code, "RUNTIME_AUTH_PREPARATION_CONFIG"); assert.equal(JSON.stringify(error).includes(key), false); return true;
  });
  assert.deepEqual(output, []); assert.deepEqual(f.observed.events, ["exists", "random", "write"]);
  assert.equal(f.observed.saved.mfaKey, key); assert.equal(f.observed.written.mfaKey, "");
  assert.ok(f.observed.bytes.every((byte) => byte === 0));
});

test("failed, malformed or mismatched readback never confirms preparation and does not mutate an injected source", async () => {
  for (const kind of ["write-false", "read", "key", "origin", "format", "extra", "getter"]) {
    const f = fixture(), output = []; let getters = 0;
    if (kind === "write-false") f.dependencies.writeConfiguration = async () => ({ saved: false });
    if (kind === "read") f.dependencies.readConfiguration = async () => { throw new Error(key); };
    if (!["write-false", "read"].includes(kind)) f.dependencies.readConfiguration = async () => {
      const value = structuredClone(f.observed.saved);
      if (kind === "key") value.mfaKey = Buffer.alloc(32, 13).toString("base64url");
      if (kind === "origin") value.origin = "https://other.jessiemessage.com";
      if (kind === "format") value.format = "jessiemessage-runtime-database";
      if (kind === "extra") value.active = true;
      if (kind === "getter") Object.defineProperty(value, "mfaKey", { get() { getters++; throw new Error(key); } });
      f.observed.readBack = value; return value;
    };
    await assert.rejects(main(args(), { ...f.dependencies, outputStream: { write: (value) => output.push(value) } }), codeIs("RUNTIME_AUTH_PREPARATION_CONFIG"));
    assert.deepEqual(output, []); assert.equal(getters, 0); assert.ok(f.observed.bytes.every((byte) => byte === 0));
    if (f.observed.written) assert.equal(f.observed.written.mfaKey, "");
    if (f.observed.readBack && !["key", "getter"].includes(kind)) assert.equal(f.observed.readBack.mfaKey, key);
  }
});

test("preparation waits for complete save and readback without invoking SQL, a listener or feature activation", async () => {
  const f = fixture(), output = []; let finishWrite, finishRead;
  f.dependencies.writeConfiguration = (_directory, config) => {
    f.observed.saved = structuredClone(config); return new Promise((resolve) => { finishWrite = resolve; });
  };
  f.dependencies.readConfiguration = () => new Promise((resolve) => { finishRead = resolve; });
  const pending = main(args(), { ...f.dependencies, outputStream: { write: (value) => output.push(value) } });
  await new Promise((resolve) => setImmediate(resolve)); assert.deepEqual(output, []); assert.equal(typeof finishWrite, "function");
  finishWrite({ saved: true }); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(output, []); assert.equal(typeof finishRead, "function");
  finishRead(structuredClone(f.observed.saved)); await pending;
  assert.deepEqual(JSON.parse(output[0]), { status: "prepared", authConfigSaved: true, launchApproved: false });
});

test("preparation CLI emits only a fixed blocked DTO and never accepts a key argument", () => {
  const result = spawnSync(process.execPath, ["scripts/prepare-runtime-auth.mjs", ...args(), "--key", key], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /^RUNTIME_AUTH_PREPARATION_USAGE:/);
  assert.deepEqual(JSON.parse(result.stdout), { status: "blocked", authConfigSaved: null, launchApproved: false, error: "RUNTIME_AUTH_PREPARATION_USAGE" });
  for (const value of [key, options.privateDirectory, options.origin]) assert.equal(`${result.stdout}${result.stderr}`.includes(value), false);
});
