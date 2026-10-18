# Inventaire et export privés — lot 0.17b

Version applicative **0.18.0**, branche `feat/private-data-export`, construite sur le lot de supervision 0.17a. Ce lot fournit un **outil opérateur hors ligne**, sans route HTTP, bouton client, effacement ou modification du schéma. L’adresse officielle reste **contact@jessiemessage.com**.

**État courant — 17 octobre 2026, schéma 30 :** `server/data/policy.mjs` décrit **29 catégories de tables applicatives**, dont **22 rattachables au client**, cinq administrateur et deux globales ; le registre des migrations est exclu. Les ajouts sont `push_subscriptions` et `push_outbox`, comptés sans exporter les endpoints, clés navigateur, identifiants de session ou charges chiffrées. Les compteurs restent bornés ; l’export de contenu conserve sa portée limitée. Aucune conservation générale ni suppression de compte n’est activée. Les nombres 27 ci-dessous décrivent les preuves historiques du lot 0.17b.

## Portée

À la livraison historique 0.17b, l’inventaire décrivait **27 tables applicatives** ; le catalogue courant ci-dessus en couvre 29. Pour un client explicitement sélectionné, il compte les lignes associées sans exporter leur contenu. Les catégories administrateur et globales ont un compteur `null` : cela signifie « hors périmètre du comptage », jamais zéro. Le registre des migrations n’est pas une catégorie personnelle.

Chaque comptage lit au plus 10 001 lignes et restitue au maximum 10 000 avec `truncated: true` au-delà. Ce résultat signifie **au moins 10 000**, pas un total exact. Les profils et appartenances CRM associés sont comptés, mais leurs notes, surnoms et libellés restent exclus de l’export de contenu.

L’export restitue le contenu conservé correspondant à la visibilité normale du client, même si ses accès sont expirés, suspendus ou révoqués. Il ne restaure aucun accès et n’ouvre aucune session. Un administrateur ne peut pas être sélectionné comme client. Il ne s’agit pas d’un export exhaustif de toutes les données personnelles ni d’un parcours de réponse juridique complet.

| Fichier | Contenu |
| --- | --- |
| `account.json` | Pseudonyme, e-mail, état du compte, dates d’accès et de vérification, interlocuteur, curseurs de lecture et préférence de diffusion actuelle |
| `messages.jsonl` | Une ligne JSON par message de la conversation, dans l’ordre ; auteur `me` ou `peer`, texte, dates et référence de photo éventuelle |
| `library.jsonl` | Une ligne par photo active appartenant au client, y compris inutilisée |
| `media/<identifiant>.jpg` | Photos normalisées de taille complète, dédupliquées |
| `COMPLETE.json` | Liste des fichiers, tailles, SHA-256 et compteurs sans identité de client |

Un message supprimé reste un tombstone : texte et photo absents. Une photo d’administrateur est incluse uniquement si un message non supprimé la rend accessible dans cette conversation. Sa réutilisation auprès d’un autre client ne donne aucun accès à cet autre échange. Une photo encore active dans la bibliothèque du client demeure exportable même si son ancien message de partage a été supprimé.

Sont exclus : mots de passe, jetons, empreintes d’authentification ou de message, MFA, clés, chemins et handles de stockage, payloads des files e-mail, notes et libellés CRM, corps des campagnes, audiences et données des autres clients. Les SHA-256 du manifeste portent seulement sur les fichiers produits ; ce manifeste n’est pas signé et ne certifie ni une sauvegarde ni les clés d’un domaine vide.

## Conditions d’exécution

L’opérateur doit être habilité à lire les données du client, vérifier son identité et le périmètre demandé, puis arrêter **tous** les producteurs : serveur HTTP, workers, scripts médias et autres processus agissant sur cette base ou son stockage. Le drapeau `--offline` confirme cette démarche humaine ; il ne prouve pas que ces processus sont arrêtés. Une transaction SQL cohérente ne fige pas les fichiers externes.

Utiliser Node.js 24 et les paramètres SQL d’exécution documentés dans [DATABASE.md](DATABASE.md), avec confirmation exacte `JESSIEMESSAGE_APPLICATION_DATABASE`. La commande n’utilise pas les identifiants de migration. TLS reste requis hors connexion locale explicitement autorisée. L’utilisateur SQL dispose des droits existants ; l’outil impose sa propre transaction **READ ONLY**.

- Inventaire : aucune clé de contenu requise.
- Export : `JESSIEMESSAGE_MESSAGE_KEY`, clé existante de 32 octets en base64url canonique.
- Lorsqu’une photo sélectionnée doit être lue : `JESSIEMESSAGE_MEDIA_ROOT` existant et `JESSIEMESSAGE_MEDIA_KEY`, distincte de la clé des messages.

Les clés de MFA, CRM et e-mail et les flags du serveur ne sont pas requis. Si un répertoire média est configuré, il fait partie des chemins protégés même pour l’inventaire. Ne jamais mettre les clés sur la ligne de commande ou les enregistrer dans le dépôt.

Préparer un parent de sortie existant, appartenant à l’opérateur, en mode `0700`. La destination doit être un nouveau chemin absolu canonique, hors du dépôt et hors du stockage média ; elle ne doit pas non plus englober ces répertoires. Aucun ancêtre symbolique n’est accepté. Les ancêtres sont détenus par root ou l’opérateur, sans écriture de groupe/autres, sauf répertoire système sticky détenu par root. L’outil ne corrige pas les permissions et n’écrase jamais une sortie existante.

Exemples avec **identifiant et chemins fictifs**, à remplacer après vérification :

