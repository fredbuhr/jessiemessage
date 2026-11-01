# Profil — injection du secours de conversion

Lot autorisé et borné aux trois fichiers ci-dessous, terminé le 1 novembre 2026. Aucun autre fichier applicatif modifié par cette sous-tâche. Aucun hôte, compte, donnée réelle ou Git.

`prepareProfileAvatar(file,{signal,convert})` transmet le Blob original et les options au préparateur partagé. Le résultat normalisé conserve le parcours de recadrage local256×256 JPEG, son plafond256Kio et les nettoyages bitmap/canvas acquis. La validation du JPEG converti2Mio/2048 et l’appel unique avec l’original relèvent du préparateur commun.

`createProfileUI` accepte l’option facultative `convertImage`. Avant d’invoquer le callback injecté, un wrapper revérifie le ticket, le propriétaire actuel, le numéro de préparation et les signaux d’annulation ; le callback reçoit le même original et le signal de cette préparation. La garde existante après résolution refuse les résultats tardifs. Les anciens adaptateurs sans convertisseur restent acceptés. Aucun nouveau fetch dans le profil ; le transport authentifié appartient au raccord chat.

## Preuves ciblées

- Quatre nouveaux tests unitaires (`--test-name-pattern='profile conversion'`) : forwarding direct avec/sans callback ; injection avec original/signal inchangés et aucun POST avant sauvegarde ; refus de démarrage après perte owner/account/CSRF, fermeture, suspension ou sélection remplacée ; résultat tardif ignoré après perte owner/fermeture/remplacement.
- Premier passage3/4 vert : une assertion de fixture attendait à tort l’abort d’un signal déjà terminé après succès. Cette assertion a été retirée ; seul ce cas échoué a été relancé,1/1 vert. Les trois cas déjà verts n’ont pas été répétés. Bilan quatre nouveaux cas verts, aucune suite historique rejouée.
- Nouveau test navigateur écrit : entrée synthétique indécodable, callback injecté appelé une fois avec l’original, JPEG validé puis avatar256px sans métadonnées, aucune mutation avant sauvegarde. Tentative ciblée unique bloquée avant initialisation applicative : ChromeDriver indisponible. Ce test n’est donc pas qualifié localement et reste attendu en CI navigateur. Aucune installation ou contournement.
- `node --check` réussi pour les trois fichiers modifiés. Relecture du raccord, du wrapper et des assertions terminée ; aucun bloqueur établi.

## Fichiers gelés

- `public/profile.js` : 337933aa75ab95023f9810a45a79228e9d36ce7a67ecbbbcb347689caada8e31
- `tests/profile-ui.test.mjs` : 8ca2b9604db865dea841462aa011ce4e2f0797a671185e86e4626511283abcae
- `tests/browser/profile-avatar.browser.mjs` : 4909a37b8b1a6afc0bfb711f52b619a2c332ab05630f177b41379f4d0624eac7
