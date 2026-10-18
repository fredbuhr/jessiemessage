# JessieMessage — atelier interactif V0.2

## Livré dans cette étape

L’atelier existant est conservé. Deux modules le complètent : `design/admin-tools.js` (règles de gestion testables) et `design/admin-tools-ui.js` (interfaces). `scripts/build-workbench.mjs` les assemble avec `design/preview.html` dans un seul fichier HTML autonome. Il ne faut pas ouvrir les modules séparément.

L’administration garde quatre entrées : Messages, Médiathèque, Diffusion, Accès. La quatrième regroupe les membres, invitations et groupes privés afin de ne pas multiplier les menus.

### Invitations et accès — simulés

- Pseudonyme, durée d’accès après activation et validité du lien sont des réglages distincts.
- Activation unique, révocation, état expiré et ajout facultatif à un groupe interne.
- Suspension/réactivation et prolongation d’un accès à durée limitée.
- Un accès sans échéance n’est pas raccourci par une prolongation.
- La case 18+ représente une déclaration : `ageDeclared=true`, `ageVerified=false`. Aucune majorité n’est vérifiée par cet atelier.
- Les liens d’exemple utilisent `example.invalid`. Ils ne donnent aucun accès au domaine de production et ne doivent pas être transmis à des clients.

### Groupes et historique

- Création de groupes manuels et modification de leurs membres, indépendamment des tags.
- Sélection du groupe dans Diffusion, sans conversation collective.
- Comptes suspendus ou expirés exclus ; préférences de communication conservées.
- Protection contre les médias déjà reçus, également lors d’un envoi individuel avec confirmation explicite avant renvoi.
- Journal des derniers envois simulés, destinataires et doublons repérés.
- Recherche des membres par nom, tag ou groupe. Notes, rappels et brouillons restent disponibles dans l’atelier existant.

## Essayer sans console

Dans GitHub Actions, ouvrir la dernière exécution CI réussie de cette branche. Télécharger l’archive `JessieMessage-apercu-…`, la décompresser puis ouvrir `JessieMessage.html` dans un navigateur. L’archive comprend aussi des instructions et une empreinte SHA-256. Aucun GitHub Pages ni déploiement Infomaniak n’est activé.

Le fichier n’utilise aucune dépendance distante ni compte réel. Le bouton Photo charge une image dans le navigateur. Les portraits personnels ne sont pas inclus dans la source ni dans l’archive GitHub ; une copie locale remise directement au propriétaire peut en contenir un.

## Vérifications effectuées

- 28 tests Node au total : 13 nouveaux tests, plus les 15 tests existants.
- Parcours testés dans Chromium automatisé : création/activation d’une invitation, groupe, diffusion ciblée, doublons individuels, brouillons séparés, notes absentes de la vue client, suspension, recherche et FR/EN.
- Contrôles de largeur à 320, 375, 390, 768, 1024 et 1440 pixels. Correction du débordement de navigation sur petit écran.
- Aucun appel HTTP externe observé pendant les parcours de cet atelier.

Ces contrôles ne constituent pas un test sur iPhone réel, un test de charge ou un audit de sécurité. Les tests de navigateur ont chargé le HTML dans Chromium ; le téléchargement GitHub reste à essayer dans les navigateurs et appareils du propriétaire.

## Limites explicites

Tout reste en mémoire, réinitialisé au rechargement. La bascule client/admin est un outil de présentation, pas une authentification. Il n’y a toujours ni base MariaDB reliée, ni comptes réels, ni e-mail, ni Web Push, ni transfert de messages/photos entre appareils. Les pages légales restent des structures de travail.

Le serveur Node.js existant ne sert ni `design/` ni `artifacts/`. Ne pas rendre ces dossiers accessibles comme messagerie de production. Les règles de gestion devront être réimplémentées et contrôlées côté serveur lors du branchement de l’authentification et de la base ; ne jamais faire confiance aux états du navigateur.

Prochain lot technique : modèle de données et authentification/invitations côté serveur, avec API testées et données synthétiques. Aucun changement de l’hébergement n’est requis pour explorer cette version.
