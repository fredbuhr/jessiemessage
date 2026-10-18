import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, statfs, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDataWriter, DataWriterError } from "../server/data/writer.mjs";

const supported = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then((value) => value.type === 0x9fa0n, () => false);
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../audit");
const unavailable = (error) => error instanceof DataWriterError && error.code === "DATA_OUTPUT_UNAVAILABLE"
  && error.message === "Private data output is unavailable." && error.cause === undefined && !Object.hasOwn(error, "path");
async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "data-writer-dirfd-")), parent = path.join(root, "exports"), checkout = path.join(root, "checkout"), media = path.join(root, "media");
  for (const directory of [parent, checkout, media]) await mkdir(directory, { mode: 0o700 });
  await chmod(checkout, 0o755);
  const writers = [];
  t.after(async () => { for (const writer of writers) await writer.close().catch(() => {}); await rm(root, { recursive: true, force: true }); });
  const options = { output: path.join(parent, "new-export"), protectedRoots: [checkout, media], pathMode: "linux-dirfd" };
  return { root, parent, checkout, media, options, async writer(extra = {}) { const writer = await createDataWriter({ ...options, ...extra }); writers.push(writer); return writer; } };
}
async function absent(filename) { await assert.rejects(lstat(filename), { code: "ENOENT" }); }
async function hookOpen(callback, operation) {
  const original = fs.promises.open;
  fs.promises.open = async (...args) => callback(original, args); syncBuiltinESMExports();
  try { return await operation(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
}

test("dirfd data exports retain private formats, serialized appends, file hashes and completion budgets", { skip: !supported }, async (t) => {
  const f = await fixture(t), writer = await f.writer(), photo = `media/${"a".repeat(32)}.jpg`;
  await writer.empty("messages.jsonl"); await writer.json("account.json", { pseudonym: "Été" });
  await Promise.all([writer.line("messages.jsonl", { row: 1 }), writer.line("messages.jsonl", { row: 2 })]);
  await writer.media(photo, Buffer.from("private-photo"));
  const result = await writer.finalize({ messages: 2, mediaFiles: 1, ignored: "private-secret" });
  await writer.close(); await writer.close();
  const complete = JSON.parse(await readFile(path.join(f.options.output, "COMPLETE.json"), "utf8"));
  assert.equal(result.files, 4); assert.deepEqual(complete.counts, { messages: 2, mediaFiles: 1 });
  assert.doesNotMatch(JSON.stringify(complete), /private-secret|\/proc|\/workspace/);
  assert.equal(await readFile(path.join(f.options.output, "messages.jsonl"), "utf8"), '{"row":1}\n{"row":2}\n');
  for (const entry of complete.entries) {
    const bytes = await readFile(path.join(f.options.output, entry.name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    assert.equal((await lstat(path.join(f.options.output, entry.name))).mode & 0o7777, 0o600);
  }
  assert.equal((await lstat(f.options.output)).mode & 0o7777, 0o700);
});

test("dirfd writers continue only inside their anchored private parent when its public pathname is replaced", { skip: !supported }, async (t) => {
  const f = await fixture(t), writer = await f.writer(), previous = f.parent + "-original";
  await rename(f.parent, previous); await mkdir(f.parent, { mode: 0o700 });
  await writeFile(path.join(f.parent, "foreign"), "keep", { mode: 0o600 });
  await writer.json("account.json", { original: true }); await writer.finalize({}); await writer.close();
  assert.deepEqual(await readdir(f.parent), ["foreign"]); assert.equal(await readFile(path.join(f.parent, "foreign"), "utf8"), "keep");
  assert.equal(JSON.parse(await readFile(path.join(previous, "new-export", "COMPLETE.json"), "utf8")).status, "complete");
});

test("replacing an output or media directory prevents further writes into the replacement", { skip: !supported }, async (t) => {
  for (const part of ["root", "media"]) {
    const f = await fixture(t), writer = await f.writer(); await writer.media(`media/${"b".repeat(32)}.jpg`, Buffer.from("old-photo"));
    const target = part === "root" ? f.options.output : path.join(f.options.output, "media"), previous = target + "-original";
    await rename(target, previous); await mkdir(target, { mode: 0o700 }); await writeFile(path.join(target, "foreign"), "keep", { mode: 0o600 });
    await assert.rejects(writer.media(`media/${"c".repeat(32)}.jpg`, Buffer.from("new-photo")), unavailable);
    assert.deepEqual(await readdir(target), ["foreign"]); assert.equal(await readFile(path.join(target, "foreign"), "utf8"), "keep");
    await assert.rejects(writer.finalize({}), unavailable); await absent(path.join(f.options.output, "COMPLETE.json"));
  }
});

test("an output replacement between validation and file open cannot redirect private data", { skip: !supported }, async (t) => {
  const f = await fixture(t), writer = await f.writer(), previous = f.options.output + "-original"; let replaced = false;
  await hookOpen(async (original, args) => {
    if (!replaced && path.basename(String(args[0])) === "account.json") {
      replaced = true; assert.match(String(args[0]), /^\/proc\/self\/fd\/\d+\/account\.json$/);
      await rename(f.options.output, previous); await mkdir(f.options.output, { mode: 0o700 });
      await writeFile(path.join(f.options.output, "account.json"), "foreign-keep", { mode: 0o600 });
    }
    return original(...args);
  }, () => assert.rejects(writer.json("account.json", { private: true }), unavailable));
  assert.equal(replaced, true); assert.equal(await readFile(path.join(f.options.output, "account.json"), "utf8"), "foreign-keep");
  assert.equal((await readFile(path.join(previous, "account.json"))).length, 0);
  await absent(path.join(f.options.output, "COMPLETE.json")); await absent(path.join(previous, "COMPLETE.json"));
});

test("a media replacement between validation and file open cannot redirect a photo", { skip: !supported }, async (t) => {
  const f = await fixture(t), writer = await f.writer(), media = path.join(f.options.output, "media"), previous = media + "-original", name = "d".repeat(32) + ".jpg";
  await writer.media(`media/${"e".repeat(32)}.jpg`, Buffer.from("first")); let replaced = false;
  await hookOpen(async (original, args) => {
    if (!replaced && path.basename(String(args[0])) === name) {
      replaced = true; assert.match(String(args[0]), /^\/proc\/self\/fd\/\d+\/[a-f0-9]{32}\.jpg$/);
      await rename(media, previous); await mkdir(media, { mode: 0o700 }); await writeFile(path.join(media, name), "foreign-keep", { mode: 0o600 });
    }
    return original(...args);
  }, () => assert.rejects(writer.media(`media/${name}`, Buffer.from("private-photo")), unavailable));
  assert.equal(replaced, true); assert.equal(await readFile(path.join(media, name), "utf8"), "foreign-keep");
  assert.equal((await readFile(path.join(previous, name))).length, 0); await absent(path.join(f.options.output, "COMPLETE.json"));
});

test("dirfd writers retain checkout and source media exclusions while allowing a protected checkout with mode 0755", { skip: !supported }, async (t) => {
  const f = await fixture(t);
  for (const output of [f.checkout, path.join(f.checkout, "export"), f.media, path.join(f.media, "export"), f.root]) await assert.rejects(f.writer({ output }), unavailable);
  await absent(path.join(f.checkout, "export")); await absent(path.join(f.media, "export"));
  const alias = path.join(f.root, "protected-alias"); await symlink(f.checkout, alias);
  await assert.rejects(f.writer({ protectedRoots: [alias] }), unavailable);
  const writer = await f.writer(); await writer.json("policy.json", {}); await writer.finalize({});
});

test("dirfd writer file aliases, unsafe parents and unknown modes never overwrite foreign data", { skip: !supported }, async (t) => {
  for (const kind of ["symlink", "hardlink"]) {
    const f = await fixture(t), writer = await f.writer(), target = path.join(f.root, "foreign"); await writeFile(target, "keep", { mode: 0o600 });
    if (kind === "symlink") await symlink(target, path.join(f.options.output, "account.json")); else await link(target, path.join(f.options.output, "account.json"));
    await assert.rejects(writer.json("account.json", {}), unavailable); assert.equal(await readFile(target, "utf8"), "keep"); await absent(path.join(f.options.output, "COMPLETE.json"));
  }
  const f = await fixture(t); await chmod(f.parent, 0o750); await assert.rejects(f.writer(), unavailable); await chmod(f.parent, 0o700);
  const alias = path.join(f.root, "alias"); await symlink(f.parent, alias); await assert.rejects(f.writer({ output: path.join(alias, "new") }), unavailable);
  await assert.rejects(f.writer({ pathMode: "fallback" }), unavailable); await absent(f.options.output);
});

test("concurrent writer creation has one winner and releases every anchored descriptor on close", { skip: !supported }, async (t) => {
  const f = await fixture(t); let opened = 0, closed = 0;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; }; return handle;
  }, async () => {
    const results = await Promise.allSettled([f.writer(), f.writer()]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && unavailable(result.reason)).length, 1);
    const writer = results.find((result) => result.status === "fulfilled").value;
    await writer.empty("library.jsonl"); await writer.finalize({ libraryItems: 0 });
    const closing = writer.close(); assert.equal(writer.close(), closing); await closing;
  });
  assert.ok(opened > 3); assert.equal(closed, opened);
});

