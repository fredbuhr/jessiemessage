# Étape 0.53 — alertes du journal de sauvegarde par courriel

Le superviseur opérateur peut transmettre les incidents confirmés et leur rétablissement à **contact@jessiemessage.com**, identité officielle déjà choisie pour JessieMessage. L'expéditeur, le Reply-To et l'enveloppe utilisent cette même adresse. Aucun destinataire, sujet, HTML, URL, pièce jointe ou texte libre ne peut être fourni à l'outil. Le runtime applicatif 0.50 reste épinglé séparément ; aucune migration, capture supplémentaire ou modification de compte n'est requise.

## Fonctionnement et preuves

Le moniteur garde ses trois observations en échec avant confirmation. Ses échantillons restent des observations `private_backup_monitor`, `notificationStatus: not_sent`. Un observateur distinct maintient la file privée et publie des reçus fermés `private_backup_alert` : `smtp_accepted` signifie uniquement que le serveur SMTP a accepté l'unique destinataire officiel. La réception en boîte, une copie indépendante, le déchiffrement et l'intégrité actuelle de l'archive ne sont jamais déduits de cette acceptation.

Le fichier privé `backup-alert-state.json`, dans le répertoire d'opérations existant, conserve l'incident ouvert, une file FIFO de trente-deux messages au maximum et les métadonnées des tentatives/acceptations. Il ne contient aucune donnée client ni aucun secret SMTP. L'incident est persisté avant toute connexion réseau ; le rétablissement attend l'incident dans la file. Après redémarrage, une observation saine clôture un incident persistant, même si le moniteur en mémoire vient seulement de démarrer. Un état `waiting` ne clôture jamais un incident.

Le SMTP réutilise les configurations privées existantes et le transport TLS déjà éprouvé pour les courriels d'accès : certificat vérifié, TLS 1.2 minimum, ports 465/587, authentification obligatoire, accès aux fichiers/URL et debug désactivés. Un transport distinct appartient à chaque tentative. Construction, envoi et fermeture sont bornés à vingt secondes ; l'annulation ferme les sockets possédées et un résultat tardif ne peut produire de reçu.

Une seule tentative est faite par observation minute. Après les échecs, l'attente minimale est de 1, 2, 4, 8 puis 15 minutes, plafonnée à 15 minutes. La tentative est enregistrée avant SMTP pour conserver ce délai après redémarrage. Un refus, une acceptation partielle ou un résultat ambigu conserve le message. La file et l'application ont des cycles distincts ; une défaillance SMTP ne bloque ni le lancement de l'application ni la capture quotidienne.

## Limites explicites

- SMTP ne permet pas une garantie « exactement une fois ». Une acceptation suivie d'une interruption avant l'acquittement disque peut produire un doublon avec le **même Message-ID**. Une acceptation n'est jamais présentée comme une lecture ou une réception humaine.
- Le stock reste borné. Une file pleine signale `ALERT_QUEUE_FULL`, préserve l'ordre et continue à se vider. La transition courante est reconsidérée au contrôle suivant ; un nombre illimité de transitions transitoires pendant une panne mail prolongée n'est pas conservé.
- Les écritures passent par un répertoire privé ancré, un verrou exclusif indépendant de celui des captures, des fichiers 0600 à lien unique, un remplacement atomique, `fsync` et une relecture. Un verrou existant n'est jamais supprimé automatiquement. Après une mort brutale pendant les quelques écritures, vérifier qu'aucun écrivain d'alertes ne tourne avant de déplacer un éventuel `backup-alert-state.lock` ; ne pas effacer le journal ou les sauvegardes. Un état corrompu reste signalé, jamais réinitialisé silencieusement.
- Un hébergement entièrement arrêté ne peut s'envoyer son propre courriel. La sonde externe GitHub garde sa fonction et ses limites de cadence constatées. Ce lot n'active pas les notifications GitHub du propriétaire.

## Exercice sans données clients

