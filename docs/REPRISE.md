# Reprendre JessieMessage

**20 octobre 2026 Europe/Paris — lot 2 livré côté serveur : 0.81.0 déployé et vérifié.** A05 corrigé ; copieur A07 qualifié dans Windows et présent dans le kit, **installation sur le PC personnel en attente**. A08 : avertissement déployé et dry-run synthétique qualifié, exécuteur d’archivage actif toujours différé. A01 reste une dépendance hébergeur indépendante. S1, S2a/S2b et S3 restent clos. Lire le [plan](PLAN-IMPLEMENTATION.md), le [lot 2](audit-corrections-081.md), les [limites/procédure](backup-capacity-and-history-081.md) et [AGENTS](../AGENTS.md). KISS permanent ; aucun nouveau serveur ni budget.

L’ancien compteur « étape 4/6 » appartient au plan du 18 octobre, remplacé par S1/S2/S3 le 19. Le plan correctif courant comporte quatre lots puis une clôture : lot 1 applicatif livré en 0.80 ; lot 2 serveur livré en 0.81 avec installation PC distincte ; lots 3/4 et bilan final à faire. La livraison V1 n’atteste pas les garanties abandonnées de l’ancien périmètre.

## Audit et corrections courantes

L’[audit transversal](AUDIT-CODE-2026-10-20.md) porte sur `f629137`, code applicatif identique au runtime 0.79 de l’époque. [Preuves datées](verification-proofs/jm079-audit-20261020.json). Aucun P0/P1 ni accès intercompte démontré dans les surfaces examinées ; cela ne certifie pas leur absence. C01/C02 restent à confirmer au lot 4.

**Lot 1 préservé :** A02/A03/A04/A11 livrés en 0.80, débits global/réseau atomiques, échéances revérifiées après verrous, rollback des diffusions expirées, HSTS hôte seul. [Compte rendu](audit-corrections-080.md), [preuves](verification-proofs/jm080-verification.json).

**Lot 2 serveur vérifié :** nouvelles réservations de photos bornées à 1 Gio chiffré et 50 000 objets non libérés sous le verrou SQL existant, sans réécrire les quotas persistés. Capture/reçu/admission partagent leurs limites. Le copieur valide tout le catalogue puis vérifie et acquitte la dernière archive avant les anciennes. Avertissement dès 1 500 reçus ou 3 072 entrées du dossier ; aucun effacement automatique. [Compte rendu et limites](audit-corrections-081.md), [preuves 0.81](verification-proofs/jm081-verification.json).

Le budget média ne promet pas une croissance SQL illimitée : snapshot de 100 000 lignes cumulées, dump brut 64 Mio et autres limites existantes restent distincts. Le dry-run d’archivage qualifie sélection/copie et conservation du registre de fermetures courant/futur ; aucune transition active ni purge n’est implémentée. A08 reste ouvert pour cette partie.

A01 reste ouvert : Manager limité au choix de branche majeure, branche 24 sélectionnée, binaire après livraison toujours **24.15.0**. Aucun runtime parallèle, changement de majeure ou d’offre. `npm audit` ne couvre pas les correctifs intégrés à Node.

## Service courant et preuves

Messagerie privée sur invitation, texte/photos, sessions indépendantes, CRM, export, notifications, copies chiffrées PC existantes, fermetures locales et récupération manuelle en maintenance. Conversations jusqu’à fermeture définitive, hors suppressions volontaires. [Guide quotidien](guide-jessie.md), [recette V1](messaging-acceptance-079.md).

