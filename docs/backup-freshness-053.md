# Étape 0.53 — contrôle de fraîcheur du journal

**Évolution du 18 octobre à 15:07 Europe/Paris :** le CLI est inchangé ; le [superviseur `e1842a39`](backup-email-alerts-053.md) utilise son lecteur chaque minute et conserve désormais une file privée d'alertes SMTP. Deux tests sont acceptés par SMTP pour l'adresse officielle ; la réception reste non confirmée. Voir [REPRISE.md](REPRISE.md) pour les commandes actuelles ; les preuves ci-dessous sont datées.

**Mise à jour du 18 octobre à 14:37 Europe/Paris :** le CLI ci-dessous reste en lecture seule ; il est désormais utilisé chaque minute par le [moniteur 0.53 activé](periodic-backup-monitor-053.md). Les événements sont consignés dans le Manager, sans envoi d’alerte. Le contrôle ponctuel de 00:55 décrit plus bas est une preuve historique.

Le contrôle en lecture seule complète la sauvegarde 0.52. Il n'arrête pas l'application, ne lance aucune capture, ne crée pas de verrou, ne restaure aucune base et ne transfère aucun fichier. Le runtime 0.50 et son superviseur 0.52 peuvent continuer dans leurs dossiers épinglés.

```bash
node scripts/check-private-backups.mjs --operations-directory /srv/customer/jessiemessage-private/recurring-backup-052 --private-path-mode linux-dirfd
```

Le fichier de configuration et les journaux sont lus par la frontière privée existante : répertoires ancrés, propriétaire et permissions stricts, fichiers réguliers sans liens, taille bornée et relecture de stabilité. La configuration est relue après le journal pour refuser un changement pendant l'observation. Les erreurs retournent un code fixe, sans chemin, exception brute ou contenu privé.

| Sortie | Signification | Code processus |
| --- | --- | ---: |
| `OK` | Dernière tentative achevée avec capture, chiffrement et reprise consignés ; succès de moins de 26 heures | 0 |
| `BACKUP_STALE` | Dernier succès âgé d'au moins 26 heures | 1 |
| `NO_SUCCESS` | Aucun succès consigné | 1 |
| `BACKUP_DISABLED` | Planification désactivée | 1 |
| `LAST_ATTEMPT_FAILED` | La dernière tentative a échoué, même avec un succès récent antérieur | 1 |
| `CAPTURE_RUNNING` / `CAPTURE_STALLED` | Tentative non terminée ; bloquée à partir de dix minutes | 1 |
| `JOURNAL_INCOMPLETE` | Début durable absent ou ancienne tentative sans fin, même avec un succès ultérieur | 1 |
| `BACKUP_CHECK_*` | Lecture impossible, paramètres/configuration modifiés, historique invalide ou délai global dépassé | 2 |

Une date future, une synthèse incompatible avec les enregistrements, des fins de tentative dupliquées ou un faux succès sans reprise sont refusés. Un journal récent ne suffit pas à certifier les fichiers actuels : le rapport indique expressément `scope: capture-journal`, `copyStatus: not_checked` et `decryptionStatus: not_checked`.

Le seuil de dix minutes dépasse les budgets nominaux cumulés d'arrêt, capture, chiffrement et reprise du superviseur. Le code 1 pendant une capture courte est un état à confirmer avant toute notification, pas une raison d'interrompre cette capture. Le seuil de 26 heures est celui proposé dans le plan 0.51 ; aucune purge n'est ajoutée.

## Limites et suite du lot

Ce contrôle ne prouve ni l'existence physique actuelle ni l'intégrité de l'archive ; le validateur et les empreintes du checkpoint restent nécessaires. Il ne prouve pas une copie indépendante, une possession de la clé privée, un déchiffrement ou une restauration. Il ne détecte pas à lui seul un moniteur qui ne s'exécute plus.

Restent à raccorder et éprouver : destination indépendante réellement retenue, transfert automatique du seul fichier chiffré, reçu de copie lié à son empreinte, contrôle des octets à destination, alertes panne/rétablissement et surveillance de l'absence du moniteur. Aucun nouveau service, secret ou canal d'envoi n'est choisi implicitement. Le déchiffrement PC 0.52 et la première exécution quotidienne restent à constater ; les preuves 0.46 ne sont pas à refaire.

## Vérification hébergée

Le 18 octobre à **00:55:23.605 UTC**, la source `5c64a9d6` (arbre `ff0d0b39`) est installée dans le checkout séparé `/srv/customer/jessiemessage-operator/reprise-freshness-5c64a9d6`. Les **11/11 tests natifs** passent, aucun ignoré. Le lecteur réel renvoie `current / OK`, dernier succès `1792283296649`, âge 1 626 956 ms, copie et déchiffrement `not_checked`. Le passage HTTPS suivant est `healthy`, premier essai, santé et disponibilité conformes. Le [reçu fermé](activation-proofs/jm053-freshness-check.json) conserve cette portée.

Lors de ce contrôle de 00:55, l’outil était disponible à la demande, sans tâche périodique ni alerte reçue. La surveillance minute est activée plus tard dans la journée par le superviseur 0.53 ; le runtime 0.50, les clés et les données restent conservés.

La [CI de cette source](https://github.com/fredbuhr/jessiemessage/actions/runs/39084535494) est réussie : cinq jobs, 2 413 tests généraux réussis et 27 wrappers SQL ignorés, 383/383 sur chaque MariaDB, 101/101 Chrome et 1/1 authentification HTTPS. Les commits documentaires ultérieurs ne modifient aucun code exécuté.
