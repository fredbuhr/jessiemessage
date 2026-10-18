# Invitations et accès clients

Ce lot relie l'administration à de vrais comptes clients MariaDB : invitations à usage unique, inscription, preuve de possession de l'adresse e-mail, session client et décision d'accès. La page administrateur `/admin/login` conserve l'identité Jessie validée et ajoute les invitations et les comptes clients. La page `/access` permet l'inscription, la vérification de l'e-mail, la connexion et le suivi de son propre accès.

Les conversations texte/photo, les diffusions et le CRM disposent de routes privées et d'options séparées ; voir [messagerie](private-messaging.md), [médias](private-media.md), [CRM](private-crm.md) et [diffusions](targeted-broadcasts.md). Le prototype sous `design/` reste distinct de ces fonctions serveur. Aucun compte réel, envoi réel, déploiement ou modification de ZTIKIX n'est effectué par les tests ou par l'ajout de ce code.

## Activation explicite

Les fonctions d'accès restent désactivées par défaut. Pour les activer, fournir dans la configuration privée du processus les trois options `JESSIEMESSAGE_ENABLE_AUTH=1`, `JESSIEMESSAGE_ENABLE_ACCESS=1` et `JESSIEMESSAGE_ENABLE_MAIL_DELIVERY=1`. Une valeur absente ou `0` désactive l'option correspondante ; toute autre valeur est refusée. L'accès clients exige une authentification administrateur et une livraison d'e-mails configurées sur la même origine HTTPS exacte.

L'authentification administrateur seule peut rester active sans le lot d'accès clients. Les invitations et la page `/access` ne deviennent pas disponibles dans ce mode. Une configuration d'accès incohérente doit empêcher son démarrage ; aucune configuration de secours n'ouvre les routes silencieusement.

Préparer d'abord les migrations avec le compte de migration dédié, puis les permissions du compte d'application. Le serveur vérifie le schéma attendu ; il ne lance pas de migration automatiquement. Les migrations historiques déjà publiées ne doivent pas être modifiées.

| Configuration | Référence et portée |
|---|---|
| Origine HTTPS, clé MFA, compte administrateur, sessions administrateur | [auth-admin.md](auth-admin.md). `JESSIEMESSAGE_SITE_ORIGIN` est une origine canonique HTTPS, sans chemin ni barre finale. |
| Récupération administrateur hors ligne | [admin-recovery.md](admin-recovery.md). Aucun formulaire public ne remplace cette procédure. |
| SMTP, vérification TLS, expéditeur, clé indépendante du contenu de la file d'e-mails | [verification-mail.md](verification-mail.md). Fournir une configuration SMTP réelle approuvée pour cet usage ; ne pas reprendre une valeur de test. |
| Cible MariaDB et migrations | [DATABASE.md](DATABASE.md). `JESSIEMESSAGE_APPLICATION_DATABASE` doit répéter exactement `JESSIEMESSAGE_DB_NAME`. |

Les variables sont fournies au processus ; aucun fichier `.env` n'est chargé automatiquement. Les clés, mots de passe et données d'inscription restent hors du dépôt, des tickets, des journaux et des artefacts CI. Les dates serveur et MariaDB utilisent UTC ; l'affichage peut adopter le fuseau du navigateur.

## Parcours et états

1. Un administrateur actif, connecté avec son second facteur confirmé, crée une invitation. Le lien est affiché une seule fois pour être transmis au client.
2. Le client ouvre le lien, choisit son pseudonyme et son mot de passe, renseigne son e-mail et déclare avoir au moins 18 ans. La déclaration est enregistrée séparément de l'assurance d'âge.
3. Dans une transaction, l'inscription consomme l'invitation, crée un compte `pending`, crée une vérification d'e-mail et ajoute son message chiffré à la file de livraison. Un échec annule l'ensemble. Deux inscriptions concurrentes avec le même lien ne créent pas deux comptes.
4. Le client confirme la possession de sa boîte mail en utilisant le lien reçu. Cette confirmation permet une connexion pour suivre l'état de son compte. Elle ne vérifie pas sa majorité et ne donne pas accès à une conversation privée.
5. L'approbation administrateur exige à la fois la preuve d'e-mail et une assurance d'âge enregistrée. Elle active le compte, fixe la durée d'accès et crée sa conversation dans la même transaction.

