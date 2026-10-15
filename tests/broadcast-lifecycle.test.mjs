import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";
import { webcrypto } from "node:crypto";
import * as model from "../public/broadcast-model.js";

const source = (await readFile(new URL("../public/broadcast.js", import.meta.url), "utf8")).replace(/^import .*;\n/, "");
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
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.hidden = false; this.disabled = false; this.checked = false; this.value = ""; this.listeners = new Map(); this.classList = { toggle() {} }; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text ?? ""; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  reset() {}
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  querySelectorAll(tag) { return this.children.flatMap((node) => node instanceof FakeNode ? [...(node.tagName === tag ? [node] : []), ...node.querySelectorAll(tag)] : []); }
}
function fixture(handler = () => null) {
  const nodes = new Map(), calls = [], timers = new Map(), documentEvents = new Map(), windowEvents = new Map(); let timerId = 0; let owner = actor();
  const node = (name) => { if (!nodes.has(name)) nodes.set(name, new FakeNode()); return nodes.get(name); };
  const document = { visibilityState: "hidden", getElementById: node, createElement: (tag) => new FakeNode(tag), addEventListener(name, callback) { documentEvents.set(name, callback); } };
  const context = createContext({ ...model, document, window: { addEventListener(name, callback) { windowEvents.set(name, callback); } }, location: { replace() {} },
    AbortController, URL, URLSearchParams, TextEncoder, Date, console, crypto: webcrypto,
    setTimeout(callback, delay) { const timer = ++timerId; timers.set(timer, { callback, delay }); return timer; }, clearTimeout(timer) { timers.delete(timer); },
    fetch: async (path, options) => {
      calls.push({ path, options });
      const customized = await handler(path, options, { owner, setOwner: (next) => { owner = next; } });
      if (customized) return customized;
      if (path === "/api/broadcast/admin/session") return response(owner);
      if (path === "/api/broadcast/admin/activity") return response({ campaigns: [] });
      if (path.startsWith("/api/broadcast/admin/campaigns?")) return response({ campaigns: [], nextCursor: null, hasMore: false });
      if (path.startsWith("/api/admin/crm/contacts?")) return response({ contacts: [], nextCursor: null, hasMore: false });
      if (path.startsWith("/api/admin/crm/labels?")) return response({ labels: [], nextCursor: null, hasMore: false });
      return response({ error: "not_found" }, 404);
    } });
  new Script(`${source}\nglobalThis.controller = { state, campaigns, assets, request, loadHistory, loadContacts, preview, loadPhotos, showPhoto, showCampaign, cancelCampaign, send, bootstrap, clearPrivate, scheduleHistory, busy: () => ({ historyBusy, sendBusy }) };`).runInContext(context);
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
  model.acceptPreview(ui.state, model.previewTicket(ui.state), { recipients: [{ conversationId: id(99), client: { id: id(98), pseudonym: "Synthetic client" }, eligible: true, reason: null, repeatMedia: false }], eligibleCount: 1, repeatCount: 0 });
  ui.state.acknowledged = true;
}

