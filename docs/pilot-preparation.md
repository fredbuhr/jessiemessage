# Préparation du pilote texte — étape 0.27

## État courant au 16 octobre 2026

Application **0.24.0**. Les étapes **0.25 et 0.26 sont validées en recette**.
Le propriétaire a confirmé le premier échange client/administrateur et sa
conservation après actualisation des deux vues à **15:22 Europe/Paris**. Le
[parcours d'admission et son runtime](manual-invitation-runtime.md) restent la
référence pour cette acceptation.

**L'étape 0.27 est en cours.** Le contenu texte de la source est vérifié et un
nouvel export SQL a été créé. Sa copie indépendante sur le PC, son import dans
une base isolée et la recette groupée sur téléphone restent à terminer. Le
pilote et la mise en production ne sont pas encore déclarés ouverts.

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
supprimée. Les clés d'application demeurent dans le coffre distinct. La copie
indépendante du nouvel export et la preuve de son import restent ouvertes.

Le runtime texte `14a43104` a été relancé pendant cet exercice. L'export réussi
utilise ensuite une transaction cohérente sur les tables InnoDB, sans nouvelle
interruption du chat. Les **12 contrôles HTTPS après reprise** ont réussi et les fichiers
servis conservent le minimum client attendu de huit caractères. Ce contrôle ne
crée ni session utilisateur ni nouvel échange et ne valide pas l'installation
PWA sur un téléphone.

## Restauration isolée : état et prochaine action

Une nouvelle base de restauration a été créée et vérifiée vide. Aucun
utilisateur ni droit applicatif n'y a été affecté et aucun import n'a encore
été réalisé.

Le sélecteur de fichiers d'import du Manager ne présente pas le volume privé
Node contenant l'export. La prochaine action consiste à utiliser un transfert
privé compatible avec l'importeur ou un client MariaDB ciblant explicitement
la copie. Aucun déplacement du fichier dans un répertoire HTTP n'est prévu.

La restauration doit conserver le code et les clés correspondants, les
28 tables, les 28 entrées du registre et leurs empreintes. Les contrôles de la
copie doivent comparer la structure physique et le contenu SQL à l'instantané
exporté, puis exécuter le vérificateur texte avec les mêmes clés. Le traitement
de la copie reste hors serveur HTTP et hors SMTP pour éviter l'émission de jobs
e-mail restaurés.

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

- [ ] Télécharger le nouvel export sur le PC par un canal privé, comparer son
  SHA-256 au reçu de création et conserver une copie indépendante protégée.
- [ ] Importer cet export dans la base isolée, comparer structure et contenu,
  puis obtenir une vérification cryptographique texte complète et saine.
- [ ] Réaliser le parcours groupé avec le client sur téléphone et
  l'administrateur déjà connecté sur ordinateur : lancement depuis l'icône si
  proposé, clavier/orientation/défilement, réponse reçue sans actualisation,
  coupure réseau et reprise du même envoi sans doublon, verrouillage/retour,
  déconnexion et réouverture sans ancien contenu. Consigner appareil,
  navigateur, révision et résultat. L'invitation et l'e-mail déjà validés ne
  sont pas à refaire.
- [ ] Consigner le point de repli, l'observation du service et le périmètre des
  premiers invités avant d'ouvrir le pilote limité.

Les points d'ouverture déjà consignés dans la [recette générale](preproduction-acceptance.md)
restent ouverts, notamment les choix de conservation, le parcours de suppression
et les informations du service. Les fonctions hors du profil texte restent
dans le périmètre de la version complète.

**Étape finale : 0.27 en cours — export texte créé et source vérifiée ; copie
indépendante, restauration isolée et recette téléphone encore attendues.**
