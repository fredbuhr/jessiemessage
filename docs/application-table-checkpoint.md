# Checkpoint des données applicatives — étape 0.36

Le diagnostic personnel du 17 octobre 2026 à 14:24 Europe/Paris confirme une connexion réussie à la bonne base, `scope: raw_underscore_pattern`, `privilegeProfile: shared_admin`, avec visibilité des objets exécutables non prouvée. Ce résultat explique le refus de l’inspection complète. Aucun mot de passe supplémentaire ni élargissement des droits applicatifs n’est nécessaire pour la voie décrite ici.

## Couverture et limites

Ce profil sauvegarde les **trente tables physiques attendues par les trente migrations**, leur définition et toutes leurs lignes, ainsi que les fichiers photo chiffrés. Il comprend les sessions, invitations, messages, réservations de stockage, abonnements et files de notifications. Les cinq domaines chiffrés sont authentifiés avec les clés privées existantes ; le coffre de secrets et la clé VAPID restent sauvegardés séparément.

Les triggers, événements et routines SQL sont **exclus**. Leur inventaire reste **non prouvé**. Ce n’est pas une sauvegarde intégrale de tous les objets SQL éventuellement invisibles. Cette limite est inscrite dans la couverture fermée du snapshot v2, signée dans le manifeste **v4** au profil `messaging-photos-notify-application`, et reprise dans le reçu **v2**. Les anciens profils refusent ces snapshots. Changer le profil, la version ou la couverture invalide l’authentification ; le mode de récupération refuse aussi les mélanges de snapshots stricts et applicatifs.

Le profil utilise le compte runtime existant dans une seconde façade de lecture des métadonnées, avec son contrôle de privilèges et de namespace conservé à chaque acquisition. Il ne copie pas les privilèges du compte de maintenance et ne demande aucun secret sur stdin. Les trente noms de tables exacts sont passés au client natif après le nom de base ; les listes arbitraires sont refusées. TLS, fichiers temporaires privés et nettoyage sont conservés.

## Commandes

Les trois commandes suivantes prennent uniquement ces trois paramètres :

```sh
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd \
  node scripts/private-checkpoint.mjs check-application \
  --private-directory /srv/customer/jessiemessage-private \
  --private-path-mode linux-dirfd \
  --destination-private-directory /srv/customer/jessiemessage-private/checkpoint-schema30-application-before-domain
```

| Commande | Effet | État attendu |
| --- | --- | --- |
| `check-application` | Configuration, outils et destination, sans connexion SQL ni fichier | `application_precheck_passed` |
| `inspect-application` | Identité runtime, trente tables InnoDB et registre des migrations, sans capture | `application_inspection_verified` |
| `capture-application --offline` | Deux dumps limités, deux manifestes, copie et vérification des photos, reçu et archive | `application_checkpoint_saved` |

Les deux premières commandes fonctionnent pendant que l’application reste en service. La troisième exige une pause réelle de **tous** les serveurs, workers, tâches et outils susceptibles d’écrire. Le programme ne prouve pas lui-même l’arrêt d’un producteur extérieur. `--offline` ne doit jamais être employé pendant leur fonctionnement.

Une destination nouvelle et privée est créée exclusivement ; elle ne doit pas être reprise après un échec. Les archives sont privées, hors du site et du dépôt. Un échec conserve les artefacts incomplets pour diagnostic sans supprimer la source ni les anciennes sauvegardes.

## Vérification et reprise

La cohérence repose sur la pause des producteurs, deux dumps identiques encadrant la copie, deux snapshots identiques, l’authentification des cinq domaines et le contrôle de chaque fichier. Gzip et TAR sont relus entièrement, sans extraction : noms, types, tailles, CRC et empreintes. Le manifeste brut est lié au reçu. La réussite conserve `completeDatabase: false` dans la couverture, `independentCopyPending: true`, `sqlRestorePending: true` et `capacityRebound: false`.

Reprendre ensuite le runtime **0.33 `f2677249`**, avec son lanceur existant, et vérifier préflight, santé, disponibilité et routage. Aucun changement de code actif, de clés, de droits SQL ou de domaine n’est requis pour ce checkpoint.

La copie indépendante de l’archive et l’import des trente tables dans une **nouvelle base isolée** restent des opérations distinctes. Le contrôle `verify-private-checkpoint.mjs check-application|verify-application` exige le reçu v2, le manifeste v4 et leur couverture authentifiée identique. Il vérifie le dump du clone avant et après les contrôles en lecture seule, les trente tables et migrations, TLS, les données chiffrées et les médias. Il ne démarre aucun serveur, transport ni worker et ne réassocie pas le stockage. Le mot de passe du compte de copie reste saisi masqué dans la console personnelle ; ne jamais le transmettre dans la conversation.

Ce contrôle établit la correspondance des tables restaurées et des fichiers au checkpoint applicatif. Il ne certifie pas les objets SQL exclus. La bascule du domaine attend toujours une sauvegarde cohérente, sa copie indépendante et une restauration isolée vérifiée.

## Validation du lot

Les tests ciblés couvrent les formats signés distincts, les rétrogradations, les listes natives exactes, les identifiants runtime gardés, l’absence de saisie, les refus avant dump et les couvertures concordantes. La suite SQL ajoute une comparaison avec le snapshot strict, un trigger volontairement exclu du seul profil applicatif, et une vérification/restauration du clone sans mutation de la source. La capture réelle et les résultats CI/hébergés seront consignés après leur exécution.
