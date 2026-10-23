# Surveillance de JessieMessage

**État documentaire du 23 octobre 2026 : application, checkpoint privé et latest alignés en1.10.0 / Node v24.22.1 selon le [reçu final USER_REPORTED](docs/verification-proofs/jm1100-hosted-metadata.json)**, `release1100_metadata_recorded`, source `51b0cf22e3adbad7ed26653e96706ba707aaf839`. L’[identité UI](docs/verification-proofs/jm1100-hosted-identity.json) conserve le démarrage affiché `23/10/2026 19:43:39` ; **SQL38 reste inchangé**. L’écriture finale est limitée aux métadonnées, sans redémarrage. **Livraison close : aucune préparation, CHECK, activation ou exécution du writer n’est à rejouer.** Le repli compatible **1.8.5** est préservé, précontrôlé et jamais démarré. [REPRISE](docs/REPRISE.md) conserve l’état de référence ; le reçu ne constitue ni un nouvel inventaire SQL ni une recette complète des parcours hébergés. Depuis 1.8.0, la sauvegarde est déclenchée à la demande dans l’administration. La capture quotidienne, son moniteur de fraîcheur et ses alertes automatiques appartiennent au mécanisme historique conservé ; ils ne constituent plus le parcours courant. Le test de création, fin et téléchargement d’une sauvegarde hébergée reste **non vérifié et reporté à la demande de l’utilisateur**. Aucun essai, diagnostic fournisseur ou rappel n’est lancé par cette mise à jour.

## Sonde externe existante : disponibilité du site

Le workflow [Private service monitor](.github/workflows/service-monitor.yml) utilise le Node épinglé et ses modules natifs, sans dépendance applicative ni secret. Il effectue deux lectures HTTPS anonymes fixes : `https://jessiemessage.com/api/health` et `https://jessiemessage.com/api/ready`. Les redirections sont refusées, le certificat est vérifié, chaque requête et son corps sont bornés à cinq secondes et 1 024 octets. HTTP 200 seul ne suffit pas : JSON attendu, `no-store` et absence de cookie sont contrôlés.

Les [tests synthétiques de la sonde](tests/external-probe.test.mjs) et de son [CLI](tests/external-probe-cli.test.mjs) ne touchent pas l’hébergement. Les PR ne réalisent que ces tests. Le workflow courant sur `main` exécute les tests lors d’un changement surveillé ou d’un lancement manuel, puis la sonde s’ils réussissent. Lors d’un lancement planifié, le job de tests est omis et la sonde existante reste seule exécutée. Le lancement manuel ne constitue pas une demande de test de sauvegarde.

Le CLI [check-private-service.mjs](scripts/check-private-service.mjs) effectue un passage, puis jusqu’à deux nouvelles tentatives espacées de dix secondes en cas d’échec. Il s’arrête au premier passage sain. Trois passages en échec donnent `confirmedFailure: true` et la sortie 1 ; une erreur interne ou d’usage donne un code fixe et la sortie 2. `--once` limite à un passage, sans confirmer une panne persistante. Le CLI complet est borné à 45 secondes. Le rapport ne conserve aucun corps de réponse ni erreur brute.

La planification existante est `2-59/5 * * * *` : minutes UTC 02, 07, 12…57. GitHub peut retarder ou omettre un lancement : **aucun délai maximal de détection ni contrôle de l’absence du moniteur n’est garanti**. Les échecs restent visibles dans Actions ; les notifications natives dépendent des préférences et abonnements existants. **La réception effective d’une alerte externe de panne puis de rétablissement reste non vérifiée.** Les anciens mails du moniteur local ne couvrent pas une panne complète de l’hébergement.

