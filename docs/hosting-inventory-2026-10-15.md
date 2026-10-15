# Inventaire d’hébergement — étape 0.23

Relevé du 15 octobre 2026. Lot documentaire sur `feat/hosting-inventory`, construit sur la PR #25, commit `bdcdb833e4bc76ae057d0884bb6bcf7d97ab9b08`. La version applicative reste 0.24.0 ; ce lot ne change aucun code, migration ou paramètre de service.

**Suivi ultérieur :** le [compte a ensuite été consulté et la version neutre démarrée](first-hosted-start.md). Un 502 observé après les premiers contrôles reste à diagnostiquer ; la disponibilité actuelle n’est pas confirmée. Les observations et inconnues ci-dessous sont conservées comme état initial horodaté ; elles ne décrivent plus seules l’état actuel du site.

## Constat public

Cinq requêtes HTTPS GET anonymes ont été effectuées, sans cookie, sans suivi des redirections et avec la vérification TLS habituelle de curl. Les réponses ont été reçues entre **13:31:37 et 13:32:13 UTC**, soit **15:31:37–15:32:13 à Paris**.

| URL sur `https://jessiemessage.com` | Réponse observée | Interprétation limitée |
| --- | --- | --- |
| `/` | HTTP 200, HTML, titre `Website Node.js`, accueil `Welcome to your new website` et identité Infomaniak | Page d’accueil par défaut visible sur le domaine public |
| `/app` | HTTP 404, JSON | Entrée JessieMessage non disponible à cette adresse |
| `/api/health` | HTTP 404, JSON | Sonde JessieMessage non disponible à cette adresse |
| `/api/ready` | HTTP 404, JSON | Sonde de disponibilité JessieMessage non disponible à cette adresse |
| `/manifest.webmanifest` | HTTP 404, JSON | Manifeste JessieMessage non disponible à cette adresse |

Ces observations concordent avec le contrôle public de l’audit initial. Elles ne permettent d’identifier ni le projet privé responsable, ni une éventuelle autre URL de préproduction, ni la version Node réellement sélectionnée, ni une base ou un stockage. Aucun sous-domaine supposé n’a été exploré. Le résultat ne prouve pas l’absence du code sur tout l’hébergement.

## Accès encore nécessaire

La recherche d’intégration Infomaniak n’a renvoyé aucun plugin adapté parmi les résultats disponibles. Aucune connexion au Manager, session de compte ou configuration privée n’a été consultée. L’utilisateur ne connaît pas encore l’état de la préproduction. Le relevé privé ci-dessous reste donc **à effectuer**.

L’objectif immédiat est la consultation des écrans existants, avant toute création, installation, modification DNS, changement de version, commande de build ou redémarrage. Les ressources ZTIKIX doivent être identifiées comme hors périmètre.

## Relevé dans le Manager

Les parcours ci-dessous proviennent de la documentation officielle consultée le 15 octobre ; ils peuvent différer selon les droits du compte et son organisation.

| Écran à consulter | Élément à constater | État actuel |
| --- | --- | --- |
| [Manager](https://manager.infomaniak.com), bonne Organisation, Web & Domaines → Hébergement, puis nom du produit | Hébergement et site associés à `jessiemessage.com` ; existence d’un projet distinct pour la recette | Non constaté |
| Tableau du site, domaines et certificat | Domaine exact attribué au projet ; existence d’un sous-domaine de préproduction et certificat associé | Non constaté |
| Site → Gérer les paramètres avancés → Node.js | Version courante, dossier d’exécution, commandes build/lancement et port affichés, sans enregistrer | Non constaté |
| Hébergement → Bases de données, ou MariaDB → Bases de données / Utilisateurs | Existence d’une base dédiée, version serveur et deux identités séparées pour migration/runtime ; droits affichés | Non constaté |
| Informations de cet hébergement / Informations de ce site | Emplacements affichés, à garder privés ; possibilité d’un répertoire privé hors du checkout | Non constaté |

Un produit invisible ou grisé ne suffit pas à conclure qu’il n’existe pas : vérifier l’Organisation sélectionnée et les droits. Ne pas créer un second produit pour contourner une absence d’affichage. Sources : [navigation et organisations, FAQ 1990](https://www.infomaniak.com/fr/support/faq/1990/decouvrir-le-manager-linterface-dadministration-infomaniak), [tableau de bord Node.js, FAQ 2537](https://www.infomaniak.com/fr/support/faq/2537/creer-un-site-nodejs-chez-infomaniak), [configuration Node.js, FAQ 2535](https://www.infomaniak.com/fr/support/faq/2535/modifier-la-configuration-dun-site-nodejs-infomaniak), [bases et utilisateurs, FAQ 1981](https://www.infomaniak.com/fr/support/faq/1981/gerer-les-utilisateurs-et-bases-de-donnees-mysqlmariadb), [emplacements, FAQ 2093](https://www.infomaniak.com/fr/support/faq/2093/afficher-le-chemin-absolu-dun-hebergement-et-dun-site).

Le diagnostic général « État des domaines » est [signalé indisponible pour les sites Node.js](https://www.infomaniak.com/fr/support/faq/2251/verifier-automatiquement-les-liens-hebergement-web-et-domaine-diagnostic-dns) ; consulter la fiche du site pour ce relevé.

Les noms de domaines, la version Node et les états des services suffisent pour le bilan de reprise. Ne pas révéler les mots de passe ou variables privées et ne pas ouvrir leur affichage pour cet inventaire. Conserver les identifiants SQL, chemins de compte et détails d’Organisation hors du dépôt public. Aucun secret de production, TOTP, code de secours ou cookie n’est nécessaire dans la discussion.

## Points à résoudre après identification

La FAQ 1981 associe aux droits d’écriture `CREATE TEMPORARY TABLES` et `LOCK TABLES`, en plus des écritures usuelles. Le diagnostic `runtimePrivileges` de `server/preflight/database.mjs` n’accepte actuellement que `USAGE` et le DML attendu. **Déduction à vérifier sur le compte :** si le runtime reçoit tous ces droits, le diagnostic de privilèges le refusera. Cela ne prouve ni les droits réellement attribués ni l’impossibilité d’un réglage plus fin. Relever les options disponibles et, ultérieurement, les grants réels en lecture seule avant de décider ; aucune protection n’est assouplie dans ce lot.

La présence d’un chemin dans le Manager ne prouve pas sa confidentialité, ses permissions ou sa persistance après rebuild. De même, l’existence d’une base ne prouve pas TLS, l’accès du runtime, les contraintes ou l’association à ce projet. Ces contrôles restent distincts de l’inventaire visuel.

La [recette Chrome/HTTPS/MariaDB](authentication-rehearsal.md) de la PR #25 est verte sur le SHA ci-dessus : 1301 tests généraux, 313 tests par version MariaDB et quatre scénarios Chrome. Cette preuve CI ne doit pas être attribuée à Infomaniak. Après le relevé privé, fixer la cible isolée puis suivre les [diagnostics opérateur](preproduction-preflight.md) et la [recette d’hébergement](preproduction-acceptance.md). Ne jamais exécuter `test:db` ou `test:auth-browser` sur une base à conserver.

L’adresse officielle reste **contact@jessiemessage.com**. Aucun compte, base, clé, e-mail, domaine ou service n’est créé ou modifié par cet inventaire.
