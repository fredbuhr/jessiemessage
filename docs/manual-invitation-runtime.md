# Admission manuelle et premier runtime texte — lot 0.26

## État courant

Application 0.24.0. **Étape 0.25 validée ; lot 0.26 en préparation.**
Le service hébergé reste à `d4c1b95`, AUTH seule, tant qu'une activation explicite
et sa recette ne sont pas consignées. Ce document décrit le candidat de travail,
pas une preuve de déploiement ou d'envoi d'e-mail.

Le 16 octobre 2026, le propriétaire a confirmé la copie PC du coffre AUTH,
son SHA-256 conforme et son déchiffrement local. L'export SQL Gzip de 9 575 octets
a été importé dans une base distincte. Les contrôles en lecture ont confirmé
28 tables InnoDB, les empreintes exactes des 27 migrations appliquées, un
administrateur avec MFA et huit codes de secours inutilisés, aucun client et
aucune référence de clé étrangère hors de la copie. Les checksums natifs des
28 tables et les empreintes canoniques de structure correspondent entre source
et copie : 225 colonnes, 156 entrées d'index, 167 CHECK et 55 entrées de clés
étrangères. Aucun démarrage applicatif contre la copie n'a été effectué.

Le périmètre demandé est une messagerie privée pour des invités sélectionnés par
Jess. Le propriétaire indique que leur majorité est vérifiée en amont sur
Stripchat. L'application n'intègre aucun fournisseur KYC, ne reçoit aucune preuve
Stripchat et ne certifie pas avoir vérifié la majorité. Elle enregistre une
**admission manuelle**. La portée juridique de la vérification préalable n'est pas
établie par ce changement de code.

## Un parcours, une politique

1. Jess remet une invitation personnelle à usage unique.
2. L'invité crée son compte et confirme son e-mail.
3. Jess confirme que ce compte correspond à son invité, puis approuve l'accès.
4. Le client accède à sa seule conversation ; expiration et révocation restent
   contrôlées côté serveur à chaque opération.

La politique publique est `manual_invitation`. Un compte doit avoir consommé
exactement une invitation avant l'approbation. Un lien transféré ne donne donc pas
automatiquement accès à la messagerie. Aucun champ `age_assured_at` n'est rempli
par cette décision : une date d'approbation n'est pas une preuve d'âge.

La migration **0028** adapte la contrainte `users_active_client_gates` en une
seule instruction ALTER revue. Les migrations 0001–0027 et leurs empreintes sont
conservées. Après application : **28 migrations et 28 tables au total**, dont le
registre ; l'ALTER ne crée pas de table. Les contrôles et outils comptent les
tables créées indépendamment du nombre de migrations.

Les règles d'accès sont partagées par sessions, chat, médias, CRM et diffusions,
même si ces derniers modules restent désactivés dans le premier runtime.

## Configuration privée minimale

Les fichiers existants `runtime-database.json`, `runtime-auth.json` et
`admin-setup.json` sont conservés. Ni mot de passe administrateur, ni clé MFA,
ni TOTP ou code de secours n'est recréé.

Un seul nouveau fichier propriétaire `0600`, `runtime-messaging.json`, contient :

- format `jessiemessage-runtime-messaging`, version 1 ;
- origine HTTPS copiée depuis le fichier AUTH existant ;
- clés distinctes `mailKey` et `messageKey`, générées une fois à la préparation ;
- `smtpHost`, `smtpPort`, `smtpUser`, `smtpPassword`.

Le profil fixe active AUTH, ACCESS, MAIL_DELIVERY et CHAT. MEDIA, CRM,
CLIENT_RECOVERY et BROADCAST restent désactivés. Le chargeur ne reprend aucune
configuration applicative ambiante et conserve la vérification TLS. Les trois
fichiers runtime sont lus sous le même ancrage privé.

Les paramètres SMTP doivent être ceux fournis par l'hébergeur pour la boîte
existante. `contact@jessiemessage.com` reste From, Reply-To et expéditeur
d'enveloppe. Une adresse publique ne prouve pas l'existence de la boîte ou de ses
identifiants ; ne rien inventer et ne pas entrer les secrets dans le chat.

## Ordre opérateur avant activation réelle

1. Conserver la copie indépendante du coffre AUTH et l'export SQL dont la
   restauration isolée est vérifiée. Conserver code, fichiers et réglages actuels.
2. Retenir une révision dont la CI exacte a réussi, l'installer dans un nouveau
   checkout épinglé et contrôler l'arbre. Préserver la release neutre qui fournit
   encore les dépendances partagées ; ne pas la réinstaller.
