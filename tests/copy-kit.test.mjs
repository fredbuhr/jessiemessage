import test from "node:test";
import assert from "node:assert/strict";
import { createCopyKit, createCopyUpdateKit } from "../server/backup/copy-kit.mjs";

function files(bytes) {
  const result = new Map(); let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extra;
    assert.equal(result.has(name), false); result.set(name, bytes.subarray(start, start + length)); offset = start + length;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  return result;
}
const destinationId = "1".repeat(32), origin = "https://jessiemessage.com";

test("existing-PC update kit has a separate explicit witness action without any pairing capability", async () => {
  const zip = files(await createCopyUpdateKit({ version: 1, destinationId, origin }));
  assert.deepEqual([...zip.keys()].sort(), ["Activer-le-temoin.cmd", "JessieMessage-sauvegardes-055.ps1", "JessieMessage-temoin-067.ps1", "LIRE-MOI.txt", "Mettre-a-jour.cmd", "mise-a-jour.json"].sort());
  assert.match(zip.get("Activer-le-temoin.cmd").toString(), / -EnrollWitness\r\n/);
  assert.match(zip.get("Mettre-a-jour.cmd").toString(), / -Update\r\n/);
  assert.doesNotMatch(zip.get("Mettre-a-jour.cmd").toString(), /EnrollWitness/);
  assert.deepEqual(JSON.parse(zip.get("mise-a-jour.json")), { version: 1, destinationId, origin });
  assert.equal(zip.has("raccordement.json"), false);
  assert.match(zip.get("LIRE-MOI.txt").toString(), /verification independante par le service/);
});

test("fresh pairing kit keeps its existing action and does not silently enroll a witness", async () => {
  const zip = files(await createCopyKit({ version: 1, destinationId, pairingCode: "A".repeat(43), expiresAt: 1, origin }));
  assert.equal(zip.size, 5);
  assert.equal(zip.has("Activer-le-temoin.cmd"), false);
  assert.match(zip.get("Installer.cmd").toString(), / -Setup\r\n/);
  assert.doesNotMatch(zip.get("Installer.cmd").toString(), /EnrollWitness/);
});
