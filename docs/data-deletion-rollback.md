# Simulation de suppression et repli — lot 0.17c

Version applicative **0.19.0**, branche `feat/data-deletion-plan`, sur le lot [inventaire/export 0.17b](private-data-export.md). Adresse officielle : **contact@jessiemessage.com**. Ce lot ajoute un diagnostic opérateur privé en lecture seule et des régressions de compatibilité des historiques. Aucun exécuteur de suppression ni purge automatique n’est livré.

**État courant — 17 octobre 2026, schéma 30 :** le code et les tests du diagnostic couvrent **29 catégories**, dont **22 rattachables au client**, **23 observations** et **40 clés étrangères `RESTRICT`** (38 relations distinctes entre tables). Les quatre observations ajoutées depuis le lot historique sont `notificationSubscriptionsEnabled`, `pushPending`, `pushSending` et `foreignPushBindings`. Sources : `server/data/policy.mjs`, `server/data/deletion-store.mjs`, `server/data/deletion.mjs` et `tests/data-deletion.test.mjs`. Le rapport reste exclusivement `simulationOnly: true`, `executable: false`, `retentionDecided: false` : **aucun exécuteur de suppression n’est livré**. Les nombres 27/20/19/36 et les historiques 25/27 ci-dessous restent les preuves datées de 0.17c ; ils ne décrivent plus l’ensemble courant.

## Produire le diagnostic

Les conditions de l’[outil de données](private-data-export.md) restent applicables : opérateur habilité, base confirmée, client explicitement sélectionné deux fois, tous les producteurs arrêtés, nouveau répertoire privé hors dépôt et stockage média. `--offline` reste une déclaration humaine. Une transaction SQL ne prouve pas l’arrêt des producteurs ni la cohérence des fichiers externes.

```sh
npm run data -- plan --offline --database jessiemessage_private --client 11111111111111111111111111111111 --confirm-client 11111111111111111111111111111111 --output /srv/private-exports/client-plan-new
```

Les valeurs ci-dessus sont fictives. L’ordre des arguments est strict. Les identifiants SQL d’exécution et la confirmation `JESSIEMESSAGE_APPLICATION_DATABASE` sont requis ; **aucune clé de contenu n’est nécessaire**. Si un stockage média est configuré, son chemin est protégé contre l’écriture du rapport. Le diagnostic ne lit, ne déchiffre et ne supprime aucun fichier source.

Il produit `deletion-plan.json` et, après validation de la transaction et fermeture du pool, `COMPLETE.json`. Les protections du writer restent celles de 0.17b : création exclusive, modes `0700`/`0600`, contrôle des chemins et identités, budget et hashes, fermeture/synchronisation avant succès. Un échec laisse un dossier privé incomplet ; relancer dans un nouveau répertoire. Ces fichiers ne vont ni dans Git ni dans les artefacts publics.

**`status: complete` sur la console signifie « diagnostic écrit ».** Le rapport porte toujours `simulationOnly: true`, `executable: false` et `retentionDecided: false`. Il ne contient aucune commande SQL, liste de personnes ou de fichiers à effacer, estimation de capacité récupérée ou autorisation de purge. La console ne contient que le type d’opération et les compteurs.

## Lecture du rapport

Dans le rapport historique 0.17c, les 27 catégories reprenaient les compteurs de l’inventaire. Les 20 catégories alors rattachables au client ont le traitement `review_subject_rows` ; les cinq catégories administrateur et les deux catégories globales restent `preserve_shared`, compteur `null`. `affectedCategories` compte les catégories rattachables dont le compteur est positif ; ce n’est pas un nombre de lignes ou de suppressions approuvées.

`candidateOrder` place les tables enfants avant leurs parents d’après les migrations validées, uniquement parmi les catégories rattachables. Chaque entrée reste `proposedAction: review`, `blocked: true`, même à zéro ligne. Les relations de tables ne remplacent pas une stratégie métier : elles n’autorisent pas à supprimer un destinataire de campagne ou un journal média isolément. Les 36 clés étrangères de cette livraison historique utilisent `RESTRICT` ; aucune cascade ni mise à `NULL` automatique ne résout ces dépendances.