```sh
npm run data -- inventory --offline --database jessiemessage_private --client 11111111111111111111111111111111 --confirm-client 11111111111111111111111111111111 --output /srv/private-exports/client-inventory-new
npm run data -- export --offline --database jessiemessage_private --client 11111111111111111111111111111111 --confirm-client 11111111111111111111111111111111 --output /srv/private-exports/client-content-new
```

L’ordre des arguments est strict, l’identifiant est en hexadécimal minuscule sur 32 caractères, sa répétition doit être exacte et le nom de base doit correspondre à la configuration. Les identifiants se vérifient par les moyens administratifs existants ; ce lot n’ajoute pas de liste de clients au terminal.

## Cohérence, intégrité et limites

Toutes les lectures passent par une seule connexion, en isolation **REPEATABLE READ**, avec instantané cohérent en lecture seule. La pagination utilise la séquence des messages et les identifiants médias, sans décalage. Les lectures sont séquentielles ; une lecture laissée en cours par l’appelant est drainée puis entraîne un rollback. L’identité du client, les participants et les associations du journal média sont contrôlés indépendamment de l’interface web.

L’export authentifie chaque message déchiffré et son empreinte, puis vérifie l’association de la photo, le journal `registered`, la taille, l’enveloppe JPEG et le digest du contenu. Il exporte les timestamps SQL avec **six décimales**, les séquences comme chaînes décimales, et efface les buffers JPEG temporaires après l’écriture attendue. Aucune suppression n’est exécutée en base ou dans le stockage source.

Budgets par défaut du contenu : **10 000 lignes cumulées messages/bibliothèque**, **16 Mio de texte sérialisé**, **256 Mio de photos distinctes**. Le writer impose en plus un budget global de **272 Mio**, manifeste compris, et **10 010 fichiers**. Un dépassement, une incohérence, une clé incorrecte sur un contenu rencontré ou une erreur d’écriture fait échouer l’opération ; aucun export tronqué n’est déclaré complet. Un compte sans message ne permet pas de prouver la validité de la clé des messages ; il en va de même de la clé média sans photo lue.

La destination et son sous-répertoire média sont en `0700`, les fichiers en `0600`, créés exclusivement et sans suivre les liens. Le writer recontrôle identités, permissions et hashes avant finalisation. Ces contrôles portables ne prétendent pas résister à un opérateur local malveillant de même UID ni détecter tous les alias de bind mounts. L’opérateur ne doit pas modifier le système de fichiers pendant l’opération.

La transaction doit être validée et le pool fermé avant la publication de `COMPLETE.json`. Les données sont synchronisées et leurs descripteurs fermés avant ce marqueur ; le répertoire est synchronisé et fermé avant retour de succès. La sortie standard contient uniquement le type d’opération, le statut et les compteurs. Les erreurs sont fixes, sans détail SQL, e-mail, contenu ou chemin privé.

En cas d’échec, le dossier privé partiel est conservé, sans marqueur de succès publié par l’outil. Une interruption brutale ou une panne de l’hôte peut survenir à n’importe quelle étape : avant transfert, vérifier le succès de la commande, le manifeste et ses hashes. Ne pas distribuer un dossier incomplet. Relancer vers **un autre nouveau répertoire**, puis traiter le dossier partiel par la procédure opérateur appropriée ; aucune purge automatique ne le retire.

Les exports contiennent du texte et des photos **en clair**. Leur remise doit utiliser un canal privé convenu et un stockage protégé. Ils restent hors de Git, du répertoire web, des artefacts publics de CI et des sauvegardes de développement.

## Politique à décider et suite

`policy.json`, produit par l’inventaire, documente les catégories avec `retentionDays: null` et `decisionRequired: true`. **Aucune durée de conservation générale n’est activée.** Le catalogue décrit séparément quatre nettoyages techniques existants : les deux outbox e-mail après plus de sept jours depuis expiration/envoi, les jobs Push terminaux après plus de trente jours depuis leur fin, et les compartiments anti-abus partagés après plus de vingt-quatre heures depuis leur début de fenêtre. Les passes sont bornées et dépendent des processus/appels actifs ; ces seuils ne garantissent pas une date d’effacement sur toutes les copies. Challenges, abonnements et messages restent distincts. Voir les critères exacts et limites dans le [registre de conservation préparé en 0.41](data-retention-register.md).

Le [lot 0.41](data-privacy-preparation.md) ajoute un brouillon de notice FR/EN et une [procédure de réponse aux demandes](data-rights-procedure.md). L’exclusion technique des notes/labels CRM et d’autres données de cet export ne permet pas de les exclure par principe d’une réponse à un droit d’accès. Une revue complémentaire des données réellement détenues et de la protection des tiers reste nécessaire. Aucun exporteur élargi ni exécuteur de suppression n’est ajouté.

Restent à décider : durées et déclencheurs par catégorie, traitement des obligations applicables, données CRM, journaux partagés, exports remis et copies de sauvegarde. Le lot suivant **0.17c** peut préparer une simulation explicite des dépendances de suppression et du retour arrière ; une purge réelle reste conditionnée à ces décisions et à sa validation. Le parcours client, la réauthentification en ligne, l’autorisation de remise et la suppression complète du compte ne sont pas livrés ici. A03 de l’audit demeure ouvert.

Les tests unitaires couvrent sélection, isolation, cryptographie, budgets, permissions, interruption et finalisation. Le groupe SQL dédié couvre les deux clients et les médias réutilisés, l’instantané concurrent, l’interdiction DML et les compteurs saturés. Les preuves exactes de CI sont portées par la PR de ce lot. Aucun test synthétique ne vaut recette d’exploitation sur Infomaniak.

Le [lot 0.17c](data-deletion-rollback.md) ajoute désormais la commande `plan`, sans clé ni déchiffrement, pour examiner les dépendances de suppression et les protections de repli. Il reste toujours non exécutable et n’active aucune durée de conservation.
