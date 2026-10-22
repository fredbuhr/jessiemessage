# Audit global avant ouverture élargie — 22 octobre 2026

**Décision : conserver le socle et corriger les défauts de fiabilité avant l’ouverture élargie.** L’application fonctionne déjà sur le domaine principal, en 1.8.1. L’audit trouve deux problèmes prioritaires de disponibilité/capacité et plusieurs bugs reproductibles ; il ne justifie ni réécriture générale, ni nouveau service. Aucun contournement d’authentification ou fuite entre clients n’a été établi dans les chemins examinés. Ce constat ne garantit pas l’absence de toute vulnérabilité.

**Aucune correction applicative ni opération de déploiement n’est réalisée par cet audit.** Le test de sauvegarde hébergée reste reporté à la demande de l’utilisateur. Les constats sur son code sont distincts de la page Infomaniak précédemment signalée : l’audit n’en établit pas la cause.

Le [plan courant](PLAN-IMPLEMENTATION.md) regroupe les corrections en quatre lots. [REPRISE](REPRISE.md) reste la référence de l’état réellement actif. La [preuve structurée de cet audit](verification-proofs/audit-final-20261022.json) contient les observations, résultats des reproductions, fixtures conservées et limites.

## Référence et méthode

| Élément | Résultat et provenance |
| --- | --- |
| Dépôt audité | `6950e3e0af0c573933d41fabf89564e320e16a1f`, arbre `586930fe28137437b4cba9310a41a1f7444e72ca`, checkout propre au début. |
| Application | Package et deux versions racine du lock : **1.8.1**. `server`, `public`, `db`, scripts, package et workflows sont identiques à la source de livraison. Les 18 différences depuis cette source sont documentaires. |
| Source de production | `1ae4c75152795ea6f31c2ff364e337a1d5a04e31`, arbre `eb427f887248fa9db5c656c3773e016f8688efc9`. Identité et checkpoint serveur **USER_REPORTED**, acquis dans cette discussion ; pas de nouvelle inspection du processus privé. |
| GitHub | Tag direct et release latest **v1.8.1** sur cette source exacte, release `420741528`, non brouillon et non préversion ; zéro PR ouverte observée. Aucun tag déplacé. |
| Runtime et base | **Node v24.22.1 / SQL36** selon les reçus serveur. Node 24.22.1 est bien la publication de sécurité officielle du 21 octobre et le dernier LTS affiché lors de la consultation. Node local **24.19.0** : les nouvelles reproductions ne qualifient pas le runtime hébergé. |
| Repli | **1.7.2**, tag sur `6b3319a77c307ed7d6b003fe33de36807c70c266`, compatible SQL36, précontrôlé et jamais démarré selon les preuves existantes. Ne pas démarrer 1.7.1 ou 1.6.0 sur SQL36. |
| Domaines | Principal public ; accueil/www canoniques selon la confirmation antérieure **13/13**. Recette conservé, même service et même base : aucune qualification destructive n’y est autorisée. |

L’inventaire couvre **1 145 fichiers suivis** : 223 serveur, 101 publics, 56 scripts, 20 outils opérateur, 33 migrations de base, 384 fichiers de tests, 313 documents/preuves et les fichiers racine/workflows. Les 223 fichiers serveur se répartissent en 220 modules JavaScript et trois migrations vidéo supplémentaires dans leur profil. Une revue manuelle des flux sensibles a été complétée par des contrôles globaux d’imports, ressources, liens, dépendances et références de livraison. Ce n’est pas une affirmation de lecture exhaustive de chaque ligne ou de test de toutes les combinaisons.

Les six périmètres relus sont l’authentification/sécurité, les métiers/transactions SQL, le frontend/PWA, les médias/opérations, les documents/code inutilisé et la CI/livraison. Les répétitions entre périmètres ont été regroupées ci-dessous. Les bonnes pratiques ont été confrontées à OWASP ASVS **5.0.0**, aux recommandations OWASP Node, W3C WCAG 2.2, GitHub Actions, Node et CNIL ; aucune certification globale n’est revendiquée.