**Aucun prestataire ou parcours d'assurance d'âge n'est intégré dans ce lot.** La case de déclaration ne remplit jamais `age_assured_at`, et aucune route HTTP ne permet de le remplir. Les vrais clients restent donc en attente, même après confirmation de leur e-mail. L'interface signale cette limite et n'autorise pas une approbation sans les prérequis. Les fixtures synthétiques d'intégration servent à tester ce futur état ; elles ne constituent pas une procédure d'activation de vrais comptes.

| État exposé au client | Comportement |
|---|---|
| `pending` | Après preuve d'e-mail, connexion et lecture de son propre état seulement. L'assurance d'âge et/ou l'accord administrateur manquent. |
| `active` | E-mail vérifié, majorité assurée, approbation enregistrée et durée d'accès non expirée. Les futures routes privées devront exiger cet état. |
| `expired` | Le compte approuvé peut consulter son état, mais les futures opérations privées sont refusées dès la borne d'expiration. |
| Compte suspendu, révoqué ou supprimé | La connexion et les sessions client ne sont plus acceptées. |

`requireActiveClient()` centralise le contrôle du statut actif pour les prochaines fonctions privées. Une session valide de compte en attente ou expiré ne suffit pas à autoriser le chat ou les médias. Chaque future route privée devra appeler ce contrôle et vérifier les droits sur sa conversation ou son média.

## Deux durées indépendantes

La validité du lien d'inscription (`lifetimeHours`) va de **1 à 720 heures**, avec **72 heures** comme valeur proposée. Un lien expiré, révoqué, déjà utilisé ou émis par un administrateur devenu inactif n'autorise pas une nouvelle inscription.

La durée d'accès (`accessDays`) va de **1 à 3 650 jours** ; `null` signifie explicitement sans limite de durée. L'interface propose 30 jours et permet de choisir l'absence de limite. Le compteur commence **à l'approbation du client**, pas à la création, à l'utilisation ou à l'expiration de l'invitation. Une invitation consommée conserve cette décision pour l'approbation ultérieure. À la borne exacte d'expiration de l'accès, le client passe à l'état exposé `expired`.

La révocation d'une invitation concerne un lien non encore utilisé. Révoquer un client est une opération différente : elle modifie son statut, révoque ses sessions et ses vérifications d'e-mail restantes, puis annule les messages de vérification encore en attente. Depuis 0.14, une action distincte prolonge un accès déjà approuvé et limité dans le temps, avec comparaison exacte de son ancienne échéance. Elle ne réactive pas un compte révoqué/suspendu, ne fabrique aucun prérequis et ne transforme pas un accès en durée illimitée. Les listes administratives disposent aussi de pages de 50 lignes par défaut, 100 au maximum, au-delà de l'ancienne limite de 500. Voir [règles et garanties du renouvellement/pagination](access-renewal-pagination.md).

## Jetons, inscription et preuve d'e-mail

Les jetons d'invitation, de session et de vérification sont aléatoires. Leurs colonnes de recherche ne contiennent que des digests ; le jeton de vérification nécessaire au mail est aussi présent dans son contenu chiffré de livraison. Le lien d'invitation a la forme `/access#invitation=…` et le lien de vérification utilise également le fragment. Le fragment n'est pas transmis dans la requête HTTP initiale. La page le lit, l'efface de l'adresse avec `history.replaceState`, puis transmet le jeton à l'API dans un corps JSON. Le lien brut d'invitation n'apparaît jamais dans la liste administrateur et ne peut pas être récupéré ultérieurement depuis la base.

Le pseudonyme comporte 1 à 64 caractères JavaScript, sans espaces extérieurs ni caractères de contrôle ou de format, et est normalisé en NFC. Le mot de passe comporte 8 à 128 caractères JavaScript, au maximum 512 octets UTF-8 ; il est conservé exactement avant hachage scrypt, sans suppression d'espaces ni normalisation. Les adresses e-mail sont validées et canonisées par le même mécanisme que l'authentification administrateur ; ce lot ne prend pas en charge toutes les formes d'adresses internationalisées.

Le jeton de preuve d'e-mail expire après **24 heures** et ne peut être consommé qu'une fois. La confirmation est atomique et révoque les autres preuves encore ouvertes pour ce compte. Elle ne connecte pas automatiquement le client.

