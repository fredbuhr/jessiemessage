import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/profile.js", import.meta.url), "utf8");
const translations = await readFile(new URL("../public/i18n-profile.js", import.meta.url), "utf8");
const i18nRuntime = await readFile(new URL("../public/i18n.js", import.meta.url), "utf8");
const id = number => number.toString(16).padStart(32, "0");
const jpeg = value => new Blob([value], { type: "image/jpeg" });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let step = 0; step < 8; step += 1) await new Promise(resolve => setImmediate(resolve)); };

class Element {
  constructor(tag, doc) {
    this.tagName = tag; this.ownerDocument = doc; this.children = []; this.parentElement = null;
    this.attributes = new Map(); this.listeners = new Map(); this.hidden = false; this.disabled = false;
    this.open = false; this.files = []; this._text = ""; this._value = ""; this.className = "";
    this.classList = { toggle: (name, on) => { const values = new Set(this.className.split(/\s+/).filter(Boolean));
      if (on) values.add(name); else values.delete(name); this.className = [...values].join(" "); } };
  }
  get isConnected() { return this === this.ownerDocument.documentElement || Boolean(this.parentElement?.isConnected); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); for (const child of this.children) child.parentElement = null; this.children = []; }
  get value() { return this._value; }
  set value(value) { this._value = value; if (this.type === "file" && value === "") this.files = []; }
  set src(value) { this.setAttribute("src", value); } get src() { return this.getAttribute("src") ?? ""; }
  append(...values) { for (const value of values) { value.remove(); value.parentElement = this; this.children.push(value); } }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, handler) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(handler); }
  removeEventListener(name, handler) { this.listeners.get(name)?.delete(handler); }
  emit(name, properties = {}) {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
    for (const handler of [...this.listeners.get(name) ?? []]) handler(event);
    return event;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  matches(selector) { return selector.split(",").some(part => {
    part = part.trim();
    if (part.startsWith(".")) return this.className.split(/\s+/).includes(part.slice(1));
    if (part.startsWith("#")) return this.id === part.slice(1);
    const attribute = /^\[([^\]]+)\]$/.exec(part);
    return attribute ? this.getAttribute(attribute[1]) !== null : this.tagName === part;
  }); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { if (this.isConnected && !this.disabled) this.ownerDocument.activeElement = this; }
  click() { this.clicks = (this.clicks ?? 0) + 1; this.emit("click"); }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit("close"); }
}

