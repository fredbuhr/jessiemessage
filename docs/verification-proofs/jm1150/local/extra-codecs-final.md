# Extra codecs — bloc final gelé

Le module extra-image-codecs et ses tests/fixtures sont prêts pour la qualification complète du candidat. Les codecs et le WASM sont chargés uniquement dans decode, après le listener du processus enfant ; le détecteur parent reste pur. Aucun worker, package/lock ou adaptateur AVIF/HEIC n’a été édité par cet auteur.

Magick est limité aux lecteurs forcés BMP/JXL/DNG. Sa policy module/coder/delegate est appliquée avant ping ET read. Les tests positifs vérifient que HEIC, AVIF et SVG sont effectivement refusés par Magick, même lorsqu’un appel force ces types. Le vrai AVIF est routé vers avif-original de l’autre auteur ; un enfant neuf vérifie que cette conversion ne peut pas initialiser Magick et respecte targetSide/maxPixels.

La miniature JPEG RAW est extraite par LibRaw pendant ping via dng:thumbnail, avant l’allocation du raster complet, puis normalisée avec le JPEG Buffer loader Sharp déjà utilisé. Orientation et absence de suréchantillonnage sont vérifiées. Sans miniature, le RAW complet reste autorisé dans les64MP mais le maximum du seul linear heap du WASM épinglé est abaissé à512MiB par bounded-wasm. Aucun cap8MP arbitraire ne reste.

Résultats de mémoire mesurés dans des processus neufs Node24.22.1/V8oldspace96 :12MP sans miniature réussit en2,84s (maxRSS495536KiB),48MP sans miniature est refusé MEDIA_UNAVAILABLE en1,11s (maxRSS519692KiB),48MP avec miniature est rendu en584ms (maxRSS470300KiB). L’ancien essai48MP non borné de1,30GiB reste historique et ne correspond plus à la voie finale.512MiB borne le linear heap, PAS le RSS total ; le parent n’a pas de plafondRSS dur établi. Entrée128MiB, source64MP, temps et durée de vie de l’enfant restent des gardes distinctes.

Groupe final8/8 sans omission ; syntaxe et diff-check passent. Preuves, limites, commandes et SHA256 des trois fichiers : extra-codecs-implementation.json. Fixtures uniquement synthétiques. Pas de garantie sur tous les RAW propriétaires, l’original client absent ou un appareil physique ; pas de commit/push/host par cet auteur.
