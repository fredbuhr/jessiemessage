# Accueil public neutre sur Apache

## État et portée

L’export est préparé et ses huit tests de construction passent. Le comportement HTTP sur un véritable serveur Apache n’a pas encore été vérifié. Ce document ne constitue donc pas une validation de l’hébergement, du certificat, des réécritures ou de l’installation PWA.

Le but est de conserver l’accueil `/` et l’ouverture neutre `/app` sur un site Apache ordinaire, pendant que le projet Node sert à la recette. Le bundle ne contient ni PHP, ni proxy vers Node, ni authentification, ni connexion SQL, ni fichier de configuration privée. Les fichiers sources du projet restent hors du document root public.

La séparation des sites, des routes et des document roots ne crée pas une isolation entre UID ou ressources d’hébergement partagées.

## Contenu fermé : 25 fichiers

Les 21 fichiers suivants sont copiés octet pour octet :

- `index.html`, `styles.css`, `app.js` ;
- `entry.html`, `entry.js`, `entry-model.js`, `entry.css` ;
- `i18n.js`, `i18n.css` ;
- `manifest.webmanifest`, `favicon.ico`, `apple-touch-icon.png` ;
- `brand/brand.css` ;
- `brand/icon-16.png`, `brand/icon-32.png`, `brand/icon-48.png`, `brand/icon-64.png`, `brand/icon-128.png`, `brand/icon-192.png`, `brand/icon-512.png`, `brand/icon-maskable-512.png`.

Quatre fichiers sont générés : `.htaccess`, `_neutral/entry.json`, `_neutral/health.json`, `_neutral/unavailable.json`. La liste fermée exclut les autres fichiers présents dans `public/`, les contrôleurs privés, les sources serveur et les fichiers opérateur. Aucun portrait ou média personnel n’est ajouté.

Le JSON d’entrée est constant :

```json
{"status":"unavailable","client":null,"administrator":null}
```

Cette réponse conserve le message de préparation de `/app`, avec les deux choix de connexion masqués. Le point `/api/health` est un signal statique de présence du site Apache : il ne mesure pas le processus Node. `/api/ready` reste indisponible et ne certifie aucun service privé.

## Construction

Utiliser Node.js 24 depuis le checkout. Remplacer le chemin d’exemple par une nouvelle feuille absolue, sous un parent existant et canonique, hors du checkout et de son `public/` :

```sh
umask 022
node scripts/build-neutral-site.mjs --output /absolute/new-public-export
```

Avec `umask 022`, les nouveaux répertoires ont le mode `0755` et les fichiers le mode `0644`. Un umask plus restrictif peut empêcher Apache de lire le bundle ; le bâtisseur ne corrige jamais les permissions de chemins existants.

La destination doit être inexistante. Les symlinks de destination ou d’ancêtres, les destinations dans le checkout et les chemins contenant `.` ou `..` sont refusés. Les sources requises sont vérifiées avant la création de la sortie ; les fichiers de sortie sont créés exclusivement. Effectuer la construction sans modification concurrente des sources ou du système de fichiers : les contrôles d’identité ne constituent pas une garantie contre toutes les courses ou les alias de montage.

La sortie standard est un manifeste déterministe : noms relatifs, tailles, SHA-256 et total d’octets. Elle ne contient pas de chemin machine, de date ou de valeur d’environnement. Deux constructions à sources identiques doivent produire le même manifeste.

En cas d’échec, aucun succès n’est annoncé. Un répertoire incomplet peut être conservé : ne pas le publier et utiliser une nouvelle destination pour une autre tentative.

Contrôles locaux :

```sh
node --test tests/neutral-site-build.test.mjs
npm run check
```

Ces tests vérifient les copies, le manifeste, la surface déclarée, l’exclusion des fichiers privés supplémentaires et les refus de destination. Ils n’exécutent pas Apache.

## Prérequis du nouveau site Apache

Préparer un document root distinct ne contenant que les 25 fichiers de l’export réussi. Inclure `.htaccess` lors du transfert ; conserver exactement les octets et vérifier le manifeste avant exposition.