function harness({ role = "client", avatarsEnabled = true, avatar = false, intercept, binary, prepareAvatar, language = "fr", bitmap, coarse = false } = {}) {
  const events = new Map(), windowEvents = new Map(), calls = [], binaryCalls = [], created = [], revoked = [], saved = [], errors = [];
  const add = (map, name, handler) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(handler); };
  const document = { visibilityState: "visible", createElement(tag) { return new Element(tag, document); },
    querySelectorAll: selector => document.documentElement.querySelectorAll(selector),
    addEventListener: (name, handler) => add(events, name, handler), removeEventListener: (name, handler) => events.get(name)?.delete(handler) };
  document.documentElement = new Element("html", document); document.body = new Element("body", document);
  document.documentElement.append(document.body); document.activeElement = document.body;
  const button = new Element("button", document); document.body.append(button);
  const base = `/api/profile/${role}`;
  const state = { owner: true, profile: { pseudonym: "Envoyer", version: "1", avatarId: avatar ? id(1) : null, avatarUrl: avatar ? `${base}/avatar?v=1` : null } };
  const context = vm.createContext({ matchMedia: () => ({ matches: coarse }), document, Blob, AbortController, DOMException, console,
    navigator: { language: language === "en" ? "en-GB" : "fr-FR" },
    __prepareImageUpload: async file => file,
    createImageBitmap: async () => bitmap,
    window: { addEventListener: (name, handler) => add(windowEvents, name, handler), removeEventListener: (name, handler) => windowEvents.get(name)?.delete(handler) },
    URL: { createObjectURL(blob) { const url = `blob:profile-${created.length + 1}`; created.push({ url, blob }); return url; }, revokeObjectURL: url => revoked.push(url) } });
  vm.runInContext(i18nRuntime, context, { filename: "public/i18n.js" });
  vm.runInContext(translations, context);
  vm.runInContext(`const prepareImageUpload = __prepareImageUpload;\n${source.replace(/^import[^\n]+;\n/gm, "").replace(/export (async )?function /g, "$1function ")}\nglobalThis.__profile = {createProfileUI, prepareProfileAvatar};`, context);
  const runtimeListeners = { visibilitychange: events.get("visibilitychange")?.size ?? 0, pagehide: windowEvents.get("pagehide")?.size ?? 0 };
  const ui = context.__profile.createProfileUI({ role, host: document.body, button, avatarsEnabled, isCurrent: () => state.owner,
    prepareAvatar: prepareAvatar ?? (async file => file),
    async request(path, options) {
      calls.push({ path, options });
      const value = await intercept?.(path, options, state);
      if (value !== undefined) return value;
      if (path === `/api/media/${role}/assets`) return { asset: { id: id(99) } };
      assert.equal(path, base);
      if (options.mutation) state.profile = { ...state.profile, ...options.body, version: String(Number(state.profile.version) + 1),
        avatarUrl: options.body.avatarId ? `${base}/avatar?v=${Number(state.profile.version) + 1}` : null };
      return structuredClone(state.profile);
    },
    async fetchBinary(path, options) { binaryCalls.push({ path, options }); return binary ? await binary(path, options) : jpeg("saved avatar"); },
    onSaved: value => saved.push(value), onError: error => errors.push(error)
  });
  const element = selector => document.body.querySelector(`.${selector}`);
  return { ui, document, button, calls, binaryCalls, state, created, revoked, saved, errors, context, events, windowEvents, element, runtimeListeners,
    language: value => context.JessieI18n.setLanguage(value),
    async choose(blob) { const file = element("profile-file"); file.files = [blob]; file.emit("change"); await flush(); },
    async save() { element("profile-form").emit("submit"); await flush(); },
    async click(selector) { element(selector).emit("click"); await flush(); },
    hide() { document.visibilityState = "hidden"; for (const fn of events.get("visibilitychange") ?? []) fn(); } };
}

test("profile loads for either role, preserves a user name verbatim and saves through the account adapter", async () => {
  for (const role of ["client", "admin"]) {
    const h = harness({ role, language: "en" }); await h.ui.open();
    assert.equal(h.element("profile-pseudonym").value, "Envoyer");
    assert.equal(h.element("profile-save").textContent, "Save profile");
    h.element("profile-pseudonym").value = "  Nouveau nom  "; await h.save();
    assert.equal(h.calls[1].path, `/api/profile/${role}`);
    assert.equal(h.calls[1].options.account, true); assert.equal(h.calls[1].options.mutation, true);
    assert.equal(h.calls[1].options.body.pseudonym, "Nouveau nom"); assert.equal(h.calls[1].options.body.expectedVersion, "1");
    assert.equal(h.saved.length, 1); assert.equal(h.element("profile-dialog").open, false);
    assert.equal(h.element("profile-feedback").textContent, "Profile saved."); h.ui.destroy();
  }
});

test("a new avatar is uploaded as an asset only, and is never sent as a chat message", async () => {
  const h = harness(); await h.ui.open(); const chosen = jpeg("new avatar"); await h.choose(chosen);
  assert.equal(h.calls.length, 1); assert.equal(h.created[0].blob, chosen);
  await h.save();
  assert.deepEqual(h.calls.map(call => call.path), ["/api/profile/client", "/api/media/client/assets", "/api/profile/client"]);
  assert.equal(h.calls[1].options.rawBody, chosen); assert.equal(h.calls[1].options.contentType, "image/jpeg");
  assert.equal(h.calls[2].options.body.avatarId, id(99)); assert.deepEqual(h.revoked, ["blob:profile-1"]);
  h.ui.destroy();
});

