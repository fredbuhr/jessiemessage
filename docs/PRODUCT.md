# JessieMessage — périmètre produit

JessieMessage est une messagerie privée sur invitation entre Jessie, en France, et chaque personne invitée. Chaque client accède à sa conversation avec Jessie et aux médias de cet échange ; il ne découvre pas les autres clients. Le site ne propose ni paiement, ni galerie publique, ni salon collectif.

L’**[état courant dans REPRISE](REPRISE.md)** centralise version, déploiement, preuves, limites et prochaine action. Ce document décrit le produit, sans tenir un second journal de livraison.

## Fonctions disponibles

- **Accès privé :** invitation personnelle consommée, e-mail vérifié et approbation explicite par l’administrateur. L’invitation ne certifie pas la majorité. Connexion administrateur avec second facteur, sessions indépendantes par appareil, révocation et récupération du mot de passe client selon les conditions d’accès.
- **Conversation :** texte, émojis, photos, légendes, historique et galerie de l’échange. Interface mobile et ordinateur, installable, en français et anglais. Depuis `1.1.0`, les accusés de lecture sont visibles uniquement par Jessie : le client ne reçoit pas l’état de lecture de l’administration. Les positions de lecture propres à chaque compte restent persistées pour ses badges et ses appareils.
- **Notifications :** activation facultative par appareil, contenu neutre et retour au message concerné après authentification. La réception dépend du navigateur, du système et du réseau ; toutes les plateformes physiques et l’arrière-plan ne sont pas qualifiés.
- **Administration :** boîte de réception, bibliothèque de photos, fiches privées, surnoms, notes, tags, groupes et rappels. Les groupes servent à organiser les clients ; les rappels ne déclenchent pas d’alerte. Les conflits de fiche conservent le brouillon pour une résolution explicite.
- **Diffusion :** sélection et confirmation des destinataires, puis messages individuels dans leurs conversations. Aucun salon partagé n’est créé.
- **Export :** téléchargement d’une conversation et de ses photos partagées pour lecture hors ligne, côté client et administrateur. Notes, surnoms privés, tags, groupes et photos non partagées sont exclus. Depuis `1.1.0`, l’export personnel client exclut aussi le point de lecture de l’administration ; les ZIP de conversation ne contiennent aucun reçu de lecture.

L’espace administrateur peut être utilisé par plusieurs personnes autorisées avec des sessions séparées. Les actions appartiennent au même compte applicatif ; elles n’identifient pas laquelle de ces personnes les a réalisées. Les informations privées des fiches ne sont pas exposées au client.

Le [guide quotidien](guide-jessie.md), les [détails du CRM](private-crm.md), la [diffusion](targeted-broadcasts.md) et la [recette synthétique datée](messaging-acceptance-079.md) précisent ces parcours. Aucune capacité de charge ni réception garantie de notification n’est déduite de cette recette.

## Conservation, copies et fermeture

Les conversations sont conservées jusqu’à la fermeture définitive du compte, hors suppressions volontaires de messages ou de photos. Déconnexion, suspension et expiration de l’accès ne ferment pas le compte.

La fermeture définitive exige une confirmation administrateur. Le traitement local journalisé arrête les producteurs, efface les données applicatives concernées et contrôle le résultat avant reprise. Les sauvegardes et téléchargements restent des copies distinctes ; la fermeture ne les réécrit pas.

Le mécanisme de copies chiffrées vers le PC déjà raccordé est conservé et nécessite normalement que le PC soit allumé, connecté et que la session Windows soit ouverte. Son fonctionnement actuel est bloqué ou incertain après le signalement antivirus ; l’état observé et le traitement différé figurent dans REPRISE. Les copies en attente peuvent se rattraper lorsque ce mécanisme fonctionne. Un reçu historique prouve la copie vérifiée du fichier à sa date, sans certifier son fonctionnement présent, son déchiffrement ou une restauration de l’application. Aucun nouveau raccordement n’est requis.

## Récupération manuelle et limites

La V1 reste sur l’hébergement mutualisé existant, sans infrastructure ni budget ajoutés. La [restauration opérateur](manual-restore-operator-078.md) utilise une nouvelle base et une nouvelle racine média isolées, sous maintenance. Elle vérifie la capture, applique un registre récent et complet de fermetures choisi par l’opérateur, révoque les anciennes sessions et exige une réouverture explicite. Les fichiers divergents et les quarantaines restent préservés.

Après la migration `0031`, les nouvelles captures du schéma 31 portent sur **31 tables physiques : 30 tables applicatives et le registre des migrations**, avec les six clés, les médias et les états opérationnels ; `completeDatabase:false`, objets SQL exécutables exclus. Les preuves historiques portant sur trente tables conservent leur périmètre et leurs résultats datés. Les qualifications sont synthétiques et ne constituent pas une restauration de production.

La récupération autonome après perte complète de l’hôte, un témoin frais à chaque phase, la succession de propriétaire et l’inventaire SQL exhaustif restent hors prérequis V1, sans garantie équivalente. Le registre récent relève de l’opérateur ; aucune garantie ne couvre la perte simultanée de l’hôte et de fermetures non copiées. Le secours Infomaniak sur sept jours ne garantit pas une capture simultanée fichiers/base. Les messages postérieurs à la capture peuvent être perdus et aucune perte maximale de vingt-quatre heures n’est garantie.

Les sujets d’exploitation, notamment la maintenance Node, le traitement PC/Avast et l’exécuteur d’archivage, ont leur état exact dans REPRISE. La version Node est distincte de la version applicative. Ces réserves ne sont pas effacées par l’harmonisation `1.0.0` ; aucune purge automatique ni garantie de récupération supplémentaire n’est ajoutée.

## Évolutions et historique

La référence `1.0.0` harmonise la V1 existante. La [lecture privée, livrée en `1.1.0`](private-read-receipts-110.md), réutilise les positions de lecture existantes, sans nouvelle infrastructure ni migration SQL.

Le [lot `1.2.0` — Profil et expressions](profile-expressions-120.md) est publié : pseudonyme public et avatar côté client/administration, puis catalogue de 180 emojis Unicode avec catégories et recherche FR/EN. Son utilisation commence **après activation** sur le service. La publication et l’activation sont distinguées dans REPRISE, seul état courant. L’avatar utilise le stockage privé existant ; les emojis s’insèrent dans le brouillon sans envoi automatique. Aucun sticker graphique ni dépendance supplémentaire.

La [cible `1.3.0` — Emojis enrichis et inclusifs](emoji-inclusifs-130.md) complète ce catalogue, ajoute des doubles sens et un choix de cinq carnations pour les gestes et personnages compatibles. Cette évolution en cours conserve le texte Unicode et l’envoi explicite, sans API externe, dépendance ou migration SQL supplémentaire. Elle n’inclut pas de bibliothèque Flirtmoji réhébergée sans droits spécifiques ; le partage individuel permis par leur FAQ est distinct. Elle devient disponible après activation vérifiée dans REPRISE.

Vidéos, annonces, diffusions élargies et alertes de tâches restent des évolutions distinctes, ordonnées dans le [plan de travail](PLAN-IMPLEMENTATION.md). Une fonction codée ou publiée reste indisponible tant que son déploiement n’est pas vérifié.

L’[ancienne fiche produit, relevé du 20 octobre 2026 avant entretien](https://github.com/fredbuhr/jessiemessage/blob/bbd733d85b49b892d78c7cd90509ced04a990939/docs/PRODUCT.md) est conservée dans Git. Ses fonctions annoncées comme futures et son ancien statut de livraison sont historiques.