## Ce qui fonctionne et doit être conservé

| Surface | Protections ou comportements établis |
| --- | --- |
| Identité et accès | Scrypt borné, secret TOTP chiffré, anti-rejeu atomique, secours à usage unique, tokens de session aléatoires hachés, cookies `__Host-` Secure/HttpOnly/SameSite=Strict. Sessions multiples et durée glissante conformes au choix produit. |
| Autorisations et entrées | Origin exact, CSRF, Fetch Metadata, taille/durée des corps bornées, requêtes SQL paramétrées ; autorisation répétée sous verrous dans les stores. Pas de confiance aveugle dans les en-têtes de proxy. |
| Messagerie | Transactions message/événement/pièce jointe/notification, clés d’idempotence, contrôle des reprises, curseurs bornés et accusés monotones. Suppression d’auteur et absence de résurrection après réessai. |
| CRM et outils admin | Notes chiffrées, versions optimistes, validation des associations, tâches privées, réponses personnelles chiffrées et catalogue borné. Liste commune et parcours vidéo rapportés fonctionnels par l’utilisateur. |
| Diffusions/annonces | Audience figée et signée, clés et preuves durables, baux et tentatives bornés, recontrôle des droits à la livraison. Une audience de 2 500 n’est pas une mesure de simultanéité. |
| Médias | Photos décodées/réencodées dans un processus isolé, métadonnées source retirées, dimensions/tailles bornées. Vidéo en flux borné, blocs authentifiés avant émission du clair, accès Range contrôlé. Racines privées, modes restrictifs, gardes liens/chemins et publication durable. |
| Frontend/PWA | DOM construit avec texte, pas de sink `innerHTML`/`eval` trouvé ; identités/epochs, réponses tardives et annulations contrôlées. Service worker sans cache privé, notifications génériques sans contenu du message, navigation locale contrôlée. Labels, focus, dialogues et adaptation mobile présents. |
| Données/opérations | Exports bornés et séparés des notes/tâches admin ; intentions d’effacement durables et contrôles d’inventaire ; reprises sans double remboursement. Arrêt ordonné des producteurs avant drainage/pool. Aucun succès déduit d’un état incertain. |
| Livraison | Identité issue du vrai package/checkout propre, commit/arbre qualifiés, lanceurs épinglés, migrations/checksums contrôlés. CI existante PR/main 1.8.1 réussie 5/5 chacune, qualifications natives distinctes des omissions générales. |

Les **8 GET publics** nouveaux `/`, `/app`, `/help`, `/admin/login`, `/sw.js`, `/manifest.webmanifest`, `/api/health`, `/api/ready` répondent à 200. Tous portent `Cache-Control: no-store`, CSP et HSTS `max-age=31536000`, sans pose de cookie anonyme. Les valeurs complètes des en-têtes sont conservées dans la preuve. Aucun compte connecté n’a été utilisé.

`npm audit --omit=dev --ignore-scripts --json` a abouti : **0 vulnérabilité connue**, 59 dépendances verrouillées. Les résolutions sont HTTPS sur le registre npm et ont une intégrité enregistrée. Ce résultat dépend de l’état des avis du registre ; il ne prouve pas l’absence de défaut inconnu. La recherche ciblée de secrets dans les sources courantes n’a identifié aucun secret réel : six résultats étaient des fixtures ou placeholders ; elle ne constitue pas une analyse exhaustive de tout l’historique Git.

MX Infomaniak, SPF `include:spf.infomaniak.ch -all` et DMARC `p=reject` sont publiés lors du relevé DNS. Aucun e-mail n’a été envoyé. Signature DKIM réellement appliquée, alignement d’un message et réception finale n’ont pas été nouvellement testés.

