# Reprendre JessieMessage

**20 octobre 2026 Europe/Paris — lot 4 livré : 0.83.0 déployé et vérifié.** C01 et la boucle C02 confirmés/corrigés ; autre race C02 non reproduite en natif. Lots 1/2/3 conservés. Mise à jour personnelle du kit PC 0.81 toujours non observée. A08 : avertissement/dry-run livrés, exécuteur actif différé ; A01 dépendance hébergeur indépendante. S1/S2a/S2b/S3 restent clos. Lire le [plan](PLAN-IMPLEMENTATION.md), le [lot 4](audit-corrections-083.md), les [preuves](verification-proofs/jm083-verification.json) et [AGENTS](../AGENTS.md). KISS permanent, aucun nouveau serveur ni budget.

L’ancien compteur « étape 4/6 » appartient au plan du 18 octobre, remplacé par S1/S2/S3 le 19. Le plan correctif courant comporte quatre lots puis une clôture : lots 1/2/3/4 serveur livrés en 0.80/0.81/0.82/0.83 ; lot 5 de clôture générale à faire. La livraison V1 n’atteste pas les garanties abandonnées de l’ancien périmètre.

## Audit et corrections courantes

**Lot 4 terminé :** C01 confirmé puis corrigé dans neuf modules HTTP ; boucle C02 confirmée avec visibilité contrôlée dans une même tâche, autre race non reproduite avec tâches natives séparées. Gardes de génération existants réutilisés, sans rejeu de POST. Entrées documentaires simplifiées et export interne sans consommateur retiré. [Compte rendu](audit-corrections-083.md), [preuves](verification-proofs/jm083-verification.json). Le lot 5 reste une clôture générale distincte.

L’[audit transversal](AUDIT-CODE-2026-10-20.md) porte sur `f629137`, code applicatif identique au runtime 0.79 de l’époque. [Preuves datées](verification-proofs/jm079-audit-20261020.json). Aucun P0/P1 ni accès intercompte démontré dans les surfaces examinées ; cela ne certifie pas leur absence. La caractérisation C01/C02 et ses limites sont consignées dans le lot 4 ; elles ne qualifient ni tous les appareils physiques ni le BFCache.

- **Lot 1 :** A02/A03/A04/A11 livrés en 0.80, débits atomiques, échéances après verrous, rollback des diffusions expirées et HSTS hôte seul. [Compte rendu](audit-corrections-080.md).
- **Lot 2 :** A05 borné à 1 Gio chiffré/50 000 objets non libérés sous verrou existant, sans réécrire les quotas. A07 vérifie/acquitte la dernière archive avant l’historique ; kit qualifié sous Windows, installation personnelle non observée. A08 avertit dès 1 500 reçus ou 3 072 entrées, dry-run synthétique qualifié ; aucun exécuteur actif. [Compte rendu](audit-corrections-081.md), [limites/procédure](backup-capacity-and-history-081.md).
- **Lot 3 :** A06 reprend les médias absents après vérification complète, préserve/refuse tout fichier tronqué ou divergent, procédure vers une autre cible documentée. A09 remonte un arrêt forcé ou un drainage échoué en poursuivant le nettoyage. A10 compare exactement le schéma référencé dans sept validateurs FK. [Compte rendu](audit-corrections-082.md), [guide opérateur](manual-restore-operator-078.md).
- **Lot 4 :** lectures GET/HEAD anonymes sans effacement du cookie absent du bon rôle, sans changer les refus d’accès ou les POST explicites ; réponses obsolètes de Sauvegardes ignorées. [Compte rendu](audit-corrections-083.md).

Le budget média ne promet pas une croissance SQL illimitée : snapshot de 100 000 lignes cumulées, dump brut 64 Mio et autres limites restent distincts. Le dry-run A08 conserve le registre des fermetures, sans transition active ni purge. A01 reste ouvert : Manager limité au choix de branche majeure, branche 24 sélectionnée, binaire toujours **24.15.0**. Aucun runtime parallèle, changement de majeure ou d’offre.

## Service courant et preuves

Messagerie privée sur invitation, texte/photos, sessions indépendantes, CRM, export, notifications, copies chiffrées PC existantes, fermetures locales et récupération manuelle en maintenance. Conversations jusqu’à fermeture définitive, hors suppressions volontaires. [Guide quotidien](guide-jessie.md), [recette V1](messaging-acceptance-079.md).

