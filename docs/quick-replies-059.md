# Réponses rapides — 0.59

**Activée le 18 octobre 2026 à 21:45 Europe/Paris**, source `6fab86ff`, arbre `29ee7d3b`, [PR #75 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/75). [Relevé d’activation et repli 0.59](quick-replies-activation-059.md), [preuves structurées](activation-proofs/jm059-activation.json).

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

CI [source](https://github.com/fredbuhr/jessiemessage/actions/runs/39159780258), [PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39159783819) et [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39160034447) : cinq jobs réussis chacune. Source exacte : 2 535 réussites et 27 wrappers SQL ignorés sur 2 562 cas ; 385/385 sur chaque MariaDB ; 124/124 Chrome, sans saut ; authentification HTTPS/MFA ; syntaxe de 455 fichiers et build conformes. Les anciens bancs VM de traduction/accessibilité ont été adaptés pour charger le nouveau module ; 96 tests ciblés passent localement. Sur l’hébergement : 240/240 natifs sans saut, puis préflight réel passé à 19:40:35.582052 UTC sans démarrage ni capture.

Les paramètres 0.58 ont été contrôlés inchangés et sauvegardés avant remplacement. Run/Build relus après enregistrement ; cycle Manager lancé à 19:45:55.569 UTC, sans réinstallation. État Actif, modification 21:45 Europe/Paris. Après le dernier démarrage : mesures 19:46:11.843 et 19:47:11.902 UTC, intervalle 60 059 ms, current / OK, aucun incident ni alerte en attente. [Preuve visuelle](activation-proofs/jm059-activation-20261018.jpg).

À 19:48:21.586622 UTC : 82/82 HTTPS et vingt-quatre empreintes exactes, avec TLS vérifié et redirections non suivies. Six sondes HEAD supposaient à tort la présence de Content-Length, que le handler existant omet ; seules ces sondes ont été corrigées et répétées. Statut, corps vide, type MIME et taille exacte si fournie sont contrôlés ; le rapport initial est conservé. Aucun code applicatif modifié pendant cette vérification.

À 19:52:15.565 UTC : version 0.59.0, source et checkout propres, quatre enregistrements du journal et dernier succès inchangés, aucun incident ni alerte en attente. Copie PC courante confirmée par identifiant, taille et SHA-256, avec reçu à 19:50:51.025 UTC après activation. La reconnexion du terminal a précédé le premier relevé d’observation ; son absence a été vérifiée avant sa relance, sans répéter aucune capture ni opération de service.

Les changements d’export apparus en parallèle dans le dossier initial sont préservés. Ce lot a été reconstruit dans une copie isolée, à partir de `98e189a`, et les exclut. Le dossier de reprise identifie les deux copies pour éviter toute confusion lors de la suite.

Aucun schéma, dépendance, clé, compte, paramètre de conservation ou outil Windows modifié. Repli 0.58 `f92eaf38`, arbre `aa5d5a4694f29c40490c92634730f16812ec3d6e`, avec paramètres antérieurs dans `/srv/customer/jessiemessage-private/manager-before-quick-replies-059.json` en 0600. Aucun repli ni restauration SQL provoqué. Déchiffrement personnel, conservation/confidentialité et effacement complet restent ouverts.
