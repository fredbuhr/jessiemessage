# Diagnostic du raccordement hébergé — 0.69.2

Étape 4/6. Le runtime applicatif reste épinglé en 0.65. Les lots 0.66 à 0.68 ont livré des préalables sans activation ; les tentatives de 0.69 ont rencontré un refus de préparation dans le Manager. La correction d'horodatage du moniteur 0.69.1 est distincte de ce refus.

## Cause hébergée reproduite

Le lanceur effectue un contrôle de commit/arbre puis exige `git status --porcelain` vide avant de lancer Node. Les deux parents opérateur 0.69 et 0.69.1 avaient un `node_modules` lié au répertoire réel du runtime 0.65. Le motif `node_modules/` ignore un dossier, mais pas ce lien symbolique : le statut affichait `?? node_modules` et le shell sortait avant Node. C'est la cause concrète de l'arrêt sans journal observé lors de cette reprise.

La correction source retire le slash final, sans modifier le contrôle de propreté. Sur les deux checkouts hébergés déjà épinglés, l'exclusion locale exacte `/node_modules` a été ajoutée dans `.git/info/exclude` après comparaison de la cible du lien et de toutes les entrées de dépendances des lockfiles avec le runtime 0.65. Les commits, arbres, fichiers suivis et dépendances n'ont pas changé. Le statut est devenu propre. Ce réglage local conserve l'exigence de source propre ; il ne répare aucun registre ou contrat.

Un test Git réel reproduit le montage des dépendances et exécute le vrai `assertRuntimeSource`. Le montage prévu passe ; un autre lien non prévu et une modification de code suivi restent refusés. Les vérifications natives et la CI seules n'avaient pas exercé la création de ce lien sur le checkout opérateur.

## Défaillance supplémentaire du diagnostic

Le contexte configuré remplaçait les erreurs du plan et de la genèse par `WITNESS_ORIGIN_CONTEXT`. L'opérateur remplaçait ensuite toute erreur qui n'était plus une instance de sa classe, puis la maintenance remplaçait encore la cause par `WITNESS_ORIGIN_MAINTENANCE`. L'expiration du plan devenait ainsi impossible à distinguer d'un arrêt ou d'une publication refusés. Le contrôle séparé et la CI ne reproduisaient pas l'assemblage complet du parent courant et de l'enfant 0.65 sur l'hébergement.

Une liste fermée conserve maintenant uniquement des codes techniques reconstruits. Aucun message d'origine, cause, propriété privée, chemin, contenu client ou erreur SQL n'est transmis. Les défauts de chargement/nettoyage des configurations restent neutres. Le parent émet des étapes fixes : précontrôle initial, démarrage initial, précontrôle, verrou, arrêt réel, publication, reprise readiness, nettoyage. Une erreur reste bloquante et aucune nouvelle tentative destructive n'est ajoutée.

## Reprise du 19 octobre

Le Manager était actif avec le parent 0.69.1 et l'enfant 0.65. Le Run enregistré pointait déjà vers le lanceur `prepare-primary-witness-origin-0691-logged.sh`, mais son journal était absent, comme le contrat de genèse : cette dernière tentative n'avait pas été exécutée. Le Run normal 0.69.1 a été rétabli avant la poursuite. Le plan existant et son échéance ont été conservés ; aucun contrat, appariement, clé, archive ou compte n'a été réinitialisé.

Après correction de l'exclusion locale, le précontrôle et la préparation gérée ont abouti avec le parent 0.69.1 déjà installé et l'enfant 0.65. Le journal privé prouve l'arrêt réel puis la reprise ; le résultat `witness_origin_prepared` confirme le contrat `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10`. Sa relecture authentifiée confirme aussi source, configuration et PC existant. Le lancement normal 0.69.1 a été rétabli, relu puis redémarré. Les deux domaines passent 64 contrôles HTTPS, avec 44 empreintes 0.65 exactes. Les quatre archives et la copie PC courante restent conformes, horaire 05:15 UTC inchangé. Voir [les preuves structurées](activation-proofs/jm0692-hosted-repair.json) et `REPRISE.md`.

La publication GitHub a ensuite été explicitement autorisée. Le correctif source 0.69.2 est fusionné par la [PR #87](https://github.com/fredbuhr/jessiemessage/pull/87), merge `307b5e2ba04222ad51117a3fa076f0b384e799d9`, arbre `9b55babac45cff5969a466eb36b059918036f24f`, source `8d7f9da148b5e2f902d76183bb7acdd143857264`. Les cinq jobs de chacun des runs [source 39255757026](https://github.com/fredbuhr/jessiemessage/actions/runs/39255757026), [PR 39255762009](https://github.com/fredbuhr/jessiemessage/actions/runs/39255762009) et [main 39256154963](https://github.com/fredbuhr/jessiemessage/actions/runs/39256154963) sont réussis et vérifiés. Le refus automatique initial est résolu ; il ne bloque plus ce lot.

L'état enfant 0.65 / parent 0.69.1 décrit le relevé historique de cette réparation. Le [lot 0.70](witness-enrollment-070.md) a ensuite été fusionné par PR #88 et vérifié en CI source/PR/main et Windows ; sa préparation hébergée parent/enfant 0.70 a publié la permission puis repris le service derrière la passerelle. Le Run permanent est enregistré, relu et redémarré ; sa reprise normale est vérifiée à **13:36:02.552899 UTC**, avec source/arbre propres, permission `ready` inchangée, 80/80 contrôles HTTPS après reprise et cinq relevés du moniteur sans incident. Le contrat original demeure celui de 813 octets, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10` : ne plus rejouer sa préparation, ni celle de la permission 0.70. L'exécution Windows personnelle et l'aller-retour indépendant restent ouverts. Les fermetures restent désactivées. [Preuves actuelles](activation-proofs/jm070-activation.json).

## Validation

Les tests traversent l'opérateur, le contexte configuré et la maintenance pour vérifier une expiration explicite sans arrêt, une genèse concurrente conservée sans reprise et le refus de causes inconnues. Les tests de phases couvrent un arrêt refusé, une publication incertaine, une reprise en échec et une erreur de nettoyage après reprise. Les invariants de verrou, d'arrêt zéro, de protection des chemins, de publication exclusive et d'absence de fermeture réelle restent inchangés.

La documentation officielle Infomaniak distingue Build et démarrage de l'application et recommande la console d'exécution pour diagnostiquer le lancement. Aucun timeout hébergeur, problème de mémoire ou défaut de propagation de signal n'est établi à ce relevé.

- https://www.infomaniak.com/fr/support/faq/2535/modifier-la-configuration-dun-site-nodejs-infomaniak
- https://www.infomaniak.com/fr/support/faq/2536/resoudre-un-probleme-de-site-nodejs
- https://www.infomaniak.com/fr/support/faq/2276/comprendre-les-limites-des-scripts-ssh
