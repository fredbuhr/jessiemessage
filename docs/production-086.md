# Clôture V1 — préparation 0.86

**En cours ; 0.86 non livrée.** Le service vérifié et son repli restent ceux de [REPRISE](REPRISE.md). Ce lot termine la présentation et la traçabilité de la V1, sans nouvelle fonction métier ni infrastructure.

## Périmètre borné

- Uniformiser les liens **État du service / Service status** dans les interfaces FR/EN.
- Ajouter `nodeVersion` au reçu de démarrage existant pour relever le binaire réellement utilisé par le Manager. Ce champ constate une version ; il ne met pas Node à jour.
- Préciser la preuve 0.85 : défaut reproduit avant correction en **VM** ; parcours **Chrome natifs réussis après correction**. Aucune reproduction Chrome antérieure n’est revendiquée.

## V1 et réserves

| Élément | État et portée |
| --- | --- |
| Accès privé | Livré : invitations, e-mail vérifié, approbation, MFA administrateur, récupération client et sessions indépendantes. |
| Messagerie | Livrée : texte/photos, historique, galerie, brouillons et envoi confirmé après réponse HTTP perdue. |
| Administration | Livrée : CRM, fiches privées, tags/groupes, conflits, diffusions individuelles et état du service. |
| Notifications et exports | Livrés : notification neutre vers le message concerné, export client/administrateur avec photos partagées ; interfaces FR/EN et guide. |
| A01 — Node fournisseur | Reste ouvert si le binaire fourni demeure 24.15.0. Le reçu documentera la version effective ; choisir la majeure 24 ne prouve pas un correctif appliqué. |
| A07 — PC/Avast | Différé sur instruction utilisateur, non résolu et hors des préalables de cette clôture. Artefact et états existants préservés ; aucune action PC demandée. |
| A08 — archivage | Exécuteur actif différé, sans nouvelle purge ; ne conditionne pas les lots messages. |

La priorité durable reste le cœur de la messagerie. Aucun autre manque fonctionnel confirmé n’est ajouté au périmètre V1 par ce lot. Les réserves ne sont pas transformées en succès.

## Qualification et livraison

| Étape | État |
| --- | --- |
| Vérifications ciblées | En attente des résultats du code retenu. |
| CI candidat et main | En attente ; aucun succès anticipé. |
| Déploiement et contrôles | En attente ; aucune activation 0.86 revendiquée. |
| Repli | Service précédent préservé ; pins et commandes dans REPRISE. |

Les preuves acquises restent dans les [lots 0.84](service-status-084.md) et [0.85](chat-send-ack-085.md). Les tests synthétiques, appareils physiques et observations de production gardent leurs portées distinctes. Aucun nouveau test mail/PC, envoi réel, effacement ou restauration de production n’est requis par cette clôture. Aucun garde, clé, journal, marqueur, autorité ou état D1 n’est retiré ; aucune garantie historique abandonnée n’est réintroduite.
