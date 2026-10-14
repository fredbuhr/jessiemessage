# Authentification administrateur — premier lot

Ce lot active, sur configuration explicite, une connexion administrateur avec mot de passe et second facteur TOTP, des codes de secours à usage unique et des sessions révocables conservées dans MariaDB. Le premier code TOTP valide confirme l'inscription de l'application d'authentification. Aucun compte administrateur, mot de passe ou secret n'est fourni par défaut.

La page `/admin/login` conserve l'identité Jessie validée. Après connexion, elle montre l'état réel du compte et permet la déconnexion courante ou de toutes ses sessions. Elle ne constitue pas encore l'interface de messagerie ou le CRM du prototype.

Par défaut, le serveur reste sur sa page publique neutre : les routes d'authentification et d'administration sont désactivées. Ce changement ne publie rien sur Infomaniak, ne modifie pas ZTIKIX et ne crée aucun compte réel automatiquement.

## Configuration privée

Utiliser Node.js 24 et une base MariaDB dédiée à JessieMessage. Les variables sont fournies par la configuration privée du processus ; les scripts ne chargent pas automatiquement de fichier `.env`. Ne jamais placer les valeurs dans le dépôt, un ticket, les journaux, une capture ou un artefact Actions.

| Variable | Valeur attendue |
|---|---|
| `JESSIEMESSAGE_ENABLE_AUTH` | `1` pour activer explicitement ce lot ; absente ou `0` pour le désactiver. Toute autre valeur est refusée. |
| `JESSIEMESSAGE_SITE_ORIGIN` | Origine HTTPS exacte, par exemple `https://jessiemessage.com`, sans barre finale, chemin, identifiants, requête ou fragment. |
| `JESSIEMESSAGE_MFA_KEY` | 32 octets aléatoires cryptographiques encodés en base64url canonique sans padding : exactement 43 caractères. Clé privée de chiffrement des secrets TOTP. |
| `JESSIEMESSAGE_DB_HOST` | Hôte MariaDB explicite. |
| `JESSIEMESSAGE_DB_PORT` | Port facultatif ; `3306` par défaut. |
| `JESSIEMESSAGE_DB_NAME` | Nom exact de la base dédiée. |
| `JESSIEMESSAGE_APPLICATION_DATABASE` | Répétition exacte du nom de cette base, pour confirmer la cible de l'application. |
| `JESSIEMESSAGE_RUNTIME_DB_USER` | Compte MariaDB d'application, distinct du compte de migration. |
| `JESSIEMESSAGE_RUNTIME_DB_PASSWORD` | Mot de passe privé non vide de ce compte. |
| `JESSIEMESSAGE_DB_TLS_CA_PATH` | Chemin local facultatif vers la chaîne CA PEM nécessaire au certificat MariaDB. |
| `JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL` | Seulement `1` et seulement avec `127.0.0.1`, `::1` ou `localhost`, pour une base jetable locale ou CI. |

La connexion MariaDB vérifie le certificat TLS, impose TLS 1.2 au minimum et utilise UTC. Aucune exception pour une base distante en clair ou un certificat non vérifié n'est disponible. Le pool est limité à quatre connexions et les paramètres SQL ne sont pas journalisés.

La clé MFA doit être générée et sauvegardée dans un support privé chiffré, séparé de la base. Sa perte rend les secrets TOTP enregistrés indéchiffrables. Ne jamais reprendre une constante de test ni changer cette clé sans une procédure de rotation préparée : la rotation en service n'est pas implémentée dans ce lot.

### Deux comptes MariaDB distincts

Le compte de migration décrit dans [DATABASE.md](DATABASE.md) dispose uniquement des droits DDL et du registre de migration sur cette base. Ses variables `JESSIEMESSAGE_DB_USER`, `JESSIEMESSAGE_DB_PASSWORD` et `JESSIEMESSAGE_MIGRATION_DATABASE` servent au script de migration, pas au serveur HTTP. Le démarrage HTTP ne lance aucune migration : il vérifie le registre et les structures attendues en lecture seule, puis refuse l'authentification si des migrations manquent, sont interrompues ou divergent du code.

Le compte d'application n'a aucun droit DDL, global, `FILE`, création de base ou gestion d'utilisateurs, aucun droit de modification du registre `schema_migrations` et aucun accès à ZTIKIX. Ces droits couvrent l’administration ; les droits supplémentaires de l’inscription sont décrits dans [invitations-client-access.md](invitations-client-access.md).

