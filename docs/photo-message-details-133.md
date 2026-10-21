# Détails des messages photo au toucher — correctif 1.3.3

**21 octobre 2026 — complément 1.3.3 codé, revu, fusionné, qualifié par les CI PR/main 5/5 à la première tentative et publié ; préparation hébergée et activation non encore réalisées.** La production reste **1.3.1**, source `baf91e0e7ec9ffee7723e7332e07b7437c8dc5a8`, sous Node **24.22.0**. L’utilisateur a validé visuellement sa présentation mobile ; le reçu d’alignement des métadonnées 1.3.1 reste absent et sa clôture n’est pas revendiquée. [État courant et commande opérateur](REPRISE.md), [preuves 1.3.3](verification-proofs/jm133-verification.json).

## Périmètre du complément

Le correctif conserve le code de la 1.3.2 et rend le bouton natif **⋯** constamment visible à côté des seuls messages photo. Une photo sans légende doit ainsi offrir un accès tactile explicite à la sélection et aux détails du message. Le bouton reste accessible au clavier et réutilise la sélection existante.

Ce repère ne doit ajouter aucune hauteur à la conversation. Les dates, statuts et actions de suppression restent masqués au repos ; seul **⋯** devient visible sur les photos. Les messages texte conservent leur présentation compacte. Une sélection ne doit déclencher ni ouverture de la photo, ni téléchargement, ni suppression, ni envoi.

Le lot est limité à la présentation CSS, à sa qualification Chrome et au numéro de correctif **1.3.3**. Aucun changement JavaScript, API serveur, migration SQL ou dépendance n’est prévu. Le schéma reste **31**. Les textes FR/EN à la première personne, les limites de lecture privée, les protections d’accès, les photos et les autres comportements acquis en 1.3.2 restent conservés.

## Socle 1.3.2 conservé

La **1.3.2 est fusionnée, qualifiée et publiée**, avec un tag immuable. Son [bilan](client-voice-message-details-132.md) conserve les liens de la PR 115, des CI PR/main, de la publication et du tag/release v1.3.2 ; ses [preuves](verification-proofs/jm132-verification.json) restent historiques. Ces résultats ne qualifient pas le complément 1.3.3.

La 1.3.2 n’a jamais été préparée ni activée sur l’hébergement. La 1.3.3 la remplace comme prochaine candidate à livrer : **aucune préparation intermédiaire de 1.3.2 n’est demandée**. Le travail local part de `76b80e33fba5f4cbcebcf73193944077e631af50`, sur la branche `fix/photo-message-details-133` ; cette base n’est pas le commit fusionné de 1.3.3. La source de fusion est désormais `ca0d40648036d57fdee55b91d47d5d5a874a626e`, arbre `b1fe882ede0450cbf135d2ff8cb19e780d18a0e5`.

## Critères de qualification 1.3.3

- **Toucher, photo sans légende :** le bouton ⋯ est visible au repos et permet de sélectionner le message puis d’afficher ses détails, sur un viewport mobile. Le toucher sur ce bouton n’ouvre pas la photo et ne déclenche aucune autre action.
- **Toucher, photo avec légende :** le même repère est visible et utilisable ; la légende reste lisible et les détails ne concernent que le message sélectionné.
- **Clavier :** le bouton natif reste atteignable, son nom accessible FR/EN et son focus restent compréhensibles, et l’activation permet d’accéder aux détails. La sortie de sélection conserve le parcours existant.
- **Disposition compacte :** vérifier petite largeur et ordinateur, messages reçus et envoyés, sans débordement horizontal ni hauteur supplémentaire due au bouton. Le repère ne doit masquer ni l’image ni la légende ni une autre action.
- **Métadonnées au repos :** dates, statuts et suppression restent masqués sur les photos non sélectionnées ; les textes ne reçoivent pas de bouton constamment visible. Les erreurs et reprises nécessaires restent disponibles selon le comportement existant.
- **Livraison exacte :** consigner les contrôles réellement exécutés, la revue, les CI du commit concerné et la publication avant toute préparation hébergée. Distinguer Chrome automatisé, simulation de viewport et essai sur téléphone physique.

## Qualification et publication acquises

