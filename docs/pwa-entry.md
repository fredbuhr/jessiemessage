# Entrée de l’application — étape 0.18

Version applicative **0.20.0**, branche `feat/pwa-entry`, construite sur la simulation 0.17c. Ce lot remplace l’impasse de lancement par une entrée neutre `/app`, reliée aux parcours existants. L’identité et les PNG approuvés restent inchangés ; **contact@jessiemessage.com** reste l’adresse du site. Aucun déploiement n’est effectué.

**Évolution 0.21.0, étape 0.19 :** la [traduction des interfaces privées](private-ui-languages.md) étend le FR/EN et partage désormais la préférence de langue via `sessionStorage` (`fr`/`en` uniquement). Les paragraphes ci-dessous décrivent le lot initial 0.20.0 ; cette préférence neutre remplace son choix volatil, sans stockage de contenu privé.

## Lancement et choix du rôle

Le manifeste conserve `id: "/"`, `scope: "/"`, le nom, les couleurs et les icônes. Son `start_url` devient `/app`. Le manifeste est également référencé par les pages d’accès, connexion administrateur, conversation, récupération, préparation et diffusion. L’accueil `/` reste public et neutre, avec un lien « Ouvrir mon espace » ; il ne prétend plus que tous les comptes sont désactivés.

L’entrée vérifie les choix disponibles par `GET /api/entry`. Le serveur réutilise les services de session existants, seulement lorsqu’un cookie canonique du rôle activé est présent. Il ne renvoie que des états et destinations fixes : aucun nom, identifiant, e-mail, date, CSRF, contenu ou détail de configuration. Une vérification de session peut mettre à jour son suivi d’activité existant ; elle ne démarre aucun worker ni envoi.

| Situation vérifiée | Destination proposée |
| --- | --- |
| Accès client désactivé | Aucun choix client |
| Client sans session valide | `/access`, connexion existante |
| Client en attente ou accès expiré | `/access`, suivi des validations |
| Client actif avec chat activé | `/messages` |
| Client actif sans chat | `/access` |
| Authentification administrateur désactivée | Aucun choix administrateur |
| Administrateur sans session valide | `/admin/login` |
| Administrateur connecté, chat activé | `/admin/messages` |
| Administrateur connecté, chat désactivé | `/admin` |
| Les deux rôles présents | Deux choix explicites, sans bascule silencieuse |

Le choix reste volontaire, sans redirection automatique. Les destinations privées recontrôlent leurs autorisations ; ce résumé d’entrée n’est pas une preuve d’accès durable. L’expiration de session et celle de l’accès sont revérifiées après les opérations asynchrones. Une session qui expire pendant la vérification mène à la reconnexion ; un accès qui expire mène au suivi d’accès.

Le résumé vaut toujours `{status, client, administrator}`. Sans fonctions privées activées, HTTP 200 avec `status: unavailable` et deux valeurs `null` décrit une entrée fermée. Une panne de service renvoie HTTP 503 avec un résumé neutre : elle n’est jamais interprétée comme une déconnexion. Une erreur réseau, un délai, une réponse incohérente, un 429 ou un 503 laisse l’entrée en état de nouvelle tentative. La sonde `/api/ready` ne décide pas du choix : une panne de worker ne doit pas empêcher de retrouver une page de connexion.

## Confidentialité et cycle de vie

L’API reste derrière le contrôle d’admission avant toute lecture de session. Elle accepte uniquement GET, sans paramètres ; les autres méthodes sont refusées avant les callbacks de session et HEAD reste sans corps. Les deux recherches éventuellement démarrées sont attendues même si l’une échoue. Aucun cookie n’est créé ou effacé par cette API ; les parcours de connexion/déconnexion existants gardent cette responsabilité.

La page, les scripts, le modèle, les styles, le manifeste et les réponses API restent `no-store`, avec CSP locale et politique de référent restrictive. L’interface n’utilise ni stockage navigateur, cache applicatif, service worker, destination arbitraire `next`, jeton d’invitation ou paramètre de retour. Les fragments et paramètres d’une ouverture `/app` sont écartés, sans être interprétés ou transmis. Les invitations continuent à utiliser `/access#invitation=…` et la récupération son parcours dédié.

Au masquage ou départ de page, les choix sont retirés, les requêtes annulées et leur génération invalidée. Une réponse tardive ne peut pas rétablir les liens ; le retour de visibilité ou du cache de navigation provoque une nouvelle vérification. Le délai de huit secondes reste borné même si un transport ignore l’annulation. Aucun polling continu n’est ajouté.

L’entrée et ses aides d’installation sont disponibles en **français et anglais**, sans préférence persistée. Les parcours privés existants restent principalement en français : ce lot n’en revendique pas la traduction complète. Le logo approuvé sert l’identité ; aucun portrait personnel ni image de démonstration n’est ajouté au site privé.

## Installation progressive

Le bouton d’installation n’apparaît que si le navigateur fournit une demande d’installation exploitable. Il ouvre la demande native après un clic ; aucun prompt automatique n’est lancé. Un mode déjà installé masque ce bouton. Une aide générique reste accessible pour l’ajout à l’écran d’accueil ou le menu du navigateur ; l’installation et son interface dépendent du navigateur et de l’appareil.

Ce lot ne promet pas de lecture hors ligne des messages ou photos. Il ne stocke aucune réponse privée pour offrir un repli hors réseau. HTTPS et une recette sur les appareils réels restent nécessaires ; les tests VM ne certifient pas un WebAPK, Safari installé ou le comportement après mise à jour d’une installation existante.

Références techniques vérifiées le 15 octobre 2026 : [MDN — installation des PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) et [Chrome — identité du manifeste](https://developer.chrome.com/docs/capabilities/pwa-manifest-id). La stabilité de `id` permet de faire évoluer `start_url` dans les navigateurs qui utilisent cette identité ; la mise à jour effective d’un appareil déjà installé reste à contrôler.

## Vérification et suite

Les tests couvrent le DTO minimal, les rôles simultanés, les fonctions désactivées, les expirations pendant une attente, les erreurs sans détails privés, l’admission avant SQL, la confidentialité du contrôleur, les réponses tardives et le mécanisme d’installation. Un serveur réellement configuré sans authentification est exercé sans base ; la CI exerce aussi le serveur en authentification seule avec MariaDB, sans transport SMTP et avec arrêt suivi.

La [recette de préproduction](preproduction-acceptance.md) donne les contrôles précis pour HTTPS, base/stockage isolés, sorties e-mail maîtrisées, appareils, comptes partagés, restauration et pilote. Aucun navigateur installé n’est disponible dans l’environnement local de ce lot ; la recette visuelle et appareil reste ouverte. Les preuves exactes de CI sont consignées dans la PR.

Restent notamment : préproduction chez l’hébergeur, majorité externe, réception e-mail contrôlée, conservation/suppression complète, restauration éprouvée, traduction des parcours privés, recette d’accessibilité et intégration ordonnée des PR. Le présent lot prépare leur vérification ; il n’active aucune fonctionnalité privée par défaut.