test("409 retains the name/avatar draft; keeping it refreshes the version without reuploading the asset", async () => {
  let first = true;
  const h = harness({ intercept(path, options, state) {
    if (path === "/api/profile/client" && options.mutation && first) {
      first = false; state.profile = { pseudonym: "Autre appareil", version: "2", avatarId: null, avatarUrl: null };
      throw Object.assign(new Error("conflict"), { status: 409 });
    }
  } });
  await h.ui.open(); h.element("profile-pseudonym").value = "Mon brouillon"; await h.choose(jpeg("new")); await h.save();
  assert.equal(h.element("profile-pseudonym").value, "Mon brouillon"); assert.equal(h.element("profile-conflict").hidden, false);
  assert.equal(h.element("profile-save").disabled, true); assert.equal(h.element("profile-avatar-preview").querySelector("img").src, "blob:profile-1");
  await h.click("profile-keep-draft"); assert.equal(h.element("profile-pseudonym").value, "Mon brouillon");
  await h.save(); assert.equal(h.calls.at(-1).options.body.expectedVersion, "2");
  assert.equal(h.calls.at(-1).options.body.avatarId, id(99)); assert.equal(h.calls.filter(call => call.path.endsWith("/assets")).length, 1);
  assert.equal(h.saved.length, 1); h.ui.destroy();
});

test("reloading after 409 discards the draft only after obtaining the saved profile", async () => {
  let first = true;
  const h = harness({ intercept(path, options, state) { if (options.mutation && first) { first = false;
    state.profile = { pseudonym: "Dernier profil", version: "2", avatarId: null, avatarUrl: null }; throw Object.assign(new Error(), { status: 409 }); } } });
  await h.ui.open(); h.element("profile-pseudonym").value = "Brouillon"; await h.save();
  await h.click("profile-reload"); assert.equal(h.element("profile-pseudonym").value, "Dernier profil");
  assert.equal(h.element("profile-conflict").hidden, true); assert.equal(h.element("profile-save").disabled, false); h.ui.destroy();
});

test("a stale binary response cannot install an old account's avatar after close/reopen", async () => {
  const late = deferred(), h = harness({ avatar: true, binary: () => late.promise });
  await h.ui.open(); const signal = h.binaryCalls[0].options.signal; h.ui.close();
  h.state.profile = { pseudonym: "Sans avatar", version: "2", avatarId: null, avatarUrl: null }; await h.ui.open();
  late.resolve(jpeg("stale")); await flush();
  assert.equal(signal.aborted, true); assert.equal(h.created.length, 0);
  assert.equal(h.element("profile-avatar-preview").querySelector("img").src, ""); h.ui.destroy();
});

test("only the latest avatar preparation can publish a preview; closing aborts and revokes it", async () => {
  const first = deferred(), second = deferred(), signals = []; let count = 0;
  const h = harness({ prepareAvatar(file, { signal }) { signals.push(signal); return ++count === 1 ? first.promise : second.promise; } });
  await h.ui.open(); await h.choose(jpeg("first")); await h.choose(jpeg("second"));
  second.resolve(jpeg("chosen second")); await flush(); first.resolve(jpeg("stale first")); await flush();
  assert.equal(signals[0].aborted, true); assert.equal(h.created.length, 1);
  assert.equal(await h.created[0].blob.text(), "chosen second"); h.ui.close();
  assert.deepEqual(h.revoked, ["blob:profile-1"]); assert.equal(h.element("profile-pseudonym").value, ""); h.ui.destroy();
});

test("hiding the page aborts preparation and discards all private draft data", async () => {
  const pending = deferred(); let signal;
  const h = harness({ prepareAvatar(file, options) { signal = options.signal; return pending.promise; } });
  await h.ui.open(); h.element("profile-pseudonym").value = "Private draft"; await h.choose(jpeg("pending")); h.hide();
  pending.resolve(jpeg("too late")); await flush();
  assert.equal(signal.aborted, true); assert.equal(h.element("profile-dialog").open, false);
  assert.equal(h.element("profile-pseudonym").value, ""); assert.equal(h.created.length, 0); h.ui.destroy();
});

test("old saves and old authentication errors cannot affect a newer opening or owner", async () => {
  const late = deferred(); let waiting = true;
  const h = harness({ intercept(path, options) { if (options.mutation && waiting) { waiting = false; return late.promise; } } });
  await h.ui.open(); const saving = h.save(); await flush(); h.ui.close(); await h.ui.open();
  h.element("profile-pseudonym").value = "New draft";
  late.reject(Object.assign(new Error("old owner"), { status: 401 })); await saving; await flush();
  assert.equal(h.element("profile-dialog").open, true); assert.equal(h.element("profile-pseudonym").value, "New draft");
  assert.equal(h.errors.length, 0); assert.equal(h.saved.length, 0); h.ui.destroy();
});

