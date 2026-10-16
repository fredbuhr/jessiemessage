# Notifications privées — état de livraison 0.31

## Révision validée

- Runtime candidat : `017cafaf839be37db2973f102766f30cc9373e36`.
- Arbre : `d0a91285a3fba5aa689e65f4f0c5172ed3674255`.
- [PR de revue #42](https://github.com/fredbuhr/jessiemessage/pull/42).
- [CI #237](https://github.com/fredbuhr/jessiemessage/actions/runs/38971623828), cinq jobs réussis le 16 octobre 2026.
- La recette reste en 0.30, sur le schéma à 28 migrations. Aucune activation de notifications ni migration de recette n’est revendiquée ici.
- Le candidat exact est installé dans un dossier séparé de l’hébergement ; `npm ci --ignore-scripts` et les contrôles de syntaxe y réussissent.
- `runtime-notifications.json` a été préparé par le candidat validé, sans modifier les anciennes clés ni démarrer de serveur. Le coffre v4 a été créé avec six fichiers ; le propriétaire a confirmé l’empreinte de sa copie locale puis son déchiffrement le 17 octobre 2026.
- Un nouvel instantané SQL/photos a été créé avec la recette arrêtée le 17 octobre 2026 à 00:30:24 Europe/Paris. L’archive a été extraite dans un répertoire distinct et ses octets comparés. La recette 0.30 a ensuite redémarré ; santé et disponibilité HTTPS répondent 200. Ce nouvel instantané n’a pas encore fait l’objet d’un nouvel import SQL isolé.
- Les lanceurs notifications et repli photos de la révision validée sont préparés. La commande de migration épinglée passe sa syntaxe Bash et son contrôle préalable sans connexion SQL. Le mot de passe du compte de migration reste à saisir personnellement ; aucun changement du schéma n’a été effectué.

## Point de restauration avant migration

| Élément | SHA-256 |
| --- | --- |
| Coffre v4 `private-secrets-031-notifications-20261017.json.gpg`, copie locale et déchiffrement confirmés par le propriétaire | `8804e9e5542e96c5bc19927c87ce37ee43a7159a1b0142922c148ff3df51eadb` |
| Archive SQL/photos `jessiemessage-photos-data-20261016T223024Z.tar.gz`, extraite et comparée sur l’hébergement | `6437eff44482d851f775723fd2ac47b1d1edf4cd12ac5b71af97b05f4295dd64` |
| SQL gzip contenu dans cette archive | `a14f93df17adac2c29468ab40a6ed437e36acf51f26b815d792ef46c7b408dbd` |

La copie personnelle du nouvel instantané SQL/photos n’est pas encore confirmée. L’exercice SQL/photos isolé accepté à l’étape 0.28 reste une preuve distincte ; il ne porte pas sur les données ajoutées depuis son ancien instantané. Les scripts existants de capture et de comparaison sont réutilisés, avec leurs limites documentées ; il ne s’agit pas d’une exécution du manifeste signé de la CLI complète.

| Contrôle | Résultat |
| --- | --- |
| Général, Node 24.21.0 | 1 875 cas : 1 849 réussis, 26 intégrations ignorées dans ce job ; aucun échec |
| MariaDB 10.11 | 361 réussis, aucun échec ni test ignoré |
| MariaDB 11.4 | 361 réussis, aucun échec ni test ignoré |
| Chrome, clavier/messages/photos/notifications | 8 scénarios réussis |
| Chrome, HTTPS + authentification + SQL | 1 scénario réussi |
| Local, Node 24.19.0 | 1 875 cas : 1 745 réussis, 130 ignorés faute de capacités SQL/système locales ; aucun échec |

Le build et les contrôles de syntaxe passent. Les nouveaux scénarios Chrome utilisent un vrai DOM et un clic utilisateur fiable, avec Push API simulée : ils ne prouvent pas une livraison réelle par Apple, Mozilla ou Google.

## Comportement livré

L’activation et la désactivation concernent chaque appareil. Les alertes FR/EN restent génériques et ouvrent `/app`. Aucun nom, texte, photo ou identifiant de conversation n’est inclus. Aucun message privé n’est récupéré ou mis en cache par le service worker.

Les abonnements sont chiffrés, limités à seize appareils actifs par compte et liés à un propriétaire, une session d’origine et deux générations. L’expiration habituelle d’une session ne coupe pas le consentement aux notifications. Les révocations explicites, changements d’identifiants/MFA, accès fermé, messages lus ou supprimés sont recontrôlés avant transport. Le worker ne renouvelle aucune session.

Le message et les décisions d’alerte sont enregistrés dans une seule transaction. Texte, photo et nouvelle tentative idempotente sont couverts. Le traitement reste borné : lots de cinq, baux de 90 secondes, six essais, expiration à 24 heures et délai total de transport de 10 secondes. Un envoi réseau peut être répété si son accusé est perdu ; le regroupement réduit les alertes répétées. Une acceptation du fournisseur ne prouve ni affichage ni lecture.

Le coffre v4 couvre six fichiers privés ; le manifeste v3 couvre cinq domaines AES pour les photos et notifications. La restauration vérifie les nouveaux ciphertexts et leurs références hors ligne, sans démarrer de worker. Les jobs terminés sont conservés trente jours puis nettoyés par lots bornés. La limite cumulée existante de 100 000 lignes du vérificateur de sauvegarde reste à surveiller à plus grand volume.

La revue a aussi corrigé la reprise du bouton Conversations après une panne temporaire, une course entre fermeture et réouverture de la confirmation de suppression, l’affichage d’un abonnement lié à une session révoquée, la validation des dates après attente SQL et la propagation des conflits d’abonnement après rollback.

## Passage en recette restant

1. Conserver le checkpoint SQL/photos créé hors ligne et le coffre v4 vérifié. La commande opérateur répète la capture hors ligne juste avant la migration pour couvrir les éventuels changements depuis le redémarrage.
2. Arrêter la recette depuis le Manager, puis exécuter la commande opérateur préparée avec `--offline`. Le propriétaire saisit le mot de passe SQL existant dans le flux masqué ; il n’est placé ni dans les arguments ni dans un fichier.
3. Le runner existant applique 0029/0030 avec l’identité de migration et ses contrôles de verrou/historique/checksums. Le contrôle du profil `photos-notify` doit ensuite réussir : trente tables et trente migrations attendues. Un échec arrête la commande ; aucune reprise DDL aveugle ni suppression n’est lancée.
4. Épingler et démarrer la révision validée, contrôler HTTPS et la disponibilité, puis activer les notifications par choix explicite sur chaque appareil.
5. Valider la réception réelle sur ordinateur, Android et iPhone/iPad, puis les usages simultanés des appareils du foyer.

Après migration, le repli courant utilise ce code compatible avec trente migrations, profil `photos` et notifications désactivées. Le runtime 0.30 exige la restauration coordonnée du checkpoint à 28 migrations ; ne pas supprimer les nouvelles tables pour forcer son démarrage. La production reste fermée.
