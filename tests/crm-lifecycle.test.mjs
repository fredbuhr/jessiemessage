import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const model = await readFile(new URL("../public/crm-model.js", import.meta.url), "utf8");
const controller = await readFile(new URL("../public/crm.js", import.meta.url), "utf8");
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

async function harness(t, intercept = () => undefined) {
  const body = new Element("body"), inboxHead = new Element("header"), chatHead = new Element("header"); body.append(inboxHead, chatHead);
  const calls = [], errors = []; let labels = [label()];
  const document = { body, createElement: tag => new Element(tag) };
  const context = vm.createContext({ document, Date, URLSearchParams, AbortController, setTimeout, clearTimeout });
  vm.runInContext(model.replace(/^export\s+/gm, ""), context);
  vm.runInContext(controller.replace(/^import[^\n]+\n/, "").replace(/^export\s+/gm, ""), context);
  const ui = context.createCrmUI({ inboxHead, chatHead, onContacts() {}, onError: error => errors.push(error),
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
  return { ui, calls, errors, manager, form, name, create, body,
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
