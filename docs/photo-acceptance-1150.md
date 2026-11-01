# Acceptation des photos — développement1.15.0

Nouvelle demande du1novembre après livraison1141 close : un client rapporte toujours un échec photo. Aucun fichier original, message exact ou appareil n’a encore été fourni ; aucune cause individuelle certaine. Production1141c803c2c9/checkpoint93d6ddf7 préservés. Le présent lot élargit le parcours de conversion, donc version mineure compatible1.15.0, pas une nouvelle activation immédiate.

## Refus établis sur sondes synthétiques nouvelles

- Le préparateur refuse avant tout décodeur les GIF, BMP, TIFF, APNG et certains AVIF. Sharp/FFmpeg savent réellement décoder ces fixtures.
- Un JPEG32×24 avec deux APP1Exif identiques et un panorama JPEG32769×1 sont rejetés, bien que décodables ; ce ne sont pas des images trop lourdes.
- Le backend ne reçoit que trois formats, avec16MP/côté8192 : JPEG24/48MP valides et9000×1 refusés, bien que Sharp sache les réduire.
- Sharp installé lit les métadonnées HEIC mais ne décode pas HEVC. Il embarque libheif1.23.5 ; les nouveaux décodeurs serveur ne doivent pas exposer de codec vulnérable faute de qualification.
- Le cap sauvegarde1GiB et100000enregistrements historiques, appliqué à l’admission médias vivante, bloque tous formats malgré capacité globale configurée10GiB. Aucun épuisement réel de l’hôte n’est établi.
- Une erreur d’aperçu peut rester masquée par le texte de préparation ; une reprise après ACK upload perdu peut réencoder un Blob déjà préparé et se bloquer avant le réseau.

Les sondes et logs se trouvent temporairement dans implementation-notes/photo-acceptance hors dépôt, puis seront qualifiés et conservés avec le candidat. Aucun fichier client ni compte réel consulté.

## Lot en cours

1. Tentative native en premier : métadonnées indicatives, pas de liste arbitraire de formats/pixels bloquant le décodeur. Réduction avant transfert, première image des formats animés, sortie bornée et ressources libérées.
2. Secours authentifié/CSRF POST media/prepare sans asset ni original conservé : JPEG normalisé pour aperçu puis POST assets ordinaire. Conversion isolée et bornée, aucune répétition automatique d’un envoi stockant au résultat incertain. Budget de secours proposé32MiB/64MP, distinct des capacités natives du téléphone et de la limite10MiB du fichier préparé ; sécurité mémoire réelle à qualifier.
3. Décodeurs serveur couvrant familles non natives au téléphone : choix des distributions en cours. HEIC/AVIF/BMP/RAW/JXL ne sont pas promis tant que leur build, variantes et gardes ne sont pas qualifiés. Aucune conversion tierce externe.
4. Réutiliser exactement le Blob préparé en reprise ; afficher les erreurs locales et HTTP de manière distincte. Pas de télémétrie ou diagnostic de comptes.
5. Découpler l’admission photos des caps d’archive et du quota par client historique, en conservant capacité globale/disque, charges, propriétaires et transactions. Garder un refus explicite de sauvegarde trop grande avant arrêt, sans élargissement du chantier sauvegarde.
6. Intégration chat, profil, diffusion et bibliothèque, tests utiles et qualification native PR/main, puis une seule livraison sur le SHA qualifié avec ses propres preuves/opérateurs.

Il n’est pas possible de garantir un fichier endommagé, chiffré ou un format propriétaire sans décodeur, ni des ressources infinies. Le critère de fin est la couverture explicite des familles et variantes qualifiées, suppression des refus injustifiés et diagnostic utile des limites physiques restantes. Ne pas prétendre avoir réparé le fichier client inconnu.

## Premier checkpoint

Les corrections indépendantes chat sont en cours d’intégration du secours. Leur premier groupe ciblé :179tests/178réussites, puis une attente devenue obsolète après transfert corrigée et seul cas1/1 réussi ; nouveaux scénarios3/3 et5/5, sans omission. Groupes recoupants, ne pas additionner. Ce checkpoint ne vaut ni candidat complet, ni CI native, ni livraison. Backend, préparateur commun, capacité et codecs restent en développement et sont exclus du premier snapshot tant que non gelés.
