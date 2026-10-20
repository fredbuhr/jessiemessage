# Reprendre JessieMessage

**Clôture V1 0.86 en préparation à la demande du propriétaire :** navigation FR/EN « État du service », version Node du parent dans le reçu de démarrage existant et bilan final. CI/fusion/déploiement encore en attente ; le service courant reste 0.85 ci-dessous. [Livraison 0.86](production-086.md).

**20 octobre 2026 Europe/Paris — 0.85.0 livrée et vérifiée : confirmation d’envoi après perte de réponse HTTP. Repli immédiat 0.84.** [Bilan 0.85](chat-send-ack-085.md), [plan](PLAN-IMPLEMENTATION.md). Priorité durable au cœur de la messagerie ; sauvegardes/PC différés, sans préalable aux lots messages ni résolution annoncée. Aucun nouveau chantier après ce lot ; gardes et états existants préservés.

L’ancien compteur « étape 4/6 » appartient au plan du 18 octobre, remplacé par S1/S2/S3 le 19. Le plan correctif courant comporte quatre lots puis une clôture : lots 1/2/3/4 serveur livrés en 0.80/0.81/0.82/0.83, lot 5 de consolidation terminé. Ce résultat ne signifie pas que tous les constats sont résolus ou que toute la production est certifiée. La livraison V1 n’atteste pas les garanties abandonnées de l’ancien périmètre. La clôture 5/5 reste un relevé historique avec réserves ; elle ne ferme pas le nouvel incident antivirus A07.

## Lot 0.85 terminé — confirmation d’envoi

Quand l’historique ou une notification confirme le même envoi déjà enregistré après une réponse HTTP perdue, le brouillon correspondant est nettoyé et **Réessayer** s’arrête. Un nouveau texte saisi reste conservé. Correctif qualifié en VM et Chrome natif, fusionné et déployé/vérifié ; [preuve et limites](chat-send-ack-085.md).

## Audit et corrections antérieures

**Lot 4 terminé :** C01 confirmé puis corrigé dans neuf modules HTTP ; boucle C02 confirmée avec visibilité contrôlée dans une même tâche, autre race non reproduite avec tâches natives séparées. Gardes de génération existants réutilisés, sans rejeu de POST. Entrées documentaires simplifiées et export interne sans consommateur retiré. [Compte rendu](audit-corrections-083.md), [preuves](verification-proofs/jm083-verification.json). Le [lot 5 de clôture](audit-closure-083.md) consolide ces preuves et les réserves, sans nouvelle modification applicative.

L’[audit transversal](AUDIT-CODE-2026-10-20.md) porte sur `f629137`, code applicatif identique au runtime 0.79 de l’époque. [Preuves datées](verification-proofs/jm079-audit-20261020.json). Aucun P0/P1 ni accès intercompte démontré dans les surfaces examinées ; cela ne certifie pas leur absence. La caractérisation C01/C02 et ses limites sont consignées dans le lot 4 ; elles ne qualifient ni tous les appareils physiques ni le BFCache.

- **Lot 1 :** A02/A03/A04/A11 livrés en 0.80, débits atomiques, échéances après verrous, rollback des diffusions expirées et HSTS hôte seul. [Compte rendu](audit-corrections-080.md).
- **Lot 2 :** A05 borné à 1 Gio chiffré/50 000 objets non libérés sous verrou existant, sans réécrire les quotas. A07 vérifie/acquitte la dernière archive avant l’historique ; kit qualifié sous Windows, puis incident utilisateur Avast rouvert (`blocked_by_avast_user_reported`). A08 avertit dès 1 500 reçus ou 3 072 entrées, dry-run synthétique qualifié ; aucun exécuteur actif. [Compte rendu](audit-corrections-081.md), [limites/procédure](backup-capacity-and-history-081.md).
- **Lot 3 :** A06 reprend les médias absents après vérification complète, préserve/refuse tout fichier tronqué ou divergent, procédure vers une autre cible documentée. A09 remonte un arrêt forcé ou un drainage échoué en poursuivant le nettoyage. A10 compare exactement le schéma référencé dans sept validateurs FK. [Compte rendu](audit-corrections-082.md), [guide opérateur](manual-restore-operator-078.md).
- **Lot 4 :** lectures GET/HEAD anonymes sans effacement du cookie absent du bon rôle, sans changer les refus d’accès ou les POST explicites ; réponses obsolètes de Sauvegardes ignorées. [Compte rendu](audit-corrections-083.md).

