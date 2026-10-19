# Reprendre JessieMessage

**19 octobre 2026 — étape 4/6. V1 sur le mutualisé existant, sans infrastructure ni budget ajoutés.** Lire le [plan](PLAN-IMPLEMENTATION.md) et [AGENTS](../AGENTS.md). Proposition VPS écartée.

## Objectif V1 et état réel

V1 : copies chiffrées PC, **restauration applicative manuelle en maintenance**, fermeture locale journalisée et contrôle des comptes fermés avant publication. Composition à implémenter/vérifier. Secours Infomaniak sur sept jours : fichiers/base non simultanés ([FAQ 2217](https://www.infomaniak.com/fr/support/faq/2217)), sans garantie de cohérence applicative.

Récupération autonome après perte complète de l'hôte, témoin frais à chaque phase, succession de propriétaire et inventaire SQL exhaustif **hors chemin critique V1**, sans garantie équivalente. Les anciens refus restent valables ; nouvelle composition à coder/tester explicitement.

Service **0.72.0**, observation, `closuresEnabled:false`, propriétaire non composé. À **20:44:20 UTC** : checkout/configurations/autorité inchangés, HTTPS **200 / ok / ready**, quarantaine D1 présente. Réorientation documentaire, sans bascule ni action PC.

## Pins du service à conserver

- Source `94fb7882cf74eb5f2ec165e67833ac2e7cdf13f3`, arbre `c6d304e49209a1194d91c0992096e59ff3685b6e` ; checkout `/srv/customer/jessiemessage-operator/witness-recovery-control-072-94fb7882`.
- Run : `bash /srv/customer/jessiemessage-private/start-primary-witness-observer-072-94fb7882.sh`, **0700**, SHA-256 `94c6109b76352f24c9678e2ab85086fe5e7a6906350fd237b3a1751d1c61b495`. Parent public **3000**, enfant local **3001**.
- Journal `/srv/customer/jessiemessage-private/jm072-witness-recovery.log` ; socket `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1/control/witness-recovery.sock`. Dossier **0700**, socket **0600**, UID **33** ; `control` réservé à l'IPC temporaire.
- Configuration `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` ; opérations `/srv/customer/jessiemessage-private/recurring-backup-052`. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd` ; pas de `capture --offline` pendant le service.

Autorité sous `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1`, fichiers **0600** :

| Fichier relatif | État / octets | SHA-256 |
|---|---|---|
| `contract/witness-genesis.json` | original / 813 | `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10` |
| `enrollment/witness-enrollment-origin.json` | original / 968 | `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` |
| `enrollment/witness-enrollment.json` | **spent, révision 2** / 256 | `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a` |

Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`. Aucun retour à `ready`, réappariement, régénération/export de clé privée ou suppression DPAPI, marqueurs et dossier PC `temoin`. La messagerie quotidienne ne dépend pas de la présence continue du PC.

## Preuves et états acquis

- **PC acquis :** `TEMOIN_INITIALISE` **16:23:38 UTC** ; `DECHIFFREMENT_VERIFIE` **16:34:19 UTC**, capture du jour `1792386945745-204e0e8e073b6131`, GPG **402 552 octets**, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. Cadence **05:15 UTC**, aucun test personnel à refaire.
- **D1 :** import du jour à **19:06:43.382 UTC**, seconde vérification à **19:06:45.264 UTC sans réimport**. Base `fb4hmr_jm_restore_20261019`, opérateur `fb4hmr_jm_d19` ; trente tables/migrations, six clés, quatre fichiers photo chiffrés et capsule concordants. Profil applicatif **`completeDatabase:false`**, objets exécutables exclus/non prouvés. [Parcours](isolated-checkpoint-20261019.md), [preuves](verification-proofs/jm-d19-isolated-restore.json).
- Sous `/srv/customer/jessiemessage-private/`, garder `restore-d19-checkpoint`, `restore-d19-quarantine` et les reçus **0600** de `restore-d19-operator`. Marqueur `operational-restore.json` toujours bloquant ; aucun rebind, effacement C5 ou ouverture D1 acquis. `recette.jessiemessage.com` partage runtime/base du principal : pas une cible isolée.
- **D2, 20:33:06.807 UTC :** MariaDB 10.11, `shared_admin / raw_underscore_pattern`, `mysql.proc`/`mysql.event` refusés, scheduler `OFF` ≠ `DISABLED`. Qualification stricte **non acquise**, `OFF` ne prouve pas l'arrêt des workers actifs. Aucun contournement ; hors prérequis V1 manuelle.

Checkpoint existant `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json` ; repli historique avant C2 `manager-before-witness-recovery-072.json`, **0600**, dans le même dossier. Aucun journal parallèle de reprise.

## Historique et prochaine action

[C2](witness-recovery-072.md) déployé/vérifié ; [C3](witness-recovery-parent-073.md) et [C5](closure-target-replay-075.md) fusionnés/vérifiés en CI, non déployés ; [C4](closure-reconciliation-074.md) fusionné/vérifié, outil réel en lecture seule. Code et états conservés. Détails/anciennes propositions : [REPRISE 6ef8169](https://github.com/fredbuhr/jessiemessage/blob/6ef81692e01220cd3fd1d41a38c1b1d87568984d/docs/REPRISE.md) et preuves versionnées.

**Prochain objectif S1 :** découpler l'observateur du fonctionnement quotidien, conserver capture/copieur/alertes et simplifier l'administration ; fermetures désactivées pendant ce lot. S2 composera fermeture locale et restauration manuelle, avec contrôle des comptes fermés avant réouverture et sans PC à chaque phase. Ne pas lever le marqueur D1. Jessie en France, conversations jusqu'à fermeture définitive, mails et copies PC acceptés. Aucun questionnaire, mail de test ou import pour répéter les acquis.
