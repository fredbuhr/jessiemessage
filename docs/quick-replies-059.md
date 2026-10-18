# Réponses rapides — 0.59

Préparation du 18 octobre 2026. La version active reste 0.58 jusqu’au relevé d’activation.

## Usage

Dans une conversation administrateur, **Réponses rapides** ouvre six phrases courantes : accueil, nouvelles, remerciement, réponse ultérieure, connexion du soir et bonne nuit. Le choix **Français / English** change la langue des phrases indépendamment de celle de l’interface. La première ouverture reprend la langue de l’interface ; le dernier choix reste seulement dans cette page et est réinitialisé au changement de compte.

Choisir une phrase l’ajoute à la fin du brouillon existant, avec un saut de ligne si nécessaire. Le texte existant reste intact. La sélection ne transmet rien : l’administrateur peut modifier le message, puis utilise le bouton **Envoyer** habituel. Les textes intégrés ne contiennent ni nom de client ni horaire configuré ; les annonces du soir sont à relire comme tout message manuel. Le catalogue est fixe dans ce lot ; aucun éditeur de phrases personnelles ni stockage supplémentaire n’est introduit.

Le bouton est réservé à l’administration et à une conversation autorisant l’envoi. L’interface invité ne l’affiche pas. Les phrases intégrées, comme le code du chat, sont publiques ; elles ne contiennent aucun contenu client.

## Protection des brouillons

L’ajout utilise les validations ordinaires : 4 096 caractères pour un message, 1 000 pour une légende de photo, texte Unicode et budget UTF-8 existants. Si le résultat est invalide ou trop long, aucune partie du brouillon n’est modifiée et le panneau indique comment reprendre.

Le choix est lié au compte, au CSRF, à la conversation et aux générations courantes de la page. Un changement de conversation, la fermeture de la sélection, le masquage de l’onglet, une perte de droit d’envoi ou le nettoyage de session ferment le panneau et invalident ses anciens boutons. Aucun ancien choix n’est rejoué. Le contenu d’une réponse reste du texte ordinaire ; les preuves d’identité et d’accès du chemin d’envoi existant sont conservées.

Le panneau utilise le clavier et le focus modal natif. Échap revient au brouillon sans l’altérer ; les touches de langue et les phrases ont des cibles d’au moins 44 px. Le texte d’une phrase suit la langue explicitement choisie, sans être retraduit à partir de la langue de l’interface.

## Vérification et activation

Les tests de modèle couvrent la conservation exacte du préfixe, les deux langues, les seuils de message et de légende, les choix invalides et les erreurs sans contenu privé. Le contrôleur réel vérifie l’absence d’envoi à l’insertion, l’édition puis l’envoi normal, les clients exclus, les brouillons pleins, l’accès suspendu et les anciens boutons après masquage ou remplacement du compte.

Chrome exerce les vrais modules du chat sur 320/1 280 px, en français/anglais, avec changement de langue des phrases au clavier, ajout à un brouillon existant, édition, un seul envoi après action explicite et contrôle du résultat. Échap, dépassement de longueur et retour à la liste ne doivent produire aucun envoi. Les fixtures restent synthétiques ; aucune communication réelle n’est déclenchée.

Les résultats CI et le relevé hébergé seront ajoutés après vérification. Aucun schéma, dépendance, clé, compte, paramètre de conservation ou outil Windows n’est modifié. Le repli prévu reste 0.58 `f92eaf38`, arbre `aa5d5a4694f29c40490c92634730f16812ec3d6e`. Les P0 de déchiffrement personnel, de conservation/confidentialité et d’effacement complet restent ouverts.