La réémission exige l'adresse et le mot de passe du compte en attente, ainsi que les contrôles de fréquence. Elle révoque les anciens jetons, annule leurs messages en attente et crée une nouvelle preuve et un nouveau message dans une transaction. La réponse publique reste `accepted`, qu'une adresse soit inconnue, qu'un mot de passe soit erroné ou qu'une réémission ait réellement été effectuée. Une livraison SMTP déjà acceptée ne peut pas être rappelée ; son ancien lien reste inutilisable après révocation.

Le destinataire et le jeton nécessaires à la livraison sont conservés dans un contenu de file chiffré, lié à l'identifiant du message, avec une clé privée dédiée distincte de la clé MFA. Le détail de livraison, des reprises et des limites SMTP figure dans [verification-mail.md](verification-mail.md). `verification_pending` confirme la transaction d'inscription et la mise en file, pas l'arrivée du mail dans une boîte réelle.

## Sessions client et protections HTTP

Une connexion par mot de passe exige un compte client `pending` ou `active` et une preuve d'e-mail déjà enregistrée. Elle crée une session serveur, distincte de l'administration, avec le cookie `__Host-jessie_client` : `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`. Le cookie administrateur `__Host-jessie_session` n'est pas une session client et inversement. Aucun jeton n'est placé dans `localStorage`.

La durée maximale est de **8 heures**, avec expiration après **30 minutes** sans activité serveur reconnue. L'activité ne prolonge pas l'expiration absolue. Chaque consultation contrôle le rôle, le statut actuel du compte, la preuve d'e-mail, la révocation, la version des identifiants et les bornes de temps. Une modification de version des identifiants invalide les anciennes sessions ; ce mécanisme n'implémente pas à lui seul une récupération de mot de passe client.

Les mutations exigent l'origine HTTPS exacte et du JSON. Les opérations avant connexion exigent `X-Jessie-Request: 1`. Les mutations de session client et les opérations administrateur exigent le jeton `X-CSRF-Token` lié à la bonne session. Les routes administrateur revérifient également le compte, le second facteur et la session persistés dans la transaction de modification ; la présence d'un cookie ou d'un ancien principal HTTP ne suffit pas.

Les réponses privées ne sont pas mises en cache et utilisent la CSP restrictive du serveur. Les réponses d'authentification et de réémission restent génériques. Ne pas journaliser les corps JSON, cookies, liens complets, jetons ou paramètres SQL.

Les quotas des opérations publiques sont conservés dans MariaDB, avec des clés dérivées privées pour les identifiants de compte et de réseau : une limite globale de 60 opérations par minute, une limite de 20 par opération et réseau sur 15 minutes, et des limites par opération et compte ou jeton. Ces dernières sont de 3 inscriptions ou réémissions, 8 connexions ou vérifications et 20 inspections sur 15 minutes. Le calcul du mot de passe possède aussi une concurrence et une file bornées. Un redémarrage ne remet pas les quotas MariaDB actifs à zéro.

L'adresse réseau provient du socket ; `X-Forwarded-For` n'est pas utilisé comme identité fiable. Un reverse proxy peut donc faire partager le quota réseau à plusieurs visiteurs. Sa topologie et le traitement d'un proxy explicitement fiable restent à vérifier avant la recette d'hébergement.

## Routes de ce lot