La configuration générée requiert Apache 2.4, `mod_rewrite`, `mod_headers`, `mod_mime`, `mod_dir`, ainsi que les autorisations `AllowOverride` correspondant aux directives de réécriture, d’en-têtes, d’options et d’index. Elle désactive les listings et `MultiViews`. Les directives requises ne sont pas masquées par des blocs `IfModule` : une incompatibilité doit être constatée et corrigée sur le nouveau site avant tout déplacement de trafic.

Vérifier aussi le HTTPS et le certificat du domaine de préparation. Aucun achat, changement DNS, rattachement de domaine ou déplacement du projet Node n’est effectué par le bâtisseur.

## Matrice HTTP à prouver avant tout déplacement DNS ou de domaine

Effectuer les contrôles sur le nouveau site de préparation, avec un client HTTP réel. Les statuts, les en-têtes et les corps ci-dessous sont les résultats attendus, pas encore une preuve obtenue sur Apache.

| Requête | Résultat attendu |
|---|---|
| GET `/`, `/index.html`, `/app` | 200 HTML ; accueil et ouverture existants conservés |
| HEAD `/`, `/app`, fichier CSS ou PNG | Statut correspondant, sans corps de réponse |
| GET des 20 fichiers directement autorisés | 200 ; MIME correct, octets et SHA-256 identiques au manifeste |
| GET `/api/entry` | 200 JSON neutre exact, aucune identité ni destination privée |
| HEAD ou POST `/api/entry` | 405, `Allow: GET` ; HEAD sans corps |
| GET `/api/entry?x=1` et `/api/entry?` | 400 |
| GET `/api/health` | 200 JSON `{"status":"ok"}` |
| HEAD `/api/health` | 200, sans corps |
| GET `/api/ready` | 503 JSON `{"status":"unavailable"}`, `Retry-After: 15` |
| HEAD `/api/ready` | 503 avec les mêmes en-têtes, sans corps |
| GET/HEAD `/entry.html`, `/_neutral/entry.json`, `/_neutral/health.json`, `/_neutral/unavailable.json` | 404 ; les fichiers internes ne sont pas des routes publiques directes |
| GET/HEAD `/admin`, `/admin/login`, `/access`, `/messages`, `/api/auth/session`, `/chat.js`, `/server/index.mjs` | 404 |
| GET/HEAD `/brand/` et chemins inconnus | 404, sans listing |
| Tentatives de traversée vers un fichier hors allowlist | Refus HTTP, sans dépassement du document root |
| POST d’un fichier public | 405, `Allow: GET, HEAD` |

Vérifier `Cache-Control: no-store` sur les réponses de succès et d’erreur, les en-têtes de sécurité générés et l’absence de `Set-Cookie`. Le `ErrorDocument 503` doit conserver le statut 503 et servir le JSON interne avec le bon MIME, sans rendre son URL directement accessible. Les corps d’erreur 400/404/405 peuvent différer des réponses JSON du serveur Node ; `/app` rejette les réponses non-200 avant d’en lire le contenu.

Exemples de commandes, après remplacement de l’origine fictive par le nouveau domaine de préparation :

```sh
NEUTRAL_PREVIEW_ORIGIN='https://neutral-preview.example.invalid'
curl --silent --show-error --dump-header - "$NEUTRAL_PREVIEW_ORIGIN/api/entry"
curl --silent --show-error --head "$NEUTRAL_PREVIEW_ORIGIN/api/entry"
curl --silent --show-error --dump-header - "$NEUTRAL_PREVIEW_ORIGIN/api/ready"
curl --silent --show-error --head "$NEUTRAL_PREVIEW_ORIGIN/api/ready"
curl --silent --show-error --dump-header - "$NEUTRAL_PREVIEW_ORIGIN/_neutral/unavailable.json"
curl --silent --show-error --request POST --dump-header - "$NEUTRAL_PREVIEW_ORIGIN/api/entry"
```

Compléter avec un navigateur : rendu FR/EN, navigation `/` vers `/app`, message de préparation sans lien de connexion, nouvelle vérification et retour après masquage de l’onglet. Aucune requête ne doit être transférée au projet Node de recette.

Un sous-domaine de préparation permet cette preuve sans déplacer immédiatement l’origine publique. Le manifeste conserve `id: "/"` et `start_url: "/app"` : une PWA installée sur une autre origine reste distincte. Le maintien des URL et de la PWA publiques exige donc de vérifier ensuite le rattachement de l’origine publique au site Apache, avec un plan de retour établi avant toute bascule.
