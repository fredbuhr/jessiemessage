import { readFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
import { copyFields, copyId, copyDate, failCopy } from "./copy-state.mjs";
import { isToken } from "../auth/http.mjs";

// Small stored ZIP, fixed filenames and trusted source only. No archive reader,
// shell, temporary file or dependency is needed on the production server.
export function storedZip(files) {
  const chunks = [], central = []; let offset = 0;
  for (const [name, bytes] of files) {
    if (!/^[A-Za-z0-9.-]+$/.test(name) || !Buffer.isBuffer(bytes) || bytes.length > 131072) failCopy();
    const filename = Buffer.from(name), checksum = crc32(bytes), header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(33, 12); header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24);
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    chunks.push(header, filename, bytes); central.push(entry, filename); offset += header.length + filename.length + bytes.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, index, end]);
}
export async function createCopyKit(value) {
  const pairing = copyFields(value, ["version", "destinationId", "pairingCode", "expiresAt", "origin"]);
  if (pairing.version !== 1 || !copyId(pairing.destinationId) || !isToken(pairing.pairingCode) || !copyDate(pairing.expiresAt)
    || pairing.origin !== "https://jessiemessage.com") failCopy();
  const agent = await readFile(new URL("../../scripts/JessieMessage-sauvegardes-055.ps1", import.meta.url));
  const launcher = Buffer.from('@echo off\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0JessieMessage-sauvegardes-055.ps1" -Setup\r\nif errorlevel 1 pause\r\n');
  const instructions = Buffer.from("JessieMessage - sauvegardes chiffrees\r\n\r\nExtraire tout le ZIP dans un dossier. Ouvrir Installer.cmd dans les 15 minutes suivant le telechargement.\r\nChoisir graphiquement un dossier pour les copies. Le PC doit etre allume, connecte a Internet et votre session Windows ouverte.\r\nLes copies sont recherchees toutes les 15 minutes et a l'ouverture de session. Aucun fichier n'est supprime automatiquement.\r\nLe raccourci JessieMessage - Sauvegardes permet de changer le dossier. Un dossier Drive synchronise est possible ; sa synchronisation cloud n'est pas verifiee par JessieMessage.\r\nPour changer d'ordinateur : administration > Sauvegardes > Raccorder Windows sur la destination. Le nouvel appareil remplacera son autorisation precedente lors du raccordement.\r\nLe droit de copie peut etre revoque depuis le site. Il ne permet ni connexion administrateur ni dechiffrement. Ne pas partager ce kit pendant ses 15 minutes de validite.\r\n");
  return storedZip([["Installer.cmd", launcher], ["JessieMessage-sauvegardes-055.ps1", agent], ["JessieMessage-temoin-067.ps1", await readFile(new URL("../../scripts/JessieMessage-temoin-067.ps1", import.meta.url))], ["raccordement.json", Buffer.from(`${JSON.stringify(pairing)}\n`)], ["LIRE-MOI.txt", instructions]]);
}

export async function createCopyUpdateKit(value) {
  copyFields(value, ["version", "destinationId", "origin"]);
  if (value.version !== 1 || !copyId(value.destinationId) || value.origin !== "https://jessiemessage.com") failCopy();
  const launcher = Buffer.from('@echo off\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0JessieMessage-sauvegardes-055.ps1" -Update\r\nif errorlevel 1 pause\r\n');
  return storedZip([["Mettre-a-jour.cmd", launcher], ["mise-a-jour.json", Buffer.from(`${JSON.stringify(value)}\n`)],
    ["JessieMessage-sauvegardes-055.ps1", await readFile(new URL("../../scripts/JessieMessage-sauvegardes-055.ps1", import.meta.url))],
    ["JessieMessage-temoin-067.ps1", await readFile(new URL("../../scripts/JessieMessage-temoin-067.ps1", import.meta.url))],
    ["LIRE-MOI.txt", Buffer.from("JessieMessage - mise a jour du PC\r\n\r\nExtraire tout le ZIP et ouvrir Mettre-a-jour.cmd sur le PC deja raccorde.\r\nLe dossier choisi, les copies et l'autorisation enregistree sont conserves. Aucun nouveau raccordement ni cle privee n'est necessaire.\r\nSi une copie est en cours, attendre sa fin puis relancer. Les copies gardent leur rythme de 15 minutes.\r\nLe temoin reste inactif tant que son initialisation controlee n'a pas ete effectuee. Ce kit ne certifie ni dechiffrement ni restauration.\r\n")]]);
}
