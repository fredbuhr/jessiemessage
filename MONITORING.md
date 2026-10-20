# Surveillance de JessieMessage

**État au 21 octobre 2026 Europe/Paris : service 1.2.0 actif, identité confirmée par relevé admin utilisateur ; quatre GET publics conformes au dernier contrôle.** Le parent conserve la capture quotidienne, le moniteur local et ses alertes par courriel. La sonde GitHub reste indépendante de l’hébergement. Les preuves ci-dessous restent datées ; elles ne constituent pas une nouvelle vérification des copies PC ou du moniteur local. Les pins et le checkpoint restant à aligner sont dans [REPRISE](docs/REPRISE.md).

## Sonde externe : disponibilité du site

Le workflow `Private service monitor` utilise Node 24 et ses modules natifs, sans dépendance applicative ni secret. Il effectue deux lectures HTTPS anonymes fixes : `https://jessiemessage.com/api/health` et `https://jessiemessage.com/api/ready`. Les redirections sont refusées, le certificat est vérifié, chaque requête et son corps sont bornés à cinq secondes et 1 024 octets. HTTP 200 seul ne suffit pas : le JSON attendu, `no-store` et l'absence de cookie sont contrôlés.

```sh
node --test tests/external-probe.test.mjs tests/external-probe-cli.test.mjs
node scripts/check-private-service.mjs
```

La seconde commande effectue un passage, puis jusqu'à deux nouvelles tentatives espacées de dix secondes en cas d'échec. Elle s'arrête au premier passage sain. Trois passages en échec donnent `confirmedFailure: true` et la sortie 1 ; une erreur interne ou d'usage donne un code fixe et la sortie 2. `--once` limite l'exécution à un passage, sans confirmer une panne persistante. Le CLI complet est borné à 45 secondes. Le rapport ne conserve aucun corps de réponse ni erreur brute.

Les PR exécutent seulement les tests synthétiques. Sur `main`, le workflow réalise les sondes après un changement des fichiers surveillés, à la demande et selon le cron `2-59/5 * * * *` : minutes UTC 02, 07, 12…57. La planification GitHub peut être retardée ou omise : **aucun délai maximal de détection ni contrôle de l'absence du moniteur n'est garanti**.

Les échecs sont visibles dans Actions. Les notifications natives GitHub dépendent des préférences et abonnements existants du destinataire. **Le canal externe et la réception effective d'une alerte de panne puis de rétablissement ne sont pas vérifiés.** La preuve de réception des mails de sauvegarde ci-dessous ne couvre pas une panne complète de l'hébergement.

