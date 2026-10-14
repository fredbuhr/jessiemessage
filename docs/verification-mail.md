# Vérification d'e-mail privée

La livraison d'e-mails est désactivée par défaut. Ce lot prépare une file durable chiffrée et un transport SMTP ; aucun e-mail réel n'a été envoyé pendant son développement ou ses tests. Les tests emploient des adresses `example.invalid` et des transports injectés.

## Activation en environnement privé

L'authentification et les inscriptions doivent être activées explicitement avant la livraison. Appliquer les migrations avec le compte de migration, puis démarrer l'application avec son compte MariaDB distinct, limité aux lectures et aux opérations DML. Le serveur ne crée pas de table au démarrage. Sa vérification de schéma doit réussir avant de lancer le worker.

| Variable | Valeur attendue |
| --- | --- |
| `JESSIEMESSAGE_ENABLE_MAIL_DELIVERY` | `1` pour activer, absente ou `0` pour désactiver |
| `JESSIEMESSAGE_SITE_ORIGIN` | Origine HTTPS exacte, sans chemin ni barre finale |
| `JESSIEMESSAGE_MAIL_KEY` | Clé aléatoire privée de 32 octets, encodée en base64url canonique sans `=` (43 caractères) |
| `JESSIEMESSAGE_SMTP_HOST` | Nom du serveur SMTP fourni par l'opérateur |
| `JESSIEMESSAGE_SMTP_PORT` | `465` pour SMTPS, ou `587` pour STARTTLS obligatoire |
| `JESSIEMESSAGE_SMTP_USER` | Identifiant SMTP privé explicite |
| `JESSIEMESSAGE_SMTP_PASSWORD` | Mot de passe SMTP privé explicite |
| `JESSIEMESSAGE_SMTP_FROM` | Adresse d'expédition validée chez le fournisseur |
| `JESSIEMESSAGE_SMTP_TLS_CA_PATH` | Facultatif : chemin privé d'une autorité de certification adaptée |

Ces valeurs restent dans la configuration privée du serveur. Elles ne doivent figurer ni dans Git, ni dans un artefact CI, ni dans les journaux. La clé de mail est distincte de la clé MFA. Une sauvegarde chiffrée de cette clé doit accompagner la sauvegarde MariaDB ; perdre la clé rend les mails encore en file indéchiffrables. Sa rotation exige d'arrêter le worker, de traiter ou annuler la file existante, puis de changer la clé. Aucun mode SMTP en clair ni exception aux certificats n'est proposé.

Les conditions du fournisseur SMTP, le droit d'utiliser l'expéditeur, les quotas et la délivrabilité restent à vérifier dans le compte choisi avant activation. Cette implémentation ne vaut pas validation des conditions Infomaniak ni d'un autre fournisseur.

## Inscription et consommation

L'inscription et la création du jeton de vérification inscrivent un job dans `mail_outbox` au sein de la même transaction. Le contenu `{email, token}` est chiffré avec AES-256-GCM et lié cryptographiquement à l'identifiant du job. L'adresse n'est pas copiée en clair dans la file. Le jeton n'est conservé qu'en empreinte dans `email_verifications` ; il n'apparaît en clair que dans la mémoire du processus et le message adressé au destinataire. La configuration de l'inscription fixe sa durée de validité (24 heures par défaut dans ce lot).

Le lien utilise `/access#verification=…` : le navigateur ne transmet pas le fragment dans la requête de page. Le client extrait le jeton et le remet ensuite à l'API prévue pour sa consommation. Ce fragment limite sa présence dans les journaux HTTP ; la boîte de réception et les systèmes du fournisseur de messagerie contiennent néanmoins le lien. Il faut traiter le jeton comme un secret personnel temporaire, ne pas le partager et ne jamais le journaliser.

Le message est neutre : il demande uniquement la confirmation d'une adresse sur JessieMessage et ne décrit aucun contenu, client ou conversation. Le `Message-ID` reste identique lors d'une nouvelle tentative du même job.

## Fonctionnement du worker

Chaque batch traite au plus cinq jobs par défaut. Le worker commence immédiatement, puis attend 15 secondes après la fin du batch ; les batches d'une instance ne se chevauchent pas. Sa fermeture attend le batch actif et ferme le transport SMTP avant la fermeture du pool MariaDB. Ne pas tuer le processus immédiatement après avoir demandé son arrêt.

La prise de job verrouille successivement le compte, la vérification puis le job. Elle exige un client encore en attente, dont l'e-mail n'est pas déjà vérifié, et un jeton valide, non consommé et non révoqué. Le worker compare ensuite l'adresse chiffrée avec l'adresse actuelle du compte. Un contenu altéré ou destiné à une ancienne adresse est marqué définitivement en échec sans envoi.

Une location de deux minutes empêche deux workers de prendre simultanément le même job. Un worker interrompu peut être repris à l'expiration de cette location ; une ancienne location ne peut pas valider le travail de son successeur. Les tentatives sont comptées durablement, même après redémarrage. Les erreurs de livraison utilisent des délais de 30, 60, 120, 240, 480, 960 puis 1 920 secondes, au maximum huit tentatives, sans dépasser la validité du jeton. Une vérification consommée ou révoquée et un accès révoqué annulent leurs jobs encore en attente ou en cours.

La livraison est **au moins une fois** : si SMTP accepte le message puis que le processus s'arrête avant l'enregistrement de cette acceptation, une nouvelle tentative peut livrer un doublon. L'identifiant stable peut aider les systèmes destinataires mais ne garantit pas leur déduplication. Une acceptation par le serveur SMTP ne prouve pas que le destinataire a reçu le message dans sa boîte principale ; les rejets tardifs, filtres et courriers indésirables restent possibles. Le seul état autorisant l'accès est la consommation effective du jeton par l'API et les autres validations requises, jamais l'état `sent` du mail.

Le contrôle de validité précède la requête SMTP. Une révocation concurrente après ce contrôle peut laisser partir un message neutre déjà pris en charge ; son jeton révoqué reste inutilisable. Les erreurs conservées sont limitées aux codes fixes `MAIL_DELIVERY_FAILED` et `PAYLOAD_INVALID`, sans réponse SMTP, adresse, mot de passe ni jeton.

## Conservation et essais restants

Le worker purge au plus une fois toutes les cinq minutes par instance de store : jusqu'à 1 000 jobs expirés depuis plus de sept jours, puis jusqu'à 1 000 jobs envoyés depuis plus de sept jours. Les deux recherches utilisent des indexes de date distincts. Le premier appel réalise immédiatement cette purge, et les appels concurrents de la même instance partagent son délai. Le contenu chiffré des états terminaux est conservé jusqu'à cette purge. Désactiver la livraison arrête aussi le worker : l'opérateur doit prévoir une purge équivalente pendant les arrêts prolongés. La purge de la file ne supprime ni le compte ni l'historique de vérification ; leurs durées de conservation relèvent de la politique globale à finaliser.

Avant des invitations réelles : vérifier le fournisseur, l'expéditeur et les quotas, configurer les authentifications de domaine demandées par le fournisseur, tester sur une boîte maîtrisée en environnement HTTPS privé, vérifier les courriers indésirables et le parcours mobile, et constater qu'un lien consommé, expiré ou révoqué ne peut plus être utilisé. Les essais CI sur MariaDB portent sur les transactions, les locations, la concurrence, les annulations, les retries et les contrôles de destinataire ; ils ne mesurent pas la délivrabilité réelle.
