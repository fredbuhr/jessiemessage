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

Le commandement explicite `send-test`, avec les mêmes arguments, envoie exactement deux courriels portant **[TEST]** et **EXERCICE SYNTHÉTIQUE** : un incident puis un rétablissement reliés par une référence. Il ne modifie pas la file de production, ne provoque aucune panne, n'ouvre pas SQL et ne capture aucune archive. Ses reçus gardent `inboxStatus: not_checked` tant que le propriétaire ou la boîte ne confirme pas la réception.

## Activation

Préparer un checkout opérateur séparé et épingler son commit, son arbre et sa propreté. Passer syntaxe/build, les cinq jobs CI, les tests natifs et le préflight existant avant activation. Conserver exclusivement dans un fichier privé les commandes Run/Build précédentes et créer un nouveau lanceur 0700. Le repli est le superviseur minute `9df56feb` et son lanceur `start-primary-monitored-9df56feb.sh` ; aucune restauration SQL.

Les références exactes et preuves réelles sont à ajouter après observation. À ce stade de préparation, aucun envoi ni changement du Manager n'est revendiqué.
