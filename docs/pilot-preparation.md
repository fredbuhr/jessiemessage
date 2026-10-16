# Préparation du pilote texte — étape 0.27

## État courant au 16 octobre 2026

Application **0.24.0**. Les étapes **0.25 et 0.26 sont validées en recette**.
Le propriétaire a confirmé le premier échange client/administrateur et sa
conservation après actualisation des deux vues à **15:22 Europe/Paris**. Le
[parcours d'admission et son runtime](manual-invitation-runtime.md) restent la
référence pour cette acceptation.

**L'étape 0.27 est en cours.** Le contenu texte de la source est vérifié et un
nouvel export SQL a été créé. Le propriétaire a confirmé **« SQL importé,
téléphone OK » à 16:40 Europe/Paris** après le lot de transfert privé, import
isolé et parcours mobile. Le Manager présente une copie non vide de **1,57 Mo**.
La comparaison de cette copie avec l'export figé et son contrôle cryptographique
restent à effectuer. Le pilote et la mise en production ne sont pas encore
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

## Restauration isolée : état et prochaine action

Une nouvelle base de restauration, initialement vérifiée vide, a reçu l'import
du propriétaire. Elle ne possède toujours aucun utilisateur SQL autorisé.
Le compte de l'application reste limité à sa base source.

Le sélecteur de fichiers d'import du Manager ne présente pas le volume privé
Node contenant l'export. Le parcours demandé au propriétaire était le
transfert privé SFTP vers son PC puis l'importeur. Son import est confirmé ;
le détail du transfert n'a pas été redécrit. Aucun déplacement du fichier
dans un répertoire HTTP n'a été effectué par l'agent.

La restauration doit conserver le code et les clés correspondants, les
28 tables, les 28 entrées du registre et leurs empreintes. Les contrôles de la
copie doivent comparer la structure physique et le contenu SQL à l'instantané
exporté, puis exécuter le vérificateur texte avec les mêmes clés. Le traitement
de la copie reste hors serveur HTTP et hors SMTP pour éviter l'émission de jobs
e-mail restaurés.

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
de vérification de la copie réelle.

- [x] Import isolé déclaré par le propriétaire après le lot demandé, qui
  comprenait le transfert privé sur PC. Sa confirmation ne contient pas de
  nouveau reçu SHA-256 ;
  la concordance des données restaurées doit encore être établie.
- [ ] Comparer structure et contenu de la copie à l'export figé, puis obtenir
  une vérification cryptographique texte complète et saine. Les nouveaux
  messages du parcours mobile peuvent avoir modifié la source depuis l'export.
- [x] Parcours groupé sur téléphone confirmé par le propriétaire. Le lot
  demandé associait le client mobile à l'administrateur sur ordinateur :
  lancement depuis l'icône si
  proposé, clavier/orientation/défilement, réponse reçue sans actualisation,
  coupure réseau et reprise du même envoi sans doublon, verrouillage/retour,
  déconnexion et réouverture sans ancien contenu. Révision active `14a43104`,
  résultat déclaré « téléphone OK » ; appareil et navigateur non précisés.
  Cette confirmation ne constitue pas une certification de toutes les
  plateformes. L'invitation et l'e-mail déjà validés ne sont pas à refaire.
- [ ] Consigner le point de repli, l'observation du service et le périmètre des
  premiers invités avant d'ouvrir le pilote limité.

Les points d'ouverture déjà consignés dans la [recette générale](preproduction-acceptance.md)
restent ouverts, notamment les choix de conservation, le parcours de suppression
et les informations du service. Les fonctions hors du profil texte restent
dans le périmètre de la version complète.

**Étape finale : 0.27 en cours — import isolé et téléphone confirmés ; contrôle
de la copie restaurée et conditions du pilote encore à terminer.**