test("dirfd construction failures close anchored ancestors and incomplete close prevents completion", { skip: !supported }, async (t) => {
  const f = await fixture(t); await mkdir(f.options.output, { mode: 0o700 }); let opened = 0, closed = 0;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; }; return handle;
  }, () => assert.rejects(f.writer(), unavailable));
  assert.ok(opened > 0); assert.equal(closed, opened);
  const other = await fixture(t), writer = await other.writer(); await writer.empty("messages.jsonl");
  const closing = writer.close(); await assert.rejects(writer.line("messages.jsonl", {}), unavailable); await closing;
  await assert.rejects(writer.finalize({}), unavailable); await absent(path.join(other.options.output, "COMPLETE.json"));
});

test("dirfd writer budgets include completion and preserve a failed export without a success marker", { skip: !supported }, async (t) => {
  const f = await fixture(t), writer = await f.writer({ maximumBytes: 4 }); await writer.json("inventory.json", {});
  await assert.rejects(writer.finalize({}), unavailable); await absent(path.join(f.options.output, "COMPLETE.json"));
  const other = await fixture(t), limited = await other.writer({ maximumFiles: 1 }); await limited.json("policy.json", {});
  await assert.rejects(limited.empty("messages.jsonl"), unavailable); await absent(path.join(other.options.output, "messages.jsonl"));
});


test("a dirfd close failure after closing the output descriptor removes only its own completion marker", { skip: !supported }, async (t) => {
  const f = await fixture(t); let injected = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle);
    if (String(args[0]).startsWith("/proc/self/fd/") && path.basename(String(args[0])) === "new-export") {
      handle.close = async () => {
        await close();
        if (!injected) { injected = true; throw new Error("private-close-error-after-closing"); }
      };
    }
    return handle;
  }, async () => {
    const writer = await f.writer(); await writer.json("account.json", { keep: true });
    await assert.rejects(writer.finalize({}), unavailable);
    await writer.close().catch((error) => { assert.ok(unavailable(error)); });
  });
  assert.equal(injected, true); await absent(path.join(f.options.output, "COMPLETE.json"));
  assert.equal(await readFile(path.join(f.options.output, "account.json"), "utf8"), '{"keep":true}\n');
  assert.equal((await readdir(f.options.output)).some((name) => name.startsWith(".COMPLETE")), false);
});
