# Préparation du pilote texte — étape 0.27

## État courant au 16 octobre 2026

Application **0.24.0**. Les étapes **0.25 et 0.26 sont validées en recette**.
Le propriétaire a confirmé le premier échange client/administrateur et sa
conservation après actualisation des deux vues à **15:22 Europe/Paris**. Le
[parcours d'admission et son runtime](manual-invitation-runtime.md) restent la
référence pour cette acceptation.

**L'étape 0.27 est validée en recette.** Le contenu texte de la source est vérifié et un
nouvel export SQL a été créé. Le propriétaire a confirmé **« SQL importé,
téléphone OK » à 16:40 Europe/Paris** après le lot de transfert privé, import
isolé et parcours mobile. Le Manager présente une copie non vide de **1,57 Mo**.
À **17:08 Europe/Paris**, le propriétaire a fourni le reçu **`status: verified`**
du contrôle épinglé : la copie correspond à l'export figé et les données
chiffrées sont lisibles. Le pilote élargi et la mise en production ne sont pas
déclarés ouverts.

Le runtime de recette conserve la révision épinglée `14a43104` et le minimum
client de huit caractères. Le profil active authentification, invitations,
vérification e-mail et chat texte. Photos, CRM, récupération du mot de passe
client et diffusions restent désactivés. Aucune clé MFA, e-mail ou message n'a
été renouvelée pour cette étape ; le coffre messaging existant reste à
conserver avec sa phrase secrète séparée.

## Vérification cryptographique du contenu texte

La révision opérateur épinglée **`25670d54`** a été contrôlée avant son emploi
sur l'hébergement. Son export `verifyTextBackupData` réutilise le lecteur SQL
et les fonctions cryptographiques existants avec les trois vraies clés MFA,
e-mail et messages. Il effectue uniquement des lectures, sans démarrer de
serveur HTTP, de transport SMTP ou de worker.

Le contrôle de la source a donné **`complete: true`, `healthy: true`** :

| Enregistrements chiffrés contrôlés | Nombre |
| --- | ---: |
| MFA administrateur | 1 |
| Payload de vérification e-mail conservé | 1 |
| Messages texte | 2 |
| Total | 4 |

Les compteurs des autres domaines sont à zéro. Les douze tables des domaines
désactivés ont été contrôlées avec des lectures `EXISTS` bornées : récupération,
CRM, diffusions et médias, y compris les métadonnées de médias supprimés, les
réservations et l'état de capacité. Une donnée dans ces domaines aurait bloqué
le profil texte. Aucun contenu, adresse, jeton ou secret n'est publié dans le
rapport.

Ces quatre enregistrements ne représentent pas le nombre total de lignes SQL.
La vérification cryptographique ne remplace ni l'export complet, ni les
comparaisons de schéma et de données après restauration. Une clé d'un domaine
vide ne peut pas être attestée par la lecture de son contenu.

## Export SQL et reprise de la recette

Un export complet a été produit avec le client natif **mariadb-dump 10.11.14**,
en mode `--single-transaction`, avec TLS, autorité de certification et nom du
serveur vérifiés. Le fichier Gzip obtenu mesure **11 425 octets** et contient
**28 instructions CREATE TABLE** : les 27 tables applicatives et le registre
des migrations. La migration 0028 est un ALTER ; elle ne crée pas une table
supplémentaire.

Le fichier privé est détenu par le propriétaire attendu et son mode `0600` a
été vérifié. La configuration MariaDB temporaire utilisée pour l'export a été
supprimée. Les clés d'application demeurent dans le coffre distinct. Le
propriétaire a confirmé l'import après le transfert privé demandé ; aucun
fichier SQL ni secret n'a été transmis dans la conversation.

Le runtime texte `14a43104` a été relancé pendant cet exercice. L'export réussi
utilise ensuite une transaction cohérente sur les tables InnoDB, sans nouvelle
interruption du chat. Les **12 contrôles HTTPS après reprise** ont réussi et les fichiers
servis conservent le minimum client attendu de huit caractères. Ce contrôle ne
crée ni session utilisateur ni nouvel échange et ne valide pas l'installation
PWA sur un téléphone.

## Restauration isolée validée

Une nouvelle base de restauration, initialement vérifiée vide, a reçu l'import
du propriétaire. Le Manager relu après son intervention confirme uniquement le
droit de lecture du compte opérateur sur la copie, sans écriture ni
administration. Le compte de l'application n'a aucun droit sur cette copie.

Le sélecteur de fichiers d'import du Manager ne présente pas le volume privé
Node contenant l'export. Le parcours demandé au propriétaire était le
transfert privé SFTP vers son PC puis l'importeur. Son import est confirmé ;
le détail du transfert n'a pas été redécrit. Aucun déplacement du fichier
dans un répertoire HTTP n'a été effectué par l'agent.

Le reçu fourni par le propriétaire provient du vérificateur **`db02bdfe`**,
arbre **`7820a8d567f78a37624cc0c92bf59110965bf33d`**. Il confirme :

| Contrôle de la copie | Résultat |
| --- | --- |
| Archive Gzip de référence | 11 425 octets, empreinte attendue conforme |
| SQL décompressé comparé au dump de la copie | 62 344 octets, même SHA-256 |
| Tables InnoDB et registre | 28 tables, 28 migrations conformes |
| Données chiffrées authentifiées | 1 MFA, 1 payload e-mail, 2 messages |
| Domaines désactivés | Compteurs à zéro |
| Démarrage HTTP / SMTP | `false` / `false` |

Le contrôle authentifie les données avec les trois clés existantes. La
comparaison porte sur l'instantané exporté, indépendamment des messages qui
ont pu être ajoutés à la source pendant la recette mobile. Le reçu est une
preuve fournie par le propriétaire dans sa console ; l'agent n'a pas saisi son
mot de passe SQL. Seuls les résultats neutres sont retranscrits ici.

Le contrôle opérateur `scripts/capture-text-clone-verification.sh` demande le
mot de passe existant par saisie masquée. Il réutilise la configuration privée,
le client MariaDB natif et le vérificateur texte existants. La cible et sa
confirmation doivent désigner une autre base que la source, avec un autre
utilisateur que celui du runtime. Le compte opérateur doit disposer uniquement
de la lecture sur cette copie ; aucun changement de mot de passe n'est requis.

Avant la saisie, le mode `check` contrôle le fichier privé, son empreinte Gzip
attendue et la version du client sans connexion SQL. Le mode `verify` compare
le SHA-256 et la longueur du SQL décompressé avec un dump natif de la copie,
produit avec les mêmes options, sans normalisation du contenu. Une différence
interrompt le contrôle et n'est pas assimilée à une restauration saine. Le
registre des 28 migrations, les tables InnoDB et les références locales sont
ensuite contrôlés, puis les données chiffrées sont lues dans une transaction
en lecture seule. Aucun serveur HTTP, envoi SMTP ou worker n'est démarré.

La configuration temporaire du client SQL est exclusive, privée et supprimée
avant la fin du contrôle. Le mot de passe n'est placé ni dans les arguments,
ni dans l'environnement des processus enfants, ni dans le rapport. Le reçu
ne publie que des empreintes, compteurs et états neutres. Une comparaison
octet pour octet peut refuser une copie dont l'ordre physique diffère ; elle
ne justifie ni une réimportation automatique, ni l'abandon d'un écart.

## Repli, observation et périmètre de recette

Le runtime texte demeure épinglé à **`14a43104`**. Le repli AUTH seul de la
même révision est présent en fichier privé propriétaire `0700`. Sa
configuration et son accès SQL ont déjà été validés avec un listener inactif ;
ce constat ne constitue pas un basculement réel vers ce repli. L'ancienne
version texte antérieure au minimum de huit caractères n'est pas un repli
compatible avec les nouveaux identifiants de 8 à 13 caractères.

Après le reçu, un contrôle ponctuel sur l'hébergement confirme **zéro fichier
client SQL temporaire**, l'archive SQL et le coffre GPG inchangés, ainsi que
**200** sur `/api/health` et `/api/ready`. Les douze contrôles HTTPS après le
redémarrage précédent et le parcours téléphone du propriétaire complètent
cette observation ; cela ne mesure pas une disponibilité continue.

Le périmètre maintenu est la recette actuelle avec Jess et les comptes déjà
créés pour l'exercice. Ce lot n'élargit pas le public invité et ne vaut pas
ouverture de production. Les conditions générales d'ouverture ci-dessous
restent distinctes de la validation technique du présent lot.

## Preuves automatisées et critères restants

La CI de la révision **`25670d54`** confirme :

| Contrôle | Résultat |
| --- | --- |
| Suite générale | 1 698 tests : 1 673 réussis, 25 ignorés, aucun échec |
| MariaDB 10.11 et 11.4 | 333 tests réussis sur chaque version |
| Recette Chrome de l'interface | 3 scénarios réussis |
| Recette Chrome HTTPS/MariaDB administrateur | 1 scénario réussi |

Ces preuves synthétiques restent distinctes des contrôles réalisés sur
l'hébergement et de la confirmation du propriétaire.

Le nouveau contrôleur de copie ajoute **11 tests ciblés** : séparation de la
source et de la cible, refus des configurations ambiantes, fichier Gzip privé,
absence de secret dans les arguments et l'environnement du dump, suppression
du temporaire après échec et annulation, refus d'un SQL différent avant la
connexion cryptographique, vraies clés et liaisons altérées, fin de transaction
et nettoyage, schéma et historique divergents. Ces 11 tests et les 26 tests
cryptographiques existants passent localement, sans échec ni test ignoré ; les
contrôles de syntaxe Node et Bash passent aussi. Cela ne remplace pas le reçu
de vérification de la copie réelle, désormais fourni par le propriétaire.

La CI exacte de **`db02bdfe451b46ea1739c9719a8fd975fc1708db`** passe aussi
ses cinq jobs : **1 709 tests généraux, 1 684 réussis, 25 ignorés**, MariaDB
10.11 et 11.4, Chrome chat et Chrome HTTPS/administrateur. Le premier job Chrome
HTTPS de la PR avait expiré lors de la création de session WebDriver, avant le
scénario applicatif ; sa relance ciblée réussit à la deuxième tentative.
Preuves : [push](https://github.com/fredbuhr/jessiemessage/actions/runs/38919754414)
et [PR](https://github.com/fredbuhr/jessiemessage/actions/runs/38919761110).

- [x] Import isolé déclaré par le propriétaire après le lot demandé, qui
  comprenait le transfert privé sur PC. Sa confirmation ne contient pas de
  nouveau reçu de hachage sur PC ; le contrôle suivant établit la concordance
  intégrale du SQL restauré avec l'archive attendue.
- [x] Structure et contenu de la copie conformes à l'export figé ; contrôle
  cryptographique texte sain, reçu propriétaire `status: verified` à 17:08.
- [x] Parcours groupé sur téléphone confirmé par le propriétaire. Le lot
  demandé associait le client mobile à l'administrateur sur ordinateur :
  lancement depuis l'icône si
  proposé, clavier/orientation/défilement, réponse reçue sans actualisation,
  coupure réseau et reprise du même envoi sans doublon, verrouillage/retour,
  déconnexion et réouverture sans ancien contenu. Révision active `14a43104`,
  résultat déclaré « téléphone OK » ; appareil et navigateur non précisés.
  Cette confirmation ne constitue pas une certification de toutes les
  plateformes. L'invitation et l'e-mail déjà validés ne sont pas à refaire.
- [x] Point de repli, observation ponctuelle du service et périmètre actuel de
  recette consignés ci-dessus. Le pilote élargi n'est pas ouvert.

Les points d'ouverture déjà consignés dans la [recette générale](preproduction-acceptance.md)
restent ouverts, notamment les choix de conservation, le parcours de suppression
et les informations du service. Les fonctions hors du profil texte restent
dans le périmètre de la version complète.

La prochaine étape **0.28 — photos privées** réemploiera les modules médias,
Sharp, les autorisations, la galerie et les quotas déjà présents. Elle doit
étendre le profil privé et sa sauvegarde avec une vraie clé média et un
stockage persistant privé, puis valider ensemble échange, galerie et
restauration des fichiers. Récupération client, CRM et diffusions restent au
périmètre de la version complète.

**Étape finale : 0.27 validée en recette — texte, restauration isolée et
téléphone acceptés ; prochain lot 0.28, photos privées. Production non ouverte.**
