import { SITE_CONTACT_EMAIL } from "../site.mjs";
import { validateBackupAlert } from "../backup/alert-state.mjs";

/** Closed template: no caller-controlled address, subject, HTML, URL or body. */
export function backupAlertMessage(value) {
  const alert = validateBackupAlert(value);
  const test = alert.synthetic ? "[TEST] " : "";
  const label = alert.event === "incident" ? "Incident de sauvegarde" : "Sauvegarde rétablie";
  const status = alert.event === "incident" ? "Le journal de sauvegarde exige une vérification." : "Le contrôle du journal de sauvegarde est de nouveau sain.";
  return Object.freeze({ from: SITE_CONTACT_EMAIL, replyTo: SITE_CONTACT_EMAIL, to: SITE_CONTACT_EMAIL,
    envelope: { from: SITE_CONTACT_EMAIL, to: [SITE_CONTACT_EMAIL] },
    messageId: `<backup-${alert.id}@jessiemessage.com>`,
    subject: `${test}${label} — JessieMessage`,
    text: `${alert.synthetic ? "EXERCICE SYNTHÉTIQUE : aucune panne réelle ni action sur les données clients.\n\n" : ""}${status}\n\nObservation (UTC) : ${new Date(alert.observedAt).toISOString()}\nCode : ${alert.code}\nDernier succès du journal (UTC) : ${alert.lastSuccessAt === null ? "non confirmé" : new Date(alert.lastSuccessAt).toISOString()}\nRéférence incident : ${alert.incidentId}\n\nCe contrôle ne confirme ni une copie indépendante, ni le déchiffrement ou l’intégrité actuelle des archives.\n\nJessieMessage — surveillance technique`,
  });
}
