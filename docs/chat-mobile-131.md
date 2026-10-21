# Conversation au centre sur mobile — correctif prévu 1.3.1

**21 octobre 2026 — proposition bornée, non implémentée.** Ouvrir ce correctif après le reçu d’alignement final des métadonnées 1.3.0, puis avant les diffusions à grande échelle. La version active et les seules commandes opérateur courantes sont dans [REPRISE](REPRISE.md).

## Résultat attendu

- **Une seule barre de conversation active sur mobile**, avec avatar, nom, menu et retour aux conversations pour l’administration si nécessaire. Ne pas cumuler une grande barre de marque et une seconde barre de conversation. Dans la boîte de réception, afficher sa propre barre compacte.
- Un menu discret donne accès au compte, profil, notifications, langue, Contact et Aide ; les commandes de la conversation, dont Photos et export lorsqu’ils sont disponibles, restent contextuelles. Le pied de page ne réserve plus d’espace permanent. Les actions continuent de dépendre du rôle et des capacités existants.
- Un composeur compact regroupe `+`, émojis, saisie et envoi ; le `+` expose photo, bibliothèque et réponses rapides selon les capacités. Garder aperçu photo, erreurs, limites et renvoi d’un message incertain quand ils sont nécessaires.
- L’historique reçoit l’espace restant et conserve son propre défilement, ses messages précédents/suivants et son retour aux nouveaux messages. Sur ordinateur, conserver la liste de conversations et les outils sans imposer les empilements mobiles.

Objectif de projet : réserver **environ 70 % de la hauteur visible à l’historique**, à 360 × 640 px sans clavier, menu fermé, sans aperçu photo ni erreur. Ce budget est un critère local de présentation, pas une norme Apple, Android ou Web. Avec clavier ou écran très court, priorité à une saisie et à un envoi réellement visibles et accessibles.

## Mise en œuvre KISS

Réorganiser les contrôles existants et leurs hôtes dans `chat.html`/`chat.js`, puis corriger les règles propres à la messagerie dans `chat.css` et `emoji.css`. Éviter les changements globaux de marque et de traduction affectant les autres pages. Les retours à la ligne imposés par la navigation et le pied de page, ainsi que la hauteur desktop calculée avec une constante, ne doivent plus déterminer la place du fil.

Privilégier les boutons et liens natifs, avec des noms accessibles traduits et un ordre de Tab simple. Ne pas ajouter un rôle ARIA de menu sans le comportement clavier correspondant. Prévoir Échap, fermeture explicite et retour du focus sur un contrôle visible. Si un dialogue ouvert depuis le menu ferme ce dernier, le profil et l’export doivent rendre le focus à son déclencheur visible, et non à une entrée masquée.

Conserver les vérifications de propriétaire, de conversation et de génération des parcours existants. Fermer les menus au changement de conversation, au masquage et au nettoyage du compte. L’ouverture d’un menu ne déclenche ni message, ni export. Aucun changement de transport, d’API serveur, de droits, de dépendances ou de schéma SQL.

## Vérifications utiles

1. Client et administration, FR/EN, 320/360/390 px et ordinateur : absence de chevauchement, cibles tactiles accessibles, menu atteignable, historique mesuré et saisie visible.
2. Clavier Tab/Entrée/Échap, ouverture/fermeture des menus, profil et export, retour de la bibliothèque et des emojis sans perte de brouillon ni envoi automatique.
3. Faible hauteur visible, ouverture/fermeture du clavier, rotation et zoom : distinguer simulation de viewport et essai réellement observé sur téléphone. Adapter à `VisualViewport` seulement si les mesures le nécessitent ; éviter de bloquer le zoom ou de déduire la présence du clavier d’une simple hauteur.
4. Changement de compte/conversation ou masquage pendant une action : nettoyage, annulation et refus des réponses périmées conservés. Réutiliser les tests d’export, profil, notifications et lecture privée ; aucune nouvelle suite SQL dédiée à la présentation.

Le test Chrome imposant aujourd’hui six commandes visibles dans l’en-tête doit devenir un test de barre compacte et de commandes accessibles dans le menu, avec un contrôle de hauteur utile du fil. Ne pas remplacer ce contrôle par une simple absence de débordement horizontal.

## Références officielles consultées

- [Apple — Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) : privilégier les commandes importantes, éviter la surcharge et placer les actions complémentaires dans More sur iOS. Référence d’ergonomie native, sans imposer ses composants à la PWA.
- [Android — Make apps more accessible](https://developer.android.com/guide/topics/ui/accessibility/apps) : conserver des contrôles faciles à toucher et décrire leur fonction. La recommandation native de 48 dp n’est pas assimilée automatiquement à une valeur CSS ; le correctif conserve des zones tactiles d’au moins 44 px CSS et vérifie leur séparation.
- [MDN — VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) : le clavier peut réduire le viewport visible sans réduire le viewport de mise en page ; tester ce cas plutôt que supposer que la hauteur CSS suffit sur tous les navigateurs.
