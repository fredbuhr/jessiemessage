# Surveillance externe de JessieMessage — 0.51

Le workflow `Private service monitor` fonctionne avec Node 24 et ses modules natifs, sans dépendance applicative ni secret. Il observe le service hébergé 0.54.0, source épinglée `6cfce890`, et conserve son fonctionnement indépendant. Depuis la consolidation [0.54](docs/stable-release-054.md), main contient aussi l'application complète ; la sonde n'a pas besoin de démarrer cette application sur GitHub.

Deux lectures HTTPS anonymes fixes contrôlent `https://jessiemessage.com/api/health` et `https://jessiemessage.com/api/ready`. Les redirections sont refusées, le certificat est vérifié normalement, chaque requête et son corps sont bornés à cinq secondes et 1 024 octets. HTTP 200 seul ne suffit pas : le JSON attendu, `no-store` et l’absence de cookie sont contrôlés. Aucun accès authentifié, message, envoi de campagne, e-mail ou opération SQL directe.

```sh
node --test tests/external-probe.test.mjs tests/external-probe-cli.test.mjs
node scripts/check-private-service.mjs
```

La seconde commande effectue un passage, puis jusqu’à deux nouvelles tentatives espacées de dix secondes si nécessaire. Elle s’arrête au premier rétablissement. Trois passages en échec donnent `confirmedFailure: true` et le code de sortie 1. `--once` fait un passage et ne prétend pas confirmer une panne persistante. Une erreur interne ou d’usage produit uniquement un code fixe et la sortie 2. Le rapport JSON contient des horodatages, durées et codes fixes ; aucun corps de réponse ni erreur brute n’est conservé.

Les PR exécutent seulement les tests synthétiques. Après intégration dans la branche par défaut `main`, le workflow exécute réellement les sondes après un changement des fichiers surveillés, à la demande et aux minutes UTC 02, 07, 12…57 de chaque heure. La planification GitHub peut être retardée ou omise ; les workflows planifiés des dépôts publics peuvent être désactivés après 60 jours sans activité. Ce contrôle ne garantit donc pas une détection en cinq minutes ni la surveillance de sa propre absence d’exécution.

Les échecs sont visibles dans Actions. Les notifications natives GitHub dépendent des préférences et de l’abonnement existants du destinataire ; aucune préférence n’est changée ici. La réception d’une alerte de panne puis d’un rétablissement reste à éprouver avec le canal retenu. Aucun test de panne réelle n’est provoqué en production.

Ce contrôle observe le signal public HTTP et le résumé de disponibilité interne (base et traitements). Il ne certifie pas une sauvegarde, la capacité disque, le déchiffrement, une livraison SMTP/Push effective ou tous les retards de file. Les erreurs transitoires entre deux sondes peuvent lui échapper.

Sources : [événements et limites de planification GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) et [notifications d’exécution](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).