## Défauts et améliorations établis

Les références de lignes ci-dessous visent **le commit audité**, avant les futures corrections. P1 signifie à corriger avant élargissement ; P2 signifie correction de fiabilité/information ou vérification nécessaire ; P3 signifie entretien sans refonte imposée. Un point conditionnel n’est pas compté comme panne constatée.

### A01 — P1 : un compte peut épuiser le budget d’envoi commun avec ses refus

`server/chat/service.mjs:115–120` débite le quota global **300/min** avant celui du compte **30/min**. Texte, photo et vidéo utilisent ce chemin. L’autorisation de conversation en base intervient ensuite. Les refus personnels consomment donc le budget de tous, partagé avec les diffusions.

**Reproduction synthétique acquise :** 300 tentatives d’A vers une conversation absente donnent 30 `CHAT_NOT_FOUND` puis 270 `CHAT_RATE_LIMIT`. La première demande de B est refusée au global sans atteindre le store. Ce débit est admis par le quota externe par token. Aucun message réel n’a été créé.

Corriger l’ordre utilisateur puis global, comme les lectures le font déjà ; conserver le budget global partagé et ses identités. Tester l’isolation d’A/B, les trois types de message et la diffusion. Le test actuel impose l’ordre défectueux : une suite verte ne détectait donc pas ce cas.

### A02 — P1 : la capacité vidéo admise dépasse celle du dispositif de sauvegarde

La préparation hébergée configure **10 Gio au total / 1 Gio par propriétaire**. L’admission `server/video/store.mjs:262–278` les accepte, mais l’inventaire et la copie de sauvegarde vidéo refusent au-delà de **1 Gio** (`server/backup/video-inventory.mjs:89–91`, `video-checkpoint-files.mjs:12–15`). La demande manuelle active emprunte bien ces composants. D’autres plafonds d’archive/restauration doivent aussi être respectés ; augmenter une seule constante ne suffit pas.

**Reproduction synthétique acquise :** 11 réservations de 100 Mio sur deux propriétaires respectent les quotas, mais l’inventaire réel les refuse avec `backup_byte_limit`. Le rejet est celui du volume, sans lecture de fichiers ni demande de sauvegarde. Des originaux commis de même volume rencontreraient ce contrôle. Le nombre d’objets accepté n’est pas non plus aligné avec la borne de 100 000 entrées des lecteurs.

Définir et appliquer un contrat commun admission/inventaire/copie/restauration et une stratégie compatible avec l’existant. Ne pas purger de données, modifier les quotas persistés isolément ou retirer un garde. **Ce défaut de code est distinct de l’écran Infomaniak et du test hébergé reporté.**

### A03 — P2 : un refus photo avant écriture conserve sa réservation

Après réservation SQL confirmée, `server/media/service.mjs:158–175` peut refuser l’espace disque ou son relevé avant tout `put()`. Le réessai crée une nouvelle réservation ; aucune restitution n’est effectuée. **Trois essais synthétiques : charges 616 → 1 232 → 1 848 octets, zéro écriture et zéro restitution.** Le test actuel exige même cette conservation.

Restituer uniquement la réservation exacte dont on sait qu’aucune écriture n’a commencé. Conserver la prudence pour les publications/commits réellement incertains. Couvrir réessai, révocation et accusé perdu.

### A04 — P2 : aucun parcours ne libère les originaux vidéo sans référence

Le service `remove()` et ses gardes de suppression durable existent (`server/video/service.mjs:265–287`, store `319–354`), mais ne sont branchés ni dans le handler HTTP ni ailleurs dans la composition runtime. Supprimer un message crée un tombstone et ne libère pas son original. Un upload réussi suivi d’un échec définitif d’envoi ou d’un rechargement peut également laisser un original chargé et introuvable dans l’interface.

