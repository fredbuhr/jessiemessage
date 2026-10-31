import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";
import { webcrypto } from "node:crypto";
import * as model from "../public/broadcast-model.js";

const source = (await readFile(new URL("../public/broadcast.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "").replace('await import("/image-preparation.js")', 'await __imagePreparation()');
const sessionClock = await readFile(new URL("../public/session-clock.js", import.meta.url), "utf8");
const id = (value) => value.toString(16).padStart(32, "0");
const now = Date.now();
const actor = (value = 1) => ({ user: { id: id(value), role: "admin", pseudonym: `Synthetic owner ${value}` },
  csrf: (value === 1 ? "a" : "b").repeat(43), expiresAt: now + 3600000, mediaEnabled: true });
const counts = (state = "pending") => ({ total: 1, pending: 0, sending: 0, delivered: 0, skipped: 0, cancelled: 0, failed: 0, [state]: 1 });
function campaign(value = 10, overrides = {}) {
  return { id: id(value), clientCampaignId: id(value + 1000), title: `Synthetic campaign ${value}`, body: "Synthetic private body",
    mediaId: null, allowRepeatMedia: false, status: "queued", createdAt: now - 10000, updatedAt: now - 10000, expiresAt: now + 86400000,
    counts: counts(), ...overrides };
}
function detail(value) {
  const state = Object.keys(model.recipientNames).find((key) => value.counts[key]) ?? "pending";
  return { ...value, recipients: [{ conversationId: id(99), client: { id: id(98), pseudonym: "Synthetic client" }, state,
    reason: state === "cancelled" ? "cancelled" : null, messageId: state === "delivered" ? id(97) : null, deliveredAt: state === "delivered" ? now : null }] };
}
const response = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null }, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

class FakeNode {
  constructor(tag = "div") { this.attributes = new Map(); this.tagName = tag; this.children = []; this.hidden = false; this.disabled = false; this.checked = false; this.value = ""; this.listeners = new Map(); this.classList = { toggle() {} }; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text ?? ""; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  click() { this.listeners.get("click")?.(); }
  reset() {}
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  querySelectorAll(tag) { return this.children.flatMap((node) => node instanceof FakeNode ? [...(node.tagName === tag ? [node] : []), ...node.querySelectorAll(tag)] : []); }
}
function fixture(handler = () => null, initialOwner = actor(), { XMLHttpRequest, urlApi = URL, prepare = async file => file } = {}) {
  const nodes = new Map(), calls = [], timers = new Map(), documentEvents = new Map(), windowEvents = new Map(); let timerId = 0; let owner = initialOwner;
  const node = (name) => { if (!nodes.has(name)) nodes.set(name, Object.assign(new FakeNode(), { ownerDocument: document })); return nodes.get(name); };
  const document = { visibilityState: "hidden", getElementById: node, createElement: (tag) => Object.assign(new FakeNode(tag), { ownerDocument: document }), addEventListener(name, callback) { documentEvents.set(name, callback); } };
  const context = createContext({ ...model, document, window: { addEventListener(name, callback) { windowEvents.set(name, callback); } }, location: { replace() {} },
    AbortController, Blob, __imagePreparation: async () => ({ prepareImageUpload: prepare, MAX_UPLOAD_BYTES: 10 * 1024 * 1024 }), URL: urlApi, URLSearchParams, TextEncoder, Date, console, crypto: webcrypto, XMLHttpRequest,
    setTimeout(callback, delay) { const timer = ++timerId; timers.set(timer, { callback, delay }); return timer; }, clearTimeout(timer) { timers.delete(timer); },
    fetch: async (path, options) => {
      calls.push({ path, options });
      const customized = await handler(path, options, { owner, setOwner: (next) => { owner = next; } });
      if (customized) return customized;
      if (path === "/api/broadcast/admin/session" || path === "/api/auth/session") return response(owner);
      if (path === "/api/broadcast/admin/activity") return response({ campaigns: [] });
      if (path.startsWith("/api/broadcast/admin/campaigns?")) return response({ campaigns: [], nextCursor: null, hasMore: false });
      if (path.startsWith("/api/admin/crm/contacts?")) return response({ contacts: [], nextCursor: null, hasMore: false });
      if (path.startsWith("/api/admin/crm/labels?")) return response({ labels: [], nextCursor: null, hasMore: false });
      const recipientMatch = /^\/api\/broadcast\/admin\/campaigns\/([a-f0-9]{32})\/recipients\?/.exec(path);
      if (recipientMatch) {
        const saved = context.controller?.campaigns.get(recipientMatch[1]);
        if (saved) return response({ campaignId: saved.id, recipients: detail(saved).recipients, nextCursor: null, hasMore: false });
      }
      return response({ error: "not_found" }, 404);
    } });
  new Script(sessionClock).runInContext(context);
  new Script(`${source}\nglobalThis.controller = { state, campaigns, assets, chooseVideo, uploadVideo, removeVideo, cancelVideoUpload, videoState: () => ({videoDraft,videoTransfer}), request, loadHistory, loadContacts, preview, loadPhotos, showPhoto, selectPhoto, uploadPhoto, cancelPhotoUpload, renderPhotoGrid, showCampaign, cancelCampaign, send, bootstrap, clearPrivate, suspendPrivate, resumePrivate, scheduleHistory, renderSelection, renderControls, loadRecipientPage, rememberCampaign, detailState: () => ({ recipientPage, recipientAfter, recipientEpoch, detailElements }), busy: () => ({ historyBusy, sendBusy }) };`).runInContext(context);
  const ui = context.controller;
  document.visibilityState = "visible";
  model.acceptBroadcastSession(ui.state, model.clearBroadcast(ui.state, { visible: true }), owner);
  node("access-filter").value = "all"; node("reminder-filter").value = "all";
  return { ui, node, document, calls, timers, setOwner: (next) => { owner = next; }, close: () => ui.clearPrivate(),
    dispatchDocument: (name) => documentEvents.get(name)?.(), dispatchWindow: (name, event = {}) => windowEvents.get(name)?.(event),
    async poll() { const timer = [...timers].find(([, value]) => value.delay === 30000); assert.ok(timer, "one history poll is scheduled"); timers.delete(timer[0]); await timer[1].callback(); } };
}
function compose(ui) {
  ui.state.contacts.set(id(99), { id: id(99), client: { id: id(98), pseudonym: "Synthetic client" }, nickname: "", canSend: true });
  model.selectRecipient(ui.state, id(99), true);
  model.updateComposition(ui.state, { title: "Synthetic immutable draft", body: "Synthetic confirmed body" });
  model.acceptPreview(ui.state, model.previewTicket(ui.state), { recipients: [{ conversationId: id(99), client: { id: id(98), pseudonym: "Synthetic client" }, eligible: true, reason: null, repeatMedia: false }], eligibleCount: 1, repeatCount: 0, ...(ui.state.session?.largeAudiencesEnabled ? {totalCount:1,excludedCount:0,previewToken:"synthetic.initial-preview"} : {}) });
  ui.state.acknowledged = true;
}

test("actual broadcast controller binds every private JSON response to the current account and CSRF proof", async (t) => {
  for (const path of ["/api/broadcast/admin/activity", "/api/broadcast/admin/campaigns?limit=20", `/api/broadcast/admin/campaigns/${id(10)}/summary`,
    "/api/admin/crm/contacts?limit=50", "/api/admin/crm/labels?limit=100", "/api/media/admin/assets?limit=20", "/api/broadcast/admin/preview"]) {
    await t.test(path, async () => {
      let switched = false;
      const f = fixture((requested, _options, state) => {
        if (requested === path && !switched) { switched = true; state.setOwner(actor(2)); return response({ privateOwner: "B" }); }
        return null;
      });
      try {
        compose(f.ui); f.ui.campaigns.set(id(10), campaign(10, { title: "Old owner private title" }));
        await assert.rejects(f.ui.request(path, path.endsWith("preview") ? { body: { conversationIds: [id(99)], mediaId: null } } : {}), (error) => error.stale === true);
        await flush();
        assert.equal(f.ui.state.session.id, id(2));
        assert.equal(f.ui.campaigns.has(id(10)), false);
        assert.equal(f.ui.state.draft.body, ""); assert.equal(f.ui.state.selected.size, 0);
        assert.equal(f.calls.filter((call) => call.options.method === "POST").length, path.endsWith("preview") ? 1 : 0, "no private POST is replayed after a changed account");
      } finally { f.close(); }
    });
  }
});

test("data obtained under another login cannot enter a restored administrator window with a new CSRF proof", async () => {
  let switched = false;
  const f = fixture((path, _options, state) => {
    if (path === "/api/broadcast/admin/activity" && !switched) {
      // The data request used account B, then the cookie returned to A through
      // a new login. Its new CSRF proof must still invalidate A's old window.
      switched = true; state.setOwner({ ...actor(), csrf: "z".repeat(43) }); return response({ privateOwner: "B" });
    }
    return null;
  });
  try {
    compose(f.ui); await assert.rejects(f.ui.request("/api/broadcast/admin/activity"), (error) => error.stale === true); await flush();
    assert.equal(f.ui.state.session.csrf, "z".repeat(43)); assert.equal(f.ui.state.draft.body, "");
  } finally { f.close(); }
});

test("a changed account during a private photo read cannot create or display an old object URL", async () => {
  let urls = 0; let f;
  const previous = URL.createObjectURL;
  URL.createObjectURL = () => { urls += 1; return "blob:synthetic"; };
  f = fixture((path, _options, state) => {
    if (path.endsWith("/thumb")) { state.setOwner(actor(2)); return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => ({ size: 10 }) }; }
    return null;
  });
  try {
    f.ui.state.draft.mediaId = id(40); f.ui.assets.set(id(40), { id: id(40), thumbnailUrl: `/api/media/admin/assets/${id(40)}/thumb` });
    await f.ui.showPhoto(); await flush();
    assert.equal(urls, 0); assert.equal(f.node("photo-preview").children.length, 0); assert.equal(f.ui.state.session.id, id(2));
  } finally { f.close(); URL.createObjectURL = previous; }
});

test("a successful POST followed by a failed session proof preserves the exact uncertain confirmation", async (t) => {
  for (const status of [400, 403, 409, 429, 503]) await t.test(`proof ${status}`, async () => {
    let committed = false; let saved;
    const f = fixture((path, options) => {
      if (path === "/api/broadcast/admin/session" && committed) return response({ error: "synthetic_proof_failure" }, status);
      if (path === "/api/broadcast/admin/campaigns" && options.method === "POST") {
        saved = JSON.parse(options.body); committed = true;
        return response({ campaign: campaign(10, { ...saved, counts: counts() }), duplicate: false }, 201);
      }
      return null;
    });
    try {
      compose(f.ui); await f.ui.send(); await flush();
      assert.equal(f.ui.state.pending.status, "uncertain");
      assert.equal(f.ui.state.pending.payload.clientCampaignId, saved.clientCampaignId);
      assert.equal(f.ui.state.pending.payload.body, saved.body);
      assert.equal(f.ui.state.csrfFailed, status === 403);
      assert.equal(f.calls.filter((call) => call.options.method === "POST").length, 1);
      assert.equal(f.node("uncertain").hidden, false);
    } finally { f.close(); }
  });
});

test("activity snapshots discard obsolete live rows and discover new random IDs without accumulating archives", async () => {
  const old = campaign(25); const ended = campaign(25, { status: "completed", updatedAt: now, counts: counts("delivered") });
  let newest = campaign(500, { createdAt: now, updatedAt: now });
  const oldPage = Array.from({ length: 20 }, (_, index) => campaign(index + 1, { status: "completed", counts: counts("delivered") }));
  const f = fixture((path) => {
    if (path === "/api/broadcast/admin/activity") return response({ campaigns: newest.id === id(21)
      ? [newest, campaign(500, { status: "completed", createdAt: now, updatedAt: now + 1, counts: counts("delivered") })] : [newest] });
    if (path === `/api/broadcast/admin/campaigns/${old.id}/summary`) return response(detail(ended));
    if (path === "/api/broadcast/admin/campaigns?limit=20") return response({ campaigns: oldPage, nextCursor: id(20), hasMore: true });
    if (path === `/api/broadcast/admin/campaigns?limit=20&afterId=${id(20)}`) return response({ campaigns: [ended, newest], nextCursor: null, hasMore: false });
    return null;
  });
  try {
    for (const item of [...oldPage, old]) f.ui.campaigns.set(item.id, item);
    await f.ui.loadHistory();
    assert.equal(f.ui.campaigns.has(old.id), false, "a formerly live campaign outside both current windows is released");
    assert.equal(f.ui.campaigns.has(id(500)), true); assert.equal(f.node("more-history").hidden, false);
    await f.ui.loadHistory(true); assert.equal(f.node("more-history").hidden, true);
    newest = campaign(21, { createdAt: now + 1, updatedAt: now + 1 });
    const before = f.calls.length; await f.ui.loadHistory();
    assert.equal(f.ui.campaigns.has(id(21)), true, "a new ID before the historical cursor is discovered through activity");
    assert.equal(f.calls.slice(before).some((call) => call.path.includes("campaigns?")), false, "activity does not restart or corrupt the archive cursor");
    assert.match(f.node("history-status").textContent, /20 diffusions les plus récentes/);
  } finally { f.close(); }
});

test("an authoritative activity snapshot releases stale local live rows without unbounded summary requests", async () => {
  const f = fixture();
  try {
    for (let index = 10; index < 22; index += 1) f.ui.campaigns.set(id(index), campaign(index));
    await f.ui.loadHistory();
    assert.equal(f.ui.campaigns.size, 0);
    assert.equal(f.calls.filter(call => /\/summary$/.test(call.path)).length, 0);
  } finally { f.close(); }
});

test("explicit history refresh restarts an exhausted archive so older additions outside the recent window remain reachable", async () => {
  let rows = [];
  const f = fixture((path) => {
    if (path === "/api/broadcast/admin/activity") return response({ campaigns: rows.slice(-20).reverse() });
    if (path === "/api/broadcast/admin/campaigns?limit=20") return response({ campaigns: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].id : null, hasMore: rows.length > 20 });
    if (path === `/api/broadcast/admin/campaigns?limit=20&afterId=${id(20)}`) return response({ campaigns: rows.slice(20), nextCursor: null, hasMore: false });
    return null;
  });
  try {
    await f.ui.loadHistory(); assert.equal(f.node("more-history").hidden, true);
    rows = Array.from({ length: 25 }, (_, index) => campaign(index + 1, { status: "completed", counts: counts("delivered") }));
    await f.ui.loadHistory(); assert.equal(f.ui.campaigns.size, 20); assert.equal(f.node("more-history").hidden, true);
    f.node("refresh-history").listeners.get("click")(); await flush();
    assert.equal(f.ui.campaigns.size, 25); assert.equal(f.node("more-history").hidden, false);
    assert.match(f.node("history-status").textContent, /parcours reprend au début/);
    await f.ui.loadHistory(true); assert.equal(f.ui.campaigns.size, 20, "the final archive page replaces the preceding one and overlaps the recent snapshot"); assert.equal(f.node("more-history").hidden, true);
  } finally { f.close(); }
});

test("late history data cannot restore queued counters after cancellation", async () => {
  const queued = campaign(); const cancelled = campaign(10, { status: "cancelled", updatedAt: now, counts: counts("cancelled") });
  const activity = deferred(); let cancelledOnServer = false;
  const f = fixture((path) => {
    if (path === "/api/broadcast/admin/activity") return activity.promise;
    if (path.endsWith("/cancel")) { cancelledOnServer = true; return response(cancelled); }
    if (path === `/api/broadcast/admin/campaigns/${queued.id}/summary`) return response(detail(cancelledOnServer ? cancelled : queued));
    if (path.includes("campaigns?")) return response({ campaigns: [queued], nextCursor: null, hasMore: false });
    return null;
  });
  try {
    f.ui.campaigns.set(queued.id, queued); await f.ui.showCampaign(queued.id);
    const loading = f.ui.loadHistory(); await flush(); await f.ui.cancelCampaign(queued.id);
    activity.resolve(response({ campaigns: [queued] })); await loading;
    assert.equal(f.ui.campaigns.get(queued.id).status, "cancelled"); assert.equal(f.ui.campaigns.get(queued.id).counts.cancelled, 1);
  } finally { f.close(); }
});

test("old poll cleanup cannot clear a new bootstrap's busy state or schedule an extra timer", async () => {
  const old = deferred(), fresh = deferred(); let activityCalls = 0;
  const f = fixture((path) => path === "/api/broadcast/admin/activity" ? (++activityCalls === 1 ? old.promise : fresh.promise) : null);
  try {
    f.ui.scheduleHistory(); const polling = f.poll(); await flush();
    const restarting = f.ui.bootstrap(); await flush(); assert.equal(f.ui.busy().historyBusy, true);
    old.resolve(response({ campaigns: [campaign()] })); await polling;
    assert.equal(f.ui.busy().historyBusy, true, "old finally cannot release the new account cycle's history guard");
    fresh.resolve(response({ campaigns: [] })); await restarting;
    assert.equal([...f.timers.values()].filter((timer) => timer.delay === 30000).length, 1);
    assert.equal(f.ui.campaigns.size, 0);
  } finally { old.resolve(response({ campaigns: [] })); fresh.resolve(response({ campaigns: [] })); f.close(); }
});

test("real hide/show handlers preserve the exact uncertain confirmation and stale cleanup cannot release its explicit retry", async () => {
  const old = deferred(), fresh = deferred(); const sent = []; const stored = new Map();
  const f = fixture((path, options) => {
    if (path === "/api/broadcast/admin/campaigns" && options.method === "POST") {
      const input = JSON.parse(options.body); const value = campaign(40 + sent.length, { ...input }); sent.push(value); stored.set(value.id, value);
      return sent.length === 1 ? old.promise : fresh.promise;
    }
    const match = /^\/api\/broadcast\/admin\/campaigns\/([a-f0-9]{32})\/summary$/.exec(path);
    if (match && stored.has(match[1])) return response(detail(stored.get(match[1])));
    return null;
  });
  try {
    compose(f.ui); const first = f.ui.send(); await flush(); assert.equal(sent.length, 1);
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    const retained = f.ui.state.pending.payload;
    assert.equal(f.ui.state.pending.status, "uncertain"); assert.equal(f.ui.state.session.id, actor().user.id); assert.equal(f.node("broadcast-content").hidden, true);
    f.document.visibilityState = "visible"; f.dispatchDocument("visibilitychange"); await flush();
    assert.equal(sent.length, 1, "returning never posts automatically"); assert.strictEqual(f.ui.state.pending.payload, retained);
    const second = f.ui.send(true); await flush(); assert.equal(sent.length, 2);
    assert.equal(sent[1].clientCampaignId, sent[0].clientCampaignId); assert.equal(sent[1].body, sent[0].body);
    old.resolve(response({ campaign: sent[0], duplicate: false }, 201)); await first;
    assert.equal(f.ui.busy().sendBusy, true); assert.strictEqual(f.ui.state.pending.payload, retained);
    assert.equal(f.ui.campaigns.has(sent[0].id), false);
    fresh.resolve(response({ campaign: sent[1], duplicate: false }, 201)); await second; await flush();
    assert.equal(f.ui.state.pending, null); assert.equal(f.ui.busy().sendBusy, false); assert.equal(f.ui.campaigns.has(sent[1].id), true);
    assert.equal(f.calls.filter((call) => call.options.method === "POST").length, 2);
  } finally { old.resolve(response({ campaign: sent[0], duplicate: false }, 201)); fresh.resolve(response({ campaign: sent[1], duplicate: false }, 201)); f.close(); }
});

test("a hidden page ignores late activity even when the transport ignores abort", async () => {
  const pending = deferred(); const f = fixture((path) => path === "/api/broadcast/admin/activity" ? pending.promise : null);
  try {
    const loading = f.ui.loadHistory(); await flush();
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    pending.resolve(response({ campaigns: [campaign()] })); await loading;
    assert.equal(f.ui.campaigns.size, 0); assert.equal(f.ui.state.session.id, actor().user.id); assert.equal(f.ui.state.visible, false);
    assert.equal(f.node("history").children.length, 0); assert.equal(f.node("broadcast-content").hidden, true);
    assert.equal([...f.timers.values()].filter((timer) => timer.delay === 30000).length, 0);
  } finally { pending.resolve(response({ campaigns: [] })); f.close(); }
});

test("text, selection and attachment stay hidden until one fresh owner proof allows resumption", async () => {
  const proof = deferred(); let block = false;
  const f = fixture(path => block && path === "/api/broadcast/admin/session" ? proof.promise : null);
  try {
    compose(f.ui); model.updateComposition(f.ui.state, { mediaId: id(70) });
    f.node("campaign-title").value = f.ui.state.draft.title; f.node("campaign-body").value = f.ui.state.draft.body;
    f.ui.renderSelection();
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    const hiddenCalls = f.calls.length;
    await f.ui.send(); await f.ui.resumePrivate(); await flush(); assert.equal(f.calls.length, hiddenCalls);
    assert.equal(f.ui.state.selected.size, 1); assert.equal(f.ui.state.draft.mediaId, id(70)); assert.equal(f.ui.state.acknowledged, false);
    block = true; f.document.visibilityState = "visible"; f.dispatchDocument("visibilitychange"); f.dispatchWindow("pageshow", { persisted: true }); await flush();
    assert.equal(f.calls.length, hiddenCalls + 2, "simultaneous visibility/pageshow share one cookie renewal and one feature proof");
    assert.equal(f.node("broadcast-content").hidden, true); await f.ui.send();
    assert.equal(f.calls.some(call => call.options.method === "POST"), false);
    proof.resolve(response(actor())); await f.ui.resumePrivate();
    assert.equal(f.node("broadcast-content").hidden, false); assert.equal(f.node("campaign-body").value, "Synthetic confirmed body");
    assert.equal(f.node("selected").children.length, 1); assert.equal(f.ui.state.draft.mediaId, id(70));
    assert.equal(f.ui.state.preview, null); assert.equal(f.node("confirm").disabled, true);
    assert.equal(f.calls.some(call => call.options.method === "POST"), false);
  } finally { proof.resolve(response(actor())); f.close(); }
});

test("a failed resume proof keeps the immutable pending key for the explicit reload action", async () => {
  let unavailable = true;
  const f = fixture(path => path === "/api/broadcast/admin/session" && unavailable ? response({ error: "unavailable" }, 503) : null);
  try {
    compose(f.ui); const payload = model.prepareCampaign(f.ui.state, id(88));
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    f.document.visibilityState = "visible"; await f.ui.resumePrivate();
    assert.equal(f.node("broadcast-content").hidden, true); assert.equal(f.node("reload").hidden, false);
    assert.strictEqual(f.ui.state.pending.payload, payload); assert.equal(f.ui.state.pending.status, "uncertain");
    unavailable = false; f.node("reload").listeners.get("click")(); await flush();
    assert.equal(f.node("broadcast-content").hidden, false); assert.strictEqual(f.ui.state.pending.payload, payload);
    assert.equal(f.node("uncertain").hidden, false); assert.equal(f.calls.some(call => call.options.method === "POST"), false);
  } finally { f.close(); }
});

test("owner and login changes during suspension purge retained work before displaying the new session", async (t) => {
  for (const next of [actor(2), { ...actor(), csrf: "z".repeat(43) }]) await t.test(next.user.id === actor().user.id ? "new login" : "other account", async () => {
    const f = fixture();
    try {
      compose(f.ui); model.prepareCampaign(f.ui.state, id(89));
      f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange"); f.setOwner(next);
      assert.equal(f.node("broadcast-content").hidden, true);
      f.document.visibilityState = "visible"; await f.ui.resumePrivate();
      assert.equal(f.ui.state.session.id, next.user.id); assert.equal(f.ui.state.session.csrf, next.csrf);
      assert.equal(f.ui.state.pending, null); assert.equal(f.ui.state.draft.body, ""); assert.equal(f.ui.state.selected.size, 0);
      assert.equal(f.node("selected").children.length, 0); assert.equal(f.calls.some(call => call.options.method === "POST"), false);
    } finally { f.close(); }
  });
});

test("a resume proof arriving after another hide cannot reveal content or replace the new cycle", async () => {
  const old = deferred(), fresh = deferred(); let proofs = 0;
  const f = fixture(path => path === "/api/broadcast/admin/session" ? (++proofs === 1 ? old.promise : fresh.promise) : null);
  try {
    compose(f.ui); f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    f.document.visibilityState = "visible"; const first = f.ui.resumePrivate(); await flush();
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    f.document.visibilityState = "visible"; const second = f.ui.resumePrivate(); await flush();
    old.resolve(response(actor(2))); await first;
    assert.equal(f.ui.state.session.id, actor().user.id); assert.equal(f.node("broadcast-content").hidden, true);
    assert.equal(proofs, 2, "one feature proof belongs to each resume cycle");
    fresh.resolve(response(actor())); await second;
    assert.equal(f.ui.state.draft.body, "Synthetic confirmed body"); assert.equal(f.node("broadcast-content").hidden, false);
  } finally { old.resolve(response(actor())); fresh.resolve(response(actor())); f.close(); }
});

test("suspension during initial reads resumes contacts and labels without losing the composed work", async () => {
  const oldContacts = deferred(), oldLabels = deferred(); let contacts = 0, labels = 0;
  const contact = { id: id(51), client: { id: id(52), pseudonym: "Resumed client" }, crm: { nickname: "" }, canSend: true };
  const f = fixture(path => {
    if (path.startsWith("/api/admin/crm/contacts?")) return ++contacts === 1 ? oldContacts.promise : response({ contacts: [contact], nextCursor: null, hasMore: false });
    if (path.startsWith("/api/admin/crm/labels?")) return ++labels === 1 ? oldLabels.promise : response({ labels: [{ id: id(53), kind: "tag", name: "Resumed tag" }], nextCursor: null, hasMore: false });
    return null;
  });
  try {
    const initial = f.ui.bootstrap(); await flush(); model.updateComposition(f.ui.state, { title: "Kept while loading", body: "Kept private draft" });
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    f.document.visibilityState = "visible"; await f.ui.resumePrivate(); await flush();
    assert.equal(contacts, 2); assert.equal(labels, 2); assert.equal(f.ui.state.contacts.get(id(51)).client.pseudonym, "Resumed client");
    assert.equal(f.node("tag-filter").children.at(-1).value, id(53)); assert.equal(f.node("campaign-body").value, "Kept private draft");
    oldContacts.resolve(response({ contacts: [], nextCursor: null, hasMore: false })); oldLabels.resolve(response({ labels: [], nextCursor: null, hasMore: false })); await initial;
    assert.equal(f.ui.state.contacts.size, 1); assert.equal(f.node("tag-filter").children.length, 2); assert.equal(f.calls.some(call => call.options.method === "POST"), false);
  } finally { oldContacts.resolve(response({ contacts: [], nextCursor: null, hasMore: false })); oldLabels.resolve(response({ labels: [], nextCursor: null, hasMore: false })); f.close(); }
});

test("an interrupted cancellation resumes a usable freshly read detail without replaying its POST", async () => {
  const pending = deferred(), queued = campaign(10);
  const f = fixture((path, options) => {
    if (path === `/api/broadcast/admin/campaigns/${queued.id}/summary`) return response(queued);
    if (path.endsWith("/cancel") && options.method === "POST") return pending.promise;
    if (path === "/api/broadcast/admin/activity") return response({ campaigns: [queued] });
    return null;
  });
  try {
    f.ui.campaigns.set(queued.id, queued); await f.ui.showCampaign(queued.id);
    const old = f.ui.detailState().detailElements, cancelling = f.ui.cancelCampaign(queued.id); await flush(); assert.equal(old.cancel.disabled, true);
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    f.document.visibilityState = "visible"; await f.ui.resumePrivate(); await flush();
    const fresh = f.ui.detailState().detailElements; assert.notStrictEqual(fresh, old); assert.equal(fresh.cancel.disabled, false);
    assert.equal(f.calls.filter(call => call.options.method === "POST").length, 1);
    pending.resolve(response({ ...queued, status: "cancelled", counts: counts("cancelled") })); await cancelling;
    assert.strictEqual(f.ui.detailState().detailElements, fresh); assert.equal(f.ui.campaigns.get(queued.id).status, "queued");
  } finally { pending.resolve(response(queued)); f.close(); }
});

test("a rate-limited history poll respects Retry-After before scheduling another read", async () => {
  const f = fixture((path) => path === "/api/broadcast/admin/activity" ? response({ error: "try_again_later" }, 429, { "retry-after": "180" }) : null);
  try {
    await f.ui.loadHistory(); f.ui.scheduleHistory();
    const polls = [...f.timers.values()].filter((timer) => timer.delay >= 179000 && timer.delay <= 180000);
    assert.equal(polls.length, 1);
    assert.equal([...f.timers.values()].filter((timer) => timer.delay === 30000).length, 0);
  } finally { f.close(); }
});

test("a rate-limited selected detail also delays the next periodic history read", async () => {
  const f = fixture((path) => path === `/api/broadcast/admin/campaigns/${id(10)}/summary`
    ? response({ error: "try_again_later" }, 429, { "retry-after": "120" }) : null);
  try {
    await f.ui.loadHistory(); await f.ui.showCampaign(id(10)); f.ui.scheduleHistory();
    assert.equal([...f.timers.values()].filter((timer) => timer.delay >= 119000 && timer.delay <= 120000).length, 1);
    assert.equal([...f.timers.values()].filter((timer) => timer.delay === 30000).length, 0);
  } finally { f.close(); }
});

test("a manual detail rate limit also postpones a history timer which was already scheduled", async () => {
  const f = fixture((path) => path === `/api/broadcast/admin/campaigns/${id(10)}/summary`
    ? response({ error: "try_again_later" }, 429, { "retry-after": "120" }) : null);
  try {
    await f.ui.loadHistory(); f.ui.scheduleHistory();
    await f.ui.showCampaign(id(10)); const before = f.calls.length;
    await f.poll();
    assert.equal(f.calls.length, before, "the existing timer checks the new retry deadline before any read");
    assert.equal([...f.timers.values()].filter((timer) => timer.delay >= 119000 && timer.delay <= 120000).length, 1);
  } finally { f.close(); }
});

const manyCounts = (total, delivered = 0) => ({ total, pending: total - delivered, sending: 0, delivered, skipped: 0, cancelled: 0, failed: 0 });
const recipientRows = (start, length) => Array.from({ length }, (_, index) => ({ conversationId: id(start + index), client: { id: id(start + index + 5000), pseudonym: `Synthetic client ${start + index}` }, state: "pending", reason: null, messageId: null, deliveredAt: null }));
const recipientPage = (campaignId, rows, hasMore = false) => ({ campaignId, recipients: rows, hasMore, nextCursor: hasMore ? rows.at(-1).conversationId : null });
const largeActor = () => ({ ...actor(), largeAudiencesEnabled: true });

test("selected recipients progress 1 to 2 to 1, prepare their exact edited content and send with one final action", async () => {
  const creates = [], previews = []; let stored;
  const f = fixture((path, options) => {
    if (path === "/api/broadcast/admin/preview") {
      const input = JSON.parse(options.body); previews.push(input);
      const ids = input.audience.conversationIds;
      return response({ recipients: ids.map(conversationId => ({ conversationId, client: { id: id(1000 + Number.parseInt(conversationId, 16)), pseudonym: "Synthetic client" }, eligible: true, reason: null, repeatMedia: false })),
        totalCount: ids.length, eligibleCount: ids.length, excludedCount: 0, repeatCount: 0, previewToken: `v1.prepared.${previews.length}` });
    }
    if (path === "/api/broadcast/admin/campaigns" && options.method === "POST") {
      const input = JSON.parse(options.body); creates.push(input);
      stored = campaign(60, { ...input, formatVersion: 2, audienceMode: "selected", counts: manyCounts(input.audience.conversationIds.length) });
      return response({ campaign: stored, duplicate: false }, 201);
    }
    if (path === `/api/broadcast/admin/campaigns/${id(60)}/summary`) return response(stored);
    return null;
  }, largeActor());
  const choose = (index, checked) => {
    const checkbox = f.node("contacts").querySelectorAll("input")[index]; checkbox.checked = checked;
    checkbox.listeners.get("change")();
  };
  try {
    for (const value of [1, 2]) f.ui.state.contacts.set(id(value), { id: id(value), client: { id: id(value + 1000), pseudonym: `Synthetic ${value}` }, nickname: "", canSend: true });
    model.updateComposition(f.ui.state, { title: "Synthetic selection", body: "First synthetic body" }); f.ui.renderSelection();
    choose(0, true);
    assert.match(f.node("selected-count").textContent, /^1 destinataire choisi$/);
    assert.match(f.node("acknowledge-label").textContent, /^1 destinataire choisi · à vérifier\.$/);
    assert.equal(f.node("confirm").disabled, true);
    await f.ui.preview(); assert.equal(f.node("confirm").disabled, false); assert.match(f.node("confirm").textContent, /^Envoyer à 1 client$/);
    assert.equal(creates.length, 0, "preparation does not send");
    choose(1, true); assert.equal(f.ui.state.preview, null); assert.match(f.node("acknowledge-label").textContent, /^2 destinataires choisis/); assert.equal(f.node("confirm").disabled, true);
    await f.ui.preview(); assert.match(f.node("confirm").textContent, /^Envoyer à 2 clients$/);
    choose(0, false); assert.equal(f.ui.state.selected.size, 1); assert.match(f.node("acknowledge-label").textContent, /^1 destinataire choisi/);
    await f.ui.preview(); assert.equal(f.node("confirm").disabled, false);
    f.node("campaign-body").value = "Edited synthetic body"; f.node("campaign-body").listeners.get("input")();
    assert.equal(f.ui.state.preview, null); assert.equal(f.node("confirm").disabled, true);
    await f.ui.send(); assert.equal(creates.length, 0, "a content edit must be prepared again");
    await f.ui.preview(); assert.equal(f.node("confirm").disabled, false); assert.equal(f.ui.state.acknowledged, false);
    await f.ui.send();
    assert.equal(creates.length, 1); assert.equal(creates[0].body, "Edited synthetic body");
    assert.deepEqual(creates[0].audience.conversationIds, [id(2)]); assert.equal(creates[0].previewToken, "v1.prepared.4");
    assert.equal(f.ui.state.pending, null); assert.equal(f.ui.state.selected.size, 0);
  } finally { f.close(); }
});

test("zero eligible recipients and a late preparation for an old selection never enable send", async () => {
  const held = deferred(); let calls = 0;
  const f = fixture(path => path === "/api/broadcast/admin/preview" ? (++calls === 1 ? held.promise : response({ recipients: [{ conversationId: id(2), client: { id: id(1002), pseudonym: "Unavailable synthetic client" }, eligible: false, reason: "access_inactive", repeatMedia: false }], totalCount: 1, eligibleCount: 0, excludedCount: 1, repeatCount: 0, previewToken: "v1.none.signature" })) : null, largeActor());
  try {
    for (const value of [1, 2]) f.ui.state.contacts.set(id(value), { id: id(value), client: { id: id(value + 1000), pseudonym: "Synthetic" }, nickname: "", canSend: true });
    model.selectRecipient(f.ui.state, id(1), true); model.updateComposition(f.ui.state, { title: "Synthetic", body: "Synthetic body" });
    const old = f.ui.preview(); await flush();
    model.selectRecipient(f.ui.state, id(1), false); model.selectRecipient(f.ui.state, id(2), true); f.ui.renderSelection();
    held.resolve(response({ recipients: [{ conversationId: id(1), client: { id: id(1001), pseudonym: "Old synthetic selection" }, eligible: true, reason: null, repeatMedia: false }], totalCount: 1, eligibleCount: 1, excludedCount: 0, repeatCount: 0, previewToken: "v1.old.signature" }));
    await old; assert.equal(f.ui.state.preview, null); assert.equal(f.node("confirm").disabled, true);
    await f.ui.preview(); assert.equal(f.node("confirm").disabled, true);
    assert.equal(f.node("acknowledge-label").textContent, "Aucun destinataire éligible pour cet envoi.");
    await f.ui.send(); assert.equal(f.calls.some(call => call.path === "/api/broadcast/admin/campaigns" && call.options.method === "POST"), false);
  } finally { f.close(); }
});

test("global2500 preview and a lost POST response retain one immutable confirmation while scope controls stay frozen", async () => {
  let stored = null, first = true; const posts = [];
  const f = fixture((path, options) => {
    if (path === "/api/broadcast/admin/preview") return response({ recipients: recipientRows(1, 50).map(row => ({ conversationId: row.conversationId, client: row.client, eligible: true, reason: null, repeatMedia: false })), totalCount: 2500, eligibleCount: 2500, excludedCount: 0, repeatCount: 0, previewToken: "v1.opaque.signature" });
    if (path === "/api/broadcast/admin/campaigns" && options.method === "POST") {
      posts.push(options.body); const input = JSON.parse(options.body);
      stored ??= campaign(60, { ...input, formatVersion: 2, audienceMode: "all", counts: manyCounts(2500) });
      if (first) { first = false; throw new Error("synthetic lost response"); }
      return response({ campaign: stored, duplicate: true });
    }
    if (path === `/api/broadcast/admin/campaigns/${id(60)}/summary`) return response(stored);
    if (path.startsWith(`/api/broadcast/admin/campaigns/${id(60)}/recipients?`)) return response(recipientPage(id(60), recipientRows(1, 50), true));
    return null;
  }, largeActor());
  try {
    model.updateAudience(f.ui.state, { mode: "all" }); model.updateComposition(f.ui.state, { title: "Synthetic global", body: "Private synthetic body" });
    await f.ui.preview(); assert.equal(f.node("preview-list").children.length, 50); assert.equal(f.ui.state.preview.eligibleCount, 2500);
    assert.equal(model.canConfirmBroadcast(f.ui.state), false); f.ui.state.acknowledged = true;
    await f.ui.send(); assert.equal(f.ui.state.pending.status, "uncertain"); assert.equal(f.node("audience-mode").disabled, true); assert.equal(f.node("composition").disabled, true);
    assert.equal(model.updateAudience(f.ui.state, { mode: "filtered" }), false); await f.ui.send(true);
    assert.equal(posts.length, 2); assert.equal(posts[0], posts[1]); assert.equal(JSON.parse(posts[0]).audience.mode, "all"); assert.equal(Object.hasOwn(JSON.parse(posts[0]), "conversationIds"), false);
    assert.equal(f.ui.state.pending, null); assert.equal(f.ui.state.audienceMode, "selected"); assert.equal(f.ui.campaigns.get(id(60)).counts.total, 2500);
  } finally { f.close(); }
});

test("contact pages replace50 rows, retain explicit choices and preserve checkbox focus", async () => {
  const f = fixture(path => {
    if (path.startsWith("/api/admin/crm/contacts?")) {
      const after = new URL(path, "https://synthetic.invalid").searchParams.get("afterId"), start = after ? 51 : 1;
      return response({ contacts: recipientRows(start, 50).map(row => ({ id: row.conversationId, client: row.client, crm: { nickname: "" }, canSend: true })), hasMore: !after, nextCursor: after ? null : id(50) });
    }
    return null;
  }, largeActor());
  try {
    await f.ui.loadContacts(); const checkbox = f.node("contacts").children[0].children[0]; checkbox.checked = true; checkbox.focus(); checkbox.listeners.get("change")();
    assert.equal(f.document.activeElement.getAttribute("data-conversation-id"), id(1));
    await f.ui.loadContacts(true); assert.equal(f.ui.state.contacts.size, 50); assert.equal(f.node("contacts").children.length, 50); assert.equal(f.ui.state.contacts.has(id(1)), false); assert.equal(f.ui.state.selected.has(id(1)), true);
    await f.ui.loadContacts(true, true); assert.equal(f.node("contacts").children[0].children[0].checked, true);
    for (let value = 2; value <= 2500; value += 1) f.ui.state.selected.set(id(value), { id: id(value), pseudonym: `Synthetic ${value}` });
    f.ui.renderSelection(); assert.equal(f.node("selected").children.length, 50); assert.equal(f.node("selected-more").hidden, false);
    f.node("selected-more").listeners.get("click")(); assert.equal(f.node("selected").children.length, 50); assert.equal(f.node("selected-previous").hidden, false);
  } finally { f.close(); }
});

test("periodic summary polling keeps recipient rows and never refetches their page", async () => {
  let saved = campaign(70, { formatVersion: 2, audienceMode: "all", counts: manyCounts(2500) });
  const f = fixture(path => {
    if (path === `/api/broadcast/admin/campaigns/${id(70)}/summary`) return response(saved);
    if (path.startsWith(`/api/broadcast/admin/campaigns/${id(70)}/recipients?`)) return response(recipientPage(id(70), recipientRows(1, 50), true));
    if (path === "/api/broadcast/admin/activity") return response({ campaigns: [saved] });
    return null;
  }, largeActor());
  try {
    await f.ui.showCampaign(id(70)); const rows = [...f.ui.detailState().detailElements.list.children];
    saved = { ...saved, status: "running", updatedAt: now + 1, counts: manyCounts(2500, 1) };
    f.ui.scheduleHistory(); await f.poll();
    assert.equal(f.ui.campaigns.get(id(70)).counts.delivered, 1);
    assert.equal(f.calls.filter(call => call.path.includes("/recipients?")).length, 1);
    assert.deepEqual(f.ui.detailState().detailElements.list.children, rows);
  } finally { f.close(); }
});

test("redaction invalidates an in-flight recipient page and a late snapshot cannot restore its removed client", async () => {
  const oldPage = deferred(); let requestCount = 0;
  let saved = campaign(80, { formatVersion: 2, audienceMode: "all", counts: manyCounts(101) });
  const f = fixture(path => {
    if (path === `/api/broadcast/admin/campaigns/${id(80)}/summary`) return response(saved);
    if (path.startsWith(`/api/broadcast/admin/campaigns/${id(80)}/recipients?`)) {
      requestCount += 1; if (path.includes("afterId")) return oldPage.promise;
      return response(recipientPage(id(80), recipientRows(1, 50), true));
    }
    return null;
  }, largeActor());
  try {
    await f.ui.showCampaign(id(80)); const loading = f.ui.loadRecipientPage("next"); await flush();
    saved = { ...saved, counts: manyCounts(100) }; f.ui.rememberCampaign(model.parseCampaign(saved)); await flush();
    oldPage.resolve(response(recipientPage(id(80), recipientRows(51, 50), true))); await loading; await flush();
    assert.equal(requestCount, 3); assert.equal(f.ui.detailState().recipientAfter, null);
    assert.equal(f.ui.detailState().recipientPage.recipients[0].conversationId, id(1));
    assert.equal(f.ui.detailState().recipientPage.recipients.some(row => row.conversationId === id(60)), false);
    f.ui.rememberCampaign(model.parseCampaign({ ...saved, updatedAt: now + 1000, counts: manyCounts(101) }));
    assert.equal(f.ui.campaigns.get(id(80)).counts.total, 100);
  } finally { f.close(); }
});

test("a removed campaign summary404 purges its selected page without any legacy-detail fallback", async () => {
  let missing = false; const saved = campaign(90);
  const f = fixture(path => path === `/api/broadcast/admin/campaigns/${id(90)}/summary` ? response(missing ? { error: "not_found" } : saved, missing ? 404 : 200) : null);
  try {
    f.ui.renderControls(); assert.equal(f.node("audience-options").hidden, true);
    await f.ui.showCampaign(id(90)); assert.ok(f.ui.detailState().recipientPage);
    missing = true; await f.ui.showCampaign(id(90), true);
    assert.equal(f.ui.detailState().recipientPage, null); assert.equal(f.ui.campaigns.has(id(90)), false);
    assert.equal(f.calls.some(call => call.path === `/api/broadcast/admin/campaigns/${id(90)}`), false);
  } finally { f.close(); }
});

test("an edited filter clears the real confirmation even when canonical criteria stay identical", () => {
  const f = fixture(() => null, largeActor());
  try {
    model.updateAudience(f.ui.state, { filters: { q: "", tagId: null, groupId: null, access: "all", unread: false, reminder: "all" } });
    f.ui.state.contacts.set(id(99), { id: id(99), client: { id: id(98), pseudonym: "Synthetic client" }, nickname: "", canSend: true });
    model.selectRecipient(f.ui.state, id(99), true); model.updateComposition(f.ui.state, { title: "Synthetic confirmed draft", body: "Synthetic body" });
    model.acceptPreview(f.ui.state, model.previewTicket(f.ui.state), { recipients: [{ conversationId: id(99), client: { id: id(98), pseudonym: "Synthetic client" }, eligible: true, reason: null, repeatMedia: false }], totalCount: 1, eligibleCount: 1, excludedCount: 0, repeatCount: 0, previewToken: "v1.opaque.signature" });
    f.ui.state.acknowledged = true; f.ui.renderControls(); assert.equal(f.node("confirm").disabled, false);
    f.node("search").value = " "; f.node("filters").listeners.get("input")();
    assert.equal(f.ui.state.audienceFilters.q, ""); assert.equal(f.ui.state.preview, null);
    assert.equal(f.ui.state.acknowledged, false); assert.equal(f.node("confirm").disabled, true); assert.equal(model.canConfirmBroadcast(f.ui.state), false);
  } finally { f.close(); }
});

const videoActor = (value = 1) => ({ ...actor(value), largeAudiencesEnabled: true, videoEnabled: true });
function videoFixture(handler = () => null, owner = videoActor()) {
  const uploads = [], revoked = [], created = [];
  class Upload {
    constructor() { this.listeners = new Map(); this.headers = new Map(); this.upload = { addEventListener: (name, callback) => { this.progress = callback; } }; uploads.push(this); }
    open(method, path) { this.method = method; this.path = path; }
    setRequestHeader(name, value) { this.headers.set(name, value); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    send(file) { this.file = file; }
    abort() { this.aborted = true; this.listeners.get("abort")?.(); }
    complete(value = { id: id(77), bytes: this.file.size, mime: "video/mp4" }, status = 201) { this.responseText = JSON.stringify(value); this.status = status; this.listeners.get("load")?.(); }
  }
  class PreviewURL extends URL {
    static createObjectURL(file) { const value = `blob:synthetic-video-${created.length}`; created.push({ value, file }); return value; }
    static revokeObjectURL(value) { revoked.push(value); }
  }
  const f = fixture(handler, owner, { XMLHttpRequest: Upload, urlApi: PreviewURL });
  return { ...f, uploads, revoked, created, choose(file = { type: "video/mp4", size: 12536 }) {
    f.node("video-file").files = [file]; f.ui.chooseVideo();
    return f.node("video-preview").children[0];
  }, decode() { f.node("video-preview").children[0].listeners.get("loadedmetadata")(); } };
}

test("broadcast video is opt-in and rejects non-MP4, empty, oversized or over-caption selections before any upload", () => {
  const off = videoFixture(() => null, actor());
  try { off.ui.renderControls(); assert.equal(off.node("video-options").hidden, true); off.choose(); assert.equal(off.created.length, 0); assert.equal(off.uploads.length, 0); }
  finally { off.close(); }
  const f = videoFixture();
  try {
    for (const file of [{ type: "video/webm", size: 42 }, { type: "video/mp4", size: 0 }, { type: "video/mp4", size: 104857601 }]) {
      f.choose(file); assert.equal(f.created.length, 0); assert.match(f.node("video-status").textContent, /100 Mo/);
    }
    model.updateComposition(f.ui.state, { body: "x".repeat(1001) }); f.choose(); assert.equal(f.created.length, 0);
    assert.match(f.node("video-status").textContent, /1 000 caractères/); assert.equal(f.uploads.length, 0);
  } finally { f.close(); }
});

test("broadcast video waits for native preview and a session-bound upload ACK before previewing its typed audience and sending", async () => {
  const previews = [], sent = []; let saved;
  const f = videoFixture((path, options) => {
    if (path === "/api/broadcast/admin/preview") {
      previews.push(JSON.parse(options.body)); return response({ recipients: [{ conversationId: id(99), client: { id: id(98), pseudonym: "Synthetic client" }, eligible: true, reason: null, repeatMedia: false }], eligibleCount: 1, repeatCount: 0, totalCount: 1, excludedCount: 0, previewToken: "synthetic.video-preview" });
    }
    if (path === "/api/broadcast/admin/campaigns" && options.method === "POST") {
      const input = JSON.parse(options.body); sent.push(input); saved = campaign(50, { ...input, formatVersion: 3, audienceMode: "selected" }); return response({ campaign: saved, duplicate: false }, 201);
    }
    if (saved && path === `/api/broadcast/admin/campaigns/${saved.id}/summary`) return response(saved);
    return null;
  });
  try {
    compose(f.ui); const player = f.choose(); assert.equal(player.controls, true); assert.equal(player.preload, "metadata");
    assert.equal(f.ui.state.preview, null); assert.equal(f.node("upload-video").disabled, true); assert.equal(f.node("preview").disabled, true);
    await f.ui.uploadVideo(); assert.equal(f.uploads.length, 0); f.decode();
    await f.ui.preview(); assert.equal(previews.length, 0);
    const loading = f.ui.uploadVideo(); await flush(); const upload = f.uploads[0];
    assert.equal(upload.method, "POST"); assert.equal(upload.path, "/api/video/admin/assets"); assert.equal(upload.withCredentials, true); assert.equal(upload.timeout, 300000);
    assert.equal(upload.headers.get("Content-Type"), "video/mp4"); assert.equal(upload.headers.get("X-CSRF-Token"), actor().csrf);
    upload.progress({ loaded: upload.file.size / 2 }); assert.equal(f.node("video-progress").value, 50); assert.equal(f.node("cancel-video").hidden, false);
    assert.equal(f.node("preview").disabled, true); assert.equal(f.node("confirm").disabled, true); assert.equal(f.ui.state.draft.videoId, null);
    upload.complete(); await loading;
    assert.equal(f.ui.state.draft.videoId, id(77)); assert.equal(f.node("upload-video").hidden, true); assert.equal(f.node("video-progress").hidden, true);
    await f.ui.uploadVideo(); assert.equal(f.uploads.length, 1, "an acknowledged upload is never sent again");
    await f.ui.preview(); assert.deepEqual(previews, [{ audience: { mode: "selected", conversationIds: [id(99)] }, mediaId: null, videoId: id(77) }]);
    f.ui.state.acknowledged = true; await f.ui.send();
    assert.equal(sent.length, 1); assert.equal(sent[0].videoId, id(77)); assert.equal(sent[0].mediaId, null); assert.equal(sent[0].previewToken, "synthetic.video-preview");
    assert.equal(f.ui.campaigns.get(saved.id).videoId, id(77)); assert.equal(f.ui.videoState().videoDraft, null); assert.equal(f.revoked.length, 1);
    assert.equal(f.ui.detailState().detailElements.photo.textContent, "Une vidéo jointe");
  } finally { f.close(); }
});

test("broadcast cancelled, malformed and lost uploads never attach a video or retry automatically", async (t) => {
  for (const failure of ["cancel", "network", "wrong-size", "extra-field"]) await t.test(failure, async () => {
    const f = videoFixture();
    try {
      compose(f.ui); f.choose(); f.decode(); const loading = f.ui.uploadVideo(); await flush(); const upload = f.uploads[0];
      if (failure === "cancel") { f.ui.cancelVideoUpload(); assert.equal(upload.aborted, true); assert.equal(f.node("cancel-video").hidden, true); }
      else if (failure === "network") upload.listeners.get("error")();
      else upload.complete({ id: id(77), bytes: failure === "wrong-size" ? 1 : upload.file.size, mime: "video/mp4", ...(failure === "extra-field" ? { untrusted: true } : {}) });
      await loading; assert.equal(f.ui.state.draft.videoId, null); assert.equal(f.node("preview").disabled, true); assert.equal(f.node("upload-video").hidden, true);
      await f.ui.uploadVideo(); await f.ui.preview(); await f.ui.send();
      assert.equal(f.uploads.length, 1); assert.equal(f.calls.some(call => call.options.method === "POST"), false);
      assert.match(f.node("video-status").textContent, failure === "cancel" ? /annulé/ : /pas été confirmé/);
      f.ui.removeVideo(); assert.equal(f.ui.videoState().videoDraft, null); assert.equal(f.revoked.length, 1);
    } finally { f.close(); }
  });
});

test("video upload acknowledgement under a changed account is discarded and suspension keeps the local file without replaying an ambiguous upload", async () => {
  const f = videoFixture();
  try {
    f.choose(); f.decode(); const loading = f.ui.uploadVideo(); await flush(); f.setOwner(videoActor(2)); f.uploads[0].complete(); await loading; await flush();
    assert.equal(f.ui.state.session.id, id(2)); assert.equal(f.ui.state.draft.videoId, undefined); assert.equal(f.ui.videoState().videoDraft, null); assert.equal(f.revoked.length, 1);
    f.choose(); f.decode(); const second = f.ui.uploadVideo(); await flush();
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange"); await second;
    assert.equal(f.uploads[1].aborted, true); assert.equal(f.ui.state.session.id, id(2)); assert.equal(f.ui.videoState().videoDraft.failed, true); assert.equal(f.revoked.length, 2);
    assert.equal(f.node("video-preview").children.length, 0); assert.equal(f.node("broadcast-content").hidden, true);
    f.document.visibilityState = "visible"; f.dispatchDocument("visibilitychange"); await flush(); f.decode();
    await f.ui.uploadVideo(); assert.equal(f.uploads.length, 2); assert.equal(f.ui.videoState().videoDraft.id, null);
    assert.equal(f.node("broadcast-content").hidden, false); assert.match(f.node("video-status").textContent, /pas été confirmé/);
  } finally { f.close(); }
});

test("a confirmed video survives suspension and local preview callbacks bind to the resumed session", async () => {
  const f = videoFixture();
  try {
    compose(f.ui); f.choose(); f.decode(); const loading = f.ui.uploadVideo(); await flush(); f.uploads[0].complete(); await loading;
    const draft = f.ui.videoState().videoDraft, oldPlayer = f.node("video-preview").children[0];
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    assert.equal(f.ui.state.draft.videoId, id(77)); assert.strictEqual(f.ui.videoState().videoDraft, draft); assert.equal(f.revoked.length, 1);
    f.document.visibilityState = "visible"; await f.ui.resumePrivate();
    const newPlayer = f.node("video-preview").children[0]; assert.notStrictEqual(newPlayer, oldPlayer); assert.equal(draft.ready, false);
    oldPlayer.listeners.get("loadedmetadata")(); assert.equal(draft.ready, false, "old media events remain stale");
    f.decode(); assert.equal(draft.ready, true); await f.ui.uploadVideo(); assert.equal(f.uploads.length, 1);
    assert.equal(f.ui.state.draft.videoId, id(77)); assert.equal(f.created.length, 2);
    f.ui.clearPrivate(); assert.equal(f.ui.videoState().videoDraft, null); assert.equal(f.ui.state.pending, null); assert.equal(f.revoked.length, 2);
  } finally { f.close(); }
});


test("broadcast history replaces archive pages and polling windows while retaining the selected detail and composition", async () => {
  let activityRound = 0;
  const finished = value => campaign(value, { status: "completed", counts: counts("delivered") });
  const f = fixture(path => {
    if (path === "/api/broadcast/admin/activity") return response({ campaigns: Array.from({ length: 30 }, (_, index) => finished(10000 + activityRound * 30 + index)) });
    if (path.startsWith("/api/broadcast/admin/campaigns?")) {
      const after = new URL(path, "https://fixture.invalid").searchParams.get("afterId");
      const start = after ? Number.parseInt(after, 16) + 1 : 1000;
      const rows = Array.from({ length: 20 }, (_, index) => finished(start + index));
      return response({ campaigns: rows, nextCursor: rows.at(-1).id, hasMore: true });
    }
    if (path === `/api/broadcast/admin/campaigns/${id(70000)}/summary`) return response(finished(70000));
    return null;
  });
  try {
    model.updateComposition(f.ui.state, { title: "Unsent title", body: "Unsent body" });
    await f.ui.loadHistory(); await f.ui.showCampaign(id(70000));
    assert.equal(f.ui.campaigns.size, 51);
    for (let index = 0; index < 15; index++) {
      await f.ui.loadHistory(true); assert.equal(f.ui.campaigns.size, 51);
      activityRound++; await f.ui.loadHistory();
      assert.equal(f.ui.campaigns.size, 51); assert.equal(f.node("history").children.length, 51);
      assert.equal(f.ui.campaigns.has(id(70000)), true, "the selected detail remains pinned outside either window");
    }
    assert.equal(f.ui.campaigns.has(id(1000)), false); assert.equal(f.ui.campaigns.has(id(10000)), false);
    assert.equal(f.ui.state.draft.body, "Unsent body");
    await f.ui.loadHistory(true, { back: true });
    assert.equal(f.ui.campaigns.has(id(1280)), true); assert.equal(f.ui.campaigns.has(id(1300)), false);
    assert.match(f.node("history-page").textContent, /15/);
    f.node("first-history").listeners.get("click")(); await flush();
    assert.equal(f.ui.campaigns.has(id(1000)), true); assert.equal(f.node("previous-history").hidden, true);
    assert.equal(f.ui.campaigns.has(id(70000)), true);
  } finally { f.close(); }
});

test("the broadcast photo chooser keeps one replaceable page plus its selected photo without changing its preview", async () => {
  const f = fixture(path => {
    if (!path.startsWith("/api/media/admin/assets?")) return null;
    const after = new URL(path, "https://fixture.invalid").searchParams.get("afterId"), start = after ? Number.parseInt(after, 16) + 1 : 2000;
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: id(start + index), createdAt: now, width: 640, height: 480, thumbnailUrl: `/api/media/admin/assets/${id(start + index)}/thumb` }));
    return response({ assets: rows, nextCursor: rows.at(-1).id, hasMore: true });
  });
  try {
    await f.ui.loadPhotos(); model.updateComposition(f.ui.state, { mediaId: id(2000) });
    const preview = new FakeNode("img"); f.node("photo-preview").append(preview);
    for (let index = 0; index < 15; index++) {
      await f.ui.loadPhotos(true);
      assert.equal(f.ui.assets.size, 21); assert.equal(f.node("photo-grid").children.length, 21, "20 thumbnail rows plus selected photo");
      assert.equal(f.ui.state.draft.mediaId, id(2000));
      assert.strictEqual(f.node("photo-preview").children[0], preview);
    }
    assert.equal(f.ui.assets.has(id(2001)), false);
    await f.ui.loadPhotos(true, true); assert.equal(f.ui.assets.has(id(2280)), true);
    f.node("first-photos").listeners.get("click")(); await flush();
    assert.equal(f.ui.assets.size, 20); assert.equal(f.node("previous-photos").hidden, true);
    assert.equal(f.ui.state.draft.mediaId, id(2000));
  } finally { f.close(); }
});


