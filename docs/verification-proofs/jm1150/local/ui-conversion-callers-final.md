# Callers UI conversion photo — gel du 1 novembre 2026

Fichiers assignés uniquement : public/profile.js, public/broadcast.js, public/media-library-page.js et tests associés. Capacité/préflight non modifiés ni rejoués. Aucun Git, hôte, SQL réel ou sauvegarde réelle. Après reprise explicite, aucune délégation nouvelle ni relance de l’enfant interrompu.

## Contrat codé

Le préparateur commun reste natif d’abord et décide lui-même de l’unique appel éventuel `convert(original,{signal})`. Diffusion et bibliothèque lui fournissent un callback qui lit les capabilities actuelles avec preuve propriétaire/CSRF, exige preparation.enabled et les bornes attendues, puis POSTe les octets originaux vers /api/media/admin/prepare sous les mêmes preuves et le signal de la sélection. Délai180s sur la conversion ; maxOriginalBytes134217728, maxOutputBytes2097152, maxPixels64000000. Aucune constante32Mio restante dans ces trois callers.

Le POST de préparation renvoie un JPEG binaire, lu dans un tableau borné2Mio, longueur/type vérifiés, corps streamé refusé dès dépassement puis annulé. Une réponse refusée est lue comme JSON d’erreur. MIME invalide, longueur déclarée trop grande ou binaire non conforme annulent aussi leur fetch ; ils ne restent pas à recevoir en arrière-plan. Le préparateur commun conserve la validation réelle du JPEG et de ses dimensions2048. Son erreur de conversion, notamment endpoint404 ou capability ancienne, empêche le POST d’asset. Aucun essai automatique consistant à stocker l’original.

Le header optionnel X-Image-Format n’existe que pour /prepare : regex de dernière extension File.name, enum dng/nef/arw/cr2/cr3/raf/rw2/orf/pef/srw, normalisée en minuscules. Le nom complet n’est pas transmis ; aucune indication RAW n’atteint /assets. Sans MIME fichier, Content-Type application/octet-stream. Les bytes restent l’autorité côté serveur.

Diffusion : le délai120s de l’ancien POST stockant démarre désormais seulement après la préparation, afin de laisser au convertisseur ses180s ; le POST asset, la sélection d’asset et les états d’incertitude/annulation de ce POST gardent leur parcours existant. Aucune campagne envoyée automatiquement.

Bibliothèque : préparation pure puis seul POST asset attendu par l’action explicite d’ajout ; ni message ni campagne. Le flag attempted ne passe à true qu’avant ce POST stockant, donc une erreur du préparateur pur ne devient pas une incertitude de stockage.

Profil : prepareProfileAvatar transmet signal et convert au commun avant le crop256px. createProfileUI reçoit convertImage optionnel ; son wrapper vérifie ticket, propriétaire, séquence et annulation avant l’appel. L’adoption réévalue les mêmes gardes au retour. Le transport est injecté par le propriétaire chat, qui confirme account:true, preuves avant/après,180s et le même enum RAW. Aucun fetch ajouté au profil ; aucun asset créé par son aperçu. Anciens adaptateurs sans convertImage restent acceptés.

## Contrôles et recoupements

1. Profil, résultats acquis avant interruption : quatre nouveaux cas unitaires verts. Premier groupe3/4 puis correction d’une assertion de fixture et seul cas défaillant1/1. Non rejoués depuis. Note détaillée profile-conversion-callers.md. Nouveau cas browser écrit et tenté, non qualifié localement car ChromeDriver absent avant l’application ; aucune installation/reprise de ce test.
2. Premier groupe ciblé diffusion/bibliothèque :26 cas,25 succès et1 échec d’assertion de fixture qui attendait à tort /api/auth/session après le POST de diffusion ; le vrai garde est /api/broadcast/admin/session. Ce groupe est entièrement recoupé par le groupe complet suivant et n’est pas additionné.
3. Groupe complet pertinent, une fois après ajout des raccords et RAW : `node --test tests/media-library-ui.test.mjs tests/broadcast-lifecycle.test.mjs` :127/127, aucun échec/omission. Journal ui-conversion-unit.log. Inclut parcours existants, originaux identiques, binary/JSON, capability ancienne/404/401/403/415/503, preuves avant/après, owner/CSRF remplacés, annulation/retour tardif sans replay, réponse streamée2Mio+1, MIME refusé, borne d’entrée et hints RAW.
4. Relecture suivante : défaut concret de consommation arrière-plan si un binaire était rejeté dès ses headers. Correction des deux seuls readers pour aborter leur fetch. Seuls cas affectés exécutés : `node --test --test-name-pattern='conversion bounds streamed' tests/media-library-ui.test.mjs tests/broadcast-lifecycle.test.mjs` :10/10, aucun échec/omission, dont8 cas recoupant le groupe127 et2 nouveaux cas de longueur déclarée trop grande. Ne pas additionner127+10. Journal ui-conversion-binary-cancellation.log.

Syntaxe des trois callers et git diff --check verts après le dernier delta. Pas de revue des nouveaux codecs/serveur/stdin dans cette mission ; l’avis backend antérieur ne couvre pas leurs changements postérieurs.

## Restant

Qualification native navigateur/CI de la composition complète et du nouveau cas profil. Le propriétaire chat termine son raccord convertImage/profil et l’indice RAW dans son transport ; aucun de ses fichiers modifié ici. Aucun état hébergé ni résultat de client réel revendiqué.

## SHA256 gelés

| Fichier | SHA256 |
|---|---|
| public/profile.js | 337933aa75ab95023f9810a45a79228e9d36ce7a67ecbbbcb347689caada8e31 |
| public/broadcast.js | 8fb9dd9849673984b3c0382113e3c4dc47709fa8bd7f122d99794d6d79cee505 |
| public/media-library-page.js | 234fb47de7b5ab22da1003779b7a018a3efba3d15d5e3fdf3d3edcbf3e400194 |
| tests/profile-ui.test.mjs | 8ca2b9604db865dea841462aa011ce4e2f0797a671185e86e4626511283abcae |
| tests/broadcast-lifecycle.test.mjs | c81a91a14234905b7b53e4458adcf269a721b616754e762e746854482283c547 |
| tests/media-library-ui.test.mjs | fe3a3bdbd57f01b13e389296da2d0ab0e6ee7917d3198ca40add47622d37f1a8 |
| tests/browser/profile-avatar.browser.mjs | 4909a37b8b1a6afc0bfb711f52b619a2c332ab05630f177b41379f4d0624eac7 |
