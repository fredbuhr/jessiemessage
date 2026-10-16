# Notifications privées — état de livraison 0.31

## Révision validée

- Runtime candidat : `017cafaf839be37db2973f102766f30cc9373e36`.
- Arbre : `d0a91285a3fba5aa689e65f4f0c5172ed3674255`.
- [PR de revue #42](https://github.com/fredbuhr/jessiemessage/pull/42).
- [CI #237](https://github.com/fredbuhr/jessiemessage/actions/runs/38971623828), cinq jobs réussis le 16 octobre 2026.
- La recette reste en 0.30, sur le schéma à 28 migrations. Aucune activation de notifications ni migration de recette n’est revendiquée ici.
- Le candidat exact est installé dans un dossier séparé de l’hébergement ; `npm ci --ignore-scripts` et les contrôles de syntaxe y réussissent.
- `runtime-notifications.json` a été préparé par le candidat validé, sans modifier les anciennes clés ni démarrer de serveur. Le contrôle du coffre confirme six fichiers et GPG disponible ; la phrase personnelle, le coffre chiffré et sa copie vérifiée restent à effectuer.

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

1. Conserver un checkpoint SQL/photos/secrets cohérent avant toute migration.
2. Préparer puis sauvegarder les nouvelles clés avec le [coffre v4](notification-private-setup.md). La phrase est saisie personnellement dans le terminal masqué ; vérifier ensuite la copie personnelle et son déchiffrement.
3. Appliquer 0029/0030 avec l’identité de migration, puis vérifier le profil `photos-notify` : trente tables et trente migrations attendues.
4. Épingler et démarrer la révision validée, contrôler HTTPS et la disponibilité, puis activer les notifications par choix explicite sur chaque appareil.
5. Valider la réception réelle sur ordinateur, Android et iPhone/iPad, puis les usages simultanés des appareils du foyer.

Après migration, le repli courant utilise ce code compatible avec trente migrations, profil `photos` et notifications désactivées. Le runtime 0.30 exige la restauration coordonnée du checkpoint à 28 migrations ; ne pas supprimer les nouvelles tables pour forcer son démarrage. La production reste fermée.
