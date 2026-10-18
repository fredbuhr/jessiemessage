# Connexion du migrateur par saisie masquée — étape 0.25

Application **0.24.0**, suite de la [préparation SQL hébergée](hosted-database-preparation.md). Le propriétaire a créé le compte de migration dans son navigateur. Le Manager a ensuite confirmé un utilisateur avec lecture, écriture et administration sur la seule base de recette. Le nom complet n’est pas publié. Le formulaire limite à **16 caractères le préfixe et le nom réunis**.

Le propriétaire a exécuté la commande dans sa console privée le 15 octobre 2026. Le rapport enregistré à **17:05:47 UTC (19:05:47 à Paris)**, relu et validé par l’agent, confirme la connexion SQL Node et **27 migrations appliquées sur 27**, transport et moteur vérifiés, historique final conforme. Le checkout opérateur exécuté est `3a52a9e014e5f20a72be3e29521817dc822edb1f`. Le mot de passe réel n’a été ni reçu ni conservé par l’agent. Les huit fonctions privées du serveur restent désactivées ; l’application HTTP reste en 0.24.0 sur `55fb30aa`.

## Secret transmis uniquement en mémoire

`scripts/capture-migration.sh` utilise le `read -r -s` de Bash dans un terminal interactif, puis transmet le mot de passe exact par un pipe à `scripts/migrate-stdin.mjs`. La trace Bash est désactivée avant la saisie et la variable est retirée à la fin. Le mot de passe n’est placé ni dans les arguments, ni dans l’historique shell, ni dans un fichier ou un rapport. Le helper refuse une entrée non interactive. Il ne choisit ni ne change le mot de passe SQL.

Les espaces, guillemets, caractères shell et caractères Unicode sont conservés. La frappe reste visuellement vide. Le programme Node refuse un stdin directement interactif : seul le pipe du helper ou un canal opérateur privé équivalent lui fournit le secret. Il accepte au plus 4096 octets UTF-8 valides, sans NUL ni fin de ligne. Les buffers d’entrée sont nettoyés et la référence de mot de passe de l’environnement temporaire est vidée à la fin ; cela ne garantit pas l’effacement de toutes les copies en mémoire JavaScript.

Seules six variables sont construites dans le processus opérateur : host, port, base, confirmation de base, utilisateur et mot de passe de migration. Elles ne sont pas exportées au serveur HTTP ou à ses workers. Aucune exception TLS ni variable d’activation des services n’est proposée.

La tentative préalable de préparer un emplacement pour des secrets persistants a été refusée par le contrôle existant des ancêtres : un répertoire système appartient à root et a le mode **775**. Cette observation ne démontre pas à elle seule une vulnérabilité du fournisseur. Aucune permission de l’hébergeur ni règle de stockage privé n’a été modifiée. La persistance privée des futurs secrets MFA, médias et autres configurations reste à résoudre séparément ; la saisie en mémoire suffit à cette opération de migration.

## Trois opérations explicites

Exemple depuis un checkout opérateur relu, avec des métadonnées fictives :

```sh
bash scripts/capture-migration.sh status \
  --host sql.example.invalid \
  --database BASE_RECETTE \
  --confirm-database BASE_RECETTE \
  --user COMPTE_MIGRATION
```

Le port facultatif `--port` vaut 3306 par défaut. Le nom de base répété doit correspondre exactement ; toute option inconnue ou tentative de mot de passe en argument est refusée. `status` ne crée aucune table. La connexion du [connecteur existant](DATABASE.md) exige TLS 1.2 au minimum, avec certificat vérifié ; la session doit aussi annoncer un `Ssl_cipher` non vide.

Le statut du migrateur existant contrôle ensuite la base sélectionnée, MariaDB 10.11 au minimum, le verrou nommé et l’historique. Une base sans ledger doit être vide, sans table, vue, routine ou événement étranger. Seuls les états et les nombres sont renvoyés, sans hostname, compte, base, secret ou erreur native.

Pour initialiser explicitement la recette, remplacer `status` par **`initialize`** dans la même commande. Cette opération :

1. vérifie TLS et l’historique avec les mêmes contrôles que `status` ;
2. exige soit un historique entièrement en attente, soit un historique entièrement appliqué et conforme au plan ;
3. délègue les migrations au runner existant si la base est neuve ;
4. relit l’historique complet après l’opération et attend la fermeture de la connexion avant de confirmer.

Un historique partiel, en échec, en cours ou à reprendre est refusé par `initialize` : l’opérateur doit l’examiner. Les migrations immuables, les verrous et le ledger restent ceux du migrateur existant. Une erreur ne déclenche ni suppression, ni rollback DDL automatique, ni nouvelle tentative aveugle. Une base déjà entièrement appliquée est seulement revérifiée.

Pour mettre à jour une base existante après sauvegarde et restauration vérifiées,
remplacer `status` par **`upgrade`**. Cette opération exige un préfixe non vide de
migrations appliquées et conformes, suivi uniquement de migrations en attente.
Elle refuse une base vide, les trous dans l'historique et les états en cours,
en échec ou à reprendre. Le runner existant reprend son verrou et revérifie
l'historique avant toute DDL ; le helper n'écrit pas directement dans le ledger.
Un second contrôle doit confirmer toutes les migrations appliquées avant le
reçu `upgraded`. Une base entièrement à jour est seulement revérifiée, sans DDL.
Pour le lot 0.26, le résultat attendu est 28 migrations, `applied: 1` et
`unchanged: 27`. Le reçu ne prouve pas encore une migration hébergée : celle-ci
reste une opération distincte, avec saisie personnelle du mot de passe SQL.

Résultat réellement enregistré sur l’hébergement après les vingt-sept migrations :

```json
{"status":"prepared","engineVerified":true,"transportVerified":true,"migrations":27,"applied":27,"unchanged":0}
```

Ce résultat porte sur l’opération et l’historique. Il ne certifie pas toutes les contraintes physiques, le compte runtime, la restauration, la durabilité des fichiers ou l’ouverture d’un pilote. Le compte runtime distinct et ses droits fins restent à établir avant l’authentification. Les erreurs CLI utilisent des codes fixes, sans données privées.

## Vérification

Les tests synthétiques couvrent les entrées et leur confidentialité, les confirmations de cible, les décisions de statut/initialisation/mise à jour, le passage 27→28, les historiques partiels ou divergents, le refus d’une session sans chiffrement, les échecs de connexion/application/fermeture et l’absence de données privées dans les sorties. Les opérations SQL déléguées conservent les suites MariaDB existantes. La saisie masquée est également contrôlée dans un pseudo-terminal avec un secret synthétique ; aucun secret réel n’est utilisé en test.

Le script Bash a passé sa vérification de syntaxe ; les deux modules Node sont inclus dans `npm run check`. La CI du SHA exact est consignée dans la PR. Les 17 tests ciblés passent également sur Node 24.15.0 hébergé, depuis la racine du checkout. La preuve de migration hébergée est le rapport vérifié ci-dessus ; elle ne vaut pas validation de publication. **contact@jessiemessage.com** reste l’adresse officielle.