| Table | Droits de données |
|---|---|
| `users` | `SELECT`, `INSERT`, `UPDATE` ; initialisation, inscription et récupération contrôlée du hash de mot de passe. |
| `sessions` | `SELECT`, `INSERT`, `UPDATE`. |
| `admin_mfa` | `SELECT`, `INSERT`, `UPDATE`. |
| `admin_recovery_codes` | `SELECT`, `INSERT`, `UPDATE` ; `DELETE` supplémentaire pour le CLI de récupération, à réserver au compte opérateur si possible. |
| `auth_session_state` | `SELECT`, `INSERT`, `UPDATE`. |
| `auth_rate_limits` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` pour éliminer les anciens compteurs. |
| `schema_migrations` | `SELECT` uniquement, pour vérifier l'historique au démarrage ; jamais `INSERT`, `UPDATE` ou `DELETE`. |

Les tables d'invitations et de conversations deviennent nécessaires lorsque l'inscription est activée. `INSERT` sur `users` reste alors nécessaire ; il ne peut être retiré après le bootstrap que si ces inscriptions sont désactivées. Vérifier aussi que le compte peut utiliser le verrou MariaDB `GET_LOCK` : il sérialise les initialisations concurrentes sur la même base. Les possibilités réelles de l'hébergement et de son contrôle des droits restent à vérifier avant intégration.

## Initialisation unique de l'administrateur

Exécuter d'abord les migrations relues avec le compte de migration et la confirmation de base exacte. Les migrations historiques restent immuables ; les nouvelles tables MFA et de session prolongent le schéma existant.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run db:migrate -- status
npm run db:migrate -- up
```

Préparer ensuite la configuration d'application et d'authentification ci-dessus. Créer un répertoire privé **hors de l'intégralité du dépôt**, avec un propriétaire identique à celui du processus et des permissions `0700`. Ses ancêtres ne doivent pas être des liens symboliques ni être accessibles en écriture à un groupe ou à tous. Ni `public/`, ni `design/`, ni `artifacts/`, ni un autre dossier du dépôt ne convient.

Dans ce répertoire, préparer via un éditeur privé un fichier JSON d'entrée `0600` qui contient exactement trois propriétés :

- `email` : adresse ASCII de connexion, sans espace extérieur ; le domaine doit contenir un point. Elle sera canonisée en minuscules. Ce lot ne vérifie pas la propriété de cette boîte mail.
- `pseudonym` : nom affiché de 1 à 64 caractères JavaScript, sans espaces extérieurs ni caractères de contrôle ; normalisé en NFC.
- `password` : 14 à 128 caractères JavaScript, au plus 512 octets UTF-8. Il est conservé exactement, sans suppression d'espaces ni normalisation, puis haché avec scrypt.

Ne pas transmettre ces valeurs comme arguments shell, les saisir dans l'historique ou utiliser un exemple de test. La commande lit le JSON sur l'entrée standard ; la saisie interactive dans le terminal est refusée.

```sh
npm run admin:bootstrap -- --output /chemin/absolu/prive/admin-setup.json < /chemin/absolu/prive/admin-input.json
```

Remplacer les chemins par les deux chemins privés réels. Le fichier de sortie doit être nouveau : aucun fichier existant ou lien symbolique n'est écrasé. Il est créé atomiquement en `0600`, synchronisé avant la transaction MariaDB et contient la clé TOTP, son URI `otpauth://` et huit codes de secours. Il ne contient ni mot de passe, ni hash de mot de passe, ni clé maître MFA. La console n'affiche aucun de ces secrets.

Avant de générer les secrets ou le fichier de sortie, le CLI vérifie en lecture seule l'historique de migration et les structures attendues. Le bootstrap prend ensuite un verrou de base puis crée l'administrateur actif, sa configuration MFA encore non confirmée et les seuls digests des codes de secours dans une transaction. La présence de n'importe quel compte administrateur refuse une nouvelle initialisation ; deux lancements concurrents ne créent pas deux administrateurs. Un échec confirmé supprime uniquement le nouveau fichier appartenant à cette tentative. Si la réponse du `COMMIT` est perdue, `SETUP_UNCERTAIN` conserve le fichier privé : vérifier l'état réel du compte avant toute nouvelle tentative.

Importer le secret ou l'URI dans une application d'authentification compatible TOTP SHA-1, six chiffres, période de 30 secondes. Démarrer le serveur configuré, ouvrir `/admin/login` par l'origine HTTPS prévue et se connecter avec l'adresse, le mot de passe et le code TOTP. Les codes de secours ne sont pas acceptés avant cette première confirmation TOTP.

Après confirmation et sauvegarde privée vérifiée des codes de secours, effacer le fichier d'entrée et le fichier de setup. Leur contenu ne doit jamais aller dans une sauvegarde publique ou un artefact CI. Les sauvegardes privées de la base et de la clé MFA doivent faire l'objet d'une restauration vérifiée avant production.

## Comportement et protections