Il ne s’agit pas de prétendre que toute suppression de message doit immédiatement supprimer physiquement le média : les photos séparent déjà message et bibliothèque. Le problème est **l’absence de moyen utilisable pour retrouver/libérer une vidéo non référencée**, hors fermeture de compte/opération spécialisée. Le retrait avant envoi, testé par l’utilisateur, ne prouve pas ce nettoyage car aucun upload n’a encore commencé à ce stade.

Brancher un parcours KISS sur le lifecycle existant ; protéger les médias partagés, références vivantes et résultats incertains. Éviter un nouvel ordonnanceur automatique ou une refonte de bibliothèque.

### A05 — P2 : l’export de conversation vidéo consomme le quota d’affichage

`server/index.mjs:484,502` compose l’export avec `videoService.openMessage()`, soumis à **120 lectures/min par compte** et 300 globales. Les photos possèdent déjà un lecteur d’export distinct. **Reproduction avec vrais service/exporteur :** 121 petites vidéos, arrêt à la 121e avec `VIDEO_RATE_LIMIT`/`busy`, 83 585 octets émis sur 94 592, ZIP incomplet. Recommencer peut reproduire le même échec.

Créer le lecteur d’export vidéo approprié en gardant ACL, révocation, bornes globales de taille/durée/concurrence et annulation. Ne pas supprimer le quota de lecture ordinaire.

### A06 — P2 : une diffusion perd son travail au passage en arrière-plan

`public/broadcast.js:49–54,604` appelle une purge complète au changement de visibilité. `broadcast-model.js:19–24` efface texte, destinataires, média et identifiant d’une confirmation incertaine. Un simple changement d’application suffit. Les tests existants valident cette purge pour empêcher les réponses tardives, sans couvrir la continuité de saisie.

Conserver le travail en mémoire pour la même session/identité, suspendre l’affichage et le réseau, puis revérifier le propriétaire avant reprise. Garder la clé exacte d’une demande incertaine ; aucun envoi automatique au retour. Purger au changement réel de compte ou à la déconnexion. Aucune duplication automatique observée n’est affirmée ; perdre la clé rend cependant une nouvelle préparation distincte de l’intention initiale.

### A07 — P2 : une suppression de label CRM utilise une heure périmée après attente

`server/crm/store.mjs:244–259` utilise le `now` d’entrée alors que `withActor` fournit `context.now` rafraîchi. Une autre session peut sauvegarder une fiche liée pendant l’attente du verrou, sans changer la version du label. La suppression considère alors sa date valide comme future et échoue en 503.

**Reproduction isolée :** entrée à 1 000, fiche modifiée à 1 500, verrou obtenu à 2 000 : ancienne heure → `CRM_DATABASE_STATE`, zéro écriture ; heure fraîche → succès, trois écritures simulées. La version du label est identique. Le scénario principal est cette suppression liée ; un renommage concurrent du même label serait normalement arrêté par sa version.

Employer l’heure autorisée rafraîchie dans les méthodes concernées, sans accepter des dates réellement futures. Ajouter une régression avec attente de verrou sur une base jetable ; aucune perte de note n’a été établie dans ce défaut.

### A08 — P2 : le brouillon de conversation ne survit pas au rechargement

Le problème signalé par l’utilisateur est toujours présent : `public/chat-model.js:13–15` ne garde le texte qu’en mémoire, et `chat.js:1892,1994,2026–2027` purge au départ/rechargement. La 1.8.1 ne l’a pas corrigé ; le passage en arrière-plan sans rechargement est un cas distinct déjà protégé.

Prévoir une reprise simple du **texte seulement**, bornée et liée au rôle/compte/conversation, avec purge adaptée. Exclure mots de passe, TOTP, médias et clés. Une demande déjà incertaine doit conserver son identité propre, sans être transformée en nouvel envoi. Un avertissement de navigation seul ne protège pas les évictions mobiles.

### A09 — P2 : plusieurs guides présentent des états historiques comme actuels

