# Repli compatible vidéo — développement 1.7.2

**G4 en cours : référence technique de repli, non qualifiée, non publiée et non préparée sur l’hôte.** La production reste 1.7.1 / Node 24.22.1 / SQL 33, selon [REPRISE](REPRISE.md). La livraison produit prévue reste 1.8.0 ; ce repli n’est pas une activation intermédiaire.

La branche `fix/video-compat-172` part du checkpoint G3 `92a59e3de98bcc848b507aa593901e0d57e5e2ce`, dont la source fonctionnelle `4f6587aee355b213b58734b576809eae0943553c` est qualifiée. Elle conserve le profil vidéo explicite, ses sept configurations et SQL 36. Le chargeur normal reste SQL 33. Aucun nouveau schéma, paquet, clé ou service n’est ajouté par le repli.

## Comportement attendu du repli

Les lecteurs vidéo, Range, galerie, ZIP, campagnes v3, capsules contenant les réponses personnelles, reçus mixtes et fermetures restent disponibles. Les diffusions vidéo déjà enregistrées peuvent terminer leur livraison. Le catalogue privé reste lisible et ses phrases peuvent être insérées dans un message texte.

Les nouvelles créations vidéo et les modifications de réponses personnelles sont désactivées distinctement, côté serveur et interface. Le runtime ne coupe pas la lecture vidéo pour bloquer la création. Les refus gardent les contrôles de session, origine et CSRF. Les envois texte/photo, le CRM, les annonces, tâches et sauvegardes manuelles continuent ; aucun automatisme abandonné n’est réintroduit.

## Qualification et livraison restant à attester

Le code des gardes et de l’interface est implémenté et relu. Sous Node 24.22.1, les groupes ciblés passent : backend 232/232, interface et modèle 147/147, gardes/nettoyage du rehearsal 17/17, sans omission. Ces groupes ne sont pas additionnés ; les contrôles natifs restent à exécuter dans la CI de cette référence.

Le parcours de compatibilité doit démarrer l’application réellement configurée avec les créations désactivées, sur une base synthétique SQL 36 déjà peuplée. Il doit constater les refus directs d’écriture, la lecture des données existantes, la livraison d’une campagne v3 en attente et la conservation des fichiers privés. Les parcours natifs de capture, fermeture et restauration complètent ce contrôle.

Une CI de branche puis une CI du commit fusionné sont nécessaires avant tag/release immuables. La publication de cette référence technique ne change pas la release de production courante. Préparation des checkouts et lanceurs, migration vers SQL 36, précontrôle du repli sans démarrage, activation 1.8.0 et contrôle en service restent des opérations distinctes à consigner. Ne jamais redémarrer 1.7.1 ou 1.6.0 sur SQL 36.

Les preuves G1–G3 restent historiques et inchangées. Un test synthétique ne qualifie ni téléphone physique, ni débit du mutualisé, ni activation hébergée.
