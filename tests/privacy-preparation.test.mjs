import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, statfs, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DECISIONS, validateDraft } from "../server/privacy/draft.mjs";
import { createPrivacyFiles } from "../server/privacy/files.mjs";
import { createPrivacyService } from "../server/privacy/service.mjs";

const key = Buffer.alloc(32, 7), NAME = "privacy-preparation.json";
const draft = () => ({ answers: Object.fromEntries(DECISIONS.map(id => [id, ""])), notice: { fr: "Brouillon synthétique", en: "Synthetic draft" } });
const prepared = () => ({ updatedAt: 1792350000000, draft: draft() });
// Exercise real file operations locally; production descriptor anchoring has a
// separate mandatory Linux CI case below, since scratch may not expose procfs.
async function withDirectory(directory, work) {
  const before = await lstat(directory, { bigint: true });
  const scope = { file: name => path.join(directory, name), async assertReady() { const after = await lstat(directory, { bigint: true }); assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(after.mode & 0o7777n, 0o700n); },
    async sync() { const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY); try { await handle.sync(); } finally { await handle.close(); } } };
  const result = await work(scope); await scope.assertReady(); return result;
}
async function fixture(t, real = false) {
  const base = path.resolve("../audit"); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(base, "privacy-preparation-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = createPrivacyFiles(directory, key, real ? {} : { withDirectory }); t.after(() => files.close());
  return { directory, files };
}
test("the preparation accepts partial answers, closed fields and bounded well-formed text only", () => {
  assert.deepEqual(validateDraft(draft()), draft());
  for (const change of [v => v.answers.D01 = "x".repeat(1025), v => v.answers.D01 = "\ud800", v => v.answers.D01 = "bad\0text", v => delete v.answers.D08,
    v => v.answers.extra = "hidden", v => v.notice.fr = "x".repeat(12289), v => v.notice.extra = "hidden", v => v.publish = true]) {
    const value = draft(); change(value); assert.throws(() => validateDraft(value), { code: "input" });
  }
  const large = draft(); large.notice.fr = "界".repeat(12288); large.notice.en = "界".repeat(12288);
  assert.throws(() => validateDraft(large), { code: "input" });
});
test("the default notice is current, bilingual, private and does not invent completed decisions", async t => {
  const f = await fixture(t), service = await createPrivacyService({ directory: f.directory, key }, { files: f.files }), value = await service.read();
  assert.equal(value.revision, 0); assert.equal(value.updatedAt, null); assert.deepEqual(value.answered, ["D01", "D04"]);
  assert.match(value.draft.answers.D01, /Jessie, en France/);
  assert.match(value.draft.answers.D04, /fermeture définitive/);
  assert.deepEqual(value.confirmed, { version: 1, responsibleName: "Jessie", countryCode: "FR", organization: null, space: "private_invitation", conversationRetention: "until_permanent_account_closure", permanentClosure: "not_implemented" });
  assert.equal(value.publication, "draft_only"); assert.equal(value.retention, "not_enabled");
  assert.match(value.draft.notice.fr, /notes, classement et rappels/); assert.match(value.draft.notice.en, /notes, categorisation and reminders/);
  assert.match(value.draft.notice.fr, /Télécharger ma conversation/); assert.match(value.draft.notice.en, /Download my conversation/);
  assert.match(value.draft.notice.fr, /À COMPLÉTER D03/); assert.match(value.draft.notice.en, /TO COMPLETE D03/);
  assert.deepEqual(await readdir(f.directory), [], "read does not create a config file");
});
test("save encrypts identities and texts, reloads durably and leaves only a private ciphertext file", async t => {
  const f = await fixture(t), value = prepared(); value.draft.answers.D01 = "Private synthetic identity";
  assert.equal(await f.files.save(value, 0, async () => {}), 1);
  assert.deepEqual(await f.files.read(), { revision: 1, prepared: value });
  const bytes = await readFile(path.join(f.directory, NAME), "utf8");
  assert.equal(bytes.includes("Private synthetic identity"), false); assert.equal(bytes.includes("Synthetic draft"), false);
  assert.equal((await lstat(path.join(f.directory, NAME))).mode & 0o7777, 0o600); assert.deepEqual(await readdir(f.directory), [NAME]);
  const reopened = createPrivacyFiles(f.directory, key, { withDirectory }); t.after(() => reopened.close());
  assert.deepEqual(await reopened.read(), { revision: 1, prepared: value });
  const second = await f.files.save({ ...value, draft: { ...value.draft, notice: { fr: "Nouvelle version", en: "New version" } } }, 1, async () => {});
  assert.equal(second, 2); assert.equal((await f.files.read()).prepared.draft.notice.fr, "Nouvelle version");
});
test("stale revisions, competing writers and stale locks cannot lose an acknowledged draft", async t => {
  const f = await fixture(t), value = prepared();
  const results = await Promise.allSettled([f.files.save(value, 0, async () => {}), f.files.save(value, 0, async () => {})]);
  assert.equal(results.filter(v => v.status === "fulfilled").length, 1); assert.equal((await f.files.read()).revision, 1);
  await assert.rejects(f.files.save(value, 0, async () => {}), { code: "changed" });
  await writeFile(path.join(f.directory, "privacy-preparation.lock"), "existing-owner", { flag: "wx", mode: 0o600 });
  await assert.rejects(f.files.save(value, 1, async () => {}), { code: "busy" });
  assert.equal(await readFile(path.join(f.directory, "privacy-preparation.lock"), "utf8"), "existing-owner");
});
test("a revoked authorization immediately before rename preserves the previous draft and cleans temporary ciphertext", async t => {
  const f = await fixture(t); await f.files.save(prepared(), 0, async () => {}); const previous = await readFile(path.join(f.directory, NAME));
  await assert.rejects(f.files.save(prepared(), 1, async () => { throw Object.assign(new Error("refused"), { httpStatus: 401 }); }), { httpStatus: 401 });
  assert.deepEqual(await readFile(path.join(f.directory, NAME)), previous); assert.deepEqual(await readdir(f.directory), [NAME]);
});
test("wrong key, modified revision and corrupted authentication tag never expose plaintext or replace the draft", async t => {
  const f = await fixture(t); await f.files.save(prepared(), 0, async () => {}); const original = await readFile(path.join(f.directory, NAME), "utf8");
  const wrong = createPrivacyFiles(f.directory, Buffer.alloc(32, 8), { withDirectory }); t.after(() => wrong.close());
  await assert.rejects(wrong.read(), { code: "unavailable" });
  await assert.rejects(wrong.save(prepared(), 1, async () => {}), { code: "unavailable" });
  assert.equal(await readFile(path.join(f.directory, NAME), "utf8"), original);
  for (const alter of [v => v.revision++, v => v.envelope.tag = Buffer.alloc(16).toString("base64url")]) {
    const value = JSON.parse(original); alter(value); await writeFile(path.join(f.directory, NAME), `${JSON.stringify(value)}\n`);
    await assert.rejects(f.files.read(), { code: "unavailable" });
  }
  f.files.close(); await assert.rejects(f.files.read(), { code: "unavailable" }); await assert.rejects(f.files.save(prepared(), 2, async () => {}), { code: "unavailable" });
});
test("linked, nonprivate, multi-linked and nonregular state entries are rejected", async t => {
  for (const defect of ["symlink", "hardlink", "mode", "directory"]) {
    const f = await fixture(t); await f.files.save(prepared(), 0, async () => {}); const name = path.join(f.directory, NAME);
    if (defect === "symlink") { await writeFile(path.join(f.directory, "outside"), await readFile(name), { mode: 0o600 }); await rm(name); await symlink("outside", name); }
    if (defect === "hardlink") await link(name, path.join(f.directory, "alias"));
    if (defect === "mode") await chmod(name, 0o640);
    if (defect === "directory") { await rm(name); await mkdir(name, { mode: 0o700 }); }
    await assert.rejects(f.files.read()); await assert.rejects(f.files.save(prepared(), 1, async () => {}));
    assert.equal((await readdir(f.directory)).includes("privacy-preparation.lock"), false);
  }
});
test("canonical JSON rejects duplicate aliases, hidden fields, malformed bytes and oversized files", async t => {
  for (const raw of ['{"version":1,"revision":0,"envelope":null,"revision":0}\n', '{"version":1,"revision":0,"envelope":null,"secret":true}\n', Buffer.from([0xff]), " ".repeat(65537)]) {
    const f = await fixture(t); await writeFile(path.join(f.directory, NAME), raw, { mode: 0o600 }); await assert.rejects(f.files.read());
  }
});
test("all answers filled still mean draft preparation, never legal validation, publication or an active purge", async t => {
  const f = await fixture(t), service = await createPrivacyService({ directory: f.directory, key, clock: () => 1792350000000 }, { files: f.files }), value = draft();
  for (const id of DECISIONS) value.answers[id] = `Synthetic answer ${id}`;
  const saved = await service.save({ revision: 0, draft: value }, async () => {});
  assert.equal(saved.revision, 1); assert.deepEqual(saved.answered, DECISIONS); assert.equal(saved.publication, "draft_only"); assert.equal(saved.retention, "not_enabled");
  const loaded = await service.read(); assert.deepEqual(loaded, saved);
  await assert.rejects(service.save({ revision: 1, draft: value, publish: true }, async () => {}), { code: "input" });
});
test("existing private drafts are preserved while confirmed product choices stay separate from editable preparation", async t => {
  const f = await fixture(t), existing = prepared(); existing.draft.answers.D01 = "Older private operator note"; existing.draft.answers.D04 = "Older private retention note";
  await f.files.save(existing, 0, async () => {});
  const service = await createPrivacyService({ directory: f.directory, key }, { files: f.files }), state = await service.read();
  assert.deepEqual(state.draft, existing.draft); assert.equal(state.revision, 1);
  assert.equal(state.confirmed.responsibleName, "Jessie"); assert.equal(state.confirmed.organization, null); assert.equal(state.confirmed.countryCode, "FR");
  assert.equal(state.confirmed.conversationRetention, "until_permanent_account_closure"); assert.equal(state.confirmed.permanentClosure, "not_implemented");
  state.confirmed.responsibleName = "Client-side alteration";
  assert.equal((await service.read()).confirmed.responsibleName, "Jessie");
  await assert.rejects(service.save({ revision: 1, draft: state.draft, confirmed: state.confirmed }, async () => {}), { code: "input" });
});
let unavailable;
try { if (process.platform !== "linux" || (await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) unavailable = "Linux procfs unavailable"; } catch { unavailable = "Linux procfs unavailable"; }
test("Linux CI must exercise the real privacy directory anchor", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(unavailable, undefined));
test("production anchored directory can encrypt and reload preparation without a test path bypass", { skip: unavailable }, async t => {
  const f = await fixture(t, true); await f.files.save(prepared(), 0, async () => {}); assert.deepEqual((await f.files.read()).prepared, prepared());
});
