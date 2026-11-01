# Contre-revue native-first — lecture seule

Périmètre : diff de `public/image-preparation.js`, tests unitaires et navigateur associés et matrice `tests/fixtures/photo-acceptance-formats.json`. Aucun test, probe, édition du dépôt, accès hébergé ou dépendance effectué pendant cette revue. Les 37 tests verts annoncés appartiennent à l’auteur et n’ont pas été rejoués.

## Point fonctionnel conditionnel à traiter ou écarter

`nativeImageHint` transmet les dimensions issues de `heifInfo` pour HEIF/AVIF (`image-preparation.js:232-235`), puis le code calcule une largeur ET une hauteur de redimensionnement (`464`, options `333`). Or le parseur lit ispe/irot, sans interpréter une propriété clap de recadrage. Si le navigateur rend l’image réellement recadrée avec un ratio différent du canevas ispe, lui imposer les deux dimensions du canevas peut déformer cette photo. Le commentaire du hint présente surtout l’optimisation JPEG ; la solution KISS est de réserver ces deux dimensions forcées aux formats dont le hint représente effectivement l’image rendue, au minimum JPEG, plutôt que d’interpréter encore davantage de métadonnées HEIF.

Ce point est une conséquence conditionnelle du code et de l’existence de recadrages HEIF/AVIF, pas un cas de téléphone exécuté pendant cette revue ni une attribution au client. Il mérite une décision avant gel ; je n’ai pas de reproduction Chrome/Safari locale autorisée ici.

## Contrat de conversion et ressources

- Les hints sont bien bornés à 512 Kio et 1 s, et leur échec ne rejette plus la tentative native. Le buffer de hint est effacé, y compris les résultats tardifs du lecteur.
- Le secours logiciel HEIC conserve lecture 128 Mio, inspection et 64 MP ; les ressources du worker restent bornées par le code inchangé. L’échec local est ensuite récupérable par le callback unique.
- Le callback `convert(file,{signal})` reçoit le fichier original, n’est appelé qu’une fois, et son erreur HTTP remonte sans être réécrite ou répétée. Les bitmap/canvas/bytes locaux sont libérés avant de l’appeler. Un abort règle l’attente même si le callback l’ignore ; son résultat tardif est ignoré.
- `convertedImage` vérifie Blob/JPEG, poids<=2 Mio et dimensions d’en-tête<=2048, puis efface sa lecture de validation. Il ne réalise pas de nouveau décodage intégral du JPEG retourné ; la normalisation effective reste le contrat du convertisseur et la validation indépendante à l’envoi.
- L’attente du callback n’a pas de délai propre dans ce helper. Le transport applicatif fourni par root doit donc être borné ; si c’est acquis, documenter ce contrat suffit. Sans ce contrat, un callback qui ne termine jamais et n’est jamais annulé reste pendant indéfiniment.
- Le retrait du plafond natif rend possible une allocation pleine par le navigateur quand le hint ne fournit pas de dimensions, notamment sur une source PNG/HEIF plus grande que le préfixe inspecté. Il ne faut donc pas présenter native-first comme une preuve de mémoire native bornée sur tout appareil. Aucun OOM réel n’a été reproduit dans cette revue en lecture seule.

## Tests et faux succès

La matrice est bien synthétique. Les tests unitaires de succès natif simulent le décodeur : ils prouvent l’absence de veto et le contrat de normalisation, pas la lecture réelle de chaque conteneur ; le test navigateur complète cette lacune. Les cas GIF/APNG/AVIF multipages comparent désormais un pixel rouge de la première image et ne se limitent pas aux dimensions, ce qui élimine le faux succès d’une animation à images visuellement indifférenciées.

Le cas TIFF navigateur autorise conversions=0 et aucune requête de conversion. Il prouve l’acceptation, mais ne garantit pas le parcours backend si un navigateur finit par décoder TIFF nativement. Les unitaires forcent déjà l’échec natif pour le callback ; ajouter une variante navigateur forcée peut rendre cette preuve de secours durable. C’est un point de couverture, pas un bloqueur produit établi.

En dehors du risque de ratio conditionnel et du délai à confirmer côté adapter, aucun autre bloqueur certain identifié dans le diff. Aucune garantie « tous fichiers », aucune résolution du fichier client inconnu et aucun résultat Chrome local déduits.
