# Étape 0.53 — surveillance périodique du journal de sauvegarde

**Évolution courante du 18 octobre :** le [runtime/superviseur unifié 0.54.0](stable-release-054.md), source `6cfce890`, conserve ce moniteur et sa file SMTP privée. Le propriétaire confirme les deux mails de test reçus à 15:54 Europe/Paris. Les activations `9df56feb` et `e1842a39` ci-dessous gardent leur portée historique ; [REPRISE.md](REPRISE.md) donne les commandes actuelles.

Le superviseur de sauvegarde garde le même runtime applicatif 0.50, ses arguments, sa configuration et la capture quotidienne à 05:15 UTC. Un observateur indépendant du déroulement des captures lit le journal privé au démarrage puis avec un espacement cible d'une minute après chaque lecture. Le lecteur est borné à quinze secondes et n'ouvre ni connexion SQL ni transport de messages.

## Comportement

- Un journal sain produit un état `current` ; un début de capture encore actif produit `waiting`.
- Trois observations en échec confirment un événement `incident`. Un échec transitoire isolé ne provoque pas de rétablissement artificiel.
- Une capture en cours interrompt une série d'échecs non confirmés. Elle ne clôture jamais un incident déjà ouvert.
- Le premier contrôle réellement sain après un incident produit un seul événement `recovered`.
- Un lecteur bloqué est annulé après quinze secondes. Aucun second lecteur ne démarre tant que le premier n'a pas fini de se libérer ; son éventuel succès tardif est ignoré.
- La fermeture du superviseur annule l'observateur sans attendre une lecture défaillante. Une erreur de création, de démarrage, de lecture ou de journalisation du moniteur ne bloque pas l'application ou sa fermeture.

Les rapports `private_backup_monitor` sont des objets fermés : dates, code fixe, état, compteur d'échecs et métadonnées de fraîcheur. Ils ne contiennent ni chemin, clé, destinataire, exception brute, message, photo ou donnée client. Les copies et le déchiffrement restent `not_checked` et la notification reste `not_sent`.

**Il s'agit d'événements du journal d'exploitation, pas d'alertes reçues par une personne.** Ils sont visibles dans la console de l'application du Manager. La réception par un canal choisi devra être éprouvée séparément. L'état des incidents est en mémoire ; un redémarrage commence une nouvelle série d'observations et ne fabrique aucun événement de rétablissement pour un incident historique.

## Limites

Le moniteur n'effectue aucune capture, purge, restauration, copie distante ni déchiffrement. Il ne modifie pas les signaux publics `/api/health` et `/api/ready` et n'ajoute pas d'endpoint public de sauvegarde. Un arrêt complet du parent ou de l'hébergement ne peut pas être signalé par ce moniteur local ; la sonde externe reste nécessaire, avec ses limites de cadence. Le journal ne prouve pas l'intégrité actuelle des octets sauvegardés.

Les événements `schedule` GitHub observés le 18 octobre à 01:31, 06:30 et 11:35 UTC sont tous réussis, mais espacés de plusieurs heures. La configuration demandant cinq minutes ne permet donc pas de promettre une détection en cinq minutes. Aucun intervalle maximal n'est annoncé.

## Sauvegarde quotidienne constatée

La première exécution calendaire du 18 octobre commence à **05:15:33.262 UTC** et se termine à **05:15:39.807 UTC**, soit **6 545 ms pour l'opération entière**. Le journal donne `succeeded / finished / OK / runtimeResumed: true`. La capture complète chiffrée est relue à 12:23:18.853 UTC : AES-256/MDC, destinataire attendu, empreintes et tailles du clair et du chiffré conformes au reçu. Le [relevé fermé](activation-proofs/jm052-first-scheduled-20261018.json) distingue cette preuve du déchiffrement PC et d'une copie indépendante, toujours non confirmés.

## Activation et repli

La nouvelle source opérateur doit être installée dans un checkout séparé et épinglée par commit et arbre. Le runtime 0.50 et les répertoires privés existants sont conservés. Effectuer le préflight `check` avant de remplacer le Run et le Build du Manager. Ce contrôle ne démarre ni application, moniteur ni capture. Le cycle normal Build/redémarrage du Manager lance ensuite l'observateur dans le même parent supervisé.

Le repli est le lanceur existant `start-primary-backups-checked-9665d54c.sh` et son Build épinglé, sauvegardés avant activation. Il conserve la capture quotidienne et les données ; aucune restauration SQL n'est requise. Les sources, heures et preuves d'activation réelles seront ajoutées après leur observation.

## Activation réelle du 18 octobre

La source opérateur **`9df56feb80b94051ede34f2e53cc7d7ff7e194ba`**, arbre **`8272fbd55841556556f9d78acfeb048767b2f1e9`**, est installée dans `/srv/customer/jessiemessage-operator/periodic-monitor-9df56feb`. Ses [cinq jobs CI](https://github.com/fredbuhr/jessiemessage/actions/runs/39127547912) passent : **2 428 réussites générales / 27 wrappers SQL ignorés**, **383/383** sur chaque MariaDB, **101/101 Chrome**, **1/1 authentification HTTPS**, syntaxe de 423 fichiers et build réussis. Les **42/42 tests natifs** passent également sur l'hébergement, sans saut ; préflight `passed`, `started: false`, `backupStarted: false`.

Les anciennes commandes sont sauvegardées exclusivement dans `/srv/customer/jessiemessage-private/manager-before-monitor-053.json`, mode 0600. Le nouveau lanceur `start-primary-monitored-9df56feb.sh` est en mode 0700, 846 octets, SHA-256 `d5f89844c5002923135ee0b939d074d2fcb98c61662040a343d8f39ac4af246e`. Le Manager enregistre ce Run et le Build épinglé de la nouvelle source. Le cycle normal Build/redémarrage réussit vers **14:35 Europe/Paris**. Le runtime applicatif 0.50 et ses clés restent conservés.

La console affiche deux lectures réelles : **12:35:53.815 UTC** puis **12:36:53.823 UTC**, espacées de **60 008 ms**. Les deux sont `current / OK`, zéro échec, aucun incident ; copie/déchiffrement restent `not_checked`, notification `not_sent`. À **12:37:06.392 UTC**, **38/38 lectures HTTPS** et **seize empreintes exactes** sont conformes sur les deux origines. Le journal garde quatre enregistrements, dernier succès de la capture de 05:15 : aucune nouvelle capture n'est provoquée par ce redémarrage.

Voir les reçus de [préparation](activation-proofs/jm053-periodic-preparation.json) et d'[activation](activation-proofs/jm053-periodic-activation.json). Deux lectures confirment le fonctionnement périodique observé ; elles ne garantissent pas toute exécution future. Le canal d'alerte et sa réception réelle, la copie indépendante et le déchiffrement PC restent ouverts.
