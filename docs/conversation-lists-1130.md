# Conversations et listes — évolution 1.13.0

**Implémentation, revues, qualification PR/main et publication terminées ; préparation/CHECK et activation1.13.0 rapportés.** L’application active rapportée est1.13.0 ; [REPRISE](REPRISE.md) donne son identité et les limites de reçu. Le développement demandé le31octobre part de5d51a4c, sur `feat/conversation-lists-1130`.

## Résultat demandé

- Conversations : aperçu du dernier message visible dans les deux sens, « Vous : » pour l'administrateur, heure de ce message, ordre récent global, badge entrant non lu indépendant. Une conversation sans message visible possède un état vide ; sa création sert de date de repli.
- Ouverture ordinaire : dernière portion du fil, y compris après une précédente ouverture ciblée. Notifications et retour au message d'origine gardent leur cible exacte.
- Historique : chargement progressif quand l'utilisateur remonte, ancre de lecture conservée, retour vers les portions récentes, repli accessible après erreur. Les requêtes et la fenêtre de rendu restent bornées, avec conservation des brouillons, sélections et envois incertains. Aucune résurrection de contenu supprimé lors d'une réponse tardive.
- Administration : invitations/comptes compacts, filtre d'état des invitations appliqué à toute la collection et navigation précédent/suivant. Conserver le formulaire et le code de création pendant les changements de page.
- Autres listes : page/fenêtre bornée de tâches, contacts et archives de diffusions, revalidation de la page active, sélection conservée ; chargement de photos de diffusion sans accumulation indéfinie d'options.
- Coût backend : lectures groupées vérifiables pour les vidéos ; réduction des lectures inbox seulement si l'ordre des verrous et les preuves restent explicites. Drain Push borné d'un lot plein, repos/backoff et arrêt préservés.
- Entretien : textes d'accès et références documentaires courantes cohérents ; anciens rapports et contrats de récupération conservés. Aucune nouvelle dépendance, infrastructure ou migration prévue par défaut.

## Contrats qualifiés et limites

| Contrat | Cas d'acceptation |
| --- | --- |
| Aperçu et tri | Client puis admin, admin seul, vide/tout supprimé, photo/vidéo sans légende, non-lu suivi d'une réponse admin, dates égales et pages stables. |
| Propriété et fraîcheur | Session/MFA après attente de verrou, client de la conversation distinct de l'expéditeur du dernier message, refus d'une réponse d'une ancienne session/sélection. |
| Navigation | Clic normal vers la fin ; cible ancienne retrouvée ; retour normal quitte la fenêtre ciblée ; aucun aperçu ne marque lu. |
| Historique | Défilement ancien/récent, ancre, une requête à la fois, arrêt sur erreur/curseur non progressant, historique vide/supprimé sans boucle automatique, anciennes réponses après suppression et éviction. |
| Brouillons/envoi | Texte/attachement/envoi incertain conservés lors du changement de fenêtre ; aucune nouvelle identité d'envoi automatique. |
| Listes | Jeux synthétiques de milliers de lignes, filtre global, page active revalidée, mémoire/rendu bornés, précédent/suivant, focus, formulaire et sélection préservés. |
| Vidéo et Push | Originaux distincts/réutilisés, contrôles de chaque livraison ; reprise après lot plein sans concurrence ni double envoi, backoff/expiration et arrêt. |
| Présentation | FR/EN mobile/desktop, contrôles clavier et focus ; tests physiques non exécutés explicitement distingués. |

## Qualification et jalons

Les tests ciblés accompagnent chaque changement de contrat. La source stabilisée reçoit la CI requise sur PR puis SHA fusionné. Les résultats existants1.12.0 ne sont pas requalifiés par lecture ; les omissions restent des omissions. Aucune publication ou activation n'est déduite de l'implémentation locale.

Les preuves finales et limites sont consignées ci-dessous. La lecture seule du checkpoint est désormais acquise pour1130 : état1112 exact, section1120 absente. Le nouvel opérateur préservera ce baseline ; aucun ancien writer ne sera rejoué.

## Révision implémentée et bornes