test("a completed campaign retained by the archive receives final counters when it leaves the activity window", async () => {
  let ended = false;
  const queued = campaign(10), completed = campaign(10, { status: "completed", updatedAt: now, counts: counts("delivered") });
  const f = fixture(path => {
    if (path === "/api/broadcast/admin/activity") return response({ campaigns: ended ? [] : [queued] });
    if (path.startsWith("/api/broadcast/admin/campaigns?")) return response({ campaigns: [queued], hasMore: false, nextCursor: null });
    if (path === `/api/broadcast/admin/campaigns/${queued.id}/summary`) return response(completed);
    return null;
  });
  try {
    await f.ui.loadHistory(); ended = true; await f.ui.loadHistory();
    assert.equal(f.ui.campaigns.size, 1); assert.equal(f.ui.campaigns.get(queued.id).status, "completed");
    assert.equal(f.ui.campaigns.get(queued.id).counts.delivered, 1);
  } finally { f.close(); }
});

test("broadcast photo library displays real thumbnails, uses pressed buttons and revokes private previews when hidden", async () => {
  const created = [], revoked = [], picture = new Blob(["synthetic thumbnail"], { type: "image/jpeg" });
  const photo = value => ({ id: id(value), createdAt: now, width: 640, height: 480, thumbnailUrl: `/api/media/admin/assets/${id(value)}/thumb` });
  const f = fixture(path => {
    if (path.startsWith("/api/media/admin/assets?")) return response({ assets: [photo(501), photo(502)], nextCursor: null, hasMore: false });
    if (path.endsWith("/thumb")) return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => picture };
    return null;
  }, actor(), { urlApi: { createObjectURL(blob) { created.push(blob); return `blob:photo-${created.length}`; }, revokeObjectURL(url) { revoked.push(url); } } });
  try {
    compose(f.ui); await f.ui.loadPhotos(); await flush();
    const buttons = f.node("photo-grid").children;
    assert.equal(buttons.length, 2);
    assert.deepEqual(buttons.map(button => button.children[0].hidden), [false, false]);
    assert.ok(buttons.every(button => button.children[0].src.startsWith("blob:photo-")));
    assert.ok(buttons.every(button => button.getAttribute("aria-pressed") === "false"));
    buttons[1].listeners.get("click")(); await flush();
    assert.equal(f.ui.state.draft.mediaId, id(502)); assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
    assert.equal(f.ui.state.preview, null, "a new photo requires an explicit new recipient check");
    assert.equal(f.calls.filter(call => call.options.method === "POST").length, 0, "choosing a thumbnail sends nothing");
    f.document.visibilityState = "hidden"; f.ui.suspendPrivate();
    assert.equal(f.node("photo-grid").children.length, 0); assert.equal(f.node("photo-preview").children.length, 0);
    assert.equal(revoked.length, created.length);
  } finally { f.close(); }
});

