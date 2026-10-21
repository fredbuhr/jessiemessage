# Voix de Jessie et détails des messages — correctif 1.3.2

**21 octobre 2026 — candidate historique codée, revue, fusionnée, qualifiée en CI PR/main 5/5 et publiée ; jamais préparée ni activée, remplacée comme prochaine candidate par [1.3.3](photo-message-details-133.md).** La publication et les résultats ci-dessous restent conservés. La production reste **1.3.1**, source `baf91e0e7ec9ffee7723e7332e07b7437c8dc5a8`, sous Node **24.22.0**. Sa présentation mobile a été validée visuellement par l’utilisateur ; le clavier logiciel sur téléphone physique n’a pas été explicitement attesté. Le reçu d’alignement des métadonnées 1.3.1 reste absent : sa clôture n’est pas revendiquée. [État courant](REPRISE.md), [preuves 1.3.2](verification-proofs/jm132-verification.json).

## Résultat attendu

- **Une voix personnelle côté client, en français et anglais.** Jessie parle à la première personne dans les textes qui la présentent ou expliquent son échange avec le client. Garder le même sens dans les deux langues et distinguer cette voix des libellés techniques ou des messages propres au client. Le parcours inclut l’entrée, l’accueil, l’accès, l’aide et le téléchargement ; deux e-mails client adaptent aussi leur objet, texte et signature, sans modifier le comportement d’envoi.
- **Une aide plus simple.** Dans le passage sur la personne responsable, enlever « en France » et retirer la phrase indiquant que des personnes autorisées peuvent lire les échanges. Cette reformulation côté client ne change pas les accès réels de l’administration et ne doit pas ajouter une promesse d’accès exclusif de Jessie.
- **Des messages compacts au repos.** Les dates, métadonnées et actions d’un message apparaissent lorsqu’il est sélectionné. Le contenu reste lisible ; sélectionner ne déclenche ni suppression, ni téléchargement, ni envoi. La sélection et sa sortie doivent être accessibles au toucher comme au clavier.

Le correctif réutilise les composants, traductions et données déjà disponibles. Il n’ajoute ni API serveur, ni dépendance, ni migration SQL. Les 268 choix Unicode et leurs carnations, la lecture privée, les profils, les photos, les contrôles d’accès et les conversations existantes sont conservés.

## Garde-fous de présentation

Les états d’erreur ou d’envoi incertain et leur reprise restent immédiatement compréhensibles : les compacter ne doit pas cacher une action nécessaire après une coupure. Le client ne doit toujours recevoir aucune indication de lecture de l’administration. Pour Jessie, les informations de lecture existantes restent consultables dans les détails du message concerné.

Préserver les noms accessibles FR/EN, le focus visible et l’accès aux actions sans dépendre du survol. Le changement de conversation ou de compte nettoie la sélection ; les réponses périmées ne doivent pas restaurer les détails d’un autre échange. Les actions disponibles restent celles du rôle et du message sélectionné, avec les confirmations déjà prévues.

## Qualification locale

**Contrôles mail synthétiques rapportés :** 23/23 tests mail réussis, zéro échec et zéro omission, sous Node 24.19.0 (204.890617 ms). Le contrôle de réinitialisation a d’abord obtenu 8/9, avec un échec sur l’ancien objet « JessieMessage » attendu ; après adaptation de deux assertions à la nouvelle copie, 9/9 réussissent sans omission (331.718626 ms). Ces résultats portent sur les textes mail et le parcours synthétique concerné, pas sur une qualification finale de toute l’interface. Aucun e-mail réel n’a été envoyé.

**Textes et parcours client :** 57/57 tests éditoriaux réussis sans omission (414.379665 ms), après une première tentative à 56/57 (483.231897 ms) qui attendait encore « préparation » au lieu de « pas encore disponible ». Commande : `node --test tests/help-http.test.mjs tests/help-link.test.mjs tests/access-i18n.test.mjs tests/entry-lifecycle.test.mjs tests/notifications-ui.test.mjs`.

**Interactions :** 151/151 tests ciblés réussis sans omission sous Node 24.19.0 (3909.89191 ms). Une première sélection de quatre fichiers avait obtenu 102/103 sans omission (1466.127791 ms) : l’assertion de traduction de la limite de stockage attendait encore « Contacte Jessie » ; elle a été adaptée au texte neutre demandé. Cet échec était une attente de copie, pas une défaillance constatée du traitement des photos. Les deux nouveaux parcours Chrome ont depuis été qualifiés dans la CI de PR, distincte de ces résultats locaux.

**Build et revue :** build/workbench local réussi avec contrôle de 583 sources, avant les derniers paragraphes éditoriaux sur la conservation et les notifications ; syntaxe JavaScript finale ensuite réussie. La revue indépendante finale, statique, couvre disposition, textes et mails et ne relève aucun blocage. Elle ne remplace ni la CI ni un essai sur appareil physique.

## CI de PR et fusion

