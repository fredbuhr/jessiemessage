# Chat : annonces et clavier — étape 0.20

Version applicative **0.22.0**, branche `feat/chat-accessibility`, construite sur le FR/EN #22. Le lot traite A16 et des pertes de focus observées dans les rendus du chat. **contact@jessiemessage.com** reste l’adresse officielle. Aucune migration, fusion, activation privée ou publication n’est effectuée.

## Réceptions annoncées

Une région présente dès le chargement, distincte de l’historique et du statut d’envoi, porte `role="status"`, `aria-live="polite"` et `aria-atomic="true"`. Elle reçoit un texte générique : « Nouveau message reçu. », puis « {count} nouveaux messages reçus. », avec leur version anglaise. Le nombre cumule les réceptions admises dans la conversation ouverte pendant cette période visible. Il ne représente ni les messages non lus du compte ni une preuve de lecture.

Seuls les nouveaux événements de message provenant de l’autre personne, acceptés après les gardes de session et de génération, peuvent incrémenter ce nombre. Le curseur d’événements, les séquences déjà connues et la présence du message après fusion empêchent les doublons et les contenus déjà supprimés du même lot de compter. Les propres envois, accusés, suppressions et réponses vides n’écrivent pas dans cette région.

Le chargement initial, la sélection d’une conversation mise en cache, la pagination des anciens messages et le premier rattrapage après masquage restent silencieux. Le compteur est ensuite armé pour les réceptions futures. Un changement de conversation/propriétaire, une déconnexion, le masquage ou le départ de page effacent l’annonce et son état. Une réponse tardive ne peut pas la rétablir. La bascule FR/EN efface uniquement le texte transitoire ; elle n’effectue aucune requête et la réception suivante emploie la langue choisie.

Aucun nom, texte, légende, identifiant ou contenu de photo n’entre dans cette annonce. L’historique conserve son rôle de liste et ne devient pas une région qui récite automatiquement les messages. Le lecteur peut le parcourir volontairement. Le statut d’envoi et ses erreurs gardent leur région propre ; un polling réussi ne les mélange pas avec les arrivées.

## Parcours au clavier

| Situation | Comportement attendu |
| --- | --- |
| Choisir une conversation | Rejoindre l’historique focusable après l’action, sans ouvrir le clavier de saisie ni détourner un focus déjà déplacé ailleurs |
| Revenir aux conversations | Retrouver le contact concerné, avec un titre de liste comme repli |
| Actualiser la liste pendant un polling | Conserver le contact focalisé ; laisser le focus ailleurs s’il y était déjà |
| Remplacer un message supprimé | Repli logique pour le contrôle qui disparaît, sans focaliser automatiquement chaque nouveau message |
| Fin de pagination | Ne pas laisser le focus sur un bouton caché ou retiré |
| Fermer une photo ou la galerie | Retrouver un déclencheur encore visible et utilisable, sinon une cible logique du parcours |

Le lien d’évitement rejoint une conversation visible. Le défilement de l’historique, les boutons, liens et contrôles disposent d’un indicateur de focus explicite. La zone de saisie référence son aide par `aria-describedby`. Les boutons de suppression ont une cible CSS agrandie. Les dialogues restent des éléments HTML natifs : leur comportement réel avec Tab/Maj+Tab/Échap doit également être vérifié sur les systèmes visés.

Les corrections préservent les lignes inchangées de l’historique, les miniatures déjà chargées, les URL d’objet et les brouillons. Elles n’ajoutent aucune requête, aucun stockage privé et aucun cache. Le focus n’est pas déplacé vers une ancienne conversation, une page masquée ou un contrôle inactif après une attente.

## Preuves automatiques et recette restante

Les tests VM exercent les réceptions réelles, le cumul, les doublons, la pagination, les générations, la purge, les langues et le focus avec les contrôleurs existants. Les anciens tests de stabilité des messages/photos et d’isolation de session restent exécutés.

`npm run test:browser` utilise Chrome et ChromeDriver déjà installés, par l’interface HTTP WebDriver, avec Node.js seul. Le job CI est distinct des tests généraux et SQL et échoue si ces exécutables manquent. Le serveur local de fixtures sert les vrais fichiers HTML/CSS/JS et des réponses API fictives ; aucun compte, base, SMTP, DNS ou hébergement externe n’est utilisé. Les tailles de fenêtre couvrent un bureau et un écran étroit. Cela contrôle le DOM, le focus et les dialogues d’un vrai navigateur, sans prétendre reproduire un téléphone ou un lecteur d’écran.

Les résultats exacts et le SHA sont consignés dans la PR. Aucun lecteur d’écran ni appareil physique n’est disponible dans l’environnement local de ce lot. La [recette de préproduction](preproduction-acceptance.md) reste ouverte pour VoiceOver/NVDA, Safari/iPhone, Android, clavier virtuel, contraste, longueur des traductions, annonces effectives et parcours authentifiés sur HTTPS. Une réussite Chrome synthétique ne certifie ni l’accessibilité complète ni le fonctionnement du backend de production.

Références techniques consultées le 15 octobre 2026 : [W3C ARIA22 — messages de statut](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22/), [APG — dialogue modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [ChromeDriver — capacités](https://developer.chrome.com/docs/chromedriver/capabilities), [logiciels du runner Ubuntu 24.04](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md). Ces références guident les choix et ne constituent pas une certification du produit.
