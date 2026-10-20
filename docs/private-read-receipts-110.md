# Évolution 1 — Lecture privée, 1.1.0

**20 octobre 2026 — préparation locale, non publiée/non déployée.** Base de travail : `main` `e2c5397c64e0e68f959f77fcf417722871b5a677`, après la référence [v1.0.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.0.0) livrée sur `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`. Le travail de lecture privée auparavant préparé sous le numéro provisoire 0.87 est reporté séparément pour préparer `1.1.0`. Aucun résultat ancien ne qualifie ce nouveau candidat. L’[état courant](REPRISE.md) reste la référence du service réellement déployé ; la préparation de cette évolution ne modifie pas la production `1.0.0`.

## Comportement attendu

- Jessie conserve **Envoyé**, puis **Lu** lorsque le client affiche son message dans une conversation visible. La détection de visibilité existante reste utilisée ; elle ne certifie pas une lecture attentive.
- Le client voit seulement **Envoyé** sur ses propres messages. L’API ne lui transmet pas le point de lecture de l’administration, et l’interface ne lui affiche pas **Lu**, même avec une ancienne réponse non nulle.
- Chaque compte conserve son propre point de lecture en base pour ses badges et sa synchronisation entre appareils. Les reçus ne créent ni événement de conversation ni nouvelle date d’activité.
- L’export personnel client ne lit plus le curseur de l’administration et n’en publie pas la valeur. Les ZIP de conversation ne contiennent déjà aucun reçu de lecture. L’administration continue de recevoir le point de lecture réel du client dans ses réponses de conversation.

## Implémentation KISS

Les curseurs de lecture existants suffisent. Le lecteur SQL chat, le DTO du service et la frontière HTTP présentent au client un `peerReadSequence` constant `"0"`. Le champ décimal existant reste présent pour la compatibilité avec les anciennes interfaces ; le zéro est stable avant comme après une lecture administrateur. Le rôle administrateur conserve le curseur réel de son interlocuteur. L’interface vérifie également le rôle avant d’afficher **Lu**.

L’export personnel applique la même neutralisation, sans consulter le curseur administrateur pour le client. Les propres lectures continuent d’être enregistrées : masquer la valeur de l’autre compte ne supprime pas les badges ni les reprises sur un autre appareil.

Aucune nouvelle infrastructure, dépendance, route, table ou migration SQL. Le service Node et l’hébergement existants sont conservés. La version applicative passe à `1.1.0` dans `package.json` et les deux métadonnées racine de `package-lock.json` ; les dépendances verrouillées sont inchangées. Autorisations, sessions, chiffrement, quotas, données PC et états opérateur restent hors de ce changement.

## Validation du candidat

Les régressions portées avec le code couvrent les réponses client identiques avant/après lecture administrateur, le maintien des reçus visibles par Jessie, les lectures propres et badges persistés, les frontières HTTP, l’export personnel et l’interface client/administrateur en français et anglais. Les scénarios MariaDB contrôlent la persistance réelle ; le scénario Chrome vérifie aussi les mises à jour de métadonnées, le DOM et le focus.

Revues indépendantes serveur et interface sans défaut concret relevé. Sous Node local 24.19.0 : **215 tests ciblés réussis, zéro échec/omission** — 78 backend, 59 interface et 78 de compatibilité exports ZIP/HTTP, médias, accessibilité et identité de version. Pour la dernière série, `TMPDIR` désigne un répertoire temporaire local accessible, car `/tmp` est absent de cet environnement ; le premier lancement avait échoué pour cette seule condition. Syntaxe des **570 sources** et build du code porté réussis. Les prérequis MariaDB et Chrome ne sont pas qualifiés localement ; leur exécution native reste à constater en CI sous Node 24.22.0.

Les résultats du commit candidat restent à constater dans sa CI habituelle : suite générale, build/syntaxe, MariaDB 10.11 et 11.4, Chrome et authentification/messagerie HTTPS. Aucun score historique n’est repris comme preuve actuelle ; un test ignoré reste non vérifié. Les liens et résultats de cette exécution seront consignés après observation.

Après validation : fusionner, publier le tag immuable `v1.1.0` et sa release sur le commit exact validé, puis déployer ce même commit sur le service existant avec repli vers `v1.0.0`. La livraison sera confirmée par une identité fraîche du processus et les contrôles adaptés. Aucun envoi, effacement de compte ou contenu client réel n’est nécessaire à cette qualification. Les autres évolutions de messagerie restent distinctes.
