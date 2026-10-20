import test from "node:test";
import assert from "node:assert/strict";
import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_FILES, BACKUP_MEDIA_MAX_OBJECTS } from "../server/media/backup-limits.mjs";
import { validateVerification } from "../server/backup/verification-kit.mjs";

test("the admitted media budget plus bounded metadata and tar overhead fit the existing PC archive contract", () => {
  const mib = 1024 * 1024, archiveLimit = 2048 * mib, cipherLimit = archiveLimit + 4 * mib;
  // Independent existing limits: manifest64MiB, receipt32MiB, SQL.gz16MiB,
  // operations64MiB. SQL rows and elapsed time remain separate safety limits.
  const metadataBytes = (64 + 32 + 16 + 64) * mib;
  const members = BACKUP_MEDIA_MAX_FILES + 4;
  // Every member gets one512-byte header and at most511 padding bytes;
  // also reserve the media directory and a complete GNU tar record trailer.
  const tarBound = BACKUP_MEDIA_MAX_BYTES + metadataBytes + members * (512 + 511) + 512 + 10240;
  // Reserve1MiB for gzip framing/block overhead, well above the deflate
  // worst-case expansion of this <1.3GiB input for the gzip producer.
  const gzipBound = tarBound + mib, encryptedBound = gzipBound + 4 * mib;
  assert.equal(BACKUP_MEDIA_MAX_FILES, BACKUP_MEDIA_MAX_OBJECTS * 2);
  assert.ok(tarBound < 1298 * mib); assert.ok(gzipBound < archiveLimit); assert.ok(encryptedBound < cipherLimit);
  const id = "capture-1792340000000-cccccccccccccccc";
  const record = { format: "jessiemessage-backup-verification", version: 1,
    archive: { id, startedAt: 1792340000000, filename: `JessieMessage-${id}.tar.gz.gpg`, bytes: encryptedBound, sha256: "a".repeat(64) },
    source: { bytes: gzipBound, sha256: "b".repeat(64) }, recipient: { fingerprint: "C".repeat(40) }, protection: "mdc" };
  assert.deepEqual(validateVerification(record), record);
  assert.throws(() => validateVerification({ ...record, archive: { ...record.archive, bytes: cipherLimit + 1 } }));
});