| Route | Méthode | Accès et effet |
|---|---|---|
| `/access` | `GET`, `HEAD` | Page client, uniquement lorsque le lot est activé. |
| `/api/admin/access` | `GET` | Session administrateur ; indique la configuration e-mail et l'assurance d'âge encore en attente. Ce n'est pas un test de livraison SMTP. |
| `/api/admin/invitations` | `GET`, `POST` | Liste paginée par `cursor` et `limit`, sans jeton brut ; création d'un lien affiché une fois. |
| `/api/admin/invitations/{id}/revoke` | `POST` | Révocation d'une invitation non utilisée. |
| `/api/admin/clients` | `GET` | Liste paginée par `cursor` et `limit` : pseudonyme, e-mail, statut, prérequis et expiration. |
| `/api/admin/clients/{id}/approve` | `POST` | Approbation avec e-mail et assurance d'âge déjà prouvés ; création atomique de conversation. |
| `/api/admin/clients/{id}/revoke` | `POST` | Révocation du compte et de ses accès restants. |
| `/api/admin/clients/{id}/renew` | `POST` | Prolongation d’un accès déjà approuvé et fini : `accessDays` et `expectedExpiresAt` exacts ; conflit sans double prolongation. |
| `/api/access/invitation` | `POST` | Inspection d'un jeton valide, limitée à ses durées. |
| `/api/access/register` | `POST` | Inscription atomique sur invitation, réponse `verification_pending`. |
| `/api/access/verify-email` | `POST` | Consommation d'une preuve de possession de la boîte mail. |
| `/api/access/resend-verification` | `POST` | Réémission après contrôles, réponse générique `accepted`. |
| `/api/access/login` | `POST` | Connexion client après preuve d'e-mail. |
| `/api/access/session` | `GET` | Pseudonyme, rôle, échéance de session et état d'accès du client connecté seulement. |
| `/api/access/logout`, `/api/access/logout-all` | `POST` | Révocation de la session courante ou de toutes les sessions de ce client. |

## Droits MariaDB de l'application

Le compte d'application reste distinct du compte de migration, limité à la base JessieMessage. Il n'a aucun droit DDL, global, `FILE`, création de base, gestion d'utilisateurs ou accès aux données ZTIKIX. Les droits de données nécessaires à l'ensemble authentification, récupération opérateur, accès clients et livraison sont :

| Table | Droits |
|---|---|
| `schema_migrations` | `SELECT` uniquement. |
| `users` | `SELECT`, `INSERT`, `UPDATE`. |
| `sessions` | `SELECT`, `INSERT`, `UPDATE`. |
| `invitations` | `SELECT`, `INSERT`, `UPDATE`. |
| `conversations` | `SELECT`, `INSERT`. |
| `admin_mfa` | `SELECT`, `INSERT`, `UPDATE`. |
| `admin_recovery_codes` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` pour la récupération opérateur hors ligne. |
| `auth_session_state` | `SELECT`, `INSERT`, `UPDATE`. |
| `auth_rate_limits` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` pour la purge bornée des compteurs anciens. |
| `client_auth_state` | `SELECT`, `INSERT`, `UPDATE`. |
| `email_verifications` | `SELECT`, `INSERT`, `UPDATE`. |
| `client_session_state` | `SELECT`, `INSERT`, `UPDATE`. |
| `mail_outbox` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` pour la purge des messages terminés. |

Le droit `DELETE` sur les codes de secours n'est pas utilisé par le serveur HTTP quotidien ; il peut être réservé à un compte opérateur hors ligne distinct pour la récupération. La configuration de cette séparation et les autres droits requis par cette procédure sont décrits dans [admin-recovery.md](admin-recovery.md). Aucun `DELETE` sur les comptes ou conversations n'est nécessaire à ce lot.

## Validation et suite avant pilote

`npm test` vérifie les fonctions et refus HTTP sans données réelles. `npm run test:db` exécute les groupes d'intégration séquentiellement sur une base explicitement jetable et configurée pour les fixtures. Ils couvrent les migrations, l'authentification, la récupération administrateur, les accès clients, la livraison et le parcours HTTP complet avec transport mail simulé. Consulter [DATABASE.md](DATABASE.md) pour les protections de cible et les variables de test ; ces commandes ne doivent jamais viser une base de production. Les nombres exacts de tests figurent dans la CI de la PR concernée.

La réussite avec un transport simulé et des fixtures synthétiques ne valide pas une boîte mail réelle, un navigateur HTTPS, une preuve d'âge ou l'hébergement Infomaniak. `/api/health` reste une preuve de réponse HTTP uniquement.

La [récupération de mot de passe client](client-recovery.md), la messagerie et les médias sont désormais implémentés avec leurs propres contrôles. Avant un pilote réel, il reste à choisir et intégrer un parcours d'assurance d'âge adapté, valider le SMTP et la réception réels, éprouver stockage/sauvegarde/restauration et rétention, effectuer la recette HTTPS sur ordinateur et mobile, puis confirmer l'hébergement et les informations juridiques du service. L'approbation et le renouvellement ne remplacent pas la preuve de majorité. Voir le [bilan et l'ordre de publication](NEXT-STEPS.md).
