# JessieMessage — audit de reprise du 15 octobre 2026

## Décision de reprise

**Suivi après audit :** le [correctif 0.16.1](chat-stable-history.md) traite A15 dans le code et ajoute les régressions du contrôleur. La recette navigateur reste à réaliser. Le rapport ci-dessous conserve l’état observé sur 0.16 ; prochaine étape de développement : 0.17a supervision.

Le développement reprend **après le lot 0.16**, depuis `feat/backup-clone-recovery`, commit `0ecb31eafca03f85ba501cc6b632ca207c7ab94e`. Le prochain lot fonctionnel prévu est **0.17 — données et exploitation**. Cet audit ne constitue pas une version 0.17 ni une validation de mise en production.

Le dépôt contient un backend et des interfaces privées substantiels, testés automatiquement. Il reste à terminer les parcours produit et à valider leur exploitation réelle. Au contrôle public du 15 octobre à 10:00 UTC (12:00 à Paris), `https://jessiemessage.com/` répondait HTTP 200 avec **« Welcome to your new website »**, la page Node.js par défaut d’Infomaniak. Le contenu de la branche de développement n’était pas visible à cette adresse. Ce contrôle HTTP ne permet pas d’inventorier la configuration privée de l’hébergement.

Adresse officielle à conserver partout : **contact@jessiemessage.com**. L’identité approuvée et les clés ne sont pas modifiées par cet audit.

## Référence Git et travail déjà accompli

`main` reste au commit initial `3e4e0381be2e7aff2b8ee54882a0f86cf4d0a4ec`. Au relevé GitHub, les **15 PR sont ouvertes, en brouillon et non fusionnées**, chaque lot ayant pour base le précédent. La dernière branche contient toute la chaîne : il ne faut pas repartir de `main` pour développer la suite.