- Aperçus : page50 remplaçable, tri de la dernière date visible dans les deux sens, aperçu vide et badge indépendant ; curseur version2 conservant les six décimales SQL.
- Fil : fenêtre contiguë de300messages, navigation ancienne/récente ; trois pages automatiques maximum par geste/cycle puis reprise accessible. Les réponses de fenêtre périmées sont rejetées avant toute réinitialisation ; les chargements avant/après sont sérialisés. Une suppression observée invalide les anciennes lectures susceptibles de réintroduire du contenu.
- Cache : huit conversations inactives sans travail en cours ; les brouillons, pièces jointes et envois incertains sont épinglés et peuvent porter le nombre total au-delà de huit. Miniatures différées près du viewport après affichage réel ; la pile de curseurs de la liste de conversations conserve les pages visitées. Le nombre de lignes affichées est borné, sans promesse de mémoire totale constante pour tous les états utilisateur.
- Accès : pages25 remplaçables, détails dépliables, statut global en SQL, précédent/suivant haut et bas, création/code conservés. Les curseurs filtrés sont liés au statut demandé.
- Tâches : page50 et revalidation de la page active ; profils/formulaires ouverts conservés. ContactsCRM : page50, état sélectionné ou modifié conservé séparément, pile de curseurs100 avec retour au début.
- Diffusions : activité30 + page d'archive20 + détail1, union dédupliquée d'au plus51campagnes ; compteur live revalidé dans une petite fenêtre. Photos20 + éventuelle sélection hors page, sans accumulation du catalogue entier.
- Vidéo : cent messages portant un ou cent originaux utilisent trois requêtes de décoration (liens, capacité, originaux), avec contrôles individuels et aucun cache interopérations.
- Inbox : les trois verrous par conversation et le suivi de réponse restent explicites ; statistiques et avatars sont lus par groupes de50après vérification des liaisons. Sur la fixture sans décorateurs reply/vidéo, page50 :256→157appels query. Ce compteur n'est ni un benchmark de latence ni un nombre constant global.
- Push : reprise immédiate après lot plein de cinq ; repos2s après vide/partiel/erreur, backoff fournisseur, quotas et arrêt préservés.

Aucun changement de dépendance, de migration ou de table. Les cinq dépendances directes restent identiques. Les anciennes preuves et outils opérateur restent préservés ; le CLI data33/36 est explicitement distingué des exports de conversation actuels.

## Contrôles du développement

Les groupes ciblés se recoupent et ne sont pas additionnés : backendinbox76/76, frontend264/264, accès102/102, UI/modèles/catalogues accès-tâches85/85, CRM/diffusions137/137, vidéo/Push68/68, sans omission dans ces exécutions. Les résultats natifs finaux sont consignés ci-dessous ; ces groupes ciblés ne sont pas un second total général.

Nouveaux scénarios natifs ajoutés : messages récents dans le viewport après ouverture, défilement bidirectionnel et miniatures différées, invitations filtrées à320/1280FR/EN, revalidation de tâches sur une page ultérieure, navigationCRM avec notes non sauvegardées, nouveaux contrats SQL inbox/avatars/statuts. Leurs résultats ont été lus dans les journaux natifs finaux et sont réussis sur PR puis main. L'environnement local n'a ni Chrome/ChromeDriver ni MariaDB ; aucune omission artificielle n'est ajoutée pour masquer ces prérequis.

La syntaxe commune est vérifiée sur784sources, et l’atelier hors ligne est construit. La suite générale locale n’a pas fourni de bilan agrégé complet ; elle n’est pas comptée comme réussie. Le premier lancement a aussi identifié `/tmp` absent : les deux fichiers d’export concernés passent30/30 après configuration d’un TMPDIR privé, sans changement des sources ou gardes. La qualification complète relève de la CI native du candidat. [État des contrôles de développement](verification-proofs/jm1130/development-checks.json).

## Première qualification native — corrections requises