Les **19 observations historiques** ci-dessous étaient lues dans le même instantané `REPEATABLE READ`, en transaction `READ ONLY` :

| Observation | Unité et portée |
| --- | --- |
| `activeSessions` | Sessions non révoquées et non expirées du client ; ne prouve pas la validité des autres contrôles de session |
| `verificationPending`, `verificationSending` | Jobs de vérification du client dans l’état conservé, même si leur échéance a expiré |
| `recoveryPending`, `recoverySending` | Jobs de récupération du client, même limite |
| `broadcastPending`, `broadcastSending` | Destinataires liés simultanément au client et à sa conversation |
| `mediaReserved`, `mediaRegistered`, `mediaCleanupPending`, `mediaReleased` | Objets du journal appartenant au client, par état, y compris les lignes déjà libérées |
| `ownedMediaOutsideConversationLinks` | Liens de messages d’autres conversations vers des médias appartenant au client |
| `ownedMediaCampaignLinks` | Campagnes référençant un média appartenant au client |
| `sharedPeerMediaLinks` | Liens de la conversation vers un média d’autrui également lié dans une autre conversation ; tombstones compris |
| `foreignMessageBindings` | Auteur client hors de sa conversation ou auteur non participant dans sa conversation |
| `foreignReceiptBindings` | Reçu du client hors de sa conversation ou reçu d’un non-participant dans sa conversation |
| `foreignBroadcastBindings` | Client et conversation d’un destinataire incohérents avec la cible |
| `foreignAdministratorSessionState` | État de session administrateur attaché à une session du client |
| `foreignMediaJournalBindings` | Contrôles de référence incohérents entre médias et journal associés au client ; deux contrôles peuvent concerner la même paire |

Chaque observation restitue au plus **10 000**, avec `truncated: true` si au moins 10 001 résultats sont rencontrés. Une troncature signifie une borne inférieure et bloque toute interprétation exhaustive. Les comptes de liens, campagnes et contrôles ne sont pas des nombres distincts d’images. Aucun agrégat de tout l’historique ni contenu chiffré n’est demandé. Les requêtes bornent les résultats retournés ; leur coût d’exécution dépend aussi du volume et du plan SQL.

Les médias de l’administrateur partagés restent préservés. Les références anormales doivent être examinées, sans étendre un futur effacement aux autres clients. L’absence d’anomalie détectée ne vaut pas certification complète du schéma physique, des fichiers, des producteurs ou de toutes les données opaques.

## Blocages et future exécution

La [préparation 0.41](data-privacy-preparation.md) décrit désormais les catégories et copies à prendre en compte, les faits/décisions manquants et la procédure des demandes. Elle conserve intégralement les blocages ci-dessous ; un brouillon de notice, une demande reçue ou un diagnostic écrit ne constitue pas une autorisation ou une preuve d’effacement.

Quatre blocages sont toujours présents : conservation non décidée, exécuteur destructif absent, arrêt externe non vérifié et traitement des sauvegardes à décider. Les observations ajoutent des blocages pour les comptages plafonnés, les travaux en cours ou en attente, le protocole média, les références externes, les données partagées et les rattachements incohérents.

Une campagne conserve une audience chiffrée immuable et son empreinte. Retirer un seul destinataire SQL laisserait cette audience et les compteurs incohérents. Une invitation consommée couple son consommateur et sa date de consommation ; retirer seulement l’identifiant ou la révoquer ensuite viole les contraintes. Un journal média `released` possède encore une clé étrangère vers son propriétaire. Ces cas nécessitent une stratégie explicite ; l’ordre des tables ne suffit pas.

Avant tout futur exécuteur : décider durées, déclencheurs et périmètre ; prévoir un journal durable de progression ; rendre le compte et ses sessions inactifs ; traiter les files sans promettre de rappeler un e-mail déjà émis ; résoudre les audiences partagées ; vérifier les références médias ; effectuer les transitions de stockage et la suppression durable des fichiers avant toute libération de capacité ; contrôler ensuite les dépendances avant le compte. Les accusés SQL incertains doivent arrêter la progression et une reprise doit être idempotente. Ce protocole reste à implémenter et tester ; le diagnostic ne le réalise pas.

## Compatibilité de repli

