# JessieMessage — reste à faire avant un usage privé régulier

Bilan 0.51 du 18 octobre 2026, autour de Jessie. L’application est déjà hébergée et fonctionnelle. La révision active reste `0a1cafd85c3d8699be1961075b18e80e36bcd041` (0.50), profil `messaging-photos-notify-recovery-crm-broadcast`, schéma 30. Le [relevé d’activation](broadcast-activation-050.md) établit 69/69 contrôles HTTPS et seize empreintes exactes, après les cinq jobs CI de cette source. Ce bilan remplace les anciennes listes en présent ; leurs relevés restent des preuves historiques.

**Étape 0.52 — récurrence activée :** le [superviseur de sauvegarde et le chiffrement complet](recurring-private-checkpoints-052.md) sont actifs via le Manager. Première capture réelle réussie le 18 octobre à **02:28:16 Europe/Paris**, reprise confirmée, opération de 5,842 s ; empreintes et HTTPS vérifiés à 02:29:40. Horaire quotidien : 05:15 UTC. Seule la clé publique du propriétaire est installée ; le déchiffrement de cette archive sur le PC et sa copie indépendante restent à confirmer. Le runtime applicatif reste 0.50 `0a1cafd8` et les acceptations 0.46 sont conservées.

## Acquis conservés

| Élément | Preuve et portée |
| --- | --- |
| Accès sur invitation, messages, photos | Parcours réels déjà acceptés ; échanges privés par compte invité |
| Notifications et récupération du mot de passe | Réception/ouverture acceptées globalement ; récupération acceptée le 17 octobre à 18:52:47. Pas de répétition générale |
| Compte administrateur partagé | Sessions indépendantes par appareil, 180 jours renouvelables, sans coupure d’inactivité ; gestion des conflits des fiches couverte en CI |
| Fiches, étiquettes, groupes, notes, rappels | Activés en 0.47 ; parcours personnel essayé accepté à 00:31:47 |
| Diffusions livrées individuellement | 0.50 actif : aucun réglage d’accord aux diffusions côté invité, message ordinaire sans métadonnées d’audience. Aperçu et confirmation administrateur conservés ; limite actuelle de 100 destinataires par campagne |
| Coffre des configurations | Copie et déchiffrement personnels confirmés à 22:48:05 (`COFFRE_DECHIFFRE_OK`) |
| Checkpoint et restauration de référence 0.46 | Copie PC/empreinte confirmées à 23:21:20 (`COPIE_CRM30_OK`), puis import natif isolé réellement vérifié à 00:13:21 : trente tables applicatives, photos et données recovery/CRM. Voir le [relevé 0.46](crm-checkpoint-046.md). Ce travail reste acquis |

## Travaux d’exploitation à terminer