La [PR 116](https://github.com/fredbuhr/jessiemessage/pull/116), head `76f781f0c18311649a3b6c7e57df48530dfb8955`, arbre `b1fe882ede0450cbf135d2ff8cb19e780d18a0e5`, est fusionnée sur `ca0d40648036d57fdee55b91d47d5d5a874a626e`, avec le même arbre. Le head de PR et le commit de fusion restent distingués.

**Local et revue :** syntaxe navigateur vérifiée par `node --check` et contrôle du diff réussis sous Node **24.19.0**. La revue indépendante finale ne relève aucun blocage. Aucun résultat d’essai sur téléphone physique n’est rapporté.

**CI de PR réussie :** le [run 39531378842](https://github.com/fredbuhr/jessiemessage/actions/runs/39531378842) est terminé **5/5 à la tentative 1**, résultat confirmé le `2026-10-21T02:14:15Z` après relecture des cinq journaux. Chrome `118997816280` : **174/174 sans omission** ; HTTPS/MariaDB `118997816312` : **3/3** ; verify `118997816364` : **3 226 tests, 3 190 réussis, zéro échec et 36 ignorés**, syntaxe/build **583 sources** ; MariaDB **10.11** `118997816108` et **11.4** `118997816402` : **479/479 chacune, zéro échec et zéro omission**. Les omissions générales ne valent pas qualification native.

**CI main du commit exact réussie :** le [run 39531961261](https://github.com/fredbuhr/jessiemessage/actions/runs/39531961261), source `ca0d40648036d57fdee55b91d47d5d5a874a626e`, est terminé le `2026-10-21T02:21:03Z`, **5/5 à la tentative 1, sans relance**. Le run, sa source, ses jobs et les cinq journaux ont été relus. Verify `118999702189` : **3 226 tests, 3 190 réussis, zéro échec et 36 ignorés**, syntaxe/build **583 sources** ; Chrome `118999701945` : **174/174** ; HTTPS/MariaDB `118999702159` : **3/3** ; MariaDB **10.11** `118999702300` et **11.4** `118999702101` : **479/479 chacune**, avec zéro échec et zéro omission dans les quatre jobs natifs.

**Publication vérifiée :** le [tag/release v1.3.3](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.3), publié le `2026-10-21T02:22:03Z`, cible la source `ca0d40648036d57fdee55b91d47d5d5a874a626e`, arbre `b1fe882ede0450cbf135d2ff8cb19e780d18a0e5`, relus à l’identique. Le [run de publication 39532598912](https://github.com/fredbuhr/jessiemessage/actions/runs/39532598912) a réussi ; sa source opérateur est `95fe1326aea86487ac2db15ccd58f60353cfd2ee`.

Le nouveau parcours Chrome vérifie les photos **sans légende** dans **12 combinaisons** : largeurs **320, 360 et 390 px**, rôles **client et administration**, messages **propres et reçus**. Les parcours clavier FR/EN existants restent conservés dans la suite. Ces observations automatisées restent distinctes d’un essai sur téléphone physique et des résultats historiques de 1.3.2.

## Parcours de livraison restant

La prochaine opération utilisateur est le **bloc unique de [REPRISE](REPRISE.md)** : terminer d’abord l’alignement idempotent 1.3.1, puis préparer la 1.3.3 sur le commit et l’arbre exacts qualifiés et publiés, sans redémarrage. La source, l’arbre et le helper épinglé sont consignés dans ce bilan ; les préconditions CI main et publication sont vérifiées. Aucun de ces reçus d’exécution n’est encore rapporté.

Le [helper de préparation 1.3.3](https://github.com/fredbuhr/jessiemessage/blob/ffa6d51ff767d571e9031e1f00bfa207c33d5c41/ops/prepare-release133.sh) est publié sur la branche `ops/release133-tools`, commit `ffa6d51ff767d571e9031e1f00bfa207c33d5c41`, SHA-256 `deae2f94c4032b862a2911c4493e76eedf25ee7f013a804a6e841a74f396ca77`. Ses [tests synthétiques](https://github.com/fredbuhr/jessiemessage/blob/ffa6d51ff767d571e9031e1f00bfa207c33d5c41/ops/test-release133-staging-synthetic.py), SHA-256 `1b9e17496c521fcae375918844c2bdf3e4f8563f73fe3a30c2bcf0d562ae970b`, réussissent **15/15** ; la syntaxe Bash et celle du Python embarqué sont valides. Les deux fichiers bruts publiés ont été relus et comparés aux octets locaux. Le helper cible la source `ca0d40648036d57fdee55b91d47d5d5a874a626e`, arbre `b1fe882ede0450cbf135d2ff8cb19e780d18a0e5`, avec la 1.3.1 comme repli. Cette qualification synthétique n’est pas une préparation hébergée : le helper n’a pas été exécuté sur l’hébergement.

La préparation devra conserver la **1.3.1 comme repli immédiat de 1.3.3**, avec le schéma 31 et les dépendances inchangés. Le repli actuel de la production 1.3.1 reste 1.3.0 ; les références antérieures sont préservées. L’activation restera conditionnée au reçu de préparation réussi et devra être vérifiée avant de déclarer 1.3.3 active. Aucun reçu hébergé 1.3.3 ni d’alignement privé 1.3.1 n’est encore rapporté.
