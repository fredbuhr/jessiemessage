# Notifications — essais sur les appareils du foyer

La recette utilise désormais `f2677249`, schéma 30, avec [l’ouverture directe du message et les connexions clients durables](notification-opening.md). Le propriétaire a accepté la réception réelle des notifications sur 0.31, puis signalé la friction du clic. La correction 0.33 passe les contrôles CI et HTTPS ; le clic réel après cette mise à jour reste à confirmer. Les plateformes et les scénarios ci-dessous ne sont pas détaillés dans le retour initial ; leurs lignes restent un relevé complémentaire, sans imposer de refaire les essais déjà satisfaisants.

## Priorité après la mise à jour 0.33

1. Recharger JessieMessage sur l’appareil destinataire. Si l’ancienne session client est déjà perdue, se connecter une seule fois ; les visites suivantes utilisent la connexion durable.
2. Envoyer un nouveau message depuis le compte opposé de test, en gardant la page destinataire fermée jusqu’à l’alerte.
3. Cliquer sur cette **nouvelle** notification : la bonne conversation doit s’ouvrir directement, avec le message mis en évidence. Aucun choix d’espace ni nouvelle identification lorsque la session est encore valable.
4. Refaire le clic vers l’administrateur, puis si utile avec un brouillon déjà saisi dans une fenêtre ouverte : il doit rester disponible.

Les alertes déjà affichées avant cette mise à jour ne contiennent pas la référence de destination et gardent leur ancien parcours. Les abonnements existants restent utilisables ; une réactivation n’est pas normalement nécessaire.

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
