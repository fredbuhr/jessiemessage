# Compatibilité du schéma des tâches — version 1.5.1

**Référence qualifiée, fusionnée et publiée ; préparation et précontrôle hébergés non réalisés.** La 1.5.1 est la référence de repli prévue pour la [1.6.0](tasks-reminders-160.md), sans qualification hébergée ni démarrage attestés. La production reste la **1.5.0/schéma 32**, avec son repli courant 1.4.1 enregistré. [REPRISE](REPRISE.md) est l’unique état courant.

La 1.5.1 reconnaît la migration additive 0033, le schéma 33 et les tâches chiffrées. Les tâches restent désactivées dans son runtime normal. Les autres fonctions de la 1.5.0, dont les annonces et les diffusions à grande échelle, restent disponibles. Sauvegarde, restauration et fermeture définitive reconnaissent la nouvelle table. Aucun nouveau worker, fournisseur, secret ou paquet n’est ajouté ; les opérations PC ne sont pas rouvertes.

## Référence publiée et qualification propre

La [PR 121](https://github.com/fredbuhr/jessiemessage/pull/121) est fusionnée sur **`71e62184d2d25a4242e0349c403027e1eeb6537c`**, arbre **`f769c99aa800486bd04065a308f1f4269841c215`**. La [CI PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39638690632) et la [CI main propre](https://github.com/fredbuhr/jessiemessage/actions/runs/39639464133) réussissent chacune **5/5**, cinq logs propres relus sous Node **24.22.0**.

Chaque exécution compte **3 343 tests généraux, 3 304 réussis, zéro échec et 39 ignorés** (37 SQL et deux procfs), Chrome **189/189**, HTTPS/MariaDB **3/3**, MariaDB **10.11/11.4, 505/505 chacune**. Les tâches couvrent huit sous-cas SQL, six tests Chrome dans sept contextes, ainsi que la restauration et la purge de tâches non vides. Les omissions générales restent distinctes de la qualification native. Ces CI synthétiques n’attestent ni téléphone physique, ni débit réel du mutualisé, ni fonctionnement courant du PC. Les [preuves 1.5.1](verification-proofs/jm151-verification.json) conservent les détails propres ; les [preuves 1.6.0](verification-proofs/jm160-verification.json) documentent séparément la référence fonctionnelle.

Le [tag et la release v1.5.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.5.1), identifiant **419827910**, sont vérifiés sur ce commit exact ; publication le **`2026-10-21T17:05:36Z`**. Le [workflow de publication](https://github.com/fredbuhr/jessiemessage/actions/runs/39640634625) est distinct de la source applicative.

## Préparation et repli

La [préparation SSH épinglée dans REPRISE](REPRISE.md#prochaine-action--préparation-hébergée-uniquement) doit préparer 1.5.1 et 1.6.0 séparément, en conservant les fichiers, lanceurs, journaux et métadonnées de la production 1.5.0. Aucun reçu de cette préparation n’est encore fourni. La préparation seule ne qualifiera pas 1.5.1 sur le schéma SQL appliqué ; cette qualification devra être constatée après migration et précontrôles distincts.

Attendre le reçu de préparation avant toute autre consigne. Aucun SQL, changement Run/Build, redémarrage ou démarrage intermédiaire de 1.5.1 n’est à exécuter maintenant. Aucun repli antérieur n’est effacé ni réétiqueté.