- Une connexion exige le mot de passe et un TOTP frais, ou un code de secours après confirmation initiale. Un TOTP déjà accepté ne peut pas être rejoué ; sa progression et la création de session sont atomiques. Chaque code de secours est consommé une seule fois sous verrou et ne remplace jamais le mot de passe.
- Le cookie `__Host-jessie_session` est `Secure`, `HttpOnly`, `SameSite=Strict`, avec `Path=/`. Le serveur conserve uniquement un digest du jeton aléatoire. Aucune session ou clé n'est stockée dans `localStorage`.
- Une session expire après huit heures au maximum et après trente minutes sans activité serveur reconnue. L'activité ne prolonge pas l'expiration absolue. Chaque requête protégée vérifie la session, le statut actuel du compte administrateur et la version MFA ; une suspension ou révocation empêche l'accès.
- Les mutations exigent l'origine HTTPS exacte et du JSON. La connexion exige aussi l'en-tête applicatif attendu ; la déconnexion exige le jeton CSRF lié à la session. Les réponses privées utilisent `Cache-Control: no-store` et une politique CSP restrictive.
- Les limites de tentatives sont persistées dans MariaDB : huit par adresse sur quinze minutes, vingt par adresse réseau sur quinze minutes et 120 au niveau global par minute. Les adresses utilisées pour les compteurs sont condensées avec une clé dérivée privée. Les fenêtres âgées de plus de 24 heures sont purgées par lots bornés, au maximum 2 000 toutes les cinq minutes. Le calcul scrypt a une concurrence et une file d'attente bornées. Un redémarrage ne remet pas les compteurs actifs MariaDB à zéro.
- L'adresse réseau vient du socket, jamais directement de `X-Forwarded-For`. Avec un reverse proxy, plusieurs requêtes peuvent donc partager le même quota réseau. Vérifier la topologie d'hébergement avant de prévoir un traitement d'en-têtes transmis par un proxy explicitement fiable.
- Les erreurs HTTP restent génériques : une adresse inconnue ne reçoit pas un diagnostic de compte. Les corps de connexion, tokens, secrets MFA et paramètres SQL ne doivent pas être ajoutés aux journaux de proxy, outils d'observabilité ou diagnostics.

L'exception locale de TLS MariaDB concerne uniquement la liaison à une base de test. Elle n'autorise pas l'authentification par une origine HTTP : le cookie `Secure` et la configuration d'origine HTTPS restent obligatoires. Pour un essai navigateur, disposer d'une terminaison TLS fiable devant Node, sans exposer directement le port HTTP interne sur Internet. Ce point reste à valider dans le Manager Infomaniak.

## Vérification et limites de ce lot

```sh
npm test
npm run build
node --test tests/admin-bootstrap.test.mjs
npm run test:db
```

Les tests unitaires couvrent les primitives, la configuration, les routes et leurs refus, ainsi que le fichier bootstrap, ses permissions, les refus d'écrasement, le nettoyage, la conservation lors d'un commit incertain et la fermeture du pool. Les tests d'intégration couvrent les transactions avec données synthétiques sur des bases MariaDB jetables. `test:db` n'est un résultat de base réel qu'avec `JESSIEMESSAGE_DB_TEST=1`, la configuration de test complète et une base explicitement dédiée aux fixtures ; voir [DATABASE.md](DATABASE.md). Sans cet opt-in, ces tests sont ignorés. Ne pas les lancer contre une base de production.

`/api/health` indique uniquement que le serveur HTTP répond. Il ne prouve ni la disponibilité de MariaDB, ni un compte opérationnel, ni une configuration d'hébergement prête. La suite HTTP ne remplace pas une recette dans un navigateur avec HTTPS, une validation de l'hébergement ou un audit de sécurité externe.

Les invitations, inscriptions, vérification mail et sessions clients restreintes disposent désormais du [lot d'accès 0.5](invitations-client-access.md). Le contrôle de majorité externe, le chat, les médias privés, le CRM complet, les campagnes et Push restent à construire. La récupération du mot de passe administrateur, le renouvellement du TOTP et des codes de secours disposent d'un [CLI privé testé](admin-recovery.md), qui révoque toutes les sessions et impose une nouvelle confirmation TOTP. Aucune route publique de récupération administrateur n'est exposée. La rotation de la clé maître MFA reste distincte et non implémentée ; un code de secours ordinaire ne réinitialise pas le mot de passe.

Aucun chiffrement de bout en bout des futurs messages n'est implémenté. L'authentification administrateur ne remplace pas les contrôles d'accès des conversations, les protections des médias ou les conditions légales, d'âge et d'hébergement décrites dans [SECURITY.md](SECURITY.md). La publication doit attendre la revue de la PR, la recette HTTPS et les étapes restantes du plan d'audit.