test("loss of the mounted owner clears the dialog without reporting an old 401", async () => {
  const late = deferred(), h = harness({ intercept: () => late.promise }); const opening = h.ui.open();
  h.state.owner = false; late.reject(Object.assign(new Error(), { status: 401 })); await opening;
  assert.equal(h.element("profile-dialog").open, false); assert.equal(h.element("profile-pseudonym").value, "");
  assert.equal(h.errors.length, 0); h.ui.destroy();
});

test("a current authentication error closes the editor and is delegated once", async () => {
  const h = harness({ intercept() { throw Object.assign(new Error(), { status: 401 }); } });
  await h.ui.open(); assert.equal(h.element("profile-dialog").open, false);
  assert.equal(h.errors.length, 1); assert.equal(h.element("profile-pseudonym").value, ""); h.ui.destroy();
});

test("an unexpected avatar URL is rejected before any binary request", async () => {
  const h = harness({ avatar: true }); h.state.profile.avatarUrl = "https://other.invalid/avatar.jpg";
  await h.ui.open(); assert.equal(h.binaryCalls.length, 0);
  assert.equal(h.element("profile-save").disabled, true); assert.equal(h.element("profile-retry").hidden, false); h.ui.destroy();
});

test("public names reject format controls and are normalized consistently with the profile API", async () => {
  const h = harness(); await h.ui.open(); const input = h.element("profile-pseudonym");
  input.value = "A\u200dB"; input.emit("input"); assert.equal(h.element("profile-save").disabled, true);
  input.value = " Jose\u0301 "; input.emit("input"); await h.save();
  assert.equal(h.calls.at(-1).options.body.pseudonym, "José"); h.ui.destroy();
});

test("media disabled still permits name edits and neither fetches nor mutates avatars", async () => {
  const h = harness({ avatar: true, avatarsEnabled: false }); await h.ui.open();
  assert.equal(h.element("profile-avatar-section").hidden, true); assert.equal(h.binaryCalls.length, 0);
  h.element("profile-pseudonym").value = "Nom seul"; await h.save();
  assert.equal(h.calls.at(-1).options.body.avatarId, id(1)); assert.equal(h.calls.length, 2); h.ui.destroy();
});

test("removing an avatar changes only the draft until save, without deleting its media asset", async () => {
  const h = harness({ avatar: true }); await h.ui.open(); await flush();
  assert.equal(h.created.length, 1); await h.click("profile-remove-avatar");
  assert.equal(h.calls.length, 1); assert.equal(h.element("profile-avatar-preview").querySelector("img").src, "");
  await h.save(); assert.equal(h.calls.at(-1).options.body.avatarId, null); assert.equal(h.calls.length, 2); h.ui.destroy();
});

test("Escape returns focus to the opener; Tab stays inside the modal", async () => {
  const h = harness(); h.button.focus(); await h.ui.open();
  const dialog = h.element("profile-dialog"), close = h.element("profile-close"), save = h.element("profile-save");
  save.focus(); assert.equal(dialog.emit("keydown", { key: "Tab", shiftKey: false }).defaultPrevented, true);
  assert.equal(h.document.activeElement, close);
  dialog.emit("keydown", { key: "Tab", shiftKey: true }); assert.equal(h.document.activeElement, save);
  assert.equal(dialog.emit("keydown", { key: "Escape" }).defaultPrevented, true);
  assert.equal(h.document.activeElement, h.button); assert.equal(dialog.open, false); h.ui.destroy();
});

test("destroy removes listeners, revokes avatar URLs and cannot be reopened", async () => {
  const h = harness({ avatar: true }); await h.ui.open(); await flush(); h.ui.destroy(); h.ui.destroy();
  assert.equal(h.element("profile-dialog"), null); assert.deepEqual(h.revoked, ["blob:profile-1"]);
  assert.equal(h.button.listeners.get("click").size, 0); assert.equal(h.events.get("visibilitychange").size, h.runtimeListeners.visibilitychange);
  assert.equal(h.windowEvents.get("pagehide").size, h.runtimeListeners.pagehide); assert.equal(await h.ui.open(), false);
});

