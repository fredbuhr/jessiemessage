# Diagnostic de préproduction — étape 0.21

Version applicative **0.23.0**, branche `feat/preproduction-preflight`, construite sur le chat accessible #23. L’outil opérateur `npm run preflight` aide à vérifier un environnement avant son premier démarrage privé. Il ne déploie rien, ne crée aucun compte ni schéma et n’ouvre aucun serveur HTTP. **contact@jessiemessage.com** reste l’adresse officielle.

## Trois commandes séparées

Les variables privées sont fournies par l’environnement de l’opérateur ou du processus Node. Aucun fichier de secrets n’est chargé automatiquement et aucune valeur privée n’est incluse dans le rapport. Ne pas mettre de mot de passe ou de clé dans les arguments. Le répertoire d’exécution est le checkout de la révision retenue.

```sh
npm run preflight -- config --offline --origin https://preprod.jessiemessage.com
npm run preflight -- platform --offline
npm run preflight -- platform --offline --scratch /chemin/prive/sonde-jessiemessage-neuve
npm run preflight -- database --offline --database BASE_RECETTE --confirm-database BASE_RECETTE
```

L’origine et les chemins ci-dessus sont des exemples, pas une configuration existante. La base doit correspondre exactement à `JESSIEMESSAGE_DB_NAME` et `JESSIEMESSAGE_APPLICATION_DATABASE`. Le répertoire de sonde doit être **neuf**, sous un parent privé existant, hors du checkout et du stockage média configuré. Le créer et le nettoyer appartient à la commande ; l’opérateur ne doit pas le créer à l’avance.

`--offline` est une déclaration de l’opérateur : arrêter préalablement l’application et les autres producteurs dans l’environnement de recette. L’outil ne vérifie pas cet arrêt. Les commandes configuration/plateforme ne se connectent pas à SQL ou SMTP ; la commande base ouvre explicitement une connexion SQL distante possible, en lecture seule. Aucun e-mail, worker ou traitement métier n’est démarré.

Pour récupérer une unique ligne JSON sans les lignes de lancement de npm, appeler directement `node scripts/preflight.mjs` avec les mêmes arguments. Les rapports peuvent être conservés dans un fichier privé de la recette ; ils ne doivent pas être présentés comme un certificat de publication.

| Commande | Ce qu’elle vérifie | Limites importantes |
| --- | --- | --- |
| `config` | Vrais validateurs de configuration, drapeaux connus, dépendances et distinction des clés actives, syntaxe SQL runtime, TLS requis, origine attendue exacte et port fourni | Cible **authentification seule** : accès client, chat, médias, CRM, récupération, diffusions et livraison e-mail désactivés. Aucun secret ni certificat n’est testé sur des données existantes. `PORT` absent reste non vérifié. |
| `platform` | Node 24 et normalisation/décodage JPEG synthétique avec Sharp, en mémoire | Aucun appel réseau ; sans `--scratch`, le système de fichiers n’est pas sondé. Ce résultat concerne le processus où l’outil est exécuté. |
| `platform --scratch` | Création exclusive privée, fichier 0600, écriture/lecture, synchronisation, publication et renommage de ses propres objets, fermeture et nettoyage | Ne lit pas les médias privés. Ne prouve ni le répertoire média réel ni la persistance après rebuild/redéploiement. Permissions et ancêtres vérifiés ; un opérateur malveillant de même UID ou des montages changés restent hors preuve. |
| `database` | Base réellement sélectionnée, moteur MariaDB compatible, chiffrement de la session, privilèges annoncés, historique/checksums et accès aux projections de colonnes attendues | Aucune tentative d’écriture. Les contraintes physiques complètes, la bonne clé des contenus, l’isolation exclusive du compte et la restauration restent à vérifier. |

La commande `config` exige un sous-domaine HTTPS de `jessiemessage.com`, distinct du domaine principal et de `www`, identique à `JESSIEMESSAGE_SITE_ORIGIN`. Cette correspondance ne prouve pas qu’il s’agit d’une préproduction : l’opérateur doit confirmer le domaine et l’isolation réels. Ce lot prépare la première phase avec authentification seule ; une configuration complète de messagerie sera refusée par cette cible même si ses validateurs individuels réussissent.

## Lire le résultat

Le format `jessiemessage-preflight`, version 1, contient seulement la commande, la cible fixe, les noms des contrôles et leurs états. Chaque champ est reconstruit par une liste autorisée : aucun retour complet de validateur, grant, version SQL brute, erreur native, URL privée, chemin, identifiant de base, utilisateur ou secret n’est sérialisé.

| État / code de sortie | Sens |
| --- | --- |
| `checks_passed` / `0` | Tous les contrôles de cette commande ont réussi ou sont désactivés selon leur portée |
| `blocked` / `1` | Un contrôle ou l’opération a échoué ; ne pas déduire la cause d’une donnée absente |
| `PREFLIGHT_USAGE` / `2` | Commande ou confirmation incorrecte ; aucun inspecteur n’est lancé |
| `incomplete` / `3` | Aucun échec, mais au moins un contrôle n’a pas été exécuté, par exemple sonde sans répertoire ou port inconnu |

