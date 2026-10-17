# Étape 0.51 — surveillance externe et bilan de production

Le [bilan courant](production-readiness-2026-10-17.md) distingue les travaux P0 d’exploitation des observations personnelles ciblées. Les fonctionnalités autour de Jessie sont déjà actives sur la révision 0.50 `0a1cafd8` ; le lot 0.51 ne nécessite aucun déploiement ni redémarrage applicatif.

## Implémentation

Le [guide autonome](../MONITORING.md) décrit la sonde, ses bornes et les commandes. `server/operations/external-probe.mjs` effectue deux GET anonymes fixes en parallèle. `scripts/check-private-service.mjs` réessaie les passages en échec jusqu’à trois fois avec dix secondes entre eux. Un passage sain arrête les reprises. Les rapports sont projetés dans un schéma fermé, sans erreur brute, URL paramétrable, cookie ou donnée de conversation.

Vingt-quatre tests natifs vérifient les deux états HTTP/disponibilité, les erreurs réseau/TLS, les redirections, cache/cookie, taille et UTF-8, les délais sur fetch et corps, nettoyage tardif, horloge, projection hostile, reprises et codes CLI. La relecture indépendante a relevé un risque de fluctuation des tests sains sous forte concurrence ; leur délai de fixture est passé de 50 ms à cinq secondes, les tests de délai gardant explicitement dix millisecondes.

`.github/workflows/service-monitor.yml` exécute seulement ces tests synthétiques sur une PR. Sur `main`, un second job effectue les lectures réelles après un changement des fichiers surveillés, manuellement ou selon `2-59/5 * * * *`. Il n’a que `contents: read`, n’installe aucune dépendance applicative et ne persiste pas les identifiants du checkout.

## Mise en service distincte de l’application

Au début du lot, `main` contient seulement `.gitignore` et `README.md`, SHA `3e4e0381be2e7aff2b8ee54882a0f86cf4d0a4ec`. Les tâches planifiées GitHub doivent exister sur la branche par défaut. Un sous-ensemble autonome est donc présenté dans la [PR #63](https://github.com/fredbuhr/jessiemessage/pull/63), puis intégré après ses tests. La branche complète du projet reçoit les mêmes fichiers et le bilan détaillé. La pile des fonctionnalités n’est pas fusionnée implicitement, et l’hébergement garde sa révision épinglée.

État de mise en service et exécution réelle : en cours de vérification ; les SHA et liens des exécutions seront ajoutés après lecture des résultats. Aucun résultat vert distant n’est déduit des tests locaux.

## Portée restante

Un succès montre la disponibilité des deux signaux publics à l’instant contrôlé. `/api/ready` résume l’état interne base/traitements ; il ne certifie ni les sauvegardes, ni une livraison effective e-mail/Push, ni tous les retards de file. Une erreur transitoire entre deux sondes peut être manquée. Les jobs planifiés sont soumis aux délais/omissions et à la désactivation après inactivité de GitHub : aucun délai maximal de détection n’est garanti.

Les notifications natives dépendent des préférences et abonnements déjà définis. Aucune préférence n’est changée et aucun message de test réel n’est envoyé. **Le canal, la réception effective d’une alerte de panne puis de rétablissement et la surveillance de l’absence du moniteur restent dans 0.53.** Aucun arrêt artificiel de production n’est nécessaire pour éprouver ces chemins.

Le planificateur Infomaniak est consulté pendant ce lot : « Vous n’avez aucune tâche planifiée ». Ce relevé établit l’absence de tâche à cet endroit, pas l’absence de toute sauvegarde fournisseur. Il ne remplace pas les reçus acceptés 0.46 et ne démontre aucune sauvegarde applicative récurrente.