test("actual broadcast controller binds every private JSON response to the current account and CSRF proof", async (t) => {
  for (const path of ["/api/broadcast/admin/activity", "/api/broadcast/admin/campaigns?limit=20", `/api/broadcast/admin/campaigns/${id(10)}`,
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

test("activity refresh updates an old live campaign outside page one and discovers new random IDs from another window", async () => {
  const old = campaign(25); const ended = campaign(25, { status: "completed", updatedAt: now, counts: counts("delivered") });
  let newest = campaign(500, { createdAt: now, updatedAt: now });
  const oldPage = Array.from({ length: 20 }, (_, index) => campaign(index + 1, { status: "completed", counts: counts("delivered") }));
  const f = fixture((path) => {
    if (path === "/api/broadcast/admin/activity") return response({ campaigns: newest.id === id(21)
      ? [newest, campaign(500, { status: "completed", createdAt: now, updatedAt: now + 1, counts: counts("delivered") })] : [newest] });
    if (path === `/api/broadcast/admin/campaigns/${old.id}`) return response(detail(ended));
    if (path === "/api/broadcast/admin/campaigns?limit=20") return response({ campaigns: oldPage, nextCursor: id(20), hasMore: true });
    if (path === `/api/broadcast/admin/campaigns?limit=20&afterId=${id(20)}`) return response({ campaigns: [ended, newest], nextCursor: null, hasMore: false });
    return null;
  });
  try {
    for (const item of [...oldPage, old]) f.ui.campaigns.set(item.id, item);
    await f.ui.loadHistory();
    assert.equal(f.ui.campaigns.get(old.id).status, "completed"); assert.equal(f.ui.campaigns.get(old.id).counts.delivered, 1);
    assert.equal(f.ui.campaigns.has(id(500)), true); assert.equal(f.node("more-history").hidden, false);
    await f.ui.loadHistory(true); assert.equal(f.node("more-history").hidden, true);
    newest = campaign(21, { createdAt: now + 1, updatedAt: now + 1 });
    const before = f.calls.length; await f.ui.loadHistory();
    assert.equal(f.ui.campaigns.has(id(21)), true, "a new ID before the historical cursor is discovered through activity");
    assert.equal(f.calls.slice(before).some((call) => call.path.includes("campaigns?")), false, "activity does not restart or corrupt the archive cursor");
    assert.match(f.node("history-status").textContent, /20 diffusions les plus récentes/);
  } finally { f.close(); }
});

test("stale local live rows are resolved in bounded progressing batches instead of rejecting an eleven-row cache", async () => {
  const f = fixture((path) => {
    const match = /^\/api\/broadcast\/admin\/campaigns\/([a-f0-9]{32})$/.exec(path);
    if (match) return response(detail(campaign(Number.parseInt(match[1], 16), { status: "completed", updatedAt: now, counts: counts("delivered") })));
    return null;
  });
  try {
    for (let index = 10; index < 22; index += 1) f.ui.campaigns.set(id(index), campaign(index));
    await f.ui.loadHistory();
    assert.equal([...f.ui.campaigns.values()].filter((item) => item.status === "queued").length, 2);
    assert.equal(f.calls.filter((call) => /^\/api\/broadcast\/admin\/campaigns\/[^?]+$/.test(call.path)).length, 10);
    await f.ui.loadHistory(); assert.equal([...f.ui.campaigns.values()].filter((item) => item.status === "queued").length, 0);
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
    await f.ui.loadHistory(true); assert.equal(f.ui.campaigns.size, 25); assert.equal(f.node("more-history").hidden, true);
  } finally { f.close(); }
});

test("late history data cannot restore queued counters after cancellation", async () => {
  const queued = campaign(); const cancelled = campaign(10, { status: "cancelled", updatedAt: now, counts: counts("cancelled") });
  const activity = deferred(); let cancelledOnServer = false;
  const f = fixture((path) => {
    if (path === "/api/broadcast/admin/activity") return activity.promise;
    if (path.endsWith("/cancel")) { cancelledOnServer = true; return response(cancelled); }
    if (path === `/api/broadcast/admin/campaigns/${queued.id}`) return response(detail(cancelledOnServer ? cancelled : queued));
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

test("real hide/show handlers clear an in-flight confirmation and its old finally cannot release a new send", async () => {
  const old = deferred(), fresh = deferred(); const sent = []; const stored = new Map();
  const f = fixture((path, options) => {
    if (path === "/api/broadcast/admin/campaigns" && options.method === "POST") {
      const input = JSON.parse(options.body); const value = campaign(40 + sent.length, { ...input }); sent.push(value); stored.set(value.id, value);
      return sent.length === 1 ? old.promise : fresh.promise;
    }
    const match = /^\/api\/broadcast\/admin\/campaigns\/([a-f0-9]{32})$/.exec(path);
    if (match && stored.has(match[1])) return response(detail(stored.get(match[1])));
    return null;
  });
  try {
    compose(f.ui); const first = f.ui.send(); await flush(); assert.equal(sent.length, 1);
    f.document.visibilityState = "hidden"; f.dispatchDocument("visibilitychange");
    assert.equal(f.ui.state.pending, null); assert.equal(f.ui.state.session, null); assert.equal(f.node("broadcast-content").hidden, true);
    f.document.visibilityState = "visible"; f.dispatchDocument("visibilitychange"); await flush();
    compose(f.ui); const second = f.ui.send(); await flush(); assert.equal(sent.length, 2);
    const newCallerId = f.ui.state.pending.payload.clientCampaignId;
    old.resolve(response({ campaign: sent[0], duplicate: false }, 201)); await first;
    assert.equal(f.ui.busy().sendBusy, true); assert.equal(f.ui.state.pending.payload.clientCampaignId, newCallerId);
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
    assert.equal(f.ui.campaigns.size, 0); assert.equal(f.ui.state.session, null);
    assert.equal(f.node("history").children.length, 0); assert.equal(f.node("broadcast-content").hidden, true);
    assert.equal([...f.timers.values()].filter((timer) => timer.delay === 30000).length, 0);
  } finally { pending.resolve(response({ campaigns: [] })); f.close(); }
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
  const f = fixture((path) => path === `/api/broadcast/admin/campaigns/${id(10)}`
    ? response({ error: "try_again_later" }, 429, { "retry-after": "120" }) : null);
  try {
    await f.ui.loadHistory(); await f.ui.showCampaign(id(10)); f.ui.scheduleHistory();
    assert.equal([...f.timers.values()].filter((timer) => timer.delay >= 119000 && timer.delay <= 120000).length, 1);
    assert.equal([...f.timers.values()].filter((timer) => timer.delay === 30000).length, 0);
  } finally { f.close(); }
});

test("a manual detail rate limit also postpones a history timer which was already scheduled", async () => {
  const f = fixture((path) => path === `/api/broadcast/admin/campaigns/${id(10)}`
    ? response({ error: "try_again_later" }, 429, { "retry-after": "120" }) : null);
  try {
    await f.ui.loadHistory(); f.ui.scheduleHistory();
    await f.ui.showCampaign(id(10)); const before = f.calls.length;
    await f.poll();
    assert.equal(f.calls.length, before, "the existing timer checks the new retry deadline before any read");
    assert.equal([...f.timers.values()].filter((timer) => timer.delay >= 119000 && timer.delay <= 120000).length, 1);
  } finally { f.close(); }
});