**Observation du 20 octobre :** les douze dernières exécutions planifiées relevées sont réussies. Le [passage 39339574058](https://github.com/fredbuhr/jessiemessage/actions/runs/39339574058) contrôle réellement les deux sondes le **19 octobre à 23:07:44.330 UTC**, soit **20 octobre 01:07:44.330 Europe/Paris** : sain au premier passage, 759 ms. Entre ces douze lancements, les intervalles observés vont de **1 h 54 min 18 s** à **7 h 12 min 12 s**. Le cron de cinq minutes n'est donc pas un délai de détection constaté. Le canal de notification externe reste non vérifié ; aucun nouveau mail ni arrêt du site n'a été provoqué. [Relevé borné](docs/verification-proofs/jm079-monitor-observation.json).

## Moniteur local : fraîcheur de la capture

Le parent lit le journal au démarrage puis avec un espacement cible de **60 secondes après chaque lecture**. Une lecture est bornée à **15 secondes** ; trois observations en échec confirment un incident. Le premier contrôle sain après l'incident produit un rétablissement. Une capture en cours ne clôture pas un incident existant.

Une capture réussie devient ancienne à **26 heures** ; une capture encore en cours après **10 minutes** est signalée bloquée. Ces seuils décrivent le journal, sans prouver l'intégrité actuelle d'une archive, sa copie ou son déchiffrement. Les champs du moniteur restent donc `copyStatus: not_checked`, `decryptionStatus: not_checked` et `notificationStatus: not_sent`.

La file d'alertes distincte transmet les incidents/rétablissements à **contact@jessiemessage.com**. `smtp_accepted` signifie une acceptation SMTP. Ses reprises attendent au minimum 1, 2, 4, 8 puis 15 minutes après les échecs, sans garantie de réception dans ce délai. Le détail et les limites sont dans [Alertes de sauvegarde](docs/backup-email-alerts-053.md). Si le parent ou l'hébergement entier s'arrête, ce mécanisme local ne peut plus envoyer d'alerte.

## Preuves datées à conserver

- **17 octobre, 23:40:45.234 UTC :** premier passage externe sain, deux contrôles, 1 127 ms, run `39079931320` déclenché par `push` ([reçu](docs/activation-proofs/jm051-external-monitor.json)).
- **18 octobre :** les runs `schedule` `39086832046` à **01:31:54 UTC**, `39104289229` à **06:30:38 UTC** et `39123886814` à **11:35:58 UTC** sont réussis. Leurs écarts de plusieurs heures ne prouvent pas une cadence de cinq minutes ([relevé externe 0.51](docs/external-monitoring-051.md)).
- **18 octobre :** intervalles locaux observés de **60 008 ms**, puis **60 031 ms**, `current / OK` ([moniteur](docs/activation-proofs/jm053-periodic-activation.json), [alertes](docs/activation-proofs/jm053-alerts-activation.json)). Ces échantillons ne garantissent pas toutes les lectures futures.
- **18 octobre, 15:54:05 Europe/Paris :** le propriétaire confirme les deux mails synthétiques incident/rétablissement reçus à `contact@jessiemessage.com` ([confirmation](docs/activation-proofs/jm053-alerts-owner-confirmation.json)). Aucun renvoi nécessaire ; ce reçu garde `externalOutageNotificationVerified:false`.
- **19 octobre, 21:39:01.988174 UTC :** service **0.76.0**, moniteur `current / OK`, santé/disponibilité HTTPS 200 sur les deux origines ; moniteur et alertes conservés ([preuve S1](docs/verification-proofs/jm076-verification.json)).
- **19 octobre, 23:45:34.085672 UTC (20 octobre 01:45 Europe/Paris) :** service **0.79.0**, vrai enfant/superviseur démarrés, moniteur **OK**, quatre contrôles HTTPS santé/disponibilité réussis sur les deux origines ; dix fichiers sensibles préservés. Aucun test de mail ni nouvel appariement ([preuves 0.79](docs/verification-proofs/jm079-verification.json)).
- **19 octobre :** copie PC courante et déchiffrement personnel acquis, résultat `DECHIFFREMENT_VERIFIE` reçu à **16:34:19 UTC** ([preuve PC](docs/verification-proofs/jm0702-verification.json)). Aucun nouvel appariement ou test personnel à refaire pour vérifier la surveillance.

Les activations 0.51–0.56 sont historiques ; elles ne donnent pas les commandes du service courant. Les derniers runs, leur cadence observée et les préférences du canal externe peuvent être relevés en lecture seule, sans créer un autre moniteur, modifier les notifications ou envoyer un mail de test.

## Portée

La sonde externe observe HTTP et le résumé interne base/traitements. Elle ne certifie ni sauvegarde, espace disque, copie PC, déchiffrement, livraison SMTP/Push, ni tous les retards de file. Une erreur transitoire entre deux sondes peut être manquée. Le moniteur local complète ce contrôle sans lui apporter une garantie de détection d'une panne totale.

Sources du mécanisme : [workflow](.github/workflows/service-monitor.yml), [sonde](server/operations/external-probe.mjs), [CLI](scripts/check-private-service.mjs), [moniteur local](server/backup/periodic-monitor.mjs), [seuils de fraîcheur](server/backup/freshness.mjs). Références GitHub du guide initial : [planification](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) et [notifications d'exécution](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).
