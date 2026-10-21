# Tâches et rappels privés — Évolution 5, version 1.6.0

**Code qualifié, fusionné, publié et préparé sur l’hébergement ; statut SQL à lire.** La production reste la **1.5.0/schéma 32**, avec son repli 1.4.1. Aucune migration 0033 ni activation 1.6.0 n’est attestée. [REPRISE](REPRISE.md) conserve l’état courant et la seule prochaine action.

## Parcours retenu

Jessie peut garder plusieurs tâches privées pour un même client : photo ou vidéo à préparer, demande particulière, show privé ou autre chose à ne pas oublier. Une tâche contient un texte libre de 500 caractères maximum et une échéance facultative, affichée dans l’heure locale de l’appareil. Elle peut être modifiée, reportée, terminée puis rouverte.

Une page **Mes tâches** rassemble les tâches à faire, celles arrivées à échéance et celles terminées. **Options → Fiche → Tâches du client** ouvre cette même vue filtrée. Le menu de la messagerie donne accès à **Mes tâches** avec un compteur discret des échéances à traiter, sans nouvelle barre dans la discussion. La liste se parcourt par pages ; elle ne promet pas un classement chronologique global.

Les rappels sont visibles dans l’application et sont actualisés à son retour au premier plan. Ils n’émettent pas de notification push lorsque l’application est fermée. Aucun message ni rappel n’est envoyé au client. L’ancienne date de suivi des fiches CRM reste conservée séparément.

## Intégration

Une table additive `crm_tasks`, migration **0033**, conserve les tâches liées à l’administrateur et à la conversation. Leur texte est chiffré avec un domaine propre à partir de la clé CRM existante. Aucun nouveau fournisseur, worker, secret ou paquet n’est ajouté. Les versions, l’identité stable de création et l’empreinte de demande évitent les doublons après une réponse perdue et les écrasements entre deux appareils. Un conflit conserve le brouillon et demande un choix explicite après comparaison.

La [1.5.1 compatible](tasks-compat-151.md) reconnaît le schéma 33 et les tâches chiffrées, avec les tâches désactivées dans le runtime normal. La 1.6.0 les active. La production 1.5.0 et son repli 1.4.1 restent préservés ; leur usage après migration ne doit pas être présumé compatible. La 1.5.1 est préparée, sans qualification hébergée ni démarrage : ses précontrôles devront être constatés séparément.

## Référence et qualification propres

La [PR 122](https://github.com/fredbuhr/jessiemessage/pull/122) est fusionnée sur **`9590741e7065067aee9d1ad5d1206739cc27eb6b`**, arbre **`38e72545ab4fd6feb4a04e934b2eb8685f82b970`**. La [CI PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39638697333) et la [CI main propre](https://github.com/fredbuhr/jessiemessage/actions/runs/39640655562) réussissent chacune **5/5**, cinq logs propres relus sous Node **24.22.0**.

Chaque CI compte **3 343 tests généraux, 3 304 réussis, zéro échec et 39 ignorés** (37 SQL et deux procfs) ; Chrome **189/189**, HTTPS/MariaDB **3/3**, MariaDB **10.11/11.4, 505/505 chacune**. Les tâches couvrent huit sous-cas SQL et six tests Chrome dans sept contextes : création, report, terminer et réouvrir, FR/EN mobile, texte privé littéral, réponse perdue, conflit, changement de compte, pagination, refus CSRF et lecture obsolète après enregistrement. La restauration et la purge de tâches non vides sont qualifiées en SQL natif. Les omissions générales restent des omissions ; aucun téléphone physique, débit réel du mutualisé ou fonctionnement courant du PC n’est déduit de ces CI synthétiques.

Le [tag et la release v1.6.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.6.0), identifiant **419841377**, sont vérifiés sur ce commit exact ; publication le **`2026-10-21T17:17:53Z`**. Le [workflow de publication](https://github.com/fredbuhr/jessiemessage/actions/runs/39642494041) provient du commit opérateur **`44ae0e21856b0a22bdf724258396b42793e9c718`**, distinct de la source applicative. Les [preuves 1.6.0](verification-proofs/jm160-verification.json) conservent les détails propres ; les [preuves 1.5.1](verification-proofs/jm151-verification.json) documentent séparément sa qualification.

## Préparation hébergée acquise — ne pas rejouer

Le [reçu SSH utilisateur complet](verification-proofs/jm160-hosted-staging.json) confirme **`staged_awaiting_schema33`** pour les deux sources et arbres publiés, Node **v24.22.0** et son empreinte attendue, les lanceurs et journaux distincts. L’inventaire des migrations est additif : 32 fichiers de référence, 33 attendus ; **`sqlStatusChecked:false` ne confirme pas le schéma SQL appliqué**. Aucune date d’exécution non fournie n’est déduite.

Le repli 1.5.1 est préparé, sans précontrôle hébergé ni démarrage. `started:false`, `migrated:false`, `precheckPassed:false`, `runtimeStarted:false`, `managerChanged:false`, `checkpointChanged:false` et `noRestart:true` décrivent ce staging. Les chemins, modes et empreintes complets restent dans le reçu. La production 1.5.0, ses lanceurs et son checkpoint sont préservés. **Ne pas rejouer la préparation ni tronquer les journaux.**

Les [helpers opérateur initiaux publiés](https://github.com/fredbuhr/jessiemessage/tree/1c5fe2e6ee0d6fb6d2e2837cb8080b831b27eb6a/ops) conservent **59/59 tests synthétiques**, une revue indépendante et leurs octets publiés vérifiés. Ces tests restent distincts du reçu de staging et ne constituent pas une migration ou une activation hébergée.

Les quatre empreintes de lanceurs réelles du reçu sont épinglées dans le [helper de migration courant](https://github.com/fredbuhr/jessiemessage/blob/e85cfe36ee3dfd62edf64d043461a7ebc727ba2d/ops/upgrade-release160.sh), SHA-256 **`9172a68d37004783422405c232e9dfe57c661f0884c887650592f6683c6123c5`**. Les mêmes 32 cas synthétiques de statut/migration ont réussi après cet épinglage ; ses octets publiés ont été vérifiés. L’ancien template initial reste historique. Aucun arrêt, diagnostic SQL, migration ou précontrôle hébergé n’est attesté ; le helper épinglé n’est pas encore à exécuter.

La [lecture seule du statut SQL dans REPRISE](REPRISE.md#prochaine-action--statut-sql-en-lecture-seule) est la seule prochaine action. Attendre son résultat avant toute migration, modification Run/Build ou relance ; le lot reste ouvert jusqu’à sa livraison vérifiée.
