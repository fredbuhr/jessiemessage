# Reprendre JessieMessage

**20 octobre 2026 Europe/Paris — V1 applicative terminée, 0.86.0 en ligne sous Node officiel 24.22.0.** Mise à niveau réellement vérifiée à **16:41:34**, Build normal vert à **16:39**, application et dépendances inchangées. [Preuve Node et clôture](node-runtime-086.md), [bilan V1](production-086.md), [plan](PLAN-IMPLEMENTATION.md). Aucun autre manque fonctionnel nécessaire confirmé ni nouveau lot automatique.

La dette A01 du runtime applicatif 24.15 est corrigée par l’exécutable officiel privé épinglé. Le binaire système fournisseur est intact ; le service Manager et l’hébergement restent les mêmes. **Prochaine maintenance :** le bulletin Node annonce un correctif de sévérité maximale HAUTE pour le **21 octobre ou après**, non publié au relevé du 20 octobre ; aucune résolution de ce futur correctif n’est revendiquée. Sauvegardes/PC A07 et exécuteur A08 restent différés sans préalable aux lots messages ; gardes et états préservés.

Les anciennes garanties de récupération autonome, témoin frais par phase, succession, SQL exhaustif, appareils universels et perte maximale de vingt-quatre heures ne sont pas acquises. L’ancien compteur « 4/6 » est remplacé par S1/S2/S3 clos et par les cinq lots correctifs historiques clos avec réserves. Le [correctif 0.85](chat-send-ack-085.md) confirme un envoi retrouvé après perte de réponse HTTP ; ses reproductions avant correction étaient en VM, ses validations Chrome natives après correction.

## Audit et corrections antérieures

**Lot 4 terminé :** C01 confirmé puis corrigé dans neuf modules HTTP ; boucle C02 confirmée avec visibilité contrôlée dans une même tâche, autre race non reproduite avec tâches natives séparées. Gardes de génération existants réutilisés, sans rejeu de POST. Entrées documentaires simplifiées et export interne sans consommateur retiré. [Compte rendu](audit-corrections-083.md), [preuves](verification-proofs/jm083-verification.json). Le [lot 5 de clôture](audit-closure-083.md) consolide ces preuves et les réserves, sans nouvelle modification applicative.

L’[audit transversal](AUDIT-CODE-2026-10-20.md) porte sur `f629137`, code applicatif identique au runtime 0.79 de l’époque. [Preuves datées](verification-proofs/jm079-audit-20261020.json). Aucun P0/P1 ni accès intercompte démontré dans les surfaces examinées ; cela ne certifie pas leur absence. La caractérisation C01/C02 et ses limites sont consignées dans le lot 4 ; elles ne qualifient ni tous les appareils physiques ni le BFCache.

- **Lot 1 :** A02/A03/A04/A11 livrés en 0.80, débits atomiques, échéances après verrous, rollback des diffusions expirées et HSTS hôte seul. [Compte rendu](audit-corrections-080.md).
- **Lot 2 :** A05 borné à 1 Gio chiffré/50 000 objets non libérés sous verrou existant, sans réécrire les quotas. A07 vérifie/acquitte la dernière archive avant l’historique ; kit qualifié sous Windows, puis incident utilisateur Avast rouvert (`blocked_by_avast_user_reported`). A08 avertit dès 1 500 reçus ou 3 072 entrées, dry-run synthétique qualifié ; aucun exécuteur actif. [Compte rendu](audit-corrections-081.md), [limites/procédure](backup-capacity-and-history-081.md).
- **Lot 3 :** A06 reprend les médias absents après vérification complète, préserve/refuse tout fichier tronqué ou divergent, procédure vers une autre cible documentée. A09 remonte un arrêt forcé ou un drainage échoué en poursuivant le nettoyage. A10 compare exactement le schéma référencé dans sept validateurs FK. [Compte rendu](audit-corrections-082.md), [guide opérateur](manual-restore-operator-078.md).
- **Lot 4 :** lectures GET/HEAD anonymes sans effacement du cookie absent du bon rôle, sans changer les refus d’accès ou les POST explicites ; réponses obsolètes de Sauvegardes ignorées. [Compte rendu](audit-corrections-083.md).

Le budget média ne promet pas une croissance SQL illimitée : snapshot de 100 000 lignes cumulées, dump brut 64 Mio et autres limites restent distincts. Le dry-run A08 conserve le registre des fermetures, sans transition active ni purge. A01 concernait le Node système 24.15 de l’application. Depuis le 20 octobre à 16:41:34, son unique service utilise le Node officiel privé **24.22.0**, qualifié sur l’hôte et en CI ; le binaire système fournisseur n’est pas modifié. Aucun changement de majeure ou d’offre.