[PR #105](https://github.com/fredbuhr/jessiemessage/pull/105) fusionnée : candidat `86fcf161fa839306aee7c34e563c4cf58f8e2f99`, merge **`682864cec3b8d0eb1c8a6dd92c4b9bd9dfc097b1`**, arbre commun **`5eb0c133625b734c8aa92ce3f3642e281a51f380`**. Cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39411247045) et [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39412009288) réussis ; [push source](https://github.com/fredbuhr/jessiemessage/actions/runs/39411242103) également vert. **3 094 tests généraux réussis / 35 wrappers SQL ignorés / zéro échec ; 466/466 sur chaque MariaDB 10.11 et 11.4 sans omission ; Chrome 163 ; HTTPS/SQL 2 ; syntaxe 568 ; aperçu construit.** Local : 2 911 réussis, 214 ignorés, zéro échec. Les omissions restent distinctes des preuves natives. Script Windows inchangé, qualification 0.81 conservée.

C01 natif vérifie, pour les deux rôles, navigation cross-site vers session et conversation, cookie Strict absent à l’aller puis conservé, session SQL active et réouverture sans reconnexion. C02 couvre fetch/Abort natifs avec visibilité contrôlée ; aucun onglet physique ou BFCache qualifié. Les preuves des corrections A06/A09/A10 restent dans le [lot 3](audit-corrections-082.md).

Build normal du Manager réussi **20 octobre à 13:10 Europe/Paris**, sans réinstallation ni migration. À **11:22:24.917246 UTC / 13:22:24 Europe/Paris** : source/arbre/propreté, version/lanceur vérifiés ; dix empreintes sensibles et l’identité de la destination PC préservées ; reçu de démarrage du superviseur et moniteur **OK**. **20 contrôles HTTP et 8 contrôles de cookies** réussis. Santé/disponibilité HTTPS **200**, JSON attendu, `no-store`, sans cookie et HSTS unique sur les deux origines. Les huit chemins privés contrôlés répondent **401 sur l’origine principale** ; sur recette, quatre chemins auth/chat répondent **401** et les quatre chemins sauvegardes/confidentialité/fermetures/`backups.js` répondent **404**, car leurs handlers sont réservés à l’origine principale. Aucune suppression de cookie absent. Le premier contrôle exigeait à tort 401 pour ces quatre 404 ; le routage était inchangé et le contrôle a été corrigé par origine. Aucun GET administrateur authentifié observé. [Preuve Manager](verification-proofs/jm083-manager.jpg), [résultats datés](verification-proofs/jm083-verification.json).

Les PID parent/enfant n’ont pas été observés depuis SSH. Le reçu du superviseur suit IPC et disponibilité HTTP réelle de l’enfant ; pins, composition locale, précontrôle et HTTPS frais complètent cette preuve. Aucun envoi réel, effacement de compte, arrêt forcé ni restauration de production pour valider.

Sauvegarde quotidienne du **20 octobre 05:15 UTC** réussie avant livraison, runtime repris ; dernier relevé du moniteur **OK**, `checkedAt:1792495311546`, une destination raccordée dont l’identité est préservée. Le diagnostic historique complet 0.81 (inventaire, catalogue, kit généré en mémoire) reste dans les [preuves 0.81](verification-proofs/jm081-verification.json) ; aucune installation PC déduite de ces mesures.

## Pins à utiliser

| Élément | Valeur courante |
| --- | --- |
| Code exécuté | `682864cec3b8d0eb1c8a6dd92c4b9bd9dfc097b1` |
| Arbre | `5eb0c133625b734c8aa92ce3f3642e281a51f380` |
| Checkout | `/srv/customer/jessiemessage-operator/audit-lot4-083-682864ce` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-audit-lot4-083-682864ce.sh` |
| Lanceur | 0700 ; SHA-256 `a0c0486c02680fbb147c626afd0041ae718c38f27d926939e2b0cea5ae7df7b1` |
| Journal | `/srv/customer/jessiemessage-private/jm083-audit-lot4.log`, 0600 |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |

Mode **`start-local-closures`**, `closuresEnabled:true`, port **3000 direct**, sans observateur/passerelle. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Six configurations, clés, base, médias, sessions, destinataire GPG et cadence réutilisés. Ne pas lancer un second parent SSH ni `capture --offline` pendant le service.

Précontrôle 0.83 à **11:02:41.720967 UTC** : `local_closure_precheck / passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Dépendances réutilisées après comparaison des lockfiles en excluant seulement les deux versions racine.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. `activeService.release=0.83.0` ; `developmentSimplification.auditCorrections.lot=4`, statut `server_deployed_verified`. Les lots précédents et leur historique restent conservés ; repli immédiat sous `.auditCorrections.rollback`. S1/S2/S3, PC, autorité et D1 restent préservés ; aucun journal parallèle.

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

**Repli immédiat : 0.82.0**, source `bfc2a2217bfb6ff06dcae340fd9fc7b640609865`, arbre `380b11faa02801a42eddf5bade4f66c45d901257`, checkout `/srv/customer/jessiemessage-operator/audit-lot3-082-bfc2a221`. Run `bash /srv/customer/jessiemessage-private/start-primary-audit-lot3-082-bfc2a221.sh`, lanceur 0700, SHA-256 `138ee9d32e999eace6d48cfca62893d4e29ac73ec3ff409010ec175f993c9abb`. Commandes exactes sous `.auditCorrections.rollback`. Aucun retour SQL ni suppression de journal. Replis 0.81/0.80/0.79/0.76 conservés historiquement ; une intention inachevée garde sa barrière.

**Lot 4 terminé : 0.83 livré et vérifié.** Prochaine action distincte : lot 5, clôture générale des corrections par consolidation des preuves et complément des seuls parcours encore non couverts, sans relancer sans motif les suites vertes du même code. A01, installation personnelle A07 et exécuteur A08 restent ouverts séparément. Aucun VPS, budget, questionnaire, mail de test ou appariement. Préserver PC, clés, autorité et D1. [Historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md), [état avant 0.83](https://github.com/fredbuhr/jessiemessage/blob/682864cec3b8d0eb1c8a6dd92c4b9bd9dfc097b1/docs/REPRISE.md).
