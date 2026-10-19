# Réexécution des fermetures sur une cible isolée — 0.75.0

## Portée

`replayClosureReconciliation()` est un exécuteur **interne**, sans CLI d’écriture, route HTTP ou worker. Il réapplique les fermetures connues sur une copie isolée puis conserve sa quarantaine. Il ne transfère pas l’autorité du témoin et n’autorise aucun démarrage.

La source du service reste 0.72.0, en observation, `closuresEnabled:false`. **Aucun effacement C5 ni rebind n’est tenté sur D1 réel** : son profil SQL `shared_admin / raw_underscore_pattern` ne satisfait toujours pas l’inventaire strict. Les effacements de cette livraison sont éprouvés sur des données et fichiers fictifs en CI native, distincts de l’essai réel en lecture seule C4.

## Préconditions contrôlées

- Plan C4 recalculé avec de nouveaux défis et empreinte attendue exacte ; témoin indépendant, journal local, capsule, marqueur, reçu et manifeste inchangés. Les six clés et le manifeste sont authentifiés, liés au reçu choisi et à l’identité source originale.
- Base et racine cible réellement distinctes ; identités physiques source et cible relues. Le dossier de progression est privé, séparé du dépôt, de la source, de la capture, des médias et de la quarantaine ; les alias directs de répertoire sont refusés.
- Exclusion effective de **tous** les producteurs et captures de la cible, fournie par la composition appelante pour toute l’opération. L’exécuteur conserve aussi un verrou de cycle privé ; son verrou SQL ne prétend pas arrêter les producteurs. Un booléen « offline » ne remplace pas cette composition.
- Inspecteur SQL distinct et privilégié, schéma exact, trente migrations/tables et contraintes attendues. `assertBackupInspection` reste sur la façade privilégiée en lecture seule ; `assertErasureSchema`, qui règle sa session, utilise une connexion séparée du pool cible. Ces contrôles sont exécutés avant les mutations et pendant les gardes : aucun remplacement par l’inspection applicative plus faible ou par zéro ligne visible sous des droits insuffisants.
- Clone initial comparé à la capture authentifiée, inventaire physique et déchiffrement contrôlés. Les allocations cible `reserved` / `cleanup_pending` doivent d’abord être traitées par la préparation de récupération authentifiée existante : cette portée C5 les refuse avant écriture de progression et avant rebind. Elle n’invente pas de suppression de fichiers en attente.

## Progression cible et interruptions

Le journal global `reconciliation-progress.json` est chiffré AES-GCM, en 0600, publié atomiquement avec révision et transitions `prepared → running → completed`. Son contexte lie plan, manifeste et binding cible. Une dérivation HKDF distincte protège les journaux d’effacement cible ; ni leur clé ni leur contexte ne sont ceux des enveloppes source. Une clé ou une époque différente ne peut pas masquer le journal global existant.

Avant toute fermeture cible, la transition de capacité utilise le CAS existant `createBackupRecoveryStore().rebind()` : limites, somme retenue, base sélectionnée, empreinte source/cible et absence d’allocations en attente sont vérifiées. Un accusé perdu après cette transition peut être repris sous la même progression `prepared`, après nouveau contrôle du clone.

Chaque reçu source, terminé **ou encore en cours**, crée une nouvelle progression cible depuis `requested`, curseur nul. Les phases et curseurs source ne décrivent pas les fichiers revenus dans l’ancienne capture. Les enveloppes source restent intactes ; la progression cible n’est pas publiée comme une nouvelle fermeture source.

Le moteur d’effacement existant traite les comptes présents. `inspectReconciliation()` traite explicitement les identités absentes de la capture et refuse les administrateurs homonymes ou les résidus. Une absence SQL ne suffit pas : les clés de stockage du manifeste original restent disponibles après suppression des lignes, et les deux variantes doivent être absentes. Ce contrôle permet aussi de reprendre après suppression SQL achevée mais accusé ou publication de journal perdus.

Un cycle déjà `completed` exige exactement tous ses journaux cible terminés. Il vérifie à nouveau l’absence des comptes et fichiers sans recréer de journal ou relancer l’effacement. Journal manquant, phase inachevée, compte ou fichier réapparu : refus sous la même époque. Le verrou temporaire reste utilisé pour sérialiser cette vérification.

Les gardes vérifient ressources, exclusion, inventaire strict et preuve source fraîche avant les mutations SQL/fichiers et les publications de progression. Toute dérive source bloque le cycle ; aucun nouveau plan, effacement de journal ou remise à zéro ne se fait implicitement. Une interruption conserve le marqueur bloquant.

## Fin du contrôle

Pour chaque identité, l’exécuteur vérifie le graphe SQL absent et les fichiers originaux absents. Il contrôle ensuite l’inventaire global restant, les contenus chiffrés, la stabilité du snapshot, tous les journaux cible et la tête source indépendante.

Le résultat annonce `closure_target_reconciled_quarantined`, le nombre de reçus réconciliés et `targetAbsenceVerified:true`, `capacityRebound:true`. Il conserve **`quarantineRetained:true`, `reconciliationRequired:true`, `authorityTransferred:false`, `started:false`**. Il ne constitue pas une capacité de réouverture. Le marqueur n’est jamais modifié ou supprimé par C5.

## Validation

Les douze tests du journal chiffré couvrent contexte, mauvais secrets, droits/liens, dérive, CAS/concurrence, transitions, annulation par l’autoriseur et accusé perdu après publication durable. Sept autres tests refusent les égalités et imbrications du dossier de progression avant verrou, exclusion, témoin ou SQL, en conservant les fichiers.

La suite `tests/closure-reconciliation.integration.test.mjs`, ajoutée à `npm run test:db`, travaille sur deux bases et racines privées distinctes avec de vrais fichiers chiffrés, manifeste v10, reçu, capsule, quarantaine et témoin durable. Elle vérifie l’effacement d’un client fictif, un reçu source terminé au curseur élevé, une intention source encore en cours pour un client absent, les reprises après unlink et commit final incertain, l’ancien succès avec journal manquant/identité réapparue, les refus de privilèges/trigger et la conservation des pairs, de leur capacité, de la source et des enveloppes originales. Le moteur ordinaire conserve son refus d’un client absent lors de la création d’une fermeture normale.

Les résultats datés et liens CI sont dans les [preuves 0.75](verification-proofs/jm075-verification.json). Une réussite synthétique sur MariaDB ne qualifie pas les droits de l’hébergement réel.

## Suite exacte

Qualifier l’inventaire SQL réel sans affaiblir la garde, puis composer la préparation authentifiée et cet exécuteur avec l’exclusion réelle des producteurs. La succession durable source → cible sur le PC existant reste ensuite nécessaire : exclure l’ancien propriétaire et acquérir une nouvelle preuve à la première ouverture cible. Aucun nouveau contrat, appariement, contrôle GPG ou import D1 n’est demandé pour répéter les acquis.
