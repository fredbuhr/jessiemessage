import { writeFile } from "node:fs/promises";
import { validateRegistrySnapshot, registryHash } from "../../server/backup/registry-snapshot.mjs";
const registryId = "a".repeat(64), name = `erasure-${"b".repeat(64)}.json`;
const snapshot = revision => validateRegistrySnapshot({ version: 1, registryId, files: [{ name, content: Buffer.from(JSON.stringify({ version: 1, revision,
  envelope: { iv: Buffer.alloc(12, 1).toString("base64url"), ciphertext: Buffer.alloc(32, revision).toString("base64url"), tag: Buffer.alloc(16, 2).toString("base64url") } }) + "\n").toString("base64url") }] });
const empty = { version: 1, registryId, files: [] }, first = snapshot(1), second = snapshot(2), third = snapshot(3);
await writeFile(process.argv[2], JSON.stringify({ empty, first, second, third, firstHash: registryHash(first), emptyHash: registryHash(empty), firstJson: JSON.stringify(first) }) + "\n");
