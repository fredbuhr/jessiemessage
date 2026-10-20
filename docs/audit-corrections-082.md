# Corrections de l’audit — lot 3, version 0.82

**0.82.0 déployé et vérifié le 20 octobre 2026 à 12:25 Europe/Paris.** A06, A09 et A10 corrigés et qualifiés, sans nouvelle infrastructure, dépendance ni migration.

| Constat | Correction |
| --- | --- |
| A06 — copie média interrompue | Vérifier la source et tous les fichiers cible présents avant toute écriture ; copier seulement les absents avec création exclusive. Refuser et conserver les fichiers tronqués, divergents, inconnus ou liés. La capture habituelle conserve son contrat de cible vide. |
| A09 — arrêt forcé masqué | Propager l’échec du drainage depuis le runtime au superviseur et à la CLI. Continuer les autres fermetures après une erreur, conserver l’idempotence et observer les promesses d’annulation. Un arrêt coopératif reste réussi. |
| A10 — schéma référencé non comparé | Lire et comparer exactement `REFERENCED_TABLE_SCHEMA` à la base courante dans les sept validateurs locaux concernés. Conserver les règles et contraintes métier. |

La [procédure opérateur](manual-restore-operator-078.md) décrit la reprise et, en cas de fichier endommagé, l’abandon explicite vers un nouveau job, une autre base vide et une autre racine média. L’ancien job et ses marqueurs restent intacts. Aucun écrasement ni réparation implicite d’un import SQL partiel.

## Qualification et portée

Les régressions utilisent des fichiers et comptes synthétiques. A06 couvre une interruption après synchronisation d’un premier fichier complet, la conservation de son inode, la copie du suivant et un import SQL unique ; une interruption pendant l’écriture produit un fichier tronqué conservé et refusé. Le test d’intégration SQL utilise le vrai import et une vérification snapshot/empreintes, avec contexte/connecteur injectés et transport loopback sans TLS : il ne requalifie pas tout le contexte opérateur/TLS de production.

A09 couvre de vrais enfants coopératifs, non zéro et ignorant SIGTERM, le passage SIGKILL, les résultats `finished.failed`, les rejets et le nettoyage après erreurs. A10 couvre le catalogue canonique et les six magasins sur les MariaDB natives CI, avec parents homonymes d’une autre base synthétique, refus puis rétablissement de la contrainte initiale.

Local : **3 116 tests, 2 902 réussis, 214 ignorés, zéro échec**, syntaxe **568 fichiers** ; revues indépendantes sans blocage. Les omissions locales procfs/SQL restent distinctes des validations natives.

[PR #104](https://github.com/fredbuhr/jessiemessage/pull/104) fusionnée : candidat `dc225b575401d60da35318d5f593f5ee383c3de2`, merge `bfc2a2217bfb6ff06dcae340fd9fc7b640609865`, arbre identique `380b11faa02801a42eddf5bade4f66c45d901257`.

Cinq jobs réussis sur le [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39405670555) et sur [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39406423081), [push source](https://github.com/fredbuhr/jessiemessage/actions/runs/39405664685) également vert : **3 085 tests généraux réussis, 35 wrappers SQL ignorés, zéro échec ; 466/466 sur chaque MariaDB 10.11 et 11.4 sans omission ; Chrome 161/161 ; HTTPS/SQL 2/2 ; syntaxe 568 fichiers ; aperçu construit.** Reprise A06 et six sous-cas A10 confirmés dans les quatre journaux SQL candidat/main. Le script Windows n’a pas changé ; sa qualification 0.81 et l’installation personnelle restent distinctes.

## Déploiement vérifié

Précontrôle en lecture seule réussi à **10:14:19.614979 UTC**, sans démarrage ni effacement. Dépendances identiques après comparaison des lockfiles hors deux versions racine, réutilisées sans réinstallation. Build normal du Manager réussi **12:22 Europe/Paris** avec redémarrage habituel, sans second parent SSH. [Preuve Manager](verification-proofs/jm082-manager.jpg).

À **10:25:31.837903 UTC / 12:25:31 Europe/Paris** : source, arbre, propreté, version et lanceur vérifiés ; dix empreintes sensibles et identité d’autorisation PC préservées. Reçu de démarrage du superviseur observé après IPC/disponibilité réelle de l’enfant ; composition `start-local-closures` et précontrôle validés, moniteur des sauvegardes **OK**. Les PID ne sont pas directement observés depuis SSH ; la capacité locale découle de la composition épinglée, du précontrôle et du démarrage réel.

Santé et disponibilité HTTPS **200**, JSON attendu, `no-store`, sans cookie et HSTS unique sur les deux origines. Trois API privées et `/backups.js` **401 anonymes**, avec HSTS ; aucun GET administrateur authentifié revendiqué. La sauvegarde quotidienne antérieure de **05:15 UTC** était réussie et le runtime repris avant cette livraison. Aucune restauration ou interruption forcée de production pour valider.

Pins, contrôles et limites dans les [preuves structurées](verification-proofs/jm082-verification.json) et [REPRISE](REPRISE.md). Checkpoint privé unique actualisé, lot 2 et ancien historique conservés ; repli immédiat **0.81** prêt, sans retour SQL ni suppression de journaux.

## Conservation et suite

Aucun message ou mail réel, effacement de compte, restauration de production, nouveau raccordement ou changement de clé pour qualifier ce lot. D1, autorité, configurations et autorisation PC préservés.

La mise à jour personnelle du kit 0.81 reste non observée ; le lot 3 ne change pas son script Windows. A01 (Node fourni par l’hébergeur) et l’exécuteur d’archivage A08 restent ouverts séparément. Après bilan du lot 3, lot 4 : interface et entretien KISS ; aucune nouvelle architecture.
