# Reprendre JessieMessage

Ce fichier est le point d'entrée de reprise après la perte d'une discussion. Lire ensuite le [rapport d'audit du 18 octobre](AUDIT-REPRISE-2026-10-18.md), le [plan courant](production-readiness-2026-10-17.md) et le [relevé 0.52](recurring-private-checkpoints-052.md).

## Source complète et code exécuté

| Élément | Référence à préserver |
| --- | --- |
| Dépôt | `https://github.com/fredbuhr/jessiemessage` |
| Dernière source complète retrouvée | Branche `feat/recurring-private-checkpoints`, commit `dc02ec6795a7e8c3312d253797ad6382439f5735`, arbre `9454ed83059615d420f8182fac6382310577f91a` |
| Branche de reprise | `feat/reprise-audit-backup-freshness`, issue de ce commit complet |
| Runtime applicatif réellement actif | `0a1cafd85c3d8699be1961075b18e80e36bcd041`, arbre `17db89aa165e23ca427d073f5a3fcc28387f5168` — étape 0.50 |
| Superviseur réellement actif | `9665d54cc6abb236b04eecc9d92540d7e1c5d035`, arbre `67a0757f77cced10d07f25936b71a30fd6539075` — étape 0.52 |
| Branche par défaut au moment de la reprise | `main` = `a688b30ef4e039a30de7bf05e98761845dcee8d4` : sous-ensemble de surveillance, pas l'application complète |
| Données | Schéma 30, six configurations privées existantes, mêmes clés/comptes/sessions |

**Ne pas déployer `main` comme si cette branche contenait l'application.** Ne pas réécrire la pile de PR pour reprendre. Créer une branche depuis la source complète ci-dessus, puis vérifier les nouveaux commits éventuels. Les preuves d'activation distinguent toujours le code applicatif, le code opérateur et la documentation ultérieure.

## Hébergement et accès existants

- Principal : `https://jessiemessage.com` ; recette conservée : `https://recette.jessiemessage.com`. Les deux adresses partagent le runtime et les données ; ce ne sont pas deux bases indépendantes.
- [Tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard).
- [Terminal SSH existant](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal).
- Runtime : `/srv/customer/jessiemessage-operator/broadcast-direct-delivery-0a1cafd8`.
- Superviseur : `/srv/customer/jessiemessage-operator/recurring-checkpoints-9665d54c`.
- Configuration : `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851`.
- Sauvegardes : `/srv/customer/jessiemessage-private/recurring-backup-052` ; quotidien à **05:15 UTC**.
- Run Manager : `bash /srv/customer/jessiemessage-private/start-primary-backups-checked-9665d54c.sh`.
- Repli du superviseur : anciennes commandes conservées dans `recurring-backup-052/manager-before-activation-052.json`. Pour un repli de code, utiliser le cycle Manager normal ; aucune restauration SQL.

Ne pas modifier les dossiers actifs pour y installer un nouvel outil : leur source et leur propreté Git sont épinglées. Préparer un checkout opérateur séparé. Ne pas lancer une capture `--offline` pendant que le runtime tourne. La clé privée GPG et sa phrase restent sur le PC du propriétaire ; aucune demande de secret dans la discussion.

## Acquis et contraintes de produit

- Invités, messages, photos, notifications, récupération de mot de passe et parcours des fiches déjà acceptés : conserver ces acquis, demander seulement des observations nouvelles ciblées.
- `COFFRE_DECHIFFRE_OK` et `COPIE_CRM30_OK` acquis ; restauration isolée trente tables/photos vérifiée en 0.46.
- Aucun accord aux envois groupés côté invité. Messages livrés individuellement, sans métadonnées de groupe ou d'audience. Limite actuelle : **100 destinataires par campagne**.
- Les données historiques `broadcast_preferences` restent dans le schéma et les sauvegardes ; ne pas supprimer leur migration. Elles ne conditionnent plus la livraison.
- Contact officiel : `contact@jessiemessage.com`.
- Les comptes administrateurs partagés conservent leurs sessions par appareil ; ne pas réinitialiser de compte ou de clé pour reprendre.

## Point d'arrêt et suite

La première capture 0.52 est consignée comme réussie le 18 octobre à 02:28:16 Europe/Paris. Le contrôle SSH du 18 octobre à 00:47:06.582 UTC retrouve deux enregistrements, `lastSuccessAt: 1792283296649`, `succeeded / finished / OK / runtimeResumed: true` et configuration activée à 05:15 UTC.

La copie et le déchiffrement PC de cette nouvelle archive restent **non confirmés**. Les instructions exactes figurent dans le relevé 0.52 ; attendre `SAUVEGARDE_052_OK` pour les marquer acquis. Le premier passage quotidien est encore futur au moment de cette reprise. Ne pas confondre la capture du démarrage avec un déclenchement calendaire.

La reprise ajoute le [contrôle de fraîcheur 0.53](backup-freshness-053.md) en lecture seule. Source opérateur éprouvée : `5c64a9d6c72552555b0b57980779391a860b262e`, arbre `ff0d0b3977f04c44b15ee8f53575b10711cd9a9d`, checkout séparé `/srv/customer/jessiemessage-operator/reprise-freshness-5c64a9d6`. À 00:55:23.605 UTC, 11/11 tests natifs passent et la lecture réelle est `current / OK`, puis HTTPS `healthy`. La [CI exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39084535494) passe ses cinq jobs, dont MariaDB 383/383 par version et Chrome 101/101. Cet outil n’est pas encore raccordé à une tâche périodique ou à un canal d’alerte. La copie indépendante automatique, ses reçus et les alertes réellement reçues restent ouverts. La consolidation 0.54 doit ensuite fournir une source stable complète et un repli reproductible. Les brouillons de confidentialité/conservation et l'effacement complet restent également ouverts ; ne pas les annoncer comme finalisés.

## Poursuite du 18 octobre en journée

Le [premier passage quotidien](activation-proofs/jm052-first-scheduled-20261018.json) est maintenant observé : 05:15:33.262 → 05:15:39.807 UTC, capture/chiffrement/reprise réussis, empreintes relues à 12:23 UTC. Les trois passages planifiés de la sonde externe sont réussis mais espacés de plusieurs heures. La [surveillance locale minute 0.53](periodic-backup-monitor-053.md) est préparée sur `feat/periodic-backup-monitor` ; son activation et sa CI restent à observer. Les sections ci-dessus conservent le point d'arrêt précédent et ses limites ; le déchiffrement PC et la copie indépendante restent non confirmés.
