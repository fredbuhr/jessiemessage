# JessieMessage — reste à faire avant un usage privé régulier

**Mise à jour du 18 octobre — 0.54.0 :** [source complète intégrée dans main et activée](stable-release-054.md), commit `6cfce890`, CI candidate/main et Windows passées, 111 tests natifs et préflight réussis. Après le cycle Manager de 16:09 Europe/Paris : deux contrôles minute sains, 38 lectures HTTPS et seize empreintes conformes, journal de quatre enregistrements conservé. La réception des deux mails d'alerte est confirmée par le propriétaire à 15:54 ; aucun renvoi. La consolidation de source et la procédure de repli sont livrées. Copie indépendante automatique, déchiffrement PC de la nouvelle archive et décisions de données restent ouverts ; les bilans datés ci-dessous sont historiques.

**Reprise du 18 octobre :** [point d’entrée autonome](REPRISE.md) et [audit courant](AUDIT-REPRISE-2026-10-18.md). Le [contrôle de fraîcheur du journal 0.53](backup-freshness-053.md) est implémenté en lecture seule ; il ne constitue ni une copie indépendante ni une alerte reçue. Les preuves 0.50/0.52 et acceptations ci-dessous restent conservées.

Bilan 0.51 du 18 octobre 2026, autour de Jessie. L’application est déjà hébergée et fonctionnelle. La révision active reste `0a1cafd85c3d8699be1961075b18e80e36bcd041` (0.50), profil `messaging-photos-notify-recovery-crm-broadcast`, schéma 30. Le [relevé d’activation](broadcast-activation-050.md) établit 69/69 contrôles HTTPS et seize empreintes exactes, après les cinq jobs CI de cette source. Ce bilan remplace les anciennes listes en présent ; leurs relevés restent des preuves historiques.

**Étape 0.52 — récurrence activée :** le [superviseur de sauvegarde et le chiffrement complet](recurring-private-checkpoints-052.md) sont actifs via le Manager. Première capture réelle réussie le 18 octobre à **02:28:16 Europe/Paris**, reprise confirmée, opération de 5,842 s ; empreintes et HTTPS vérifiés à 02:29:40. Horaire quotidien : 05:15 UTC. Seule la clé publique du propriétaire est installée ; le déchiffrement de cette archive sur le PC et sa copie indépendante restent à confirmer. Le runtime applicatif reste 0.50 `0a1cafd8` et les acceptations 0.46 sont conservées.

## Acquis conservés

| Élément | Preuve et portée |
| --- | --- |
| Accès sur invitation, messages, photos | Parcours réels déjà acceptés ; échanges privés par compte invité |
| Notifications et récupération du mot de passe | Réception/ouverture acceptées globalement ; récupération acceptée le 17 octobre à 18:52:47. Pas de répétition générale |
| Compte administrateur partagé | Sessions indépendantes par appareil, 180 jours renouvelables, sans coupure d’inactivité ; gestion des conflits des fiches couverte en CI |
| Fiches, étiquettes, groupes, notes, rappels | Activés en 0.47 ; parcours personnel essayé accepté à 00:31:47 |
| Diffusions livrées individuellement | Acquis 0.50 conservé en 0.54 : aucun réglage d'accord aux diffusions côté invité ; message ordinaire sans métadonnées d'audience. Aperçu et confirmation administrateur conservés ; limite de 100 destinataires par campagne |
| Coffre des configurations | Copie et déchiffrement personnels confirmés à 22:48:05 (`COFFRE_DECHIFFRE_OK`) |
| Checkpoint et restauration de référence 0.46 | Copie PC/empreinte confirmées à 23:21:20 (`COPIE_CRM30_OK`), puis import natif isolé réellement vérifié à 00:13:21 : trente tables applicatives, photos et données recovery/CRM. Voir le [relevé 0.46](crm-checkpoint-046.md). Ce travail reste acquis |

## Travaux d’exploitation à terminer

