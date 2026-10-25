import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const model = await readFile(new URL("../public/crm-model.js", import.meta.url), "utf8");
const controller = await readFile(new URL("../public/crm.js", import.meta.url), "utf8");
const preferencesModel = await readFile(new URL("../public/preferences-model.js", import.meta.url), "utf8");
const preferencesController = await readFile(new URL("../public/preferences.js", import.meta.url), "utf8");
const catalogue = JSON.parse(await readFile(new URL("../public/preferences-catalogue.json", import.meta.url), "utf8"));
const id = n => n.toString(16).padStart(32, "0");
const label = (name = "Fixture", n = 1) => ({ id: id(n), kind: "tag", name, version: "1", memberCount: 0, createdAt: 1, updatedAt: 1 });
const page = labels => ({ labels, hasMore: false, nextCursor: null });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

// Only the DOM operations used by the controller; browser behavior has its own
// real-Chrome fixture. This harness deliberately settles requests after pause.
class Element {
  constructor(tagName) {
    this.tagName = tagName; this.children = []; this.parentElement = null; this.events = new Map(); this.attributes = new Map();
    this.value = ""; this.text = ""; this.className = ""; this.hidden = false; this.disabled = false; this.open = false;
    this.classList = { toggle: (name, on) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); if (on) names.add(name); else names.delete(name); this.className = [...names].join(" "); } };
  }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(fn); }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
  after(...children) { const parent = this.parentElement; const at = parent.children.indexOf(this); for (const child of children) child.parentElement = parent; parent.children.splice(at + 1, 0, ...children); }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.text = ""; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  matches(selector) { return selector.split(",").some(part => { const [tag, pseudo] = part.split(":"); return (tag.startsWith(".") ? this.className.split(/\s+/).includes(tag.slice(1)) : this.tagName === tag) && (pseudo !== "checked" || this.checked); }); }
  querySelectorAll(selector) { return this.children.flatMap(child => [child.matches(selector) ? child : null, ...child.querySelectorAll(selector)]).filter(Boolean); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  checkValidity() { return true; }
  get isConnected() { return this.tagName === "body" || !!this.parentElement?.isConnected; }
}

