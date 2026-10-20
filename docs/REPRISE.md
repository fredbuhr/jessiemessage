# Reprendre JessieMessage

**20 octobre 2026 Europe/Paris — lot 3 livré : 0.82.0 déployé et vérifié.** A06/A09/A10 corrigés ; lots 1/2 serveur conservés. Mise à jour personnelle du kit PC 0.81 toujours non observée. A08 : avertissement/dry-run livrés, exécuteur actif différé ; A01 dépendance hébergeur indépendante. S1/S2a/S2b/S3 restent clos. Lire le [plan](PLAN-IMPLEMENTATION.md), le [lot 3](audit-corrections-082.md), les [preuves](verification-proofs/jm082-verification.json) et [AGENTS](../AGENTS.md). KISS permanent, aucun nouveau serveur ni budget.

L’ancien compteur « étape 4/6 » appartient au plan du 18 octobre, remplacé par S1/S2/S3 le 19. Le plan correctif courant comporte quatre lots puis une clôture : lots 1/2/3 serveur livrés en 0.80/0.81/0.82 ; lot 4 et bilan final à faire. La livraison V1 n’atteste pas les garanties abandonnées de l’ancien périmètre.

## Audit et corrections courantes

L’[audit transversal](AUDIT-CODE-2026-10-20.md) porte sur `f629137`, code applicatif identique au runtime 0.79 de l’époque. [Preuves datées](verification-proofs/jm079-audit-20261020.json). Aucun P0/P1 ni accès intercompte démontré dans les surfaces examinées ; cela ne certifie pas leur absence. C01/C02 restent à confirmer au lot 4.

- **Lot 1 :** A02/A03/A04/A11 livrés en 0.80, débits atomiques, échéances après verrous, rollback des diffusions expirées et HSTS hôte seul. [Compte rendu](audit-corrections-080.md).
- **Lot 2 :** A05 borné à 1 Gio chiffré/50 000 objets non libérés sous verrou existant, sans réécrire les quotas. A07 vérifie/acquitte la dernière archive avant l’historique ; kit qualifié sous Windows, installation personnelle non observée. A08 avertit dès 1 500 reçus ou 3 072 entrées, dry-run synthétique qualifié ; aucun exécuteur actif. [Compte rendu](audit-corrections-081.md), [limites/procédure](backup-capacity-and-history-081.md).
- **Lot 3 :** A06 reprend les médias absents après vérification complète, préserve/refuse tout fichier tronqué ou divergent, procédure vers une autre cible documentée. A09 remonte un arrêt forcé ou un drainage échoué en poursuivant le nettoyage. A10 compare exactement le schéma référencé dans sept validateurs FK. [Compte rendu](audit-corrections-082.md), [guide opérateur](manual-restore-operator-078.md).

Le budget média ne promet pas une croissance SQL illimitée : snapshot de 100 000 lignes cumulées, dump brut 64 Mio et autres limites restent distincts. Le dry-run A08 conserve le registre des fermetures, sans transition active ni purge. A01 reste ouvert : Manager limité au choix de branche majeure, branche 24 sélectionnée, binaire toujours **24.15.0**. Aucun runtime parallèle, changement de majeure ou d’offre.

## Service courant et preuves

Messagerie privée sur invitation, texte/photos, sessions indépendantes, CRM, export, notifications, copies chiffrées PC existantes, fermetures locales et récupération manuelle en maintenance. Conversations jusqu’à fermeture définitive, hors suppressions volontaires. [Guide quotidien](guide-jessie.md), [recette V1](messaging-acceptance-079.md).

