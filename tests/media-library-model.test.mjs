import test from "node:test";
import assert from "node:assert/strict";
import { LIBRARY_PAGE_SIZE, libraryId, createLibraryState, clearLibrary, libraryTicket, currentLibraryTicket, acceptLibrarySession, parseLibraryAsset, parseLibraryPage } from "../public/media-library-model.js";
const id = number => number.toString(16).padStart(32, "0");
const photo = number => ({ id: id(number), width: 1200, height: 800, thumbnailWidth: 480, thumbnailHeight: 320, bytes: 90000, thumbnailBytes: 7000, createdAt: 1000, sharedHere: false, fullUrl: `/api/media/admin/assets/${id(number)}/full`, thumbnailUrl: `/api/media/admin/assets/${id(number)}/thumb` });
const video = number => ({ id: id(number), bytes: 500000, mime: "video/mp4", createdAt: 1000, cleanupPending: false, contentUrl: `/api/video/admin/assets/${id(number)}/content` });
const session = (owner = 1, csrf = "a".repeat(43)) => ({ user: { id: id(owner), role: "admin", pseudonym: "Synthetic Jessie" }, csrf, expiresAt: 10000 });
test("library identity is bound to administrator, CSRF and generation; a cleared session rejects stale tickets", () => {
  const state = createLibraryState(); state.visible = true; const initial = libraryTicket(state);
  assert.equal(acceptLibrarySession(state, session(), 1), true); assert.equal(currentLibraryTicket(state, initial), false);
  const ticket = libraryTicket(state); assert.equal(currentLibraryTicket(state, ticket), true);
  assert.equal(acceptLibrarySession(state, session(2), 1), false); assert.equal(acceptLibrarySession(state, session(1, "b".repeat(43)), 1), false);
  clearLibrary(state); state.visible = true; assert.equal(currentLibraryTicket(state, ticket), false); assert.equal(state.selected, null); assert.deepEqual(state.rows, []);
});
test("library rejects client, malformed and expired sessions before adoption", () => {
  for (const bad of [null, { ...session(), user: { ...session().user, role: "client" } }, { ...session(), csrf: "a".repeat(42) }, { ...session(), expiresAt: 5 }]) assert.equal(acceptLibrarySession(createLibraryState(), bad, 5), false);
  assert.equal(libraryId(id(1) + "\n"), false);
});
test("photo pages replace at most twenty own administrator assets with canonical URLs", () => {
  assert.equal(LIBRARY_PAGE_SIZE, 20);
  const rows = Array.from({ length: 20 }, (_, index) => photo(index + 1));
  const parsed = parseLibraryPage({ assets: rows, hasMore: true, nextCursor: id(20) }, "photos"); assert.equal(parsed.rows.length, 20); assert.equal(parsed.cursor, id(20));
  assert.throws(() => parseLibraryPage({ assets: [...rows, photo(21)], hasMore: false, nextCursor: null }, "photos"));
  for (const change of [{ fullUrl: "/api/media/client/assets/" + id(1) + "/full" }, { thumbnailUrl: "https://outside.invalid/photo.jpg" }, { width: 0 }, { bytes: 10485761 }, { thumbnailBytes: 524289 }, { createdAt: NaN }]) assert.throws(() => parseLibraryAsset({ ...photo(1), ...change }, "photos"));
});
test("library pages reject duplicate/unordered/nonprogressing IDs and malformed pagination", () => {
  for (const bad of [{ assets: [photo(2), photo(1)], hasMore: false, nextCursor: null }, { assets: [photo(1), photo(1)], hasMore: false, nextCursor: null }, { assets: [], hasMore: true, nextCursor: id(2) }, { assets: [photo(2)], hasMore: true, nextCursor: id(3) }, { assets: [], hasMore: false, nextCursor: id(1) }]) assert.throws(() => parseLibraryPage(bad, "photos"));
  assert.throws(() => parseLibraryPage({ assets: [photo(1)], hasMore: false, nextCursor: null }, "photos", id(1)));
});
test("video library supports explicit cleanup state without inventing a readable URL", () => {
  assert.equal(parseLibraryAsset(video(1), "videos").contentUrl, video(1).contentUrl);
  const cleanup = { ...video(1), cleanupPending: true, contentUrl: null }; assert.equal(parseLibraryAsset(cleanup, "videos").cleanupPending, true);
  for (const bad of [{ ...cleanup, contentUrl: video(1).contentUrl }, { ...video(1), contentUrl: "javascript:alert(1)" }, { ...video(1), mime: "video/webm" }, { ...video(1), bytes: 104857601 }]) assert.throws(() => parseLibraryAsset(bad, "videos"));
});