| Lot / priorité | Reste précis | Plan d’implémentation | Critère de clôture |
| --- | --- | --- | --- |
| **0.51 / P0 — surveillance externe** | **Livré** : trois événements planifiés réussis observés le 18 octobre, mais espacés de plusieurs heures ; aucune cadence maximale garantie | Sonde anonyme bornée de `/api/health` et `/api/ready`, trois passages en cas d’échec ; workflow GitHub autonome sur `main`. [Détail et preuves](external-monitoring-051.md) | 24/24 tests distants, workflow sur `main`, passage réel sain depuis GitHub à 01:40:45.234 (run 39079931320). La réception d’une alerte et le suivi de la régularité restent dans le lot 0.53 |
| **0.52 / P0 — sauvegarde récurrente cohérente** | **Activée**, première capture du démarrage acquise ; premier déclenchement calendaire observé le 18 octobre à 05:15:33–05:15:39 UTC, succès/reprise et empreintes vérifiés | Parent activé après préflight réel ; journal durable, trente tables et photos vérifiées. Prochaine cible : 05:15 UTC chaque jour. Arrêt gracieux confirmé, doubles dumps/manifestes, copie des photos, chiffrement et reprise même après erreur. Journal durable et verrou exclusif. Ne jamais simplement planifier `--offline` alors que l’application tourne | Une première capture planifiée compatible avec les données courantes, reçu valide, absence de chevauchement, service sain après reprise ; échec de capture simulé sans données réelles |
| **0.52 / P0 — archive intégralement chiffrée** | **Première archive complète chiffrée vérifiée**, AES-256/MDC, 402 802 octets ; déchiffrement réel et copie PC encore attendus | Export public épinglé installé après preuve de récupération synthétique sur le PC ; taille et SHA-256 du chiffré relus. Faire copier/déchiffrer cette archive sur le PC avec les empreintes attendues. La partie privée reste hors hébergement. Conserver les configurations et clés applicatives existantes ; ne pas réutiliser une clé de données pour cette enveloppe | Archive complète chiffrée avant sortie du serveur, empreinte du fichier transféré, reprise vérifiée. Le coffre de configuration accepté n’est pas refait |
| **0.53 / P0 — copie indépendante automatique** | La copie PC 0.46 est acquise ; aucune destination ni copie récurrente automatique n’est encore prouvée | Raccorder une destination indépendante effectivement disponible, transférer seulement l’archive chiffrée, contrôler taille/empreinte et écrire un reçu de copie. Garder plusieurs copies vérifiées ; aucune purge automatique par défaut | Un transfert réel confirmé hors de l’hébergement et une nouvelle copie courante restituable avec le profil courant. Aucun transfert de données privées vers un nouveau service non identifié |
| **0.53 / P0 — fraîcheur et alerte reçue** | **Canal local acquis** : surveillance minute, FIFO persistante et tentatives SMTP espacées ; incident puis rétablissement synthétiques confirmés reçus par le propriétaire le 18 octobre à 15:54 | Conserver la séparation des preuves de capture, copie et réception. Ne pas renvoyer les tests acceptés ; le contrôle ne certifie ni copie externe ni déchiffrement | Réception locale acquise. La panne totale du parent/hébergement exige toujours la sonde externe ; sa cadence effective et la réception des notifications GitHub ne sont pas garanties |
| **0.54 / clôture — version stable et reprise** | **Source et procédure livrées** : application complète dans main, repère release/0.54.0, runtime/superviseur unifiés `6cfce890`, repli précédent conservé et contrôlé | Partir de main puis épingler commit/arbre propres ; utiliser le lanceur vérifié et les anciens Run/Build sauvegardés. Les observations personnelles ci-dessous restent distinctes | CI candidate/main et Windows passées, 111 tests natifs, préflight, Build/redémarrage, 38 contrôles HTTPS et seize empreintes conformes. Aucun repli réel ni restauration SQL provoqué pour le lot |

Pour les nouvelles captures applicatives après apparition de campagnes, utiliser `photos-notify-recovery-crm-broadcast-application`, **manifeste 10 / reçu 8**, six clés et trente tables applicatives. Le checkpoint CRM 0.46 garde sa valeur historique ; il ne prouve pas une restauration native de nouvelles campagnes peuplées. Les objets SQL exécutables restent exclus/non prouvés : `completeDatabase: false`. Les essais de données de campagne sont déjà couverts en CI ; la prochaine capture courante doit être cohérente et restaurable avec le nouveau profil.

La capture quotidienne à 05:15 UTC et son premier passage calendaire sont acquis. Le seuil de 26 heures est contrôlé chaque minute ; la file SMTP et la réception des alertes locales sont confirmées. La copie indépendante automatique et le déchiffrement PC de la nouvelle archive restent ouverts, sans durée de conservation décidée. Identifier une destination indépendante effectivement disponible ; les secrets restent hors discussion.

## Observations personnelles ciblées

Ces vérifications complètent l’acceptation du foyer ; elles n’annulent pas les parcours acquis et ne demandent pas une certification exhaustive de tous les téléphones.

| Observation | Action précise | Statut |
| --- | --- | --- |
| Première diffusion réelle de 0.50 | Depuis l’administration, préparer un court message pour un compte invité de test identifié, vérifier l’aperçu puis confirmer ; constater un message ordinaire reçu, sans mention de groupe, et aucune duplication | Pas encore accepté personnellement ; aucun envoi réel effectué par l’agent |
| Usage de l’administration à deux | Utiliser le compte existant sur vos deux appareils habituels simultanément ; observer la conservation des sessions et une modification de fiche. En cas de conflit, choisir explicitement la version | Implémentation et CI acquises ; observation personnelle simultanée non consignée |
| Diagnostic privé | Dans la session administrateur habituelle, ouvrir « État du service » et enregistrer le diagnostic | CI acquise ; téléchargement réel non consigné. Peut accompagner l’usage privé |

## Ordre de livraison

1. **0.51 livré** : sonde et planification configurées, premier passage externe réel vérifié, sans redémarrer le service.
2. **0.52 activé** : première capture cohérente réelle chiffrée et reprise vérifiées ; premier passage quotidien maintenant vérifié ; terminer la copie/déchiffrement PC.
3. **0.53 : surveillance et réception locales livrées** ; terminer la copie indépendante et la restitution courante. La sonde externe garde ses limites propres.
4. **0.54 : source consolidée et activée**, procédures de déploiement/repli et reçus à jour. Terminer les observations ciblées et les décisions de données restantes ; élargir l'usage lorsque les P0 d'exploitation sont acquis.