| Lot / priorité | Reste précis | Plan d’implémentation | Critère de clôture |
| --- | --- | --- | --- |
| **0.51 / P0 — surveillance externe** | **Livré** : contrôle indépendant et planification configurée ; premier événement planifié pas encore observé | Sonde anonyme bornée de `/api/health` et `/api/ready`, trois passages en cas d’échec ; workflow GitHub autonome sur `main`. [Détail et preuves](external-monitoring-051.md) | 24/24 tests distants, workflow sur `main`, passage réel sain depuis GitHub à 01:40:45.234 (run 39079931320). La réception d’une alerte et le suivi de la régularité restent dans le lot 0.53 |
| **0.52 / P0 — sauvegarde récurrente cohérente** | **Activée**, première capture réelle du parent réussie à 02:28:16, reprise confirmée ; premier déclenchement calendaire encore à observer | Parent activé après préflight réel ; journal durable, trente tables et photos vérifiées. Prochaine cible : 05:15 UTC chaque jour. Arrêt gracieux confirmé, doubles dumps/manifestes, copie des photos, chiffrement et reprise même après erreur. Journal durable et verrou exclusif. Ne jamais simplement planifier `--offline` alors que l’application tourne | Une première capture planifiée compatible avec les données courantes, reçu valide, absence de chevauchement, service sain après reprise ; échec de capture simulé sans données réelles |
| **0.52 / P0 — archive intégralement chiffrée** | **Première archive complète chiffrée vérifiée**, AES-256/MDC, 402 802 octets ; déchiffrement réel et copie PC encore attendus | Export public épinglé installé après preuve de récupération synthétique sur le PC ; taille et SHA-256 du chiffré relus. Faire copier/déchiffrer cette archive sur le PC avec les empreintes attendues. La partie privée reste hors hébergement. Conserver les configurations et clés applicatives existantes ; ne pas réutiliser une clé de données pour cette enveloppe | Archive complète chiffrée avant sortie du serveur, empreinte du fichier transféré, reprise vérifiée. Le coffre de configuration accepté n’est pas refait |
| **0.53 / P0 — copie indépendante automatique** | La copie PC 0.46 est acquise ; aucune destination ni copie récurrente automatique n’est encore prouvée | Raccorder une destination indépendante effectivement disponible, transférer seulement l’archive chiffrée, contrôler taille/empreinte et écrire un reçu de copie. Garder plusieurs copies vérifiées ; aucune purge automatique par défaut | Un transfert réel confirmé hors de l’hébergement et une nouvelle copie courante restituable avec le profil courant. Aucun transfert de données privées vers un nouveau service non identifié |
| **0.53 / P0 — fraîcheur et alerte reçue** | Dernier succès de capture/copie et âge des sauvegardes non surveillés ; aucun canal d’alerte avec réception prouvée | Enregistrer séparément capture, chiffrement et copie ; objectifs proposés : capture quotidienne, copie à chaque capture, signal après 26 heures sans succès. Alerter sur panne persistante, échec/retard de sauvegarde, et retour à la normale ; conserver des champs fixes sans contenu privé | Un échec synthétique atteint réellement le canal retenu, puis un rétablissement est reçu ; retard de sauvegarde détecté. Contrôler aussi l’absence d’exécution du moniteur |
| **0.54 / clôture — version stable et reprise** | Les fonctionnalités sont dans une pile de PR ; `main` ne représente pas encore l’application active complète | Consolider la source éprouvée et ses contrôles dans une version stable identifiable, garder les SHA/lanceurs de repli, appliquer le profil de sauvegarde courant et répéter seulement les vérifications nécessaires aux nouveaux éléments | Source de référence reproductible, CI de cette source, procédure de déploiement/repli et reçus à jour. Pas de restauration SQL en production pour un simple repli de code |

Pour les nouvelles captures applicatives après apparition de campagnes, utiliser `photos-notify-recovery-crm-broadcast-application`, **manifeste 10 / reçu 8**, six clés et trente tables applicatives. Le checkpoint CRM 0.46 garde sa valeur historique ; il ne prouve pas une restauration native de nouvelles campagnes peuplées. Les objets SQL exécutables restent exclus/non prouvés : `completeDatabase: false`. Les essais de données de campagne sont déjà couverts en CI ; la prochaine capture courante doit être cohérente et restaurable avec le nouveau profil.

La capture quotidienne à 05:15 UTC est activée en 0.52 ; son premier déclenchement calendaire reste à observer. Le seuil d’alerte de 26 heures et la copie indépendante automatique sont encore des objectifs d’implémentation, sans durée de conservation décidée. Une destination indépendante et un canal de réception devront être identifiés à partir des moyens effectivement disponibles ; les secrets ne doivent pas être saisis dans la discussion.

## Observations personnelles ciblées

Ces vérifications complètent l’acceptation du foyer ; elles n’annulent pas les parcours acquis et ne demandent pas une certification exhaustive de tous les téléphones.

| Observation | Action précise | Statut |
| --- | --- | --- |
| Première diffusion réelle de 0.50 | Depuis l’administration, préparer un court message pour un compte invité de test identifié, vérifier l’aperçu puis confirmer ; constater un message ordinaire reçu, sans mention de groupe, et aucune duplication | Pas encore accepté personnellement ; aucun envoi réel effectué par l’agent |
| Usage de l’administration à deux | Utiliser le compte existant sur vos deux appareils habituels simultanément ; observer la conservation des sessions et une modification de fiche. En cas de conflit, choisir explicitement la version | Implémentation et CI acquises ; observation personnelle simultanée non consignée |
| Diagnostic privé | Dans la session administrateur habituelle, ouvrir « État du service » et enregistrer le diagnostic | CI acquise ; téléchargement réel non consigné. Peut accompagner l’usage privé |

## Ordre de livraison

1. **0.51 livré** : sonde et planification configurées, premier passage externe réel vérifié, sans redémarrer le service.
2. **0.52 activé** : première capture cohérente réelle chiffrée et reprise vérifiées ; terminer la copie/déchiffrement PC et observer le premier passage à l’horaire quotidien.
3. Livrer 0.53 : copie indépendante, fraîcheur et réception réelle d’alertes panne/rétablissement ; vérifier une restitution courante.
4. Clore 0.54 : source stable, procédures et observations ciblées restantes. L’usage peut être élargi progressivement lorsque les P0 d’exploitation sont acquis.