test("broadcast thumbnail pages use at most four readers and never adopt blobs belonging to a changed account", async () => {
  let active = 0, maximum = 0, urls = 0; const held = [];
  const rows = Array.from({ length: 8 }, (_, index) => ({ id: id(600 + index), createdAt: now, width: 640, height: 480, thumbnailUrl: `/api/media/admin/assets/${id(600 + index)}/thumb` }));
  const f = fixture(async (path, _options, session) => {
    if (path.startsWith("/api/media/admin/assets?")) return response({ assets: rows, nextCursor: null, hasMore: false });
    if (path.endsWith("/thumb")) {
      active++; maximum = Math.max(maximum, active); const gate = deferred(); held.push(gate); await gate.promise; active--;
      if (path.includes(id(607))) session.setOwner(actor(2));
      return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => new Blob(["synthetic"], { type: "image/jpeg" }) };
    }
    return null;
  }, actor(), { urlApi: { createObjectURL() { urls++; return "blob:forbidden"; }, revokeObjectURL() {} } });
  try {
    await f.ui.loadPhotos(); await flush(); assert.equal(held.length, 4); assert.equal(maximum, 4); assert.equal(urls, 0);
    for (const item of held.slice()) item.resolve(); await flush(); assert.equal(held.length, 8); assert.equal(maximum, 4);
    for (const item of held.slice(4)) item.resolve(); await flush();
    assert.equal(urls, 0, "closing owner proof precedes every thumbnail object URL");
    assert.equal(f.ui.state.session.id, id(2)); assert.equal(f.ui.assets.size, 0); assert.equal(f.node("photo-grid").children.length, 0);
  } finally { for (const item of held) item.resolve(); f.close(); }
});

