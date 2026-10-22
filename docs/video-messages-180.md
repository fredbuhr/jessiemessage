# Messagerie vidéo 1.8.0 — qualification historique du jalon 7.2

> **Document historique :** ce relevé décrit son jalon avant la livraison 1.8.0. Ses états, prochaines actions et mentions du candidat ne sont pas l’état actuel. La production, le checkpoint, le repli et la seule recette restante figurent dans [REPRISE](REPRISE.md) et le [plan courant](PLAN-IMPLEMENTATION.md). Les sources, preuves et détails ci-dessous sont conservés pour leur étape.

**À ce relevé, le jalon 7.2 était codé et qualifié sur `feat/video-messaging`, non fusionné.** Ce travail poursuit le [catalogue qualifié en 7.1](video-catalogue-180.md) et le [transport dormant 1.7.0](video-transport-170.md). La cible de développement était **1.8.0**, sans nouvelle version, tag, release ou déploiement pour ce jalon. L’état de production était alors **1.6.0 / schéma 33**, avec repli **1.5.1** ; ces références sont historiques et l’état actuel est dans [REPRISE](REPRISE.md).

Ce jalon relie une vidéo enregistrée à un message privé, avec légende, accès du destinataire et galerie côté serveur. La composition candidate est injectée explicitement dans les tests ; le serveur normal n’enregistre aucune route vidéo et ne charge aucun catalogue candidat. L’interface, l’aperçu et le lecteur restent à réaliser en 7.4.

## Publication atomique et réessai

Le téléversement et l’enregistrement de l’original précèdent l’envoi du message. L’envoi n’accepte qu’une vidéo `committed` appartenant à l’acteur autorisé. Dans la même transaction SQL et sous les autorisations actuelles de la conversation, il ajoute le message, son lien `message_video`, l’événement de conversation et les tâches de notification prévues par le mécanisme existant. Une erreur dans l’une de ces écritures annule l’ensemble de la publication. Le fichier déjà téléversé et sa charge de capacité sont conservés ; la transaction SQL ne promet pas d’annuler une écriture de fichier antérieure.

La légende et l’identifiant vidéo sont chiffrés ensemble dans le corps du message, lié au message, à la conversation et à l’expéditeur. Une empreinte HMAC dans un domaine vidéo distinct distingue ce type des messages texte et photo. Un lien vidéo manquant ne permet pas de présenter le corps chiffré comme du JSON texte.

La clé de réessai existante est le couple conversation/expéditeur et `clientMessageId`. Une répétition du même contenu vidéo et du même lien renvoie le message durable avec `duplicate:true`, sans nouveau message, événement ou travail de notification. Réutiliser cette clé avec une autre légende, une autre vidéo ou un autre type de message produit un conflit. Si l’accusé du commit SQL est perdu, le résultat reste incertain jusqu’à la relecture par ce même réessai ; l’exception seule ne prouve pas l’absence de publication.

La suppression logique conserve le lien et l’empreinte mais efface le corps. Le réessai exact d’un message supprimé renvoie son tombstone sans le recréer ni exiger un asset encore vivant. Les anciens événements relisent ce même tombstone, sans légende ni DTO vidéo. La suppression physique, les références partagées et le remboursement durable de la capacité appartiennent à 7.3.

## Accès privé et contrat public

La route propriétaire conserve l’accès à un original vivant du compte courant. L’accès livré par message exige en plus une session actuellement autorisée dans cette conversation, un message vivant, son lien exact et un asset `committed` appartenant à l’expéditeur de ce message. Le contrôle SQL vérifie aussi le rôle de l’expéditeur, son appartenance à la conversation, les dates, l’absence d’un second lien photo et la configuration de racine/capacité. Un autre compte, un message supprimé ou une session révoquée ne donne pas accès aux octets. L’historique administrateur conserve les règles existantes lorsque l’accès client est retiré ; un nouvel envoi ou son réessai revérifie l’éligibilité actuelle du destinataire.

Le DTO vidéo attaché à un message ou à un élément de galerie contient exactement quatre champs :

| Champ | Valeur publique |
| --- | --- |
| `id` | Identifiant vidéo hexadécimal de 32 caractères. |
| `bytes` | Taille de l’original, de 1 à 104 857 600 octets. |
| `mime` | `video/mp4`. |
| `contentUrl` | Chemin privé relatif lié au rôle, à la conversation et au message ; une session autorisée reste nécessaire à chaque ouverture. |

La clé de stockage, le digest interne et le chemin de fichier ne font pas partie de ce DTO. Le transport réutilise les lectures privées `GET`/`HEAD` et Range du socle, avec authentification des blocs avant émission et mémoire bornée. Une lecture déjà ouverte suit le mécanisme d’interruption du transport ; ce jalon n’ajoute pas de révocation instantanée des octets déjà transmis.

