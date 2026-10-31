# Conversations et listes — évolution 1.13.0

**Développement en cours, non publié et non déployé.** L'application active rapportée reste1.12.0 ; [REPRISE](REPRISE.md) donne son identité et les limites de reçu. Le développement demandé le31octobre part de5d51a4c, sur `feat/conversation-lists-1130`.

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