test("late thumbnails from a replaced photo page cannot create old object URLs", async () => {
  const gate = deferred(), created = [];
  const first = { id: id(701), createdAt: now, width: 640, height: 480, thumbnailUrl: `/api/media/admin/assets/${id(701)}/thumb` };
  const second = { ...first, id: id(702), thumbnailUrl: `/api/media/admin/assets/${id(702)}/thumb` };
  const old = new Blob(["old page"]), fresh = new Blob(["current page"]);
  const f = fixture(async path => {
    if (path === "/api/media/admin/assets?limit=20") return response({ assets: [first], nextCursor: first.id, hasMore: true });
    if (path.startsWith("/api/media/admin/assets?limit=20&")) return response({ assets: [second], nextCursor: null, hasMore: false });
    if (path === first.thumbnailUrl) { await gate.promise; return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => old }; }
    if (path === second.thumbnailUrl) return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => fresh };
    return null;
  }, actor(), { urlApi: { createObjectURL(blob) { created.push(blob); return `blob:${created.length}`; }, revokeObjectURL() {} } });
  try {
    await f.ui.loadPhotos(); await flush(); await f.ui.loadPhotos(true); await flush(); gate.resolve(); await flush();
    assert.deepEqual(created, [fresh]); assert.equal(f.node("photo-grid").children[0].getAttribute("data-photo-id"), second.id);
  } finally { gate.resolve(); f.close(); }
});

