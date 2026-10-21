# Messagerie vidéo 1.8.0 en développement — jalon 7.1

Branche du lot : `feat/video-messaging`, issue de `a318b0ecc8a7b1e8bcda4a5e66677708abe9e058`. La version **1.8.0 est une cible de développement**, sans tag, release ou déploiement. Le [transport 1.7.0](video-transport-170.md) reste dormant dans le runtime normal. L’état réellement déployé est exclusivement dans [REPRISE](REPRISE.md).

Le jalon 7.1 définit le contrat et qualifie le catalogue durable ; il ne livre pas encore l’interface ou le cycle de vie vidéo. Le lot 7 conserve une seule branche et une PR de travail jusqu’à la qualification complète en 7.6. Les [étapes suivantes](PLAN-IMPLEMENTATION.md) restent séparées.

## Format vidéo et aperçu

| Élément | Décision pour le lot 7 |
| --- | --- |
| Original | Un fichier `video/mp4` de 1 à 104 857 600 octets. Conservation des octets originaux, sans transcodage ou nouveau service. |
| Validation serveur actuelle | Inspection MP4 bornée du socle 1.7.0 ; elle ne prouve ni piste vidéo, codec, durée ou décodage. Ce jalon ne renforce pas artificiellement cette garantie. |
| Interface à qualifier en 7.4 | Lecture effective d’un MP4 vidéo H.264, avec audio AAC ou sans audio. Les autres encodages ne sont pas promis compatibles ; l’interface doit refuser ou expliquer un format non lisible. |
| Aperçu / miniature | Aperçu local par le lecteur natif après sélection. Aucun fichier miniature persistant requis : galerie avec un indicateur vidéo, lecteur chargé à la demande. Une éventuelle miniature persistante devra avoir son propre contrat de stockage et de capacité avant ajout. Aucun asset JPEG fictif n’est créé pour contourner les invariants photo. |
| Stockage | Enveloppe `JMVIDv1`, racine privée dédiée ; charge exacte `48 + bytes + 16 × ceil(bytes / 262144)`. Un original de 100 Mio occupe 104 864 048 octets chiffrés. |

Le catalogue ne déduit jamais le format ou la taille d’un nom fourni par le client. Les identifiants et clés de stockage sont générés par le service ; le digest est calculé pendant l’écriture chiffrée. Les routes du transport ne sont toujours pas enregistrées dans le serveur normal.

## Catalogue et capacité

Deux tables indépendantes sont candidates : `video_storage_state` lie une racine et ses limites à un compteur global ; `video_assets` conserve réservation, propriétaire, clé, taille, digest et état. Les réservations utilisent la charge chiffrée exacte avant toute écriture. Les quotas par propriétaire et globaux portent sur les états non libérés. Aucun quota de production n’est choisi ou initialisé par ce jalon.

Tous les écrivains verrouillent le singleton de capacité avant de modifier les objets. Les transactions vérifient le compteur contre les charges persistantes. La configuration doit correspondre exactement à la racine et aux limites initialisées explicitement hors ligne ; une dérive bloque l’accès. Ce budget est distinct de celui des photos ; la vérification d’espace disque du transport reste un contrôle ponctuel, pas une réservation physique auprès du système de fichiers.

| Méthode | Préconditions et résultat |
| --- | --- |
| `reserve` | Autorisation SQL actuelle via `chatStore.withActor`, limites vérifiées, réservation liée au rôle, propriétaire, session d’origine et couple id/clé. Répéter la même réservation ne double pas la charge. |
| `commit` | Même réservation et session toujours autorisée ; métadonnées et digest exacts. Passage atomique de `reserved` à `committed`. Répéter un commit identique conserve l’objet ; un contenu divergent est refusé. |
| `getOwned` | Session SQL actuelle du propriétaire, objet enregistré et vivant. Aucun accès intercompte ou destinataire n’est encore accordé ; les liens par message appartiennent à 7.2. |
| `release` | Nettoyage interne lié au hash de session d’origine, rôle, id et clé de stockage. Uniquement `reserved` vers `released`, répétable ; jamais de remboursement d’un objet enregistré. Il peut terminer après révocation sans accorder de lecture ou de nouvelle capacité d’envoi à l’ancien compte. |

`release` n’est pas une route et n’accepte pas un propriétaire déclaré par le client. Son appelant doit garantir qu’aucune écriture n’a commencé, ou disposer de la preuve explicite `published:false` et `cleanupConfirmed:true` du stockage. L’expiration d’une session ou le simple âge d’une réservation ne prouvent pas l’absence de fichier. Les tombstones libérés empêchent une réutilisation silencieuse de leur identité.

Une réponse SQL perdue après commit peut masquer une opération déjà durable. Le catalogue recréé lit l’état conservé ; aucun remboursement ou nouvel essai d’écriture n’est déduit d’une exception. Les réservations dont la publication est incertaine restent chargées. Leur réconciliation avec les fichiers, la suppression durable et la libération des vidéos enregistrées appartiennent au cycle de vie 7.3.

## Migrations candidates et compatibilité

Les migrations **0034 et 0035 candidates** sont dans `server/video/migrations/`, hors de `db/migrations/`. Un petit chargeur compose les 33 migrations existantes et ces sources, puis réutilise le validateur, le ledger et le moteur actuels. Il ne fournit aucune commande de migration hébergée. **Le plan SQL normal reste à 33.**

La base synthétique du test natif qualifie d’abord le socle 33, puis applique le plan candidat complet avec le compte DDL de test. Le catalogue travaille ensuite avec le compte DML séparé. Les gardes stricts existants de sauvegarde, inventaire, export et fermeture restent inchangés ; une base portant les candidats n’est pas déclarée compatible avec ces parcours historiques.

La promotion vers `db/migrations/` attend l’adaptation simultanée du cycle de vie en 7.3. Le repli de la livraison finale doit comprendre le futur schéma et préserver les vidéos ; il sera qualifié avant activation en 7.6. Les sources 1.6.0 et 1.5.1 ne sont pas déclarées compatibles avec ce futur schéma. Le repli 1.5.1 actuellement acquis reste propre à la production sur schéma 33.

## Qualification du jalon

À consigner après les contrôles : source et arbre poussés, PR, CI propre et résultats natifs. Les tests SQL doivent couvrir isolement, révocation, quotas concurrents, reprise après accusés perdus et refus de rembourser un objet enregistré. Une omission locale faute de MariaDB reste une omission jusqu’à la qualification native.

La qualification du catalogue n’atteste ni codec sur téléphone, ni transfert de 100 Mio sur le mutualisé, ni interface vidéo, ni restauration vidéo. Prochaine action après 7.1 : **7.2 — liens de message et ACL destinataire**, sur la même branche et sans activation isolée.
