# Compatibilité des grandes diffusions — correctif 1.3.4

**21 octobre 2026 — code revu, fusionné, qualifié par les CI PR/main et publié ; précontrôle hébergé confirmé par le reçu SSH utilisateur, sans démarrage.** La production reste **1.3.3 close**, source `ca0d40648036d57fdee55b91d47d5d5a874a626e`, Node **v24.22.0**, schéma **31**, avec 1.3.1 comme repli actuel. [État courant](REPRISE.md), [preuves 1.3.4](verification-proofs/jm134-verification.json).

## Résultat attendu

Ce correctif prépare le repli de l’[Évolution 3 — Diffusions à grande échelle, cible 1.4.0](broadcast-scale-140.md). Le format historique stocke la liste complète des conversations dans le texte chiffré de chaque campagne ; sa borne actuelle ne permet pas de supprimer simplement le plafond de cent. Le nouveau format compact doit conserver l’ensemble confirmé dans les destinataires persistés, avec une empreinte globale et une preuve authentifiée pour chaque destinataire.

La 1.3.4 doit lire, traiter et consulter les campagnes historiques et compactes, fournir le suivi paginé et préserver la suppression ciblée ainsi que la vérification des données. Elle doit conserver les baux, les identifiants stables, les contrôles d’accès et la transaction d’écriture du message, de l’événement et de son état de livraison. L’intégration du format aux fonctions de suppression et de vérification est limitée à cette compatibilité ; elle ne rouvre ni chantier PC, ni audit général des sauvegardes.

## Création élargie désactivée

`largeAudiencesEnabled` reste **false par défaut** dans le code et l’interface du runtime normal de 1.3.4. La création manuelle historique reste limitée à cent ; les nouveaux modes globaux ou filtrés ne doivent pas être proposés comme actifs. Les qualifications synthétiques pourront activer explicitement la capacité pour exercer le code destiné à 1.4.0, sans présenter ce test comme une activation de la fonction dans 1.3.4.

