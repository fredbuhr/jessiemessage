# Préparation opérateur de l’origine — 0.69

Étape 4/6. Ce lot raccorde le contrat 0.68 au superviseur réel. Il ne raccorde ni l’initialisation du témoin sur le PC, ni les fermetures de comptes. Le service quotidien conserve son runtime 0.65 tant qu’une activation distincte n’est pas relevée dans `REPRISE.md`.

## Procédure initiale explicite

Le lanceur `scripts/start-recurring-private-messaging.mjs` accepte trois commandes supplémentaires : `plan-witness`, `check-witness` et `prepare-witness`. Leurs arguments de base sont les mêmes que pour `start` : dossiers privés et d’opérations, checkout applicatif, commit/arbre exacts et port. Elles exigent en plus `--witness-operator-directory`, un dossier privé 0700 préexistant, extérieur au code, aux médias, aux configurations et aux opérations restaurables. Son sous-dossier `contract`, également 0700, doit exister et être vide.

`plan-witness` exige `--witness-destination` avec l’identifiant exact du PC déjà raccordé. Il ne crée aucun appariement, clé ou jeton. Il lit les six configurations privées existantes, vérifie réellement le schéma de capacité SQL initialisé, ses limites et l’empreinte physique des médias. Il prend le verrou commun aux captures, authentifie l’inventaire opérationnel complet et refuse toute intention, tout reçu d’effacement ou toute quarantaine de restauration. Il fixe la base/racine, le dossier opérationnel physique, la configuration, le commit/arbre applicatif et la capacité exacte du PC. Le plan canonique est authentifié avec une sous-clé propre dérivée de la clé CRM existante. Aucun secret brut ou contenu client n’est affiché.

L’opérateur doit établir la provenance originale **avant** cette commande. Le plan porte expressément `initial_only_operator_provenance_required` et son résultat `operatorProvenanceRequired:true`. Le code ne peut pas inférer l’histoire d’un dossier courant vide. Pour le service actuel, il faut relier l’audit de reprise, le runtime 0.65 épinglé sans propriétaire d’effacement et l’historique sans fermeture réelle activée. Cette procédure initiale ne constitue jamais une réparation après perte, remplacement ou restauration de registre.

Le fichier `witness-origin-plan.json`, 0600, est créé exclusivement et expire après une heure. Son SHA-256 est retourné pour être épinglé séparément. Un fichier préexistant n’est jamais remplacé. Une publication interrompue reste bloquante ; ne pas supprimer un plan ou un contrat pour contourner un résultat incertain.

`check-witness` exige `--witness-plan-sha256` et vérifie à nouveau plan, authentification, heure, configuration, SQL, racines physiques, registre original, capacité du PC et checkout propre. Une simple actualisation de reçu de copie est admise ; pause, révocation ou changement de capacité bloquent. Plan absent ou périmé, liens, permissions incorrectes, altération, fichier supplémentaire dans `contract` ou empreinte différente bloquent avant tout démarrage. **Plan et contrôle n’ouvrent aucun listener et ne construisent ni superviseur, ni capture, ni moniteur, ni travailleur de mails.**

## Maintenance gérée

`prepare-witness` exige le même SHA-256. Il contrôle le plan avant le premier listener, démarre le processus applicatif épinglé puis le draine réellement sous le verrou commun aux captures. Seule une sortie zéro, sans signal, permet la publication exclusive du contrat 0.68. Le registre, les configurations, les racines, le bail et le PC sont revérifiés durant l’arrêt ; le contrat publié est ensuite relu avec son empreinte et authentifié. Le processus est redémarré et sa readiness contrôlée **avant la libération du même verrou**.

Le résultat `witness_origin_prepared` fournit le SHA-256 du contrat et `runtimeResumed:true`, avec `externalWitnessConfirmed:false` et `closuresEnabled:false`. Une terminaison forcée, un changement de source/capacité/configuration, une annulation, une publication incertaine ou un échec de nettoyage ne certifie pas l’opération et garde ou remet le processus à l’arrêt. Aucun retry de genèse n’est déclenché par le minuteur. Les commandes normales `start` et `check` n’invoquent jamais cette procédure.

**Préparation à usage unique :** ne pas conserver `prepare-witness` comme Run permanent du Manager. Une fois le contrat préparé et son résultat vérifié, installer le lanceur normal `start`, vérifier les paramètres enregistrés puis le démarrage normal. Un second `prepare-witness` refuse le contrat existant avant le premier listener. Le contrat et son empreinte sont conservés hors des opérations restaurables ; aucun effacement de fichiers de confiance ne sert de repli.

Cette maintenance ne fournit aucun `closureOperations` ou `witnessControl`. Le runtime applicatif peut rester 0.65 ; le parent opérateur doit alors être épinglé séparément à la source 0.69 validée. Le PC n’a pas à être réapparié et sa configuration DPAPI n’est pas modifiée. L’activation éventuelle, les commandes exactes, les empreintes et la preuve de reprise doivent être relevées séparément des tests du code.

## Vérification et suite

Les cas ciblés couvrent les plans canoniques privés, expiration et horloge, altération et liens, dérive de configuration/clé/capacité/racine, verrou concurrent, sortie non nulle/forcée, erreurs après reprise et interdiction de rejouer. Un vrai fils IPC draine une requête HTTP, un producteur, ses transports et son pool avant publication, puis reprend. Les ancrages Linux réels sont obligatoires en CI. L’intégration MariaDB vérifie les véritables capacités/racines et compare l’empreinte de toutes les tables avant/après le contrôle sans mutation.

Restent l’initialisation explicite authentifiée du PC existant, un aller-retour indépendant réel, la barrière fraîche de démarrage/récupération et la politique quand le PC est éteint. La réconciliation source/cible, l’inspection SQL qualifiée et l’import natif isolé courant restent requis avant fermeture réelle. Le déchiffrement personnel courant reste distinct ; l’appariement et les preuves historiques déjà acquis ne sont pas à recommencer.
