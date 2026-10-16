# Notifications privées — préparation opérateur 0.31

Cette procédure prépare le profil `messaging-photos-notify`. Elle ne constitue
pas une preuve d’activation en recette. Utiliser une révision validée par la CI,
un répertoire privé propriétaire `0700`, hors du dépôt et des répertoires web,
et les quatre configurations déjà utilisées par le profil photos.

Avant les migrations, conserver le dernier checkpoint cohérent : SQL, fichiers
photos chiffrés et coffre de secrets existant. Conserver aussi la révision qui
le lit ; le runtime 0.30 épinglé sur `8f38f66f` attend le registre à 28 migrations.

## 1. Vérifier puis préparer le nouveau fichier

Depuis le dossier de la nouvelle révision, remplacer le chemin ci-dessous par
le répertoire privé existant. Les clés et mots de passe sont lus dans ses
fichiers ; ils ne sont pas passés en arguments ni exportés dans l’environnement.

```bash
export JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd
JM_NOTIFICATIONS_PRIVATE_DIR="/chemin/prive/jessiemessage"
node scripts/prepare-runtime-notifications.mjs check --private-directory "$JM_NOTIFICATIONS_PRIVATE_DIR" --private-path-mode linux-dirfd
node scripts/prepare-runtime-notifications.mjs prepare --private-directory "$JM_NOTIFICATIONS_PRIVATE_DIR" --private-path-mode linux-dirfd
```

`check` confirme les configurations existantes et l’absence du nouveau fichier.
Il ne génère rien. `prepare` génère une clé AES indépendante et une paire VAPID
P-256, publie exclusivement `runtime-notifications.json` en `0600`, puis le relit.
Le sujet VAPID est `mailto:contact@jessiemessage.com`. Les quatre anciens fichiers
restent inchangés. Ces commandes ne migrent pas SQL, ne lancent pas le serveur et
n’émettent aucune notification.

Un fichier déjà présent bloque une nouvelle préparation **avant** génération.
Après une erreur de publication ou de relecture, conserver le fichier éventuel
et le faire vérifier ; ne pas le supprimer pour relancer la génération.
La paire VAPID et la clé AES doivent être conservées entre les redémarrages.

## 2. Créer et vérifier le coffre v4

Choisir un nom de sortie unique, puis utiliser une console SSH interactive :

```bash
JM_NOTIFICATIONS_COFFRE="coffre-notifications-UNIQUE.json.gpg"
node scripts/private-secrets-backup.mjs check --private-directory "$JM_NOTIFICATIONS_PRIVATE_DIR" --profile messaging-photos-notify --output "$JM_NOTIFICATIONS_COFFRE"
bash scripts/capture-private-secrets.sh --private-directory "$JM_NOTIFICATIONS_PRIVATE_DIR" --profile messaging-photos-notify --output "$JM_NOTIFICATIONS_COFFRE"
```

Le propriétaire saisit et confirme personnellement sa phrase dans le terminal
masqué. Le reçu affiche uniquement les métadonnées du coffre chiffré et son
SHA-256. Télécharger ce coffre par SFTP sur l’ordinateur du propriétaire,
comparer son SHA-256 au reçu puis vérifier son déchiffrement avant l’activation.
Ne transmettre ni phrase secrète, ni JSON déchiffré, ni clés dans la discussion.

Le contenu attendu est `version: 4`, `profile: messaging-photos-notify`, avec
exactement ces six fichiers, dans cet ordre :

| Fichier | Rôle |
| --- | --- |
| `runtime-auth.json` | Configuration et clé MFA |
| `admin-setup.json` | Informations de récupération administrateur |
| `runtime-database.json` | Connexion SQL applicative |
| `runtime-messaging.json` | E-mails et messages |
| `runtime-media.json` | Photos privées et quotas |
| `runtime-notifications.json` | Clé des abonnements et paire VAPID |

Le chiffrement du coffre est vérifié par déchiffrement avant sa publication.
Les six sources, leur intégrité, leurs origines et leurs clés sont contrôlées.
Le coffre ne remplace pas la sauvegarde SQL et celle des fichiers photos.

Les anciens coffres v1/v2/v3 restent conservés et lisibles pour leur contexte de
restauration, dans un répertoire isolé sans fichier notifications préparé.
Dans le nouveau contexte, un ancien profil est refusé : il omettrait le sixième
fichier. Ne déplacer ni supprimer les clés actives pour forcer ce contrôle.

## 3. Migrer et vérifier le profil complet

Après vérification du nouveau coffre sur l’ordinateur du propriétaire, appliquer
les migrations `0029_push_subscriptions.sql` et `0030_push_outbox.sql` par la
procédure opérateur existante, avec le compte de migration. Le compte applicatif
garde ses droits actuels. Le registre et le schéma attendus passent à 30 tables
et 30 migrations.

```bash
node scripts/start-private-messaging.mjs check --profile photos-notify --private-directory "$JM_NOTIFICATIONS_PRIVATE_DIR" --private-path-mode linux-dirfd
```

Le résultat doit contenir `checks_passed` et le profil
`messaging-photos-notify`. Ce contrôle lit la configuration privée, vérifie TLS,
droits SQL, schéma physique, stockage photos, capacité et décodeur ; il ne lance
ni listener ni worker. La commande d’exécution du Manager peut ensuite utiliser
la même révision et les mêmes arguments en remplaçant `check` par `start`.

Le lancement active AUTH, ACCESS, MAIL_DELIVERY, CHAT, MEDIA et NOTIFICATIONS.
CRM, récupération client et diffusions restent désactivés. Les permissions de
notification sont ensuite demandées par le navigateur après une action explicite
sur chaque appareil. Sur iPhone/iPad, préparer l’ajout à l’écran d’accueil et
valider le parcours réel ; un démarrage serveur réussi ne prouve pas la livraison.

## Repli et sauvegarde suivante

Pour le repli, conserver cette révision compatible avec les 30 migrations et
utiliser `check` puis `start --profile photos` : les notifications et leur worker
sont désactivés. Conserver le sixième fichier et le coffre v4. Revenir au vieux
code 0.30 demanderait la restauration cohérente du checkpoint à 28 migrations ;
ne pas supprimer les nouvelles tables pour forcer son démarrage.

La sauvegarde SQL/photos après activation utilise `backup.mjs --profile
photos-notify` et son manifeste v3 à cinq domaines AES. Une copie de restauration
reste hors ligne, sans worker, puis fait l’objet du contrôle cryptographique et
de références. Un ancien profil de sauvegarde refuse les tables notifications
non vides pour éviter une omission silencieuse.