- `MONITORING.md:3,22–28,44` annonce encore 1.2.0, capture quotidienne et alertes de fraîcheur comme dispositif courant, contrairement au parcours manuel retenu.
- `README.md:31,33–34,50` garde des libellés vidéo « en développement », recette ouverte et « identité courante 1.8.0 », malgré sa tête 1.8.1 correcte.
- `server/video/migrations.mjs:6–9` décrit encore un candidat isolé à promouvoir ; le profil actif importe déjà les trois migrations. `docs/DATABASE.md` commence à l’ancien schéma 33.
- `docs/ARCHITECTURE.md` garde un état 0.56 et les anciennes opérations ; REPRISE atteint 596 lignes / 144 847 octets et mélange fiche actuelle et journal historique.

Réécrire les références courantes et leur index, raccourcir la reprise et ranger l’histoire sans altérer ses preuves. **33 migrations de base + 3 du profil vidéo est une composition intentionnelle, pas une anomalie à corriger en déplaçant/renumérotant les fichiers.** L’audit ne propose aucune restauration de l’automatisation abandonnée.

### A10 — P2 : l’information publique ne couvre pas complètement l’état actuel

`public/help.html:77,81,84–86` et les traductions `help.js:45–55` décrivent stockage, chiffrement et suppression sans les vidéos. Le texte doit correspondre au résultat retenu pour A04, sans garantir un effacement des métadonnées vidéo non réalisé.

La page explique déjà contact, accès, conservation de conversation, droits de copie/suppression et absence de chiffrement de bout en bout. Elle ne constitue pas pour autant une notice complète : base du traitement, catégories de prestataires/destinataires, durées des traces/copies et information sur la réclamation ne sont pas explicités de manière complète. L’éditeur privé de préparation conserve encore des choix et notices au statut `draft_only` ; enregistrer ce dossier ne publie pas une notice.

Compléter une notice courte FR/EN cohérente avec l’usage déjà décidé et les informations réellement connues, selon la référence CNIL. Ne pas inventer d’identité, de durée, de garantie juridique ni de prestataire. Aucun nouveau portail de conformité n’est demandé. Cette revue signale une information incomplète ; elle ne certifie ni ne tranche à elle seule la conformité juridique globale ou l’application d’une exception.

### A11 — P2 conditionnel : les budgets réseau peuvent être partagés derrière le frontal

Le code utilise `socket.remoteAddress`, sans croire un `X-Forwarded-For` arbitraire. Le profil vidéo désactive le parent gateway. Si Infomaniak présente le même pair interne à tous les visiteurs, les budgets réseau deviennent communs : notamment 20 tentatives/15 min à l’authentification et 16 requêtes simultanées à l’admission.

**La forme réelle du pair sur l’hôte n’a pas été observée.** Vérifier le contrat proxy puis, si nécessaire, un relevé technique privé minimal. Choisir ensuite une politique fiable qui garde les budgets globaux et individuels. Ne pas désactiver les quotas ou faire confiance à un en-tête public pour obtenir un contrôle vert. Ce point unique est partagé entre les audits auth et exploitation, sans double comptage.

### A12 — P2 de capacité : limites à connaître et mesures à faire avant d’augmenter l’échelle

- **Limite certaine, seuil réel inconnu :** `server/data/erasure-store.mjs:69–71` refuse une fermeture quand le catalogue global dépasse **10 000 campagnes**, y compris sans lien avec le compte fermé. Conserver le refus d’inventaire tronqué ; envisager une lecture paginée qualifiée plutôt qu’une purge ou un retrait du garde. Aucune production proche de ce seuil n’est alléguée.
- **Coût SQL établi, impact non mesuré :** chat `store.mjs:269` et CRM `store.mjs:55` calculent `MAX(occurred_at)` sans index `(conversation_id, occurred_at)` dans la migration 0015. Examiner EXPLAIN et historiques synthétiques longs avant de décider une migration additive. Aucun nouvel index n’est un prérequis par principe.
- **Capacité volontaire :** 2 400 lectures chat/min au total, 120/client, 480/admin. Selon le rythme de polling, cela correspond à un ordre de grandeur d’une centaine de comptes actifs, pas à une garantie de 2 500 utilisateurs simultanés. Mesurer une cible réaliste sur environnement isolé ; adapter d’abord le travail effectué, pas augmenter aveuglément les plafonds du mutualisé.

