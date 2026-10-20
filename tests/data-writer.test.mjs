import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, readFile, readdir, lstat, chmod, symlink, rename, writeFile, open, link } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDataWriter, DataWriterError } from "../server/data/writer.mjs";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../audit");
const error = (value) => value instanceof DataWriterError && value.code === "DATA_OUTPUT_UNAVAILABLE"
  && value.message === "Private data output is unavailable." && value.cause === undefined && !Object.hasOwn(value, "path");
async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 }); const root = await mkdtemp(path.join(base, "data-writer-"));
  const parent = path.join(root, "exports"), checkout = path.join(root, "checkout"), media = path.join(root, "source-media");
  for (const directory of [parent, checkout, media]) await mkdir(directory, { mode: 0o700 });
  const writers = []; t.after(async () => { for (const writer of writers) await writer.close().catch(() => {}); await rm(root, { recursive: true, force: true }); });
  const options = { output: path.join(parent, "new-export"), protectedRoots: [checkout, media] };
  return { root, parent, checkout, media, options, async writer(extra = {}) { const writer = await createDataWriter({ ...options, ...extra }); writers.push(writer); return writer; } };
}
async function absent(filename) { await assert.rejects(lstat(filename), { code: "ENOENT" }); }

test("private export files have exact modes, compact Unicode JSON and a final hash inventory without private paths", async (t) => {
  const f = await fixture(t), writer = await f.writer(), photoName = `media/${"a".repeat(32)}.jpg`, photo = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  await writer.empty("messages.jsonl"); await writer.empty("library.jsonl");
  await writer.json("account.json", { pseudonym: "Été", message: "private phrase" });
  await writer.line("messages.jsonl", { body: "Bonjour 👋" }); await writer.line("messages.jsonl", { body: "second" });
  await writer.media(photoName, photo); await absent(path.join(f.options.output, "COMPLETE.json"));
  const result = await writer.finalize({ messages: 2, mediaFiles: 1, mediaBytes: photo.length, libraryItems: 0, rows: 2, ignored: "private phrase", clientId: "private-client" });
  await writer.close(); await writer.close();
  const manifest = JSON.parse(await readFile(path.join(f.options.output, "COMPLETE.json"), "utf8"));
  assert.equal(manifest.format, "jessiemessage-private-export"); assert.equal(manifest.version, 1); assert.equal(manifest.status, "complete");
  assert.deepEqual(manifest.counts, { messages: 2, mediaFiles: 1, libraryItems: 0, mediaBytes: photo.length, rows: 2 });
  assert.doesNotMatch(JSON.stringify(manifest), /private phrase|private-client|\/workspace/);
  assert.deepEqual(Object.keys(result).sort(), ["files", "totalBytes"]); assert.equal(result.files, 5);
  let bytes = (await lstat(path.join(f.options.output, "COMPLETE.json"))).size;
  for (const entry of manifest.entries) {
    const content = await readFile(path.join(f.options.output, entry.name)); bytes += content.length;
    assert.equal(entry.bytes, content.length); assert.equal(entry.sha256, createHash("sha256").update(content).digest("hex"));
    assert.equal((await lstat(path.join(f.options.output, entry.name))).mode & 0o7777, 0o600);
  }
  assert.equal(result.totalBytes, bytes);
  assert.equal((await lstat(f.options.output)).mode & 0o7777, 0o700); assert.equal((await lstat(path.join(f.options.output, "media"))).mode & 0o7777, 0o700);
  assert.equal(await readFile(path.join(f.options.output, "account.json"), "utf8"), '{"pseudonym":"Été","message":"private phrase"}\n');
  assert.equal(await readFile(path.join(f.options.output, "messages.jsonl"), "utf8"), '{"body":"Bonjour 👋"}\n{"body":"second"}\n');
  assert.deepEqual(await readFile(path.join(f.options.output, photoName)), photo);
  assert.equal((await readdir(f.options.output)).some((name) => name.startsWith(".COMPLETE")), false);
});

