# Étape 0.53 — contrôle de fraîcheur du journal

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