test("the default avatar crop makes a 256px central JPEG and releases the bitmap/canvas", async () => {
  const bitmap = { width: 320, height: 160, closed: false, close() { this.closed = true; } };
  const h = harness({ bitmap }); const draw = [], options = [];
  const canvas = { width: 0, height: 0, getContext() { return { fillRect() {}, drawImage: (...args) => draw.push(args) }; },
    toBlob(callback, type, quality) { options.push({ type, quality, width: this.width, height: this.height }); callback(jpeg("crop")); } };
  const original = h.document.createElement;
  h.document.createElement = tag => tag === "canvas" ? canvas : original(tag);
  const result = await h.context.__profile.prepareProfileAvatar(jpeg("source"));
  assert.equal(result.type, "image/jpeg"); assert.deepEqual(options, [{ type: "image/jpeg", quality: 0.88, width: 256, height: 256 }]);
  assert.deepEqual(draw[0].slice(1), [80, 0, 160, 160, 0, 0, 256, 256]);
  assert.equal(bitmap.closed, true); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0); h.ui.destroy();
});

test("touch profile loading and saving do not open a keyboard; desktop name focus remains available", async () => {
  for (const coarse of [true, false]) {
    const h = harness({ coarse }); await h.ui.open();
    assert.equal(h.document.activeElement, h.element(coarse ? "profile-close" : "profile-pseudonym"));
    h.element("profile-pseudonym").focus(); h.element("profile-pseudonym").value = "Synthetic deliberate edit";
    await h.save();
    assert.equal(h.document.activeElement, h.button); assert.equal(h.element("profile-dialog").open, false);
    await h.ui.open(); assert.equal(h.document.activeElement, h.element(coarse ? "profile-close" : "profile-pseudonym")); h.ui.destroy();
  }
});

test("both profile roles translate their existing UI bindings in place without translating a name or making requests", async () => {
  for (const role of ["client", "admin"]) for (const initial of ["fr", "en"]) {
    const h = harness({ role, language: initial }); h.state.profile.pseudonym = "Mon profil"; await h.ui.open();
    const dialog = h.element("profile-dialog"), input = h.element("profile-pseudonym"), choose = h.element("profile-choose-avatar");
    input.value = "Enregistrer le profil"; input.focus(); const calls = h.calls.length;
    for (const language of ["en", "fr", "en"]) {
      h.language(language);
      assert.equal(h.document.documentElement.lang, language);
      assert.equal(dialog.querySelector("h2").textContent, language === "en" ? "My profile" : "Mon profil");
      assert.equal(h.element("profile-close").textContent, language === "en" ? "Close profile" : "Fermer le profil");
      assert.equal(input.parentElement.querySelector("span").textContent, language === "en" ? "Public name" : "Nom public");
      assert.equal(choose.textContent, language === "en" ? "Choose or replace your avatar" : "Choisir ou remplacer l’avatar");
      assert.equal(h.element("profile-file").getAttribute("aria-label"), choose.textContent);
      assert.equal(h.element("profile-file").hidden, true, "browser-owned file captions cannot override the chosen UI language");
      assert.equal(h.element("profile-remove-avatar").textContent, language === "en" ? "Remove avatar" : "Retirer l’avatar");
      assert.equal(h.element("profile-save").textContent, language === "en" ? "Save profile" : "Enregistrer le profil");
      assert.equal(input.value, "Enregistrer le profil"); assert.equal(h.document.activeElement, input); assert.equal(h.calls.length, calls);
    }
    await h.click("profile-choose-avatar"); assert.equal(h.element("profile-file").clicks, 1); assert.equal(h.calls.length, calls);
    h.ui.close(); h.language("fr"); await h.ui.open();
    assert.equal(dialog.querySelector("h2").textContent, "Mon profil"); assert.equal(input.value, "Mon profil", "saved public name matching a UI key remains raw");
    h.ui.destroy();
  }
});

