# Cycle de vie vidéo 1.8.0 en développement — jalon 7.3

**7.3a est codé sur `feat/video-messaging`, avec qualification CI en attente ; le jalon 7.3 reste incomplet.** La version de développement demeure **1.8.0**, sans tag, release, fusion ou déploiement intermédiaire. Les [preuves du catalogue 7.1](video-catalogue-180.md) et du [message privé 7.2](video-messages-180.md) conservent leurs sources et résultats propres. La production **1.6.0 / schéma 33**, son checkpoint et son repli **1.5.1** restent exclusivement ceux de [REPRISE](REPRISE.md).

## Découpage borné de 7.3

Le diagnostic du code établit trois couplages : l’export photo assemble un JPEG dans un `Buffer` ; le [ZIP de conversation](../server/chat/conversation-export.mjs) assemble l’archive en mémoire avec une limite de 32 Mio ; capture, inventaire et restauration imposent encore le schéma 33, les fichiers photo et leurs bindings de racine/formats authentifiés. Ajouter une vidéo de 100 Mio dans ces contrats sans les adapter serait incohérent. Cette subdivision organise une reprise durable ; elle ne prétend ni expliquer ni résoudre les coupures internes de ChatGPT.

| Sous-étape | Résultat et critère de fin | État |
| --- | --- | --- |
| **7.3a — Export opérateur candidat** | Export privé en flux depuis un snapshot SQL en lecture seule ; déduplication, légendes, tombstones et fichiers vérifiés par taille/SHA-256 ; aucun marqueur complet avant le commit de lecture. Qualification synthétique des interruptions, corruption de bloc et perte d’accusé. | Codé ; CI en attente. |
| **7.3b — ZIP de conversation** | Adapter l’archive au flux sans charger la vidéo entière ni réutiliser implicitement la limite historique de 32 Mio ; droits, annulation et erreurs qualifiés sur un téléchargement synthétique. | À réaliser après 7.3a qualifié. |
| **7.3c — Suppression, fermeture et capacité** | Suppression durable et reprise après interruption, références partagées préservées, absence de fichiers vérifiée avant remboursement de charge ; fermeture synthétique sans toucher le client témoin. | À réaliser. |
| **7.3d — Inventaire, capture et restauration** | Recenser les vidéos et réservations, capturer/restaurer une fixture non vide, comparer données et empreintes, préserver les anciens formats selon leur propre version et qualifier la compatibilité avant promotion des migrations. | À réaliser. |

Ces sous-étapes restent dans la même branche et la même PR de travail. Elles n’ajoutent aucune livraison produit, version ou activation ; 7.3 n’est terminé qu’après les quatre critères. Le [lot 7](PLAN-IMPLEMENTATION.md) conserve une seule livraison complète en 7.6.

## Contrat codé de 7.3a

La composition est explicite et réservée à l’appelant opérateur candidat :

| Point d’intégration | Contrat |
| --- | --- |
| [`withClientData`](../server/data/store.mjs) avec `video: createVideoDataReader()` | Les messages et la bibliothèque vidéo sont lus sur la même connexion et dans le même snapshot SQL `READ ONLY`. L’extension vidéo n’utilise ni écriture ni verrou `FOR UPDATE`. |
| [`createVideoDataReader()`](../server/video/data-store.mjs) | Vidéos enregistrées du client et vidéos livrées par ses messages vivants ; refus des dérives de propriétaire, rôle, conversation ou double lien photo/vidéo. Les tombstones n’exigent pas la lecture d’un asset vivant. |
| [`exportClientContent`](../server/data/export.mjs) avec `videoStorage` | Lecture authentifiée de l’original, par blocs de **256 Kio maximum**, jusqu’à **100 Mio** ; taille totale et SHA-256 comparés aux métadonnées du catalogue. Aucun `Buffer` de la vidéo entière. Les buffers déchiffrés sont effacés après consommation ; les fichiers source chiffrés ne sont pas modifiés. |
| [`createDataWriter`](../server/data/writer.mjs) avec `video: true` | `writer.video(name, source, { bytes, signal })` écrit le flux dans un dossier opérateur privé, distinct des racines source protégées. La finalisation appartient à l’appelant après le succès de `withClientData`, donc après son commit de lecture. |

Un original est copié une seule fois par identifiant vidéo même si plusieurs messages ou la bibliothèque le référencent. Chaque message garde sa propre légende ; le corps et son lien vidéo sont vérifiés avec l’empreinte typée de 7.2. Le fichier exporté est `media/<id>.mp4` et sa référence publique d’export comporte `file`, `type: "video/mp4"` et `bytes`. Un tombstone conserve une ligne sans contenu ni vidéo. Les originaux administrateur non livrés et les données d’un autre client sont exclus.

Ce mode produit **`account.json` version 2** et **`COMPLETE.json` version 2**. Les compteurs `mediaFiles`, `mediaBytes` et `libraryItems` restent les totaux tous médias ; `videoFiles`, `videoBytes` et `videoLibraryItems` détaillent la vidéo. Sans ces options explicites, la forme du mode historique version 1 reste inchangée et un contenu vidéo vivant n’est pas réinterprété comme du texte.

L’export ne publie jamais lui-même `COMPLETE.json`. Une interruption, une erreur d’authentification d’un bloc ou un accusé perdu après le commit SQL laisse un export incomplet ; aucun succès n’est déduit de l’exception ou de fichiers déjà écrits. Les sorties privées partielles restent identifiées comme incomplètes. Le lecteur ne modifie ni messages, ni catalogue, ni capacité, ni fichiers source.

## Qualification attendue et limites

Les contrôles ciblés et la fixture native du changement visent le parcours réel catalogue/stockage/message, deux clients isolés, un original administrateur partagé, plusieurs légendes, la bibliothèque propre et les tombstones. La preuve native doit comparer les empreintes de fichiers en flux et l’état SQL/capacité avant/après, puis éprouver interruption, corruption d’un bloc et perte d’accusé après un véritable commit en lecture seule. **La qualification CI de 7.3a reste à venir ; aucun compte ou succès natif nouveau n’est annoncé ici.** Une omission locale reste distincte d’une réussite native.

7.3a n’ajoute **aucun branchement CLI, runtime ou route**. Les migrations restent candidates : **plan normal 33, plan candidat 36**, sans promotion ni migration hébergée. Le ZIP conversation, la suppression physique, la fermeture, l’inventaire, la capture, la restauration et la compatibilité des anciens formats ne sont pas encore adaptés. Aucun résultat de restauration, débit du mutualisé, pic mémoire mesuré, codec ou téléphone n’est déduit des tests de flux synthétiques.

La prochaine action unique est **qualifier 7.3a sur ses sources exactes**. La sous-étape suivante sera 7.3b après cette qualification. L’interface et l’activation vidéo restent différées jusqu’au cycle complet et à la qualification finale du lot ; aucun chantier PC/Avast n’est rouvert.