Chaque rapport conserve toujours `launchApproved: false` et `operatorOfflineVerified: false`. `remainingChecks` rappelle les preuves manuelles encore nécessaires. Un contrôle `disabled` signifie que la fonction concernée n’est pas activée ; `not_checked` ne constitue pas une réussite.

Les erreurs de bibliothèques sont remplacées par des codes fixes. Le CLI possède un dernier délai de 60 secondes : une opération native ou une fermeture bloquée produit `PREFLIGHT_TIMEOUT` puis un échec. Ce délai est propre au processus CLI, pas une promesse pour les modules importés comme bibliothèque. Une interruption forcée ou un timeout ne certifie pas le nettoyage ; seul le répertoire neuf de données synthétiques peut rester à examiner. Ne jamais effacer récursivement le stockage média pour corriger ce résultat.

## Portée SQL et fichiers

Le diagnostic SQL confirme le nom avant de créer le pool, puis contrôle `DATABASE()` sur la connexion. Il utilise une transaction `READ ONLY`, des requêtes fixes et bornées, puis attend rollback, restitution et fermeture du pool avant le résultat. Il n’appelle pas les migrations, leurs verrous, les `assertSchema` de démarrage ni les services applicatifs. Le réglage de fuseau du pool runtime et les limites de requêtes restent des réglages de session, sans mutation des lignes.

Le contrôle des grants exige SELECT/INSERT/UPDATE/DELETE explicitement sur chacune des 27 tables applicatives et SELECT seul sur `schema_migrations`. Il refuse toute écriture annoncée sur ce registre, les autres bases/tables, les scopes `base.*` même en lecture, les droits globaux hors USAGE, le DDL, les rôles et délégations non reconnus. Un scope large pourrait inclure le registre et des objets inconnus ou futurs ; il ne remplace pas les grants par table. Pour ces grants par table, les underscores du nom de base restent littéraux et les séquences avec antislash ne sont pas normalisées comme des motifs de portée base. Un compte SELECT seul échoue aux droits runtime requis par ce diagnostic générique ; ces exigences ne sont pas le minimum métier de l’authentification seule.

Cette lecture de `SHOW GRANTS FOR CURRENT_USER` ne certifie toujours pas tous les droits effectifs ni l’isolation de l’hébergement. MariaDB peut résoudre des droits à partir d’autres entrées du même nom utilisateur et de motifs hôte différents : consulter les [règles officielles de correspondance des comptes](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant#account-name-matching-for-privilege-checks). Une revue par l’administrateur de la base reste nécessaire. La CI dédiée vérifie séparément des opérations DML autorisées sur une table synthétique et le refus réel des trois écritures sur le registre ; le diagnostic opérateur reste en lecture seule.

Une connexion locale explicitement non chiffrée peut servir aux fixtures jetables de CI, mais son contrôle TLS reste en échec. Un historique concordant et des projections de colonnes accessibles ne prouvent pas toutes les contraintes du schéma physique. Le vrai démarrage conserve ses contrôles existants. Une CA privée, si fournie, doit désigner un fichier régulier de taille bornée avant la connexion ; le diagnostic n’en affiche ni le chemin ni le contenu.

La sonde de fichiers ne supprime que les objets qu’elle a créés et dont elle reconnaît l’identité. Un objet étranger ou remplacé n’est pas effacé : le contrôle échoue et le nettoyage non récursif peut laisser le répertoire. Elle ne répare, n’initialise et n’inventorie aucun fichier média existant.

## Enchaînement de la recette

1. Retenir le SHA exact, vérifier les cinq jobs CI et les conditions de l’abonnement Node chez Infomaniak selon la [recette de préproduction](preproduction-acceptance.md).
2. Réserver le sous-domaine, la base jetable, les clés et les répertoires isolés ; garder les sorties e-mail et toutes les fonctions client désactivées. Ne copier aucune donnée ou clé de production.
3. Installer les dépendances verrouillées, préparer la configuration **authentification seule**, puis exécuter les trois diagnostics. Un schéma absent restera en échec : sa création appartient au migrateur déjà documenté, dans la base isolée confirmée.
4. Vérifier séparément les droits effectifs, l’isolation, les permissions et la persistance du stockage, le proxy et le signal d’arrêt. Un rapport sans échec ne remplace aucun de ces essais.
5. Après revue de ces preuves, démarrer explicitement la seule authentification et contrôler l’entrée, les cookies, la connexion administrateur synthétique et l’arrêt propre. Les parcours client/SMTP maîtrisés, restauration, majorité, rétention et appareils suivent leurs phases existantes.

Les tests utilisent uniquement des clés, comptes, bases et images synthétiques. Ils couvrent le refus avant connexion, les erreurs sans fuite, la fermeture réelle des ressources, l’absence de mutation par la sonde, les chemins existants/liens et la préservation d’un fichier étranger. Les résultats exacts du lot sont consignés dans la PR. Aucun accès à l’abonnement Infomaniak ni déploiement n’est réalisé par ce développement.