L’[observation du 20 octobre](docs/verification-proofs/jm079-monitor-observation.json) conserve douze exécutions planifiées réussies, avec des intervalles de **1 h 54 min 18 s à 7 h 12 min 12 s**. Le [run 39339574058](https://github.com/fredbuhr/jessiemessage/actions/runs/39339574058) a contrôlé les deux endpoints le **19 octobre à 23:07:44.330 UTC**, soit le **20 octobre à 01:07:44.330 Europe/Paris** : sain au premier passage, 759 ms. Ce relevé ancien ne mesure pas la disponibilité ou la cadence actuelle ; aucun nouveau passage ni mail n’a été provoqué pour ce guide.

## Portée actuelle

La sonde observe HTTP et le résumé interne base/traitements. Elle ne certifie ni sauvegarde, espace disque, copie PC, déchiffrement, livraison SMTP/Push, parcours navigateur, ni tous les retards de file. Une erreur transitoire entre deux sondes peut être manquée. Elle n’ajoute aucune garantie de restauration ou de perte maximale de données.

## Historique du mécanisme automatique — ne pas réactiver

Les seuils, états et confirmations ci-dessous décrivent leurs jalons d’origine. Ils restent utiles pour lire les preuves et formats existants ; ils ne sont ni des commandes courantes ni des recettes à reprendre. Le chantier de copies automatiques PC et l’archivage automatique sont abandonnés. Les clés, reçus, fichiers d’autorité, quarantaines et fermetures restent préservés.

### Ancien moniteur local de fraîcheur

Le parent lit le journal au démarrage puis avec un espacement cible de **60 secondes après chaque lecture**. Une lecture est bornée à **15 secondes** ; trois observations en échec confirment un incident. Le premier contrôle sain après l'incident produit un rétablissement. Une capture en cours ne clôture pas un incident existant.

Une capture réussie devient ancienne à **26 heures** ; une capture encore en cours après **10 minutes** est signalée bloquée. Ces seuils décrivent le journal, sans prouver l'intégrité actuelle d'une archive, sa copie ou son déchiffrement. Les champs du moniteur restent donc `copyStatus: not_checked`, `decryptionStatus: not_checked` et `notificationStatus: not_sent`.

La file d'alertes distincte transmet les incidents/rétablissements à **contact@jessiemessage.com**. `smtp_accepted` signifie une acceptation SMTP. Ses reprises attendent au minimum 1, 2, 4, 8 puis 15 minutes après les échecs, sans garantie de réception dans ce délai. Le détail et les limites sont dans [Alertes de sauvegarde](docs/backup-email-alerts-053.md). Si le parent ou l'hébergement entier s'arrête, ce mécanisme local ne peut plus envoyer d'alerte.

### Preuves datées à conserver

- **17 octobre, 23:40:45.234 UTC :** premier passage externe sain, deux contrôles, 1 127 ms, run `39079931320` déclenché par `push` ([reçu](docs/activation-proofs/jm051-external-monitor.json)).
- **18 octobre :** les runs `schedule` `39086832046` à **01:31:54 UTC**, `39104289229` à **06:30:38 UTC** et `39123886814` à **11:35:58 UTC** sont réussis. Leurs écarts de plusieurs heures ne prouvent pas une cadence de cinq minutes ([relevé externe 0.51](docs/external-monitoring-051.md)).
- **18 octobre :** intervalles locaux observés de **60 008 ms**, puis **60 031 ms**, `current / OK` ([moniteur](docs/activation-proofs/jm053-periodic-activation.json), [alertes](docs/activation-proofs/jm053-alerts-activation.json)). Ces échantillons ne garantissent pas toutes les lectures futures.
- **18 octobre, 15:54:05 Europe/Paris :** le propriétaire confirme les deux mails synthétiques incident/rétablissement reçus à `contact@jessiemessage.com` ([confirmation](docs/activation-proofs/jm053-alerts-owner-confirmation.json)). Aucun renvoi nécessaire ; ce reçu garde `externalOutageNotificationVerified:false`.
- **19 octobre, 21:39:01.988174 UTC :** service **0.76.0**, moniteur `current / OK`, santé/disponibilité HTTPS 200 sur les deux origines ; moniteur et alertes conservés ([preuve S1](docs/verification-proofs/jm076-verification.json)).
- **19 octobre, 23:45:34.085672 UTC (20 octobre 01:45 Europe/Paris) :** service **0.79.0**, vrai enfant/superviseur démarrés, moniteur **OK**, quatre contrôles HTTPS santé/disponibilité réussis sur les deux origines ; dix fichiers sensibles préservés. Aucun test de mail ni nouvel appariement ([preuves 0.79](docs/verification-proofs/jm079-verification.json)).
- **19 octobre :** copie PC courante et déchiffrement personnel acquis, résultat `DECHIFFREMENT_VERIFIE` reçu à **16:34:19 UTC** ([preuve PC](docs/verification-proofs/jm0702-verification.json)). Aucun nouvel appariement ou test personnel à refaire pour vérifier la surveillance.

Les activations 0.51–0.56 sont historiques ; elles ne donnent pas les commandes du service courant. Les derniers runs, leur cadence observée et les préférences du canal externe peuvent être relevés en lecture seule, sans créer un autre moniteur, modifier les notifications ou envoyer un mail de test.

Sources historiques : [moniteur local](server/backup/periodic-monitor.mjs), [seuils de fraîcheur](server/backup/freshness.mjs), [alertes](docs/backup-email-alerts-053.md). Les activations 0.51–0.56 gardent leur vérité datée et ne remplacent pas REPRISE. Aucune nouvelle observation PC ou réception de mail n’est déduite de leur conservation.

Références GitHub : [planification](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) et [notifications d’exécution](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).