test("adding a photo in broadcasts uploads the prepared image once, selects its preview and never sends a campaign", async () => {
  const original = new Blob(["synthetic camera original"], { type: "image/png" });
  const prepared = new Blob(["synthetic prepared pixels"], { type: "image/png" }); let preparations = 0;
  const asset = { id: id(801), createdAt: now, width: 1024, height: 768, thumbnailUrl: `/api/media/admin/assets/${id(801)}/thumb` };
  const f = fixture((path, options) => {
    if (path === "/api/media/admin/assets" && options.method === "POST") return response({ asset, duplicate: false }, 201);
    if (path.endsWith("/thumb")) return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, blob: async () => new Blob(["thumbnail"], { type: "image/jpeg" }) };
    return null;
  }, actor(), { prepare: async file => { assert.strictEqual(file, original); preparations++; return prepared; } });
  try {
    compose(f.ui); const title = f.ui.state.draft.title, body = f.ui.state.draft.body;
    await f.ui.uploadPhoto(original); await flush();
    const writes = f.calls.filter(call => call.options.method === "POST");
    assert.equal(preparations, 1); assert.equal(writes.length, 1); assert.equal(writes[0].path, "/api/media/admin/assets");
    assert.strictEqual(writes[0].options.body, prepared); assert.equal(writes[0].options.headers["Content-Type"], "image/png");
    assert.equal(writes[0].options.headers["X-CSRF-Token"], actor().csrf);
    assert.equal(f.ui.state.draft.mediaId, asset.id); assert.equal(f.ui.state.draft.title, title); assert.equal(f.ui.state.draft.body, body);
    assert.equal(f.ui.state.preview, null); assert.equal(f.ui.state.selected.size, 1);
    assert.equal(f.node("photo-grid").children[0].getAttribute("aria-pressed"), "true");
    assert.equal(f.node("photo-preview").children.length, 1); assert.equal(f.node("photo-file").value, "");
  } finally { f.close(); }
});