test("language changes during an outstanding profile read update loading UI and remain in force when it completes", async () => {
  const gate = deferred(), h = harness({ intercept: () => gate.promise });
  const opening = h.ui.open();
  assert.equal(h.element("profile-status").textContent, "Chargement du profil…");
  h.language("en");
  assert.equal(h.element("profile-status").textContent, "Loading your profile…");
  assert.equal(h.element("profile-dialog").querySelector("h2").textContent, "My profile");
  gate.resolve(structuredClone(h.state.profile)); await opening;
  assert.equal(h.element("profile-status").textContent, ""); assert.equal(h.element("profile-save").textContent, "Save profile");
  assert.equal(h.element("profile-pseudonym").value, "Envoyer"); assert.equal(h.calls.length, 1); h.ui.destroy();
});

test("avatar preparation, an outstanding save and saved feedback follow later language choices without changing the draft or replaying a request", async () => {
  const preparation = deferred(), saving = deferred();
  const h = harness({ prepareAvatar: () => preparation.promise, intercept(path, options) { if (options.mutation && path === "/api/profile/client") return saving.promise; } });
  await h.ui.open(); h.element("profile-pseudonym").value = "Nom privé <b>brut</b>";
  await h.choose(jpeg("synthetic avatar")); h.language("en");
  assert.equal(h.element("profile-status").textContent, "Preparing your avatar…"); assert.equal(h.calls.length, 1);
  preparation.resolve(jpeg("prepared")); await flush();
  assert.equal(h.element("profile-status").textContent, "Avatar ready. Save your profile to apply it.");
  await h.save(); assert.equal(h.element("profile-status").textContent, "Saving your profile…");
  const calls = h.calls.length; h.language("fr");
  assert.equal(h.element("profile-status").textContent, "Enregistrement du profil…"); assert.equal(h.calls.length, calls);
  assert.equal(h.element("profile-pseudonym").value, "Nom privé <b>brut</b>");
  h.language("en"); saving.resolve({ pseudonym: "Nom privé <b>brut</b>", version: "2", avatarId: id(99), avatarUrl: "/api/profile/client/avatar?v=2" }); await flush();
  assert.equal(h.element("profile-feedback").textContent, "Profile saved.");
  h.language("fr"); assert.equal(h.element("profile-feedback").textContent, "Profil enregistré.");
  assert.equal(h.calls.length, calls); assert.equal(h.saved[0].pseudonym, "Nom privé <b>brut</b>"); h.ui.destroy();
});

test("translated load errors, avatar errors and conflict actions preserve their French sources and raw draft", async () => {
  const failed = harness({ intercept() { throw Object.assign(new Error("synthetic unavailable"), { status: 503 }); } });
  await failed.ui.open(); failed.language("en");
  assert.equal(failed.element("profile-status").textContent, "Your profile is unavailable. Try again shortly.");
  assert.equal(failed.element("profile-retry").textContent, "Retry loading");
  failed.language("fr"); assert.equal(failed.element("profile-status").textContent, "Le profil est indisponible. Réessaie dans un moment."); failed.ui.destroy();
  const avatar = harness({ prepareAvatar() { throw Object.assign(new Error("synthetic format"), { code: "media_format" }); } });
  await avatar.ui.open(); await avatar.choose(jpeg("invalid")); avatar.language("en");
  assert.equal(avatar.element("profile-status").textContent, "Choose a JPEG, PNG or WebP photo."); avatar.ui.destroy();
  const conflict = harness({ intercept(path, options) { if (options.mutation) throw Object.assign(new Error("synthetic conflict"), { status: 409 }); } });
  await conflict.ui.open(); conflict.element("profile-pseudonym").value = "Garder mon brouillon"; await conflict.save();
  const calls = conflict.calls.length; conflict.language("en");
  assert.equal(conflict.element("profile-status").textContent, "The profile changed elsewhere. Your draft has been kept.");
  assert.equal(conflict.element("profile-conflict").querySelector("p").textContent, "The profile changed elsewhere. Your draft has been kept.");
  assert.equal(conflict.element("profile-reload").textContent, "Reload the saved profile");
  assert.equal(conflict.element("profile-keep-draft").textContent, "Keep my draft");
  assert.equal(conflict.element("profile-pseudonym").value, "Garder mon brouillon"); assert.equal(conflict.calls.length, calls);
  conflict.language("fr"); assert.equal(conflict.element("profile-keep-draft").textContent, "Garder mon brouillon"); conflict.ui.destroy();
});