Le budget média ne promet pas une croissance SQL illimitée : snapshot de 100 000 lignes cumulées, dump brut 64 Mio et autres limites restent distincts. Le dry-run A08 conserve le registre des fermetures, sans transition active ni purge. A01 reste ouvert : Manager limité au choix de branche majeure, branche 24 sélectionnée, `/usr/local/bin/node` toujours **24.15.0**. Aucun runtime parallèle, changement de majeure ou d’offre.

## Service courant et preuves

Messagerie privée sur invitation, texte/photos, sessions indépendantes, CRM, export, notifications, copies chiffrées PC existantes (état courant bloqué/incertain après l’alerte Avast), fermetures locales et récupération manuelle en maintenance. Conversations jusqu’à fermeture définitive, hors suppressions volontaires. [Guide quotidien](guide-jessie.md), [recette V1](messaging-acceptance-079.md).

[PR #107](https://github.com/fredbuhr/jessiemessage/pull/107) fusionnée : candidat `900791007243eedb591a5657d1091dc6f0782e2b`, merge/runtime **`de335f6cfce6e362a5595f2418ed142b44376fe2`**, arbre commun **`0026c652e9cdf29cef6771b81cbd39da0b46fb7b`**. Cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39430124726) et [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39431127110) réussis ; [push source](https://github.com/fredbuhr/jessiemessage/actions/runs/39430118999) également vert. **3 101 tests généraux réussis / 35 wrappers SQL ignorés sur 3 136 / zéro échec ; 466/466 sur chaque MariaDB 10.11 et 11.4 sans omission ; Chrome 164 ; HTTPS/SQL 2 ; syntaxe 568 ; aperçu construit.** Quatre variantes client/admin × texte/photo échouaient dans le contrôleur VM avant correction ; Chrome natif les a ensuite validées avec le correctif ; ciblé local **46/46**. Les tests ignorés ne sont pas comptés comme des validations.

Build normal du Manager réussi **20 octobre à 15:40 Europe/Paris**, Node affiché actif. À **13:43:44.068382 UTC / 15:43:44 Europe/Paris** : source/arbre/propreté, version 0.85, lanceur et modes vérifiés ; dix empreintes sensibles et l’identité PC préservées ; reçu de démarrage réel observé, moniteur **OK**, `checkedAt:1792503821833`. **20 contrôles HTTPS** conformes sur les deux origines, chacun sans cookie et avec un HSTS unique : quatre santé/disponibilité **200**, JSON exact et `no-store` ; huit contrôles API auth/access/chat **401** ; huit ressources chat JS/modèle/CSS/réponses rapides **200**, volontairement publiques et identiques au code épinglé. [Preuve Manager](verification-proofs/jm085-manager.jpg), [bilan daté](chat-send-ack-085.md).

Aucun GET privé authentifié de production observé, aucun envoi réel ni restauration ajouté pour valider. Les parcours authentifiés sont synthétiques ; aucun appareil physique ou état courant des copies PC qualifié. Node reste **24.15.0**, A01 inchangé. Les [preuves 0.84](verification-proofs/jm084-verification.json) restent historiques.

**Relevé historique de clôture 0.83, le 20 octobre à 11:47:30.413880 UTC / 13:47:30 Europe/Paris :** santé/disponibilité **200** sur les deux origines (quatre contrôles), moniteur **OK**, dix empreintes sensibles et l’identité de la destination PC préservées. Catalogue : **cinq archives, dix reçus, vingt-trois entrées** ; dernière capture quotidienne du **20 octobre 05:15 UTC** et dernier reçu PC concordants. Ce relevé précède les alertes Avast. Aucune version du copieur n’est reportée : le dernier reçu est historique, ne prouve ni l’installation du correctif A07 ni le fonctionnement actuel des copies. [Preuve datée](verification-proofs/jm083-closure.json).

Les preuves de connexion, texte/photo, ouverture de notification et export consolidées lors de cette clôture restent au [bilan final](audit-closure-083.md). Aucune suite verte n’a été relancée pour la clôture, aucun envoi ou effacement réel ajouté. Les contrôles synthétiques et observations de production gardent leurs limites respectives.

A08 : surveiller **1 500 reçus ou 3 072 entrées** pour intervenir avant les limites ; le relevé historique de clôture était inférieur à ces seuils. L’avertissement et le dry-run sont livrés, l’exécuteur actif reste différé, sans purge automatique. Le diagnostic historique complet 0.81 reste dans les [preuves 0.81](verification-proofs/jm081-verification.json).

## Pins à utiliser

| Élément | Valeur courante |
| --- | --- |
| Code exécuté | `de335f6cfce6e362a5595f2418ed142b44376fe2` |
| Arbre | `0026c652e9cdf29cef6771b81cbd39da0b46fb7b` |
| Checkout | `/srv/customer/jessiemessage-operator/chat-send-ack-085-de335f6c` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-chat-send-ack-085-de335f6c.sh` |
| Lanceur | 0700 ; SHA-256 `d0290fc1b8097459e4667cd2d78333aca8a61e201c63c46b0285132ef05d4ba6` |
| Journal | `/srv/customer/jessiemessage-private/jm085-chat-send-ack.log`, 0600 |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |

Mode **`start-local-closures`**, `closuresEnabled:true`, port **3000 direct**, sans observateur/passerelle. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Six configurations, clés, base, médias, sessions, destinataire GPG et cadence réutilisés. Ne pas lancer un second parent SSH ni `capture --offline` pendant le service.

Précontrôle 0.85 à **13:32:51.771707 UTC** : `local_closure_precheck / passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Dépendances réutilisées après comparaison des lockfiles en excluant seulement les deux versions racine.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. `activeService.release=0.85.0` ; `developmentSimplification.chatSendAck.status=server_deployed_verified`. Repli 0.84 complet dans `.chatSendAck.rollback`, ancien 0.83 historique dans `.serviceStatusUi` ; aucun journal parallèle ajouté. S1/S2/S3, PC, autorité et D1 restent préservés.

## Incident PC A07 — traitement différé par l’utilisateur

Statut courant : **`blocked_by_avast_user_reported`**. Trois captures fournies par l’utilisateur signalent des actions PowerShell suspectes et la mise en quarantaine de `JessieMessage-sauvegardes-055.ps1` : alerte sur l’exemplaire installé dans AppData le **20 octobre à 12:03:44.019 UTC**, puis sur l’exemplaire extrait dans Downloads à **12:12:52.625 UTC**. Les fichiers en quarantaine ne sont pas accessibles pour comparaison ; leurs empreintes sont inconnues. Une fausse alerte est soupçonnée, pas prouvée. Les copies PC peuvent être interrompues depuis la première alerte ; le reçu antérieur ne décrit pas l’état actuel. [Incident et procédure](pc-antivirus-20261020.md), [preuves](verification-proofs/jm083-avast-20261020.json).

**Décision utilisateur du 20 octobre à 14:29 : poursuivre le développement sans traiter l’antivirus pour l’instant.** Aucune action Avast ou PC n’est demandée aujourd’hui ; aucune analyse, restauration, exclusion, nouvelle installation ou modification de l’artefact n’est engagée dans le lot 0.84. Le signalement et l’incertitude sur les copies restent conservés, sans devenir un préalable au développement. Autorisation, copies, dossier de récupération, clés et artefact PC restent inchangés.

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

**Repli immédiat : 0.84.0**, source `5a6f07228cc01b1d21421dc57baaa36378991fa5`, arbre `7fa1b94fcc1b701ef48381655097fe82f17d55dd`, checkout `/srv/customer/jessiemessage-operator/service-status-084-5a6f0722`. Run `bash /srv/customer/jessiemessage-private/start-primary-service-status-084-5a6f0722.sh`, lanceur 0700, SHA-256 `cd46bab672543250a958da266aa56b052177e8dfcc207aa93977274794c42c62`, journal `/srv/customer/jessiemessage-private/jm084-service-status.log` 0600. Repli complet dans `.chatSendAck.rollback` du checkpoint privé unique. Aucun retour SQL ni suppression de journal. Replis 0.83/0.82/0.81/0.80/0.79/0.76 historiques préservés.

**Plan correctif clos, 5/5 lots, avec réserves ouvertes — relevé historique.** L’incident A07 reste ouvert mais son traitement est différé par l’utilisateur et n’a pas bloqué la livraison 0.84. Le [bilan final par constat](audit-closure-083.md) et les [preuves consolidées](verification-proofs/jm083-closure.json) distinguent corrigé/vérifié, livré mais installation PC non observée, exécuteur différé, dépendance hébergeur et sous-hypothèse non reproduite. Aucun nouveau lot fonctionnel n’est ouvert automatiquement.

**Lot 0.85 terminé : livré et vérifié ; bilan [ici](chat-send-ack-085.md). Aucun nouveau chantier après ce lot.** La priorité durable reste le cœur messagerie ; sauvegardes et Avast/PC sont différés sans préalable aux lots messages. A01 fournisseur et A08 restent ouverts séparément, sans résolution annoncée. Aucune action PC demandée, aucun garde ni état historique retiré. [Historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md).
