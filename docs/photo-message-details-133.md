# Détails des messages photo au toucher — correctif 1.3.3

**21 octobre 2026 — complément 1.3.3 codé, revu, fusionné, qualifié par les CI PR/main 5/5 à la première tentative, publié, précontrôlé, actif selon le relevé admin utilisateur et enregistré dans le checkpoint privé ; livraison close.** La production est **1.3.3**, source `ca0d40648036d57fdee55b91d47d5d5a874a626e`, arbre `b1fe882ede0450cbf135d2ff8cb19e780d18a0e5`, sous Node **24.22.0**. Le schéma reste 31 et le repli immédiat 1.3.1 est préservé. Le reçu `release131_metadata_already_recorded` clôt la livraison historique 1.3.1 ; le reçu `release133_metadata_recorded` confirme désormais l’alignement privé 1.3.3. [État courant](REPRISE.md), [preuves 1.3.3](verification-proofs/jm133-verification.json).

## Périmètre du complément

Le correctif conserve le code de la 1.3.2 et rend le bouton natif **⋯** constamment visible à côté des seuls messages photo. Une photo sans légende doit ainsi offrir un accès tactile explicite à la sélection et aux détails du message. Le bouton reste accessible au clavier et réutilise la sélection existante.

Ce repère ne doit ajouter aucune hauteur à la conversation. Les dates, statuts et actions de suppression restent masqués au repos ; seul **⋯** devient visible sur les photos. Les messages texte conservent leur présentation compacte. Une sélection ne doit déclencher ni ouverture de la photo, ni téléchargement, ni suppression, ni envoi.

Le lot est limité à la présentation CSS, à sa qualification Chrome et au numéro de correctif **1.3.3**. Aucun changement JavaScript, API serveur, migration SQL ou dépendance n’est prévu. Le schéma reste **31**. Les textes FR/EN à la première personne, les limites de lecture privée, les protections d’accès, les photos et les autres comportements acquis en 1.3.2 restent conservés.

## Socle 1.3.2 conservé

La **1.3.2 est fusionnée, qualifiée et publiée**, avec un tag immuable. Son [bilan](client-voice-message-details-132.md) conserve les liens de la PR 115, des CI PR/main, de la publication et du tag/release v1.3.2 ; ses [preuves](verification-proofs/jm132-verification.json) restent historiques. Ces résultats ne qualifient pas le complément 1.3.3.

La 1.3.2 n’a jamais été préparée ni activée sur l’hébergement. La 1.3.3 a été préparée puis activée directement depuis 1.3.1 : **aucune préparation intermédiaire de 1.3.2 n’a été nécessaire**. Le travail local part de `76b80e33fba5f4cbcebcf73193944077e631af50`, sur la branche `fix/photo-message-details-133` ; cette base n’est pas le commit fusionné de 1.3.3. La source de fusion est désormais `ca0d40648036d57fdee55b91d47d5d5a874a626e`, arbre `b1fe882ede0450cbf135d2ff8cb19e780d18a0e5`.

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

## Préparation et activation confirmées

Le bloc unique a été exécuté par l’utilisateur. Le writer 1.3.1 a d’abord renvoyé `release131_metadata_already_recorded` : l’état 1.3.1 était déjà aligné, sans réécriture ni redémarrage, avec le repli 1.3.0, l’ancien état intégral et les autres blocs conservés. La date du premier enregistrement 1.3.1 n’est pas rapportée et n’est pas déduite de ce reçu.

