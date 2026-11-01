# Contre-revue des bornes codecs 1.15.0

Revue indépendante en lecture seule, sans Git, sans réexécution de suite verte, sans hôte ni média réel. État lu le 2026-11-01T18:22:28.341220+00:00.

## Borne WASM et chemins de décodage

- Aucun bloqueur établi dans `boundWasmMemory` : SHA original et SHA dérivé obligatoires, en-tête wasm32, unique section mémoire définie avec un seul layout non partagé flags=1, minimum et maximum attendus exacts, refus des mémoires importées. Tous les octets hors section mémoire sont recopiés sans réencodage ; seules sa longueur et sa valeur maximale changent. Le maximum moteur de 8192 pages borne la mémoire linéaire à 512 Mio, y compris memory.grow natif ; cela ne borne pas le RSS total. Le test existant vérifie un vrai refus RangeError de grow, sans relance dans cette revue.
- L’intégration AVIF vérifie aussi le glue épinglé, instancie uniquement le module transformé en mémoire et utilise les pointeurs upstream pour éviter une copie JavaScript de tout le RGBA. Les dimensions/pointeurs et la longueur sont revérifiés ; erreurs assainies, pointeurs libérés en finally. L’enfant reste la frontière temps/processus, non une promesse de mémoire totale.
- Magick charge également les octets transformés/hashés avant lecture. Politique installée avant ping/read, lecteurs BMP/JXL/DNG forcés, delegates/filtres/autres coders et HEIC/AVIF/SVG interdits. La miniature RAW extraite pendant ping est donnée uniquement à Sharp JPEG. Aucun chemin concret vers l’ancien libheif Magick n’a été établi dans les appels relus. Les copies de profils/miniatures et buffers natifs restent à compter dans les mesures RSS, distinctes du maximum WASM.

## Angle transmis à l’auteur

`server/media/avif-original.mjs:55–80` : les associations primaire peuvent théoriquement accumuler jusqu’à 1024×255 références ; chaque irot/imir peut ensuite recopier le raster réduit dans transform. Le décodeur natif devrait refuser des propriétés transformatrices dupliquées, et le parent garde son délai30s, mais le lecteur advisory ne doit pas dépendre de ce rejet. Recommandation minimale : lors de propriétés irot/imir répétées ou d’un nombre anormal d’associations, retourner les hints vides, sans refuser l’image, et ne jamais appliquer plus d’un irot et d’un imir. Transmis à media_backend_1141 puis corrigé : le lecteur renvoie désormais {} dès un doublon ispe/irot/imir. La relecture du delta confirme au maximum un irot et un imir appliqués ; aucune dépendance au rejet natif. L’auteur rapporte3/3 tests AVIF nouveaux réussis, sans nouvelle exécution par cette revue. Aucun exploit décodable ni blocage natif avéré n’a été revendiqué.

L’axe imir du code est cohérent avec le libavif actuel/ISO2022 :0 échange haut/bas,1 gauche/droite. Vérifié sur source primaire include/avif/avif.h ; la terminologie ISO2017 peut induire une inversion et ne justifie aucune correction ici.

## Octets relus

- `server/media/bounded-wasm.mjs` : 2978 octets, SHA256 `a71f242b579bcad38ec90b524c946807e93223026467355ad9bfc3bf3607292f`.
- `tests/bounded-wasm.test.mjs` : 3210 octets, SHA256 `aec5f60465514f79ed56e470d8919b32e0e789c4ac425b25b057c3517242bcd1`.
- `server/media/extra-image-codecs.mjs` : 12058 octets, SHA256 `1941f5fcb51204c6c9cbca44d10db90534276de040c37c8d6b61d774e12ed25a`.
- `server/media/avif-original.mjs` : 8118 octets, SHA256 `1dd2eedb2961e55c49187b59a515a441f6b3b1736398d6d0062f0e37908d20e9`.

Après correction advisory, avif-original.mjs : 8118 octets, SHA256 `1dd2eedb2961e55c49187b59a515a441f6b3b1736398d6d0062f0e37908d20e9`. Aucun autre bloqueur établi.
