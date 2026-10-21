# Interruptions : constats et adaptation du travail, 21 octobre 2026

Demande : rechercher les causes des interruptions avant de poursuivre les lots. Périmètre : historique fourni par les échanges, traces GitHub et journaux disponibles du lot 6, règles de travail et plan restant. Aucune opération sur l’hébergement, le PC ou les sauvegardes. L’état de production reste exclusivement dans [REPRISE](REPRISE.md).

## Ce qui est établi, et ce qui reste inconnu

| Observation | Cause ou portée vérifiable | Traitement |
| --- | --- | --- |
| Discussions interrompues les 18–21 octobre ; réponse finale parfois absente après une opération achevée | Aucune télémétrie interne ChatGPT, navigateur ou réseau n’est disponible pour établir la cause de ces coupures. Les durées signalées d’environ 53 et 73 minutes ne prouvent pas un timeout fixe. | Ne pas attribuer ces coupures au Wi-Fi, à Avast, au modèle ou à un incident de plateforme sans trace. Reprendre depuis les résultats durables. |
| Confirmation de synchronisation précédemment interrompue par une « erreur interne » de contrôle d’approbation | Signalement conservé dans les échanges et REPRISE ; le mécanisme interne et sa cause ne sont pas observables ici. Le fetch suivant et la comparaison ont confirmé l’état GitHub. | Lire l’état avant tout réessai ; ne pas contourner un rejet d’approbation. |
| Deux CI complètes par révision de la branche du lot 6 | Le workflow écoutait à la fois `push` sur `feat/**`/`fix/**` et `pull_request`. Quatre révisions ont chacune produit les deux événements. | Conserver le déclenchement PR et le push de main seulement. |
| Anciennes CI annulées pendant les révisions suivantes | Les groupes de concurrence par ref annulaient les exécutions en cours. La chronologie correspond aux nouveaux pushes ; les métadonnées ne nomment pas la cause individuelle de chaque annulation. | Conserver l’annulation des anciennes révisions PR ; isoler chaque SHA de main et publier un candidat stable avant qualification. |
| Un job général a échoué sur un délai attendu de 30 000 ms | Deux lectures successives de `Date.now()` pouvaient produire 29 999 ms. Le test a été reproduit avec une horloge avançant de 1 ms puis corrigé dans le lot 6, sans changer le runtime. | Correction déjà acquise ; ne pas relancer un ancien échec corrigé pour le « réparer » de nouveau. |
| Sorties d’outils tronquées et correction documentaire interrompue par une assertion | Lectures trop volumineuses ; une précondition documentaire a été vérifiée après des écritures. Les erreurs ont été inspectées et les résultats finaux vérifiés. Cela ne prouve pas une coupure ChatGPT. | Lectures ciblées, journaux en fichiers, préconditions avant écritures et vérification des états partiels. |

Les anciens incidents de lanceur ou de sauvegarde PC ne constituent pas la cause démontrée des interruptions actuelles. Ils ne justifient aucune nouvelle manipulation PC. L’[audit du 19 octobre](AUDIT-INTERRUPTIONS-2026-10-19.md) conserve ses constats historiques ; il ne décrit pas la production actuelle.

## Chronologie CI du lot 6

Sources : métadonnées GitHub, jobs et logs ; tous les runs sont à la tentative 1. Heures UTC du 21 octobre 2026, durée de la création du run à la fin du dernier job, files d’attente incluses.