[PR #103](https://github.com/fredbuhr/jessiemessage/pull/103) fusionnée : candidat `f723b86f046bfe560c0cf1b267d89b946883e8ee`, merge **`4619c68f05e17accd2c98669377e6458fc4d1f14`**, arbre commun **`f623a5817e90eb1416d094b71a5a410723d05f4f`**. Six jobs candidat/main réussis : [CI candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39353610982), [Windows candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39353610976), [CI main](https://github.com/fredbuhr/jessiemessage/actions/runs/39354203686), [Windows main](https://github.com/fredbuhr/jessiemessage/actions/runs/39354203718). **3 067 tests généraux réussis / 35 wrappers SQL ignorés / zéro échec ; 460/460 sur chaque MariaDB 10.11 et 11.4 sans omission ; Chrome 161 ; HTTPS/SQL 2 ; PowerShell 5.1 natif ; syntaxe 567 ; aperçu construit.** Push source également vert. Local : 2 884 réussis, 214 ignorés, zéro échec ; ces omissions restent distinctes des preuves natives CI.

Build normal du Manager réussi **20 octobre à 03:42 Europe/Paris**, sans réinstallation ni migration. À **01:48:32.150446 UTC / 03:48:32 Europe/Paris** : source/arbre/propreté, version/lanceur vérifiés ; dix empreintes sensibles et identité d’autorisation PC préservées ; reçu de démarrage du superviseur et moniteur **OK**. Santé/disponibilité HTTPS **200**, JSON attendu, `no-store`, sans cookie et HSTS unique sur les deux origines. Trois API privées et `/backups.js` **401 anonymes**, avec HSTS. Le fichier JS est protégé ; aucun GET administrateur authentifié observé. [Preuve Manager](verification-proofs/jm081-manager.jpg).

Diagnostic opérateur en lecture seule à **01:47:29.331 UTC** : inventaire complet/sain, deux photos, quatre fichiers, **380 528 octets**, aucune réservation, suppression en attente ou anomalie. Quotas SQL conservés 1 Gio/10 Gio ; budget effectif de nouvelle admission 1 Gio/50 000 objets. Catalogue : quatre archives, une destination raccordée, cadence 05:15 UTC, fraîcheur **OK**, aucun avertissement actuel. Kit de mise à jour généré en mémoire : six fichiers, 54 786 octets, copieur corrigé exact, aucun fichier d’appariement ; cela ne prouve pas son installation sur le PC.

Les PID parent/enfant n’ont pas été observés depuis SSH. Le reçu du superviseur est émis après IPC et disponibilité HTTP réelle de l’enfant ; les pins et contrôles HTTPS frais complètent cette preuve. Aucun envoi réel, effacement de compte ni restauration de production pour valider.

## Pins à utiliser

| Élément | Valeur courante |
| --- | --- |
| Code exécuté | `4619c68f05e17accd2c98669377e6458fc4d1f14` |
| Arbre | `f623a5817e90eb1416d094b71a5a410723d05f4f` |
| Checkout | `/srv/customer/jessiemessage-operator/audit-lot2-081-4619c68f` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-audit-lot2-081-4619c68f.sh` |
| Lanceur | 0700 ; SHA-256 `3a9eaa9689e95611a825890704d6462b7d20737dab03b2ea36125894c47fecde` |
| Journal | `/srv/customer/jessiemessage-private/jm081-audit-lot2.log`, 0600 |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |

Mode **`start-local-closures`**, `closuresEnabled:true`, port **3000 direct**, sans observateur/passerelle. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Six configurations, clés, base, médias, sessions, destinataire GPG et cadence réutilisés. Ne pas lancer un second parent depuis SSH ni `capture --offline` pendant le service.

Précontrôle 0.81 à **01:36:11.290382 UTC** : `local_closure_precheck / passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Dépendances réutilisées après comparaison des lockfiles en excluant seulement les deux versions racine.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. `activeService.release=0.81.0` ; `developmentSimplification.auditCorrections.lot=2`, statut `server_deployed_verified_pc_update_pending`. Le lot 1 complet est conservé sous `.auditCorrections.lot1`, le repli immédiat sous `.auditCorrections.rollback`. S1/S2/S3, PC, autorité et D1 restent préservés ; aucun journal parallèle.

## Seule action personnelle du lot 2 en attente

Sur le PC déjà raccordé : Administration → Sauvegardes → **Mettre à jour le PC**. Extraire le ZIP puis ouvrir **Mettre-a-jour.cmd**. Conserver dossier, autorisation, copies et clés ; ne pas lancer `Activer-le-temoin.cmd` et ne pas refaire le raccordement. Attendre la fin d’une copie en cours si l’outil le demande. Le script corrigé est qualifié en CI Windows, mais son installation sur le PC du propriétaire reste **non observée**. Aucune nouvelle recette générale de déchiffrement n’est demandée.

## Lots V1 clos et limites conservées

- **S1, 0.76 :** administration simplifiée et démarrage sans observateur, copies/moniteur/alertes conservés. [Preuves](verification-proofs/jm076-verification.json).
- **S2a/S2b, inclus dès 0.79 :** fermeture locale reprenable, drainage des producteurs, registre de fermeture, outil manuel `check | restore | open`, cible isolée, réconciliation, révocation des sessions et publication explicite sous maintenance. Qualifiés sur données synthétiques en CI, sans restauration de production. [Guide opérateur](manual-restore-operator-078.md), [preuves S2a](verification-proofs/jm077-verification.json), [preuves S2b](verification-proofs/jm078-verification.json).
- **S3, livraison initiale 0.79 :** trois sessions Chrome sur vrai HTTPS/SQL/médias, texte/photo, brouillon, notification vers le message exact, déconnexion d’un seul appareil, guide et conservation. [Preuves 0.79](verification-proofs/jm079-verification.json). Les plateformes physiques et l’arrière-plan système/PWA ne sont pas tous qualifiés ; aucune nouvelle recette personnelle générale imposée.

Récupération autonome après perte complète de l’hôte, témoin frais par phase, succession et inventaire SQL exhaustif restent hors prérequis V1, sans garantie équivalente. `completeDatabase:false`, objets exécutables exclus. L’opérateur choisit un registre récent complet ; pas de garantie après perte simultanée de l’hôte et de fermetures non copiées. Secours Infomaniak sept jours, fichiers/base non simultanés. Pas de perte maximale garantie de vingt-quatre heures. A05 est corrigé côté serveur ; le correctif A07 est qualifié sous Windows et livré dans le kit, en attente d’installation sur le PC personnel. A08 dispose d’un avertissement et d’un dry-run ; l’exécuteur d’archivage actif reste différé.

La [surveillance](../MONITORING.md) garde ses limites : moniteur local/mails acceptés, douze passages externes réussis observés avec intervalles de plusieurs heures ; aucun délai maximal de détection ni réception d’alerte externe attestés.

## Préserver PC, autorité et D1

- **PC, 19 octobre :** copie et déchiffrement acceptés, `DECHIFFREMENT_VERIFIE` à **16:34:19 UTC**, capture `1792386945745-204e0e8e073b6131`, GPG 402 552 octets, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. Mails acceptés le 18 octobre. Aucun nouveau test personnel à refaire.
- Ne pas réapparier le PC, exporter/régénérer sa clé privée, supprimer DPAPI, marqueurs ou dossier `temoin`. Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`. La messagerie quotidienne ne dépend pas du PC allumé.
- Autorité conservée sous `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1`, fichiers 0600 : `contract/witness-genesis.json` original, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10` ; `enrollment/witness-enrollment-origin.json` original, `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` ; `enrollment/witness-enrollment.json` **spent, révision 2**, `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a`. Aucun retour à `ready`.
- **D1, 19 octobre :** base `fb4hmr_jm_restore_20261019`, opérateur `fb4hmr_jm_d19`, trente tables/migrations, six clés et quatre photos vérifiées ; `completeDatabase:false`. Conserver `restore-d19-checkpoint`, `restore-d19-quarantine`, reçus `restore-d19-operator` et marqueur bloquant `operational-restore.json`. Aucun réimport, rebind ni retrait de quarantaine. [Preuves](verification-proofs/jm-d19-isolated-restore.json).
- `recette.jessiemessage.com` partage runtime/base du principal : ce n’est pas une cible isolée. D2 reste historiquement non qualifié (`shared_admin / raw_underscore_pattern`, métadonnées refusées, scheduler OFF distinct de DISABLED) ; ne pas le rouvrir comme préalable V1.

## Repli et prochaine action

**Repli immédiat : 0.80.0**, source `eb3e93c534bdfe5d426b1be42d6bebb093b548ce`, arbre `60eeeb39bf22f0ac894e46b8d444b18a795a2167`, checkout `/srv/customer/jessiemessage-operator/audit-lot1-080-eb3e93c5`. Run `bash /srv/customer/jessiemessage-private/start-primary-audit-lot1-080-eb3e93c5.sh`, lanceur 0700, SHA-256 `a8a73bfd7d4dc8dc0d901ae4c47ddc4fef94cb2ecfbecf80a759ffcb006f7e40`. Commandes exactes sous `.auditCorrections.rollback`. Aucun retour SQL ni suppression de journal. Replis 0.79 et 0.76 conservés historiquement ; une intention inachevée garde sa barrière.

**Lot 2 : bilan serveur terminé, kit personnel en attente d’installation.** Après ce bilan, prochain lot de développement : lot 3 (A06/A09/A10, restauration/arrêt/FK), sur cibles synthétiques seulement. A01 et l’exécuteur A08 restent ouverts séparément. Aucun VPS, budget, questionnaire, mail de test ou appariement. Préserver PC, clés, autorité et D1. [Historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md), [état avant 0.81](https://github.com/fredbuhr/jessiemessage/blob/4619c68f05e17accd2c98669377e6458fc4d1f14/docs/REPRISE.md).
