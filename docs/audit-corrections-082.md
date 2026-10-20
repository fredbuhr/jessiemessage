# Corrections de l’audit — lot 3, version 0.82

**Qualification locale réussie, CI native en attente ; le service reste en 0.81 tant que le déploiement n’est pas vérifié.** Périmètre limité à A06, A09 et A10, sans nouvelle infrastructure ni migration.

| Constat | Correction |
| --- | --- |
| A06 — copie média interrompue | Vérifier la source et tous les fichiers cible présents avant toute écriture ; copier seulement les absents avec création exclusive. Refuser et conserver les fichiers tronqués, divergents, inconnus ou liés. La capture habituelle conserve son contrat de cible vide. |
| A09 — arrêt forcé masqué | Propager l’échec du drainage depuis le runtime au superviseur et à la CLI. Continuer les autres fermetures après une erreur, conserver l’idempotence et observer les promesses d’annulation. Un arrêt coopératif reste réussi. |
| A10 — schéma référencé non comparé | Lire et comparer exactement `REFERENCED_TABLE_SCHEMA` à la base courante dans les sept validateurs locaux concernés. Conserver les règles et contraintes métier. |

La [procédure opérateur](manual-restore-operator-078.md) décrit la reprise et, en cas de fichier endommagé, l’abandon explicite vers un nouveau job, une autre base vide et une autre racine média. L’ancien job et ses marqueurs restent intacts. Aucun écrasement ni réparation implicite d’un import SQL partiel.

## Qualification et portée

Les régressions utilisent des fichiers et comptes synthétiques. A06 couvre une interruption après synchronisation d’un premier fichier complet, la conservation de son inode, la copie du suivant et un import SQL unique ; une interruption pendant l’écriture produit un fichier tronqué conservé et refusé. Le test d’intégration SQL utilise le vrai import et une vérification snapshot/empreintes, avec contexte/connecteur injectés et transport loopback sans TLS : il ne requalifie pas tout le contexte opérateur/TLS de production.

A09 couvre de vrais enfants coopératifs, non zéro et ignorant SIGTERM, le passage SIGKILL, les résultats `finished.failed`, les rejets et le nettoyage après erreurs. A10 couvre le catalogue canonique et les six magasins sur les MariaDB natives CI, avec parents homonymes d’une autre base synthétique, refus puis rétablissement de la contrainte initiale.

Local : **3 116 tests, 2 902 réussis, 214 ignorés, zéro échec**, syntaxe **568 fichiers** ; revues indépendantes sans blocage. Les résultats CI candidat/main et contrôles de déploiement seront consignés dans les [preuves structurées](verification-proofs/jm082-verification.json). Les omissions locales procfs/SQL restent distinctes des validations natives.

## Conservation et suite

Aucun message ou mail réel, effacement de compte, restauration de production, nouveau raccordement ou changement de clé pour qualifier ce lot. D1, autorité, configurations et autorisation PC à préserver. Repli préparé vers 0.81 avant application.

La mise à jour personnelle du kit 0.81 reste non observée ; le lot 3 ne change pas son script Windows. A01 (Node fourni par l’hébergeur) et l’exécuteur d’archivage A08 restent ouverts séparément. Après bilan du lot 3, lot 4 : interface et entretien KISS ; aucune nouvelle architecture.
