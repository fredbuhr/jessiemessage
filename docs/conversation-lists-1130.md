# Conversations et listes — évolution 1.13.0

**Implémentation locale terminée, qualification commune en cours ; non publiée et non déployée.** L'application active rapportée reste1.12.0 ; [REPRISE](REPRISE.md) donne son identité et les limites de reçu. Le développement demandé le31octobre part de5d51a4c, sur `feat/conversation-lists-1130`.

## Résultat demandé

- Conversations : aperçu du dernier message visible dans les deux sens, « Vous : » pour l'administrateur, heure de ce message, ordre récent global, badge entrant non lu indépendant. Une conversation sans message visible possède un état vide ; sa création sert de date de repli.
- Ouverture ordinaire : dernière portion du fil, y compris après une précédente ouverture ciblée. Notifications et retour au message d'origine gardent leur cible exacte.
- Historique : chargement progressif quand l'utilisateur remonte, ancre de lecture conservée, retour vers les portions récentes, repli accessible après erreur. Les requêtes et la fenêtre de rendu restent bornées, avec conservation des brouillons, sélections et envois incertains. Aucune résurrection de contenu supprimé lors d'une réponse tardive.
- Administration : invitations/comptes compacts, filtre d'état des invitations appliqué à toute la collection et navigation précédent/suivant. Conserver le formulaire et le code de création pendant les changements de page.
- Autres listes : page/fenêtre bornée de tâches, contacts et archives de diffusions, revalidation de la page active, sélection conservée ; chargement de photos de diffusion sans accumulation indéfinie d'options.
- Coût backend : lectures groupées vérifiables pour les vidéos ; réduction des lectures inbox seulement si l'ordre des verrous et les preuves restent explicites. Drain Push borné d'un lot plein, repos/backoff et arrêt préservés.
- Entretien : textes d'accès et références documentaires courantes cohérents ; anciens rapports et contrats de récupération conservés. Aucune nouvelle dépendance, infrastructure ou migration prévue par défaut.

## Invariants à qualifier

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

Les preuves de ce candidat, ses éventuelles limites et la prochaine action seront consignées après les contrôles. Toute opération hébergée dépendant du checkpoint1120 doit d'abord retrouver son reçu ou inspecter son état en lecture seule ; aucun ancien writer ne sera rejoué pour découvrir son résultat.

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

Les groupes ciblés se recoupent et ne sont pas additionnés : backendinbox76/76, frontend264/264, accès102/102, UI/modèles/catalogues accès-tâches85/85, CRM/diffusions137/137, vidéo/Push68/68, sans omission dans ces exécutions. Les journaux de la suite générale et de syntaxe commune seront consignés après leur fin.

Nouveaux scénarios natifs ajoutés : messages récents dans le viewport après ouverture, défilement bidirectionnel et miniatures différées, invitations filtrées à320/1280FR/EN, revalidation de tâches sur une page ultérieure, navigationCRM avec notes non sauvegardées, nouveaux contrats SQL inbox/avatars/statuts. Ils ne sont pas déclarés réussis avant lecture de leur résultat CI. L'environnement local n'a ni Chrome/ChromeDriver ni MariaDB ; aucune omission artificielle n'est ajoutée pour masquer ces prérequis.

La syntaxe commune est vérifiée sur784sources, et l’atelier hors ligne est construit. La suite générale locale n’a pas fourni de bilan agrégé complet ; elle n’est pas comptée comme réussie. Le premier lancement a aussi identifié `/tmp` absent : les deux fichiers d’export concernés passent30/30 après configuration d’un TMPDIR privé, sans changement des sources ou gardes. La qualification complète relève de la CI native du candidat. [État des contrôles de développement](verification-proofs/jm1130/development-checks.json).
