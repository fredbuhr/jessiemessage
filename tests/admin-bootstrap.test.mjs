import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { bootstrap, main, parseArguments, readInput, validateInput, validateOutputPath } from "../scripts/admin-bootstrap.mjs";

const input = { email: "Operator@Example.Invalid", pseudonym: "Administratrice test", password: "Synthetic-only password 42" };
const config = { enabled: true, origin: "https://jessiemessage.example.invalid", totpKey: Buffer.alloc(32, 7) };
const clock = 1800000000000;
const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
// Crypto primitives are exercised in auth-crypto.test.mjs. These substitutes
// isolate filesystem/transaction failure boundaries without repeating a KDF.
const crypto = {
  newId: () => Buffer.alloc(16, 2),
  hashPassword: async () => "synthetic-password-hash",
  makeTotpSecret: () => secret,
  sealTotpSecret: () => "v1.synthetic-encrypted-secret",
  createRecoveryCodes: (count) => Array.from({ length: count }, (_, index) => (index + 1).toString(16).padStart(32, "0")),
  recoveryCodeDigest: (code) => createHash("sha256").update(code).digest(),
};
const codeIs = (code) => (error) => error.code === code;
const dirfdTests = { skip: process.platform !== "linux" ? "Linux descriptor paths are unavailable on this platform"
  : await lstat("/proc/self/fd").then(() => false, () => "Linux proc descriptor paths are unavailable") };

async function fixture(callback) {
  const root = await mkdtemp(join(process.cwd(), ".jessiemessage-bootstrap-unit-"));
  const repoRoot = join(root, "repository");
  const privateRoot = join(root, "private");
  await mkdir(repoRoot, { mode: 0o700 });
  await mkdir(privateRoot, { mode: 0o700 });
  try { return await callback({ root, repoRoot, privateRoot, outputPath: join(privateRoot, "setup.json") }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("bootstrap arguments require one absolute output path and no positional credentials", () => {
  assert.deepEqual(parseArguments(["--output", "/private/setup.json"]), { outputPath: "/private/setup.json" });
  for (const args of [[], ["--output"], ["--output", "relative.json"], ["--password", input.password],
    ["--output", "/private/setup.json", input.password], ["--output", "/private/setup.json", "--output", "/other.json"]]) {
    assert.throws(() => parseArguments(args), codeIs("SETUP_USAGE"));
  }
});

test("input canonicalizes email and display NFC while preserving the exact password", () => {
  assert.deepEqual(validateInput({ ...input, pseudonym: "Cafe\u0301", password: ` ${input.password} ` }),
    { email: "operator@example.invalid", pseudonym: "Café", password: ` ${input.password} ` });
  for (const value of [null, [], { ...input, unexpected: true }, { email: input.email, password: input.password },
    { ...input, email: " operator@example.invalid" }, { ...input, email: "operator@localhost" },
    { ...input, pseudonym: " invisible\u200b" }, { ...input, pseudonym: "a".repeat(65) },
    { ...input, pseudonym: "\ud800" }, { ...input, password: "short" }, { ...input, password: "a".repeat(129) }]) {
    assert.throws(() => validateInput(value), codeIs("SETUP_INPUT"));
  }
});

test("stdin refuses malformed, invalid UTF-8, oversized and unsupported JSON", async () => {
  assert.equal((await readInput(Readable.from([JSON.stringify(input)]))).email, "operator@example.invalid");
  for (const value of ["not JSON", "[]", JSON.stringify({ ...input, extra: "refused" }), " ".repeat(4097),
    Buffer.from([0xff, 0xfe])]) {
    await assert.rejects(readInput(Readable.from([value])), codeIs("SETUP_INPUT"));
  }
});

test("setup output refuses the entire repository, readable parents, symlinks and writable ancestors", async () => {
  await fixture(async ({ root, repoRoot, privateRoot, outputPath }) => {
    assert.equal((await validateOutputPath(outputPath, { repoRoot })).path, outputPath);
    await assert.rejects(validateOutputPath(join(repoRoot, "setup.json"), { repoRoot }), codeIs("SETUP_PATH"));
    await assert.rejects(validateOutputPath("relative.json", { repoRoot }), codeIs("SETUP_PATH"));
    await chmod(privateRoot, 0o755);
    await assert.rejects(validateOutputPath(outputPath, { repoRoot }), codeIs("SETUP_PATH"));
    await chmod(privateRoot, 0o700);
    const linkedParent = join(root, "linked-private");
    await symlink(privateRoot, linkedParent);
    await assert.rejects(validateOutputPath(join(linkedParent, "setup.json"), { repoRoot }), codeIs("SETUP_PATH"));
    await chmod(root, 0o770);
    await assert.rejects(validateOutputPath(outputPath, { repoRoot }), codeIs("SETUP_PATH"));
    await chmod(root, 0o700);
  });
});

test("all setup material is privately written before initializeAdmin and excludes the password and master key", async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    let saved;
    const store = { initializeAdmin: async (record) => {
      saved = record;
      const stats = await lstat(outputPath);
      assert.equal(stats.mode & 0o777, 0o600);
      if (typeof process.getuid === "function") assert.equal(stats.uid, process.getuid());
      const text = await readFile(outputPath, "utf8");
      assert.ok(text.includes(secret));
      assert.equal(text.includes(input.password), false);
      assert.equal(text.includes("synthetic-password-hash"), false);
      assert.equal(text.includes(config.totpKey.toString("base64url")), false);
    } };
    const result = await bootstrap({ input, outputPath, config, store, repoRoot, now: clock, crypto });
    assert.deepEqual(result, { created: true, mfaEnrollmentPending: true, recoveryCodeCount: 8 });
    assert.equal(saved.email, "operator@example.invalid");
    assert.equal(saved.now, clock);
    assert.equal(saved.secretEncrypted, "v1.synthetic-encrypted-secret");
    assert.equal(saved.recoveryDigests.length, 8);
    assert.ok(saved.recoveryDigests.every((digest) => Buffer.isBuffer(digest) && digest.length === 32));
    const setup = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(setup.totp.secret, secret);
    assert.equal(setup.totp.digits, 6);
    assert.equal(setup.createdAt, new Date(clock).toISOString());
    assert.ok(setup.totp.uri.startsWith("otpauth://totp/JessieMessage%3Aoperator%40example.invalid?"));
    assert.equal(new URL(setup.totp.uri).searchParams.get("secret"), secret);
    assert.equal(setup.recoveryCodes.length, 8);
    assert.ok(setup.recoveryCodes.every((code) => /^[0-9a-f]{4}(?:-[0-9a-f]{4}){7}$/.test(code)));
  });
});