## Service courant et preuves

Messagerie privée sur invitation, texte/photos, sessions indépendantes, CRM, export, notifications, copies chiffrées PC existantes (état courant bloqué/incertain après l’alerte Avast), fermetures locales et récupération manuelle en maintenance. Conversations jusqu’à fermeture définitive, hors suppressions volontaires. [Guide quotidien](guide-jessie.md), [recette V1](messaging-acceptance-079.md).

[PR #108](https://github.com/fredbuhr/jessiemessage/pull/108) fusionnée : candidat `37110bc59d83c40eaf53fa1cb8502d287a2c9a06`, merge/runtime **`c61d1eecfefe786254416652877ba82d30cf4c90`**, arbre commun **`78c8e46224503b0691b381bf07c5aefd51ca5c7f`**. Cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39435563786), [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39436551982) et [push source](https://github.com/fredbuhr/jessiemessage/actions/runs/39435537416) réussis. **3 101 réussites générales/35 wrappers SQL ignorés sur 3 136, zéro échec ; 466/466 par MariaDB 10.11 et 11.4 sans omission ; Chrome 164/164 ; HTTPS/SQL 2/2 ; syntaxe 568 et build validés.** Ciblés locaux : interface 66/66, superviseur 46/46. Les assertions FR/EN et du reçu ont été ajoutées aux cas existants.

**Mise à niveau Node effective :** CI unique [39439751937](https://github.com/fredbuhr/jessiemessage/actions/runs/39439751937) sur `3545de2931b3acc4d43878236bf2f4fe283ba8a0`, tous les jobs sous **24.22.0**, 5/5 réussis : général 3 101 réussites/35 wrappers SQL ignorés, SQL 466/466 par MariaDB sans omission, Chrome 164/164, HTTPS 2/2, syntaxe 568/build. Seul le workflow CI est modifié, pas le code applicatif, les tests ou dépendances du runtime `c61d1eec`. Un seul service Manager utilise le nouveau binaire ; aucun second serveur ni gestionnaire de versions.

Build normal Manager réussi **20 octobre à 16:39 Paris**, Node actif, sans réinstallation ni migration. À **14:41:34.716387 UTC / 16:41:34 Paris** : source/arbre propres, binaire SHA-256 et lanceur/modes vérifiés ; dix empreintes sensibles et une identité PC préservées ; reçu réel du parent Manager **v24.22.0**, moniteur **OK**, `checkedAt:1792507260426`. **26 HTTPS** conformes sur deux origines : quatre santé/disponibilité 200, JSON exact et `no-store` ; huit API auth/access/chat 401 ; quatorze assets publics identiques au code épinglé. Tous sans cookie ajouté et avec HSTS unique. [Preuve Manager](verification-proofs/jm086-node2422-manager.jpg), [bilan Node](node-runtime-086.md). Les preuves du premier déploiement 0.86 à 16:17 et son ancien Node sont historiques dans le bilan V1.

Aucun GET privé authentifié de production observé, nouvel envoi réel, effacement ou restauration ajouté pour valider. Les parcours authentifiés sont synthétiques ; aucun appareil physique ni état des copies PC qualifié. Le reçu prouve le parent ; le probe photo sur l’hôte a vérifié le chemin exact du binaire du décodeur fork. Aucune vulnérabilité future annoncée n’est déclarée corrigée.

**Relevé historique de clôture 0.83, le 20 octobre à 11:47:30.413880 UTC / 13:47:30 Europe/Paris :** santé/disponibilité **200** sur les deux origines (quatre contrôles), moniteur **OK**, dix empreintes sensibles et l’identité de la destination PC préservées. Catalogue : **cinq archives, dix reçus, vingt-trois entrées** ; dernière capture quotidienne du **20 octobre 05:15 UTC** et dernier reçu PC concordants. Ce relevé précède les alertes Avast. Aucune version du copieur n’est reportée : le dernier reçu est historique, ne prouve ni l’installation du correctif A07 ni le fonctionnement actuel des copies. [Preuve datée](verification-proofs/jm083-closure.json).

Les preuves de connexion, texte/photo, ouverture de notification et export consolidées lors de cette clôture restent au [bilan final](audit-closure-083.md). Aucune suite verte n’a été relancée pour la clôture, aucun envoi ou effacement réel ajouté. Les contrôles synthétiques et observations de production gardent leurs limites respectives.

A08 : surveiller **1 500 reçus ou 3 072 entrées** pour intervenir avant les limites ; le relevé historique de clôture était inférieur à ces seuils. L’avertissement et le dry-run sont livrés, l’exécuteur actif reste différé, sans purge automatique. Le diagnostic historique complet 0.81 reste dans les [preuves 0.81](verification-proofs/jm081-verification.json).

## Pins à utiliser

| Élément | Valeur courante |
| --- | --- |
| Code exécuté | `c61d1eecfefe786254416652877ba82d30cf4c90` |
| Arbre | `78c8e46224503b0691b381bf07c5aefd51ca5c7f` |
| Checkout | `/srv/customer/jessiemessage-operator/production-086-c61d1eec` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-node2422-c61d1eec.sh` |
| Lanceur | 0700 ; SHA-256 `e54392621a7f63f7665f44c191783d467ccb214630e65449fb4ae57138cc9881` |
| Node applicatif | `/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node`, 0700 ; version 24.22.0 |
| Binaire Node SHA-256 | `67ca5783f8bb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a6506751c` |
| Journal | `/srv/customer/jessiemessage-private/jm086-node2422.log`, 0600 |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |

Mode **`start-local-closures`**, `closuresEnabled:true`, port **3000 direct**, sans observateur/passerelle. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Six configurations, clés, base, médias, sessions, destinataire GPG et cadence réutilisés. Ne pas lancer un second parent SSH ni `capture --offline` pendant le service.

Précontrôles du nouveau Node à **14:32:58.849424 UTC** : plateforme/JPEG/fichiers privés `checks_passed`, vrai décodeur photo fork normalisant PNG vers JPEG/vignette avec le binaire exact ; `local_closure_precheck/passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Dépendances verrouillées existantes réutilisées. Le lanceur vérifie SHA-256 et version Node avant `exec` ; le Build utilise également son chemin absolu. Utiliser ce Node pour toute commande opérateur JavaScript ; ne pas remplacer le binaire système.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. `activeService.release=0.86.0`, `activeService.nodeAfterDeployment=v24.22.0` ; `developmentSimplification.nodeRuntimeUpdate.status=server_deployed_verified`. Repli opérationnel complet dans `.nodeRuntimeUpdate.rollback`, anciens `.productionClosure`/`.chatSendAck` historiques ; aucun journal parallèle ajouté. S1/S2/S3, PC, autorité et D1 préservés.

## Incident PC A07 — traitement différé par l’utilisateur

Statut courant : **`blocked_by_avast_user_reported`**. Trois captures fournies par l’utilisateur signalent des actions PowerShell suspectes et la mise en quarantaine de `JessieMessage-sauvegardes-055.ps1` : alerte sur l’exemplaire installé dans AppData le **20 octobre à 12:03:44.019 UTC**, puis sur l’exemplaire extrait dans Downloads à **12:12:52.625 UTC**. Les fichiers en quarantaine ne sont pas accessibles pour comparaison ; leurs empreintes sont inconnues. Une fausse alerte est soupçonnée, pas prouvée. Les copies PC peuvent être interrompues depuis la première alerte ; le reçu antérieur ne décrit pas l’état actuel. [Incident et procédure](pc-antivirus-20261020.md), [preuves](verification-proofs/jm083-avast-20261020.json).

**Décision utilisateur du 20 octobre à 14:29 : poursuivre le développement sans traiter l’antivirus pour l’instant.** Aucune action Avast ou PC n’est demandée aujourd’hui ; aucune analyse, restauration, exclusion, nouvelle installation ou modification de l’artefact n’est engagée dans les lots 0.84 à 0.86 ni pendant la mise à jour Node. Le signalement et l’incertitude sur les copies restent conservés, sans devenir un préalable au développement. Autorisation, copies, dossier de récupération, clés et artefact PC restent inchangés.

## Lots V1 clos et limites conservées

- **S1, 0.76 :** administration simplifiée et démarrage sans observateur, copies/moniteur/alertes conservés. [Preuves](verification-proofs/jm076-verification.json).
- **S2a/S2b, inclus dès 0.79 :** fermeture locale reprenable, drainage des producteurs, registre de fermeture, outil manuel `check | restore | open`, cible isolée, réconciliation, révocation des sessions et publication explicite sous maintenance. Qualifiés sur données synthétiques en CI, sans restauration de production. [Guide opérateur](manual-restore-operator-078.md), [preuves S2a](verification-proofs/jm077-verification.json), [preuves S2b](verification-proofs/jm078-verification.json).
- **S3, livraison initiale 0.79 :** trois sessions Chrome sur vrai HTTPS/SQL/médias, texte/photo, brouillon, notification vers le message exact, déconnexion d’un seul appareil, guide et conservation. [Preuves 0.79](verification-proofs/jm079-verification.json). Les plateformes physiques et l’arrière-plan système/PWA ne sont pas tous qualifiés ; aucune nouvelle recette personnelle générale imposée.

Récupération autonome après perte complète de l’hôte, témoin frais par phase, succession et inventaire SQL exhaustif restent hors prérequis V1, sans garantie équivalente. `completeDatabase:false`, objets exécutables exclus. L’opérateur choisit un registre récent complet ; pas de garantie après perte simultanée de l’hôte et de fermetures non copiées. Secours Infomaniak sept jours, fichiers/base non simultanés. Pas de perte maximale garantie de vingt-quatre heures. A05 est corrigé côté serveur ; le correctif A07 est qualifié sous Windows et livré dans le kit, mais l’incident Avast signalé bloque maintenant la reprise PC ; installation et fonctionnement courant restent non vérifiés. A08 dispose d’un avertissement et d’un dry-run ; l’exécuteur d’archivage actif reste différé.

La [surveillance](../MONITORING.md) garde ses limites : moniteur local/mails acceptés, douze passages externes réussis observés avec intervalles de plusieurs heures ; aucun délai maximal de détection ni réception d’alerte externe attestés.

## Préserver PC, autorité et D1

- **PC, 19 octobre :** copie et déchiffrement acceptés, `DECHIFFREMENT_VERIFIE` à **16:34:19 UTC**, capture `1792386945745-204e0e8e073b6131`, GPG 402 552 octets, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. Mails acceptés le 18 octobre. Aucun nouveau test personnel à refaire.
- Ne pas réapparier le PC, exporter/régénérer sa clé privée, supprimer DPAPI, marqueurs ou dossier `temoin`. Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`. La messagerie quotidienne ne dépend pas du PC allumé.
- Autorité conservée sous `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1`, fichiers 0600 : `contract/witness-genesis.json` original, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10` ; `enrollment/witness-enrollment-origin.json` original, `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` ; `enrollment/witness-enrollment.json` **spent, révision 2**, `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a`. Aucun retour à `ready`.
- **D1, 19 octobre :** base `fb4hmr_jm_restore_20261019`, opérateur `fb4hmr_jm_d19`, trente tables/migrations, six clés et quatre photos vérifiées ; `completeDatabase:false`. Conserver `restore-d19-checkpoint`, `restore-d19-quarantine`, reçus `restore-d19-operator` et marqueur bloquant `operational-restore.json`. Aucun réimport, rebind ni retrait de quarantaine. [Preuves](verification-proofs/jm-d19-isolated-restore.json).
- `recette.jessiemessage.com` partage runtime/base du principal : ce n’est pas une cible isolée. D2 reste historiquement non qualifié (`shared_admin / raw_underscore_pattern`, métadonnées refusées, scheduler OFF distinct de DISABLED) ; ne pas le rouvrir comme préalable V1.

## Repli et prochaine action

**Repli opérationnel Node :** ancien service 0.86, même source/arbre/checkout, Run `bash /srv/customer/jessiemessage-private/start-primary-production-086-c61d1eec.sh`, lanceur 0700 SHA-256 `3b5ac6ba42d802cabb9e7117d6d4c90408709d6b64b21a69ae0ff68ebb3c19cc`, journal `/srv/customer/jessiemessage-private/jm086-production.log` 0600. Son Node système **24.15.0 rouvrirait A01** ; ne pas le présenter comme un repli maintenant corrigé. Run/Build et ancien `activeService` complets dans `.nodeRuntimeUpdate.rollback`. Le repli applicatif 0.85 et tous ses pins restent dans `.productionClosure.rollback` et le [bilan antérieur](production-086.md). Aucun retour SQL ni suppression de journal.

**V1 terminée et Node 24.22 actif.** Aucun autre manque fonctionnel nécessaire confirmé ni nouveau lot automatique. Suivre le correctif Node annoncé pour le 21 octobre ou après lorsqu’il sera publié, comme maintenance courante ; sa correction n’est pas acquise aujourd’hui. A07 Avast/PC et exécuteur A08 restent différés, sans action PC demandée ni préalable aux lots messages. [Bilan final](node-runtime-086.md), [bilan historique des corrections](audit-closure-083.md), [historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md). Les limites conservées ne sont pas transformées en garanties.