Ces points ne prouvent pas une panne ou lenteur actuelle. Ils doivent figurer dans la capacité documentée et être traités avant de promettre un usage qui les dépasse. Une évolution de SQL nécessiterait sa propre qualification et un repli compatible ; ne pas la glisser dans un simple nettoyage.

### A13 — P2/P3 : durcir et simplifier la qualification CI

Les actions sont référencées par tags `@v4`, donc modifiables indépendamment du commit applicatif. Le job général n’a pas de timeout explicite, contrairement aux autres jobs. Le checkout principal laisse les credentials persistés par défaut ; le jeton est toutefois déjà limité à `contents: read`, sans accès de production ni `pull_request_target`.

Épingler les SHA officiels vérifiés, désactiver la persistance inutile, ajouter un budget réaliste au job. Retirer le double contrôle syntaxique (`check`, puis `build` qui relance `check`). Les tests de la sonde n’ont pas à être rejoués toutes les cinq minutes pour le même code ; conserver sa requête de disponibilité et ses protections, sans ajouter une nouvelle surveillance.

**42/42** fichiers d’intégration sont inclus dans la commande SQL. Chrome absent fait échouer la qualification, sans omission silencieuse. Les omissions SQL/procfs de la suite générale ne sont pas des succès ; les jobs natifs les couvrent séparément selon les preuves existantes. Les vieux outils opérateur gardent leurs qualifications dédiées : ne pas exécuter tous les scripts historiques à chaque correction UI.

L’API de rulesets renvoie une liste vide. La lecture de la protection classique de `main` a été refusée par l’intégration (403) : **son existence reste non vérifiée**, sans demander de nouveaux droits pour terminer cet audit.

### A14 — P3 : un ancien générateur peut rétablir l’ancien routage

`scripts/build-neutral-site.mjs:60–62,82` génère encore `www` seul et un `/app` vers recette avec `302,QSD`. Il ne fait pas partie du build/démarrage courant et la fiche domaines interdit déjà son redéploiement. Le ranger explicitement parmi les outils historiques ou le garder sous un contrat courant corrigé si sa régénération doit rester supportée. Aucun changement Apache n’est à rejouer.

### A15 — P3 : petits reliquats et duplications, sans justification de suppression massive

L’import `appendQuickReply` dans `public/chat.js:3` est inutilisé ; `peerAvatarUrl` (`server/profile/validation.mjs:18`) n’a aucun appel dans le dépôt courant ; `queueCountText` (`public/readiness-model.js:54`) n’est consommé que par ses tests. Une ancienne traduction PC dans `i18n-privacy.js:12` n’est plus appelée : ce n’est pas la preuve d’un affichage actuel. Clarifier aussi les métadonnées historiques de consentement des exports opérateur, sans casser leurs formats.

Six parseurs CHECK et quelques wrappers i18n sont proches, avec des grammaires/contextes différents. Leur duplication n’établit pas un bug ; une extraction générale avant lancement apporterait plus de risque que de valeur. Retirer les reliquats prouvés sans usage et regrouper seulement les petites fonctions réellement équivalentes quand le gain est net. La grosse découpe de `public/chat.js` (2 088 lignes / 151 424 octets) reste un entretien ultérieur, pas un blocage de livraison.

**Aucun doublon complet de fichier source/document/script trouvé.** Les trois exceptions au graphe d’import serveur ont des explications : worker chargé par URL, stockage de témoin testé, prototype de réconciliation testé non raccordé. Les lecteurs d’anciens formats, migrations, clés, reçus, quarantaines et outils de repli ne sont pas du code mort à supprimer.

