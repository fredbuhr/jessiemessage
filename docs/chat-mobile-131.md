# Conversation au centre sur mobile — correctif 1.3.1

**21 octobre 2026 — code prêt et validations locales réussies sur `fix/chat-mobile-131` ; CI, fusion, publication et déploiement encore à réaliser.** La production reste en **1.3.0**, close par le reçu utilisateur `release130_metadata_recorded`. Aucune nouvelle action opérateur 1.3.0 n’est requise. La version active et les seules commandes opérateur courantes sont dans [REPRISE](REPRISE.md) ; les diffusions attendent la fin de ce correctif.

## Périmètre du correctif

- **Une seule barre de conversation active sur mobile**, avec avatar, nom, **Options** et retour aux conversations pour l’administration si nécessaire. La grande barre de marque ne s’ajoute plus à une seconde barre de conversation. Dans la boîte de réception, afficher sa propre barre compacte.
- Le menu **Options** donne accès au compte, profil, notifications, langue, Contact et Aide ; les commandes de la conversation, dont Photos, Fiche pour l’administration et export lorsqu’ils sont disponibles, restent contextuelles. Le pied de page ne réserve plus d’espace permanent. Les actions continuent de dépendre du rôle et des capacités existants.
- Un composeur compact regroupe `+`, `☺` pour les émojis, saisie et envoi ; le `+` expose photo, bibliothèque et réponses rapides selon les capacités. Conserver aperçu photo, erreurs, limites et renvoi d’un message incertain quand ils sont nécessaires.
- L’historique reçoit l’espace restant et conserve son propre défilement, ses messages précédents/suivants et son retour aux nouveaux messages. Sur ordinateur, conserver la liste de conversations et les outils sans imposer les empilements mobiles.

Objectif de projet : réserver **environ 70 % de la hauteur visible à l’historique**, à 360 × 640 px sans clavier, menu fermé, sans aperçu photo ni erreur. Ce budget est un critère local de présentation, pas une norme Apple, Android ou Web. Avec clavier ou écran très court, priorité à une saisie et à un envoi réellement visibles et accessibles.

## Mise en œuvre et garde-fous

Le travail réorganise les contrôles existants et leurs hôtes dans `chat.html`/`chat.js`, puis les règles propres à la messagerie dans `chat.css` et `emoji.css`. Les adaptations de traduction, de profil et de téléchargement restent limitées aux entrées de menu et au retour du focus. Les feuilles globales de marque et de traduction des autres pages ne sont pas à refondre. Les retours à la ligne imposés par la navigation et le pied de page, ainsi que la hauteur desktop calculée avec une constante, ne doivent plus déterminer la place du fil.

Les boutons et liens gardent des noms accessibles traduits et un ordre de Tab simple. Ne pas ajouter un rôle ARIA de menu sans le comportement clavier correspondant. Qualifier Échap, fermeture explicite et retour du focus sur un contrôle visible. Si un dialogue ouvert depuis le menu ferme ce dernier, le profil et l’export doivent rendre le focus à son déclencheur visible, et non à une entrée masquée.

Conserver les vérifications de propriétaire, de conversation et de génération des parcours existants. Fermer les menus au changement de conversation, au masquage et au nettoyage du compte. L’ouverture d’un menu ne déclenche ni message, ni export. Aucun changement de transport, d’API serveur, de droits, de dépendances ou de schéma SQL.

## Qualification locale et CI en cours

**148 tests ciblés réussis, zéro échec et zéro omission**, après la dernière correction de placement des outils. Build local réussi avec contrôle de 583 sources ; le dernier ajustement de borne a ensuite son contrôle de syntaxe ciblé réussi. Node local 24.19.0, CI prévue sous 24.22.0. La revue indépendante a fait corriger le rognage du panneau « + » ; aucun blocage restant dans le diff relu. Chrome est absent localement. La [première CI de PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39521871297) a exécuté 171 tests Chrome : 170 réussis, un échec et aucune omission. Le champ vide grandissait avec le retour à la ligne du placeholder à 320 px ; le calcul a été corrigé pour garder 44 px sans mesurer un placeholder vide. La [deuxième CI](https://github.com/fredbuhr/jessiemessage/actions/runs/39522459820) valide les nouvelles dispositions, mais compte encore 170/171 : une vérification du profil administrateur lisait les initiales avant la fin du chargement de la conversation. Une attente explicite de la saisie activée est ajoutée, sans changer l’avatar attendu ni le délai. Ces deux tentatives sont conservées ; la qualification finale reste à obtenir. Une simulation de viewport reste distincte d’un clavier observé sur téléphone physique. [Preuves structurées](verification-proofs/jm131-verification.json).

1. Client et administration, FR/EN, 320/360/390 px et ordinateur : absence de chevauchement, cibles tactiles accessibles, menu atteignable, historique mesuré et saisie visible.
2. Clavier Tab/Entrée/Échap, ouverture/fermeture des menus, profil et export, retour de la bibliothèque et des emojis sans perte de brouillon ni envoi automatique.
3. Faible hauteur visible, ouverture/fermeture du clavier, rotation et zoom : distinguer simulation de viewport et essai réellement observé sur téléphone. Adapter à `VisualViewport` seulement si les mesures le nécessitent ; éviter de bloquer le zoom ou de déduire la présence du clavier d’une simple hauteur.
4. Changement de compte/conversation ou masquage pendant une action : nettoyage, annulation et refus des réponses périmées conservés. Réutiliser les tests d’export, profil, notifications et lecture privée ; aucune nouvelle suite SQL dédiée à la présentation.

L’ancien test Chrome imposant six commandes visibles dans l’en-tête est remplacé dans ce travail par des critères de barre compacte et de commandes accessibles dans le menu, avec un contrôle de hauteur utile du fil. Une simple absence de débordement horizontal ne suffit pas.

Après validation, consigner le commit exact, la CI, la fusion et la publication, puis préparer l’activation compatible. Aucun de ces états n’est acquis par la seule présence du code dans la branche. La 1.3.1 n’est pas encore disponible sur le service.

## Références officielles consultées

- [Apple — Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) : privilégier les commandes importantes, éviter la surcharge et placer les actions complémentaires dans More sur iOS. Référence d’ergonomie native, sans imposer ses composants à la PWA.
- [Android — Make apps more accessible](https://developer.android.com/guide/topics/ui/accessibility/apps) : conserver des contrôles faciles à toucher et décrire leur fonction. La recommandation native de 48 dp n’est pas assimilée automatiquement à une valeur CSS ; le correctif conserve des zones tactiles d’au moins 44 px CSS et vérifie leur séparation.
- [MDN — VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) : le clavier peut réduire le viewport visible sans réduire le viewport de mise en page ; tester ce cas plutôt que supposer que la hauteur CSS suffit sur tous les navigateurs.