`scripts/test-private-backup-alerts.mjs check --private-directory <configuration privée> --private-path-mode linux-dirfd` valide le chargement et la construction sans ouvrir de connexion SMTP ni envoyer de message.

La commande explicite `send-test`, avec les mêmes arguments, envoie exactement deux courriels portant **[TEST]** et **EXERCICE SYNTHÉTIQUE** : un incident puis un rétablissement reliés par une référence. Elle ne modifie pas la file de production, ne provoque aucune panne, n'ouvre pas SQL et ne capture aucune archive. Ses reçus gardent `inboxStatus: not_checked` tant que le propriétaire ou la boîte ne confirme pas la réception.

## Activation

Préparer un checkout opérateur séparé et épingler son commit, son arbre et sa propreté. Passer syntaxe/build, les cinq jobs CI, les tests natifs et le préflight existant avant activation. Conserver exclusivement dans un fichier privé les commandes Run/Build précédentes et créer un nouveau lanceur 0700. Le repli est le superviseur minute `9df56feb` et son lanceur `start-primary-monitored-9df56feb.sh` ; aucune restauration SQL.

## Activation réelle du 18 octobre

La source opérateur **`e1842a395925b19a50dcabbccfb7e9b9b03fcd8e`**, arbre **`ad44e230db9a1ec89902e616b1315496b4afe284`**, est installée séparément dans `/srv/customer/jessiemessage-operator/backup-alerts-e1842a39`. Les [cinq jobs de la CI exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39129817295) passent : **2 452 réussites générales / 27 wrappers SQL ignorés**, **383/383 sur chaque MariaDB**, **101/101 Chrome**, **1/1 authentification HTTPS**. Syntaxe de 431 fichiers et build réussis. Les **87/87 tests ciblés natifs**, sans saut, et les deux préflights passent sur l'hébergement.

Le repli est sauvegardé exclusivement dans `/srv/customer/jessiemessage-private/manager-before-alerts-053.json`, mode 0600. Le lanceur `start-primary-alerts-e1842a39.sh`, mode 0700, 843 octets, est épinglé par commit/arbre/propreté. Le Manager enregistre son Run et le Build de la nouvelle source, puis réussit le cycle normal Build/redémarrage à **15:07 Europe/Paris**. Deux observations réelles à **13:07:51.090** et **13:08:51.121 UTC**, espacées de **60 031 ms**, sont `current / OK`, aucun incident et zéro alerte en attente. Le runtime applicatif reste 0.50.

À **13:10:53.337 UTC**, **38/38 lectures HTTPS et seize empreintes exactes** passent sur les deux origines ; la route protégée de campagne est `/api/broadcast/admin/campaigns`. Le journal garde quatre enregistrements et son succès du matin : aucune nouvelle capture induite par ce déploiement.

Les deux courriels **[TEST] Incident de sauvegarde — JessieMessage** et **[TEST] Sauvegarde rétablie — JessieMessage** sont **acceptés par SMTP** avant activation. Aucun message client ni campagne n'est envoyé. La réception reste **non confirmée** : la vérification IMAPS en lecture seule, ciblée sur leurs références de test dans `INBOX`, ne retrouve pas ces messages à **13:17:07.909789 UTC**. Aucun autre contenu de mail ni corps client n'est lu ; aucune règle de boîte n'est modifiée. Le MX public est `mta-gw.infomaniak.ch`, priorité 5. Ce constat ne prouve ni une perte ni une réception ailleurs ; demander une observation ciblée du propriétaire avant de clore la réception du canal. Ne pas renvoyer les tests sans nécessité.

Les [preuves de préparation](activation-proofs/jm053-alerts-preparation.json), d'[activation](activation-proofs/jm053-alerts-activation.json) et la [capture du Manager](activation-proofs/jm053-alerts-activation-20261018.jpg) conservent ces distinctions. La copie indépendante et le déchiffrement PC restent ouverts ; la sonde externe n'a pas acquis de garantie de cadence ou de réception d'alerte.