test("a changed account after photo upload cannot adopt its asset or send a broadcast", async () => {
  const asset = { id: id(901), createdAt: now, width: 640, height: 480, thumbnailUrl: `/api/media/admin/assets/${id(901)}/thumb` };
  const f = fixture((path, options, session) => {
    if (path === "/api/media/admin/assets" && options.method === "POST") { session.setOwner(actor(2)); return response({ asset, duplicate: false }, 201); }
    return null;
  });
  try {
    compose(f.ui); await f.ui.uploadPhoto(new Blob(["photo"], { type: "image/jpeg" })); await flush();
    assert.equal(f.ui.state.session.id, id(2)); assert.equal(f.ui.assets.size, 0); assert.equal(f.ui.state.draft.mediaId, null);
    assert.equal(f.calls.filter(call => call.options.method === "POST").length, 1);
    assert.equal(f.node("photo-preview").children.length, 0);
  } finally { f.close(); }
});

test("cancelling photo preparation retains the previous attachment and never uploads a late result", async () => {
  const gate = deferred(); const f = fixture(() => null, actor(), { prepare: () => gate.promise });
  try {
    compose(f.ui); f.ui.state.draft.mediaId = id(1001); const preview = f.ui.state.preview;
    const upload = f.ui.uploadPhoto(new Blob(["photo"], { type: "image/jpeg" })); await flush();
    assert.equal(f.node("cancel-photo-upload").hidden, false); assert.equal(f.node("composition").disabled, false, "cancel stays operable");
    assert.equal(f.node("confirm").disabled, true);
    await f.ui.preview(); await f.ui.send();
    assert.equal(f.calls.filter(call => call.options.method === "POST").length, 0, "preparing a photo cannot preview or send an old attachment");
    f.ui.cancelPhotoUpload(); gate.resolve(new Blob(["prepared"], { type: "image/jpeg" })); await upload;
    assert.equal(f.ui.state.draft.mediaId, id(1001)); assert.strictEqual(f.ui.state.preview, preview);
    assert.equal(f.calls.filter(call => call.options.method === "POST").length, 0); assert.equal(f.node("cancel-photo-upload").hidden, true);
  } finally { gate.resolve(); f.close(); }
});

