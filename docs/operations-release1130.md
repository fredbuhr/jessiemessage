# Livraison 1.13.0 — publication acquise, hébergement non préparé

État du31octobre2026. [REPRISE](REPRISE.md) reste la référence courante ; ce guide distingue la publication de l'installation sur le service Node239143. `recette.jessiemessage.com` et `jessiemessage.com` partagent ce service et sa base.

## Résultat acquis

- [PR144](https://github.com/fredbuhr/jessiemessage/pull/144) fusionnée ; source/tag **`b9e2ad78b47dccb72b8e793cdc448e6b70424430`**, arbre **`dc8933723a54c0307a3fd52719bdd4fd3ac3f96a`**. `main` documentaire peut avancer ensuite, sans déplacement du tag.
- Qualifications finales [PR41221505431](verification-proofs/jm1130/pr-native.json) et [main41222320731](verification-proofs/jm1130/main-native.json), tentative1,5/5 chacune. Général4170réussis/52omissions sur4222 ; Chrome292/292, HTTPS14/14, MariaDB613/613 chacune. Douze captures finales inspectées, arbre complet identique sur main. [Bilan et limites](conversation-lists-1130.md).
- [Publication41223112832](verification-proofs/jm1130/publication-native.json), tentative1,2/2 ; neuf tests natifs de l'opérateur sans omission. Opérateur `01c448fb65432366acb8b07a5df2743053a5611e`, arbre `728079800a5d44ed8c729f647daca75ced4a0c5a`. Scripts et workflow relus aux octets qualifiés. [Tag/release/latestv1.13.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.13.0), release430071184, concordants.
- Nodev24.22.1,38migrations/37tables attendues, dépendances inchangées. Aucun inventaire physique de production nouveau déduit de la CI.

**Aucune préparation1130, aucun CHECK, changement Manager, redémarrage ou writer n'a eu lieu.** La dernière identité active rapportée reste1.12.0/source9bfdae07, arbre4aef91b8, démarrée le31octobre02:29:16Europe/Paris. Sa préparation/CHECK et son démarrage sont acquis et ne sont pas à répéter.

## Inspection en lecture seule — acquise

Le [reçu transmis par l’utilisateur](verification-proofs/jm1130/hosted-checkpoint-inspection.json) retrouve le checkpoint privé **1.11.2**, source `af352607ff7e12c41185f42b8232c72219a304cd`, arbre `655f759079979d608b0ec1c62a7c892311899515`, SHA256 **`3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f`**, `release1120Present:false`.

L’enregistrement final1120 n’est pas présent dans le fichier relu. Le démarrage1120 reste confirmé séparément ; l’inspection ne décrit ni le processus, ni le Manager, ni la disponibilité HTTP. Elle ne permet pas de conclure au déroulement de l’ancienne commande. Ne rejouer aucun writer1120/1113 et ne pas refaire cette lecture sans élément nouveau. Le [bloc de lecture qualifié sur sept cas synthétiques](verification-proofs/jm1130/checkpoint-inspection-command.json) et son historique sont préservés dans Git.

## Préparation 1.13.0 — opérateur en développement

Branche `ops/prepare-v1.13.0`, base documentaire `b9fb83461e25c32daccdb64c859bcb22ba00bca1`. Le nouvel opérateur doit préparer uniquement le checkout exact1130 et ses nouveaux lanceurs/logs, réutiliser Node24.22.1 et les dépendances inchangées, préserver le checkout/lanceurs/staging1120 ainsi que le checkpoint1112 exact. Il doit refuser toute sortie préexistante ou partielle sans nettoyage ni relance automatique. Aucun SQL, migration, écriture de configuration, CHECK, lancement du runtime ou modification Manager.

Les instructions de préparation seront fournies après revue et qualification native de l’opérateur exact. Aucune commande hébergée1130 n’a encore été fournie ou exécutée. Le service Node239143, nommé `recette.jessiemessage.com`, dessert aussi le principal : il ne s’agit pas d’une cible isolée.

Accès personnel : [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Aucun nouveau test de sauvegarde, téléphone réel, SMTP/Push réel ou chantier juridique n’est ouvert automatiquement.
