# Étape 0.51 — surveillance externe et bilan de production

**Mise à jour du 18 octobre en journée :** les événements `schedule` 39086832046 (01:31:54 UTC), 39104289229 (06:30:38 UTC) et 39123886814 (11:35:58 UTC) sont observés terminés en succès. Ils sont espacés de plusieurs heures : aucune cadence maximale de cinq minutes n’est garantie. La [surveillance locale minute 0.53](periodic-backup-monitor-053.md) complète ces sondes, sans remplacer leur indépendance ni prouver la réception d’alertes. Les paragraphes datés ci-dessous conservent l’historique initial.

Le [bilan courant](production-readiness-2026-10-17.md) distingue les travaux P0 d’exploitation des observations personnelles ciblées. Les fonctionnalités autour de Jessie sont déjà actives sur la révision 0.50 `0a1cafd8` ; le lot 0.51 ne nécessite aucun déploiement ni redémarrage applicatif.

## Implémentation

Le [guide autonome](../MONITORING.md) décrit la sonde, ses bornes et les commandes. `server/operations/external-probe.mjs` effectue deux GET anonymes fixes en parallèle. `scripts/check-private-service.mjs` réessaie les passages en échec jusqu’à trois fois avec dix secondes entre eux. Un passage sain arrête les reprises. Les rapports sont projetés dans un schéma fermé, sans erreur brute, URL paramétrable, cookie ou donnée de conversation.

Vingt-quatre tests natifs vérifient les deux états HTTP/disponibilité, les erreurs réseau/TLS, les redirections, cache/cookie, taille et UTF-8, les délais sur fetch et corps, nettoyage tardif, horloge, projection hostile, reprises et codes CLI. La relecture indépendante a relevé un risque de fluctuation des tests sains sous forte concurrence ; leur délai de fixture est passé de 50 ms à cinq secondes, les tests de délai gardant explicitement dix millisecondes.

`.github/workflows/service-monitor.yml` exécute seulement ces tests synthétiques sur une PR. Sur `main`, un second job effectue les lectures réelles après un changement des fichiers surveillés, manuellement ou selon `2-59/5 * * * *`. Il n’a que `contents: read`, n’installe aucune dépendance applicative et ne persiste pas les identifiants du checkout.

## Mise en service distincte de l’application

Au début du lot, `main` contient seulement `.gitignore` et `README.md`, SHA `3e4e0381be2e7aff2b8ee54882a0f86cf4d0a4ec`. Les tâches planifiées GitHub doivent exister sur la branche par défaut. Un sous-ensemble autonome est donc présenté dans la [PR #63](https://github.com/fredbuhr/jessiemessage/pull/63), puis intégré après ses tests. La branche complète du projet reçoit les mêmes fichiers et le bilan détaillé. La pile des fonctionnalités n’est pas fusionnée implicitement, et l’hébergement garde sa révision épinglée.

La PR #63 est fusionnée après **24/24 tests distants**, source `c74436079092f41c5f90f160a103f9c692f0f39a` ([run PR 39079864575](https://github.com/fredbuhr/jessiemessage/actions/runs/39079864575)). Le job réel y est bien ignoré. La branche par défaut `main` pointe ensuite sur `a688b30ef4e039a30de7bf05e98761845dcee8d4`, arbre `d955f495b931ac8adb0869e25b1aec2d8ec133f2`.

Le [run principal 39079931320](https://github.com/fredbuhr/jessiemessage/actions/runs/39079931320), événement **push**, termine en succès le 17 octobre 2026 à 23:40:49 UTC (18 octobre 01:40:49 Europe/Paris). Les tests sont verts et le job **Anonymous HTTPS and readiness** (`117534645560`) exécute réellement le CLI depuis un runner GitHub. Contrôle à **01:40:45.234 Europe/Paris** : `healthy`, premier passage, deux contrôles `pass/ok`, durée 1 127 ms. Le [reçu fermé](activation-proofs/jm051-external-monitor.json) conserve les références et le rapport sans journal brut.

La configuration de planification est présente sur `main`. Ce passage réussi est déclenché par la fusion, **pas encore une preuve d’événement `schedule`** ; une première exécution planifiée observée sera consignée séparément. La régularité durable ne peut pas être certifiée à partir d’un seul passage. La source complète `19b1d9a59305704a749696ea7a9c70994d4b688b`, [PR #64](https://github.com/fredbuhr/jessiemessage/pull/64), reçoit les mêmes fichiers ; ses **cinq jobs CI applicatifs passent** dans le [run 39079905378](https://github.com/fredbuhr/jessiemessage/actions/runs/39079905378) : 2 292 réussites / 27 wrappers SQL ignorés / zéro échec sur 2 319 cas généraux, 383/383 sur chaque MariaDB 10.11 et 11.4, 101/101 Chrome, 1/1 authentification HTTPS ; syntaxe, build et aperçu conformes. La dernière mise à jour documentaire conserve ces mêmes fichiers de code et ces preuves, sans nouveau déploiement. L’application active reste `0a1cafd8`, sans redémarrage.

## Portée restante

Un succès montre la disponibilité des deux signaux publics à l’instant contrôlé. `/api/ready` résume l’état interne base/traitements ; il ne certifie ni les sauvegardes, ni une livraison effective e-mail/Push, ni tous les retards de file. Une erreur transitoire entre deux sondes peut être manquée. Les jobs planifiés sont soumis aux délais/omissions et à la désactivation après inactivité de GitHub : aucun délai maximal de détection n’est garanti.

Les notifications natives dépendent des préférences et abonnements déjà définis. Aucune préférence n’est changée et aucun message de test réel n’est envoyé. **Le canal, la réception effective d’une alerte de panne puis de rétablissement et la surveillance de l’absence du moniteur restent dans 0.53.** Aucun arrêt artificiel de production n’est nécessaire pour éprouver ces chemins.

Le planificateur Infomaniak est consulté pendant ce lot : « Vous n’avez aucune tâche planifiée ». Ce relevé établit l’absence de tâche à cet endroit, pas l’absence de toute sauvegarde fournisseur. Il ne remplace pas les reçus acceptés 0.46 et ne démontre aucune sauvegarde applicative récurrente.
