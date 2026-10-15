# Vérification d'e-mail privée

La livraison d'e-mails est désactivée par défaut. Ce lot prépare une file durable chiffrée et un transport SMTP ; aucun e-mail réel n'a été envoyé pendant son développement ou ses tests. Les tests emploient des adresses `example.invalid` et des transports injectés.

## Activation en environnement privé

L'authentification et les inscriptions doivent être activées explicitement avant la livraison par les workers. Appliquer les migrations avec le compte de migration, puis démarrer l'application avec son compte MariaDB distinct, limité aux lectures et aux opérations DML. Le serveur ne crée pas de table au démarrage. Sa vérification de schéma doit réussir avant de lancer le worker. L'outil privé de préparation décrit plus bas est accessible avec l'authentification administrateur, même si les inscriptions sont encore désactivées ; il n'envoie aucun message.

| Variable | Valeur attendue |
| --- | --- |
| `JESSIEMESSAGE_ENABLE_MAIL_DELIVERY` | `1` pour activer, absente ou `0` pour désactiver |
| `JESSIEMESSAGE_SITE_ORIGIN` | Origine HTTPS exacte, sans chemin ni barre finale |
| `JESSIEMESSAGE_MAIL_KEY` | Clé aléatoire privée de 32 octets, encodée en base64url canonique sans `=` (43 caractères) |
| `JESSIEMESSAGE_SMTP_HOST` | Nom du serveur SMTP fourni par l'opérateur |
| `JESSIEMESSAGE_SMTP_PORT` | `465` pour SMTPS, ou `587` pour STARTTLS obligatoire |
| `JESSIEMESSAGE_SMTP_USER` | Identifiant SMTP privé explicite |
| `JESSIEMESSAGE_SMTP_PASSWORD` | Mot de passe SMTP privé explicite |
| `JESSIEMESSAGE_SMTP_FROM` | `contact@jessiemessage.com` par défaut si absente ; une valeur vide est refusée. Seule cette adresse est acceptée sur le domaine officiel et ses sous-domaines |
| `JESSIEMESSAGE_SMTP_TLS_CA_PATH` | Facultatif : chemin privé d'une autorité de certification adaptée |

L'adresse publique du site est **contact@jessiemessage.com**. Les messages de vérification et de récupération l'utilisent comme expéditeur, adresse de réponse (`Reply-To`) et expéditeur d'enveloppe SMTP sur le domaine officiel. Aucune adresse de réponse distincte n'est configurable. Hors des origines officielles, les tests peuvent utiliser un expéditeur fictif explicite, avec la même identité pour ces trois champs. Le transport revérifie cette cohérence même si sa configuration est construite sans passer par les variables d'environnement.

Les secrets et chemins restent dans la configuration privée du serveur, sans Git, artefact CI ni journal. L'adresse publique et le serveur SMTP ne sont pas des secrets. L'adresse par défaut n'active aucun envoi et ne remplit jamais l'identifiant ni le mot de passe SMTP. La clé de mail est distincte de la clé MFA. Une sauvegarde chiffrée de cette clé doit accompagner la sauvegarde MariaDB ; perdre la clé rend les mails encore en file indéchiffrables. Sa rotation exige d'arrêter les deux workers s'ils sont activés, de traiter ou annuler les files de vérification et de récupération existantes, puis de changer la clé. Aucun mode SMTP en clair ni exception aux certificats n'est proposé.

Les conditions du fournisseur SMTP, le droit d'utiliser l'expéditeur, les quotas et la délivrabilité restent à vérifier dans le compte choisi avant activation. Cette implémentation ne vaut pas validation des conditions Infomaniak ni d'un autre fournisseur.

Pour Infomaniak, la documentation officielle indique `mail.infomaniak.com`, le port `587` avec STARTTLS recommandé, ou `465` en TLS implicite. L'authentification utilise l'adresse complète et son mot de passe IMAP/SMTP. Utiliser `contact@jessiemessage.com` comme identifiant seulement après avoir vérifié la boîte et son authentification ; ne pas déduire ces droits d'un simple alias. Le mot de passe du compte Manager ne convient pas. Voir les [paramètres officiels Infomaniak](https://www.infomaniak.com/fr/support/faq/2427/synchroniser-les-e-mails-sur-tous-vos-equipements) et le [guide de préparation](mail-readiness.md).

