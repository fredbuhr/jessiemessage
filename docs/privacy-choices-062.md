# Choix confirmés et présentation simplifiée — 0.62

Le 18 octobre 2026, le propriétaire confirme : « aucune structure, uniquement Jessie en France », espace privé, et conservation de la conversation jusqu’à la fermeture définitive du compte. Ces réponses sont acquises ; elles ne doivent plus être demandées à chaque reprise. Elles ne constituent pas une conclusion sur une exemption juridique liée à l’usage privé.

## Comportement livré

L’administration affiche directement Jessie — France, le contact existant et le critère de conservation. Le dossier détaillé est facultatif et replié à l’ouverture. L’aide publique existante reprend ces faits en français et en anglais. Déconnexion, expiration ou suspension de l’accès ne signifient pas fermeture définitive ; les suppressions volontaires de messages et photos restent possibles.

Les choix confirmés sont définis dans `server/privacy/choices.mjs`, séparément des notes modifiables. Une préparation nouvelle préremplit D01 et D04. Une préparation déjà enregistrée conserve intégralement son texte et sa révision ; elle n’est ni migrée ni remplacée. Les réponses de l’API exposent les choix indépendamment du brouillon et n’autorisent pas leur modification par un POST de préparation. Le stockage chiffré, ses clés et son format sont inchangés.

Le brouillon complet reste privé et incomplet. Les indicateurs `publication: draft_only` et `retention: not_enabled` concernent cette préparation, et ne nient pas le critère de conversation désormais confirmé. L’aide indique que la suppression du compte n’est pas disponible directement dans l’application. L’administration indique explicitement que l’effacement complet reste à terminer ; `permanentClosure: not_implemented` est conservé dans la politique.

## Limites et suite

Ce lot complète les faits connus de l’itération 1 sur 6 ; il ne clôt pas les conditions et traitements encore à préciser pour une notice définitive. Aucune suppression réelle, migration SQL, expiration générale ou nouvelle durée de sauvegarde n’est déclenchée. Les fichiers téléchargés et sauvegardes restent des copies distinctes. Les autres décisions seront traitées avec les fonctions correspondantes, sans rouvrir Jessie/France ni la conservation des conversations.

La suite du plan reste : moteur d’effacement complet, interface simple et application des règles, preuve actuelle de déchiffrement/restauration, surveillance externe indépendante, puis recette/consolidation. Les mails de test reçus sont acquis et ne sont pas renvoyés. Les sessions longues, la copie automatique sur PC et les fonctions déjà acceptées restent des acquis de reprise.

## Vérifications

Tests de conservation des brouillons existants, choix isolés et non mutables via l’API, informations publiques exactes, protections HTTP et traductions. Chrome exerce FR/EN à 320/375/1280 px, le dossier initialement replié, le clavier, l’enregistrement, les conflits et la purge du DOM privé. Le déploiement doit être rattaché à une source figée, à sa CI, aux tests natifs, au préflight, aux empreintes HTTPS et aux premières observations de supervision après redémarrage. La préparation locale ne constitue pas une activation.


## Activation observée

Source `a15b5595b804f2eccf95c13be46152570a6ebc12`, arbre `d653aeb733cdc2bc7bd87853f747fbdd3010141c`, [PR #78](https://github.com/fredbuhr/jessiemessage/pull/78), merge `c241ef67cdb1955beb14f698d0f60d8dffb56490`, repère `release/0.62.0`. Les CI [source 39166239884](https://github.com/fredbuhr/jessiemessage/actions/runs/39166239884), [PR 39166243635](https://github.com/fredbuhr/jessiemessage/actions/runs/39166243635) et [main 39166461333](https://github.com/fredbuhr/jessiemessage/actions/runs/39166461333) réussissent leurs cinq jobs. Source exacte : 2 565 réussites et 27 wrappers SQL ignorés sur 2 592 cas ; 387/387 sur chaque MariaDB, 144/144 Chrome, authentification HTTPS/MFA, syntaxe de 471 sources et build réussis. Localement : 2 412 réussites, 180 intégrations indisponibles ignorées, zéro échec.

Un clone public peu profond séparé est épinglé dans `/srv/customer/jessiemessage-operator/privacy-choices-062-a15b5595`. Dépendances comparées inchangées, modules natifs repris de 0.61, Node 24.15.0. **195/195 contrôles natifs**, y compris les assertions CI et les vrais ancrages privés, réussissent. Préflight réel terminé le 18 octobre à **21:06:22.367582 UTC**, `started: false`, `backupStarted: false`.

Lanceur `/srv/customer/jessiemessage-private/start-primary-privacy-choices-062-a15b5595.sh`, 0700, **843 octets**, SHA-256 `1d9160db7e9b8752dfe9104f6ddedf48b4ae482af24653b253c95b9073ab30ce`. Run/Build 0.61 sauvegardés dans `manager-before-privacy-choices-062.json` (0600), nouvelles commandes relues persistées. Build/redémarrage normal sans réinstallation, état Actif, modification **23:10 Europe/Paris**, précision à la minute affichée par Manager.

Après le dernier message de démarrage : mesures **1792357854287 et 1792357914345**, intervalle **60 058 ms**, `current/OK`, zéro échec, aucun incident ; alertes correspondantes sans envoi en attente. À **21:11:22.962093 UTC**, **121/121 contrôles HTTPS**, **44 empreintes publiques exactes**, deux origines, TLS vérifié et redirections non suivies. L’aide servie contient les deux faits confirmés et l’indication honnête que la suppression du compte n’est pas disponible directement. Ressources privées, exports anonymes, fichiers de préparation et mutations sans autorisation refusés.

À **21:12:30.784796 UTC**, source/arbre/version relus propres, capture courante et reçu PC par identifiant/taille/empreinte conformes. Dernier reçu **21:05:50.750 UTC**, antérieur à l’activation 0.62 ; aucune revendication de nouveau reçu postérieur. Aucune préparation personnelle enregistrée au relevé. Aucun contenu client consulté/exporté, aucun mail ni message réel envoyé. Le navigateur cloud observe l’aide publique ; les parcours administrateur positifs restent prouvés par les fixtures synthétiques.

Les [preuves structurées](activation-proofs/jm062-activation.json), l’[observation navigateur](activation-proofs/jm062-browser-observation.json) et la [capture de l’aide publiée](activation-proofs/jm062-activation-20261018.jpg) sont conservées. Le [point de reprise](REPRISE.md) contient les commandes courantes et le repli immédiat **0.61**, sans restauration SQL.
