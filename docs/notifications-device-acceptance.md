# Notifications 0.31 — essais sur les appareils du foyer

La recette est démarrée avec notifications sur `017cafaf`, schéma 30. Les contrôles CI et HTTPS sont consignés dans le [bilan](message-notifications-release.md). La réception réelle reste à confirmer : un serveur prêt et une acceptation par le fournisseur ne prouvent pas qu’une alerte est affichée.

## Préparer chaque appareil

1. Recharger JessieMessage en conservant le compte déjà utilisé.
2. Ouvrir une conversation, puis **Notifications**. Les mêmes réglages sont aussi disponibles dans **Mon compte**.
3. Choisir **Activer sur cet appareil**, puis autoriser la demande du navigateur. Attendre **Notifications activées sur cet appareil.**
4. Sur iPhone/iPad, ajouter Jessie à l’écran d’accueil depuis Partager, puis ouvrir l’app depuis son icône avant cette activation. Le parcours fournit cette consigne sur les appareils concernés.

Les réglages sont propres à l’appareil et au profil de navigateur. Deux comptes dans deux profils distincts ont chacun leur activation. Le compte client de test et l’administrateur déjà utilisés en recette suffisent ; aucun nouveau compte n’est nécessaire.

## Parcours à confirmer

| Essai | Action | Résultat attendu | État |
| --- | --- | --- | --- |
| Client vers Jessie | Fermer la page Jessie sur l’appareil administrateur ; envoyer depuis le compte client de test. Attendre l’alerte avant d’ouvrir le message. | Alerte **Jessie — Un nouveau message t’attend.**, puis clic vers le bon espace. | À tester |
| Jessie vers client | Fermer la page destinataire client ; envoyer depuis l’administrateur. | Même alerte discrète ; le message apparaît après ouverture. | À tester |
| Photo | Refaire un envoi avec une photo depuis le compte opposé. | L’alerte reste générique ; la photo s’affiche dans la conversation après ouverture. | À tester |
| Plusieurs appareils | Activer le même compte administrateur sur ordinateur et téléphone ; fermer les pages destinataires, envoyer depuis le client et attendre les deux alertes. | Réception sur les deux appareils ; les sessions permettent de reprendre l’espace. | À tester |
| Réglage indépendant | Désactiver sur un seul appareil, laisser l’autre activé, refaire l’envoi. | Le second continue à recevoir ; le premier reste désactivé. Réactiver ensuite si souhaité. | À tester |
| Sessions du foyer | Utiliser simultanément les ordinateurs/téléphones habituels, puis reprendre après fermeture/réouverture. | Les sessions administrateur durables déjà déployées restent utilisables. | À tester |

Un message lu ou supprimé avant son traitement peut ne plus déclencher d’envoi. Garder la page destinataire fermée jusqu’à l’alerte pendant ces essais. Une alerte déjà acceptée par le fournisseur ne peut pas être rappelée.

## Relevé de recette

| Plateforme | Activation affichée | Alerte page fermée | Clic / bon espace | Session reprise |
| --- | --- | --- | --- | --- |
| Ordinateur / navigateur à préciser | À confirmer | À confirmer | À confirmer | À confirmer |
| Android / navigateur à préciser | À confirmer | À confirmer | À confirmer | À confirmer |
| iPhone/iPad / version à préciser, si utilisé | À confirmer | À confirmer | À confirmer | À confirmer |

Le retour utile indique l’appareil, le navigateur, le sens d’envoi et le résultat observé, ou le texte de l’erreur. Aucune phrase de coffre, clé ou valeur d’abonnement n’est nécessaire.
