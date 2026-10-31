import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as model from "../public/media-library-model.js";
const root = new URL("../public/", import.meta.url);
const files = Object.fromEntries(await Promise.all(["media-library-page.html", "media-library-page.js", "i18n.js", "i18n-tools.js", "i18n-media-library.js"].map(async name => [name, await readFile(new URL(name, root), "utf8")])));
const flush = async () => { for (let n = 0; n < 35; n++) await new Promise(resolve => setImmediate(resolve)); };
const id = number => number.toString(16).padStart(32, "0");
const photo = number => ({ id: id(number), width: 1200, height: 800, thumbnailWidth: 480, thumbnailHeight: 320, bytes: 90000, thumbnailBytes: 7000, createdAt: 1793470438000, sharedHere: false, fullUrl: `/api/media/admin/assets/${id(number)}/full`, thumbnailUrl: `/api/media/admin/assets/${id(number)}/thumb` });
const video = number => ({ id: id(number), bytes: 500000, mime: "video/mp4", createdAt: 1793470438000, cleanupPending: false, contentUrl: `/api/video/admin/assets/${id(number)}/content` });
class Element {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attributes = new Map(); this.events = new Map(); this.dataset = {}; this.value = ""; this.hidden = false; this.disabled = false; this._text = ""; this.className = ""; this.classList = { toggle() {} }; }
  get isConnected() { return !!this.root || !!this.parentElement?.isConnected; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); if (name === "src") this.src = ""; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ""; this.append(...children); }
  matches(selector) { if (selector.startsWith("[")) return this.getAttribute(selector.slice(1, -1)) !== null; return this.tagName.toLowerCase() === selector.toLowerCase(); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(selector.split(",").some(part => child.matches(part.trim())) ? [child] : []), ...child.querySelectorAll(selector)]); }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
  async trigger(name) { for (const callback of this.events.get(name) ?? []) callback({ preventDefault() {} }); await flush(); }
  showModal() { this.open = true; } close() { this.open = false; } focus() {} scrollIntoView() {} pause() { this.paused = true; } load() {}
}
function parse(html) {
  const root = new Element("root"); root.root = true; const stack = [root], ids = new Map(), voids = new Set(["meta", "link", "input", "img", "br"]);
  for (const match of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const value = match[0]; if (value.startsWith("<!")) continue;
    if (value.startsWith("</")) { stack.pop(); continue; }
    if (!value.startsWith("<")) { stack.at(-1)._text += value; continue; }
    const tag = /^<([a-z0-9-]+)/i.exec(value)?.[1]; if (!tag) continue;
    const element = new Element(tag); for (const attr of value.matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)(?:="([^"]*)")?/g)) if (attr[1] !== tag) element.setAttribute(attr[1], attr[2] ?? "");
    if (element.getAttribute("id")) ids.set(element.getAttribute("id"), element);
    stack.at(-1).append(element); if (!voids.has(tag)) stack.push(element);
  } return { root, ids };
}
function response(status, body, { binary = false } = {}) { return { ok: status >= 200 && status < 300, status, headers: { get: name => name === "content-type" ? binary ? "image/jpeg" : "application/json" : name === "content-length" && binary ? "3" : null }, json: async () => body, blob: async () => new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }) }; }
function harness({ respond, prepare = async file => file } = {}) {
  const parsed = parse(files["media-library-page.html"]), documentEvents = new Map(), windowEvents = new Map(), calls = [], created = [], revoked = [], timers = new Map(); let timer = 0, owner = 1;
  const session = () => ({ user: { id: id(owner), role: "admin", pseudonym: "Synthetic Jessie" }, csrf: (owner === 1 ? "a" : "b").repeat(43), expiresAt: Date.now() + 3600000 });
  const rows = Array.from({ length: 45 }, (_, i) => photo(i + 1));
  const document = { visibilityState: "hidden", documentElement: parsed.root.querySelectorAll("html")[0], body: parsed.root.querySelectorAll("body")[0], getElementById: name => parsed.ids.get(name), createElement: tag => new Element(tag), querySelectorAll: selector => parsed.root.querySelectorAll(selector), addEventListener: (name, callback) => documentEvents.set(name, callback) };
  const context = vm.createContext({ document, window: { addEventListener(name, callback) { if (!windowEvents.has(name)) windowEvents.set(name, []); windowEvents.get(name).push(callback); } }, navigator: { language: "fr-FR" }, sessionStorage: { getItem() { return null; }, setItem() {} }, location: { replace(value) { context.redirect = value; } }, Blob, AbortController, URL: { createObjectURL(blob) { const value = "blob:synthetic-" + created.length; created.push({ value, blob }); return value; }, revokeObjectURL(value) { revoked.push(value); } }, console,
    __model: model, __prepare: prepare, JessieSessionClock: { scheduleSessionCheck() { return () => {}; } },
    setTimeout(callback, delay) { timers.set(++timer, { callback, delay }); return timer; }, clearTimeout(value) { timers.delete(value); },
    fetch: async (path, options = {}) => {
      calls.push({ path, options }); const custom = await respond?.(path, options, { session, rows, owner, response }); if (custom) return custom;
      if (path === "/api/auth/session") return response(200, session());
      if (path === "/api/media/admin/capabilities") return response(200, { enabled: true });
      if (path === "/api/chat/admin/capabilities") return response(200, { enabled: true, video: { enabled: true } });
      if (path.startsWith("/api/media/admin/assets?")) { const after = /afterId=([a-f0-9]+)/.exec(path)?.[1] ?? "", rest = owner === 1 ? rows.filter(row => row.id > after) : [], page = rest.slice(0, 20); return response(200, { assets: page, hasMore: rest.length > 20, nextCursor: rest.length > 20 ? page.at(-1).id : null }); }
      if (path.startsWith("/api/video/admin/assets?")) return response(200, { assets: [video(80)], hasMore: false, nextCursor: null });
      if (/\/api\/media\/admin\/assets\/[a-f0-9]+\/(?:thumb|full)$/.test(path)) return response(200, null, { binary: true });
      throw new Error("Unexpected synthetic request " + path);
    } });
  vm.runInContext(files["i18n.js"], context); vm.runInContext(files["i18n-tools.js"], context); vm.runInContext(files["i18n-media-library.js"], context);
  const source = files["media-library-page.js"].replace(/^import \{ prepareImageUpload \} from "\/image-preparation.js";/, "const prepareImageUpload = __prepare;").replace(/^import \{([^\n]+)\} from "\/media-library-model.js";/m, "const {$1} = __model;");
  vm.runInContext(source + "\nglobalThis.tools = {state, bootstrap, loadList, selectAsset, addPhoto, deleteSelected, clearPrivate, controls};", context);
  return { ...parsed, document, context, calls, created, revoked, session, rows, setOwner(value) { owner = value; },
    async start() { document.visibilityState = "visible"; await context.tools.bootstrap(); await flush(); },
    async hide() { document.visibilityState = "hidden"; documentEvents.get("visibilitychange")(); await flush(); },
    async show() { document.visibilityState = "visible"; documentEvents.get("visibilitychange")(); await flush(); },
    async pageHide() { for (const callback of windowEvents.get("pagehide") ?? []) callback({ persisted: true }); await flush(); },
    async pageShow() { for (const callback of windowEvents.get("pageshow") ?? []) callback({ persisted: true }); await flush(); },
    async language(value) { vm.runInContext(`JessieI18n.setLanguage(${JSON.stringify(value)})`, context); await flush(); } };
}
test("media library starts only after a valid admin session and clears on refusal", async () => {
  const h = harness({ respond: path => path === "/api/auth/session" ? response(401, { error: "authentication_required" }) : null }); await h.start();
  assert.equal(h.context.redirect, "/admin/login?continue=%2Fadmin%2Fmedia"); assert.equal(h.ids.get("library-content").hidden, true); assert.equal(h.ids.get("media-grid").children.length, 0); assert.equal(h.created.length, 0);
});
test("library renders real private thumbnails, replaces pages20 and keeps a selected detail independently", async () => {
  const h = harness(); await h.start(); assert.equal(h.context.tools.state.rows.length, 20); assert.equal(h.ids.get("media-grid").children.length, 20);
  assert.equal(h.ids.get("media-grid").querySelectorAll("img").length, 20); assert.equal(h.created.length, 20);
  await h.context.tools.selectAsset(h.context.tools.state.rows[0]); await flush(); assert.equal(h.ids.get("media-preview").querySelectorAll("img").length, 1);
  const selected = h.context.tools.state.selected; await h.context.tools.loadList("next"); await flush();
  assert.equal(h.context.tools.state.rows.length, 20); assert.equal(h.context.tools.state.rows[0].id, id(21)); assert.equal(h.context.tools.state.selected, selected); assert.equal(h.context.tools.state.back.length, 1); assert.ok(h.revoked.length >= 20);
  await h.context.tools.loadList("previous"); await flush(); assert.equal(h.context.tools.state.rows[0].id, id(1));
});
test("library video list loads only the selected owned video and clears its player when hidden", async () => {
  const h = harness(); await h.start(); await h.ids.get("show-videos").trigger("click"); assert.equal(h.context.tools.state.kind, "videos"); assert.equal(h.ids.get("media-preview").querySelectorAll("video").length, 0);
  await h.context.tools.selectAsset(h.context.tools.state.rows[0]); const player = h.ids.get("media-preview").querySelectorAll("video")[0]; assert.equal(player.src, video(80).contentUrl); assert.equal(player.controls, true);
  await h.hide(); assert.equal(player.src, ""); assert.equal(player.paused, true); assert.equal(h.ids.get("media-grid").children.length, 0); assert.equal(h.ids.get("library-content").hidden, true);
});
test("photo upload goes to owned media only, pins its preview even outside first page and never sends a message", async () => {
  let prepared = 0;
  const h = harness({ prepare: async (file, options) => { prepared++; assert.ok(options.signal); return file; }, respond: (path, options) => path === "/api/media/admin/assets" && options.method === "POST" ? response(201, { asset: photo(99), duplicate: false }) : null }); await h.start();
  h.ids.get("photo-file").files = [new Blob(["photo"], { type: "image/jpeg" })]; await h.context.tools.addPhoto(); await flush();
  assert.equal(prepared, 1); assert.equal(h.context.tools.state.selected.id, id(99)); assert.equal(h.context.tools.state.rows.length, 20);
  const posts = h.calls.filter(call => call.options.method === "POST"); assert.equal(posts.length, 1); assert.equal(posts[0].path, "/api/media/admin/assets"); assert.equal(posts[0].options.headers["X-CSRF-Token"], "a".repeat(43)); assert.equal(h.ids.get("library-status").textContent, "Photo ajoutée à ta bibliothèque.");
});
test("deletion requires explicit confirmation and reports in-use409 without removing the row", async () => {
  let deletes = 0;
  const h = harness({ respond: (path, options) => path.endsWith("/delete") && options.method === "POST" ? (deletes++, response(409, { error: "media_in_use" })) : null }); await h.start(); await h.context.tools.selectAsset(h.context.tools.state.rows[0]);
  await h.ids.get("delete-media").trigger("click"); assert.equal(h.ids.get("delete-dialog").open, true); assert.equal(deletes, 0);
  await h.ids.get("confirm-delete").trigger("click"); assert.equal(deletes, 1); assert.equal(h.context.tools.state.rows.length, 20); assert.equal(h.context.tools.state.selected.id, id(1)); assert.match(h.ids.get("preview-status").textContent, /utilisé par un message/);
});
test("successful confirmed deletion refreshes the active page without an automatic second mutation", async () => {
  const h = harness({ respond: (path, options, f) => {
    if (path.endsWith("/delete") && options.method === "POST") { f.rows.splice(0, 1); return response(200, { deleted: true }); } return null;
  } }); await h.start(); await h.context.tools.selectAsset(h.context.tools.state.rows[0]); await h.ids.get("delete-media").trigger("click"); await h.ids.get("confirm-delete").trigger("click");
  assert.equal(h.context.tools.state.selected, null); assert.equal(h.context.tools.state.rows[0].id, id(2)); assert.equal(h.calls.filter(call => call.options.method === "POST").length, 1); assert.equal(h.ids.get("library-status").textContent, "Média supprimé.");
});
test("an uncertain upload blocks subsequent mutations until a successful list refresh, without automatic retry", async () => {
  const h = harness({ respond: (path, options) => { if (path === "/api/media/admin/assets" && options.method === "POST") throw new TypeError("synthetic network loss"); return null; } }); await h.start();
  h.ids.get("photo-file").files = [new Blob(["photo"], { type: "image/jpeg" })]; await h.context.tools.addPhoto(); assert.equal(h.ids.get("photo-file").disabled, true); assert.match(h.ids.get("library-status").textContent, /résultat n’a pas été confirmé/);
  await h.context.tools.loadList(); assert.equal(h.ids.get("photo-file").disabled, false); assert.equal(h.calls.filter(call => call.options.method === "POST").length, 1);
});
test("session-owner change during binary proof clears all private content before any thumbnail URL is adopted", async () => {
  let switched = false, h;
  h = harness({ respond: path => { if (path.endsWith("/thumb") && !switched) { switched = true; h.setOwner(2); } return null; } }); await h.start(); await flush();
  assert.equal(switched, true); assert.equal(h.created.length, 0); assert.equal(h.ids.get("library-content").hidden, true); assert.equal(h.ids.get("media-grid").children.length, 0); assert.match(h.ids.get("session-status").textContent, /session a changé/);
});
test("hidden-page responses cannot expose old media and a new owner starts with an empty library", async () => {
  const h = harness(); await h.start(); assert.ok(h.created.length > 0); await h.hide(); assert.equal(h.revoked.length, h.created.length);
  h.setOwner(2); await h.show(); assert.equal(h.context.tools.state.session.user.id, id(2)); assert.equal(h.context.tools.state.rows.length, 0); assert.equal(h.ids.get("media-grid").children.length, 0);
});
test("library language switches update visible labels without new network or changing private selection", async () => {
  const h = harness(); await h.start(); await h.context.tools.selectAsset(h.context.tools.state.rows[0]); await flush(); const count = h.calls.length, chosen = h.context.tools.state.selected;
  await h.language("en"); assert.equal(h.calls.length, count); assert.equal(h.context.tools.state.selected, chosen); assert.equal(h.ids.get("library-title").textContent, "My media"); assert.match(h.ids.get("page-note").textContent, /^Page 1 · 20 on this page/); assert.match(h.ids.get("detail-summary").textContent, /MB$/);
  await h.language("fr"); assert.equal(h.calls.length, count); assert.equal(h.ids.get("library-title").textContent, "Mes médias");
});
test("library refuses malformed response paths before requesting any private image", async () => {
  const h = harness({ respond: path => path.startsWith("/api/media/admin/assets?") ? response(200, { assets: [{ ...photo(1), thumbnailUrl: "https://outside.invalid/private" }], hasMore: false, nextCursor: null }) : null }); await h.start();
  assert.equal(h.context.tools.state.rows.length, 0); assert.equal(h.calls.some(call => /\/(thumb|full)$/.test(call.path)), false); assert.equal(h.created.length, 0);
});
test("every static media-library marker has a registered bilingual interface translation", async () => {
  const dictionary = new Map();
  for (const name of ["help-link.js", "i18n-tools.js", "i18n-media-library.js"]) {
    const source = await readFile(new URL(name, root), "utf8");
    vm.runInNewContext(source, { JessieI18n: { register(values) { for (const [key, value] of Object.entries(values)) dictionary.set(key, value); }, getLanguage: () => "fr", onChange() {} }, document: { querySelectorAll: () => [] } });
  }
  const { root: parsed } = parse(files["media-library-page.html"]);
  for (const element of parsed.querySelectorAll("[data-jm-i18n],[data-jm-i18n-title],[data-jm-i18n-aria-label]")) {
    for (const name of ["data-jm-i18n", "data-jm-i18n-title", "data-jm-i18n-aria-label"]) { const source = element.getAttribute(name); if (source !== null) assert.ok(dictionary.has(source), "Missing library translation " + source); }
  }
});

