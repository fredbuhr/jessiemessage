# Lot 0.44 — clé et coffre de configuration primaire des fiches

**État : implémenté, validation CI exacte à confirmer.** Base : préparation 0.43 `fc303295`. Le service hébergé reste 0.42 `ed78b55e`, sans fiches ni diffusions activées. Aucun secret réel n’est généré ou exporté par les tests.

Le lot ajoute `runtime-crm.json` avec trois champs exacts : `version: 1`, l’origine HTTPS et `crmKey`, une clé aléatoire de 32 octets encodée en base64url canonique. La clé doit être différente de chacune des six clés privées déjà présentes : MFA, e-mail, messages, photos, notifications et VAPID privée. Les six fichiers sont lus depuis une même ancre privée et leurs origines sont liées à l’adresse principale.

`scripts/prepare-runtime-crm.mjs` vérifie d’abord les cinq configurations existantes avec le chargeur courant. `check` ne génère et n’écrit rien ; `prepare` publie exclusivement le nouveau fichier en propriétaire `0600`. Un fichier déjà présent, y compris un lien, bloque une nouvelle préparation. Une relecture complète doit retrouver la nouvelle clé et toutes les valeurs précédentes avant un reçu `prepared`. Les octets de génération sont effacés à la sortie et les erreurs restent des codes fixes sans secrets.

Le fichier est une préparation hors ligne. Le lanceur actuel ne le charge pas et reste fermé à un profil CRM. Le lot ne contacte ni SQL, SMTP ou Push, n’applique aucune migration, ne démarre aucun serveur et ne change pas les sessions.

## Nouveau coffre explicite

Le répertoire primaire contient cinq configurations, mais pas le fichier historique `admin-setup.json`. Le profil de coffre **`primary-crm`**, format de secrets version **5**, réunit les six fichiers suivants :

| Fichier | Contenu utile à la reprise |
| --- | --- |
| `runtime-auth.json` | Origine et clé durable MFA |
| `runtime-database.json` | Connexion et identifiants SQL runtime |
| `runtime-messaging.json` | Clés e-mail/messages et réglages SMTP |
| `runtime-media.json` | Clé et paramètres du stockage photo |
| `runtime-notifications.json` | Clé notifications et paire VAPID |
| `runtime-crm.json` | Nouvelle clé de chiffrement des notes privées |

Ce coffre couvre la configuration privée courante. Les anciens coffres avec le fichier initial TOTP et les codes de secours restent à conserver ; ils ne sont ni réécrits ni remplacés implicitement. Les métadonnées du nouveau reçu indiquent explicitement `profile: primary-crm`, six fichiers, `secretsOnly: true` et `databaseBackup: false`. Une nouvelle capture avec un ancien profil refuse d’omettre un fichier CRM déjà préparé. Les versions 1–4 gardent leur sens antérieur ; une archive v5 ne peut pas être relue comme un coffre v4 même si leur nombre de fichiers est identique.

Le contrôle préalable du coffre ne lit que les métadonnées des six fichiers et vérifie GnuPG. La capture valide les contenus et leur cohérence, chiffre en mémoire avec le mécanisme GPG existant, déchiffre pour comparer puis publie un fichier `0600` exclusivement. Aucun fichier JSON déchiffré n’est écrit. La vérification du coffre peut se faire dans un répertoire privé vide ; elle ne renvoie que des métadonnées. Ce n’est pas une restauration de la base, des photos ou d’un compte.

## Commandes préparées

Exécuter depuis le checkout exact validé, sans option Node héritée :

```sh
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node scripts/prepare-runtime-crm.mjs check --private-directory /srv/customer/jessiemessage-private/primary-origin-candidate-4a355851 --private-path-mode linux-dirfd
```

Puis, au moment de préparer le nouveau coffre avant l’activation :

```sh
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node scripts/prepare-runtime-crm.mjs prepare --private-directory /srv/customer/jessiemessage-private/primary-origin-candidate-4a355851 --private-path-mode linux-dirfd
```

Le propriétaire choisit personnellement la phrase dans son terminal SSH, avec saisie masquée. Elle ne doit pas passer dans le chat, les arguments, l’historique ou les journaux :

```sh
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd bash scripts/capture-private-secrets.sh --profile primary-crm --private-directory /srv/customer/jessiemessage-private/primary-origin-candidate-4a355851 --output primary-crm-20261017.json.gpg
```

Le nom est exclusif : conserver tout coffre existant et utiliser un autre nom si nécessaire. Copier ensuite le fichier chiffré hors hébergement, vérifier son empreinte et sa relecture, conserver séparément sa phrase et les coffres historiques. Un reçu serveur `verified: true` ne prouve pas cette copie indépendante.

## Validation et limite avant activation

Sous Node.js 24.19.0, la suite locale compte **2 088 réussites, 153 intégrations ignorées et zéro échec sur 2 241 cas**. Le build et les vérifications syntaxiques passent. Le lot ajoute 21 cas, dont la cohérence des six fichiers, la séparation de clés, la publication exclusive, les permissions/liens, la lecture après écriture, le contrôle GPG sans lecture des sources, la vérification indépendante, la phrase incorrecte et l’intégrité du coffre. Les opérations `procfs` et GPG sont explicitement ignorées localement ; la CI Linux doit les exécuter réellement avant validation.

Avant activation, le [lot suivant](production-readiness-2026-10-17.md) doit ajouter le profil serveur explicite, les assertions physiques des tables CRM déjà présentes au schéma 30 et la capture/restauration SQL/photos avec la clé CRM. Le présent coffre ne couvre que les configurations et ne suffit pas à activer les fiches. Les diffusions restent séparées et désactivées.