async function harness(t, intercept = () => undefined, adapterOptions = {}) {
  const body = new Element("body"), inboxHead = new Element("header"), chatHead = new Element("header"); body.append(inboxHead, chatHead);
  const calls = [], errors = []; let labels = [label()];
  const document = { body, visibilityState: "visible", createElement: tag => new Element(tag), addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({ document, Date, URLSearchParams, AbortController, setTimeout, clearTimeout, __catalogue: catalogue });
  // Exercise the real preferences UI while replacing only its module/catalogue
  // transport, which this deliberately small VM DOM does not implement.
  vm.runInContext(`globalThis.__preferencesModule = (() => {
    ${preferencesModel.replace(/^export\s+/gm, "")}
    ${preferencesController.replace(/^import[^\n]+\n/gm, "").replace(/^export\s+/gm, "")}
    return { createPreferencesUI(options) { return createPreferencesUI({ ...options, loadCatalogue: async () => __catalogue }); } };
  })();`, context);
  vm.runInContext(model.replace(/^export\s+/gm, ""), context);
  vm.runInContext(controller.replace(/^import[^\n]+\n/, "").replace(/^export\s+/gm, "").replace('await import("/preferences.js")', 'await Promise.resolve(__preferencesModule)'), context);
  const ui = context.createCrmUI({ inboxHead, chatHead, ...adapterOptions, onContacts() {}, onError: error => errors.push(error),
    async request(path, options) {
      const call = { path, options }; calls.push(call); const result = intercept(call, calls);
      if (result !== undefined) return result;
      if (path.includes("/contacts?")) return { contacts: [], hasMore: false, nextCursor: null };
      if (path.includes("/labels?")) return page(structuredClone(labels));
      if (path.endsWith("/labels") && options.mutation) { const created = label(options.body.name, labels.length + 1); labels.push(created); return { label: created, duplicate: false }; }
      throw new Error("Unexpected fixture request");
    }
  });
  t.after(() => ui.clear()); await ui.initialize();
  const manager = body.querySelectorAll(".crm-label-dialog")[0];
  const form = manager.querySelectorAll("form")[0], name = form.querySelectorAll("input")[0], create = form.querySelectorAll("button")[0];
  const emit = async (element, event) => { for (const fn of element.events.get(event) ?? []) fn({ preventDefault() {} }); await flush(); };
  return { ui, calls, errors, manager, form, name, create, body, emit,
    async open() { const opener = body.querySelectorAll("button").find(button => button.textContent === "Tags et groupes"); await emit(opener, "click"); },
    async submit(value) { name.value = value; await emit(form, "submit"); },
    async settle() { await flush(); },
    status: () => manager.querySelectorAll(".crm-status")[0].textContent,
    creates: () => calls.filter(call => call.path.endsWith("/labels") && call.options.mutation)
  };
}

test("CRM label creation renders a literal name and preserves the normal success flow", async t => {
  const f = await harness(t); await f.open(); await f.submit("<script>fixture</script>");
  assert.equal(f.creates().length, 1); assert.equal(f.name.value, ""); assert.equal(f.create.disabled, false);
  assert.equal(f.status(), "Étiquette créée."); assert.equal(f.body.querySelectorAll("script").length, 0); assert.deepEqual(f.errors, []);
});

test("CRM profile closure resolves a visible return target after its menu entry is hidden, with the original opener as the optional-adapter fallback", async t => {
  for (const contextualFocus of [false, true]) await t.test(contextualFocus ? "current visible options button" : "original profile opener", async t => {
    const conversationId = id(100);
    const profile = { conversationId, client: { id: id(2), pseudonym: "Synthetic client", email: "synthetic@example.invalid", status: "active" },
      access: { state: "active", expiresAt: null }, nickname: "", notes: "", reminderAt: null, labels: [], version: "1", updatedAt: 1 };
    let currentTarget, focusRequests = 0;
    const f = await harness(t, call => call.path.endsWith(`/conversations/${conversationId}`) ? structuredClone(profile) : undefined,
      contextualFocus ? { getReturnFocus() { focusRequests++; return currentTarget; } } : {});
    const firstMenuButton = new Element("button"), currentMenuButton = new Element("button"), menu = new Element("section");
    f.body.append(firstMenuButton, currentMenuButton, menu); currentTarget = firstMenuButton;
    f.ui.selectConversation(conversationId);
    const opener = f.body.querySelectorAll(".crm-fiche-button")[0];
    if (contextualFocus) menu.append(opener);
    await f.emit(opener, "click");
    const dialog = f.body.querySelectorAll(".crm-dialog").find(element => !element.className.includes("crm-label-dialog"));
    assert.equal(dialog.open, true); assert.equal(focusRequests, 0, "the return target is resolved only when focus must be restored");
    if (contextualFocus) { menu.hidden = true; firstMenuButton.hidden = true; currentTarget = currentMenuButton; }
    const calls = f.calls.length;
    await f.emit(dialog.querySelectorAll("button").find(button => button.textContent === "Fermer"), "click");
    assert.equal(dialog.open, false); assert.equal(f.calls.length, calls, "closing the profile neither exports nor sends a request");
    if (contextualFocus) {
      assert.equal(focusRequests, 1); assert.equal(currentMenuButton.hidden, false); assert.equal(currentMenuButton.isConnected, true);
      assert.equal(currentMenuButton.focused, true, "the current visible options button receives focus");
      assert.notEqual(firstMenuButton.focused, true); assert.notEqual(opener.focused, true, "the hidden menu entry cannot receive restored focus");
    } else assert.equal(opener.focused, true, "existing standalone CRM adapters preserve their original behavior");
    assert.deepEqual(f.errors, []);
  });
});

test("CRM ignores an old authentication failure after resuming and opening a new label manager", async t => {
  const old = deferred(); let reads = 0;
  const f = await harness(t, call => call.path.includes("/labels?") && ++reads === 2 ? old.promise : undefined);
  await f.open(); f.ui.suspend(); await f.ui.resume(); await f.open();
  old.reject(Object.assign(new Error("old session"), { status: 401 })); await f.settle();
  assert.deepEqual(f.errors, [], "an obsolete request must not sign out the resumed session");
  assert.equal(f.manager.open, true); assert.equal(f.status(), "");
});

test("an old CRM mutation cannot release the lock held by a new creation after resume", async t => {
  const old = deferred(), current = deferred(); let writes = 0;
  const f = await harness(t, call => call.path.endsWith("/labels") && call.options.mutation ? (++writes === 1 ? old.promise : current.promise) : undefined);
  await f.open(); await f.submit("Ancien nom"); assert.equal(f.create.disabled, true);
  f.ui.suspend(); await f.ui.resume(); await f.open(); await f.submit("Nouveau nom");
  old.resolve({ label: label("Ancien nom"), duplicate: false }); await f.settle();
  assert.equal(f.create.disabled, true, "late finalization must not unlock the new action");
  assert.equal(f.name.value, "Nouveau nom"); assert.equal(f.status(), "Création…");
  await f.submit("Nouveau nom"); assert.equal(f.creates().length, 2, "the busy creation cannot be submitted twice");
  current.resolve({ label: label("Nouveau nom"), duplicate: false }); await f.settle();
  assert.equal(f.create.disabled, false); assert.equal(f.status(), "Étiquette créée.");
});

test("late CRM mutation errors neither replace new feedback nor terminate a resumed session", async t => {
  for (const status of [401, 403, 409, 503]) await t.test(String(status), async t => {
    const old = deferred(), current = deferred(); let writes = 0;
    const f = await harness(t, call => call.path.endsWith("/labels") && call.options.mutation ? (++writes === 1 ? old.promise : current.promise) : undefined);
    await f.open(); await f.submit("Ancien"); f.ui.suspend(); await f.ui.resume(); await f.open(); await f.submit("Actuel");
    old.reject(Object.assign(new Error("old response"), { status, code: "limit_reached" })); await f.settle();
    assert.deepEqual(f.errors, []); assert.equal(f.status(), "Création…"); assert.equal(f.create.disabled, true);
    current.resolve({ label: label("Actuel"), duplicate: false }); await f.settle();
  });
});

test("a cleared CRM controller ignores late errors and cannot be resumed or send another mutation", async t => {
  const old = deferred();
  const f = await harness(t, call => call.path.endsWith("/labels") && call.options.mutation ? old.promise : undefined);
  await f.open(); await f.submit("Privé"); f.ui.clear(); const count = f.calls.length;
  old.reject(Object.assign(new Error("old request"), { status: 401 })); await f.settle();
  await f.ui.resume(); await f.submit("Détaché");
  assert.deepEqual(f.errors, []); assert.equal(f.calls.length, count); assert.equal(f.body.querySelectorAll(".crm-label-dialog").length, 0);
});

test("a current CRM authentication failure is still sent to the parent controller", async t => {
  const f = await harness(t, call => call.path.endsWith("/labels") && call.options.mutation
    ? Promise.reject(Object.assign(new Error("current request"), { status: 401 })) : undefined);
  await f.open(); await f.submit("Actuel"); assert.equal(f.errors.length, 1); assert.equal(f.errors[0].status, 401);
});

test("an old rename cannot release a new label action or reload labels after resume", async t => {
  const old = deferred(), current = deferred();
  const f = await harness(t, call => call.path.endsWith("/rename") ? old.promise
    : call.path.endsWith("/labels") && call.options.mutation ? current.promise : undefined);
  await f.open();
  const row = f.manager.querySelectorAll(".crm-label-row")[0];
  row.querySelectorAll("input")[0].value = "Ancien renommage";
  row.querySelectorAll("input")[0].events.get("input")[0]();
  row.querySelectorAll("button")[0].events.get("click")[0](); await f.settle();
  f.ui.suspend(); await f.ui.resume(); await f.open(); await f.submit("Création actuelle"); const calls = f.calls.length;
  old.reject(Object.assign(new Error("old conflict"), { status: 409, code: "record_changed" })); await f.settle();
  assert.equal(f.calls.length, calls, "a stale conflict must not start another label fetch");
  assert.equal(f.create.disabled, true); assert.equal(f.status(), "Création…");
  current.resolve({ label: label("Création actuelle"), duplicate: false }); await f.settle();
});

test("superseded label pagination stops before another obsolete page is fetched", async t => {
  const old = deferred(); let reads = 0;
  const f = await harness(t, call => call.path.includes("/labels?") && ++reads === 2 ? old.promise : undefined);
  await f.open(); await f.open(); const calls = f.calls.length;
  old.resolve({ labels: [label()], hasMore: true, nextCursor: id(1) }); await f.settle();
  assert.equal(f.calls.length, calls); assert.equal(f.status(), ""); assert.deepEqual(f.errors, []);
});

test("a rename conflict refresh that finishes after pause cannot replace current creation feedback", async t => {
  const reload = deferred(), current = deferred(); let reads = 0;
  const f = await harness(t, call => call.path.endsWith("/rename")
    ? Promise.reject(Object.assign(new Error("conflict"), { status: 409, code: "record_changed" }))
    : call.path.includes("/labels?") && ++reads === 3 ? reload.promise
    : call.path.endsWith("/labels") && call.options.mutation ? current.promise : undefined);
  await f.open(); f.manager.querySelectorAll(".crm-label-row")[0].querySelectorAll("button")[0].events.get("click")[0](); await f.settle();
  f.ui.suspend(); await f.ui.resume(); await f.open(); await f.submit("Actuel");
  reload.resolve(page([label("Nom distant")])); await f.settle();
  assert.equal(f.status(), "Création…"); assert.equal(f.create.disabled, true);
  current.resolve({ label: label("Actuel"), duplicate: false }); await f.settle();
});

test("a missing filter refresh handles a failed labels reload without rejecting its inbox task", async t => {
  let reads = 0;
  const f = await harness(t, call => call.path.includes("/contacts?")
    ? Promise.reject(Object.assign(new Error("removed label"), { status: 404 }))
    : call.path.includes("/labels?") && ++reads > 1 ? Promise.reject(Object.assign(new Error("unavailable"), { status: 503 })) : undefined);
  await assert.doesNotReject(f.ui.loadInbox()); assert.deepEqual(f.errors, []);
  assert.match(f.body.querySelectorAll(".crm-filter-status")[0].textContent, /réessaie/);
});

test("CRM conversation exports explicitly select videos only under the advertised capability and cancel when the profile closes", async t => {
  for (const videos of [false, true]) await t.test(videos ? "video archive" : "historical photo archive", async t => {
    const conversationId = id(100), pending = deferred();
    const profile = { conversationId, client: { id: id(2), pseudonym: "Synthetic client", email: "synthetic@example.invalid", status: "active" },
      access: { state: "active", expiresAt: null }, nickname: "", notes: "", reminderAt: null, labels: [], version: "1", updatedAt: 1 };
    const f = await harness(t, call => call.path.endsWith("/export") ? pending.promise
      : call.path.endsWith(`/conversations/${conversationId}`) ? structuredClone(profile) : undefined,
    { conversationExport: { enabled: true, photos: true, maxBytes: videos ? 268435456 : 33554432, ...(videos ? { videos: true } : {}) } });
    f.ui.selectConversation(conversationId); await f.emit(f.body.querySelectorAll(".crm-fiche-button")[0], "click");
    const section = f.body.querySelectorAll(".crm-export")[0], checkbox = section.querySelectorAll("input").find(input => input.name === "exportVideos"),
      download = section.querySelectorAll("button").find(button => button.textContent === "Télécharger le ZIP");
    assert.equal(checkbox.parentElement.hidden, !videos); assert.equal(checkbox.checked, videos);
    await f.emit(download, "click");
    const request = f.calls.find(call => call.path.endsWith("/export"));
    assert.deepEqual(JSON.parse(JSON.stringify(request.options.body)), videos ? { includePhotos: true, includeVideos: true } : { includePhotos: true });
    assert.equal(request.options.archive, true); assert.equal(download.disabled, true); assert.equal(checkbox.disabled, true);
    const dialog = f.body.querySelectorAll(".crm-dialog").find(element => !element.className.includes("crm-label-dialog"));
    await f.emit(dialog.querySelectorAll("button").find(button => button.textContent === "Fermer"), "click");
    assert.equal(request.options.signal.aborted, true); assert.equal(download.disabled, false); assert.equal(checkbox.disabled, false);
    pending.resolve({ incomplete: true }); await f.settle(); assert.deepEqual(f.errors, []); assert.equal(dialog.open, false);
  });
});

test("CRM video export can omit originals and restores controls with useful size feedback after a limit refusal", async t => {
  const conversationId = id(100), pending = deferred();
  const profile = { conversationId, client: { id: id(2), pseudonym: "Synthetic client", email: "synthetic@example.invalid", status: "active" },
    access: { state: "active", expiresAt: null }, nickname: "", notes: "", reminderAt: null, labels: [], version: "1", updatedAt: 1 };
  const f = await harness(t, call => call.path.endsWith("/export") ? pending.promise
    : call.path.endsWith(`/conversations/${conversationId}`) ? structuredClone(profile) : undefined,
  { conversationExport: { enabled: true, photos: true, videos: true, maxBytes: 268435456 } });
  f.ui.selectConversation(conversationId); await f.emit(f.body.querySelectorAll(".crm-fiche-button")[0], "click");
  const section = f.body.querySelectorAll(".crm-export")[0], checkbox = section.querySelectorAll("input").find(input => input.name === "exportVideos"),
    download = section.querySelectorAll("button").find(button => button.textContent === "Télécharger le ZIP");
  checkbox.checked = false; await f.emit(download, "click");
  assert.equal(f.calls.find(call => call.path.endsWith("/export")).options.body.includeVideos, false);
  pending.reject(Object.assign(Error("size limit"), { status: 413, code: "conversation_export_limit" })); await f.settle();
  assert.equal(download.disabled, false); assert.equal(checkbox.disabled, false); assert.equal(checkbox.checked, false);
  assert.match(section.querySelectorAll(".crm-status")[0].textContent, /photos ou les vidéos/); assert.deepEqual(f.errors, []);
});

const profileFor = conversationId => ({ conversationId,
  client: { id: id(900), pseudonym: `Synthetic ${conversationId}`, email: "synthetic@example.invalid", status: "active" },
  access: { state: "active", expiresAt: null }, nickname: "", notes: "", reminderAt: null, labels: [], version: "1", updatedAt: 1 });
const preferenceView = (entry = catalogue.categories[0].preferences[0]) => ({ version: "1", catalogueVersion: catalogue.meta.version, selectedIds: [entry.id] });
const clientProfileDialog = f => f.body.querySelectorAll(".crm-dialog").find(element => !element.className.includes("crm-label-dialog"));

test("an explicit profile from the received overview loads read-only preferences above private notes without selecting or reading a chat", async t => {
  const conversationId = id(100), pendingPreferences = deferred();
  const f = await harness(t, call => call.path.endsWith(`/conversations/${conversationId}/preferences`) ? pendingPreferences.promise
    : call.path.endsWith(`/conversations/${conversationId}`) ? profileFor(conversationId) : undefined,
  { preferencesEnabled: true, getReturnFocus() { throw new Error("a visible direct profile entry remains its own return target"); } });
  const opener = new Element("button"); f.body.append(opener);
  await f.ui.openClientProfile(conversationId, opener); await f.settle();
  const dialog = clientProfileDialog(f), preferences = dialog.querySelectorAll(".crm-client-preferences")[0], form = dialog.querySelectorAll(".crm-profile-form")[0];
  assert.equal(dialog.open, true); assert.equal(preferences.open, true);
  assert.ok(dialog.children.indexOf(preferences) < dialog.children.indexOf(form));
  await f.emit(preferences, "toggle");
  assert.equal(f.calls.filter(call => call.path.endsWith("/preferences")).length, 1, "native details toggle cannot duplicate the programmatic load");
  pendingPreferences.resolve(preferenceView()); await f.settle();
  assert.equal(dialog.querySelectorAll(".preference-choice")[0].textContent, catalogue.categories[0].preferences[0].fr);
  assert.equal(dialog.querySelectorAll(".preferences-search-label")[0].hidden, true);
  assert.equal(dialog.querySelectorAll(".preferences-actions")[0].hidden, true);
  assert.equal(dialog.querySelectorAll(".preference-choice")[0].tagName, "span");
  assert.equal(f.calls.some(call => /\/read$/.test(call.path) || call.options.mutation), false);
  await f.emit(dialog.querySelectorAll(".dialog-head")[0].querySelectorAll("button")[0], "click");
  await f.ui.openSelectedProfile(opener); assert.equal(dialog.open, false, "profile consultation did not choose a conversation");
  assert.deepEqual(f.errors, []);
});

test("a client profile has its own target for private saves and restores its avatar without changing the selected conversation", async t => {
  const selected = id(100), target = id(101), shownAvatars = [], clearedAvatars = [];
  const f = await harness(t, call => {
    if (call.path.endsWith("/preferences")) return preferenceView();
    for (const id of [selected, target]) if (call.path.endsWith(`/conversations/${id}`)) return { ...profileFor(id), ...(call.options.mutation ? { nickname: call.options.body.nickname, version: "2" } : {}) };
  }, { preferencesEnabled: true, renderClientAvatar(node, id) { shownAvatars.push(id); node.textContent = "Synthetic avatar"; }, clearClientAvatar(node) { clearedAvatars.push(node); } });
  const opener = new Element("button"); f.body.append(opener);
  f.ui.selectConversation(selected); await f.ui.openClientProfile(target, opener); await f.settle();
  const dialog = clientProfileDialog(f), form = dialog.querySelectorAll(".crm-profile-form")[0], nickname = form.querySelectorAll("input").find(node => node.name === "nickname");
  nickname.value = "Private nickname for target"; await f.emit(nickname, "input"); await f.emit(form, "submit");
  const saves = f.calls.filter(call => call.options.mutation);
  assert.equal(saves.length, 1); assert.equal(saves[0].path, `/api/admin/crm/conversations/${target}`);
  assert.equal(shownAvatars.at(-1), target);
  await f.emit(dialog.querySelectorAll(".dialog-head")[0].querySelectorAll("button")[0], "click");
  const avatar = dialog.querySelectorAll(".crm-profile-avatar")[0]; assert.equal(avatar.hidden, true); assert.equal(avatar.textContent, ""); assert.ok(clearedAvatars.includes(avatar));
  await f.ui.openSelectedProfile(opener); await f.settle();
  assert.equal(shownAvatars.at(-1), selected, "the conversation selection was never replaced by the standalone profile target");
  assert.equal(f.calls.some(call => /\/read$/.test(call.path)), false); assert.deepEqual(f.errors, []);
});

test("closing a profile returns to its current entry after a received-list refresh replaces the original button", async t => {
  const target = id(100), original = new Element("button"), replacement = new Element("button"), resolved = [];
  const f = await harness(t, call => call.path.endsWith(`/conversations/${target}`) ? profileFor(target) : undefined,
    { getProfileReturnFocus(id) { resolved.push(id); return replacement; }, getReturnFocus() { throw new Error("the profile still has a live entry"); } });
  f.body.append(original); await f.ui.openClientProfile(target, original); await f.settle();
  original.remove(); f.body.append(replacement);
  const dialog = clientProfileDialog(f);
  await f.emit(dialog.querySelectorAll(".dialog-head")[0].querySelectorAll("button")[0], "click");
  assert.equal(dialog.open, false); assert.equal(replacement.focused, true); assert.deepEqual(resolved, [target]);
  assert.equal(f.calls.some(call => /\/read$/.test(call.path) || call.options.mutation), false); assert.deepEqual(f.errors, []);
});

test("late profile and preference responses cannot replace the explicitly opened current client or survive suspension", async t => {
  const first = id(100), second = id(101), oldProfile = deferred(), oldPreferences = deferred();
  const f = await harness(t, call => {
    if (call.path.endsWith(`/conversations/${first}/preferences`)) return oldPreferences.promise;
    if (call.path.endsWith(`/conversations/${second}/preferences`)) return preferenceView(catalogue.categories[0].preferences[1]);
    if (call.path.endsWith(`/conversations/${first}`)) return oldProfile.promise;
    if (call.path.endsWith(`/conversations/${second}`)) return profileFor(second);
  }, { preferencesEnabled: true });
  const opening = f.ui.openClientProfile(first); await f.settle();
  await f.ui.openClientProfile(second); await f.settle();
  oldProfile.resolve(profileFor(first)); oldPreferences.resolve(preferenceView()); await opening; await f.settle();
  const dialog = clientProfileDialog(f);
  assert.ok(dialog.textContent.includes(`Synthetic ${second}`)); assert.ok(!dialog.textContent.includes(`Synthetic ${first}`));
  assert.equal(dialog.querySelectorAll(".preferences-selected")[0].textContent, catalogue.categories[0].preferences[1].fr);
  f.ui.suspend(); assert.equal(dialog.open, false); assert.equal(dialog.querySelectorAll(".crm-client-preferences")[0].textContent, "Goûts & fantasmes");
  assert.equal(f.calls.some(call => /\/read$/.test(call.path) || call.options.mutation), false); assert.deepEqual(f.errors, []);
});
