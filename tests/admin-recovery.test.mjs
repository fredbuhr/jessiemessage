import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { main, parseArguments, readInput, recover, validateInput } from "../scripts/admin-recover.mjs";
import { createAdminRecoveryStore } from "../server/auth/recovery-store.mjs";

const id = Buffer.alloc(16, 7);
const input = { email: "Operator@Example.Invalid", password: "New synthetic recovery password 42" };
const email = "operator@example.invalid";
const config = { enabled: true, totpKey: Buffer.alloc(32, 19) };
const now = Date.UTC(2026, 9, 14, 14);
const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const crypto = {
  newId: () => assert.fail("Recovery must retain the existing administrator ID"),
  hashPassword: async () => "synthetic-new-password-hash",
  makeTotpSecret: () => secret,
  sealTotpSecret: (value, key, actualId) => { assert.equal(value, secret); assert.deepEqual(key, config.totpKey); assert.deepEqual(actualId, id); return "v1.synthetic-new-sealed-secret"; },
  createRecoveryCodes: (count) => Array.from({ length: count }, (_, index) => (index + 100).toString(16).padStart(32, "0")),
  recoveryCodeDigest: (value) => createHash("sha256").update(value).digest(),
};
const codeIs = (code) => (error) => error.code === code;
const target = { id, email, pseudonym: "Administratrice synthétique", version: 3 };
const args = (path) => ["--output", path, "--admin-id", id.toString("hex"), "--confirm-reset"];

async function fixture(callback) {
  const root = await mkdtemp(join(process.cwd(), ".jessiemessage-recovery-unit-"));
  const repoRoot = join(root, "repository");
  const privateRoot = join(root, "private");
  await mkdir(repoRoot, { mode: 0o700 });
  await mkdir(privateRoot, { mode: 0o700 });
  try { await callback({ repoRoot, privateRoot, outputPath: join(privateRoot, "recovery.json") }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("recovery CLI requires an exact administrator ID, absolute private output and explicit confirmation", () => {
  assert.deepEqual(parseArguments(args("/private/setup.json")), { outputPath: "/private/setup.json", adminId: id });
  for (const value of [[], ["--output", "/private/setup.json"], args("relative.json"), args("/private/setup.json").slice(0, 4),
    [...args("/private/setup.json"), "--extra"], ["--output", "/private/setup.json", "--admin-id", "xyz", "--confirm-reset"],
    ["--output", "/private/setup.json", "--admin-id", "a".repeat(31), "--confirm-reset"],
    ["--output", "/private/setup.json", "--admin-id", "A".repeat(32), "--confirm-reset"],
    ["--password", input.password, "--admin-id", id.toString("hex"), "--confirm-reset"]]) {
    assert.throws(() => parseArguments(value), codeIs("RECOVERY_USAGE"));
  }
});

test("recovery JSON accepts only email and an unchanged strong password, never old bootstrap input", async () => {
  assert.deepEqual(validateInput({ ...input, password: ` ${input.password} ` }), { email, password: ` ${input.password} ` });
  assert.deepEqual(await readInput(Readable.from([JSON.stringify(input)])), { email, password: input.password });
  for (const value of [null, [], { ...input, pseudonym: "forbidden" }, { ...input, role: "admin" }, { ...input, password: "short" },
    { ...input, password: "a".repeat(129) }, { ...input, password: "broken\ud800password" }, { ...input, email: " operator@example.invalid" }]) {
    assert.throws(() => validateInput(value), codeIs("RECOVERY_INPUT"));
  }
  for (const source of ["{}", "invalid JSON", " ".repeat(4097), Buffer.from([0xff, 0xfe])]) {
    await assert.rejects(readInput(Readable.from([source])), codeIs("RECOVERY_INPUT"));
  }
});

test("recovery adapts bootstrap private-file safety and seals new MFA to the same verified administrator", async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    let captured;
    const store = {
      getAdminForRecovery: async (actualId, actualEmail) => { assert.deepEqual(actualId, id); assert.equal(actualEmail, email); return target; },
      resetAdmin: async (record) => {
        captured = record;
        const setup = JSON.parse(await readFile(outputPath, "utf8"));
        assert.equal(setup.totp.secret, secret);
        assert.equal((await lstat(outputPath)).mode & 0o777, 0o600);
      },
    };
    assert.deepEqual(await recover({ input, outputPath, adminId: id, config, store, repoRoot, now, crypto }),
      { recovered: true, mfaEnrollmentPending: true, recoveryCodeCount: 8 });
    assert.deepEqual(captured.id, id);
    assert.equal(captured.email, email);
    assert.equal(captured.pseudonym, target.pseudonym);
    assert.equal(captured.expectedVersion, 3);
    assert.equal(captured.passwordHash, "synthetic-new-password-hash");
    assert.equal(captured.secretEncrypted, "v1.synthetic-new-sealed-secret");
    assert.equal(captured.recoveryDigests.length, 8);
    assert.equal(captured.now, now);
    const text = await readFile(outputPath, "utf8");
    for (const value of [input.password, captured.passwordHash, config.totpKey.toString("base64url")]) assert.equal(text.includes(value), false);
  });
});

