import { randomBytes, timingSafeEqual } from "node:crypto";
import { isToken } from "../auth/http.mjs";
import { readCopyState, saveCopyState } from "./copy-files.mjs";
import { createCopyCatalog } from "./copy-catalog.mjs";
import { copyFields, copyId, copyLabel, copyDate, digestCopyToken, failCopy } from "./copy-state.mjs";

const matches = (token, digest) => isToken(token) && typeof digest === "string"
  && timingSafeEqual(Buffer.from(digestCopyToken(token)), Buffer.from(digest));
const publicDestination = item => ({ id: item.id, label: item.label, kind: item.kind, enabled: item.enabled,
  paired: item.tokenHash !== null, pairedAt: item.pairedAt, pairingExpiresAt: item.pairExpiresAt, lastSeenAt: item.lastSeenAt,
  lastReceipt: item.lastReceipt === null ? null : { ...item.lastReceipt } });

/** Only capabilities for encrypted archives live here; no admin session or GPG key is delegated. */
export function createBackupCopyService(directory, internal = {}) {
  const read = internal.read ?? (() => readCopyState(directory));
  const save = internal.save ?? ((state, revision) => saveCopyState(directory, state, revision));
  const catalog = internal.catalog ?? createCopyCatalog(directory);
  const clock = internal.clock ?? Date.now, random = internal.random ?? (bytes => randomBytes(bytes));
  let queue = Promise.resolve(), pending = 0;
  const now = () => { const value = clock(); if (!copyDate(value)) failCopy(); return value; };
  async function mutate(operation) {
    if (pending >= 16) failCopy("busy");
    pending++;
    const task = queue.then(async () => {
      const state = await read(), result = await operation(state);
      await save(state, state.revision); return result;
    });
    queue = task.catch(() => {});
    try { return await task; } finally { pending--; }
  }
  function target(state, id) { if (!copyId(id)) failCopy("input"); const item = state.destinations.find(item => item.id === id); if (!item) failCopy("missing"); return item; }
  function agent(state, token) {
    if (!isToken(token)) failCopy("unauthorized");
    const item = state.destinations.find(item => matches(token, item.tokenHash));
    if (!item) failCopy("unauthorized"); return item;
  }
  async function summary() {
    const state = await read(), listing = await catalog.list();
    return { version: 1, checkedAt: now(), schedule: listing.schedule, latestArchive: listing.archives.at(-1) ?? null,
      archiveCount: listing.archives.length, destinations: state.destinations.map(publicDestination), decryptionStatus: "not_checked" };
  }
  async function create(value) {
    const { label, kind } = copyFields(value, ["label", "kind"]);
    if (!copyLabel(label) || !["computer", "synced_folder", "server"].includes(kind)) failCopy("input");
    return mutate(state => {
      if (state.destinations.length >= 5) failCopy("limit");
      const id = random(16).toString("hex");
      if (state.destinations.some(item => item.id === id)) failCopy();
      const item = { id, label, kind, enabled: true, pairHash: null, pairExpiresAt: null, tokenHash: null, pairedAt: null, lastSeenAt: null, locationId: null, lastReceipt: null };
      state.destinations.push(item); return publicDestination(item);
    });
  }
  async function update(id, value) {
    const { label, kind, enabled } = copyFields(value, ["label", "kind", "enabled"]);
    if (!copyLabel(label) || !["computer", "synced_folder", "server"].includes(kind) || typeof enabled !== "boolean") failCopy("input");
    return mutate(state => { const item = target(state, id); Object.assign(item, { label, kind, enabled }); return publicDestination(item); });
  }
  async function revoke(id) {
    return mutate(state => { target(state, id); state.destinations = state.destinations.filter(item => item.id !== id); return { revoked: true }; });
  }
  async function preparePairing(id) {
    return mutate(state => {
      const item = target(state, id), pairingCode = random(32).toString("base64url"), expiresAt = now() + 900000;
      item.pairHash = digestCopyToken(pairingCode); item.pairExpiresAt = expiresAt;
      return { version: 1, destinationId: id, pairingCode, expiresAt, origin: "https://jessiemessage.com" };
    });
  }
  async function pair(value) {
    const { destinationId, pairingCode } = copyFields(value, ["destinationId", "pairingCode"]);
    if (!copyId(destinationId) || !isToken(pairingCode)) failCopy("unauthorized");
    return mutate(state => {
      const item = state.destinations.find(item => item.id === destinationId);
      if (!item || !matches(pairingCode, item.pairHash) || item.pairExpiresAt <= now()) failCopy("unauthorized");
      const token = random(32).toString("base64url");
      item.pairHash = null; item.pairExpiresAt = null; item.tokenHash = digestCopyToken(token); item.pairedAt = now();
      item.lastSeenAt = null; item.locationId = null; item.lastReceipt = null;
      return { version: 1, destinationId, token };
    });
  }
  async function manifest(token, locationId) {
    if (!copyId(locationId)) failCopy("input");
    const item = agent(await read(), token);
    if (!item.enabled) return { version: 1, paused: true, archives: [] };
    const listing = await catalog.list();
    await mutate(state => {
      const current = agent(state, token); if (!current.enabled) failCopy("paused");
      if (current.locationId !== locationId) { current.locationId = locationId; current.lastReceipt = null; }
      current.lastSeenAt = now();
    });
    return { version: 1, paused: false, archives: listing.archives };
  }
  async function acknowledge(token, value) {
    const { captureId, bytes, sha256, locationId } = copyFields(value, ["captureId", "bytes", "sha256", "locationId"]);
    if (!copyId(locationId)) failCopy("input");
    const current = agent(await read(), token); if (!current.enabled) failCopy("paused");
    const listing = await catalog.list(), archive = listing.archives.find(item => item.id === captureId);
    if (!archive || bytes !== archive.bytes || sha256 !== archive.sha256) failCopy("input");
    return mutate(state => {
      const item = agent(state, token); if (!item.enabled) failCopy("paused");
      if (item.locationId !== locationId) failCopy("changed");
      item.lastSeenAt = now();
      if (!item.lastReceipt || Number(item.lastReceipt.captureId.split("-")[1]) <= archive.startedAt)
        item.lastReceipt = { captureId, bytes, sha256, receivedAt: now() };
      return { version: 1, recorded: true, decryptionStatus: "not_checked" };
    });
  }
  async function transfer(token, id, consume, options) {
    const item = agent(await read(), token); if (!item.enabled) failCopy("paused");
    return catalog.transfer(id, async (...args) => {
      // Recheck after disk prehash: a pause/revocation wins before headers.
      const current = agent(await read(), token); if (!current.enabled) failCopy("paused");
      return consume(...args);
    }, options);
  }
  return Object.freeze({ summary, create, update, revoke, preparePairing, pair, manifest, acknowledge, transfer });
}