test("existing output files and output symlinks are never overwritten or removed", async () => {
  await fixture(async ({ repoRoot, privateRoot, outputPath }) => {
    const store = { initializeAdmin: async () => assert.fail("Database must not be modified") };
    await writeFile(outputPath, "previous private material", { mode: 0o600 });
    await assert.rejects(bootstrap({ input, outputPath, config, store, repoRoot, crypto }), codeIs("SETUP_FILE"));
    assert.equal(await readFile(outputPath, "utf8"), "previous private material");
    const symlinkPath = join(privateRoot, "symlink.json");
    await symlink(outputPath, symlinkPath);
    await assert.rejects(bootstrap({ input, outputPath: symlinkPath, config, store, repoRoot, crypto }), codeIs("SETUP_FILE"));
    assert.equal((await lstat(symlinkPath)).isSymbolicLink(), true);
    assert.equal(await readFile(outputPath, "utf8"), "previous private material");
  });
});

test("two simultaneous output reservations permit one initializer only", async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    let calls = 0;
    const store = { initializeAdmin: async () => { calls += 1; } };
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => bootstrap({ input, outputPath, config, store, repoRoot, crypto })));
    assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
    assert.equal(results.find((value) => value.status === "rejected").reason.code, "SETUP_FILE");
    assert.equal(calls, 1);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).totp.secret, secret);
  });
});

test("confirmed initialization failure removes the private output without leaking driver errors", async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    const store = { initializeAdmin: async () => { throw new Error(`private database error ${input.password}`); } };
    await assert.rejects(bootstrap({ input, outputPath, config, store, repoRoot, crypto }), (error) => {
      assert.equal(error.code, "SETUP_DATABASE");
      assert.equal(error.message.includes(input.password), false);
      return true;
    });
    await assert.rejects(lstat(outputPath), codeIs("ENOENT"));
  });
});

test("an uncertain commit preserves the only setup copy for private investigation", async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    const store = { initializeAdmin: async () => { throw Object.assign(new Error("commit reply lost"), { preserveSetupFile: true }); } };
    await assert.rejects(bootstrap({ input, outputPath, config, store, repoRoot, crypto }), codeIs("SETUP_UNCERTAIN"));
    assert.equal((await lstat(outputPath)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).totp.secret, secret);
  });
});