`inspectRollbackHistory` utilise les migrations et le validateur réel d’historique. Il retourne seulement des compteurs, une raison fixe et `canStart`. Ce booléen signifie **compatibilité de l’historique uniquement**, sans validation du schéma physique, des formats chiffrés, des clés, des flags ou de l’état du service. Aucun historique n’est modifié. Le rapport présente les quatre cas ci-dessous dans `rollback.historyExamples`, étiquetés `synthetic_applied_ledgers_from_migrations` : ce sont des exemples construits à partir des sources validées, pas une inspection d’un candidat de repli ou d’une ancienne base réelle.

| Migrations connues du code | Historique appliqué | Résultat attendu |
| --- | --- | --- |
| 25 | 25 | Historique compatible ; autres vérifications toujours requises |
| 25 | 27 | Refus : la base est en avance sur le code, dès la version 26 |
| 27 | 25 | Refus de démarrage : migrations 26 et 27 manquantes |
| 27 | 27 | Historique compatible ; autres vérifications toujours requises |

Une somme différente, une migration interrompue, un doublon, une lacune ou un ordre invalide bloque aussi le repli. Les tests utilisent les véritables migrations et leurs checksums, avec les deux tailles d’historique. Les versions applicatives 0.16 à 0.19 gardent les mêmes 27 migrations ; cela ne certifie pas que tout ancien code peut reprendre un état plus récent.

Ne jamais supprimer les tables 26/27, effacer le registre ou désactiver les contraintes pour faire accepter un ancien code. Le repli de code sur le même ensemble de migrations nécessite encore les tests de schéma/configuration, les mêmes clés et formats, puis une recette privée. Un changement d’ensemble de migrations exige une copie cohérente compatible avec le code choisi, restaurée sur un clone isolé ; il n’existe pas de migration descendante dans ce dépôt. L’outil de sauvegarde 0.16 exige lui-même les 27 migrations et un journal de capacité initialisé : il ne prépare pas une source à 25 migrations. Revenir à 25 exige une sauvegarde historique compatible déjà disponible et une procédure adaptée, ou un correctif en avant sur 27.

## Exercice de retour arrière sans émission

1. Identifier la révision candidate et l’ensemble cohérent code, SQL, médias, clés et configuration à restaurer. Consigner les données plus récentes qui seraient absentes de cette copie ; une restauration antérieure peut également faire réapparaître des données supprimées depuis. Leur traitement reste une décision explicite.
2. Mettre le service en maintenance et arrêter tous les producteurs ; empêcher leur redémarrage ou leur reconnexion à la source par un dispositif externe vérifié. Pour l’ensemble actuel à 27 migrations, suivre la [procédure 0.16](backup-clone-recovery.md) pour préparer le manifeste signé, copier SQL et médias, conserver la source bloquée en écriture et restaurer vers une autre base et un autre répertoire physique. Les vérifications cryptographiques et la réassociation du stockage restent obligatoires.
3. Contrôler l’historique et les adapters de schéma **sans ouvrir de listener HTTP ni lancer les workers**. Le fait d’ouvrir le serveur avec l’accès client actif démarre les workers e-mail ; un clone pourrait envoyer des jobs copiés vers de vraies adresses. Un simple changement de domaine ne neutralise pas ce risque.
4. Préparer la recette ultérieure dans un environnement privé, réseau sortant neutralisé, SMTP de test contrôlé et diffusion désactivée. Ne pas modifier l’ensemble de sauvegarde conservé pour faciliter ce test. Vérifier disponibilité, accès, sessions, échanges et médias avec un scénario de test maîtrisé.
5. Une bascule réelle nécessite une décision distincte : une seule source autorisée à écrire, environnement final confirmé, contrôles post-bascule et possibilité de revenir à l’ensemble préservé. Ce lot ne bascule aucun service et ne déclenche aucune communication.

Les restaurations externes, leurs durées et l’acceptation Infomaniak restent à éprouver. A03 (conservation/suppression complète) et A17 (repli opérationnel) restent ouverts au-delà de ces outils. Les preuves exactes de CI sont consignées dans la PR du lot. La préparation du parcours d’entrée PWA et de la préproduction peut avancer en parallèle des décisions de conservation.
