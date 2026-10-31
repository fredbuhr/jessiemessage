# Livraison 1.13.0 — terminée

État du31octobre2026. [REPRISE](REPRISE.md) reste la référence courante ; ce guide distingue la publication de l'installation sur le service Node239143. `recette.jessiemessage.com` et `jessiemessage.com` partagent ce service et sa base.

## Résultat acquis

- [PR144](https://github.com/fredbuhr/jessiemessage/pull/144) fusionnée ; source/tag **`b9e2ad78b47dccb72b8e793cdc448e6b70424430`**, arbre **`dc8933723a54c0307a3fd52719bdd4fd3ac3f96a`**. `main` documentaire peut avancer ensuite, sans déplacement du tag.
- Qualifications finales [PR41221505431](verification-proofs/jm1130/pr-native.json) et [main41222320731](verification-proofs/jm1130/main-native.json), tentative1,5/5 chacune. Général4170réussis/52omissions sur4222 ; Chrome292/292, HTTPS14/14, MariaDB613/613 chacune. Douze captures finales inspectées, arbre complet identique sur main. [Bilan et limites](conversation-lists-1130.md).
- [Publication41223112832](verification-proofs/jm1130/publication-native.json), tentative1,2/2 ; neuf tests natifs de l'opérateur sans omission. Opérateur `01c448fb65432366acb8b07a5df2743053a5611e`, arbre `728079800a5d44ed8c729f647daca75ced4a0c5a`. Scripts et workflow relus aux octets qualifiés. [Tag/release/latestv1.13.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.13.0), release430071184, concordants.
- Nodev24.22.1,38migrations/37tables attendues, dépendances inchangées. Aucun inventaire physique de production nouveau déduit de la CI.

**Préparation, CHECK, activation et enregistrement final1130 acquis selon les reçus utilisateur.** L’[identité active rapportée](verification-proofs/jm1130/hosted-identity.json) est1.13.0/sourceb9e2ad78/Node24.22.1, démarrée le31octobre19:13:58Europe/Paris, signal disponible déclaré. Aucune étape acquise à répéter.

## Inspection en lecture seule — acquise

Le [reçu transmis par l’utilisateur](verification-proofs/jm1130/hosted-checkpoint-inspection.json) retrouve le checkpoint privé **1.11.2**, source `af352607ff7e12c41185f42b8232c72219a304cd`, arbre `655f759079979d608b0ec1c62a7c892311899515`, SHA256 **`3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f`**, `release1120Present:false`.

Avant la préparation1130, l’enregistrement final1120 n’était pas présent dans le fichier relu. Le nouveau checkpoint1130 conserve cet ancien état sans fabriquer la section manquante. Le démarrage1120 reste confirmé séparément ; l’inspection ne décrit ni le processus, ni le Manager, ni la disponibilité HTTP. Elle ne permet pas de conclure au déroulement de l’ancienne commande. Ne rejouer aucun writer1120/1113 et ne pas refaire cette lecture sans élément nouveau. Le [bloc de lecture qualifié sur sept cas synthétiques](verification-proofs/jm1130/checkpoint-inspection-command.json) et son historique sont préservés dans Git.

## Préparation et CHECK 1.13.0 — acquis, ne pas rejouer

Le nouvel opérateur est qualifié : [run41226621742](verification-proofs/jm1130/preparation-native.json), tentative1, **1/1 job et33/33 tests natifs sans omission** sousNodev24.22.1. Source **`7f2051b75c24bf6ec947349205070e62fbeb8aa0`**, arbre **`b1499dab714e606f7741e93abc4d1e96a83a89a1`**. Préparateur SHA256 **`0be0e7c51836a9c0576e785fc56373b1b60ea98564a473fd628fadda09e52980`**,19215octets, relu au commit qualifié. Les essais natifs restent acquis et ne sont pas à relancer.

La [préparation/CHECK hébergés](verification-proofs/jm1130/hosted-preparation.json) sont désormais acquis selon le reçu utilisateur : sourceb9e2ad78/arbre dc893372, empreinte canonique **`08eb630927a84cc63c0b552fa9f729ab7ee2433f6c3fc8aca1466c007f021ecd`** recalculée identique, `CHECK1130_EXIT=0` et `PREPARATION_1130_CHECK_OK`.

- Checkout `/srv/customer/jessiemessage-operator/production-1130-b9e2ad78`, mode0700, dépendances1101 réutilisées etNode24.22.1 inchangé.
- Lanceur SHA256 `fb40a652f2400dfc4cc14d53fb8f3d9348dd95d703784e0b9a85c63f87666526`, CHECK SHA256 `97f15d145bb84f3e3a340d2a29fd43e5f0b64c9e6c0ea0e24a06d676b0ac2321`.
- Checkpoint1112/3f1ae16d et staging1120/692d5598 préservés selon le reçu ; aucune ancienne finalisation inventée.
- Les flags `precheckPassed:false` et journaux vides décrivent le staging **avant** le CHECK séparé réussi. Ils ne décrivent pas les journaux actuels et ne doivent pas être réécrits pour fabriquer une qualification.

**Ne rejouer ni préparation ni CHECK SSH1130.** Le bloc fourni est conservé dans l’[historique Git](https://github.com/fredbuhr/jessiemessage/blob/2ab91097a800d956eb2a1da56dc22801eaf3befd/docs/operations-release1130.md). Aucun démarrage1130, relevé direct du Manager ou du processus, inventaire SQL physique nouveau ou essai sur téléphone n’est déduit de ce résultat.

## Activation personnelle — acquise, ne pas rejouer

Le [relevé utilisateur](verification-proofs/jm1130/hosted-identity.json) confirme1.13.0, commit `b9e2ad78b47dccb72b8e793cdc448e6b70424430`, Nodev24.22.1, démarrage **31/10/2026 19:13:58 Europe/Paris**, secondeUTC1793470438, signal disponible. Aucun nouveau redémarrage demandé. Les valeurs suivantes documentent l’activation déjà effectuée, pas une nouvelle instruction Manager :

| Champ | Valeur1130 acquise selon le relevé |
| --- | --- |
| Commande d’exécution — champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1130-b9e2ad78.sh` |
| Commande de build — champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1130-b9e2ad78.sh` |
| Port | `3000` |

Service Node239143, nommé `recette.jessiemessage.com`, desservant aussi le principal avec la même base. L’agent n’a inspecté ni les champs Manager ni le processus. L’UI ne fournit pas les millisecondes ni une vérification indépendante du HTTP public.

## Enregistrement final — acquis, ne pas rejouer

Le writer1130 est [qualifié27/27 natifs](verification-proofs/jm1130/writer-final-native.json), [run41229293876](https://github.com/fredbuhr/jessiemessage/actions/runs/41229293876),1/1 job, tentative1, sans omission sousNodev24.22.1. Opérateur **`13848dce9ec0d15969bb2cf33675de00dfc2abc7`**, arbre **`9c332fedc2358c834d3fe7364b41a05b0421ece1`**. Script SHA256 **`49bb739b62564b559cde7c67b4f1c8140d6c75adbce7aece7ef0bd7dbf686c8a`**,30728octets, relu identique aux octets qualifiés. La commande fournie est préservée dans l’[historique Git](https://github.com/fredbuhr/jessiemessage/blob/6dcc8de7b4582a66e01741c9e54141152da04da0/docs/operations-release1130.md) ; ne pas la rejouer.

**Exécution acquise selon le [reçu final utilisateur](verification-proofs/jm1130/hosted-metadata.json)** : `release1130_metadata_recorded`, version1.13.0/sourceb9e2ad78/arbre dc893372/Nodev24.22.1, `publicReady:true`, SQL38/37tables attendues. Le journal fournit **1793470438163ms**, soit **31/10/2026 19:13:58.163 Europe/Paris**, concordant avec l’UI à la seconde. Checkpoint1130 SHA256 **`cdcb3f8b35208ddfaff19009235f86d4dd23a10ac13b00c9c692daad2bbe496d`**.

Le writer a vérifié les sources/tags/versions, dépendances et migrations inchangées, reçus/lanceurs/Node/configuration épinglés, précontrôles, unique démarrage et GET publics avant l’écriture atomique des seules métadonnées. État antérieur1112, historiques1112/1111/1110/1101/1100/190/184, autres blocs et reçus1120/1113 préservés selon le reçu ; aucune section finale1120/1113 absente inventée. Aucun SQL, nouveau démarrage, Manager, mail ou compte réel modifié. Le repli185 reste qualifiéSQL38 seulement et jamais démarré ; snapshot publicformat2 non qualifié au downgrade,184/172 interdits.

**Aucune opération de livraison restante.** Ne rejouer ni préparation, CHECK, activation, writer ou CI verte. Les GET publics ne prouvent pas le commit du processus ; PID/socket/binaire exécuté et appareils physiques restent non qualifiés. Aucun nouvel inventaire SQL physique de production déduit de cet outil de métadonnées. Aucun nouveau test de sauvegarde, SMTP/Push réel, modification de compte, essai client ou chantier juridique n’est demandé.