## Vérifier la connexion sans envoyer

La page administrateur **Préparer le site**, à `/admin/readiness`, affiche les fonctionnalités configurées et les vérifications restantes. Son bouton **Vérifier la connexion e-mail** est disponible seulement si la configuration de mail est activée. Un clic explicite crée un transport distinct de celui des workers et appelle uniquement `verify()`, avec une limite de vingt secondes puis fermeture du transport. L'API exige une session administrateur courante, Origin/CSRF valides, un objet JSON vide et des limites persistantes ; elle revérifie la session après le contrôle réseau.

Ce contrôle ne prend aucun destinataire et n'envoie aucun e-mail. Une réussite concerne la résolution DNS, la connexion, TLS et l'authentification SMTP ; elle ne démontre ni l'acceptation de l'expéditeur ni la réception dans une boîte. Voir la [portée officielle de Nodemailer](https://nodemailer.com/smtp#verifying-the-configuration). Les identifiants et échanges SMTP ne sont pas affichés ni journalisés. Le résultat reste temporaire dans le navigateur et disparaît à la mise en arrière-plan ou à la déconnexion. Aucune connexion SMTP réelle n'a été lancée pendant le développement de ce lot ; sa [CI 0.10](https://github.com/fredbuhr/jessiemessage/actions/runs/38657493833) réussit avec des transports injectés.

## Inscription et consommation

L'inscription et la création du jeton de vérification inscrivent un job dans `mail_outbox` au sein de la même transaction. Le contenu `{email, token}` est chiffré avec AES-256-GCM et lié cryptographiquement à l'identifiant du job. L'adresse n'est pas copiée en clair dans la file. Le jeton n'est conservé qu'en empreinte dans `email_verifications` ; il n'apparaît en clair que dans la mémoire du processus et le message adressé au destinataire. La configuration de l'inscription fixe sa durée de validité (24 heures par défaut dans ce lot).

Le lien utilise `/access#verification=…` : le navigateur ne transmet pas le fragment dans la requête de page. Le client extrait le jeton et le remet ensuite à l'API prévue pour sa consommation. Ce fragment limite sa présence dans les journaux HTTP ; la boîte de réception et les systèmes du fournisseur de messagerie contiennent néanmoins le lien. Il faut traiter le jeton comme un secret personnel temporaire, ne pas le partager et ne jamais le journaliser.

Le message est neutre : il demande uniquement la confirmation d'une adresse sur JessieMessage et ne décrit aucun contenu, client ou conversation. Le `Message-ID` reste identique lors d'une nouvelle tentative du même job.

## Fonctionnement du worker

Chaque batch traite au plus cinq jobs par défaut. Le worker commence immédiatement, puis attend 15 secondes après la fin du batch ; les batches d'une instance ne se chevauchent pas. Depuis 0.13, l'arrêt signale immédiatement tous les producteurs et empêche tout nouvel appel de réservation. Un job réservé mais non émis est restitué par CAS, sans consommer un essai. Si la récupération est activée, deux workers séquentiels peuvent envoyer simultanément via le transport partagé. La grâce de cinq secondes permet aux envois commencés de finir ; la fermeture des sockets les annule ensuite. Le pool attend les opérations et les handlers ; un délai total de quinze secondes fait sortir le CLI en erreur avec résultat incertain. Voir le [contrat d'arrêt 0.13](server-availability.md).

La prise de job verrouille successivement le compte, la vérification puis le job. Elle exige un client encore en attente, dont l'e-mail n'est pas déjà vérifié, et un jeton valide, non consommé et non révoqué. Le worker compare ensuite l'adresse chiffrée avec l'adresse actuelle du compte. Un contenu altéré ou destiné à une ancienne adresse est marqué définitivement en échec sans envoi.

Une location de deux minutes empêche deux workers de prendre simultanément le même job. Un worker interrompu peut être repris à l'expiration de cette location ; une ancienne location ne peut pas valider le travail de son successeur. Les tentatives sont comptées durablement, même après redémarrage. Les erreurs de livraison utilisent des délais de 30, 60, 120, 240, 480, 960 puis 1 920 secondes, au maximum huit tentatives, sans dépasser la validité du jeton. Une vérification consommée ou révoquée et un accès révoqué annulent leurs jobs encore en attente ou en cours.

La livraison est **au moins une fois** : si SMTP accepte le message puis que le processus s'arrête avant l'enregistrement de cette acceptation, une nouvelle tentative peut livrer un doublon. L'identifiant stable peut aider les systèmes destinataires mais ne garantit pas leur déduplication. Une acceptation par le serveur SMTP ne prouve pas que le destinataire a reçu le message dans sa boîte principale ; les rejets tardifs, filtres et courriers indésirables restent possibles. Le seul état autorisant l'accès est la consommation effective du jeton par l'API et les autres validations requises, jamais l'état `sent` du mail.

Le contrôle de validité précède la requête SMTP. Une révocation concurrente après ce contrôle peut laisser partir un message neutre déjà pris en charge ; son jeton révoqué reste inutilisable. Les erreurs conservées sont limitées aux codes fixes `MAIL_DELIVERY_FAILED` et `PAYLOAD_INVALID`, sans réponse SMTP, adresse, mot de passe ni jeton.

## Récupération client optionnelle

`JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY=1` active séparément la récupération du mot de passe client ; elle exige les inscriptions et cette configuration de mail. Les migrations `0021` et `0022` ajoutent `client_password_resets` et `password_reset_outbox`. Le même transport TLS et la même `JESSIEMESSAGE_MAIL_KEY` sont réutilisés, avec une finalité AES-GCM distincte liée au job : un contenu de vérification ne peut pas être déchiffré comme une récupération, ni l'inverse.

La file de récupération possède ses propres jobs, locations, tentatives et worker. Son lien discret utilise `/recover#reset=…`, valable 30 minutes et à usage unique. Une simple ouverture ne consomme rien. Le worker ne peut livrer que pour un client encore éligible dont l'adresse et la version d'identifiants correspondent au challenge. Une révocation après la prise du job peut laisser partir un e-mail dont le lien est déjà inutilisable. La livraison reste au moins une fois ; aucun système ne garantit ici la réception ni la déduplication chez le destinataire.

Réémettre un lien annule les anciens challenges et jobs sans modifier le mot de passe ni les sessions. La consommation réussie change le mot de passe et révoque toutes les sessions client, sans connecter le client ni ouvrir ses droits d'accès. Les administrateurs utilisent toujours leur procédure privée distincte. Voir [configuration, éligibilité et garanties de récupération](client-recovery.md). Les essais 0.9 réussissent dans la [CI 0.9 vérifiée](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255) ; aucun SMTP réel n'a été utilisé.

## Conservation et essais restants

Le worker purge au plus une fois toutes les cinq minutes par instance de store : jusqu'à 1 000 jobs expirés depuis plus de sept jours, puis jusqu'à 1 000 jobs envoyés depuis plus de sept jours. Les deux recherches utilisent des indexes de date distincts. Le premier appel réalise immédiatement cette purge, et les appels concurrents de la même instance partagent son délai. Le contenu chiffré des états terminaux est conservé jusqu'à cette purge. Désactiver la livraison arrête aussi le worker : l'opérateur doit prévoir une purge équivalente pendant les arrêts prolongés. La file de récupération applique la même purge bornée des jobs expirés/envoyés depuis plus de sept jours. Les lignes de `client_password_resets` ne sont pas encore purgées. La purge d'une file ne supprime ni le compte ni l'historique de challenge ; leurs durées de conservation relèvent de la politique globale à finaliser.

Avant des invitations réelles : vérifier le fournisseur, l'expéditeur et les quotas, configurer les authentifications de domaine demandées par le fournisseur, tester sur une boîte maîtrisée en environnement HTTPS privé, vérifier les courriers indésirables et le parcours mobile, et constater qu'un lien consommé, expiré ou révoqué ne peut plus être utilisé. Les essais CI sur MariaDB portent sur les transactions, les locations, la concurrence, les annulations, les retries et les contrôles de destinataire ; ils ne mesurent pas la délivrabilité réelle.
