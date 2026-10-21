import test from "node:test";
import assert from "node:assert/strict";
import { createAnnouncementsState, clearAnnouncements, announcementTicket, currentAnnouncementTicket, acceptAnnouncementsSession, setAnnouncementCurrent, updateAnnouncementDraft, announcementDraft, acceptAnnouncementPreview, prepareAnnouncementMutation, retryAnnouncementMutation, uncertainAnnouncementMutation, rejectAnnouncementMutation, completeAnnouncementMutation, parseAnnouncement, parseAnnouncementCurrent, parseAnnouncementPreview, localAnnouncementDate, readLocalAnnouncementDate } from "../public/announcements-model.js";

const now = 1792584000000, id = n => n.toString(16).padStart(32, "0");
const session = (n = 1, csrf = "A".repeat(43)) => ({ user: { id: id(n), role: "admin", pseudonym: "Synthetic" }, csrf, expiresAt: now + 3600000 });
const announcement = (revision = "1") => ({ id: id(5), revision, body: "Je te retrouve à 22 h 💋", startsAt: now, expiresAt: now + 3600000, status: "visible", sendPrivateMessage: false, campaignId: null });
function setup() { const state = createAnnouncementsState(); state.visible = true; assert.equal(acceptAnnouncementsSession(state, session()), true); setAnnouncementCurrent(state, { serverTime: now, revision: "0", announcement: null }, { fillDraft: true }); updateAnnouncementDraft(state, { body: "  Je commence bientôt 💋  ", expiresAt: now + 7200000 }); return state; }

test("announcement DTO revisions remain canonical uint64 strings including values above Number precision", () => {
  assert.equal(parseAnnouncement(announcement("18446744073709551615")).revision, "18446744073709551615");
  for (const revision of [1, "01", "0", "18446744073709551616", "-1", "1e3"]) assert.throws(() => parseAnnouncement(announcement(revision)));
  assert.throws(() => parseAnnouncementCurrent({ serverTime: now, revision: "2", announcement: announcement("1") }));
  assert.equal(parseAnnouncementCurrent({ serverTime: now, revision: "9", announcement: null }).revision, "9");
});

test("announcement drafts validate visible text and the seven-day display window", () => {
  const state = setup(); assert.equal(announcementDraft(state, now).startsAt, null);
  for (const body of ["", " \n ", "\u200b\u200d", "x".repeat(1001), "\ud800"]) { state.draft.body = body; assert.throws(() => announcementDraft(state, now)); }
  state.draft.body = "💋";
  for (const expiresAt of [now, now - 1, now + 7 * 86400000 + 1, NaN]) { state.draft.expiresAt = expiresAt; assert.throws(() => announcementDraft(state, now)); }
  state.draft.expiresAt = now + 3600000; state.draft.mode = "scheduled"; state.draft.startsAt = now - 1;
  assert.throws(() => announcementDraft(state, now)); state.draft.startsAt = now + 1000; assert.equal(announcementDraft(state, now).startsAt, now + 1000);
});

test("lost save confirmation freezes the exact request and retry keeps dates, id, revision and preview", () => {
  const state = setup(); updateAnnouncementDraft(state, { mode: "scheduled", startsAt: now + 60000, sendMessage: true });
  assert.equal(prepareAnnouncementMutation(state, id(10), now), null);
  const version = state.draftVersion;
  assert.equal(acceptAnnouncementPreview(state, version, { totalCount: 2500, eligibleCount: 2499, excludedCount: 1, previewToken: "synthetic-preview" }), true);
  state.acknowledged = true;
  const payload = prepareAnnouncementMutation(state, id(10), now); assert.equal(payload.sendPrivateMessage, true); assert.equal(payload.expectedRevision, "0");
  assert.equal(payload.body, "Je commence bientôt 💋"); assert.equal(Object.isFrozen(payload), true);
  const serialized = JSON.stringify(payload); uncertainAnnouncementMutation(state);
  assert.equal(updateAnnouncementDraft(state, { body: "Another message" }), false);
  assert.equal(prepareAnnouncementMutation(state, id(11), now), null);
  assert.equal(retryAnnouncementMutation(state), payload); assert.equal(JSON.stringify(retryAnnouncementMutation(state)), serialized);
});

