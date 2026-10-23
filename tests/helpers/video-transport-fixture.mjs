import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newToken, tokenDigest } from "../../server/auth/crypto.mjs";
import { CLIENT_ADMISSION_POLICY } from "../../server/access/admission.mjs";
import { createVideoService, VideoError } from "../../server/video/service.mjs";
import { createVideoStorage, videoStoredBytes } from "../../server/video/storage.mjs";

// Synthetic catalog only. This is not a production persistence adapter and
// proves neither SQL transaction isolation nor durable capacity recovery.
export async function videoFixture(t, { storageOverrides = {}, storeOverrides = {}, minimumFreeBytes = 0 } = {}) {
  const base = fileURLToPath(new URL("../../../audit/", import.meta.url));
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "video-transport-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32), storage = await createVideoStorage({ root, key });
  const state = { now: 1792598400000, rows: new Map(), held: 0, calls: [], rateAllowed: true,
    failCommitAck: false, failReserveAck: false, failReleaseAck: false };
  const accounts = ["admin", "client", "client"].map((role, i) => ({ role, id: Buffer.alloc(16, i + 1),
    token: newToken(), csrf: newToken(), active: true, expiresAt: state.now + 3600000 }));
  const find = (role, hash) => {
    const found = accounts.find((a) => a.role === role && timingSafeEqual(tokenDigest(a.token), hash));
    if (!found || !found.active || found.expiresAt <= state.now) throw new VideoError("CHAT_UNAUTHORIZED");
    return found;
  };
  const actor = (account) => ({ user: { id: account.id.toString("hex"), role: account.role, pseudonym: "Synthetic actor" },
    csrf: account.csrf, expiresAt: account.expiresAt,
    ...(account.role === "client" ? { access: { state: "active", admissionPolicy: CLIENT_ADMISSION_POLICY,
      emailVerified: true, invitationConsumed: true, approved: true } } : {}) });
  const store = {
    async reserve(request) {
      state.calls.push("reserve"); const owner = find(request.role, request.tokenHash), a = request.asset;
      const row = { ...a, ownerId: owner.id, role: owner.role, createdAt: state.now, deletedAt: null, state: "reserved" };
      state.rows.set(a.id.toString("hex"), row); state.held += a.storedBytes;
      if (state.failReserveAck) throw new Error("private SQL acknowledgement lost");
      return { reservation: { ...row, pendingBytes: state.held } };
    },
    async commit(request) {
      state.calls.push("commit"); const owner = find(request.role, request.tokenHash), a = request.asset;
      const row = state.rows.get(a.id.toString("hex"));
      if (!row || !row.ownerId.equals(owner.id) || !row.storageKey.equals(a.storageKey) || row.state !== "reserved") throw new VideoError("VIDEO_NOT_FOUND");
      Object.assign(row, a, { state: "registered" });
      if (state.failCommitAck) throw new Error("private commit acknowledgement lost");
      return { asset: { ...row } };
    },
    async getOwned(request) {
      state.calls.push("getOwned"); const owner = find(request.role, request.tokenHash), row = state.rows.get(request.assetId.toString("hex"));
      if (!row || row.state !== "registered" || row.deletedAt !== null || !row.ownerId.equals(owner.id)) throw new VideoError("VIDEO_NOT_FOUND");
      return { ...row };
    },
    async release(request) {
      state.calls.push("release");
      // The future adapter's cleanup policy must support the reservation's
      // authenticated session digest even when a user session has expired.
      const row = state.rows.get(request.assetId.toString("hex"));
      if (state.failReleaseAck) throw new Error("private release unavailable");
      if (row && row.storageKey.equals(request.storageKey) && row.state === "reserved") {
        row.state = "released"; state.held -= row.storedBytes;
      }
      return { released: true };
    },
    ...storeOverrides,
  };
  const chatService = { async actor(role, token) { return actor(find(role, tokenDigest(token))); } };
  const authStore = { async consumeRateLimit() { state.calls.push("budget"); return { allowed: state.rateAllowed, retryAfter: 30 }; } };
  const options = { store, storage: { ...storage, ...storageOverrides }, chatService, authStore, key, minimumFreeBytes, clock: () => state.now };
  const service = await createVideoService(options);
  return { root, key, state, accounts, store, storage, service, options, actor };
}

export function mp4Prefix(size) {
  const prefix = Buffer.alloc(32);
  prefix.writeUInt32BE(24); prefix.write("ftyp", 4, "ascii"); prefix.write("isom", 8, "ascii");
  prefix.write("isommp42", 16, "ascii"); prefix.writeUInt32BE(size - 24, 24); prefix.write("mdat", 28, "ascii");
  return prefix;
}
export async function* mp4Source(size, chunkBytes = 16384, progress = {}) {
  const prefix = mp4Prefix(size);
  for (let offset = 0; offset < size; offset += chunkBytes) {
    const chunk = Buffer.alloc(Math.min(chunkBytes, size - offset), 0x5a);
    if (offset < prefix.length) prefix.copy(chunk, 0, offset, Math.min(prefix.length, offset + chunk.length));
    progress.produced = (progress.produced ?? 0) + chunk.length;
    yield chunk;
  }
}
export async function uploadFixture(f, account = f.accounts[0], bytes = 786497, source = mp4Source(bytes)) {
  const ticket = await f.service.admitUpload(account.role, account.token, { bytes, mime: "video/mp4" });
  return f.service.upload(account.role, account.token, ticket, source);
}
// Explicit historical fixture: seed a client-owned object from a release that
// allowed those uploads. This bypasses the new creation service only in this
// isolated synthetic adapter, so old-object read/cleanup tests remain meaningful.
export async function legacyClientVideoFixture(f, account, bytes = 786497) {
  if (account.role !== "client") throw new TypeError("Historical client fixture required");
  const asset = { id: randomBytes(16), storageKey: randomBytes(32), bytes,
    storedBytes: videoStoredBytes(bytes), mime: "video/mp4" };
  const request = { role: account.role, tokenHash: tokenDigest(account.token), now: f.state.now };
  await f.store.reserve({ ...request, asset });
  const saved = await f.storage.put({ assetId: asset.id, storageKey: asset.storageKey, bytes, source: mp4Source(bytes) });
  await f.store.commit({ ...request, asset: { ...asset, digest: saved.digest } });
  return { id: asset.id.toString("hex"), bytes, mime: "video/mp4" };
}
export async function collectVideo(stream) {
  const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
}
