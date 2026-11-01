# Acceptation des photos — 1.15.0 en qualification

La production reste la **1.14.1**, commit `c803c2c9be16c0c4ee218d8cac4a1272620d2772`, checkpoint `93d6ddf70db3b1b30d006bf2fb30ab7594ebc2d2b8f88cc59a230f247cbaca82`. Aucun outil de cette livraison close ne doit être rejoué. La branche `fix/photo-acceptance` développe un lot compatible **1.15.0** : le secours de conversion et les formats supplémentaires justifient une version mineure.

Un client signale toujours un échec après la 1.14.1. Son fichier original, son erreur précise et son appareil n’ont pas été fournis. Les causes ci-dessous sont reproduites sur données synthétiques ; elles ne prouvent pas la cause individuelle de ce signalement. Aucun compte, message ou média réel n’a été modifié.

## Causes établies et corrections regroupées

| Cause reproduite | Comportement corrigé |
| --- | --- |
| Filtre de format ou de métadonnées avant le décodeur : GIF, BMP, TIFF, APNG, certains AVIF ; JPEG avec APP1 Exif identiques ; panorama 32769 × 1 | Décodage natif du téléphone tenté en premier. Les métadonnées orientent la préparation sans interdire un fichier décodable. |
| Backend limité aux fichiers déjà préparés, à 16 MP et au côté 8192 | Route de conversion distincte pour l’original, sans création d’asset ni stockage. JPEG 24/48 MP et panoramas synthétiques acceptés et réduits. Le contrat des assets préparés reste distinct. |
| HEIC lu en métadonnées mais HEVC non décodable par Sharp installé | Noyau HEIC 1.23.7 commun au worker local et à l’enfant serveur ; version et octets épinglés, rotation réelle qualifiée. |
| Plafond d’archive 1 Gio et nombre historique d’enregistrements appliqués aux nouveaux envois malgré capacité configurée supérieure | Admission vivante fondée sur la capacité globale configurée, le disque, les charges et les transactions. Retrait du quota photo par client ; historique et compteurs conservés. |
| Échec d’aperçu masqué par « Préparation… » ; nouvel encodage lors d’une reprise après accusé perdu | Erreur persistante et utile ; réutilisation du Blob préparé exact lors d’une reprise explicite. Aucun POST stockant incertain n’est répété automatiquement. |
| Déconnexion après fin du corps ne tuant plus le décodeur | Correctif ciblé en cours : annulation liée à la réponse HTTP jusqu’à la sortie réelle de l’enfant. |
| Extensions absentes des sélecteurs du système | Les quatre sélecteurs photo annoncent aussi les extensions des familles prises en charge, dont les dix indices RAW autorisés. |

La conversion est raccordée au chat client/admin, au profil, aux diffusions et à la bibliothèque. Elle reçoit l’original uniquement après authentification, origine/CSRF et admission ; elle revérifie le propriétaire après décodage. Le nom complet du fichier n’est pas transmis : seul un indice RAW dans une énumération fermée peut aider le décodeur.

## Formats et dépendances

Le navigateur essaie ses propres décodeurs avant tout secours serveur. Une animation ou un document photo multipage devient une photo fixe. La sortie commune est un JPEG normalisé, sans métadonnées de l’original, pour les aperçus et le stockage existants.

Le secours serveur couvre JPEG, PNG/APNG, WebP, GIF et TIFF via Sharp ; HEIC/HEIF via le noyau 1.23.7 ; BMP, JPEG XL et RAW via des lecteurs explicitement forcés et une politique Magick restrictive. AVIF utilise une voie séparée moderne libavif/dav1d, en cours de qualification finale. La couverture RAW dépend du décodeur ou de la miniature JPEG embarquée : les dix extensions ne signifient pas que chaque modèle d’appareil est attesté.

Trois dépendances supplémentaires exactes sont retenues : `heic-to 1.6.7`, `@imagemagick/magick-wasm 0.0.45`, `@phenomen/libavif-wasm 1.4.203`. Les six versions antérieures et chaque entrée transitive de leur lock sont préservées. La piste provisoire jsquash ancienne a été retirée. Magick ne peut jamais ouvrir son ancien décodeur HEIC/AVIF ; les avis upstream [AV1](https://github.com/strukturag/libheif/security/advisories/GHSA-jx54-6rm6-2cgj) et [images codées multiples](https://github.com/strukturag/libheif/security/advisories/GHSA-2g6j-vhr6-6wrj) motivent ce choix.

## Ressources et limites utiles

Aucune limite source de taille ou de pixels ne précède la tentative native du téléphone. Le secours serveur lit au plus **128 Mio** directement vers un enfant isolé, sans copie complète de l’original dans le parent ; une seule préparation lourde est admise à la fois. Corps : 120 s ; conversion : 30 s ; client : 180 s. Budget de décodage : 64 MP ; sortie : côté 2048 et 2 Mio. Les bornes mémoire WASM sont vérifiées séparément et ne constituent pas un plafond de RSS total du processus.

Les sondes JPEG/PNG de 75 Mio ont observé environ 42–44 Mio RSS parent et jusqu’à 374 Mio enfant ; un RAW intégral 48 MP a révélé une consommation excessive malgré les limites annoncées du cache Magick, d’où la qualification d’une borne mémoire native et des miniatures embarquées. Ce sont des observations synthétiques, pas des mesures hébergées ni des maxima garantis.

La sauvegarde manuelle conserve son format et ses plafonds : un refus précoce évite d’arrêter le runtime lorsqu’un dépassement est déjà établi. Les contrôles de capture restent actifs pour les envois terminant après ce relevé. Cela ne rouvre pas le test hébergé de sauvegarde, reporté par l’utilisateur.

## État et critère de fin

Checkpoints de développement publiés : `c39158662cedcaf1f44e1b0faef2c419547c8993`, puis `592b826353b46f01f474ba8bf1aa01c66fee997c` (arbre `d3c6272284335f3f70d4447858a1461c35f5ddea`). Ce sont des états partiels, pas des livraisons. Les groupes locaux déjà acquis sont conservés dans [le checkpoint](verification-proofs/jm1150/development-checkpoint.json) et [la checklist](verification-proofs/jm1150/coverage.json) ; leurs recouvrements interdisent de les additionner.

Reste à achever le bornage des codecs et l’annulation après EOF, relire le diff final, qualifier PR puis main sur les cinq jobs natifs, publier le commit exact et qualifier un préparateur avec installation neuve isolée. Aucun déploiement 1.15.0 n’est encore attesté. La fin exige des preuves explicites par famille et parcours ; elle ne promet ni fichier endommagé/chiffré/propriétaire sans décodeur, ni ressources infinies. Téléphones physiques, Safari et photo cliente d’origine restent non attestés.