test("private message audience preview and acknowledgement become invalid when the draft changes", () => {
  const state = setup(); updateAnnouncementDraft(state, { sendMessage: true }); const oldVersion = state.draftVersion;
  updateAnnouncementDraft(state, { body: "Je commence à 23 h" });
  assert.equal(acceptAnnouncementPreview(state, oldVersion, { totalCount: 1, eligibleCount: 1, excludedCount: 0, previewToken: "old" }), false);
  assert.equal(acceptAnnouncementPreview(state, state.draftVersion, { totalCount: 2500, eligibleCount: 2500, excludedCount: 0, previewToken: "new" }), true);
  state.acknowledged = true; updateAnnouncementDraft(state, { expiresAt: now + 600000 });
  assert.equal(state.preview, null); assert.equal(state.acknowledged, false); assert.equal(prepareAnnouncementMutation(state, id(9), now), null);
  assert.throws(() => parseAnnouncementPreview({ totalCount: 10, eligibleCount: 9, excludedCount: 2, previewToken: "x" }));
});

test("another administrator session update preserves the draft and its original expected revision", () => {
  const state = setup(); setAnnouncementCurrent(state, { serverTime: now, revision: "1", announcement: announcement() }, { fillDraft: true });
  updateAnnouncementDraft(state, { body: "My unsaved text", expiresAt: now + 1800000 });
  setAnnouncementCurrent(state, { serverTime: now + 1000, revision: "2", announcement: { ...announcement("2"), body: "Other device" } });
  assert.equal(state.draft.body, "My unsaved text"); assert.equal(state.baseRevision, "1"); assert.equal(state.currentRevision, "2");
  assert.equal(prepareAnnouncementMutation(state, id(8), now).expectedRevision, "1"); rejectAnnouncementMutation(state);
  assert.equal(state.draft.body, "My unsaved text");
  setAnnouncementCurrent(state, { serverTime: now, revision: "2", announcement: state.current }, { fillDraft: true }); assert.equal(state.baseRevision, "2");
});

test("account or CSRF changes cannot inherit the previous announcement proof or pending request", () => {
  const state = setup(), ticket = announcementTicket(state); assert.equal(currentAnnouncementTicket(state, ticket), true);
  assert.equal(acceptAnnouncementsSession(state, session(2)), false); assert.equal(acceptAnnouncementsSession(state, session(1, "B".repeat(43))), false);
  prepareAnnouncementMutation(state, id(7), now); clearAnnouncements(state, true); acceptAnnouncementsSession(state, session(2));
  assert.equal(currentAnnouncementTicket(state, ticket), false); assert.equal(state.pending, null); assert.equal(state.draft.body, ""); assert.equal(state.preview, null);
});

test("successful save and removal accept the server revision; malformed success preserves the pending operation", () => {
  const state = setup(); prepareAnnouncementMutation(state, id(8), now);
  assert.throws(() => completeAnnouncementMutation(state, { serverTime: now, announcement: announcement() })); assert.ok(state.pending);
  completeAnnouncementMutation(state, { serverTime: now, revision: "1", announcement: announcement(), duplicate: false }); assert.equal(state.pending, null);
  const remove = prepareAnnouncementMutation(state, id(9), now, true); assert.deepEqual(remove, { mutationId: id(9), expectedRevision: "1" });
  completeAnnouncementMutation(state, { serverTime: now, revision: "2", announcement: null, duplicate: false });
  assert.equal(state.current, null); assert.equal(state.baseRevision, "2"); assert.equal(state.draft.body, "");
});

test("native local date conversion round-trips and refuses normalized invalid dates", () => {
  const value = localAnnouncementDate(now); assert.equal(readLocalAnnouncementDate(value), Math.floor(now / 60000) * 60000);
  for (const value of ["2026-02-30T22:00", "2026-10-21", "2026-10-21T25:00", "", null]) assert.equal(readLocalAnnouncementDate(value), null);
});

test("a delayed current read cannot restore an older revision or overwrite a committed draft or removal", () => {
  const state = setup(); const before = { serverTime: now, revision: "1", announcement: announcement("1") };
  setAnnouncementCurrent(state, before, { fillDraft: true });
  updateAnnouncementDraft(state, { body: "Committed new text" }); prepareAnnouncementMutation(state, id(11), now);
  completeAnnouncementMutation(state, { serverTime: now + 1, revision: "2", announcement: { ...announcement("2"), body: "Committed new text" } });
  assert.equal(setAnnouncementCurrent(state, before, { fillDraft: true }), null);
  assert.equal(state.currentRevision, "2"); assert.equal(state.draft.body, "Committed new text");
  prepareAnnouncementMutation(state, id(12), now, true); completeAnnouncementMutation(state, { serverTime: now + 2, revision: "3", announcement: null });
  assert.equal(setAnnouncementCurrent(state, before, { fillDraft: true }), null);
  assert.equal(state.current, null); assert.equal(state.currentRevision, "3"); assert.equal(state.draft.body, "");
});
