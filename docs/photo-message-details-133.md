# Détails des messages photo au toucher — correctif 1.3.3

**21 octobre 2026 — complément 1.3.3 en cours ; aucun résultat de qualification, commit livré ou publication encore établi.** La production reste **1.3.1**, source `baf91e0e7ec9ffee7723e7332e07b7437c8dc5a8`, sous Node **24.22.0**. L’utilisateur a validé visuellement sa présentation mobile ; le reçu d’alignement des métadonnées 1.3.1 reste absent et sa clôture n’est pas revendiquée. [État courant](REPRISE.md), [preuves 1.3.3](verification-proofs/jm133-verification.json).

## Périmètre du complément

Le correctif conserve le code de la 1.3.2 et rend le bouton natif **⋯** constamment visible à côté des seuls messages photo. Une photo sans légende doit ainsi offrir un accès tactile explicite à la sélection et aux détails du message. Le bouton reste accessible au clavier et réutilise la sélection existante.

Ce repère ne doit ajouter aucune hauteur à la conversation. Les dates, statuts et actions de suppression restent masqués au repos ; seul **⋯** devient visible sur les photos. Les messages texte conservent leur présentation compacte. Une sélection ne doit déclencher ni ouverture de la photo, ni téléchargement, ni suppression, ni envoi.

Le lot est limité à la présentation CSS, à sa qualification Chrome et au numéro de correctif **1.3.3**. Aucun changement JavaScript, API serveur, migration SQL ou dépendance n’est prévu. Le schéma reste **31**. Les textes FR/EN à la première personne, les limites de lecture privée, les protections d’accès, les photos et les autres comportements acquis en 1.3.2 restent conservés.

## Socle 1.3.2 conservé

La **1.3.2 est fusionnée, qualifiée et publiée**, avec un tag immuable. Son [bilan](client-voice-message-details-132.md) conserve les liens de la PR 115, des CI PR/main, de la publication et du tag/release v1.3.2 ; ses [preuves](verification-proofs/jm132-verification.json) restent historiques. Ces résultats ne qualifient pas le complément 1.3.3.

La 1.3.2 n’a jamais été préparée ni activée sur l’hébergement. La 1.3.3 la remplace comme prochaine candidate à livrer : **aucune préparation intermédiaire de 1.3.2 n’est demandée**. Le travail local part de `76b80e33fba5f4cbcebcf73193944077e631af50`, sur la branche `fix/photo-message-details-133` ; cette base n’est pas un commit livré de 1.3.3. La source et l’arbre définitifs de cette dernière restent à établir.

## Critères de qualification 1.3.3

- **Toucher, photo sans légende :** le bouton ⋯ est visible au repos et permet de sélectionner le message puis d’afficher ses détails, sur un viewport mobile. Le toucher sur ce bouton n’ouvre pas la photo et ne déclenche aucune autre action.
- **Toucher, photo avec légende :** le même repère est visible et utilisable ; la légende reste lisible et les détails ne concernent que le message sélectionné.
- **Clavier :** le bouton natif reste atteignable, son nom accessible FR/EN et son focus restent compréhensibles, et l’activation permet d’accéder aux détails. La sortie de sélection conserve le parcours existant.
- **Disposition compacte :** vérifier petite largeur et ordinateur, messages reçus et envoyés, sans débordement horizontal ni hauteur supplémentaire due au bouton. Le repère ne doit masquer ni l’image ni la légende ni une autre action.
- **Métadonnées au repos :** dates, statuts et suppression restent masqués sur les photos non sélectionnées ; les textes ne reçoivent pas de bouton constamment visible. Les erreurs et reprises nécessaires restent disponibles selon le comportement existant.
- **Livraison exacte :** consigner les contrôles réellement exécutés, la revue, les CI du commit concerné et la publication avant toute préparation hébergée. Distinguer Chrome automatisé, simulation de viewport et essai sur téléphone physique.

Aucun de ces critères n’est encore déclaré réussi pour la 1.3.3. Les résultats, compteurs, éventuelles tentatives échouées et limites seront ajoutés après observation ; les résultats de la 1.3.2 ne sont pas recopiés comme preuve de la nouvelle version.

## Parcours de livraison restant

Après qualification du commit exact et publication de la 1.3.3, la future opération utilisateur réunira dans un **seul bloc de [REPRISE](REPRISE.md)** l’alignement idempotent 1.3.1, puis la préparation 1.3.3, sans redémarrage. Les pins de la source, de l’arbre et du helper de préparation 1.3.3 ne sont pas encore connus ; **aucune action opérateur n’est demandée actuellement**.

La préparation devra conserver la **1.3.1 comme repli immédiat de 1.3.3**, avec le schéma 31 et les dépendances inchangés. Le repli actuel de la production 1.3.1 reste 1.3.0 ; les références antérieures sont préservées. L’activation restera conditionnée au reçu de préparation réussi et devra être vérifiée avant de déclarer 1.3.3 active. Aucun reçu hébergé 1.3.3 ni d’alignement privé 1.3.1 n’est encore rapporté.