La [PR 115](https://github.com/fredbuhr/jessiemessage/pull/115) est fusionnée sur `194557719780aed4c2d56dac2c9ec91e0f2886a9`, arbre `be9a1734ce80ed093b05636e4fa88e2512846fdb`. Sa [CI de PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39527675066), source `0f0270b083662824c651fe20e199ea9b679aaa3d`, réussit **5/5 jobs** sous Node **24.22.0** : général **3 226 tests, 3 190 réussis, zéro échec et 36 ignorés** ; Chrome **173/173**, HTTPS/MariaDB **3/3**, MariaDB **10.11 et 11.4 : 479/479 chacune**, sans omission dans ces jobs natifs. Syntaxe/build : **583 sources**. Les omissions générales ne deviennent pas une qualification native.

La [CI main du commit exact](https://github.com/fredbuhr/jessiemessage/actions/runs/39528364838) réussit désormais **5/5 jobs à la tentative 2**, sous Node **24.22.0** : général **3 226 tests, 3 190 réussis, zéro échec et 36 ignorés** ; Chrome **173/173**, HTTPS/MariaDB **3/3**, MariaDB **10.11 et 11.4 : 479/479 chacune**, sans omission dans les quatre jobs natifs ; syntaxe/build **583 sources**. Seul le job verify a été relancé, de `118988238517` à `118990273646` ; les quatre résultats natifs réussis de la première tentative sont conservés.

**Échec initial conservé :** le premier job verify compte **3 226 tests, 3 189 réussis, un échec et 36 ignorés**. Le test `parent channel and authenticated core proof survive an actual stopped child listener`, dans `tests/witness-transport.test.mjs:94`, reçoit `ERASURE_CONTINUITY_INPUT` lors de `f.witness.exchange(packet.request)`.

L’analyse de source relève un poll de 20 ms consommé sans vérifier `pending:true` ni le statut, alors que `gate.verify` effectue des lectures asynchrones avant mise en file : une course de fixture est **probable, sans cause prouvée**, car le paquet exact n’est pas journalisé. Le garde strict d’entrée n’est pas affaibli ; aucun code applicatif ni test n’a été modifié. Le fichier inchangé réussit isolément **4/4**, sans omission, sous Node 24.19.0 (663.816677 ms, `node --test tests/witness-transport.test.mjs`). Ce résultat local ne réécrit pas la tentative CI échouée.

Le test repasse inchangé dans le job verify relancé. Ce succès qualifie le commit livré sans effacer l’échec initial ni établir la cause probable. Aucun garde n’a été modifié et aucun chantier PC n’a été rouvert.

## Publication acquise et ancien parcours opérateur — non exécuté

Le [tag/release v1.3.2](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.2), publié le `2026-10-21T01:47:46Z`, a été vérifié sur la source `194557719780aed4c2d56dac2c9ec91e0f2886a9`, arbre `be9a1734ce80ed093b05636e4fa88e2512846fdb`. Le [run de publication 39529350587](https://github.com/fredbuhr/jessiemessage/actions/runs/39529350587) a réussi ; son workflow est issu du commit `61243a21f0ffb6b2cae3c532f61bf1e624b61777`.

Le parcours prévu à la publication réunissait l’alignement idempotent 1.3.1 (`c073cc59689b5f9cb2c303055dadcaf8f740fe90`, SHA-256 `941f5152fdb96db82d5e1a5b3440f723e122191875d1d26e2a54c98bf506f560`) et la préparation 1.3.2 sur la source et l’arbre exacts publiés. Le [helper 1.3.2](https://github.com/fredbuhr/jessiemessage/blob/60c6559e1ff508e1e4060d9b63b785d4d52d299d/ops/prepare-release132.sh) est publié : SHA-256 `915fd859b229462476429716c847148485c26718e6459b4ea17cd4e0df71cf82`, octets bruts vérifiés, **15/15** tests synthétiques et syntaxe Bash réussis. Il prévoyait 1.3.1 comme repli, sans migration, changement Manager ni redémarrage. **Ce parcours n’a pas été exécuté ; il est remplacé par une préparation directe de 1.3.3 après ses propres qualifications.** Aucune étape intermédiaire de staging 1.3.2 n’est demandée. Le repli courant de la production 1.3.1 reste 1.3.0 et les replis antérieurs sont conservés ; schéma 31 et dépendances sont inchangés. [REPRISE](REPRISE.md) reste la seule référence des prochaines actions.

Le writer 1.3.1 n’a pas encore de reçu rapporté : prévoir son exécution ne vaut pas preuve d’alignement ni clôture anticipée. Aucun reçu serveur de préparation ni d’activation 1.3.2 n’est rapporté. Le tag/release 1.3.2 reste immuable ; aucune activation de cette candidate historique n’est demandée.

## Critères qualifiés et limites conservées

1. Textes client FR/EN et deux formulations demandées dans l’aide vérifiés par les tests éditoriaux et la revue, sans changement des droits d’accès.
2. Messages texte, photo et légende qualifiés en CI côté client et administration : sélection, détails, clavier, confirmations et reprise d’envoi.
3. Petites largeurs, traductions, lecture privée et nettoyage des contextes qualifiés en Chrome. Ces résultats restent distincts d’un essai sur téléphone physique ; ne pas relancer les suites déjà réussies sur ce code inchangé.
4. Les précontrôles hébergés, l’activation et les métadonnées 1.3.2 n’ont pas été réalisés. La suite de livraison porte désormais sur 1.3.3, en préservant la version active et son repli.

Le code est fusionné, qualifié par les CI PR/main et publié. Ce bilan conserve ces résultats et leurs limites ; il ne prescrit plus de déploiement 1.3.2. Le [correctif 1.3.3](photo-message-details-133.md) traite l’accès tactile aux détails des photos sans légende sur ce socle, sans réattribuer les preuves présentes à sa propre qualification.
