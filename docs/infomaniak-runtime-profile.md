# Exécution adaptée à Infomaniak — étape 0.25

Le propriétaire a demandé une solution fondée sur les documentations, **sans contacter le support**. Les [27 migrations hébergées](hosted-database-preparation.md) restent validées. L’application demeure en **0.24.0**, le serveur neutre à `55fb30aa`, huit fonctions privées désactivées. Deux choix indépendants et explicites lèvent les incompatibilités de notre préparation : profil de privilèges SQL et accès privés Linux par descripteur. Les modes stricts restent les défauts.

## Droits de l’offre mutualisée

La [FAQ officielle 1981](https://www.infomaniak.com/fr/support/faq/1981/gerer-les-utilisateurs-et-bases-de-donnees-mysqlmariadb) décrit le profil lecture + écriture : SELECT/INSERT/UPDATE/DELETE, création de tables temporaires et `LOCK TABLES`. Ces droits ne permettent pas les opérations d’administration sur les tables permanentes. Le compte HTTP doit être distinct du migrateur, limité à la seule base JessieMessage et ne recevoir aucun profil administration.

Le diagnostic peut sélectionner :

```sh
JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE=infomaniak-shared
```

Ce profil n’accepte que les six droits ci-dessus sur un motif désignant exactement la base confirmée, plus USAGE global. Au niveau base, les underscores doivent être échappés ; aucun `%`, underscore non échappé, autre base, rôle, PROXY, droit administratif ou délégation n’est accepté. Les limitations de ressources reconnues sur USAGE ne sont pas une permission supplémentaire. La [FAQ 471](https://www.infomaniak.com/fr/support/faq/471/comprendre-les-limites-de-connexions-simultanees-a-mysql-mariadb) décrit la limite de connexions de l’offre ; le code ne la modifie pas.

La contrepartie est explicite : **ce compte peut écrire dans `schema_migrations`**. Son observation indique `ledgerWritable`, `tempTables` et `tableLocks` vrais, `permanentDdl` faux, seulement après validation de SHOW GRANTS ; sinon ces valeurs sont nulles. Ce n’est ni un profil DML seul, ni une garantie de registre immuable. Les vérifications indépendantes des sources, de l’historique et de la structure physique sont conservées. Elles ne rendent pas le registre inviolable contre un accès SQL arbitraire. Les tables temporaires peuvent masquer un nom dans leur propre session et les verrous ont un effet sur la disponibilité. Le profil strict par table reste disponible et continue à refuser cette configuration.

La fixture MariaDB dédiée vérifie les permissions réelles, y compris les écritures possibles du registre avec retour arrière transactionnel, les tables temporaires/verrous et le refus de CREATE/ALTER/DROP/TRUNCATE permanents. Elle n’effectue aucune opération sur l’hébergement. Voir [les règles MariaDB de GRANT](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant) et [la portée du diagnostic](preproduction-preflight.md).

## Accès aux fichiers privés ancrés

Le refus initial provenait d’un ancêtre système modifiable par le groupe, au-dessus de la racine client. La racine client ne s’est pas révélée être un point de montage exact : aucune exception fondée sur cette hypothèse n’est utilisée. La lecture de procfs et une ouverture de répertoire via son descripteur ont en revanche été vérifiées sur l’hébergement.

```sh
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd
```

`server/files/private-directory.mjs` vérifie Linux et le véritable système procfs, puis ouvre chaque composant depuis `/` via le descripteur du parent avec `O_DIRECTORY`, `O_NOFOLLOW` et `O_NONBLOCK`. Les propriétaires restent root ou l’UID courant. L’exception d’écriture de groupe n’accepte que le propriétaire root et le groupe effectif courant ; l’écriture par les autres reste refusée hors parent système sticky. Le répertoire privé final exige exactement **0700**, sans bit setgid ; les fichiers restent **0600** et leur création exclusive conserve les autres protections.

Toutes les opérations privées concernées utilisent ensuite le répertoire ancré. Le [manuel Linux open(2)](https://man7.org/linux/man-pages/man2/open.2.html) décrit la stabilité d’un descripteur de répertoire lors d’un renommage et l’usage de `/proc/self/fd` comme alternative aux appels relatifs à un descripteur. Le helper vérifie les identités physiques et permissions, maintient les ancres pendant les opérations et les ferme explicitement. Il ne se contente pas de désactiver un test d’ancêtres. Un changement du cwd ne détourne pas ces accès.

Ce mode est intégré au bootstrap administrateur, au stockage média (y compris les scans), à la sonde de plateforme, aux exports privés et aux manifestes de sauvegarde. Les exclusions du checkout et des racines protégées, les vérifications d’inodes, les budgets, le chiffrement, les synchronisations et les nettoyages par identité restent en place. Les composants de sauvegarde externes et leur restauration complète restent à valider séparément.

Sans procfs, le mode échoue ; il n’existe pas de retour silencieux vers un chemin absolu moins sûr. Les modes inconnus sont refusés. Un même UID malveillant ou root reste hors de cette garantie : ces identités peuvent déjà lire ou modifier les données du processus.

## Préparation et vérification hébergées

Choisir un répertoire privé hors checkout et hors dossier HTTP, dans l’espace client persistant décrit par les procédures Infomaniak, par exemple la [procédure n8n](https://www.infomaniak.com/fr/support/faq/2612/installer-n8n-sur-un-hebergement-infomaniak). Ne pas placer de secret dans les commandes build/start, le dépôt, l’historique ou les rapports. La création d’un répertoire peut hériter du setgid du parent : retirer ce bit uniquement sur le nouveau répertoire appartenant à l’opérateur, pour obtenir 0700. Aucune permission système du fournisseur n’est changée.

Depuis un checkout opérateur au SHA relu et vérifié :

```sh
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd \
  node scripts/preflight.mjs platform --offline \
  --scratch /REPERTOIRE_PRIVE/sonde-neuve
```

Le parent doit déjà être privé ; la sonde crée uniquement un enfant neuf avec des données synthétiques. Elle vérifie les opérations nécessaires puis nettoie ses seuls objets reconnus. Aucun stockage média existant n’est initialisé ou effacé. Le rapport filtré ne constitue pas une preuve de restauration, de conservation après toutes les reconstructions ou d’ouverture du pilote. Les observations hébergées et les résultats CI exacts sont consignés dans la PR.

Les essais Linux réels de renommage/remplacement, concurrence, scans, erreurs et fermeture doivent tourner en CI avec procfs ; leur absence dans la CI Linux est elle-même un échec. Dans le sandbox local sans procfs, les essais réels sont explicitement ignorés et les tests déterministes de politiques restent exécutés.

Il reste à créer le compte runtime par le canal privé, constater ses grants effectifs et fournir ses secrets par un fichier privé ou un canal de saisie masquée vérifié. Ni le compte de migration ni ses identifiants ne deviennent ceux du serveur HTTP. Aucun support n’a été contacté. **contact@jessiemessage.com** demeure l’adresse officielle.