Le [helper de préparation 1.3.3](https://github.com/fredbuhr/jessiemessage/blob/ffa6d51ff767d571e9031e1f00bfa207c33d5c41/ops/prepare-release133.sh), commit `ffa6d51ff767d571e9031e1f00bfa207c33d5c41`, SHA-256 `deae2f94c4032b862a2911c4493e76eedf25ee7f013a804a6e841a74f396ca77`, a ensuite renvoyé `staged_precheck_passed` pour **1.3.3**, source et arbre exacts publiés, sous Node **v24.22.0**, schéma **31** inchangé et `pendingClosures:false`. Les [preuves structurées](verification-proofs/jm133-verification.json) conservent le reçu intégral, ses chemins, empreintes et modes. Les **15 tests synthétiques**, syntaxes Bash/Python valides et octets bruts publiés vérifiés restent distincts de cette exécution hébergée.

| Élément préparé | Chemin et empreinte SHA-256 rapportés |
| --- | --- |
| Checkout | `/srv/customer/jessiemessage-operator/production-133-ca0d4064` |
| Lanceur Run, mode 0700 | `/srv/customer/jessiemessage-private/start-primary-release133-ca0d4064.sh` — `88aad7a731cc58a4367e808c9f4156b47c6f647f71b10f4b2e0fb65d093cea89` |
| Lanceur de précontrôle | `/srv/customer/jessiemessage-private/check-primary-release133-ca0d4064.sh` — `80bfd6dbeebacc4f550baf95d76921e85b3e196814b12554333c80561d155623` |
| Journal de précontrôle | `/srv/customer/jessiemessage-private/jm133-preflight-ca0d4064.log` — `cb5a9e6d1d1354abe8113cb12e7c6e3d636b5111041851ada88f85c5b845fea6` |
| Repli conservé | `/srv/customer/jessiemessage-private/start-primary-release131-baf91e0e.sh`, Node `v24.22.0` |

Les valeurs `started:false`, `migrated:false`, `runtimeStarted:false`, `managerChanged:false` et `checkpointChanged:false` décrivent la préparation. Elles ne sont pas réécrites après activation ; ce helper n’a ni démarré le service ni changé le Manager ou les métadonnées.

Le relevé admin utilisateur reçu ensuite confirme **1.3.3**, commit **`ca0d40648036d57fdee55b91d47d5d5a874a626e`**, Node **`v24.22.0`**, et relevé au démarrage **`21/10/2026 13:20:11`**. Le texte est conservé exactement, sans supposer le fuseau du navigateur ni déduire un epoch. Il identifie le processus HTTP répondant, sans GET privé directement observé par l’agent ni attestation PID/socket/empreinte du binaire exécuté. Aucun essai physique de l’interface 1.3.3 n’est rapporté par ce seul relevé.

**Ne rejouer ni préparation, ni Build/Run, ni redémarrage ou relevé admin pour cette activation acquise.** Le schéma 31 et les dépendances restent inchangés, le repli 1.3.1 est conservé ainsi que les références 1.3.0/1.2.0/1.1.1.

## Alignement final confirmé — livraison close

L’utilisateur a exécuté le [writer 1.3.3 épinglé](https://github.com/fredbuhr/jessiemessage/blob/416d271dac67610fb7614e0089edf48399958ea4/ops/record-release133.py), SHA-256 `d4cc3ad08aee634bdc1aa0a417c332c95407f460f4be30d0609d03cf66716cce`, publié et qualifié. Ses [tests synthétiques autonomes](https://github.com/fredbuhr/jessiemessage/blob/416d271dac67610fb7614e0089edf48399958ea4/ops/test-record-release133.py), SHA-256 `897187a800c0938cdaa206b8343ed6afed107ae5717ee36f477f3a02d8e7205d`, réussissent **9/9**, zéro échec et zéro omission, en **0,375 s**, avec les deux fichiers dans un répertoire temporaire. L’AST Python est valide, la revue indépendante ne relève aucun blocage et les octets bruts publiés ont été relus à l’identique.

Le writer conserve les gardes et fonctions du writer 1.3.1 qualifié ; son ancien état attendu correspond exactement à l’état courant 1.3.1 déjà confirmé. Le reçu confirme qu’il a préservé l’ancien `activeService` 1.3.1 intégral, ses extensions et empreintes, le repli utilisable 1.3.1, les autres blocs et les références 1.3.0/1.2.0/1.1.1. Une seconde exécution identique constate l’état sans réécriture. Il ne fait qu’un enregistrement atomique de métadonnées, sans migration ni redémarrage.

**Le reçu SSH utilisateur confirme l’enregistrement de la livraison 1.3.3 :**

```json
{"status":"release133_metadata_recorded","source":"ca0d40648036d57fdee55b91d47d5d5a874a626e","version":"1.3.3","metadataOnly":true,"noRestart":true,"rollbackPreserved":true,"rollbackRelease":"1.3.1","schemaMigrations":31,"priorActivePreserved":true,"otherBlocksPreserved":true}
```

Cette preuve rapportée par l’utilisateur reste distincte d’une lecture directe du checkpoint privé par l’agent. La date exacte de l’enregistrement n’est pas fournie et n’est pas déduite du relevé de démarrage. **La livraison 1.3.3 est close.** Ne rejouer ni writer, ni préparation, ni Build/Run, ni redémarrage ou relevé admin pour la clôturer. [REPRISE](REPRISE.md) conserve l’état courant ; aucun autre lot ou parcours PC n’est ouvert.
