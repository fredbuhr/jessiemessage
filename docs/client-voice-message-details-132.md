# Voix de Jessie et détails des messages — correctif 1.3.2

**21 octobre 2026 — code prêt et contrôles locaux rapportés réussis ; CI, fusion et publication en attente.** La production reste **1.3.1**, dont la présentation mobile a été validée visuellement par l’utilisateur ; le clavier logiciel sur téléphone physique n’a pas été explicitement attesté. Le reçu d’alignement des métadonnées 1.3.1 reste absent : sa clôture n’est pas revendiquée, mais cette attente ne bloque pas le correctif demandé. [État courant](REPRISE.md), [preuves 1.3.2](verification-proofs/jm132-verification.json).

## Résultat attendu

- **Une voix personnelle côté client, en français et anglais.** Jessie parle à la première personne dans les textes qui la présentent ou expliquent son échange avec le client. Garder le même sens dans les deux langues et distinguer cette voix des libellés techniques ou des messages propres au client. Le parcours inclut l’entrée, l’accueil, l’accès, l’aide et le téléchargement ; deux e-mails client adaptent aussi leur objet, texte et signature, sans modifier le comportement d’envoi.
- **Une aide plus simple.** Dans le passage sur la personne responsable, enlever « en France » et retirer la phrase indiquant que des personnes autorisées peuvent lire les échanges. Cette reformulation côté client ne change pas les accès réels de l’administration et ne doit pas ajouter une promesse d’accès exclusif de Jessie.
- **Des messages compacts au repos.** Les dates, métadonnées et actions d’un message apparaissent lorsqu’il est sélectionné. Le contenu reste lisible ; sélectionner ne déclenche ni suppression, ni téléchargement, ni envoi. La sélection et sa sortie doivent être accessibles au toucher comme au clavier.

Le correctif réutilise les composants, traductions et données déjà disponibles. Il n’ajoute ni API serveur, ni dépendance, ni migration SQL. Les 268 choix Unicode et leurs carnations, la lecture privée, les profils, les photos, les contrôles d’accès et les conversations existantes sont conservés.

## Garde-fous de présentation

Les états d’erreur ou d’envoi incertain et leur reprise restent immédiatement compréhensibles : les compacter ne doit pas cacher une action nécessaire après une coupure. Le client ne doit toujours recevoir aucune indication de lecture de l’administration. Pour Jessie, les informations de lecture existantes restent consultables dans les détails du message concerné.

Préserver les noms accessibles FR/EN, le focus visible et l’accès aux actions sans dépendre du survol. Le changement de conversation ou de compte nettoie la sélection ; les réponses périmées ne doivent pas restaurer les détails d’un autre échange. Les actions disponibles restent celles du rôle et du message sélectionné, avec les confirmations déjà prévues.

## Qualification locale et livraison restante

**Contrôles mail synthétiques rapportés :** 23/23 tests mail réussis, zéro échec et zéro omission, sous Node 24.19.0 (204.890617 ms). Le contrôle de réinitialisation a d’abord obtenu 8/9, avec un échec sur l’ancien objet « JessieMessage » attendu ; après adaptation de deux assertions à la nouvelle copie, 9/9 réussissent sans omission (331.718626 ms). Ces résultats portent sur les textes mail et le parcours synthétique concerné, pas sur une qualification finale de toute l’interface. Aucun e-mail réel n’a été envoyé.

**Textes et parcours client :** 57/57 tests éditoriaux réussis sans omission (414.379665 ms), après une première tentative à 56/57 (483.231897 ms) qui attendait encore « préparation » au lieu de « pas encore disponible ». Commande : `node --test tests/help-http.test.mjs tests/help-link.test.mjs tests/access-i18n.test.mjs tests/entry-lifecycle.test.mjs tests/notifications-ui.test.mjs`.

**Interactions :** 151/151 tests ciblés réussis sans omission sous Node 24.19.0 (3909.89191 ms). Une première sélection de quatre fichiers avait obtenu 102/103 sans omission (1466.127791 ms) : l’assertion de traduction de la limite de stockage attendait encore « Contacte Jessie » ; elle a été adaptée au texte neutre demandé. Cet échec était une attente de copie, pas une défaillance constatée du traitement des photos. Deux nouveaux parcours Chrome restent à exécuter en CI ; les résultats locaux ne valent pas leur qualification.

**Build et revue :** build/workbench local réussi avec contrôle de 583 sources, avant les derniers paragraphes éditoriaux sur la conservation et les notifications ; syntaxe JavaScript finale ensuite réussie. La revue indépendante finale, statique, couvre disposition, textes et mails et ne relève aucun blocage. Elle ne remplace ni la CI ni un essai sur appareil physique.

1. Vérifier les textes client FR/EN concernés, la cohérence de la première personne et la suppression des deux formulations demandées dans l’aide, sans élargir le travail aux droits d’accès.
2. Vérifier sur client et administration les messages texte, photo et légende : affichage compact, sélection, détails, sortie de sélection, accès au clavier et absence d’action automatique. Garder visibles les erreurs et la reprise nécessaire.
3. Vérifier les petites largeurs et l’ordinateur, les traductions, la lecture privée et le nettoyage au changement de conversation. Distinguer essais automatisés, simulation de viewport et retour d’un téléphone physique.
4. Consigner les résultats réels du code et des tests, puis qualifier la CI du commit exact avant fusion, tag/release et préparation hébergée. Préserver la version active et son repli jusqu’à la vérification de l’activation suivante.

Le code et ces contrôles locaux sont prêts ; la qualification CI du commit exact, notamment les deux nouveaux parcours Chrome, reste en attente. Aucune fusion, tag/release, précontrôle hébergé, activation ou reçu de métadonnées 1.3.2 n’est attesté dans ce bilan. Les références seront ajoutées après observation ; aucune opération utilisateur sur l’ancienne livraison n’est requise pour poursuivre le développement.
