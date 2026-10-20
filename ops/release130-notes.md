# Préparer JessieMessage 1.3.0

Cette préparation conserve la production 1.2.0 et son lanceur comme repli. Le schéma SQL 31 et les dépendances restent identiques. Aucun compte SQL de migration ne doit être demandé.

Le helper prépare uniquement un nouveau checkout et les commandes Run/Build, puis exécute le précontrôle sans démarrer le serveur. La publication GitHub n’est pas une preuve de déploiement.

Après exécution, vérifier `status:staged_precheck_passed`, `version:1.3.0`, `migrationsUnchanged:true`, `started:false`, `migrated:false`, `managerChanged:false`, `checkpointChanged:false` et le repli 1.2.0. Les commandes Manager seront celles du reçu. Une répétition après interruption est refusée ; inspecter les chemins et journaux existants avant de reprendre.

Après activation depuis le Manager, relever la version, le commit au démarrage, Node et l’instant affichés dans l’administration ; consigner ensuite l’état réel dans REPRISE. Ne pas déclarer l’activation ou l’alignement des métadonnées à partir du seul précontrôle.
