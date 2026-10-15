# Premier démarrage hébergé neutre — étapes 0.23–0.24

Relevé du 15 octobre 2026. Version applicative **0.24.0**, révision préparée **`55fb30aa191fb75f898e5818324c4ec35341ac74`**. L’inventaire privé complète le [relevé public initial](hosting-inventory-2026-10-15.md).

**JessieMessage est désormais servi publiquement en mode neutre.** La release reste distincte du dossier initial conservé. La bascule a été constatée dans le Manager, puis par des requêtes HTTPS anonymes sur le domaine public. L’authentification et toutes les fonctions client restent désactivées.

## 0.23 — Éléments constatés dans le Manager

| Élément | Constat |
| --- | --- |
| Projet | Site Node.js existant associé à JessieMessage ; l’utilisateur a choisi ce projet pour préparer le premier déploiement |
| Capacité | Un emplacement Node.js utilisé sur un disponible ; deux sites au total, dont le site PHP ZTIKIX, hors périmètre |
| Version | Node 24 sélectionné ; le binaire de la session SSH indique **v24.15.0** |
| Lancement initial | `npm start`, commande de build initiale `npm i`, port **3000** |
| Code initial | Modèle `node-basic-landing` version **0.0.1**, sans dépôt Git ni point d’entrée `server/index.mjs` de JessieMessage |
| Base | Aucune base de données affichée dans l’hébergement consulté |
| Adresse temporaire | Elle dessert la même application ; elle ne constitue pas une préproduction indépendante |

Aucun identifiant Manager, nom d’Organisation, utilisateur, adresse IP, alias temporaire ou chemin d’hébergement n’est publié dans ce document. Les ressources ZTIKIX ne sont pas modifiées.

## 0.24 — Préparation et bascule du lancement

- Le dépôt a été cloné dans un dossier voisin distinct du dossier initial, sans remplacer le modèle servi.
- Le SHA complet ci-dessus, la version **0.24.0** et l’absence de modifications suivies dans la copie de travail ont été vérifiés.
- La commande de build du Manager a été adaptée pour rejoindre la release par un chemin relatif, vérifier le SHA, puis exécuter **`npm ci --ignore-scripts`** et **`npm run check`**.
- L’option de non-réinstallation du `node_modules` d’origine a été retenue et son avertissement acquitté. L’installation demandée vise la release.
- Le Manager affiche une coche verte et l’heure **16:46** pour le build ; cette heure est celle de l’interface, sans fuseau consigné.
- Le build a d’abord provoqué un redémarrage automatique du modèle initial, observé dans ses logs Nest. La bascule vers JessieMessage a été effectuée ensuite.
- Le diagnostic de plateforme hébergé confirme `node_runtime: pass` et `sharp_jpeg: pass` ; `scratch_filesystem: not_checked`. Le rapport reste **`incomplete`**, avec **`launchApproved: false`** : aucune sonde de fichiers privés ni preuve de persistance n’est fournie.

Le build vérifie la syntaxe et installe les dépendances verrouillées. Il ne lance ni migration ni bootstrap administrateur. Les commandes de build peuvent être suivies d’un redémarrage par l’hébergeur : conserver la distinction entre le dossier construit et le dossier effectivement lancé.

La commande **Start** rejoint maintenant la release par un chemin relatif, vérifie le SHA exact, fixe les huit drapeaux à `0`, puis exécute `npm start`. Le chemin de site configuré dans le Manager reste inchangé. Le redémarrage a été confirmé dans le Manager après son avertissement ; le navigateur a ensuite affiché l’accueil JessieMessage, son identité et le contact officiel.

Le Manager indique le processus Node actif et ses logs confirment le lancement de **JessieMessage 0.24.0** par `node server/index.mjs`, sur le port **3000**. Dans Chrome, le parcours français → anglais → français a été vérifié sur l’accueil et l’entrée `/app`, avec traduction du titre et du contenu, accès en préparation et aucun choix de rôle ; aucun compte ni aucune base n’ont été créés.

## Premier lancement : site neutre

Cette première activation conserve **les huit drapeaux de fonctionnalités à `0`** : authentification, accès client, chat, médias, CRM, récupération client, diffusions et livraison e-mail. Aucune base, clé applicative ou configuration SMTP n’est nécessaire à ce mode.

Un smoke local du même SHA a confirmé l’absence de pool SQL, les réponses ci-dessous et un arrêt sans échec ni dépassement de délai.

