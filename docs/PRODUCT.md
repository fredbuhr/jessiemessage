# JessieMessage — périmètre produit

JessieMessage est une messagerie privée sur invitation entre Jessie, en France, et chaque personne invitée. Chaque client accède à sa conversation avec Jessie et aux médias de cet échange ; il ne découvre pas les autres clients. Le site ne propose ni paiement, ni galerie publique, ni salon collectif.

L’**[état courant dans REPRISE](REPRISE.md)** centralise version, déploiement, preuves, limites et prochaine action. Ce document décrit le produit, sans tenir un second journal de livraison.

## Fonctions disponibles

- **Accès privé :** invitation personnelle consommée, e-mail vérifié et approbation explicite par l’administrateur. L’invitation ne certifie pas la majorité. Connexion administrateur avec second facteur, sessions indépendantes par appareil, révocation et récupération du mot de passe client selon les conditions d’accès.
- **Conversation :** texte, émojis, photos, légendes, historique et galerie de l’échange. Interface mobile et ordinateur, installable, en français et anglais.
- **Notifications :** activation facultative par appareil, contenu neutre et retour au message concerné après authentification. La réception dépend du navigateur, du système et du réseau ; toutes les plateformes physiques et l’arrière-plan ne sont pas qualifiés.
- **Administration :** boîte de réception, bibliothèque de photos, fiches privées, surnoms, notes, tags, groupes et rappels. Les groupes servent à organiser les clients ; les rappels ne déclenchent pas d’alerte. Les conflits de fiche conservent le brouillon pour une résolution explicite.
- **Diffusion :** sélection et confirmation des destinataires, puis messages individuels dans leurs conversations. Aucun salon partagé n’est créé.
- **Export :** téléchargement d’une conversation et de ses photos partagées pour lecture hors ligne, côté client et administrateur. Notes, surnoms privés, tags, groupes et photos non partagées sont exclus.

L’espace administrateur peut être utilisé par plusieurs personnes autorisées avec des sessions séparées. Les actions appartiennent au même compte applicatif ; elles n’identifient pas laquelle de ces personnes les a réalisées. Les informations privées des fiches ne sont pas exposées au client.

Le [guide quotidien](guide-jessie.md), les [détails du CRM](private-crm.md), la [diffusion](targeted-broadcasts.md) et la [recette synthétique datée](messaging-acceptance-079.md) précisent ces parcours. Aucune capacité de charge ni réception garantie de notification n’est déduite de cette recette.

## Conservation, copies et fermeture

Les conversations sont conservées jusqu’à la fermeture définitive du compte, hors suppressions volontaires de messages ou de photos. Déconnexion, suspension et expiration de l’accès ne ferment pas le compte.

La fermeture définitive exige une confirmation administrateur. Le traitement local journalisé arrête les producteurs, efface les données applicatives concernées et contrôle le résultat avant reprise. Les sauvegardes et téléchargements restent des copies distinctes ; la fermeture ne les réécrit pas.

Les sauvegardes chiffrées sont copiées vers le PC déjà raccordé lorsqu’il est allumé, connecté et que la session Windows est ouverte. Les copies en attente peuvent se rattraper. Un reçu prouve la copie vérifiée du fichier chiffré, sans certifier le déchiffrement ou une restauration de l’application. La mise à jour personnelle du kit A07 reste à constater ; elle ne demande aucun nouveau raccordement.

## Récupération manuelle et limites

La V1 reste sur l’hébergement mutualisé existant, sans infrastructure ni budget ajoutés. La [restauration opérateur](manual-restore-operator-078.md) utilise une nouvelle base et une nouvelle racine média isolées, sous maintenance. Elle vérifie la capture, applique un registre récent et complet de fermetures choisi par l’opérateur, révoque les anciennes sessions et exige une réouverture explicite. Les fichiers divergents et les quarantaines restent préservés.

Ce parcours couvre les trente tables applicatives, les six clés, les médias et les états opérationnels ; `completeDatabase:false`, objets SQL exécutables exclus. Les qualifications sont synthétiques et ne constituent pas une restauration de production.

La récupération autonome après perte complète de l’hôte, un témoin frais à chaque phase, la succession de propriétaire et l’inventaire SQL exhaustif restent hors prérequis V1, sans garantie équivalente. Le registre récent relève de l’opérateur ; aucune garantie ne couvre la perte simultanée de l’hôte et de fermetures non copiées. Le secours Infomaniak sur sept jours ne garantit pas une capture simultanée fichiers/base. Les messages postérieurs à la capture peuvent être perdus et aucune perte maximale de vingt-quatre heures n’est garantie.

A01 (version Node fournie par l’hébergeur), l’installation personnelle du kit A07 et l’exécuteur actif d’archivage A08 restent des sujets distincts. A08 dispose d’un avertissement et d’un dry-run ; aucune purge automatique n’est ajoutée. Leur état exact reste dans REPRISE.

## Historique

L’[ancienne fiche produit, relevé du 20 octobre 2026 avant entretien](https://github.com/fredbuhr/jessiemessage/blob/bbd733d85b49b892d78c7cd90509ced04a990939/docs/PRODUCT.md) est conservée dans Git. Ses fonctions annoncées comme futures et son ancien statut de livraison sont historiques.
