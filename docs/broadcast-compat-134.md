# Compatibilité des grandes diffusions — correctif 1.3.4

**21 octobre 2026 — code de compatibilité et contrôles locaux rapportés ; qualification native, CI finale et publication encore attendues.** La production reste **1.3.3 close**, source `ca0d40648036d57fdee55b91d47d5d5a874a626e`, Node **v24.22.0**, schéma **31**, avec 1.3.1 comme repli actuel. [État courant](REPRISE.md), [preuves 1.3.4](verification-proofs/jm134-verification.json).

## Résultat attendu

Ce correctif prépare le repli de l’[Évolution 3 — Diffusions à grande échelle, cible 1.4.0](broadcast-scale-140.md). Le format historique stocke la liste complète des conversations dans le texte chiffré de chaque campagne ; sa borne actuelle ne permet pas de supprimer simplement le plafond de cent. Le nouveau format compact doit conserver l’ensemble confirmé dans les destinataires persistés, avec une empreinte globale et une preuve authentifiée pour chaque destinataire.

La 1.3.4 doit lire, traiter et consulter les campagnes historiques et compactes, fournir le suivi paginé et préserver la suppression ciblée ainsi que la vérification des données. Elle doit conserver les baux, les identifiants stables, les contrôles d’accès et la transaction d’écriture du message, de l’événement et de son état de livraison. L’intégration du format aux fonctions de suppression et de vérification est limitée à cette compatibilité ; elle ne rouvre ni chantier PC, ni audit général des sauvegardes.

## Création élargie désactivée

`largeAudiencesEnabled` reste **false par défaut** dans le code et l’interface du runtime normal de 1.3.4. La création manuelle historique reste limitée à cent ; les nouveaux modes globaux ou filtrés ne doivent pas être proposés comme actifs. Les qualifications synthétiques pourront activer explicitement la capacité pour exercer le code destiné à 1.4.0, sans présenter ce test comme une activation de la fonction dans 1.3.4.

La 1.4.0 activera la capacité sur un snapshot ultérieur, après gel et qualification de la compatibilité. Les deux livraisons auront leurs sources, CI, tags immuables et preuves propres. Une préparation hébergée ultérieure pourra préparer les deux références sans activation intermédiaire de 1.3.4 ; ses pins et commandes restent à établir. La 1.3.3 sera préservée, mais ne doit pas être annoncée comme repli capable de lire les campagnes compactes.

## Critères de qualification

- Lecture et traitement inchangés des campagnes historiques, y compris leurs protections de destinataire et d’accès.
- Lecture et traitement de campagnes compactes avec une preuve de destinataire vérifiée avant quota ou écriture.
- Résumés et pages de destinataires bornés, cohérents avec les compteurs globaux et isolés par propriétaire.
- Suppression ciblée et vérification du nouveau format sans charger toute l’audience ; contrôles C1–C5 et états existants préservés.
- Création élargie inaccessible dans le runtime normal de 1.3.4, y compris depuis une requête directe.
- Qualifications synthétiques, CI du commit exact et publication vérifiées avant de qualifier ce repli sur l’hébergement.

## Contrôles locaux rapportés

**Qualification locale observée sous Node 24.19.0 :** groupes ciblés crypto/compatibilité **112/112** (4 556,024 ms), backend **75/75** (777,698957 ms) et frontend final **59/59** (308,96 ms), sans échec ni omission dans chacun de ces groupes. Deux revues statiques indépendantes, crypto puis API/UI, ne relèvent aucun blocage. Le build final réussit : syntaxe de **587 sources JavaScript/shell** et aperçu hors ligne créé.

**Limite locale conservée :** `npm test` termine avec un code 1 sans bilan complet. La tentative bornée `node --test --test-reporter=tap --test-concurrency=2 tests/*.test.mjs` termine également avec un code 1 et un bilan incomplet ; trois échecs observés concernent `conversation-export`, `ENOENT` lors de `mkdtemp` sous `/tmp/jm-conversation-zip-*`, alors que `/tmp` est absent du sandbox. Aucun total global de réussite n’est déduit de ces sorties et aucun garde applicatif n’est modifié pour les convertir en succès. La CI du commit exact reste requise.

Les nouveaux scénarios natifs sont écrits et leur syntaxe est valide, mais ne sont pas encore exécutés : fixture SQL de **2 500 clients**, plans `EXPLAIN` de trois requêtes et mesures de création/traitement prévues ; nouvelle page Chrome, **quatre tests couvrant sept contextes**. Les résultats natifs, plans et durées réelles restent à observer.

Le lecteur JSON partagé accepte désormais une borne configurable allant jusqu’à 1 MiB, nécessaire à une sélection manuelle de 2 500 identifiants. La borne par défaut reste 4 096 octets ; les routes historiques conservent leurs limites, dont 32 KiB pour l’annulation. Le budget 1 MiB concerne la prévisualisation et la création élargies lorsque leur capacité est activée. Cette évolution de transport est distincte des échecs locaux liés à `/tmp` ; aucun garde n’a été retiré pour contourner ces derniers.

Aucun changement de schéma SQL ou de dépendance n’est prévu ; le service Node et la base existants restent utilisés. Les essais de charge ne viseront pas la production ni l’alias recette, qui partage son runtime et sa base. Les résultats de 1.3.3 restent historiques et ne qualifient pas ce correctif. Aucun test de téléphone physique ni débit réel de l’hébergement n’est attesté par les contrôles locaux.