Un contrôle HTTP temporaire a ensuite été effectué **sur l’hébergement**, en boucle locale sur un port éphémère, avec `createConfiguredServer` et les huit drapeaux explicitement à `0` :

- `poolAbsent: true` ; HTTP 200 sur `/`, `/app`, `/api/health`, `/api/entry` et `/manifest.webmanifest`.
- HTTP 503 sur `/api/ready` ; HTTP 404 sur `/admin/login` et `/messages`.
- Toutes ces réponses portent `Cache-Control: no-store` ; le serveur temporaire a été fermé ensuite.

Ce contrôle établit le fonctionnement du processus temporaire sur l’hôte. La contre-vérification publique suivante a été effectuée après la bascule, sans cookie, sans POST, sans suivi des redirections et avec la vérification TLS habituelle de curl.

| Vérification sur `https://jessiemessage.com` | Réponse observée | Heure `Date` HTTP, 15/10/2026 UTC |
| --- | --- | --- |
| `GET /` | HTTP 200, titre `JessieMessage — Espace privé` | 14:56:08 |
| `GET /app` | HTTP 200, titre `JessieMessage — Ouvrir mon espace` | 14:56:17 |
| `GET /api/entry` | HTTP 200, `status: unavailable`, `client: null`, `administrator: null` | 14:56:21 |
| `GET /api/health` | HTTP 200, `status: ok` | 14:56:30 |
| `GET /api/ready` | HTTP **503 attendu**, `status: unavailable`, `Retry-After: 15` | 14:56:36 |
| `GET /manifest.webmanifest` | HTTP 200, `start_url: /app`, `id: /`, `scope: /` | 14:56:41 |
| `GET /admin/login`, `/admin`, `/access`, `/messages`, `/api/auth/session` | HTTP 404, routes privées non enregistrées | 14:56:53–14:57:16 |
| `HEAD /app` | HTTP 200, zéro octet téléchargé | 14:57:54 |
| `GET /i18n.js`, `/styles.css`, `/brand/icon-32.png` | HTTP 200, types JavaScript, CSS et PNG attendus | 14:58:43 |

Les assets contrôlés ont été sélectionnés dans le HTML effectivement reçu. Les réponses HTTP consignées dans ce tableau, y compris les 404 et 503 attendus, portent `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` et une CSP restrictive. Un premier téléchargement de `/i18n.js` depuis l’environnement de contrôle a atteint le délai client de 25 secondes ; le nouvel essai a reçu HTTP 200. La cause de ce délai n’est pas établie.

Le 503 de disponibilité correspond aux fonctions privées désactivées. Ces observations attestent le routage HTTPS neutre à cet instant ; elles ne prouvent ni SQL, ni compte administrateur, ni parcours client, ni charge, persistance ou arrêt par l’hébergeur.

## État des vérifications

- [x] Diagnostic de plateforme hébergé : Node et JPEG Sharp réussis ; système de fichiers non sondé, rapport incomplet.
- [x] Contrôle HTTP hébergé en boucle locale, fonctions désactivées et serveur temporaire fermé.
- [x] Ancienne cible et commande `npm start` conservées pour le retour arrière.
- [x] Huit drapeaux explicitement désactivés dans la commande Start.
- [x] Bascule du lancement vers la release et démarrage public de JessieMessage.
- [x] Smoke HTTPS horodaté et routage public constatés ci-dessus.
- [x] Dossier du modèle initial conservé ; retour arrière non exercé.

## Retour arrière préparé, non exercé

Conserver le dossier initial et ses paramètres de lancement. Le chemin de site Manager restant inchangé, rétablir la commande Start initiale **`npm start`** permet de revenir au lancement du modèle, puis de le relancer. Restaurer également la commande de build initiale si nécessaire, sans réinstaller ses dépendances par simple précaution.

Après un retour arrière, constater à nouveau l’accueil du modèle et les réponses publiques attendues pour celui-ci. La release peut être conservée pour diagnostic ; aucun nettoyage récursif n’est requis. Cette activation neutre n’introduit ni migration SQL ni stockage média à restaurer.

L’activation ultérieure de l’authentification demeure une phase distincte : base isolée, TLS SQL, permissions, schéma, clé MFA et initialisation administrateur doivent suivre les [diagnostics opérateur](preproduction-preflight.md) et la [recette de préproduction](preproduction-acceptance.md). L’adresse officielle reste **contact@jessiemessage.com**.

Capture de contrôle de l’accueil public, sans information du Manager :

![Accueil JessieMessage hébergé](evidence/first-hosted-home-1792076222830.jpg)