La [PR144](https://github.com/fredbuhr/jessiemessage/pull/144), sourcea884bca7, arbre53ca0def, run41220376333, a terminé avec deux jobs réussis et trois en échec : général4220/4168réussis/52omissions et HTTPS14/14 ; Chrome289/292, trois échecs de navigation ; chaque MariaDB610/613, trois échecs liés à la fixture du profil. Cette exécution ne qualifie pas une livraison. Les corrections conservent les scénarios et les gardes : gestes de défilement distincts des contrôles au clavier/pointeur, navigation Home/End explicite, horloge updated_at de la fixture avatar épinglée. [Journaux empreintés et11captures inspectées](verification-proofs/jm1130/pr-first-native.json). À cette première étape, le cas natif d’historique n’avait pas produit sa capture de succès ; la qualification corrective et sa capture sont acquises ci-dessous.

La révision corrective ajoute aussi les garde-fous des gestes : Tab et actions des boutons gardent le repli accessible ; Home/End ne sont traités que sur la zone d’historique et sans modificateur. CompositionIME, raccourcis navigateur, sélectionShift, zoom et multitouch sont laissés au navigateur. Deux scénariosVM ciblés protègent ces cas. Les trois tests Chrome et les assertionsSQL initiaux restent présents. La qualification native de cette révision est acquise ci-dessous.

## Qualification finale et publication

La source finale de PR144 est `f79dca85df126fdd6677878f4e074a5d8ca6d9cc`. Son test de fusion `8bf953588410dfc835d0ee2a26de123c987b4757` et le commit main **`b9e2ad78b47dccb72b8e793cdc448e6b70424430`** possèdent le même arbre complet **`dc8933723a54c0307a3fd52719bdd4fd3ac3f96a`**. [CI PR41221505431](verification-proofs/jm1130/pr-native.json) et [CI main41222320731](verification-proofs/jm1130/main-native.json), tentative1, terminent chacune à **5/5 jobs réussis** sousNodev24.22.1.

| Suite native | Résultat sur PR et main |
| --- | --- |
| Général | 4222tests,4170réussis,0échec,0annulation,52omissions explicites |
| Chrome | 292/292, sans omission |
| HTTPS | 14/14, sans omission |
| MariaDB10.11 | 613/613, sans omission |
| MariaDB11.4 | 613/613, sans omission |

Les52omissions ne sont pas des réussites. Les cinq suites ne s'additionnent pas en un total de scénarios uniques. Syntaxe784sources et construction de l'atelier hors ligne réussies. Les journaux complets sont référencés par job et SHA256 dans les preuves ; les échecs initiaux restent conservés.

**Douze captures finales effectivement inspectées** : invitations et aperçus FR/EN à320/1280, historique récentFR320, CRMFR320/EN390, tâchesFR390. [Inventaire et empreintes](verification-proofs/jm1130/visual-native.json). Les captures du run main ne sont pas revendiquées comme relues : la revue visuelle porte sur la PR corrective dont l'arbre complet est identique. Téléphone physique, Safari et lecteur d'écran ne sont pas qualifiés par ces captures synthétiques.

[v1.13.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.13.0) est publiée surb9e2ad78, release/latest430071184 ; [publication41223112832](verification-proofs/jm1130/publication-native.json)2/2, tentative1, neuf tests natifs de l'opérateur. Aucun tag ancien déplacé ; le workflow de publication n’effectue aucune installation hébergée. La1.13.0 est depuis démarrée selon le [relevé utilisateur](verification-proofs/jm1130/hosted-identity.json) ; son enregistrement final reste à préparer. [Guide opérateur1130](operations-release1130.md).

## Bilan de couverture et simplicité

Les neuf groupes F01–F09 ont une disposition dans la [checklist de clôture](verification-proofs/jm1130/coverage.json) : dernier échange, navigation, historique, accès, listes métier, lectures backend, schéma/index, entretien et Push. Les corrections sont regroupées en une version mineure compatible ; aucune dépendance, migration, table ou infrastructure ajoutée. Les protections d'accès, suspensions, révocations, expirations, MFA et propriété restent vérifiées côté serveur. Les médias et comptes utilisés pour les tests sont synthétiques.

L'audit du schéma n'a pas justifié de migration :38migrations et37tables attendues, sans nouvel inventaire physique de production. Le petit index redondant des libellés, le tri facultatif des tâches par échéance, le découpage d'imports historiques, le cache des assets publics et une icône non servie ne deviennent pas des corrections urgentes ; pas de suppression à l'aveugle d'outils ou de contrats historiques. Les bornes réelles et états épinglés sont explicités plus haut, sans promesse de mémoire totale constante.

Livraisons réelles SMTP/Push, photo originale problématique, essais téléphones/Safari et sauvegarde manuelle reportée restent non attestés. Aucun envoi réel, effacement, modification client ou navigateur cloud n’a été utilisé pour le développement. La préparation et le CHECK1130 sont ensuite rapportés réussis dans leur [reçu séparé](verification-proofs/jm1130/hosted-preparation.json), sans identité démarrée1130 déduite. La lecture seule acquise pour1130 retrouve le checkpoint1112 exact, sans section1120 ; ce baseline doit être préservé par le nouvel opérateur. Le démarrage1120 reste confirmé séparément.
