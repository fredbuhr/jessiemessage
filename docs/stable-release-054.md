# Étape 0.54 — source complète et déploiement reproductible

La version **0.54.0** réunit l'application complète et l'historique de la surveillance externe. Elle conserve les fonctionnalités déjà acceptées, le schéma 30 et les formats de sauvegarde existants. La version du paquet et celle indiquée par un futur coffre de configuration sont alignées ; aucun coffre historique n'est modifié ou à refaire.

## Réception des alertes acquise

Le 18 octobre à **15:54:05 Europe/Paris**, le propriétaire confirme la réception des deux courriels synthétiques incident/rétablissement à `contact@jessiemessage.com`. Le [reçu d'acceptation personnelle](activation-proofs/jm053-alerts-owner-confirmation.json) complète l'acceptation SMTP et conserve le précédent contrôle IMAPS sans résultat comme observation historique. Aucun nouvel envoi n'est nécessaire. Cette preuve porte sur les alertes locales du journal ; elle ne valide pas une notification GitHub de panne totale ni une copie externe.

## Consolidation sans réécriture

Avant cette étape, `main` pointait vers `a688b30ef4e039a30de7bf05e98761845dcee8d4` et ne contenait que la surveillance. La branche complète `feat/backup-email-alerts` pointait vers `08c90dc68ab0db43ef7c48951f34df786312438e` : 213 commits spécifiques, contre trois pour la surveillance. Les six fichiers de surveillance sont strictement identiques entre les deux têtes.

La branche `feat/stable-release-054` réunit les deux historiques avec deux parents, sans écrasement, rebase ou suppression d'ancienne branche. La PR de consolidation vise `main` et doit conserver cet historique par un commit de fusion. Syntaxe/build et les cinq jobs CI de la source exacte sont vérifiés avant intégration. La surveillance externe conserve ses deux URL, ses bornes et sa planification ; aucune configuration de notification GitHub n'est modifiée.

## Déploiement et repli

1. Installer la source validée dans un **nouveau checkout** et vérifier commit, arbre et propreté. Ne jamais utiliser la tête mouvante d'une branche comme preuve du code lancé.
2. Passer les tests natifs et le préflight existant `scripts/start-recurring-private-messaging.mjs check` avec ce checkout comme source du runtime. Le contrôle ne lance ni application ni capture.
3. Sauvegarder exclusivement en privé les anciennes commandes Run/Build du Manager ; préparer un lanceur 0700 épinglant le checkout, son commit et son arbre. Les répertoires privés, données, clés, sessions et horaire quotidien existants sont conservés.
4. Utiliser le cycle normal Build/redémarrage. Vérifier le profil complet, les deux origines, leurs ressources exactes, le journal de capture et la surveillance. Aucune migration ou restauration SQL pour cette consolidation.
5. Pour le repli, rétablir les anciennes commandes enregistrées et refaire le cycle normal Manager. Le superviseur `e1842a39` et le runtime `0a1cafd8` restent disponibles avec leurs dossiers et clés existants. Ne jamais restaurer SQL pour un simple retour de code.

## Références et activation observées

La source **`6cfce890827c835fdbda2488163b5c0f1695b2dc`**, arbre **`9308cb4dc736e7a869fa50796801ddc83a098d69`**, réunit les parents `08c90dc...` et `a688b30...`. Le repère `release/0.54.0` pointe vers ce commit. La [PR #69](https://github.com/fredbuhr/jessiemessage/pull/69) est fusionnée dans **main**, commit `12c16c6f0a63da3b20ba9af522447caf19f6fc5f`, avec le **même arbre**. Main contient désormais l'application complète ; les avertissements des relevés antérieurs sur son sous-ensemble de surveillance sont historiques. Les anciennes branches ne sont pas réécrites.

Les [cinq jobs CI candidats](https://github.com/fredbuhr/jessiemessage/actions/runs/39133998681) et ceux de [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39134356546) passent. La [vérification Windows candidate](https://github.com/fredbuhr/jessiemessage/actions/runs/39133998668) et celle de [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39134356534) passent aussi. La source compte **2 452 réussites générales / 27 wrappers SQL ignorés**, **383/383 par MariaDB**, **101/101 Chrome**, **1/1 authentification HTTPS** ; syntaxe de 431 fichiers et build réussis. Les **111/111 tests natifs** sur l'hébergement, incluant les coffres GPG synthétiques et la nouvelle métadonnée de version, passent sans saut. Le préflight unifié est `passed`, `started: false`, `backupStarted: false`.

Le checkout actif unique est `/srv/customer/jessiemessage-operator/release-054-6cfce890`. Le runtime et le superviseur utilisent cette même source. La configuration et les opérations restent dans leurs répertoires privés existants. Les anciens Run/Build sont sauvegardés exclusivement dans `/srv/customer/jessiemessage-private/manager-before-release-054.json`, mode 0600. Les sources de repli et leur lanceur sont contrôlés propres/épinglés ; aucun repli réel ou restauration SQL n'est provoqué pour l'exercice.

Run actuel :

```sh
bash /srv/customer/jessiemessage-private/start-primary-release-054-6cfce890.sh
```

Build actuel :

```sh
cd /srv/customer/jessiemessage-operator/release-054-6cfce890 && test "$(git rev-parse HEAD)" = 6cfce890827c835fdbda2488163b5c0f1695b2dc && test "$(git rev-parse HEAD^{tree})" = 9308cb4dc736e7a869fa50796801ddc83a098d69 && test -z "$(git status --porcelain)" && npm run check
```

Le lanceur est en mode 0700, 827 octets, SHA-256 `385e136964386e0d7b55581b7690e1afbc8490125c11f082cbc52880571d39d7`. Le cycle normal Build/redémarrage du Manager réussit, modification affichée **16:09 Europe/Paris**. Après le nouveau démarrage, deux contrôles à **14:10:01.303** et **14:11:01.348 UTC**, espacés de **60 045 ms**, sont `current / OK`, sans incident ou alerte en attente. À **14:10:31.318 UTC**, **38/38 lectures HTTPS et seize empreintes exactes** sont conformes sur les deux origines. Le journal garde quatre enregistrements et son succès du matin : aucune nouvelle capture de production induite.

Les fichiers du checkout, leur arbre, leur propreté et la version 0.54.0 sont relus à **14:12:42.640 UTC**. L'inspection directe des PID depuis SSH n'a trouvé aucun processus correspondant visible ; cette sonde supplémentaire n'est pas une preuve d'exécution. Le constat d'activation repose sur le Run épinglé du Manager, son Build/redémarrage réussi, le profil complet démarré et les contrôles HTTPS. Les parcours authentifiés en production ne sont pas répétés ; la CI synthétique et les acceptations personnelles antérieures gardent leur portée propre.

Voir les preuves de [préparation et CI](activation-proofs/jm054-preparation.json), d'[activation](activation-proofs/jm054-activation.json) et la [capture du Manager](activation-proofs/jm054-activation-20261018.jpg).

## Travaux d'exploitation encore ouverts

La consolidation ne clôture pas la copie récurrente hors hébergement, la copie/déchiffrement PC de la nouvelle archive 0.52, la cadence effective ou la réception des alertes de la sonde externe. Aucun nouveau prestataire, transfert de données privées ou secret n'est choisi par défaut. Les décisions de confidentialité/conservation et l'exécuteur d'effacement complet restent également ouverts. Les acceptations 0.46 demeurent acquises et ne sont pas redemandées.