test("existing output, unsafe parents and symlink ancestors are rejected without chmod or overwrite", async (t) => {
  const f = await fixture(t); await mkdir(f.options.output, { mode: 0o700 }); await writeFile(path.join(f.options.output, "untouched"), "private-existing");
  await assert.rejects(f.writer(), error); assert.equal(await readFile(path.join(f.options.output, "untouched"), "utf8"), "private-existing");
  await chmod(f.parent, 0o755); await assert.rejects(f.writer({ output: path.join(f.parent, "other") }), error); assert.equal((await lstat(f.parent)).mode & 0o777, 0o755);
  await chmod(f.parent, 0o700); const alias = path.join(f.root, "alias"); await symlink(f.parent, alias);
  await assert.rejects(f.writer({ output: path.join(alias, "via-link") }), error); await absent(path.join(f.parent, "via-link"));
  const writable = path.join(f.root, "writable"); await mkdir(writable, { mode: 0o777 }); await chmod(writable, 0o777); await mkdir(path.join(writable, "private"), { mode: 0o700 });
  await assert.rejects(f.writer({ output: path.join(writable, "private", "new") }), error);
});

test("protected roots, their descendants and ancestors cannot be export targets", async (t) => {
  const f = await fixture(t);
  for (const output of [f.checkout, path.join(f.checkout, "export"), f.media, path.join(f.media, "export"), f.root]) await assert.rejects(f.writer({ output }), error);
  for (const output of ["relative", f.options.output + "/../escape", "/", f.options.output + "\0x"]) await assert.rejects(f.writer({ output }), error);
  for (const protectedRoots of [[], ["relative"], [path.join(f.root, "missing")]]) await assert.rejects(f.writer({ protectedRoots }), error);
  await absent(path.join(f.checkout, "export")); await absent(path.join(f.media, "export"));
});

test("only the fixed filenames and correct write methods can create private files", async (t) => {
  for (const name of ["../outside", "media/../../outside", "COMPLETE.json", "secret.json", "media/" + "A".repeat(32) + ".jpg", "media/" + "a".repeat(32) + ".jpg\n"]) {
    const f = await fixture(t), writer = await f.writer();
    await assert.rejects(writer.media(name, Buffer.from("sensitive")), error); await assert.rejects(writer.finalize({}), error);
    assert.deepEqual(await readdir(f.options.output), []);
  }
  const f = await fixture(t), writer = await f.writer(); await assert.rejects(writer.json("messages.jsonl", {}), error); await absent(path.join(f.options.output, "messages.jsonl"));
});

test("JSONL appends require an exclusively created known file and serialize concurrent writes", async (t) => {
  const f = await fixture(t), writer = await f.writer(); await writer.empty("messages.jsonl");
  await Promise.all([writer.line("messages.jsonl", { row: 1 }), writer.line("messages.jsonl", { row: 2 }), writer.line("messages.jsonl", { row: 3 })]);
  assert.equal(await readFile(path.join(f.options.output, "messages.jsonl"), "utf8"), '{"row":1}\n{"row":2}\n{"row":3}\n');
  await writer.finalize({ messages: 3 }); await writer.close();
  const other = await fixture(t), unprepared = await other.writer(); await assert.rejects(unprepared.line("library.jsonl", { row: 1 }), error); await absent(path.join(other.options.output, "library.jsonl"));
});

test("exclusive files are never overwritten and any write failure prevents completion", async (t) => {
  const f = await fixture(t), writer = await f.writer(); await writer.json("account.json", { original: true });
  await assert.rejects(writer.json("account.json", { original: false }), error); await assert.rejects(writer.finalize({}), error);
  assert.equal(await readFile(path.join(f.options.output, "account.json"), "utf8"), '{"original":true}\n'); await absent(path.join(f.options.output, "COMPLETE.json"));
});

test("preexisting symlinks and hard links cannot be used as output files", async (t) => {
  for (const kind of ["symbolic", "hard"]) {
    const f = await fixture(t), writer = await f.writer(), outside = path.join(f.root, "outside-private"); await writeFile(outside, "keep", { mode: 0o600 });
    if (kind === "symbolic") await symlink(outside, path.join(f.options.output, "account.json")); else await link(outside, path.join(f.options.output, "account.json"));
    await assert.rejects(writer.json("account.json", { overwrite: true }), error); assert.equal(await readFile(outside, "utf8"), "keep");
    await assert.rejects(writer.finalize({}), error); await absent(path.join(f.options.output, "COMPLETE.json"));
  }
});