3. Appliquer uniquement la migration manquante avec le compte de migration
   existant : exécuter `scripts/capture-migration.sh status`, puis la même
   commande avec `upgrade`, après vérification de la base cible répétée dans
   `--database` et `--confirm-database`. Le reçu attendu annonce 28 migrations,
   une appliquée et 27 inchangées. `initialize` reste réservé à une base neuve ;
   `upgrade` exige un préfixe appliqué conforme suivi uniquement de migrations
   en attente. Aucun compte runtime ne reçoit de nouveaux droits de migration.
4. Exécuter personnellement la préparation ci-dessous, puis créer et vérifier un
   nouveau coffre incluant le fichier messaging.
5. Exécuter le contrôle passif du profil et des schémas. Il ne lance ni listener,
   ni worker, ni connexion SMTP et n'envoie aucun message.
6. Préparer la commande épinglée de démarrage et le repli AUTH seule. Une
   activation réelle démarre les workers e-mail : elle nécessite la configuration
   validée et l'autorisation du parcours d'envoi concerné.

Le compte SFTP existant se dépanne séparément. Son refus n'empêche pas les tests
synthétiques ni les corrections locales. Aucun transfert HTTP public du coffre
ou assouplissement des permissions n'est prévu.

### Préparation personnelle des identifiants SMTP

Depuis le checkout vérifié, avec les valeurs non secrètes réellement confirmées :

```bash
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd bash scripts/capture-messaging.sh \
  --private-directory /srv/customer/jessiemessage-private \
  --private-path-mode linux-dirfd \
  --smtp-host HOTE_SMTP_CONFIRME \
  --smtp-port PORT_SMTP_CONFIRME
```

Remplacer les deux paramètres en majuscules par les valeurs confirmées (port 465
ou 587). Le wrapper vérifie les prérequis, puis demande l'identifiant et deux
saisies masquées du mot de passe SMTP. Les valeurs passent uniquement sur stdin,
sans argument, historique ni variable exportée. La préparation refuse de
remplacer un fichier messaging existant. Elle ne teste pas la réception.

### Coffre couvrant les nouvelles clés

```bash
bash scripts/capture-private-secrets.sh \
  --private-directory /srv/customer/jessiemessage-private \
  --output jessiemessage-messaging-DATE_UTC.json.gpg \
  --profile messaging
```

Choisir un nouveau nom horodaté. Le reçu doit annoncer **4 fichiers**, dont
`runtime-messaging.json`, sans révéler de contenu. Le format de coffre v2 reste
un JSON chiffré OpenPGP lisible par un outil GPG standard. Les anciens coffres v1
à trois fichiers restent lisibles et sont conservés. Le nouveau code refuse de
créer un coffre AUTH à trois fichiers si messaging est déjà présent, pour éviter
une nouvelle copie qui omettrait les clés actives. Le coffre ne contient toujours
pas SQL : son téléchargement, SHA-256 et déchiffrement local restent distincts.

### Contrôle passif et commande de lancement

```bash
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node scripts/start-private-messaging.mjs check \
  --private-directory /srv/customer/jessiemessage-private \
  --private-path-mode linux-dirfd
```

Le contrôle vérifie la configuration, l'historique et les schémas nécessaires.
Le même point d'entrée avec `start` lance le serveur et ses workers. Le Manager
doit utiliser un wrapper privé qui épingle révision et arbre attendus ; ne pas
copier une commande flottante vers une branche mobile. La commande AUTH seule
actuellement déployée reste la référence de repli, sous réserve de compatibilité
avec l'historique migré : l'ancien checkout 27 migrations refusera une base passée
à 28. Préparer le repli avec le **nouveau code en mode AUTH seule**, sans
restaurer implicitement une ancienne base.

## Recette bornée

- Invitation consommée et e-mail confirmé, sans approbation : refus du chat.
- Approbation par Jess et `age_assured_at` nul : accès à sa seule conversation.
- Invitation absente, incohérente ou preuve future : refus.
- Révocation ou expiration : refus des nouvelles opérations.
- Un autre client ne lit aucune donnée de la conversation.
- Texte dans les deux sens, rechargement, réponse incertaine sans doublon.
- Préparation/check ne démarrent aucun service et n'émettent aucun e-mail.
- Les données SMTP et les trois clés ne figurent ni dans les reçus ni dans argv.
- Le nouveau coffre couvre les quatre fichiers ; l'ancien reste intact.

Les tests locaux ne remplacent pas la CI MariaDB ni la réception SMTP réelle.
Les nombres exacts et limites sont consignés dans la PR du candidat. Aucune
commande de test destructif ou de recette à base jetable ne doit viser la base
hébergée à conserver.

## Ce lot ne livre pas encore

Photos, CRM, diffusions, récupération client et notifications restent hors du
profil texte. Leur code est conservé pour les lots suivants. Les essais réels
SMTP et mobiles, la restauration des futurs médias et la production limitée
restent à confirmer. Aucun nouveau framework ou service
externe n'est ajouté.
