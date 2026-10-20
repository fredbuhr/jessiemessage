# Évolution 1 — Lecture privée, 1.1.0

**20 octobre 2026 — code fusionné et publié en 1.1.0, CI PR/main et préparation Infomaniak réussies ; activation 1.1.0 non constatée.** La [PR 110](https://github.com/fredbuhr/jessiemessage/pull/110) est fusionnée sur `84669ed570b59b10a1a94a164f24f0e60e6cb5a7`, arbre `0201cdbd1932fd9104c04a91d63561010e8ae0c2`. La [CI du commit de fusion](https://github.com/fredbuhr/jessiemessage/actions/runs/39490336793) a réussi 5/5 jobs. Le [tag/release v1.1.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.1.0) a été publié le 20 octobre à 20:21:26 UTC sur ce même commit et sa cible a été relue.

Base de travail : `main` `e2c5397c64e0e68f959f77fcf417722871b5a677`, après la référence [v1.0.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.0.0) livrée sur `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`. Le travail auparavant préparé sous le numéro provisoire 0.87 est reporté séparément en `1.1.0` ; ses anciens résultats ne qualifient pas cette livraison. L’[état courant](REPRISE.md) reste la référence du service réellement déployé. Le reçu SSH utilisateur confirme maintenant le staging 1.1.0 ; aucune preuve d’activation 1.1.0 n’est consignée à ce stade. La dernière identité active connue et le checkpoint restent 1.0.0.

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

Revues indépendantes serveur et interface sans défaut concret relevé. Sous Node local 24.19.0 : **215 tests ciblés réussis, zéro échec/omission** — 78 backend, 59 interface et 78 de compatibilité exports ZIP/HTTP, médias, accessibilité et identité de version. Pour la dernière série, `TMPDIR` désigne un répertoire temporaire local accessible, car `/tmp` est absent de cet environnement ; le premier lancement avait échoué pour cette seule condition. Syntaxe des **570 sources** et build du code porté réussis. Les prérequis MariaDB et Chrome ne sont pas qualifiés localement ; leurs contrôles natifs sont ceux de la CI PR ci-dessous, sous Node 24.22.0.

La [CI de la PR 110, run 39489455741](https://github.com/fredbuhr/jessiemessage/actions/runs/39489455741) a réussi **5/5 jobs** :

| Contrôle | Résultat constaté |
| --- | --- |
| Général | **3 151 tests : 3 116 réussis, zéro échec, 35 ignorés** ; build et syntaxe réussis. |
| MariaDB 10.11 | **468/468**, aucune omission. |
| MariaDB 11.4 | **468/468**, aucune omission. |
| Chrome — clavier et cycle de conversation | **165/165**. |
| Chrome — authentification et messagerie HTTPS/MariaDB | **2/2**. |

La [CI main, run 39490336793](https://github.com/fredbuhr/jessiemessage/actions/runs/39490336793), contrôle le commit de fusion `84669ed570b59b10a1a94a164f24f0e60e6cb5a7` ; elle a réussi **5/5 jobs**, avec les mêmes scores constatés que ceux du tableau : général 3 116 réussis/35 ignorés, MariaDB 468/468 chacune, Chrome 165/165 et HTTPS 2/2, sans échec. Son arbre est identique à celui de la PR. Aucun score ancien n’est repris comme preuve actuelle ; les 35 tests ignorés restent non vérifiés par la suite générale. La CI ne prouve ni publication de release ni déploiement.

La [publication automatisée](https://github.com/fredbuhr/jessiemessage/actions/runs/39491254060) a réussi et produit `published_verified`. Elle vérifie le commit, l’arbre, la version, la CI main et ses cinq jobs avant de créer le tag/release immuable, sans déplacer un tag existant. Aucun navigateur cloud ni jeton personnel n’a été nécessaire. Reste à déployer ce même commit sur le service existant avec repli vers `v1.0.0` ; le staging est confirmé par le reçu utilisateur ci-dessous, et le redémarrage 1.1.0 reste à constater. La livraison sera confirmée par une identité fraîche du processus et les contrôles adaptés. Aucun envoi, effacement de compte ou contenu client réel n’est nécessaire à cette qualification. Les autres évolutions de messagerie restent distinctes.

## Livraison 1.1.0 : reprise après staging

Préparation réalisée, sans activation constatée. Cible épinglée : commit `84669ed570b59b10a1a94a164f24f0e60e6cb5a7`, arbre `0201cdbd1932fd9104c04a91d63561010e8ae0c2`, préfixe `84669ed5`. La CI main complète verte et le tag/release immuable `v1.1.0` sur ce commit exact sont acquis. [REPRISE](REPRISE.md) conserve la production **1.0.0** jusqu’à la preuve de la nouvelle identité.

### 1. Préparation seule

**Déjà exécutée et confirmée par le reçu utilisateur ci-dessous. Ne pas répéter cette étape ; passer à l’activation Manager.**

Dans le [terminal SSH existant](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), la préparation épinglée crée le checkout et les lanceurs, puis exécute uniquement `check-local-closures`. Le reçu attendu est `staged_precheck_passed`, sur les source/arbre ci-dessus, avec `pendingClosures:false`, `started:false`, `erased:false`, `managerChanged:false` et `runtimeStarted:false`. Si un champ diffère, conserver 1.0.0 en service et arrêter avant l’étape Manager, même si le statut annonce un précontrôle réussi. Ce reçu ne prouve pas une activation. Après une interruption, relire les fichiers et reçus existants avant de rejouer la préparation.

Le [script publié](https://github.com/fredbuhr/jessiemessage/blob/002f883291df1785513173dfb18a29ff41b74fcd/ops/prepare-release110.sh) est épinglé par commit et SHA-256. Son algorithme a passé **4/4 cas synthétiques locaux** ; seuls les deux pins source/arbre ont ensuite été remplacés, avec vérification de syntaxe Bash/Python et relecture identique du fichier publié. Ces tests ne remplacent pas le reçu serveur.

```sh
python3 - <<'PY110'
import hashlib, subprocess, urllib.request
url = "https://raw.githubusercontent.com/fredbuhr/jessiemessage/002f883291df1785513173dfb18a29ff41b74fcd/ops/prepare-release110.sh"
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != "2eca0cbe20905cabb0256d23ac1409cb35fb0b3544154eb0b01912083e849517":
    raise SystemExit("Empreinte incorrecte : arrêt.")
subprocess.run(
    ["bash", "-s", "--", "84669ed570b59b10a1a94a164f24f0e60e6cb5a7"],
    input=code, check=True
)
PY110
```

### Préparation constatée — ne pas répéter

Le retour du terminal SSH transmis par l’utilisateur confirme `staged_precheck_passed` sur `84669ed570b59b10a1a94a164f24f0e60e6cb5a7`, arbre `0201cdbd1932fd9104c04a91d63561010e8ae0c2`, version `1.1.0`. Ce reçu est rapporté par l’utilisateur ; son heure d’exécution n’a pas été transmise et n’est pas inventée.

| Élément préparé | Valeur du reçu |
| --- | --- |
| Checkout | `/srv/customer/jessiemessage-operator/production-110-84669ed5` |
| Lanceur | `/srv/customer/jessiemessage-private/start-primary-release110-84669ed5.sh`, 0700, SHA-256 `4d28485da98fb33acdf0f50e2f420a43893f4c0c5495c068b6a6854de9e1cc8b` |
| Node | `v24.22.0`, SHA-256 `67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c` |
| Journal normal | `/srv/customer/jessiemessage-private/jm110-node2422.log`, 0600 |
| Journal de précontrôle | `/srv/customer/jessiemessage-private/jm110-preflight-84669ed5.log`, SHA-256 `cb5a9e6d1d1354abe8113cb12e7c6e3d636b5111041851ada88f85c5b845fea6` |
| États | `pendingClosures:false`, `started:false`, `erased:false`, `managerChanged:false`, `runtimeStarted:false` |
| Repli confirmé | `1.0.0`, lanceur `/srv/customer/jessiemessage-private/start-primary-release100-70b48aa8.sh`, Node `v24.22.0` |

La préparation est acquise ; passer à l’activation Manager ci-dessous. Elle ne prouve ni Build ni identité active de la 1.1.0. La commande de préparation ci-dessus reste une trace de la procédure exécutée et ne doit pas être rejouée.

### 2. Activation par le Manager

Ouvrir les [réglages de l’application existante](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application). Conserver le service, le port 3000 et ses autres paramètres. Enregistrer ces deux champs :

**Run**

```sh
bash /srv/customer/jessiemessage-private/start-primary-release110-84669ed5.sh
```

**Build**

```sh
cd /srv/customer/jessiemessage-operator/production-110-84669ed5 &&
test "$(git rev-parse HEAD)" = 84669ed570b59b10a1a94a164f24f0e60e6cb5a7 &&
test "$(git rev-parse 'HEAD^{tree}')" = 0201cdbd1932fd9104c04a91d63561010e8ae0c2 &&
jm_build_status=$(git status --porcelain --untracked-files=normal) && test -z "$jm_build_status" &&
test "$(sha256sum /srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node | cut -d ' ' -f 1)" = 67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c &&
env -u NODE_OPTIONS -u NODE_PATH /srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node scripts/check-syntax.mjs
```

Relire les paramètres enregistrés, revenir au [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard), puis lancer le cycle normal **Build**, avec **Non** pour la réinstallation des dépendances. Attendre le Build réussi et l’état **Actif** ; ce cycle redémarre le service avec le nouveau Run.

### 3. Confirmer le processus répondant

Dans [État du service](https://jessiemessage.com/admin/readiness), choisir **Actualiser la page → Détails techniques**, puis conserver ces quatre valeurs :

| Champ | Valeur attendue |
| --- | --- |
| Version de l’application | `1.1.0` |
| Commit au démarrage | `84669ed570b59b10a1a94a164f24f0e60e6cb5a7` |
| Version Node.js | `v24.22.0` |
| Relevé au démarrage | Texte fraîchement affiché après ce Build, conservé tel quel. |

Cette lecture authentifiée identifie le processus HTTP répondant. Conserver le texte de date et son éventuel fuseau sans déduire une conversion absente. Les réponses publiques de santé/disponibilité complètent le contrôle de disponibilité ; elles ne prouvent pas la version. Mettre ensuite REPRISE et le checkpoint opérateur à jour avec les preuves observées et le repli conservé.

### Repli immédiat : 1.0.0

Conserver le checkout `production-100-70b48aa8`, source `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`, arbre `485cade0aeeee41cb4c34f913cd98f6078c4636b`, et le lanceur privé SHA-256 `aa400abaa54033308acce7f4b28649b33d4ecc5f7098eec7b020c05631123248`. Pour un repli, remettre ces deux champs dans les mêmes réglages Manager, puis suivre le même cycle Build et vérifier l’identité `1.0.0` dans l’administration.

**Run 1.0.0**

```sh
bash /srv/customer/jessiemessage-private/start-primary-release100-70b48aa8.sh
```

**Build 1.0.0**, repris de [REPRISE](REPRISE.md#build-de-la-référence-active) :

```sh
cd /srv/customer/jessiemessage-operator/production-100-70b48aa8 &&
test "$(git rev-parse HEAD)" = 70b48aa845b70ca960724c8d37a6e94b3d5f47a8 &&
test "$(git rev-parse 'HEAD^{tree}')" = 485cade0aeeee41cb4c34f913cd98f6078c4636b &&
jm_build_status=$(git status --porcelain --untracked-files=normal) && test -z "$jm_build_status" &&
test "$(sha256sum /srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node | cut -d ' ' -f 1)" = 67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c &&
env -u NODE_OPTIONS -u NODE_PATH /srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node scripts/check-syntax.mjs
```

Aucune migration SQL n’accompagne cette livraison ni son repli. Les clés, configurations, médias, sessions, PC et états D1 restent conservés.
