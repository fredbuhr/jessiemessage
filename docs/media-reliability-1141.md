# Audit et correction de la chaîne médias —1.14.1

État en développement au1novembre2026. Production1.14.0/code4f3ce5de, checkpoint19ceaa7e préservés ; [REPRISE](REPRISE.md) est la référence. Le signalement client indique un échec photo, avec format seulement supposé. Aucun fichier original, appareil ni message exact n’est disponible : aucune attribution individuelle certaine et aucun compte/client interrogé ou modifié.

## Objectif et critères de fin

Analyser sélection, préparation, transfert, validation, stockage chiffré/SQL, références, lecture et nettoyage pour photos/avatars et vidéos admin. Corriger les défauts reproduits en un seul lot compatible KISS, avec données synthétiques. Garder les fonctions et les bornes de ressources, propriété, sessions, suspensions et quota ; aucune promesse d’accepter un fichier endommagé ou une ressource infinie. Ni sauvegarde/PC reporté ni chantier juridique rouvert.

## Checklist d’audit et disposition en cours

| ID | Périmètre | Résultat ou action |
| --- | --- | --- |
| M01 | Signatures, formats, dimensions et métadonnées | JPEG progressif/CMYK, PNG palette/16bits et WebP synthétiques acceptés par le serveur ; aucune erreur générale de format valide prouvée. |
| M02 | Préparation locale et annulation | Encodage canvas pouvait rester suspendu après abort ; attente bornée et libération corrigées. HEIC sans OffscreenCanvas en développement. |
| M03 | Codec HEIC et CSP | libheif-js1.23.5 local vérifié HEVC uniquement, AV1 absent ; limites natives64MP et CSP worker conservées. Aucun autre codec ajouté ni garde retiré. |
| M04 | Chat, brouillons et lots | Légende figée avant un premier échec, garde draft absent, fermeture sans avertissement et préparations concurrentes reproduits/corrigés ; codes métier des lignes batch conservés. |
| M05 | HTTP, admission et erreurs | Auth/Origine/CSRF, flux/taille/délais et capacités relus ; JPEG précisément tronqué classé415, crashs/timeout restent503. |
| M06 | SQL, références et déduplication photo | Photo de campagne queued/running supprimable corrigée ; clés d’envoi et déduplication existantes préservées, aucune migration. |
| M07 | Stockage chiffré et interruptions | Nettoyage ignorait staging/paires hardlinks exactes après publication interrompue ; garde restreint et preuve d’absence avant ACK. Alias externes toujours refusés. |
| M08 | Quota et récupération nettoyage | Tombstone cleanup_pending invisible à l’admin ; API opt-in dédiée, UI en développement. Quota conservé jusqu’à suppression confirmée. |
| M09 | Galerie, affichage, pages et suppression | Pagination/ACL/URLs relues ; pas de défaut nouveau prouvé hors nettoyage. DTO pending sans URL de contenu. |
| M10 | Avatar/profils | Accept HEIC/AVIF, fallback Image et sélection pendant hidden en correction ; mêmes preuves de propriétaire/session. |
| M11 | Diffusions et vidéos admin | MP4 avec MIME vide/alias, événement picker hidden et instruction de reprise après upload incertain en correction ; aucune vidéo client autorisée. |
| M12 | Distribution, PWA et livraison | SW sans cache fetch, ressources no-store et codec versionné relus ; pas de défaut de cache établi. Qualification complète et publication du nouveau code restent à effectuer. |

## Vérifications ciblées déjà acquises

Les groupes se recoupent et ne s’additionnent pas. À ce jalon : image20/20 (avant extension du secours HEIC), backend99/99, batch15/15 ; chat/upload141réussis sur142 puis seule assertion de test ajustée et cas1/1, stockage33réussis et2omissions explicites faute de procfs local. Deux sous-tests SQL nouveaux sont écrits et non exécutés localement. Les régressions de session chat ont aussi été sondées indépendamment sans double POST ni ancien propriétaire. Aucun de ces résultats n’est une recette téléphone/Safari ni une qualification hébergée.

La contre-revue stockage conserve UID/mode0600/inodes/nlink, clés et variantes exactes, prévalidation avant unlink, fsync et vérification d’absence. Les requêtes d’état cleanup sont uniquement admin sans conversation ; les sélecteurs ordinaires ne reçoivent pas les tombstones. Les changements UI/HEIC ne sont pas encore qualifiés.

## Choix techniques et limites de formats

Le bundle actuel sait HEVC et ne contient pas de décodeur AV1 ; les correctifs AV1/libaom récents ne représentent pas une voie active de ce bundle. Des mises à jour natives libheif existent, mais aucun remplacement officiel libheif-js supérieur à1.23.5 ni résolution démontrée de la divergence iPhone ispe/SPS/clap n’est établi. Changer de distribution ou retirer une vérification de dimensions ne constitue pas une correction sûre. Les formats valides dans leur variante, la mémoire disponible et les API réellement présentes du navigateur restent des facteurs distincts.

Sources primaires consultées : [MDN formats](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types), [libheif-js](https://github.com/catdad-experiments/libheif-js), [libheif1.23.7](https://github.com/strukturag/libheif/releases/tag/v1.23.7), [proposition amont1902](https://github.com/strukturag/libheif/pull/1902). Les sondes utilisent uniquement des fichiers synthétiques ; aucun original client publié ni converti à distance.

## Premier checkpoint de développement

Le cœur chat/batch, serveur média, stockage/SQL et version1141 sont enregistrés ensemble. Le préparateur/worker HEIC et les parcours profil/diffusion/bibliothèque sont encore en cours et exclus de ce premier snapshot ; ce checkpoint ne vaut ni candidat complet ni livraison.

## Reste à qualifier

Terminer UI/HEIC, intégrer et relire, puis CI native PR/main avec cas réels de décodage synthétique, SQL/dirfd et captures. Conserver les échecs et omissions. Publier uniquement le SHA complet qualifié, puis nouvel opérateur correspondant à l’état privé14 réel. Aucun envoi, nettoyage réel, redémarrage ou ancienne commande exécuté par l’agent.
