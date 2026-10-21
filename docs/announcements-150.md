# Annonces — Évolution 4, version 1.5.0

**Implémentation en cours.** La production reste la [1.4.0 close](REPRISE.md), sur le schéma 31. Aucune migration, préparation ou activation hébergée de ce lot n’est encore attestée.

## Parcours retenu

Jessie dispose d’une annonce courante : texte, début immédiat ou programmé, fin obligatoire. Le bandeau apparaît seulement pendant cette période. Il reste compact dans la discussion mobile ; son texte complet s’ouvre à la demande et le client peut le masquer. Une nouvelle annonce remplace la précédente.

L’option **Envoyer aussi en message privé** prépare une diffusion vers les clients éligibles après aperçu et confirmation du nombre. Les notifications habituelles s’appliquent aux appareils abonnés. L’audience des messages est figée à la confirmation ; les nouveaux invités peuvent ensuite voir le bandeau. Les envois restent progressifs selon les budgets existants, sans promesse de remise exactement à l’heure de début.

La période se termine au plus tard sept jours après l’enregistrement. Les messages en attente ne sont plus envoyés après la fin ; les notifications préparées ont aussi une échéance bornée. Retirer ou remplacer une annonce arrête son affichage et ses envois restants. Les messages déjà remis restent dans les conversations.

## Intégration

Une table `announcements` contient une ligne par administrateur, le texte chiffré, la période et la révision. L’annonce et sa campagne facultative sont enregistrées dans la même transaction. Les diffusions conservent leur format compact v2 et leurs dates de disponibilité/expiration existantes. Aucun worker, fournisseur, secret ou paquet supplémentaire n’est nécessaire.

La migration additive 0032 porte le schéma à **32 migrations, 31 tables applicatives et 32 avec le registre des migrations**. Le repli prévu est la [1.4.1 compatible](announcements-compat-141.md), dont le runtime normal conserve la création d’annonces désactivée. La 1.4.0 reste préservée ; elle n’est pas un repli qualifié pour le nouveau schéma.

La lecture d’une annonce reste soumise à la session et à la conversation du client. Révision et identifiant de mutation protègent les modifications simultanées et les réessais après réponse perdue. La fermeture d’un client conserve le bandeau global et détache, si nécessaire, sa référence à une campagne devenue vide. Sauvegarde et vérification intègrent le nouveau format ; les preuves historiques gardent leur couverture propre.

## Qualification et livraison restantes

Terminer les tests unitaires, les parcours SQL natifs et Chrome, puis la revue. Chaque référence 1.4.1/1.5.0 devra posséder ses propres qualifications PR/main, son tag et sa release immuables. Les commandes hébergées seront épinglées sur ces sources qualifiées avant toute migration ou activation. L’état courant et les prochaines actions sont exclusivement dans [REPRISE](REPRISE.md).

Les vérifications locales du code commun sont consignées séparément dans les [preuves 1.4.1](verification-proofs/jm141-verification.json). Elles ne qualifient pas encore une référence 1.5.0 exacte ; [suivi 1.5.0](verification-proofs/jm150-verification.json).