### A16 — P3 : un changement de dates d’annonce n’avertit pas avant navigation

`public/announcements.js:228` ne détecte que le texte modifié ou une demande pending. Modifier uniquement dates/options n’émet aucun avertissement. Comparer les champs éditables dans le même lot de continuité de saisie ; rappeler qu’un avertissement seul ne protège pas toutes les fermetures mobiles.

## Nettoyage documentaire sans casser le runtime

Le contrôle a examiné **1 287 liens Markdown relatifs**, sans cible de dépôt manquante ; il ne validait pas chaque ancre ou URL externe. Les **16 HTML et 49 JavaScript publics** n’ont pas d’ID HTML doublon, référence ARIA vers un ID absent, asset HTML local ou import littéral local manquant dans ces contrôles. Le contraste de tous les états et les lecteurs d’écran ne sont pas certifiés.

Le tri doit distinguer guide courant, contrat technique et preuve historique. Une ancienne instruction datée peut rester exacte pour son étape ; elle doit être clairement historique et ne pas apparaître comme la prochaine commande. Garder un index courant court, sans réécrire 165 documents ni fabriquer des états « réussis » pour nettoyer les tableaux.

**Dépendance inhabituelle à préserver :** `server/privacy/service.mjs:7–9` charge `docs/privacy-notice-draft.md` au démarrage et le découpe par titres. Déplacer/supprimer ce document casserait le service. Le manifeste de ressources à conserver doit inclure cette dépendance ; une séparation ressource/documentation éventuelle exige une modification qualifiée. Même prudence pour le manifest de marque, l’alias dynamique `/client-archive.js`, les anciens formats et les outils épinglés externes au checkout.

## Plan retenu et fin vérifiable

| Lot | Contenu cohérent | Critère de fin |
| --- | --- | --- |
| **1 — Fiabilité backend et médias** | A01–A05 et A07 : quotas, capacité commune, réservation photo, originaux vidéo, exports et temps CRM. Inclure la conclusion technique sur A11 ; aucune correction de proxy par supposition. | Chaque reproduction nouvelle devient une régression ciblée. Droits, partage, révocation, états incertains, reprise et capacité aux frontières restent protégés. Décision de capacité compatible avec l’existant, sans test de sauvegarde hébergée imposé. |
| **2 — Continuité de saisie et information client** | A06, A08, A16 et A10 : retour d’arrière-plan, rechargement, clé de reprise, dates d’annonce et aide FR/EN. | Texte retrouvé dans le bon compte/conversation, aucun envoi automatique ou doublon après réponse perdue, purge au changement d’identité ; notice fidèle aux médias et opérations réellement disponibles. |
| **3 — Documentation, entretien et CI** | A09, A13–A15 : guides courants, index historique, ressources runtime, reliquats prouvés, SHA/timeouts et répétitions inutiles. Consigner la capacité A12 et mesurer synthétiquement ce qui peut changer la décision de lancement. | Une seule fiche actuelle courte ; liens/ancres réparés après rangement ; historique préservé ; aucun outil ancien présenté comme commande active ; versions et profil SQL explicites ; pas de refonte générale. |
| **4 — Qualification et livraison uniques** | Qualifier la source finale des trois lots, publier puis déployer exactement cette source et enregistrer son identité. Regrouper les contrôles d’appareils possibles en un parcours court. | CI PR puis main requise réussie sur les SHA exacts, release immuable, identité serveur/Node/SQL et domaine cohérents, reçu de déploiement acquis. Sauvegarde hébergée toujours explicitement non vérifiée tant que l’utilisateur ne reprend pas son test. |