| Source | Événement et run | Début–fin UTC | Résultat du run |
| --- | --- | --- | --- |
| `6c05ee3a` | push [39656683714](https://github.com/fredbuhr/jessiemessage/actions/runs/39656683714) | 18:52:53–18:55:42 | Annulé |
| `6c05ee3a` | PR [39656691589](https://github.com/fredbuhr/jessiemessage/actions/runs/39656691589) | 18:52:57–18:55:46 | Annulé |
| `3e9502bc` | push [39657013465](https://github.com/fredbuhr/jessiemessage/actions/runs/39657013465) | 18:55:05–19:01:02 | Annulé ; job général en échec sur le test d’horloge |
| `3e9502bc` | PR [39657021469](https://github.com/fredbuhr/jessiemessage/actions/runs/39657021469) | 18:55:08–19:00:59 | Annulé |
| `d3f922ac` | push [39657799983](https://github.com/fredbuhr/jessiemessage/actions/runs/39657799983) | 19:00:24–19:03:50 | Annulé |
| `d3f922ac` | PR [39657809098](https://github.com/fredbuhr/jessiemessage/actions/runs/39657809098) | 19:00:28–19:03:48 | Annulé |
| `aab110c4` | push [39658097504](https://github.com/fredbuhr/jessiemessage/actions/runs/39658097504) | 19:02:21–19:10:11 | Réussi, 5/5 |
| `aab110c4` | PR [39658104644](https://github.com/fredbuhr/jessiemessage/actions/runs/39658104644) | 19:02:24–19:10:20 | Réussi, 5/5 |
| `ba639f7b` | main [39659419602](https://github.com/fredbuhr/jessiemessage/actions/runs/39659419602) | 19:11:21–19:17:50 | Réussi, 5/5 |

Total : **9 runs CI, 45 jobs : 25 réussis, 19 annulés, 1 en échec**. Les quatre runs push de branche représentent **20 jobs doublonnés**, soit environ **60,4 minutes cumulées de jobs sur 141** ; ce n’est ni un temps d’attente utilisateur ni une estimation de facturation. La [publication séparée](https://github.com/fredbuhr/jessiemessage/actions/runs/39660459694) a ensuite réussi à 19:18:39 UTC. L’intervalle entre le premier run et cette fin est de 25 min 46 s. Aucun lien causal avec une coupure de discussion n’en est déduit.

L’échec d’horloge est conservé dans les [preuves du lot 6](verification-proofs/jm170-verification.json), ainsi que les deux qualifications finales propres. Le délai observé de 29 999 ms était valide ; la fixture impose désormais une horloge contrôlée et vérifie toujours la réduction du délai à mesure que le temps avance.

## Changements retenus

1. **CI sans doublon** : push sur main seulement ; PR inchangées ; groupe de concurrence par événement et numéro de PR ou SHA. Une révision PR peut remplacer la précédente ; chaque SHA de main à qualifier conserve sa CI indépendante. Les preuves purement documentaires peuvent garder `[skip ci]`. Les cinq jobs, matrices SQL, commandes et Node 24.22.0 restent identiques.
2. **Jalons durables** : objectif et critère de fin par étape ; commit poussé et état court avant une attente longue. Un repère de 10–20 minutes aide à subdiviser le travail ; ce n’est pas une limite de plateforme ni une obligation de demander confirmation. La réponse finale n’est plus l’unique trace d’avancement.
3. **Qualification après revue** : diff et tests ciblés avant ouverture de PR ; pas de révision pendant une CI sans correction concrète. Une qualification native peut nécessiter une PR plus tôt. Aucune réduction des cinq contrôles finaux.
4. **Reprise précise** : branche, commit/arbre réellement publiés, PR/run, résultats observés, omissions et prochaine action unique. Lire le résultat durable avant de répéter une mutation dont la réponse a été perdue.
5. **Lots subdivisés** : [lot 7 en six étapes et lot 8 en trois](PLAN-IMPLEMENTATION.md). Les étapes sont des jalons de développement, pas neuf mises en production. Le cycle de vie complet et le repli compatible conditionnent la livraison vidéo.
6. **Lectures et écritures bornées** : début courant de REPRISE puis sections utiles ; sorties synthétiques et logs conservés ; préconditions vérifiées avant mutations multiples. Les états partiels sont inspectés après une erreur.

Ces règles sont inscrites dans [AGENTS](../AGENTS.md). Aucun nouveau service de suivi, framework CI ou mécanisme d’approbation n’est ajouté.

Conséquence assumée du filtre : une branche de travail sans PR n’a plus de CI automatique ; ses commits restent des jalons de développement, pas une qualification. Le cas inhabituel où main serait lui-même la tête d’une PR conserve deux événements distincts. Le doublon supprimé est celui des branches fonctionnelles ou correctives ouvertes en PR.

## Validation de cette adaptation

État initial : main `593cb77c3b6945c566eef1bbb9beb8c10f8cec4c`, arbre `c616978604b3b29da9e2673edd2b381bf39dd903`. Le changement concerne le workflow et la documentation ; aucune modification applicative, migration, version ou release n’est nécessaire. Les résultats de qualification et la prochaine action sont enregistrés dans le jalon courant de [REPRISE](REPRISE.md).

Limite : ces adaptations suppriment les doublons CI et réduisent la quantité de travail à reconstruire après une coupure. Elles ne réparent ni ne garantissent la disponibilité de ChatGPT. Le lot 7 n’a pas commencé pendant cet audit.

Références primaires consultées : [événements GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [concurrence GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), [travaux longs avec Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex). Cette dernière recommande une mémoire durable et des jalons vérifiables ; elle ne diagnostique pas les coupures de cette session.