test("unknown, inactive or mismatching identity never generates MFA or writes a private output", async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    for (const admin of [null, { ...target, id: Buffer.alloc(16, 8) }, { ...target, email: "other@example.invalid" }, { ...target, version: 0 }]) {
      await assert.rejects(recover({ input, outputPath, adminId: id, config, repoRoot, now,
        crypto: { makeTotpSecret: () => assert.fail("Unverified identity cannot generate factors") },
        store: { getAdminForRecovery: async () => admin, resetAdmin: async () => assert.fail("Unverified identity cannot be reset") },
      }), codeIs("RECOVERY_TARGET"));
      await assert.rejects(lstat(outputPath), codeIs("ENOENT"));
    }
  });
});

test("existing outputs survive recovery refusal, confirmed failures remove new output and uncertain commits preserve it", async () => {
  await fixture(async ({ repoRoot, privateRoot, outputPath }) => {
    const store = { getAdminForRecovery: async () => target, resetAdmin: async () => assert.fail("Must not reset with an existing output") };
    await writeFile(outputPath, "prior private copy", { mode: 0o600 });
    await assert.rejects(recover({ input, outputPath, adminId: id, config, store, repoRoot, now, crypto }), codeIs("SETUP_FILE"));
    assert.equal(await readFile(outputPath, "utf8"), "prior private copy");
    const failedPath = join(privateRoot, "failed.json");
    await assert.rejects(recover({ input, outputPath: failedPath, adminId: id, config, repoRoot, now, crypto,
      store: { ...store, resetAdmin: async () => { throw new Error(`private driver ${input.password}`); } },
    }), (error) => error.code === "SETUP_DATABASE" && !error.message.includes(input.password));
    await assert.rejects(lstat(failedPath), codeIs("ENOENT"));
    const uncertainPath = join(privateRoot, "uncertain.json");
    await assert.rejects(recover({ input, outputPath: uncertainPath, adminId: id, config, repoRoot, now, crypto,
      store: { ...store, resetAdmin: async () => { throw Object.assign(new Error("private commit failure"), { preserveSetupFile: true }); } },
    }), codeIs("SETUP_UNCERTAIN"));
    assert.equal((await lstat(uncertainPath)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(uncertainPath, "utf8")).totp.secret, secret);
  });
});

test("main verifies schema before reading the target and closes its pool without printing identifiers or factors", async () => {
  await fixture(async ({ repoRoot, privateRoot, outputPath }) => {
    let schemaChecked = false;
    let closed = 0;
    const logged = [];
    const pool = { end: async () => { closed += 1; } };
    const dependencies = {
      configure: () => config, repoRoot, now, crypto,
      inputStream: Readable.from([JSON.stringify(input)]),
      outputStream: { write: (text) => logged.push(text) },
      createPool: async () => pool,
      makeStore: (actual) => { assert.equal(actual, pool); return { assertSchema: async () => { schemaChecked = true; } }; },
      makeRecoveryStore: (actual) => { assert.equal(actual, pool); return {
        getAdminForRecovery: async () => { assert.equal(schemaChecked, true); return target; }, resetAdmin: async () => {},
      }; },
    };
    assert.equal((await main(args(outputPath), {}, dependencies)).recovered, true);
    assert.equal(closed, 1);
    for (const value of [input.password, secret, email, outputPath, id.toString("hex"), config.totpKey.toString("base64url")]) {
      assert.equal(logged.join("").includes(value), false);
    }
    schemaChecked = false;
    const refusedPath = join(privateRoot, "schema-refused.json");
    await assert.rejects(main(args(refusedPath), {}, { ...dependencies, inputStream: Readable.from([JSON.stringify(input)]),
      makeStore: () => ({ assertSchema: async () => { throw Object.assign(new Error("synthetic schema refusal"), { code: "AUTH_DATABASE_STATE" }); } }),
      makeRecoveryStore: () => assert.fail("Schema must be checked first"),
    }), codeIs("AUTH_DATABASE_STATE"));
    assert.equal(closed, 2);
    await assert.rejects(lstat(refusedPath), codeIs("ENOENT"));
    await assert.rejects(main(args(refusedPath), {}, { ...dependencies, inputStream: Readable.from([JSON.stringify(input)]), makeStore: () => ({}) }), codeIs("RECOVERY_CONFIG"));
    assert.equal(closed, 3);
  });
});

