import { readFile } from "node:fs/promises";
import { storedZip } from "./copy-kit.mjs";
import { captureId, copyDate, copyFields, copyHash, failCopy } from "./copy-state.mjs";

// No pairing code, credential, key or server path belongs in this offline kit.
export function validateVerification(value) {
  const result = copyFields(value, ["format", "version", "archive", "source", "recipient", "protection"]);
  const archive = copyFields(result.archive, ["id", "startedAt", "filename", "bytes", "sha256"]);
  const source = copyFields(result.source, ["bytes", "sha256"]), recipient = copyFields(result.recipient, ["fingerprint"]);
  const size = value => Number.isSafeInteger(value) && value > 0 && value <= 2151677952;
  if (result.format !== "jessiemessage-backup-verification" || result.version !== 1 || !captureId(archive.id)
    || !copyDate(archive.startedAt) || archive.startedAt !== Number(archive.id.split("-")[1])
    || archive.filename !== `JessieMessage-${archive.id}.tar.gz.gpg` || !size(archive.bytes) || !copyHash(archive.sha256)
    || !size(source.bytes) || !copyHash(source.sha256) || !/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(recipient.fingerprint ?? "")
    || !["mdc", "ocb-aead"].includes(result.protection)) failCopy("input");
  return { ...result, archive: { ...archive }, source: { ...source }, recipient: { ...recipient } };
}

export async function createVerificationKit(value) {
  const record = validateVerification(value);
  const script = await readFile(new URL("../../scripts/JessieMessage-verifier-056.ps1", import.meta.url));
  const launcher = Buffer.from('@echo off\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0JessieMessage-verifier-056.ps1"\r\nif errorlevel 1 pause\r\n');
  const instructions = Buffer.from("JessieMessage - verifier une sauvegarde\r\n\r\nExtraire tout le ZIP puis ouvrir Verifier.cmd sur le PC qui contient la copie chiffree et la cle GPG existante.\r\nChoisir le fichier indique dans la fenetre. Le dossier de recuperation habituel est propose ; le changer seulement si la cle a ete deplacee.\r\nCliquer Verifier. GPG peut demander votre phrase secrete dans sa propre fenetre locale. Ne jamais la saisir sur le site ni dans une discussion.\r\nLe controle lit le contenu dechiffre en memoire et le compare a l'empreinte de la capture. Aucun fichier dechiffre n'est cree, aucune cle n'est exportee, aucun resultat n'est envoye sur Internet.\r\nLe message DECHIFFREMENT_VERIFIE confirme cette archive uniquement. Il ne certifie pas une restauration SQL ni les sauvegardes futures.\r\nCe kit ne remplace pas le collecteur automatique et ne modifie aucun de ses reglages.\r\n");
  return storedZip([["Verifier.cmd", launcher], ["JessieMessage-verifier-056.ps1", script],
    ["verification.json", Buffer.from(`${JSON.stringify(record)}\n`)], ["LIRE-MOI.txt", instructions]]);
}
