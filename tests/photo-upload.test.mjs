import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/photo-upload.js", import.meta.url), "utf8");
function harness() {
  const timers = new Map(); let key = 0;
  const context = vm.createContext({ DOMException, Error, Number, Promise,
    setTimeout(handler, delay) { timers.set(++key, { handler, delay }); return key; }, clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(source.replace("export async function ", "async function ") + "\nglobalThis.upload = uploadPhotoWithBackoff;", context);
  return { upload: context.upload, timers, tick() { const [id, timer] = [...timers][0] ?? []; assert.ok(timer); timers.delete(id); timer.handler(); } };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const refused = (retryAfter = 1, code = "try_again_later") => Object.assign(new Error("refused"), { status: 429, code, retryAfter });

test("only two definitive 429 admission refusals are repeated with their bounded Retry-After", async () => {
  const f = harness(); let attempts = 0;
  const task = f.upload(async () => { if (++attempts < 3) throw refused(attempts); return { id: "confirmed" }; });
  await flush(); assert.equal(attempts, 1); assert.equal([...f.timers.values()][0].delay, 1000);
  f.tick(); await flush(); assert.equal(attempts, 2); assert.equal([...f.timers.values()][0].delay, 2000);
  f.tick(); assert.deepEqual(await task, { id: "confirmed" }); assert.equal(attempts, 3); assert.equal(f.timers.size, 0);
  attempts = 0;
  const failed = f.upload(async () => { attempts++; throw refused(); }); const rejected = assert.rejects(failed, { status: 429 });
  await flush(); f.tick(); await flush(); f.tick(); await rejected;
  assert.equal(attempts, 3); assert.equal(f.timers.size, 0);
});

test("lost responses, HTTP5xx, unrelated 429 and missing or excessive delays never repeat an upload", async () => {
  for (const error of [new Error("lost response"), Object.assign(new Error("server"), { status: 503, code: "media_busy", retryAfter: 1 }),
    Object.assign(refused(), { retryAfter: undefined }), refused(0), refused(61), refused(1.5), refused("1"), refused(1, "unknown")]) {
    if (error.retryAfter === undefined) delete error.retryAfter;
    const f = harness(); let attempts = 0;
    await assert.rejects(f.upload(async () => { attempts++; throw error; }), value => value === error);
    assert.equal(attempts, 1); assert.equal(f.timers.size, 0);
  }
});

test("hiding or replacing the session during admission backoff cancels before the next POST", async () => {
  const f = harness(), controller = new AbortController(); let attempts = 0;
  const task = f.upload(async () => { attempts++; throw refused(); }, { signal: controller.signal });
  const rejected = assert.rejects(task, { name: "AbortError" }); await flush(); controller.abort(); await rejected;
  assert.equal(attempts, 1); assert.equal(f.timers.size, 0);
  let current = true;
  const stale = f.upload(async () => { attempts++; throw refused(); }, { current: () => current });
  const staleRejected = assert.rejects(stale, value => value.stale === true); await flush(); current = false; f.tick(); await staleRejected;
  assert.equal(attempts, 2); assert.equal(f.timers.size, 0);
});