La galerie ne contient que les liens vidéo de messages vivants de la conversation autorisée. Elle renvoie des pages de 1 à 100 éléments, par défaut 50, en ordre de séquence décroissant. Les séquences et le curseur `before` sont des chaînes décimales canoniques `BIGINT UNSIGNED`, sans conversion en nombre JavaScript. Chaque élément porte `messageId`, `sequence`, `sender`, `createdAt` et le DTO `video` ; la page contient `items`, `hasMore` et `nextBefore`, ce dernier nul en fin de parcours. Les messages texte et photo sont exclus de cette galerie.

## Schéma candidat et composition

La migration [0036 candidate](../server/video/migrations/0036_message_video.sql) ajoute `message_video(message_id, conversation_id, video_id, created_at)`. Sa clé primaire limite un message à un lien vidéo ; les clés étrangères lient le message à sa conversation et l’asset au catalogue, avec `RESTRICT`, sans cascade. L’adapter vérifie et refuse aussi un double lien photo/vidéo. Le [chargeur candidat](../server/video/migrations.mjs) compose désormais **33 migrations normales + 0034/0035/0036 = 36** via le moteur existant ; `db/migrations/` et le plan normal restent exactement à **33**.

Le [message-store candidat](../server/video/message-store.mjs) utilise les transactions du chat par une extension injectée. Son décorateur ne consulte les nouveaux liens que lorsqu’il est installé ; il conserve l’ordre et les répétitions de messages d’une page d’événements. L’inspection stricte du catalogue exige le ledger candidat courant ; celle du lien vérifie colonnes, index, clés étrangères et CHECKs. Les gardes historiques du schéma 33 ne sont pas élargis pour accepter ce schéma incomplet.

## Qualification et limite du jalon

Source fonctionnelle **`e113faf1ea7b278fb2f290b2981fb10bc8166968`**, arbre **`597567d65b8917b115e91d2597e468d71ae7ba2f`**, [PR 125 en brouillon](https://github.com/fredbuhr/jessiemessage/pull/125). La [CI propre 39674397798](https://github.com/fredbuhr/jessiemessage/actions/runs/39674397798) réussit **5/5, tentative 1**, sous Node **24.22.0**, cinq logs complets relus : général **3 435 tests / 3 394 réussis / zéro échec / 41 ignorés**, Chrome **189/189**, HTTPS **3/3**, MariaDB **10.11 et 11.4 chacune 527/527 sans omission**. L’arbre du merge synthétique testé est identique à la source. Un seul run PR, aucun run CI de type push ni relance. [Preuve structurée](verification-proofs/jm180-video-messages-verification.json).

Les dix scénarios catalogue et les dix scénarios de messages réussissent réellement sur chaque moteur : publication et réessai, perte d’accusé après vrai COMMIT, rollback message/lien/événement/notification, refus intercompte, révocation sous verrou, tombstones, dérive des clés étrangères et pagination au-delà des entiers JavaScript exacts. Les 41 omissions générales comprennent 39 suites SQL qualifiées séparément et deux conditions procfs ; elles ne sont pas assimilées à des succès natifs. Les preuves historiques 7.1 gardent leurs sources, leur plan candidat 35 et leurs résultats propres.

Localement, syntaxe **636 sources**, **73/73** tests ciblés chat et **17/17** nouveaux tests HTTP/service vidéo ; deux revues indépendantes sans blocage. La suite générale locale reste incomplète : trois ENOENT dus à `/tmp` absent, puis sortie zéro avec TMPDIR accessible mais sans bilan final dans le journal. La cause du journal incomplet n’est pas établie ; aucun résultat complet n’en est déduit. La qualification complète provient de la CI. La clôture documentaire seule suit avec `[skip ci]`, sans changement de la source fonctionnelle qualifiée.

Les fixtures de transport et SQL restent synthétiques. Ce jalon ne qualifie ni décodage vidéo, codec, durée, téléphone, transfert de 100 Mio sur le mutualisé ou débit réel. Le contrat de format, les quotas, les réservations incertaines et l’absence de miniature persistante restent ceux de [7.1](video-catalogue-180.md). Il ne qualifie pas encore l’export, la purge, la fermeture, l’inventaire, la capture, la restauration vidéo ou la compatibilité du repli avec le futur schéma.

La prochaine action est **7.3 — cycle de vie complet**, sur la même branche. Aucune donnée ni route vidéo de production n’est activée avant le résultat complet et sa qualification en 7.6 ; le lot garde une seule livraison produit selon le [plan](PLAN-IMPLEMENTATION.md).