test("main closes its runtime pool on success and failure and logs no setup secrets", async () => {
  await fixture(async ({ repoRoot, privateRoot, outputPath }) => {
    let closed = 0;
    let connected = 0;
    const output = [];
    const pool = { end: async () => { closed += 1; } };
    const dependencies = {
      configure: () => config, repoRoot, crypto, now: clock,
      inputStream: Readable.from([JSON.stringify(input)]),
      outputStream: { write: (value) => { output.push(value); } },
      createPool: async () => { connected += 1; return pool; },
      makeStore: (actualPool) => { assert.equal(actualPool, pool); return { assertSchema: async () => {}, initializeAdmin: async () => {} }; },
    };
    await main(["--output", outputPath], {}, dependencies);
    assert.equal(closed, 1);
    assert.equal(connected, 1);
    const logged = output.join("");
    for (const sensitive of [input.password, secret, "operator@example.invalid", outputPath, "0000-0000"]) {
      assert.equal(logged.includes(sensitive), false);
    }
    output.length = 0;
    await assert.rejects(main(["--output", join(privateRoot, "failure.json")], {}, { ...dependencies,
      inputStream: Readable.from([JSON.stringify(input)]),
      makeStore: () => ({ assertSchema: async () => {}, initializeAdmin: async () => { throw new Error("synthetic failure"); } }),
    }), codeIs("SETUP_DATABASE"));
    assert.equal(closed, 2);
    assert.equal(output.length, 0);
    await assert.rejects(main(["--output", join(privateRoot, "disabled.json")], {}, { ...dependencies,
      configure: () => ({ enabled: false }), inputStream: Readable.from([JSON.stringify(input)]),
    }), codeIs("SETUP_CONFIG"));
    assert.equal(connected, 2);
  });
});

test("main requires schema verification before generating a setup file and closes the pool on refusal", async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    let closed = 0;
    let generated = 0;
    const dependencies = {
      configure: () => config, repoRoot,
      inputStream: Readable.from([JSON.stringify(input)]),
      outputStream: { write: () => assert.fail("No successful setup output is expected") },
      createPool: async () => ({ end: async () => { closed += 1; } }),
      crypto: { ...crypto, newId: () => { generated += 1; return crypto.newId(); } },
      makeStore: () => ({ assertSchema: async () => { throw Object.assign(new Error("Synthetic schema refusal"), { code: "AUTH_DATABASE_STATE" }); },
        initializeAdmin: async () => assert.fail("Invalid schema must not create an administrator") }),
    };
    await assert.rejects(main(["--output", outputPath], {}, dependencies), codeIs("AUTH_DATABASE_STATE"));
    assert.equal(closed, 1);
    assert.equal(generated, 0);
    await assert.rejects(lstat(outputPath), codeIs("ENOENT"));
    await assert.rejects(main(["--output", outputPath], {}, { ...dependencies,
      inputStream: Readable.from([JSON.stringify(input)]),
      makeStore: () => ({ initializeAdmin: async () => assert.fail("Missing schema verification must refuse initialization") }),
    }), codeIs("SETUP_CONFIG"));
    assert.equal(closed, 2);
    assert.equal(generated, 0);
  });
});

test("Linux descriptor bootstrap refuses unavailable proc descriptor paths before database initialization", {
  skip: dirfdTests.skip === false ? "Real proc descriptor paths are available" : false,
}, async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    const store = { initializeAdmin: async () => assert.fail("Unavailable descriptor paths must not initialize the database") };
    await assert.rejects(bootstrap({ input, outputPath, config, store, repoRoot, crypto, pathMode: "linux-dirfd" }), codeIs("SETUP_PATH"));
    await assert.rejects(lstat(outputPath), codeIs("ENOENT"));
  });
});

test("Linux descriptor output validation retains repository, ownership and symlink guards", dirfdTests, async () => {
  await fixture(async ({ root, repoRoot, privateRoot, outputPath }) => {
    const options = { repoRoot, pathMode: "linux-dirfd" };
    assert.equal((await validateOutputPath(outputPath, options)).path, outputPath);
    await assert.rejects(validateOutputPath(join(repoRoot, "setup.json"), options), codeIs("SETUP_PATH"));
    await assert.rejects(validateOutputPath(outputPath, { repoRoot, pathMode: "unknown" }), codeIs("SETUP_PATH"));
    await chmod(privateRoot, 0o755);
    await assert.rejects(validateOutputPath(outputPath, options), codeIs("SETUP_PATH"));
    await chmod(privateRoot, 0o700);
    const linkedParent = join(root, "linked-private");
    await symlink(privateRoot, linkedParent);
    await assert.rejects(validateOutputPath(join(linkedParent, "setup.json"), options), codeIs("SETUP_PATH"));
  });
});

