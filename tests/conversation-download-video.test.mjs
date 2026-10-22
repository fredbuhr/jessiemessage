import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile(new URL("../public/conversation-download.js", import.meta.url), "utf8");
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = new Map(); this.isConnected = true; this.hidden = false; }
  append(...children) { this.children.push(...children); }
  addEventListener(name, handler) { this.events.set(name, handler); }
  setAttribute() {} focus() {} remove() { this.isConnected = false; }
  showModal() { this.open = true; } close() { this.open = false; this.events.get("close")?.(); }
  click() { this.events.get("click")?.(); }
  find(className) { return this.className?.split(" ").includes(className) ? this : this.children.map(child => child.find(className)).find(Boolean); }
}
async function fixture(videos, request) {
  const body = new Element("body"), parent = new Element("nav"), calls = [], urls = [];
  const context = { id: "a".repeat(32), key: "session-one", state: {} };
  const runtime = vm.createContext({ document: { body, createElement: tag => new Element(tag) }, Blob, AbortController,
    setTimeout: () => 1, clearTimeout() {}, URL: { createObjectURL: () => { urls.push("blob:synthetic"); return urls.at(-1); }, revokeObjectURL() {} },
    JessieI18n: { text: (node, value) => { node.textContent = value; }, rawText: (node, value) => { node.textContent = value; }, forget() {} } });
  vm.runInContext(source.replace("export function createConversationDownload", "function createConversationDownload") + ";globalThis.mount=createConversationDownload", runtime);
  const mounted = runtime.mount({ parent, capability: { enabled: true, photos: true, maxBytes: videos ? 268435456 : 33554432, ...(videos ? { videos: true } : {}) },
    getContext: () => context, request: async (path, options) => { calls.push({ path, body: JSON.parse(JSON.stringify(options.body)), options }); return request ? request() : new Blob([new Uint8Array(22)]); }, onError() {} });
  mounted.update(); parent.children[0].click();
  const dialog = body.children[0], submit = dialog.find("primary"), label = dialog.find("conversation-download-videos");
  return { mounted, context, calls, urls, submit, label, dialog, async send() { submit.click(); for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); } };
}
test("client video exports expose an explicit checkbox and send includeVideos only under its capability", async () => {
  const normal = await fixture(false); assert.equal(normal.label.hidden, true); await normal.send(); assert.deepEqual(normal.calls[0].body, { includePhotos: true });
  const video = await fixture(true); assert.equal(video.label.hidden, false); assert.equal(video.label.children[0].checked, true);
  video.label.children[0].checked = false; await video.send(); assert.deepEqual(video.calls[0].body, { includePhotos: true, includeVideos: false });
  assert.equal(video.urls.length, 1);
});
test("a suspended or replaced client export cannot create a download after a late stream completes", async () => {
  let complete; const hold = new Promise(resolve => { complete = resolve; }); const f = await fixture(true, () => hold);
  f.submit.click(); f.mounted.suspend(); assert.equal(f.calls[0].options.signal.aborted, true);
  complete(new Blob([new Uint8Array(22)])); for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.urls.length, 0); assert.equal(f.dialog.open, false);
});