test("CLI guards reject missing confirmation, disabled configuration and interactive secrets before opening a pool", async () => {
  const deps = { configure: () => config, createPool: async () => assert.fail("Refused CLI cannot open the database") };
  await assert.rejects(main(args("/private/setup.json").slice(0, 4), {}, deps), codeIs("RECOVERY_USAGE"));
  await assert.rejects(main(args("/private/setup.json"), {}, { ...deps, configure: () => ({ enabled: false }) }), codeIs("RECOVERY_CONFIG"));
  await assert.rejects(main(args("/private/setup.json"), {}, { ...deps, inputStream: { isTTY: true } }), codeIs("RECOVERY_INPUT"));
});

test("runtime pool cleanup errors cannot replace a committed recovery result or its private setup copy", async () => {
  await fixture(async ({ repoRoot, outputPath }) => {
    let closed = 0;
    const result = await main(args(outputPath), {}, {
      configure: () => config, repoRoot, now, crypto, inputStream: Readable.from([JSON.stringify(input)]), outputStream: { write: () => {} },
      createPool: async () => ({ end: async () => { closed += 1; throw new Error("synthetic cleanup failure"); } }),
      makeStore: () => ({ assertSchema: async () => {} }), makeRecoveryStore: () => ({ getAdminForRecovery: async () => target, resetAdmin: async () => {} }),
    });
    assert.equal(result.recovered, true);
    assert.equal(closed, 1);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).totp.secret, secret);
  });
});

function fakePool({ user = { role: "admin", status: "active", email }, version = 3, failCommit = false, failRelease = false } = {}) {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push("begin"), commit: async () => { calls.push("commit"); if (failCommit) throw new Error("private commit detail"); },
    rollback: async () => calls.push("rollback"), release: () => { calls.push("release"); if (failRelease) throw new Error("private release detail"); },
    query: async (sql) => { calls.push(sql); if (sql.startsWith("SELECT role, status")) return user ? [user] : [];
      if (sql.startsWith("SELECT role, version")) return [{ role: "admin", version }]; return []; },
  };
  return { calls, pool: { getConnection: async () => connection } };
}
const resetInput = { id, email, passwordHash: "synthetic-new-hash", secretEncrypted: "synthetic-new-encrypted-secret", recoveryDigests: Array.from({ length: 8 }, (_, i) => Buffer.alloc(32, i + 1)), now, expectedVersion: 3 };

test("transaction refuses stale versions and changed target under lock before any password or factor mutation", async () => {
  for (const options of [{ version: 4 }, { user: null }, { user: { role: "client", status: "active", email } }, { user: { role: "admin", status: "suspended", email } }, { user: { role: "admin", status: "active", email: "other@example.invalid" } }]) {
    const { pool, calls } = fakePool(options);
    await assert.rejects(createAdminRecoveryStore(pool).resetAdmin(resetInput), codeIs(options.version ? "AUTH_RECOVERY_STALE" : "AUTH_RECOVERY_TARGET"));
    assert.equal(calls.some((sql) => sql.startsWith("UPDATE ") || sql.startsWith("DELETE ") || sql.startsWith("INSERT ")), false);
    assert.ok(calls.includes("rollback"));
    assert.equal(calls.at(-1), "release");
  }
});

test("commit uncertainty is sanitized and preserves factors while release failure keeps a successful reset", async () => {
  const failed = fakePool({ failCommit: true });
  await assert.rejects(createAdminRecoveryStore(failed.pool).resetAdmin(resetInput), (error) => error.code === "AUTH_RECOVERY_UNCERTAIN" && error.preserveSetupFile === true && error.cause === undefined && !error.message.includes("private commit detail"));
  assert.ok(failed.calls.includes("rollback"));
  const released = fakePool({ failRelease: true });
  assert.deepEqual(await createAdminRecoveryStore(released.pool).resetAdmin(resetInput), { id, version: 4 });
  assert.equal(released.calls.filter((sql) => sql.startsWith("INSERT INTO admin_recovery_codes")).length, 8);
  assert.equal(released.calls.some((sql) => sql.includes("GREATEST(created_at, ?)")), true);
});