| PR | Lot | Résultat présent dans la dernière branche |
| --- | --- | --- |
| [#1](https://github.com/fredbuhr/jessiemessage/pull/1) | Fondations / identité | Serveur Node.js 24, identité Nuit, icônes approuvées, page publique FR/EN et atelier autonome 0.3.1 |
| [#2](https://github.com/fredbuhr/jessiemessage/pull/2) | MariaDB | Migrations explicites, journal et contrôles de dérive/reprise |
| [#3](https://github.com/fredbuhr/jessiemessage/pull/3) | Administrateur | Mot de passe, MFA, codes de secours et sessions révocables |
| [#4](https://github.com/fredbuhr/jessiemessage/pull/4) | Invitations et clients | Invitations uniques, inscription, vérification e-mail, approbation et accès limités ; récupération administrateur privée |
| [#5](https://github.com/fredbuhr/jessiemessage/pull/5) | Messagerie | Conversations privées persistantes, texte chiffré, pagination, lecture et suppression par auteur |
| [#6](https://github.com/fredbuhr/jessiemessage/pull/6) | Photos | Normalisation, chiffrement, galerie et médiathèque avec déduplication par propriétaire |
| [#7](https://github.com/fredbuhr/jessiemessage/pull/7) | CRM | Fiches, notes chiffrées, tags, groupes privés, suivi et filtres |
| [#8](https://github.com/fredbuhr/jessiemessage/pull/8) | Récupération client | Lien unique, changement du mot de passe et révocation des anciennes sessions |
| [#9](https://github.com/fredbuhr/jessiemessage/pull/9) | E-mail / préparation | Adresse unique, page privée de préparation et diagnostic SMTP sans envoi |
| [#10](https://github.com/fredbuhr/jessiemessage/pull/10) | Diffusions | Messages individuels avec consentement, file durable, reprise et annulation |
| [#11](https://github.com/fredbuhr/jessiemessage/pull/11) | 0.12 | Isolation des états privés, réponses tardives et actualisation des interfaces |
| [#12](https://github.com/fredbuhr/jessiemessage/pull/12) | 0.13 | Admission HTTP, quotas, SMTP annulable et arrêt borné |
| [#13](https://github.com/fredbuhr/jessiemessage/pull/13) | 0.14 | Renouvellement atomique des accès, pagination administrateur et contrôles temporels |
| [#14](https://github.com/fredbuhr/jessiemessage/pull/14) | 0.15 | Capacité médias persistante, inventaire privé et initialisation hors ligne |
| [#15](https://github.com/fredbuhr/jessiemessage/pull/15) | 0.16 | Manifeste signé, contrôle des cinq clés et restauration/réparation sur clone isolé |

La version du serveur est **0.16.0** ; **0.3.1** désigne l’atelier visuel autonome. Ces numéros décrivent deux livrables différents. Les 27 migrations sont présentes dans la dernière branche. Aucune migration ne s’exécute automatiquement au démarrage.

## Contrôles et preuves

| Contrôle | Résultat | Portée |
| --- | --- | --- |
| Installation verrouillée | `npm ci --ignore-scripts` réussie | Environnement local Node.js 24.19.0 / npm 11.9.0 |
| Tests généraux relancés | **991 réussis, 0 échec, 19 groupes SQL ignorés** | `npm test`, données synthétiques ; les groupes ignorés nécessitent MariaDB |
| Build relancé | Réussi, syntaxe comprise | `npm run build` crée l’atelier HTML autonome, pas un paquet de déploiement complet |
| Dépendances | **0 vulnérabilité connue** signalée | `npm audit --omit=dev`, au moment de cet audit ; aucune mise à jour automatique |
| CI du commit audité | Trois jobs réussis | [Run 38703536625](https://github.com/fredbuhr/jessiemessage/actions/runs/38703536625), SHA exact `0ecb31e…`, Node.js 24.21.0 |
| SQL MariaDB 10.11 | **287 réussis, 0 échec, 0 saut** | Journaux du job relus ; bases jetables, comptes et contenus synthétiques |
| SQL MariaDB 11.4 | **287 réussis, 0 échec, 0 saut** | Même contrôle indépendant des journaux |
| Serveur local sans configuration privée | `/` et `/api/health` répondent 200 ; routes privées 404 | Vérification HTTP synthétique ; aucun pool DB créé |
| Exposition de fichiers | Chemins `/.env`, `/docs/SECURITY.md`, `/design/preview.html` et `/private-media/test` refusés (404) | Contrôle local sur le serveur neutre ; liste explicite de fichiers publics |
| Site public | Page Infomaniak par défaut | Un GET public ; aucune connexion au Manager ni modification de l’hébergement |

Les 19 groupes SQL comptent 12, 16, 8, 20, 13, 13, 19, 12, 24, 15, 19, 14, 21, 12, 10, 13, 18, 14 et 14 tests. Leurs résultats CI ont été consultés, **pas réexécutés localement** : aucun serveur MariaDB/Docker n’était disponible ici. Les comptes et tests SQL valident le comportement transactionnel avec MariaDB ; ils ne valident pas les permissions et limites du compte Infomaniak réel.

La revue couvre authentification, accès, récupération, messagerie, CRM, diffusions, médias, sauvegardes, migrations, interfaces, PWA et CI. Elle ne remplace pas un test d’intrusion indépendant ni une recette navigateur, iPhone, Android ou de charge. Aucun parcours connecté réel, SMTP externe ou restauration sur hébergeur n’a été exécuté.

## Points techniques favorables vérifiés

- Contrôles d’appartenance et des accès dans les transactions ; révocation, version des identifiants et état MFA revérifiés avant effets privés.
- Cookies hôte Secure/HttpOnly, protections Origin/CSRF, limites d’entrée et quotas persistants ; absence de stockage navigateur persistant des messages privés dans les modules examinés.
- Chiffrement authentifié avec finalités et liaisons distinctes pour messages, notes, médias et charges des files. Il s’agit de **chiffrement au repos**, pas de chiffrement de bout en bout : le serveur autorisé dispose des clés. Des métadonnées et l’adresse e-mail restent lisibles dans la base.
- Identifiants durables et transactions pour éviter les doublons après résultats incertains ; retrait du consentement et révocation contrôlés avant livraison d’une diffusion.
- Réservation de capacité avant écriture, conservation prudente des états incertains, libération après effacement durable.
- Restauration avec manifeste signé et contrôle cryptographique, autre base et autre répertoire, source conservée ; aucune purge automatique de fichiers inconnus.
- Séparation des identifiants DML et de migration ; migrations avec empreintes, verrou et reprise explicite. Les erreurs publiques examinées évitent les détails SQL, contenus ou secrets.

Aucun contournement critique d’authentification ou d’isolation entre clients n’a été confirmé dans les chemins examinés. Cette absence de constat ne certifie pas l’absence de vulnérabilité.

## Écarts confirmés et actions

Les priorités ci-dessous portent sur la publication : **B** = blocage d’ouverture réelle, **P2** = défaut ou lacune à traiter avant le pilote, **P3** = entretien. Un blocage produit n’est pas présenté comme une faille de sécurité.

| ID | Priorité | Constat et preuve | Action / critère de sortie |
| --- | --- | --- | --- |
| A01 | B | Aucun lot n’est fusionné ; le domaine public sert la page par défaut. `.github/workflows/ci.yml` teste et produit un aperçu uniquement. | Préparer une préproduction privée avec la bonne révision, puis une procédure de publication et de retour arrière. |
| A02 | B | Le parcours ne sait pas enregistrer une preuve externe de majorité. `server/access/store.mjs:430–437` refuse correctement l’approbation sans `age_assured_at` ; aucune mutation applicative ne renseigne ce champ. | Définir le processus approprié puis intégrer sa preuve minimale, ses refus et sa révocation. Une case 18+ ou un contournement SQL ne termine pas ce lot. |
| A03 | B | Conservation, export de compte et suppression complète ne disposent pas d’un parcours livré ; supprimer un message ne supprime pas l’ensemble des données du compte. | Définir la politique, construire export/suppression avec reprise, traiter références médias/campagnes et sauvegardes. Simulation avant purge réelle. |
| A04 | B | Le CLI 0.16 vérifie et répare une copie ; il ne réalise pas à lui seul un dump SQL, la copie externe des médias/secrets ou leur planification. | Exécuter une sauvegarde cohérente hors ligne puis une restauration isolée sur l’hébergement choisi ; mesurer perte de données et délai de reprise acceptables. |
| A05 | B | SMTP réel, réception, configuration DNS et conditions de l’hébergement ne sont pas attestés. `/admin/readiness` vérifie la connexion SMTP sans envoyer. | Tester vérification/récupération avec boîtes de test autorisées et confirmer la configuration réelle. Garder `contact@jessiemessage.com`. |
| A06 | P2 | `public/manifest.webmanifest:6` ouvre `/`. `public/index.html:39–42` est une page d’attente sans entrée vers l’accès. | Fournir un point d’entrée neutre vers connexion/reprise de session, avec redirection sûre par rôle et état d’accès. Vérifier depuis l’icône installée. |
| A07 | P2 | L’accueil et l’atelier disposent du FR/EN ; les écrans privés sont majoritairement codés en français (`public/access.html`, `chat.html`, `admin-login.html`, etc.). | Traduire les parcours réellement servis et leurs messages d’erreur ; tester les mêmes actions dans les deux langues. |
| A08 | P2 | Aucun service worker ou Web Push n’est implémenté. Les icônes/manifeste ne démontrent pas les comportements d’installation et de reprise sur appareils. | Livrer et tester le comportement PWA retenu ; si cache public ajouté, exclure API/messages/photos et états privés. Push reste un lot distinct, pas une fonction déjà disponible. |
| A09 | P2 | `/api/health` renvoie `{"status":"ok"}` même avec toutes les fonctions privées désactivées (`server/index.mjs:92–94,149`). | Le conserver comme signal de vie ; ajouter un contrôle d’aptitude au service distinct, borné et sans détail privé. Une alerte doit détecter une messagerie indisponible avec HTTP vivant. |
| A10 | P2 | Le planificateur des diffusions absorbe les rejets avec `.catch(() => {})` (`server/broadcast/worker.mjs:81–84`). Les erreurs SMTP ont un signal neutre, les diffusions n’ont pas de signal équivalent. | Signaler l’échec de lot sans contenu/identifiant client, mesurer retard de file et échecs répétés ; conserver reprise et idempotence. |
| A11 | P2 | Les limites HTTP sont par processus et basées sur le pair TCP réel, sans confiance dans les en-têtes transmis (`server/http/admission.mjs`). Un proxy commun peut agréger les utilisateurs. La capacité SQL/Sharp n’a pas été mesurée sous charge. | Vérifier la topologie Infomaniak, mesurer attente/429/mémoire/latence et ajuster seulement après essai représentatif. Ne pas faire confiance arbitrairement à X-Forwarded-For. |
| A12 | P2 | Les portraits privés ne sont pas inclus dans le dépôt ou l’aperçu public ; l’atelier et les écrans servis sont distincts. | Faire une recette des écrans connectés avec l’identité approuvée ; intégrer le portrait privé par le parcours prévu quand il est disponible, sans le publier dans Git par défaut. |
| A13 | P2 | Mentions légales, information sur les données, conditions d’accès et procédure de signalement ne sont pas finalisées dans le produit livré. | Terminer les textes et parcours adaptés au service avant ouverture. Cet audit technique ne tranche pas leur conformité juridique. |
| A14 | P3 | Documents de cadrage encore en 0.15 (`docs/PRODUCT.md`, début de `ARCHITECTURE.md`) alors que `NEXT-STEPS.md` décrit 0.16. Des sections historiques énumèrent des travaux depuis terminés. | Utiliser le présent audit et `NEXT-STEPS.md` comme référence actuelle ; remettre les résumés à jour sans effacer les preuves historiques. |
| A15 | P2 — bug reproduit | `public/chat.js:602` appelle le rendu même pour `events=[]`. À `:541`, tous les nœuds messages sont remplacés ; le polling recommence à 3 s (`:609–624`). | Conserver les nœuds et le focus quand le contenu ne change pas ; tester aussi vrais ajouts, suppressions, reçus, photos et changement de session. |
| A16 | P2 | L’historique possède `role=list`, sans annonce dédiée d’arrivée de messages (`public/chat.html:36`). Le statut est vidé par le polling réussi. | Ajouter une annonce accessible discrète sans relire tout l’historique ; vérifier au lecteur d’écran. |
| A17 | P2 | Un ancien code connaissant 25 migrations refuse un historique de 27 avec `HISTORY_DIVERGED` à la version 26. La garde est correcte ; le retour arrière doit en tenir compte. | Tester la matrice code/schéma et le repli SQL/médias/clés ; ne pas se limiter à redéployer un ancien commit. |

### Reproduction du défaut de rendu A15

Le vrai contrôleur `public/chat.js` a été exécuté en VM avec un DOM synthétique et le même type de harnais que `tests/chat-lifecycle.test.mjs`. Après le chargement d’un message, on conserve son nœud, puis on avance l’horloge de 3 000 ms avec une réponse d’événements vide. La preuve a été relancée lors de la synthèse :

```json
{"noNewEvents":true,"sameMessageId":true,"sameDomNode":false,"previousNodeConnected":false,"eventsGets":1}
```

Le détachement du nœud est donc confirmé. La conséquence exacte sur le focus, les lecteurs d’écran et les miniatures doit encore être éprouvée dans un navigateur. La régression à ajouter devra conserver la même identité DOM lors d’un polling sans changement, tout en rendant les changements réels et en purgeant toujours une ancienne session. Aucun résultat de recette navigateur n’est revendiqué.

Les constats A09/A10 ont également été exercés avec dépendances injectées : handler privé en échec à 503 avec santé HTTP toujours à 200 ; deux échecs de réservation de diffusion sans signal d’erreur. La compatibilité de retour arrière A17 a été reproduite avec le validateur réel d’historique, sans base de production.

## Code mort, doublons et maintenance

Deux éléments déjà repérés restent confirmés : `constantTimeText` (`server/auth/crypto.mjs:261`) est utilisé seulement par son test, et `public/icon.svg` est une archive non servie. Leur retrait peut être fait dans un petit lot d’entretien ; ils ne bloquent pas le fonctionnement.

`design/` est utilisé par `scripts/build-workbench.mjs` : ce n’est pas du code mort. Il existe en revanche deux présentations à entretenir, atelier fictif et interfaces connectées. Une amélioration dans l’atelier ne prouve pas sa présence dans l’application réelle.

Les conversions de dates SQL, validations d’identifiants/horaires, contrôles de schéma et réponses 429 sont répétés entre domaines. Certaines charges e-mail ont une structure proche avec des finalités cryptographiques différentes. Une extraction éventuelle doit garder ces frontières et les tests d’autorisation/idempotence ; une réécriture générale avant publication ajouterait un risque inutile. Les longues listes manuelles de scripts `check` et `test:db` méritent un contrôle de couverture lors de chaque nouveau module.

## Plan de livraison à partir du point retrouvé

| Ordre | Travail | Critère concret de sortie |
| --- | --- | --- |
| Correctif ciblé préalable | Stabilité de l’historique chat (A15) | Polling vide conservant les nœuds/focus ; changements réels, photos et purge d’identité préservés |
| 1 — 0.17a | Supervision et préparation au service | Erreurs des workers visibles sans données privées, retard des files mesurable, signal de vie distinct de l’aptitude au service, tests de panne synthétique |
| 2 — 0.17b | Politique, inventaire et export des données | Catégories et durées décidées, inventaire/export bornés avec autorisation et médias ; simulations reproductibles sans effacement |
| 3 — 0.17c | Suppression/rétention et retour arrière | Ordre des dépendances, retrait des files/sessions, références médias traitées, reprise idempotente, tests SQL ; procédure de retour arrière compatible avec schéma/clés |
| 4 — Intégrations, en parallèle | Majorité et hébergement | Processus de preuve intégré et testé, compatibilité du service et capacités de l’offre confirmées ; aucun déblocage fictif du champ majorité |
| 5 — Préproduction isolée | Node.js/MariaDB, stockage privé, secrets et SMTP | Révision identifiée, compte administrateur créé, parcours de test complet, réception réelle contrôlée et topologie proxy mesurée |
| 6 — Sauvegarde éprouvée | Copie externe puis restauration 0.16 | Restauration sur autre base/répertoire avec secrets requis, contrôle des contenus, source intacte et temps de reprise consigné |
| 7 — Interface finale | Entrée PWA, FR/EN, identité, accessibilité et appareils | Invitation → vérification → approbation → conversation/photo → diffusion/opt-out → récupération/expiration testés sur navigateur, iPhone et Android |
| 8 — Revue et publication | Charge représentative, intégration ordonnée et pilote | Aucun blocage/P1 ouvert, sauvegarde/repli vérifiés, revue des PR de #1 vers #15 puis lots suivants, validation finale du commit intégré, pilote limité avant élargissement |

Ce sont des lots avec critères de sortie, pas des dates promises. Les accès à l’hébergement et les décisions de majorité/rétention influent sur le calendrier. Les travaux de supervision, d’interface et de préparation de préproduction peuvent avancer en parallèle. Ne pas fusionner automatiquement toute la pile sur la seule base des tests d’une branche ; contrôler le résultat final intégré.

## Consignes pour la prochaine reprise

1. Partir de la dernière branche de la chaîne et vérifier que son HEAD n’a pas changé depuis cet audit.
2. Corriger A15 avec sa régression, puis commencer **0.17a — supervision**, réalisable avec données synthétiques sans attendre les durées de conservation ni les accès de production.
3. Garder les fonctions privées désactivées par défaut ; ne pas publier l’atelier HTML comme messagerie.
4. Ajouter les tests ciblés du lot, relancer les contrôles appropriés et relever la CI du SHA exact avant de déclarer le code terminé.
5. Annoncer l’étape au début et à la fin de chaque session ; distinguer « implémenté », « testé automatiquement », « validé sur hébergement/appareil » et « publié ».

**À la fin de cet audit : reprise et vérification terminées ; code de référence 0.16 confirmé ; correctif A15 puis développement 0.17a prêts à commencer ; application non publiée.**
