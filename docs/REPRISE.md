# Reprendre JessieMessage

**20 octobre 2026 Europe/Paris — étape 4/6. Service 0.76.0 inchangé ; S2a 0.77 fusionné/vérifié en CI candidat et main, non déployé.** V1 sur le mutualisé existant, sans infrastructure ni budget ajoutés. Lire le [plan](PLAN-IMPLEMENTATION.md) et [AGENTS](../AGENTS.md). KISS permanent ; proposition VPS écartée.

## Objectif V1 et état réel

V1 : copies chiffrées PC, **restauration manuelle en maintenance**, fermeture locale journalisée et contrôle avant réouverture. S2a en fournit les moteurs ; procédure opérateur et publication explicite restent à S2b. Secours Infomaniak : sept jours, fichiers/base non simultanés ([FAQ 2217](https://www.infomaniak.com/fr/support/faq/2217)).

Récupération autonome après perte de l'hôte, témoin par phase, succession de propriétaire et inventaire SQL exhaustif **hors prérequis V1**, sans garantie équivalente ni faux succès des anciens gardes.

Service **0.76.0**, mode existant `start` sans observateur/passerelle, `closuresEnabled:false`, propriétaire non composé. Capture/copieur/alertes conservés ; administration simplifiée. Préflight sans arrêt/capture ; **Build réussi, minute affichée 19 octobre 23:34 Europe/Paris**, sans réinstallation.

Le **19 octobre à 21:39:01.988174 UTC** : HEAD/arbre/propreté/lanceur vérifiés ; six configurations, trois fichiers d'autorité et marqueur D1 inchangés, en **0600**. Santé/disponibilité HTTPS **200 sur deux origines**, API Sauvegardes **401 anonyme**, moniteur `current / OK`, journaux enfant/superviseur démarrés. PID Web invisibles via `/proc` SSH : preuve par lanceur, journaux et HTTPS, sans inspection des PID.

[PR #98](https://github.com/fredbuhr/jessiemessage/pull/98), merge `014e8825410dd0694653cf9f78ccf44b794191db` ; cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39326912066) et cinq [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39327602706) réussis. Main : **2 910 réussis / 31 wrappers SQL ignorés**, **418/418 sur chaque MariaDB**, Chrome **157**, authentification HTTPS **1**. [Preuves S1](verification-proofs/jm076-verification.json). Aucun nouveau test PC ni import D1.

## S2a — fusionné, vérifié en CI candidat et main ; non déployé

Fermeture locale sous drain/verrou capture et réconciliation manuelle d'une cible gardée en quarantaine codées, sans PC par phase. Le mode ordinaire reste inchangé ; seule une commande locale explicite compose le propriétaire. Le moteur manuel ne réalise ni import SQL ni publication. [Périmètre 0.77](local-closures-manual-077.md), [preuves](verification-proofs/jm077-verification.json).

Source finale `7318f4e406f4bec826257a85521d0a259632b750`, arbre `9e083fe6179507a1e317bd3f8f8b166920a60f02`, [PR #99](https://github.com/fredbuhr/jessiemessage/pull/99) fusionnée, merge `3b25b754b441005757e10a8c5743c517ae5c3e51`, arbre identique. [CI candidat 39333535652](https://github.com/fredbuhr/jessiemessage/actions/runs/39333535652) : **5/5 réussis**, 2 940 réussis sur 2 973 tests, 33 wrappers SQL ignorés, zéro échec ; **429/429 sur chacune des MariaDB 10.11/11.4 sans omission**, syntaxe 551, Chrome 157/157, HTTPS 1/1. [CI main 39334173585](https://github.com/fredbuhr/jessiemessage/actions/runs/39334173585) **5/5 réussis** : 429/429 sur chaque MariaDB sans test ignoré, Chrome 157, HTTPS 1, suite générale 2 940 réussis / 33 wrappers SQL ignorés / zéro échec, syntaxe 551. Le premier candidat avait échoué sur une assertion du test natif d'interruption après unlink ; le correctif porte uniquement sur le test, sans modification du produit.

Préflight `check-local-closures` réel le **19 octobre à 22:10:30.197740 UTC** (**20 octobre 00:10 Europe/Paris**), source inspectée `d823471bdf61fb3fe259c0ab85628097a1c1e8a5`, arbre `2816bdf61db06dcab253c4f6c313c5b2e450bc47` : `passed`, `scope:local_application`, `pendingClosures:false`, `started:false`, `erased:false`. Le diff exact vers 7318f4e ne contient que `tests/manual-restore.integration.test.mjs` (**6 ajouts / 2 retraits**) : application identique, sans prétendre avoir inspecté une autre source. Dix fichiers/modes et journaux conservés, aucun redémarrage. Checkout `/srv/customer/jessiemessage-operator/local-closures-077-d823471b` **préparé seulement** ; service sur les pins 0.76 ci-dessous. Aucun effacement réel, action PC, import ou retrait de quarantaine D1. À **22:22:05.831836 UTC le 19 octobre** : source/lanceur 0.76 inchangés, dix fichiers/modes préservés, santé/disponibilité HTTPS 200 sur les deux origines et API Fermetures 401 anonyme ; aucun redémarrage.

## Pins du service à conserver

- Source `8abd205cc686f9a669511fd9d28b203ee4d4632a`, arbre `400e798cc51434d548690d4821cae665f5d14716` ; checkout `/srv/customer/jessiemessage-operator/simple-backups-076-8abd205c`.
- Run : `bash /srv/customer/jessiemessage-private/start-primary-simple-backups-076-8abd205c.sh`, **0700**, SHA-256 `81302008fd2ace8a1a4450084ea8478aaf567684d225607b994401240f390482`. Écoute publique directe **3000** ; aucun relais sur 3001.
- Journal `/srv/customer/jessiemessage-private/jm076-simple-backups.log`. Ancien canal C2 Unix/PC **inactif** ; ne pas annoncer de preuve fraîche ou socket de récupération sur ce parent simple. Fichiers d'autorité conservés.
- Configuration `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` ; opérations `/srv/customer/jessiemessage-private/recurring-backup-052`. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd` ; pas de `capture --offline` pendant le service.

Autorité sous `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1`, fichiers **0600** :

| Fichier relatif | État / octets | SHA-256 |
|---|---|---|
| `contract/witness-genesis.json` | original / 813 | `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10` |
| `enrollment/witness-enrollment-origin.json` | original / 968 | `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` |
| `enrollment/witness-enrollment.json` | **spent, révision 2** / 256 | `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a` |

Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`. Aucun retour à `ready`, réappariement, régénération/export de clé privée ou suppression DPAPI, marqueurs et dossier PC `temoin`. La messagerie quotidienne ne dépend pas de la présence continue du PC.

## Preuves et états acquis

- **PC, 19 octobre :** `TEMOIN_INITIALISE` **16:23:38 UTC** ; `DECHIFFREMENT_VERIFIE` **16:34:19 UTC**, capture `1792386945745-204e0e8e073b6131`, GPG **402 552 octets**, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. Cadence **05:15 UTC**, aucun test personnel à refaire.
- **D1, 19 octobre :** import à **19:06:43.382 UTC**, seconde vérification à **19:06:45.264 UTC sans réimport**. Base `fb4hmr_jm_restore_20261019`, opérateur `fb4hmr_jm_d19` ; trente tables/migrations, six clés, quatre fichiers photo chiffrés et capsule concordants. Profil applicatif **`completeDatabase:false`**, objets exécutables exclus/non prouvés. [Parcours](isolated-checkpoint-20261019.md), [preuves](verification-proofs/jm-d19-isolated-restore.json).
- Sous `/srv/customer/jessiemessage-private/`, garder `restore-d19-checkpoint`, `restore-d19-quarantine` et les reçus **0600** de `restore-d19-operator`. Marqueur `operational-restore.json` toujours bloquant ; aucun rebind, effacement C5 ou ouverture D1 acquis. `recette.jessiemessage.com` partage runtime/base du principal : pas une cible isolée.
- **D2 :** MariaDB 10.11, `shared_admin / raw_underscore_pattern`, métadonnées refusées ; qualification stricte **non acquise**. Scheduler `OFF` ≠ `DISABLED`, sans preuve d'arrêt des workers actifs ; hors prérequis V1, aucun contournement.

Checkpoint existant `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json` : `activeService` et `developmentSimplification.s1=deployed_verified`, suite S2. Repli conservé : ancien lanceur **0700** `/srv/customer/jessiemessage-private/start-primary-witness-observer-072-94fb7882.sh`, SHA-256 `94c6109b76352f24c9678e2ab85086fe5e7a6906350fd237b3a1751d1c61b495` ; ses pins 0.72 et anciens paramètres sont dans l'historique lié ci-dessous. Aucun journal parallèle de reprise.

## Historique et prochaine action

[C2](witness-recovery-072.md) historique vérifié en 0.72, canal inactif ; [C3](witness-recovery-parent-073.md)/[C5](closure-target-replay-075.md) vérifiés en CI, sans activation réelle ; [C4](closure-reconciliation-074.md) vérifié en CI/lecture seule réelle. Code/états conservés. Anciens pins/propositions : [REPRISE 6ef8169](https://github.com/fredbuhr/jessiemessage/blob/6ef81692e01220cd3fd1d41a38c1b1d87568984d/docs/REPRISE.md).

**Prochaine action : S2b.** Livrer la procédure opérateur exécutable et la réouverture explicite vérifiée d’une cible isolée, puis S3. S2a est clos, fusionné/vérifié et non déployé ; ne pas le redéployer ou refaire son préflight pour répéter un acquis. Aucune fermeture réelle avant validation S2b. Préserver D1/PC ; Jessie en France, conversations jusqu’à fermeture définitive, mails et copies PC acceptés. Aucun questionnaire, mail de test, appariement ou import pour répéter les acquis.
