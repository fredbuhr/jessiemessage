# Accueil public neutre sur Apache

## État et portée

Le **15 octobre 2026 à 20:48:01.679 UTC**, le probe HTTPS réel a réussi ses **91 requêtes et 1 033 assertions**, sans assertion en échec, sur le site Apache de préparation. Le client vérifiait le certificat et utilisait TLS 1.2 au minimum, avec un User-Agent explicite identifiant fidèlement l’outil. Les SHA-256 des 22 routes publiques, les méthodes et requêtes invalides, les JSON neutres, les HEAD sans corps, les en-têtes de sécurité, l’absence de cookie, le 503 avec `Retry-After` et les refus privés/internes ont passé leurs contrôles.

Le 403 initial sur `/` venait du premier client Node, qui omettait User-Agent : les journaux du site ont confirmé le refus par ModSecurity des requêtes de ce type. L’identification du client a été corrigée ; le WAF est resté actif. Ce diagnostic remplace l’hypothèse initiale d’un problème d’index.

Quatre avertissements de format restent signalés : les réponses 405 à HEAD/POST/OPTIONS `/api/entry` et POST `/styles.css` ajoutent un élément vide final à `Allow`. Le destinataire ignore cet élément et vérifie l’ensemble exact des méthodes ; la sémantique attendue passe. La génération de cet élément vide reste une particularité non conforme de l’émetteur, décrite ci-dessous, et n’est pas présentée comme corrigée.

Les dix jobs CI associés au code d’export hébergé, révision `921919b4`, sont verts. Chrome a aussi confirmé l’accueil, le passage FR/EN et la nouvelle vérification de `/app`. Cette preuve précède la bascule de l’origine publique ; elle ne certifie pas l’installation PWA ni le fonctionnement de services privés.

Le but est de conserver l’accueil `/` et l’ouverture neutre `/app` sur un site Apache ordinaire, pendant que le projet Node sert à la recette. Le bundle ne contient ni PHP, ni proxy vers Node, ni authentification, ni connexion SQL, ni fichier de configuration privée. Les fichiers sources du projet restent hors du document root public.

La séparation des sites, des routes et des document roots ne crée pas une isolation entre UID ou ressources d’hébergement partagées.

## Bascule des domaines en attente

Le site Apache de préparation est opérationnel en HTTPS avec le résultat de probe ci-dessus. Le projet Node existant reste associé à l’origine publique actuelle et à celle de recette ; ses fonctionnalités privées restent désactivées. Aucune inversion de domaine principal, déliaison ou modification DNS n’a été validée.

Dans le Manager, l’action destinée à rendre le domaine de recette principal a affiché un avertissement explicite de perte des statistiques Web de l’ancien nom. Cet avertissement n’a pas été confirmé. Le changement reste en attente d’une validation explicite de cet impact, au moment de l’action, sur la base du site public neutre préparé et vérifiable. Le succès du probe ne vaut pas autorisation de cette perte de données.

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

La configuration générée requiert Apache 2.4, `mod_rewrite`, `mod_headers`, `mod_mime`, `mod_dir`, ainsi que les autorisations `AllowOverride` correspondant aux directives de réécriture, d’en-têtes, d’options et d’index. Elle réinitialise les candidats d’index avec `DirectoryIndex disabled`, puis déclare sur une ligne distincte `DirectoryIndex index.html`. Les listings et `MultiViews` restent désactivés. Elle efface `Allow` dans les tables `onsuccess` et `always` avant les valeurs propres aux réponses 405. Les directives requises ne sont pas masquées par des blocs `IfModule` : une incompatibilité doit être constatée et corrigée sur le nouveau site avant tout déplacement de trafic.

Références Apache : [recherche et réinitialisation de `DirectoryIndex`](https://httpd.apache.org/docs/2.4/mod/mod_dir.html#directoryindex), [tables d’en-têtes `onsuccess` et `always`](https://httpd.apache.org/docs/2.4/mod/mod_headers.html#header).

Vérifier aussi le HTTPS et le certificat du domaine de préparation. Aucun achat, changement DNS, rattachement de domaine ou déplacement du projet Node n’est effectué par le bâtisseur.

## Matrice HTTP à prouver avant tout déplacement DNS ou de domaine

Effectuer les contrôles avec un client HTTP réel s’identifiant explicitement. La campagne réussie décrite plus haut porte sur les routes fixes du site de préparation. Le tableau reste la spécification à rejouer sur chaque nouvelle origine ; les variantes de traversée constituent un contrôle complémentaire.

Pour `Allow`, comparer l’ensemble exact des jetons de méthode, en conservant leur casse, plutôt que la chaîne brute. [RFC 9110, §10.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.1) définit `Allow` comme une liste `#method`. Le [§5.6.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2) impose au destinataire d’ignorer un nombre raisonnable d’éléments vides ; le [§5.6.1.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.1) interdit à l’émetteur d’en générer. Le probe conserve donc un avertissement distinct pour cette anomalie Apache tout en refusant les méthodes supplémentaires ou manquantes.

| Requête | Résultat attendu |
|---|---|
| GET `/`, `/index.html`, `/app` | 200 HTML ; accueil et ouverture existants conservés |
| HEAD `/`, `/app`, fichier CSS ou PNG | Statut correspondant, sans corps de réponse |
| GET des 20 fichiers directement autorisés | 200 ; MIME correct, octets et SHA-256 identiques au manifeste |
| GET `/api/entry` | 200 JSON neutre exact, aucune identité ni destination privée |
| HEAD, POST ou OPTIONS `/api/entry` | 405 ; ensemble `Allow` exactement `{GET}` ; HEAD sans corps ; élément vide signalé séparément |
| GET `/api/entry?x=1` et `/api/entry?` | 400 |
| GET `/api/health` | 200 JSON `{"status":"ok"}` |
| HEAD `/api/health` | 200, sans corps |
| GET `/api/ready` | 503 JSON `{"status":"unavailable"}`, `Retry-After: 15` |
| HEAD `/api/ready` | 503 avec les mêmes en-têtes, sans corps |
| GET/HEAD `/entry.html`, `/_neutral/entry.json`, `/_neutral/health.json`, `/_neutral/unavailable.json` | 404 ; les fichiers internes ne sont pas des routes publiques directes |
| GET/HEAD `/admin`, `/admin/login`, `/access`, `/messages`, `/api/auth/session`, `/chat.js`, `/server/index.mjs` | 404 |
| GET/HEAD `/brand/` et chemins inconnus | 404, sans listing |
| Tentatives de traversée vers un fichier hors allowlist | Refus HTTP, sans dépassement du document root |
| POST d’un fichier public | 405 ; ensemble `Allow` exactement `{GET, HEAD}` ; élément vide signalé séparément |

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

Compléter avec un navigateur : rendu FR/EN, navigation `/` vers `/app`, message de préparation sans lien de connexion, nouvelle vérification et retour après masquage de l’onglet. Le rendu et la nouvelle vérification ont été observés sur le site de préparation ; conserver ces contrôles lors du changement d’origine. Aucune requête ne doit être transférée au projet Node de recette.

Le probe horodaté ci-dessus a été effectué avant la bascule de l’origine publique, sur le sous-domaine de préparation. Le manifeste conserve `id: "/"` et `start_url: "/app"` : une PWA installée sur une autre origine reste distincte. Le maintien des URL et de la PWA publiques exige donc de vérifier ensuite le rattachement de l’origine publique au site Apache et de rejouer les contrôles, avec un plan de retour établi avant toute bascule.
