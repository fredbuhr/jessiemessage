# JessieMessage — Nuit V2 (atelier 0.3)

Refonte sombre demandée par le propriétaire : une ambiance personnelle, sensuelle et élégante, sans codes visuels de plateforme explicite ni imitation d’une messagerie grand public.

## Direction visuelle livrée

Fond noir chaud `#100d12`, surfaces prune `#1b161e`, bouton bordeaux `#71354f`, accents champagne `#d8b999`, texte ivoire `#f5eef2`. Les bulles de Jessie sont prune/bordeaux, celles du client anthracite, quel que soit le côté de la conversation.

Titres sérif et interface en polices système pour ne charger ni police ni dépendance distante. Un monogramme J discret. Une seule photographie de référence dans la copie personnalisée remise au propriétaire ; aucune photographie dans le dépôt public ou l’archive GitHub.

## Interfaces

- Accueil : une photographie facultative, un titre court et une action principale. Aucun catalogue ni paiement.
- Mobile client : conversation occupant l’espace disponible, en-tête réduit, saisie ancrée en bas, champ multiligne extensible, médias agrandissables.
- Ordinateur client : conversation avec une colonne secondaire réservée au portrait, à la galerie et aux préférences.
- Administration : quatre entrées conservées (Messages, Médiathèque, Diffusion, Accès), transformées en navigation basse sur smartphone.
- Fenêtres secondaires sous forme de panneaux bas sur smartphone ; dialogues centrés sur ordinateur.
- Les modules d’invitations, de tags, de groupes, de notes et de diffusion V0.2 ne sont pas réécrits dans cette refonte graphique.

## Adaptations et contrôles

`design/dark.css` et `design/dark-ui.js` sont des couches de présentation de l’atelier, assemblées par le build. Le serveur public est inchangé. Elles ne doivent pas devenir un système d’autorisation de production.

La hauteur suit `visualViewport` lorsque le zoom est normal, avec repli sur la hauteur de fenêtre et prise en compte des zones de sécurité. Le zoom tactile n’est pas désactivé. Les principaux boutons de la conversation mesurés sur mobile atteignent au moins 44 × 44 px. Le champ de saisie utilise une taille de 16 px. Les animations respectent la préférence de mouvement réduit.

Huit nouveaux tests Node couvrent la syntaxe, les dépendances, les contrastes de sept paires de couleurs, les règles mobiles, l’échappement du texte, la séparation des attributs de navigation, le maintien du défilement et l’assemblage sans portrait privé. La suite GitHub contient ainsi 36 tests ; consulter la CI du commit pour son résultat, pas seulement ce document.

Contrôles de navigateur réalisés pendant cette livraison : 49 combinaisons d’écrans sur sept largeurs (320, 375, 390, 430, 768, 1024, 1440 px), sans débordement horizontal observé. Parcours testés dans Chromium : entrée, texte/émojis, agrandissement média, note admin absente de la vue client, groupe manuel, diffusion et double envoi, invitation fictive, saisie multiligne, maintien de la position de lecture, FR/EN et hauteur réduite. Aucune erreur JavaScript ni requête HTTP externe observée dans ces parcours.

**Limites des essais :** le HTML est injecté dans Chromium automatisé. Ce ne sont pas des tests sur iPhone/Android physiques, ni une validation de tous les claviers, du Web Push, de l’accessibilité complète ou de la sécurité de production. Les contrastes testés ne valent pas certification WCAG de l’ensemble du produit. Le comportement du clavier iOS et les téléchargements HTML sur mobile devront être essayés sur appareil réel.

## Références techniques

- https://webkit.org/blog/7929/designing-websites-for-iphone-x/
- https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG21/Understanding/target-size.html

## Essayer

Télécharger l’archive de la CI, la décompresser, ouvrir JessieMessage.html. Le bouton Photo charge un portrait local, sans envoi réseau. Accueil / Messages / Admin sont des commandes de présentation et ne représentent pas les permissions d’un vrai utilisateur.

Tout reste fictif et en mémoire. Aucune invitation réelle, authentification, MariaDB, notification, délivrance de message entre appareils ou validation juridique n’est ajoutée. La déclaration 18+ reste déclarative ; les documents légaux sont des structures à compléter. Aucun déploiement Infomaniak n’est déclenché.