test("native picker return waits for deferred bootstrap proofs, then uploads the original owner's file exactly once", async () => {
  let holding = false, release = null, prepared = 0;
  const h = harness({ prepare: async file => { prepared++; return file; }, respond: (path, options, f) => {
    if (path === "/api/auth/session" && holding) return new Promise(resolve => { release = () => resolve(response(200, f.session())); });
    if (path === "/api/media/admin/assets" && options.method === "POST") return response(201, { asset: photo(99), duplicate: false });
    return null;
  } });
  await h.start(); await h.ids.get("photo-file").trigger("click"); await h.hide(); holding = true; await h.show(); assert.ok(release);
  h.ids.get("photo-file").files = [new Blob(["picker photo"], { type: "image/jpeg" })]; await h.ids.get("photo-file").trigger("change");
  assert.equal(prepared, 0); assert.equal(h.calls.filter(call => call.options.method === "POST").length, 0);
  holding = false; release(); await flush(); await flush();
  assert.equal(prepared, 1); assert.equal(h.calls.filter(call => call.options.method === "POST").length, 1); assert.equal(h.context.tools.state.selected.id, id(99));
});
test("native picker intent never adopts another owner's session, even when change arrives after its bootstrap completed", async () => {
  let prepared = 0;
  const h = harness({ prepare: async file => { prepared++; return file; } });
  await h.start(); await h.ids.get("photo-file").trigger("click"); await h.hide(); h.setOwner(2); await h.show();
  assert.equal(h.context.tools.state.session.user.id, id(2));
  h.ids.get("photo-file").files = [new Blob(["old owner selection"], { type: "image/jpeg" })]; await h.ids.get("photo-file").trigger("change");
  assert.equal(prepared, 0); assert.equal(h.calls.filter(call => call.options.method === "POST").length, 0); assert.match(h.ids.get("library-status").textContent, /Choisis de nouveau la photo/);
});
test("owner change while picker bootstrap proof is deferred drops the queued file before preparation or POST", async () => {
  let holding = false, release = null, prepared = 0;
  const h = harness({ prepare: async file => { prepared++; return file; }, respond: (path, _options, f) => {
    if (path === "/api/auth/session" && holding) return new Promise(resolve => { release = () => resolve(response(200, f.session())); }); return null;
  } });
  await h.start(); await h.ids.get("photo-file").trigger("click"); await h.hide(); holding = true; await h.show();
  h.ids.get("photo-file").files = [new Blob(["queued owner photo"], { type: "image/jpeg" })]; await h.ids.get("photo-file").trigger("change");
  h.setOwner(2); holding = false; release(); await flush(); await flush();
  assert.equal(prepared, 0); assert.equal(h.calls.filter(call => call.options.method === "POST").length, 0); assert.equal(h.context.tools.state.session.user.id, id(2));
});
test("BFCache pageshow restores a cleared library through a fresh session bootstrap", async () => {
  const h = harness(); await h.start(); await h.context.tools.selectAsset(h.context.tools.state.rows[0]);
  await h.pageHide(); assert.equal(h.ids.get("library-content").hidden, true); assert.equal(h.ids.get("media-grid").children.length, 0);
  const priorProofs = h.calls.filter(call => call.path === "/api/auth/session").length;
  await h.pageShow(); assert.equal(h.ids.get("library-content").hidden, false); assert.equal(h.ids.get("media-grid").children.length, 20); assert.equal(h.context.tools.state.selected, null);
  assert.ok(h.calls.filter(call => call.path === "/api/auth/session").length > priorProofs); assert.equal(h.calls.some(call => call.options.method === "POST"), false);
});
test("DELETE acknowledgement retires its local row even when the following list refresh fails", async () => {
  let refreshFailed = false;
  const h = harness({ respond: (path, options, f) => {
    if (path.endsWith("/delete") && options.method === "POST") { f.rows.splice(0, 1); refreshFailed = true; return response(200, { deleted: true }); }
    if (refreshFailed && path.startsWith("/api/media/admin/assets?")) return response(503, { error: "media_unavailable" }); return null;
  } });
  await h.start(); await h.context.tools.selectAsset(h.context.tools.state.rows[0]); await h.ids.get("delete-media").trigger("click"); await h.ids.get("confirm-delete").trigger("click");
  assert.equal(h.context.tools.state.selected, null); assert.equal(h.context.tools.state.rows.some(row => row.id === id(1)), false); assert.equal(h.ids.get("media-grid").children.length, 19);
  assert.match(h.ids.get("library-status").textContent, /connexion est momentanément indisponible/); assert.notEqual(h.ids.get("library-status").textContent, "Média supprimé.");
  assert.equal(h.calls.filter(call => call.options.method === "POST").length, 1);
});
test("an already attempted photo upload interrupted by hiding is never placed back in the picker queue", async () => {
  let release = null;
  const h = harness({ respond: (path, options) => {
    if (path === "/api/media/admin/assets" && options.method === "POST") return new Promise(resolve => { release = () => resolve(response(201, { asset: photo(99), duplicate: false })); }); return null;
  } });
  await h.start(); await h.ids.get("photo-file").trigger("click"); h.ids.get("photo-file").files = [new Blob(["attempted upload"], { type: "image/jpeg" })]; await h.ids.get("photo-file").trigger("change"); assert.ok(release);
  await h.hide(); await h.show(); release(); await flush();
  assert.equal(h.calls.filter(call => call.options.method === "POST").length, 1); assert.equal(h.context.tools.state.selected, null); assert.equal(h.ids.get("library-content").hidden, false);
});
