# JessieMessage — profil privé des diffusions et reprise, étape 0.48

**Préparation validée, suivie de l’[activation 0.49](broadcast-activation-049.md) à 00:47 le 18 octobre 2026.** Le propriétaire accepte à **00:31:47 Europe/Paris** le parcours personnel essayé des fiches : « C’est bon ça fonctionne ». Le lot 0.47 reste actif, source `edf696ec`, profil `messaging-photos-notify-recovery-crm`. Aucun test de conflit ni inventaire de plateformes n’est déduit et aucune répétition globale n’est demandée.

Le nouveau profil `photos-notify-recovery-crm-broadcast` raccorde le moteur de diffusions déjà présent aux six configurations privées et aux deux origines. La préparation n’active rien par elle-même ; l’activation ultérieure est consignée séparément. Référence candidate : **`d77f16fbddbee4bad90f0230ad344d148823aac5`**, arbre **`5897917c0e7810e16ab51e600e2cf1c6eff02f47`**, [PR brouillon #61](https://github.com/fredbuhr/jessiemessage/pull/61), empilée sur le lot CRM.

## Activation explicite et coexistence

Le [chargeur des diffusions](../server/config/runtime-broadcast.mjs) utilise le même bundle de six fichiers que le CRM. Il copie les valeurs dans une enveloppe privée et active seulement en mémoire le drapeau de diffusion. Aucun nouveau fichier de configuration ni secret, aucune migration, rotation de clé ou nouvelle dépendance. Les campagnes réutilisent la clé des messages avec leur finalité cryptographique distincte ; les six clés de données restent séparées, ainsi que VAPID.

Les anciens chargeurs continuent de refuser le drapeau de diffusion actif. Le [préflight](../server/preflight/config.mjs) exige toutes les fonctions du nouveau profil, l’origine principale, TLS vérifié et la séparation des clés. Le lanceur exige le déploiement `primary-transition`, vérifie les droits SQL, les trois tables physiques de diffusion et le stockage avant tout listener. Son mode `check` ne crée ni serveur, ni worker, ni transport.

Le serveur exige aussi les options explicites de récupération, CRM et diffusion. Les deux adresses partagent le même service et la même horloge, avec leurs propres contrôles Origin/CSRF. Un seul worker de diffusion gère leur file commune. Le service et le worker reçoivent l’horloge du runtime, y compris pour l’ancienne origine recette.

## Comportement conservé

Le [moteur existant](targeted-broadcasts.md) garde l’accord individuel désactivé par défaut, l’aperçu explicite de l’audience et la confirmation de chaque campagne. Jess ne peut pas modifier l’accord à la place d’un invité. Chaque destinataire reçoit un message individuel sans voir les autres destinataires ni les classements privés.

La file est durable et la répétition d’une même confirmation retrouve la campagne existante. Les contrôles d’accès, d’affectation, de MFA, de retrait d’accord et de photo sont relus avant inscription de chaque message. Annuler une campagne conserve les messages déjà inscrits ; les suivants restent arrêtés. Aucun envoi réel n’est réalisé par l’agent pour valider ce lot.

## Sauvegarde et reprise des campagnes

| Profil SQL/photos | Manifeste | Reçu | Clés de données |
| --- | --- | --- | --- |
| `photos-notify-recovery-crm-broadcast` | 9 | 7 | Six, existantes |
| `photos-notify-recovery-crm-broadcast-application` | 10 | 8 | Six, existantes |

Le [vérificateur](../server/backup/verify.mjs) authentifie le contenu chiffré de la campagne, son propriétaire, son empreinte, la photo sélectionnée et la liste exacte ordonnée de ses destinataires. Il vérifie aussi les notes, messages, e-mails de récupération, abonnements Push et médias. Les métadonnées d’accord et d’état appartiennent au snapshot SQL. Aucun traitement de la file, bail, notification ou e-mail n’est déclenché pendant la vérification.

Capture, vérification, import natif et reprise en une saisie propagent la nouvelle sélection. Le profil applicatif garde sa couverture limitée aux trente tables et aux photos : objets SQL exécutables exclus/non prouvés, aucune affirmation de sauvegarde complète de la base. Les nouveaux formats ne peuvent pas acquérir le nom ou les clés d’un ancien format. Les anciens profils gardent leur périmètre et refusent toute table de diffusion peuplée.

Le [checkpoint réel 0.46](crm-checkpoint-046.md) et sa restauration native personnelle restent acquis avec leur format CRM d’origine ; ils ne constituent pas une preuve de restauration d’une campagne réelle peuplée. Après activation et création de données de diffusion, utiliser ce nouveau profil même si le runtime revient au CRM sans diffusion. Les tables, la clé de message, le coffre et les sessions doivent rester conservés.

## Validation locale

- Build et syntaxe conformes ; suite générale **2 308 cas, 2 152 réussites, 156 intégrations ignorées, aucun échec**.
- Suite ciblée : **163 réussites**, trois contrôles de fichiers réservés à Linux CI.
- Les nouveaux cas vérifient les options fermées, l’absence de getter exécuté, les anciennes limites de profil, les canaris des six clés, les versions strictes/application, les campagnes modifiées et leur audience, la capture du checkpoint, la vérification sans écriture, l’import et la reprise avec un seul secret personnel.

Les répétitions MariaDB ajoutent une campagne et son accord dans une base jetable, capturent un snapshot, copient les trente tables et les photos dans une autre base, refusent une ancienne sélection CRM puis vérifient/restaurent la copie sans worker. Elles conservent notes, récupération et Push peuplés et vérifient que campagne, destinataires et accord n’ont pas été traités. Ce scénario copie le SQL en CI ; il n’exécute pas le pipeline natif d’export/import de l’hébergement.

La répétition du vrai runtime vérifie les deux origines sous une horloge fixée distincte de l’heure système : accord personnel partagé, refus Origin, aperçu, confirmation et même campagne retrouvée après retry. Les producteurs sont arrêtés avant écoute pour ce scénario, sans livraison externe. Le retour au profil CRM retire les routes de diffusion tout en conservant campagne, accord et sessions. Les tests existants du worker gardent la preuve des inscriptions synthétiques sans doublon.

## Suite hébergée

Le candidat est installé séparément dans `/srv/customer/jessiemessage-operator/broadcast-runtime-backup-d77f16fb`, sans modifier le checkout du service actif. Les preuves CI et préflights doivent être inscrites ci-dessous avant toute activation. Une observation personnelle ciblée devra ensuite couvrir l’option d’accord d’un compte invité et l’aperçu administrateur, puis une campagne choisie et confirmée personnellement. Aucun envoi collectif automatique de test n’est prévu.

## CI de la source finale

Les [cinq jobs exacts du workflow PR 39076214773](https://github.com/fredbuhr/jessiemessage/actions/runs/39076214773) réussissent sur `d77f16fb` : **2 281 réussites générales et 27 wrappers SQL ignorés**, build et aperçu conformes ; **383/383** par MariaDB 10.11 et 11.4 ; **101/101** Chrome applicatifs ; **1/1** authentification HTTPS/MariaDB. Le premier candidat n’est jamais activé ; la correction finale concerne le nom de colonne d’une assertion ajoutée au test SQL de restauration.

## Préparation réelle de l’activation

Checkout final séparé prêt à **00:44:04.712058 Europe/Paris** : source/arbre épinglés, Git propre, dépendances verrouillées sans scripts et syntaxe conformes sous Node 24.15.0. Le lanceur privé `/srv/customer/jessiemessage-private/start-primary-broadcast-checked-d77f16fb.sh` est créé exclusivement et relu, mode `0700`, **802 octets**, SHA-256 **`5bc328588f8640a6af3430527d137dc4c3f2c6e71eb93083f37051655c94d422`**.

À **00:44:28.223828**, sa syntaxe et son mode `check` passent : `checks_passed`, profil `messaging-photos-notify-recovery-crm-broadcast`, `deployment: primary-transition`, `started: false`. À **00:44:58.515273**, le nouveau vérificateur authentifie les domaines actuellement peuplés en lecture seule : `complete: true`, `healthy: true`. Les trois tables de diffusion sont vides. Cette lecture du service en activité ne constitue ni un snapshot cohérent, ni une nouvelle capture ou restauration ; aucune donnée privée n’est affichée, aucun worker ou transport n’est ouvert.

L’[activation 0.49](broadcast-activation-049.md) réussit à 00:47, puis 68 contrôles HTTPS et seize empreintes passent à 00:48:20. Le coffre à six fichiers et la restauration native 0.46 déjà acceptés restent conservés ; aucune nouvelle clé ni migration ne justifie leur répétition. Une restauration réelle avec campagne peuplée n’est pas déduite de ces preuves, qui associent le pipeline natif réel 0.46 et le scénario SQL peuplé de la nouvelle source en CI.
