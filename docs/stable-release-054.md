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

Les SHA, commandes et constats d'intégration/activation seront ajoutés après observation. Les précédents checkouts actifs restent épinglés ; leur contenu n'est pas modifié par la préparation.

## Travaux d'exploitation encore ouverts

La consolidation ne clôture pas la copie récurrente hors hébergement, la copie/déchiffrement PC de la nouvelle archive 0.52, la cadence effective ou la réception des alertes de la sonde externe. Aucun nouveau prestataire, transfert de données privées ou secret n'est choisi par défaut. Les décisions de confidentialité/conservation et l'exécuteur d'effacement complet restent également ouverts. Les acceptations 0.46 demeurent acquises et ne sont pas redemandées.