test("root and media directory replacements fail before writing into their replacements", async (t) => {
  for (const part of ["root", "media"]) {
    const f = await fixture(t), writer = await f.writer(); await writer.media(`media/${"b".repeat(32)}.jpg`, Buffer.from("photo"));
    const target = part === "root" ? f.options.output : path.join(f.options.output, "media"), previous = target + "-previous";
    await rename(target, previous); await mkdir(target, { mode: 0o700 });
    await assert.rejects(writer.media(`media/${"c".repeat(32)}.jpg`, Buffer.from("new-private-photo")), error);
    assert.deepEqual(await readdir(target), []); await assert.rejects(writer.finalize({}), error); await absent(path.join(f.options.output, "COMPLETE.json"));
    assert.equal(await readFile(path.join(previous, part === "root" ? `media/${"b".repeat(32)}.jpg` : `${"b".repeat(32)}.jpg`), "utf8"), "photo");
  }
});

test("JSONL file replacement and same-inode content tampering are detected before completion", async (t) => {
  for (const changed of ["replace", "rewrite"]) {
    const f = await fixture(t), writer = await f.writer(); await writer.empty("messages.jsonl"); await writer.line("messages.jsonl", { a: 1 });
    const file = path.join(f.options.output, "messages.jsonl");
    if (changed === "replace") { await rename(file, file + ".old"); await writeFile(file, '{"a":1}\n', { mode: 0o600 }); await assert.rejects(writer.line("messages.jsonl", { a: 2 }), error); }
    else await writeFile(file, '{"b":2}\n', { mode: 0o600 });
    await assert.rejects(writer.finalize({ messages: 1 }), error); await absent(path.join(f.options.output, "COMPLETE.json"));
  }
});

test("byte and file caps apply before writes and include the completion manifest", async (t) => {
  const f = await fixture(t), writer = await f.writer({ maximumBytes: 8 });
  await writer.json("account.json", {}); await assert.rejects(writer.media(`media/${"d".repeat(32)}.jpg`, Buffer.alloc(6)), error);
  await absent(path.join(f.options.output, `media/${"d".repeat(32)}.jpg`)); await assert.rejects(writer.finalize({}), error); await absent(path.join(f.options.output, "COMPLETE.json"));
  const limited = await fixture(t), two = await limited.writer({ maximumFiles: 1 }); await two.json("policy.json", {});
  await assert.rejects(two.empty("messages.jsonl"), error); await absent(path.join(limited.options.output, "messages.jsonl"));
  const marker = await fixture(t), tooSmall = await marker.writer({ maximumBytes: 4 }); await tooSmall.json("inventory.json", {});
  await assert.rejects(tooSmall.finalize({}), error); await absent(path.join(marker.options.output, "COMPLETE.json"));
  const fileCap = await fixture(t), noMarkerRoom = await fileCap.writer({ maximumFiles: 1 }); await noMarkerRoom.json("policy.json", {});
  await assert.rejects(noMarkerRoom.finalize({}), error); await absent(path.join(fileCap.options.output, "COMPLETE.json"));
});

test("invalid JSON values never execute getters, toJSON or retain a success marker", async (t) => {
  let executed = 0;
  const accessor = {}; Object.defineProperty(accessor, "secret", { enumerable: true, get() { executed += 1; return "private"; } });
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [accessor, { toJSON() { executed += 1; return {}; } }, cyclic, { value: NaN }, { value: 1n }, { value: "\ud800" }, [1, 2]]) {
    const f = await fixture(t), writer = await f.writer(); await assert.rejects(writer.json("account.json", value), error);
    await absent(path.join(f.options.output, "account.json")); await assert.rejects(writer.finalize({}), error);
  }
  assert.equal(executed, 0);
});