Il s’agit de **quatre lots de travail, pas de quatre versions ni de quatre clics de validation utilisateur**. Le lot 1 est le plus conséquent et peut contenir plusieurs commits cohérents sur la même branche. Un résultat terminé est sauvegardé avant le suivant ; on ne publie pas une release pour chaque petit test. La correction finale compatible vise normalement **1.8.2**, sous réserve de la portée réellement retenue. Une fonctionnalité nouvelle substantielle ou une rupture demanderait une décision de version distincte. Aucun bump n’est fait pour cet audit documentaire.

A12 contient aussi de la dette de croissance sans incident actuel : pas de purge automatique, migration SQL, campagne de charge sur recette ou refonte d’effacement par principe. Si les mesures ou l’usage attendu démontrent un blocage, le correctif rejoint le lot concerné avant sa qualification. Les fonctions abandonnées ne reviennent pas dans ce plan ; les sujets à préciser restent non ouverts.

## Reprise après interruption et limites de validation

- Une branche de correction commune, commits publiés après chaque résultat cohérent et état court dans REPRISE : source/arbre, défauts traités, commandes déjà acquises, contrôle restant, prochaine action unique. Une branche distante enregistrée, pas seulement un commit local.
- Tests ciblés au fil des changements, puis qualification globale de la source stabilisée et CI requise PR/main. Ne pas relancer une suite déjà verte sans changement, échec ou question nouvelle. Ne pas couper artificiellement un lot en dizaines de sous-livraisons.
- Après une interruption, lire d’abord commit distant, PR/CI, artefact/reçu, état persistant et journaux utiles. Une réponse perdue n’autorise ni double mutation ni résultat supposé. Réessayer avec la même identité quand le contrat le prévoit.
- Une seule activation finale avec repli compatible conservé ; aucun retour automatique sur un ancien runtime SQL33. Si une migration devient nécessaire, qualifier son impact et le repli avant activation.
- Aucun navigateur cloud, mail de test ou envoi/suppression de compte réel. Si un contrôle personnel devient nécessaire, liens et instructions exacts dans le chat ; recette ne sert jamais d’environnement destructible. Aucun rappel ni essai de sauvegarde hébergée n’est lancé par cet audit.

Les nouvelles reproductions sont des fixtures logiques sans réseau ni MariaDB, sous Node local 24.19.0. Les qualifications existantes sous Node 24.22.1 et MariaDB restent acquises, mais ne couvrent pas les défauts nouveaux : elles seront complétées lors des corrections. Le nouveau contrôle HTTP est anonyme et ne qualifie pas connexion admin réelle, PWA physique, notification hors application, clavier mobile, restauration ou sauvegarde hébergée. Le test de récupération autonome après perte totale de l’hôte reste hors des prérequis retenus.

La configuration privée complète du serveur, les droits Unix effectifs de chaque fichier, les paramètres Manager actuels et la protection classique de branche n’ont pas été directement inspectés. Le versionnage serveur repose sur les reçus exacts récents ; aucune attestation plus forte n’est fabriquée. Cet audit ne diagnostique aucune coupure ChatGPT sans trace.

## Références officielles consultées le 22 octobre

- [Node : publication de sécurité d’octobre 2026](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) et [Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1).
- [OWASP ASVS 5.0.0](https://owasp.org/projects/asvs) et [recommandations Node](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html), utilisés comme cadre de revue, sans déclaration de conformité ASVS complète.
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/), notamment clavier/focus, identification des champs, cibles tactiles et retours d’état ; audit WCAG exhaustif non réalisé.
- [GitHub Actions : usage sécurisé](https://docs.github.com/en/actions/reference/security/secure-use), SHA immuables et permissions minimales.
- [CNIL : information et transparence](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence), pour la notice adaptée aux traitements réels ; [cookies et traceurs](https://cnil.fr/fr/cookies-et-autres-traceurs/que-dit-la-loi), qui distingue les usages strictement nécessaires. Aucun bandeau publicitaire ou collecte supplémentaire n’est demandé.