test("failed photo uploads preserve the previous attachment and require an explicit retry", async () => {
  const f = fixture((path, options) => path === "/api/media/admin/assets" && options.method === "POST" ? response({ error: "media_busy" }, 503) : null);
  try {
    compose(f.ui); f.ui.state.draft.mediaId = id(1101); const preview = f.ui.state.preview;
    await f.ui.uploadPhoto(new Blob(["photo"], { type: "image/jpeg" })); await flush();
    assert.equal(f.ui.state.draft.mediaId, id(1101)); assert.strictEqual(f.ui.state.preview, preview);
    assert.equal(f.calls.filter(call => call.options.method === "POST").length, 1); assert.equal(f.node("pick-photo").disabled, false);
  } finally { f.close(); }
});

test("a native photo picker keeps one explicit file through deferred resume proofs without replaying an interrupted upload", async () => {
  const proof = deferred(), posted = deferred(), original = new Blob(["selected photo"], { type: "image/jpeg" });
  let delayProof = true, preparations = 0;
  const f = fixture(async (path, options) => {
    if (path === "/api/auth/session" && delayProof) { await proof.promise; delayProof = false; }
    if (path === "/api/media/admin/assets" && options.method === "POST") { await posted.promise; throw new Error("lost_upload_response"); }
    return null;
  }, actor(), { prepare: async file => { assert.strictEqual(file, original); preparations++; return file; } });
  try {
    compose(f.ui); f.node("pick-photo").click();
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    f.document.visibilityState = "visible"; f.dispatchDocument("visibilitychange"); await flush();
    f.node("photo-file").files = [original]; f.node("photo-file").value = "synthetic-picked.jpeg";
    f.node("photo-file").listeners.get("change")(); await flush();
    assert.equal(f.node("photo-file").value, ""); assert.equal(preparations, 0);
    assert.equal(f.calls.filter(call => call.options.method === "POST").length, 0, "no upload before the closing resume proof");
    proof.resolve(); await flush();
    assert.equal(preparations, 1); assert.equal(f.calls.filter(call => call.options.method === "POST").length, 1);
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    f.document.visibilityState = "visible"; await f.ui.resumePrivate(); await flush();
    posted.resolve(); await flush();
    assert.equal(preparations, 1); assert.equal(f.calls.filter(call => call.options.method === "POST").length, 1, "an interrupted POST never becomes a queued file");
  } finally { proof.resolve(); posted.resolve(); f.close(); }
});