test("final summary ignores private extras but rejects malformed whitelisted counts", async (t) => {
  for (const value of [-1, 1.5, "2", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const f = await fixture(t), writer = await f.writer(); await assert.rejects(writer.finalize({ rows: value, clientId: "secret" }), error); await absent(path.join(f.options.output, "COMPLETE.json"));
  }
  const f = await fixture(t), writer = await f.writer(); await writer.json("inventory.json", {}); await writer.finalize({ inventoryCategories: 30 });
  assert.deepEqual(JSON.parse(await readFile(path.join(f.options.output, "COMPLETE.json"), "utf8")).counts, { inventoryCategories: 30 });
});

test("closing an incomplete writer is idempotent and blocks queued or future completion", async (t) => {
  const f = await fixture(t), writer = await f.writer(); await writer.empty("messages.jsonl"); await writer.line("messages.jsonl", { private: "kept-incomplete" });
  const close = writer.close(); assert.equal(writer.close(), close); await close;
  await assert.rejects(writer.finalize({}), error); await assert.rejects(writer.line("messages.jsonl", {}), error);
  await absent(path.join(f.options.output, "COMPLETE.json")); assert.match(await readFile(path.join(f.options.output, "messages.jsonl"), "utf8"), /kept-incomplete/);
});

test("a directory fsync failure after marker publication removes only the writer's marker", async (t) => {
  const f = await fixture(t), writer = await f.writer(); await writer.json("account.json", { untouched: true });
  const probe = await open(path.join(f.root, "probe"), "w", 0o600), prototype = Object.getPrototypeOf(probe), original = prototype.sync; await probe.close();
  let injected = false;
  prototype.sync = async function () {
    const stats = await this.stat();
    if (stats.isDirectory() && !injected) { try { await lstat(path.join(f.options.output, "COMPLETE.json")); injected = true; throw new Error("private-fsync-error"); } catch (error) { if (error.message === "private-fsync-error") throw error; } }
    return original.call(this);
  };
  try { await assert.rejects(writer.finalize({}), error); } finally { prototype.sync = original; }
  assert.equal(injected, true); await absent(path.join(f.options.output, "COMPLETE.json"));
  assert.equal(await readFile(path.join(f.options.output, "account.json"), "utf8"), '{"untouched":true}\n');
  assert.equal((await readdir(f.options.output)).some((name) => name.startsWith(".COMPLETE")), false);
});

test("file close before publication and directory close after publication cannot leave a completion marker on failure", async (t) => {
  for (const stage of ["file", "directory"]) {
    const f = await fixture(t), original = fs.promises.open; let injected = false, writer;
    fs.promises.open = async (...args) => {
      const handle = await original(...args), close = handle.close.bind(handle), filename = args[0];
      handle.close = async () => {
        if (!injected && stage === "file" && typeof filename === "string" && path.basename(filename).startsWith(".COMPLETE")) { injected = true; throw new Error("private-close-error"); }
        if (!injected && stage === "directory" && filename === f.options.output) {
          try { await lstat(path.join(f.options.output, "COMPLETE.json")); injected = true; throw new Error("private-close-error"); } catch (error) { if (error.message === "private-close-error") throw error; }
        }
        return close();
      };
      return handle;
    };
    syncBuiltinESMExports();
    try {
      writer = await f.writer(); await writer.empty("messages.jsonl"); await writer.line("messages.jsonl", { kept: true });
      await assert.rejects(writer.finalize({ messages: 1 }), error);
    } finally { fs.promises.open = original; syncBuiltinESMExports(); }
    assert.equal(injected, true); await absent(path.join(f.options.output, "COMPLETE.json"));
    assert.equal(await readFile(path.join(f.options.output, "messages.jsonl"), "utf8"), '{"kept":true}\n');
    await writer.close();
  }
});

test("close after successful finalization performs no additional file I/O that could invalidate completion", async (t) => {
  const f = await fixture(t), original = fs.promises.open; let closeCalls = 0;
  fs.promises.open = async (...args) => {
    const handle = await original(...args), close = handle.close.bind(handle);
    handle.close = async () => { closeCalls += 1; return close(); }; return handle;
  };
  syncBuiltinESMExports();
  try {
    const writer = await f.writer(); await writer.empty("library.jsonl"); await writer.finalize({ libraryItems: 0 });
    const afterCompletion = closeCalls; await writer.close(); await writer.close(); assert.equal(closeCalls, afterCompletion);
  } finally { fs.promises.open = original; syncBuiltinESMExports(); }
  assert.equal(JSON.parse(await readFile(path.join(f.options.output, "COMPLETE.json"), "utf8")).status, "complete");
});