La [1.4.0 publiée](broadcast-scale-140.md) active cette capacité sur son propre snapshot qualifié. Les deux livraisons ont leurs sources, CI, tags immuables et preuves propres. Le [helper commun](REPRISE.md#préparation-hébergée-acquise) a préparé et précontrôlé les deux références sur Infomaniak ; le reçu SSH confirme `bothPrechecksPassed:true` et `rollback134HostedQualified:true`, sans activation intermédiaire de 1.3.4. La 1.3.3 est préservée, mais ne doit pas être annoncée comme repli capable de lire les campagnes compactes.

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

Les nouveaux scénarios natifs sont écrits et leur syntaxe est valide : fixture SQL de **2 500 clients**, plans `EXPLAIN` de trois requêtes et mesures de création/traitement ; nouvelle page Chrome, **quatre tests couvrant sept contextes**. Ils ne sont pas exécutés localement ; la première exécution CI est consignée ci-dessous, avec ses échecs et ses résultats partiels.

## Première CI de PR — historique en échec

La [PR 117](https://github.com/fredbuhr/jessiemessage/pull/117), premier head `a6ed58cd5543ffa8bb229852d1ff0d0c87b3d603`, arbre `b2cbc016c350fa95d6008346a3243d894520d6cb`, a lancé la [CI 39599710909](https://github.com/fredbuhr/jessiemessage/actions/runs/39599710909) : **deux jobs réussis, trois en échec**. Cette tentative ne qualifie pas la 1.3.4.

| Groupe | Résultat observé | Durée |
| --- | --- | --- |
| Verify | 3 256 tests : 3 218 réussis, 1 échec, 37 ignorés | 100 851,695299 ms |
| Chrome | 178 tests : 176 réussis, 2 échecs, aucune omission | 186 000,594968 ms |
| MariaDB 10.11, job `119220815124` | 486/486 réussis, aucune omission | 205 404,069886 ms |
| MariaDB 11.4, job `119220815126` | 486 tests : 484 réussis, 2 échecs, aucune omission | 326 501,772244 ms |
| HTTPS | 3/3 réussis, aucune omission | 35 011,473467 ms |

Le scénario SQL 2 500 clients réussit ses **cinq sous-cas** sur 10.11 en **22 774,56 ms**, dont **141,3 ms** de capture et **21 513,1 ms** de traitement ; la suppression ciblée v2 réussit aussi. Sur 11.4, les quatre premiers sous-cas réussissent ; après **36 653,8 ms** de traitement, la connexion d’inspection de la fixture, inactive au-delà de son délai de 30 secondes, est fermée ; l’inspection puis son nettoyage échouent sur cette connexion. La capture y mesure **230,8 ms**. Ces durées sont des mesures CI synthétiques à horloge injectée, sans promesse de débit sur le mutualisé.

L’échec Verify vient d’une fixture sans `largeAudiencesEnabled:false` explicite ; sa correction ciblée réussit **5/5** en **221,21 ms**. Les deux échecs Chrome concernent la réponse perdue simulée avant ses en-têtes, que le navigateur pouvait réessayer automatiquement, et une attente qui observait la fermeture de la modale avant la restauration du focus par son événement `close`. Les corrections de fixtures simulent une réponse incomplète après l’enregistrement et les en-têtes, et attendent fermeture et focus dans la même condition. La fixture SQL reconnecte explicitement l’inspection après le traitement, avant les assertions SQL, puis après l’arrêt du pool de travail avant le nettoyage. Aucun SQL ni aucune assertion n’est rejoué ; aucun délai de production n’est modifié. À cette étape, les quatre corrections avaient été relues, leur syntaxe et leur diff vérifiés ; aucun nouveau résultat natif n’était encore rapporté. Les gardes et assertions métier ne sont pas assouplis ; les CI suivantes sont distinguées ci-dessous.

Le [run push initial 39599707734](https://github.com/fredbuhr/jessiemessage/actions/runs/39599707734), au même head, reproduit l’échec de connexion de fixture sur MariaDB 10.11 (**484/486**, 316 204,353146 ms, traitement 34 028 ms) et 11.4 (**484/486**, 332 836,010297 ms, traitement 37 262 ms). Il n’est pas présenté comme une qualification distincte ; les autres compteurs de ce run ne sont pas attestés ici.

## Deuxième CI — autre défaut de fixture conservé

La [deuxième CI PR 39601025146](https://github.com/fredbuhr/jessiemessage/actions/runs/39601025146), source `23e555e2f46f9a5d37de9d2639a81f4a171798d5`, réussit quatre jobs : Verify **3 219/3 256, zéro échec, 37 ignorés**, Chrome **178/178**, MariaDB 10.11 et 11.4 **486/486 chacune**. HTTPS échoue (**un réussi, un échec**) avec `AUTH_REHEARSAL_UNAVAILABLE`, alors que HTTPS du run push au même head réussit **3/3**. Un défaut concret du générateur de clés de la fixture est identifié : certains scalaires minimaux font 31 octets, pour une configuration exigeant 32. L’expérience synthétique observe neuf cas courts sur 2 048 clés ; la clé exacte du run n’ayant pas été relevée, le lien causal avec cet échec reste probable, non rétroactivement prouvé. La fixture réutilise désormais le générateur canonique existant, sans assouplir la configuration. Les contrôles ciblés réussissent **25/25 en 195,33135 ms**, avec les scalaires de 1 et 31 octets déterministes.

## Qualification et publication acquises

La [PR 117](https://github.com/fredbuhr/jessiemessage/pull/117) finale, head `706516a78366e019fc67ac38bdbdc8eb29ac01b2`, est fusionnée sur **`4538148660fbf1487807fb1518747d8f5753cd3b`**, arbre **`248477f9c63064a57445e5b15023e58fdde8e02c`**. La [CI PR 39601982154](https://github.com/fredbuhr/jessiemessage/actions/runs/39601982154) puis la [CI main 39603034994](https://github.com/fredbuhr/jessiemessage/actions/runs/39603034994) réussissent chacune **5/5 à la tentative 1**, cinq logs relus et Node **24.22.0** observé : Verify **3 256 tests, 3 219 réussis, zéro échec, 37 ignorés** ; Chrome **178/178**, HTTPS **3/3**, MariaDB 10.11 et 11.4 **486/486 chacune**, sans omission native. Les cinq sous-cas SQL 2 500 clients, les trois plans `EXPLAIN` attendus, la suppression ciblée v2 et les quatre tests Chrome/sept contextes sont observés. Les compteurs, durées et diagnostics exacts de chaque run sont dans les [preuves](verification-proofs/jm134-verification.json).

Le [tag/release v1.3.4](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.4) est vérifié sur cette source et cet arbre, publié le `2026-10-21T12:59:17Z` par le [run 39604027538](https://github.com/fredbuhr/jessiemessage/actions/runs/39604027538). Le helper commun publié a ses **28/28 tests synthétiques autonomes**, syntaxes et revue sans blocage ; les octets Git sont vérifiés. **Le reçu serveur confirme désormais la préparation et le précontrôle du repli compatible 1.3.4**, schéma 31 inchangé, `pendingClosures:false` et aucun démarrage, changement Manager ou checkpoint. La 1.3.3 reste la dernière production confirmée, avec 1.3.1 comme repli effectif jusqu’à l’activation suivante. La 1.3.4 n’a pas été démarrée ; les empreintes exactes du staging sont dans les preuves.

Le lecteur JSON partagé accepte désormais une borne configurable allant jusqu’à 1 MiB, nécessaire à une sélection manuelle de 2 500 identifiants. La borne par défaut reste 4 096 octets ; les routes historiques conservent leurs limites, dont 32 KiB pour l’annulation. Le budget 1 MiB concerne la prévisualisation et la création élargies lorsque leur capacité est activée. Cette évolution de transport est distincte des échecs locaux liés à `/tmp` ; aucun garde n’a été retiré pour contourner ces derniers.

Aucun changement de schéma SQL ou de dépendance n’est prévu ; le service Node et la base existants restent utilisés. Les essais de charge ne viseront pas la production ni l’alias recette, qui partage son runtime et sa base. Les résultats de 1.3.3 restent historiques et ne qualifient pas ce correctif. Aucun test de téléphone physique ni débit réel de l’hébergement n’est attesté par les contrôles locaux.