test("a native photo selection is discarded if either the owner or CSRF changes during deferred resume", async t => {
  for (const next of [actor(2), { ...actor(), csrf: "z".repeat(43) }]) await t.test(next.user.id === id(2) ? "different account" : "new login for the same account", async () => {
    const proof = deferred(); let delayProof = true, preparations = 0;
    const f = fixture(async path => {
      if (path === "/api/auth/session" && delayProof) { await proof.promise; delayProof = false; }
      return null;
    }, actor(), { prepare: async file => { preparations++; return file; } });
    try {
      compose(f.ui); f.node("pick-photo").click();
      f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
      f.document.visibilityState = "visible"; f.dispatchDocument("visibilitychange"); await flush();
      f.node("photo-file").files = [new Blob(["private previous-owner photo"], { type: "image/jpeg" })];
      f.node("photo-file").listeners.get("change")(); f.setOwner(next); proof.resolve(); await flush();
      assert.equal(f.ui.state.session.id, next.user.id); assert.equal(f.ui.state.session.csrf, next.csrf);
      assert.equal(preparations, 0); assert.equal(f.calls.filter(call => call.options.method === "POST").length, 0);
      // A delayed native event after the account bootstrap has no original
      // picker owner and cannot adopt the new account as a fallback.
      f.node("photo-file").listeners.get("change")(); await flush();
      assert.equal(preparations, 0); assert.equal(f.calls.filter(call => call.options.method === "POST").length, 0);
    } finally { proof.resolve(); f.close(); }
  });
});

test("photo POST uncertainty preserves the previous selection and never claims a confirmed failure or retries", async t => {
  for (const failure of ["network", "proof", "server"]) await t.test(failure, async () => {
    let posted = false;
    const f = fixture((path, options) => {
      if (path === "/api/media/admin/assets" && options.method === "POST") {
        posted = true;
        if (failure === "network") throw new Error("lost_upload_response");
        return response({ error: "unconfirmed" }, failure === "server" ? 503 : 201);
      }
      if (path === "/api/broadcast/admin/session" && posted && failure === "proof") return response({ error: "unconfirmed_proof" }, 403);
      return null;
    });
    try {
      compose(f.ui); f.ui.state.draft.mediaId = id(1201); const preview = f.ui.state.preview;
      await f.ui.uploadPhoto(new Blob(["photo"], { type: "image/jpeg" })); await flush();
      assert.equal(f.ui.state.draft.mediaId, id(1201)); assert.strictEqual(f.ui.state.preview, preview);
      assert.equal(f.calls.filter(call => call.options.method === "POST").length, 1);
      assert.equal(f.node("photo-status").textContent, "L’ajout de la photo n’a pas été confirmé. Ta sélection précédente est conservée ; consulte la bibliothèque avant de réessayer.");
      await f.ui.resumePrivate(); await flush();
      assert.equal(f.calls.filter(call => call.options.method === "POST").length, 1);
    } finally { f.close(); }
  });
});

test("an explicit rejected photo POST remains a confirmed failure", async () => {
  const f = fixture((path, options) => path === "/api/media/admin/assets" && options.method === "POST" ? response({ error: "invalid_media" }, 400) : null);
  try {
    compose(f.ui); await f.ui.uploadPhoto(new Blob(["photo"], { type: "image/jpeg" })); await flush();
    assert.equal(f.node("photo-status").textContent, "La photo n’a pas été ajoutée. Ta sélection précédente est conservée ; choisis de nouveau une photo pour réessayer.");
    assert.equal(f.calls.filter(call => call.options.method === "POST").length, 1);
  } finally { f.close(); }
});
