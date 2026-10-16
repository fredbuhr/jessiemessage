import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { parseArguments, run } from "../scripts/update-runtime-smtp.mjs";

const key = (byte) => Buffer.alloc(32, byte).toString("base64url");
const origin = "https://recette.jessiemessage.com";
const current = () => ({ format: "jessiemessage-runtime-messaging", version: 1, origin,
  mailKey: key(2), messageKey: key(3), smtpHost: "smtp.example.invalid", smtpPort: "587",
  smtpUser: "synthetic-user", smtpPassword: "synthetic-old-password" });
const bundle = () => ({ messaging: current(),
  database: { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
    database: "ONLY_RECIPE", user: "fixture_runtime", password: "synthetic-db-password", privilegeProfile: "infomaniak-shared-pattern" },
  authentication: { format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) } });
const options = { command: "update", privateDirectory: "/operator/private", privatePathMode: "linux-dirfd" };
const args = (command = "update") => [command, "--private-directory", options.privateDirectory, "--private-path-mode", options.privatePathMode];
const password = " Synthetic new 'quoted' $() é ";
const codeIs = (code) => (error) => error.code === code;
function fixture() {
  const seen = { steps: [], env: null, source: bundle() };
  const dependencies = { inheritedEnv: { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, execArgv: [],
    inputStream: Readable.from([password]), readBundle: async () => seen.source,
    verify: async (env) => {
      seen.steps.push("verify"); seen.env = env;
      assert.equal(env.JESSIEMESSAGE_SMTP_PASSWORD, password);
      assert.equal(env.JESSIEMESSAGE_SMTP_USER, current().smtpUser);
      assert.equal(env.JESSIEMESSAGE_MAIL_KEY, current().mailKey);
      return true;
    },
    replacePassword: async (directory, expected, next) => {
      seen.steps.push("replace"); assert.equal(directory, options.privateDirectory);
      assert.deepEqual(expected, current()); assert.equal(next, password);
      return { saved: true, keysPreserved: true };
    } };
  return { seen, dependencies };
}

test("SMTP update accepts only a confirmed private path; password/host/user/key flags are refused", () => {
  assert.deepEqual(parseArguments(args()), options);
  for (const value of [["prepare", ...args().slice(1)], [...args(), "--password", password],
    [...args(), "--smtp-host", "other.invalid"], [...args(), "--smtp-user", "other"], [...args(), "--mail-key", key(9)]]) {
    assert.throws(() => parseArguments(value), codeIs("RUNTIME_SMTP_UPDATE_USAGE"));
  }
});

test("SMTP check is passive, does not consume stdin and does not replace the configuration", async () => {
  const { seen, dependencies } = fixture(); dependencies.readSecret = async () => assert.fail("must not read a password");
  assert.deepEqual(await run({ ...options, command: "check" }, dependencies), { status: "ready_for_input", keysPreserved: true,
    messagingConfigSaved: false, smtpAuthenticated: false, launchApproved: false });
  assert.deepEqual(seen.steps, []);
});

test("SMTP password is verified before guarded replacement, preserves keys and emits only a fixed receipt", async () => {
  const { seen, dependencies } = fixture(); const result = await run(options, dependencies);
  assert.deepEqual(seen.steps, ["verify", "replace"]);
  assert.deepEqual(result, { status: "updated", keysPreserved: true, messagingConfigSaved: true, smtpAuthenticated: true, launchApproved: false });
  assert.equal(seen.env.JESSIEMESSAGE_SMTP_PASSWORD, "");
  assert.equal(seen.env.JESSIEMESSAGE_MFA_KEY, "");
  for (const value of [password, current().smtpUser, current().mailKey, current().messageKey, current().smtpHost]) {
    assert.equal(JSON.stringify(result).includes(value), false);
  }
  assert.deepEqual(seen.source, bundle(), "an injected source record remains owned by its caller");
});

test("refused SMTP credentials and verification/close failures do not replace or retry", async () => {
  for (const outcome of [false, "throw"]) {
    const { seen, dependencies } = fixture();
    dependencies.verify = async (env) => { seen.steps.push("verify"); seen.env = env;
      if (outcome === "throw") throw new Error(password); return outcome; };
    await assert.rejects(run(options, dependencies), codeIs("RUNTIME_SMTP_UPDATE_VERIFY"));
    assert.deepEqual(seen.steps, ["verify"]);
    assert.equal(seen.env.JESSIEMESSAGE_SMTP_PASSWORD, "");
  }
});

test("stale or uncertain publication fails without reporting updated and clears in-memory secrets", async () => {
  const { seen, dependencies } = fixture();
  dependencies.replacePassword = async () => { seen.steps.push("replace"); throw new Error(password); };
  await assert.rejects(run(options, dependencies), codeIs("RUNTIME_SMTP_UPDATE_SAVE"));
  assert.deepEqual(seen.steps, ["verify", "replace"]); assert.equal(seen.env.JESSIEMESSAGE_SMTP_PASSWORD, "");
});

test("invalid input, process overrides and a missing bundle fail before SMTP or replacement", async () => {
  for (const input of ["", "a\nb", "a\0b", "x".repeat(4097), Buffer.from([255])]) {
    const { seen, dependencies } = fixture(); dependencies.inputStream = Readable.from([input]);
    await assert.rejects(run(options, dependencies), codeIs("RUNTIME_SMTP_UPDATE_INPUT")); assert.deepEqual(seen.steps, []);
  }
  const ambient = fixture(); ambient.dependencies.inheritedEnv.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  await assert.rejects(run(options, ambient.dependencies), codeIs("RUNTIME_SMTP_UPDATE_ENVIRONMENT"));
  const missing = fixture(); missing.dependencies.readBundle = async () => null;
  await assert.rejects(run(options, missing.dependencies), codeIs("RUNTIME_SMTP_UPDATE_CONFIGURATION"));
});

test("SMTP capture refuses noninteractive input without echoing it; CLI refuses secret arguments", () => {
  const capture = spawnSync("bash", ["scripts/capture-smtp-update.sh", ...args().slice(1)], { input: password, encoding: "utf8", timeout: 5000 });
  assert.equal(capture.status, 2); assert.equal(capture.stdout, ""); assert.match(capture.stderr, /^SMTP_UPDATE_TTY:/);
  const cli = spawnSync(process.execPath, ["scripts/update-runtime-smtp.mjs", ...args(), "--password", password], { input: password, encoding: "utf8", timeout: 5000 });
  assert.equal(cli.status, 1); assert.equal(cli.stdout, ""); assert.match(cli.stderr, /^RUNTIME_SMTP_UPDATE_USAGE:/);
  assert.equal(`${capture.stderr}${cli.stderr}`.includes(password), false);
});
