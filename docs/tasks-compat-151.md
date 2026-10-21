# Compatibilité du schéma des tâches — version 1.5.1

**Référence qualifiée, fusionnée, publiée et préparée sur l’hébergement ; précontrôle et démarrage non réalisés.** La 1.5.1 est la référence de repli prévue pour la [1.6.0](tasks-reminders-160.md), sans qualification hébergée ni démarrage attestés. La production reste la **1.5.0/schéma 32**, avec son repli courant 1.4.1 enregistré. [REPRISE](REPRISE.md) est l’unique état courant.

La 1.5.1 reconnaît la migration additive 0033, le schéma 33 et les tâches chiffrées. Les tâches restent désactivées dans son runtime normal. Les autres fonctions de la 1.5.0, dont les annonces et les diffusions à grande échelle, restent disponibles. Sauvegarde, restauration et fermeture définitive reconnaissent la nouvelle table. Aucun nouveau worker, fournisseur, secret ou paquet n’est ajouté ; les opérations PC ne sont pas rouvertes.

## Référence publiée et qualification propre

La [PR 121](https://github.com/fredbuhr/jessiemessage/pull/121) est fusionnée sur **`71e62184d2d25a4242e0349c403027e1eeb6537c`**, arbre **`f769c99aa800486bd04065a308f1f4269841c215`**. La [CI PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39638690632) et la [CI main propre](https://github.com/fredbuhr/jessiemessage/actions/runs/39639464133) réussissent chacune **5/5**, cinq logs propres relus sous Node **24.22.0**.

Chaque exécution compte **3 343 tests généraux, 3 304 réussis, zéro échec et 39 ignorés** (37 SQL et deux procfs), Chrome **189/189**, HTTPS/MariaDB **3/3**, MariaDB **10.11/11.4, 505/505 chacune**. Les tâches couvrent huit sous-cas SQL, six tests Chrome dans sept contextes, ainsi que la restauration et la purge de tâches non vides. Les omissions générales restent distinctes de la qualification native. Ces CI synthétiques n’attestent ni téléphone physique, ni débit réel du mutualisé, ni fonctionnement courant du PC. Les [preuves 1.5.1](verification-proofs/jm151-verification.json) conservent les détails propres ; les [preuves 1.6.0](verification-proofs/jm160-verification.json) documentent séparément la référence fonctionnelle.

Le [tag et la release v1.5.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.5.1), identifiant **419827910**, sont vérifiés sur ce commit exact ; publication le **`2026-10-21T17:05:36Z`**. Le [workflow de publication](https://github.com/fredbuhr/jessiemessage/actions/runs/39640634625) est distinct de la source applicative.

## Préparation acquise et repli à qualifier

Le [reçu SSH utilisateur complet](verification-proofs/jm160-hosted-staging.json) confirme la préparation séparée de 1.5.1 et 1.6.0, leurs sources et arbres exacts, Node **v24.22.0** et son empreinte attendue, leurs lanceurs et journaux distincts. La production 1.5.0, ses lanceurs, journaux et métadonnées sont préservés. Aucune date d’exécution non fournie n’est déduite.

**1.5.1 est préparée, mais pas encore qualifiée sur l’hébergement ni démarrée** : `rollback151Prepared:true`, `rollback151HostedQualified:false`, `rollback151RuntimeStarted:false`. Le staging n’a lancé ni SQL, ni précontrôle, ni serveur et conserve `noRestart:true`, `managerChanged:false` et `checkpointChanged:false`. L’inventaire des fichiers attend 33 migrations, tandis que `sqlStatusChecked:false` laisse le statut SQL à vérifier. **Ne pas rejouer cette préparation ni tronquer les journaux.**

La seule prochaine action est la [lecture du statut SQL](REPRISE.md#prochaine-action--statut-sql-en-lecture-seule). Attendre ce reçu avant toute migration, changement Run/Build ou redémarrage. Aucun démarrage intermédiaire de 1.5.1 ni effacement d’un repli antérieur n’est requis à cette étape.
