# Livraison 1.13.0 — préparation et CHECK acquis, activation attendue

État du31octobre2026. [REPRISE](REPRISE.md) reste la référence courante ; ce guide distingue la publication de l'installation sur le service Node239143. `recette.jessiemessage.com` et `jessiemessage.com` partagent ce service et sa base.

## Résultat acquis

- [PR144](https://github.com/fredbuhr/jessiemessage/pull/144) fusionnée ; source/tag **`b9e2ad78b47dccb72b8e793cdc448e6b70424430`**, arbre **`dc8933723a54c0307a3fd52719bdd4fd3ac3f96a`**. `main` documentaire peut avancer ensuite, sans déplacement du tag.
- Qualifications finales [PR41221505431](verification-proofs/jm1130/pr-native.json) et [main41222320731](verification-proofs/jm1130/main-native.json), tentative1,5/5 chacune. Général4170réussis/52omissions sur4222 ; Chrome292/292, HTTPS14/14, MariaDB613/613 chacune. Douze captures finales inspectées, arbre complet identique sur main. [Bilan et limites](conversation-lists-1130.md).
- [Publication41223112832](verification-proofs/jm1130/publication-native.json), tentative1,2/2 ; neuf tests natifs de l'opérateur sans omission. Opérateur `01c448fb65432366acb8b07a5df2743053a5611e`, arbre `728079800a5d44ed8c729f647daca75ced4a0c5a`. Scripts et workflow relus aux octets qualifiés. [Tag/release/latestv1.13.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.13.0), release430071184, concordants.
- Nodev24.22.1,38migrations/37tables attendues, dépendances inchangées. Aucun inventaire physique de production nouveau déduit de la CI.

**Préparation et CHECK1130 acquis selon le reçu utilisateur ; activation1130 non rapportée.** La dernière identité active rapportée reste1.12.0/source9bfdae07, arbre4aef91b8, démarrée le31octobre02:29:16Europe/Paris. Sa préparation/CHECK et son démarrage sont acquis et ne sont pas à répéter.

## Inspection en lecture seule — acquise

Le [reçu transmis par l’utilisateur](verification-proofs/jm1130/hosted-checkpoint-inspection.json) retrouve le checkpoint privé **1.11.2**, source `af352607ff7e12c41185f42b8232c72219a304cd`, arbre `655f759079979d608b0ec1c62a7c892311899515`, SHA256 **`3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f`**, `release1120Present:false`.

L’enregistrement final1120 n’est pas présent dans le fichier relu. Le démarrage1120 reste confirmé séparément ; l’inspection ne décrit ni le processus, ni le Manager, ni la disponibilité HTTP. Elle ne permet pas de conclure au déroulement de l’ancienne commande. Ne rejouer aucun writer1120/1113 et ne pas refaire cette lecture sans élément nouveau. Le [bloc de lecture qualifié sur sept cas synthétiques](verification-proofs/jm1130/checkpoint-inspection-command.json) et son historique sont préservés dans Git.

## Préparation et CHECK 1.13.0 — acquis, ne pas rejouer

Le nouvel opérateur est qualifié : [run41226621742](verification-proofs/jm1130/preparation-native.json), tentative1, **1/1 job et33/33 tests natifs sans omission** sousNodev24.22.1. Source **`7f2051b75c24bf6ec947349205070e62fbeb8aa0`**, arbre **`b1499dab714e606f7741e93abc4d1e96a83a89a1`**. Préparateur SHA256 **`0be0e7c51836a9c0576e785fc56373b1b60ea98564a473fd628fadda09e52980`**,19215octets, relu au commit qualifié. Les essais natifs restent acquis et ne sont pas à relancer.

La [préparation/CHECK hébergés](verification-proofs/jm1130/hosted-preparation.json) sont désormais acquis selon le reçu utilisateur : sourceb9e2ad78/arbre dc893372, empreinte canonique **`08eb630927a84cc63c0b552fa9f729ab7ee2433f6c3fc8aca1466c007f021ecd`** recalculée identique, `CHECK1130_EXIT=0` et `PREPARATION_1130_CHECK_OK`.

- Checkout `/srv/customer/jessiemessage-operator/production-1130-b9e2ad78`, mode0700, dépendances1101 réutilisées etNode24.22.1 inchangé.
- Lanceur SHA256 `fb40a652f2400dfc4cc14d53fb8f3d9348dd95d703784e0b9a85c63f87666526`, CHECK SHA256 `97f15d145bb84f3e3a340d2a29fd43e5f0b64c9e6c0ea0e24a06d676b0ac2321`.
- Checkpoint1112/3f1ae16d et staging1120/692d5598 préservés selon le reçu ; aucune ancienne finalisation inventée.
- Les flags `precheckPassed:false` et journaux vides décrivent le staging **avant** le CHECK séparé réussi. Ils ne décrivent pas les journaux actuels et ne doivent pas être réécrits pour fabriquer une qualification.

**Ne rejouer ni préparation ni CHECK SSH1130.** Le bloc fourni est conservé dans l’[historique Git](https://github.com/fredbuhr/jessiemessage/blob/2ab91097a800d956eb2a1da56dc22801eaf3befd/docs/operations-release1130.md). Aucun démarrage1130, relevé direct du Manager ou du processus, inventaire SQL physique nouveau ou essai sur téléphone n’est déduit de ce résultat.

## Activation personnelle — à effectuer une fois

1. Ouvrir [Run/Build du service Node239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), nommé **recette.jessiemessage.com**, qui dessert aussi **jessiemessage.com** et la même base.
2. Renseigner les valeurs suivantes :

| Champ | Valeur1130 |
| --- | --- |
| Commande d’exécution — champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1130-b9e2ad78.sh` |
| Commande de build — champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1130-b9e2ad78.sh` |
| Port | `3000` |

3. Enregistrer. Si cela relance déjà l’application, attendre sans cliquer à nouveau sur Redémarrer. Sinon cliquer **Redémarrer** une seule fois dans le [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard).
4. Ouvrir [État du service](https://jessiemessage.com/admin/readiness) et transmettre **Version de l’application**, **Commit au démarrage**, **Version Node.js** et **Relevé au démarrage**. Attendus :1.13.0, `b9e2ad78b47dccb72b8e793cdc448e6b70424430`, `v24.22.1` et nouvelle date de démarrage.

L’enregistrement peut appeler le CHECK via la commande de build ; ce n’est pas une nouvelle commande SSH à exécuter manuellement. Ne répéter aucune activation si son résultat est incertain : examiner l’identité durable avant toute suite. Le writer final1130 sera défini et qualifié après le relevé réel, sans rejouer un ancien writer1120/1113.

Aucun nouveau test de sauvegarde, SMTP/Push réel, modification de compte, essai client ou chantier juridique n’est demandé.