[PR #104](https://github.com/fredbuhr/jessiemessage/pull/104) fusionnée : candidat `dc225b575401d60da35318d5f593f5ee383c3de2`, merge **`bfc2a2217bfb6ff06dcae340fd9fc7b640609865`**, arbre commun **`380b11faa02801a42eddf5bade4f66c45d901257`**. Cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39405670555) et [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39406423081) réussis ; [push source](https://github.com/fredbuhr/jessiemessage/actions/runs/39405664685) également vert. **3 085 tests généraux réussis / 35 wrappers SQL ignorés / zéro échec ; 466/466 sur chaque MariaDB 10.11 et 11.4 sans omission ; Chrome 161 ; HTTPS/SQL 2 ; syntaxe 568 ; aperçu construit.** Local : 2 902 réussis, 214 ignorés, zéro échec. Les omissions restent distinctes des preuves natives. Script Windows inchangé, qualification 0.81 conservée.

A06 natif couvre import réel unique puis snapshot/empreintes et reprise des fichiers manquants, avec contexte/connecteurs injectés et loopback sans TLS ; il ne requalifie pas tout le contexte opérateur/TLS de production. Une vraie troncature reste refusée et conservée. A10 qualifie les six magasins et le garde d’effacement avec parents homonymes d’une autre base synthétique. A09 qualifie de vrais enfants, SIGTERM/SIGKILL et nettoyage après erreur.

Build normal du Manager réussi **20 octobre à 12:22 Europe/Paris**, sans réinstallation ni migration. À **10:25:31.837903 UTC / 12:25:31 Europe/Paris** : source/arbre/propreté, version/lanceur vérifiés ; dix empreintes sensibles et identité d’autorisation PC préservées ; reçu de démarrage du superviseur et moniteur **OK**. Santé/disponibilité HTTPS **200**, JSON attendu, `no-store`, sans cookie et HSTS unique sur les deux origines. Trois API privées et `/backups.js` **401 anonymes**, avec HSTS. Aucun GET administrateur authentifié observé. [Preuve Manager](verification-proofs/jm082-manager.jpg).

Les PID parent/enfant n’ont pas été observés depuis SSH. Le reçu du superviseur suit IPC et disponibilité HTTP réelle de l’enfant ; pins, composition locale, précontrôle et HTTPS frais complètent cette preuve. Aucun envoi réel, effacement de compte, arrêt forcé ni restauration de production pour valider.

Sauvegarde quotidienne du **20 octobre 05:15 UTC** réussie avant livraison, runtime repris ; mesure en lecture seule à 09:57 UTC : dix reçus, une destination raccordée, moniteur OK. Diagnostic historique complet 0.81 (inventaire, catalogue, kit généré en mémoire) dans les [preuves 0.81](verification-proofs/jm081-verification.json) ; aucune installation PC déduite de ces mesures.

## Pins à utiliser

| Élément | Valeur courante |
| --- | --- |
| Code exécuté | `bfc2a2217bfb6ff06dcae340fd9fc7b640609865` |
| Arbre | `380b11faa02801a42eddf5bade4f66c45d901257` |
| Checkout | `/srv/customer/jessiemessage-operator/audit-lot3-082-bfc2a221` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-audit-lot3-082-bfc2a221.sh` |
| Lanceur | 0700 ; SHA-256 `138ee9d32e999eace6d48cfca62893d4e29ac73ec3ff409010ec175f993c9abb` |
| Journal | `/srv/customer/jessiemessage-private/jm082-audit-lot3.log`, 0600 |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |

Mode **`start-local-closures`**, `closuresEnabled:true`, port **3000 direct**, sans observateur/passerelle. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Six configurations, clés, base, médias, sessions, destinataire GPG et cadence réutilisés. Ne pas lancer un second parent SSH ni `capture --offline` pendant le service.

Précontrôle 0.82 à **10:14:19.614979 UTC** : `local_closure_precheck / passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Dépendances réutilisées après comparaison des lockfiles en excluant seulement les deux versions racine.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. `activeService.release=0.82.0` ; `developmentSimplification.auditCorrections.lot=3`, statut `server_deployed_verified`. Le lot 2 complet est conservé sous `.auditCorrections.lot2`, avec lot 1 et ancien historique ; repli immédiat sous `.auditCorrections.rollback`. S1/S2/S3, PC, autorité et D1 restent préservés ; aucun journal parallèle.

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

**Repli immédiat : 0.81.0**, source `4619c68f05e17accd2c98669377e6458fc4d1f14`, arbre `f623a5817e90eb1416d094b71a5a410723d05f4f`, checkout `/srv/customer/jessiemessage-operator/audit-lot2-081-4619c68f`. Run `bash /srv/customer/jessiemessage-private/start-primary-audit-lot2-081-4619c68f.sh`, lanceur 0700, SHA-256 `3a9eaa9689e95611a825890704d6462b7d20737dab03b2ea36125894c47fecde`. Commandes exactes sous `.auditCorrections.rollback`. Aucun retour SQL ni suppression de journal. Replis 0.80/0.79/0.76 conservés historiquement ; une intention inachevée garde sa barrière.

**Lot 3 terminé : bilan livré.** Prochain lot de développement : lot 4 (C01/C02 navigateur, documentation courante et entretien KISS), puis clôture de livraison. A01, installation personnelle A07 et exécuteur A08 restent ouverts séparément. Aucun VPS, budget, questionnaire, mail de test ou appariement. Préserver PC, clés, autorité et D1. [Historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md), [état avant 0.82](https://github.com/fredbuhr/jessiemessage/blob/bfc2a2217bfb6ff06dcae340fd9fc7b640609865/docs/REPRISE.md).