test("Linux descriptor bootstrap writes private setup before database initialization", dirfdTests, async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    let calls = 0;
    const store = { initializeAdmin: async () => {
      calls += 1;
      assert.equal((await lstat(outputPath)).mode & 0o777, 0o600);
      const text = await readFile(outputPath, "utf8");
      assert.equal(JSON.parse(text).totp.secret, secret);
      assert.equal(text.includes(input.password), false);
      assert.equal(text.includes(config.totpKey.toString("base64url")), false);
    } };
    assert.deepEqual(await bootstrap({ input, outputPath, config, store, repoRoot, crypto, now: clock, pathMode: "linux-dirfd" }),
      { created: true, mfaEnrollmentPending: true, recoveryCodeCount: 8 });
    assert.equal(calls, 1);
  });
});

test("Linux descriptor reservations never replace existing files or output symlinks", dirfdTests, async () => {
  await fixture(async ({ repoRoot, privateRoot, outputPath }) => {
    const options = { input, outputPath, config, repoRoot, crypto, pathMode: "linux-dirfd",
      store: { initializeAdmin: async () => assert.fail("Database must not be modified") } };
    await writeFile(outputPath, "previous private material", { mode: 0o600 });
    await assert.rejects(bootstrap(options), codeIs("SETUP_FILE"));
    const symlinkPath = join(privateRoot, "symlink.json");
    await symlink(outputPath, symlinkPath);
    await assert.rejects(bootstrap({ ...options, outputPath: symlinkPath }), codeIs("SETUP_FILE"));
    assert.equal((await lstat(symlinkPath)).isSymbolicLink(), true);
    assert.equal(await readFile(outputPath, "utf8"), "previous private material");
  });
});

test("Linux descriptor concurrent output reservations allow only one database initializer", dirfdTests, async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    let calls = 0;
    const store = { initializeAdmin: async () => { calls += 1; } };
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => bootstrap({
      input, outputPath, config, store, repoRoot, crypto, pathMode: "linux-dirfd",
    })));
    assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
    assert.equal(results.find((value) => value.status === "rejected").reason.code, "SETUP_FILE");
    assert.equal(calls, 1);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).totp.secret, secret);
  });
});

test("Linux descriptor cleanup remains anchored when the absolute parent is replaced during the transaction", dirfdTests, async () => {
  await fixture(async ({ root, repoRoot, privateRoot, outputPath }) => {
    const movedParent = join(root, "original-private");
    const store = { initializeAdmin: async () => {
      assert.equal(JSON.parse(await readFile(outputPath, "utf8")).totp.secret, secret);
      await rename(privateRoot, movedParent);
      await mkdir(privateRoot, { mode: 0o700 });
      await writeFile(outputPath, "replacement must survive", { mode: 0o600 });
      throw new Error(`private database error ${input.password}`);
    } };
    await assert.rejects(bootstrap({ input, outputPath, config, store, repoRoot, crypto, pathMode: "linux-dirfd" }), (error) => {
      assert.equal(error.code, "SETUP_DATABASE");
      assert.equal(error.message.includes(input.password), false);
      return true;
    });
    await assert.rejects(lstat(join(movedParent, "setup.json")), codeIs("ENOENT"));
    assert.equal(await readFile(outputPath, "utf8"), "replacement must survive");
  });
});

test("Linux descriptor uncertain commit preserves the anchored setup after an absolute parent replacement", dirfdTests, async () => {
  await fixture(async ({ root, repoRoot, privateRoot, outputPath }) => {
    const movedParent = join(root, "original-private");
    const store = { initializeAdmin: async () => {
      await rename(privateRoot, movedParent);
      await mkdir(privateRoot, { mode: 0o700 });
      await writeFile(outputPath, "replacement must survive", { mode: 0o600 });
      throw Object.assign(new Error("commit reply lost"), { preserveSetupFile: true });
    } };
    await assert.rejects(bootstrap({ input, outputPath, config, store, repoRoot, crypto, pathMode: "linux-dirfd" }), codeIs("SETUP_UNCERTAIN"));
    assert.equal((await lstat(join(movedParent, "setup.json"))).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(join(movedParent, "setup.json"), "utf8")).totp.secret, secret);
    assert.equal(await readFile(outputPath, "utf8"), "replacement must survive");
  });
});

test("main passes the explicit Linux descriptor environment mode to the private bootstrap", dirfdTests, async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    let closed = 0;
    let calls = 0;
    const pool = { end: async () => { closed += 1; } };
    await main(["--output", outputPath], { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, {
      configure: () => config, repoRoot, crypto,
      inputStream: Readable.from([JSON.stringify(input)]), outputStream: { write: () => {} },
      createPool: async () => pool,
      makeStore: () => ({ assertSchema: async () => {}, initializeAdmin: async () => { calls += 1; } }),
    });
    assert.equal(calls, 1);
    assert.equal(closed, 1);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).totp.secret, secret);
  });
});
