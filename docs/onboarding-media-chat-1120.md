# Évolution 1.12.0 — inscription et échanges

Les quatre demandes du 30 octobre sont implémentées dans une seule version encore non publiée ni activée : confirmations plus rapides, accès après confirmation sans approbation admin supplémentaire, grandes photos mobiles et Entrée pour envoyer avec bouton de retour à la ligne.

## Nouvelle simplification demandée le31octobre

Le premier client a créé son compte avec une nouvelle invitation selon l’utilisateur. Celui-ci remplace le diagnostic individuel proposé par une demande KISS : ouverture du lien = adresse confirmée et accès activé, sans second clic et sans approbation admin. Implémentation sur `fix/one-click-confirmation-1120`,144contrôles ciblés réussis ; CI native du nouveau code encore attendue. Les preuves ci-dessous qualifient l’étape antérieure, elles ne qualifient pas automatiquement cette dernière modification. Aucun compte des captures modifié ; aucun diagnostic hébergé exigé pour ces clients.

## État vérifié au 31 octobre

La [PR141](https://github.com/fredbuhr/jessiemessage/pull/141) est fusionnée sur `331cc1b79a76da4f846f7bd5c1b370c1d5766a3f`, arbre `b20e09901a003c994c7aff43724580542c6a37de`, avec [PR](verification-proofs/jm1120/pr141-native.json) puis [main](verification-proofs/jm1120/main141-native.json) 5/5. La dernière clarification du parcours e-mail est fusionnée par [PR142](https://github.com/fredbuhr/jessiemessage/pull/142) sur `2e3504570c373463c6e0126d7c93dfbfb7ade300`, arbre `2a6013bbf4d8fb06c74e660e03a0be9f57a56a80`, identique au candidat `bbc17060bc814eaeba418acf4499bb1655bc4780`. Sa [CI PR41148665207](verification-proofs/jm1120/pr142-native.json) est réussie 5/5. [CI main41149578038](verification-proofs/jm1120/main-native.json) réussie5/5, tentative1, sur le même arbre complet ; tous les journaux et compteurs sont conservés.

Les [28 contrôles du périmètre](verification-proofs/jm1120/checklist.json) ont une disposition ; le cas client réel reste en attente de son relevé. Les deux premiers runs échoués sont conservés : [premier](verification-proofs/jm1120/pr-first-native.json), [second](verification-proofs/jm1120/pr-second-native.json). Ils ne qualifient aucune livraison.

## Changements et preuves

- Le worker se réveille après le commit d’une inscription ou d’un renvoi de confirmation, sans attendre le prochain poll de 15 secondes. Il draine immédiatement les lots prêts, conserve la coalescence, les reprises bornées et l’arrêt. Le délai final SMTP/boîte destinataire n’a pas été mesuré.
- L’invitation et l’e-mail confirmé activent l’accès et sa conversation. Les anciens comptes confirmés en attente sont rattrapés à la connexion ou validation de session. Invitations, émetteur, propriétaire, conversations fermées, suspensions, révocations et expirations restent contrôlés. L’ancienne approbation est idempotente et ne prolonge pas l’accès.
- Les photos JPEG/PNG/WebP jusqu’à 50MiB sont inspectées avant décodage (64MP/16384px maximum), puis réduites localement vers 2MiB et 2048px. MIME vide/générique et noms sans extension passent l’inspection des octets ; fallback navigateur, EXIF/alpha, nettoyage et erreurs sont couverts. Le vrai test Chrome d’une JPEG20MP dépassant 10MiB réussit. HEIC/HEIF demande une copie JPEG. Plafond serveur10MiB, trois uploads globaux/un par compte ; échéance réception60s, admission/Node65s, attente client90s. Texte15s, archives65s, vidéo300s.
- Entrée envoie pour les deux rôles ; le bouton↵ insère une ligne au curseur. IME, répétition, envoi actif, limites et autres champs sont protégés. Les [14 captures finales](verification-proofs/jm1120/visual-final.json) ont été inspectées : sept images identiques aux octets déjà relus, sept directement relues dans le dernier artifact ; FR/EN320/1280px et légende photo à360px de hauteur.
- Le mail indiquait seulement d’ouvrir le lien alors qu’un clic sur « Vérifier mon e-mail » reste nécessaire. Le mail et la page l’expliquaient à cette étape antérieure ; le succès invite à se connecter pour ouvrir sa conversation, sans texte d’approbation supplémentaire.

Les suites finales PR comprennent général4168tests/4116réussis/52omissions explicites, Chrome282/282, HTTPS14/14, MariaDB611/611 chacune sans omission. Les 52 omissions générales ne sont pas des réussites : 50 scénarios SQL réservés aux suites natives et deux branches conditionnelles sans procfs. Contrôles ciblés : admission/UI/session162, mail44, média/compositeur204 ; dernier complément accès/mail64/64. Ces groupes se recoupent et ne sont pas additionnés. Deux durcissements issus de revue sont intégrés : rollback d’une activation si la session expire, et refus d’une conversation historique fermée/étrangère.

## Client signalé et interruption

La capture utilisateur montre invitation utilisée, e-mail en attente et approbation désactivée. Elle ne prouve pas l’état actuel de la base. Une ouverture de lien sans le bouton final, un lien ancien/expiré ou un affichage périmé restent possibles. Le [relevé en lecture seule](operations-access-diagnostic1113.md) est qualifié 3/3 : 26 tests Python et 15 tests JS/SQL sur chacune des deux MariaDB. Aucun compte, mot de passe, e-mail ou média réel n’a été modifié par l’agent ; son résultat hébergé n’est pas encore reçu.

La [reprise](verification-proofs/jm1120/recovery.json) confirme les sources intactes et l’absence de copie poussée au point de l’interruption antérieure. Une coupure ultérieure du transport exec-server a été observée pendant une simple lecture, puis le canal s’est rétabli. La cause précise de l’interruption ChatGPT antérieure n’est pas établie.

## Limites et prochaine étape

La production reste 1.11.3 selon le dernier relevé utilisateur. La finalisation privée1113 est inconnue ; le même relevé observe son empreinte sans rejouer le writer. La qualification décrite ici est acquise pour le code antérieur. Le diagnostic client a depuis été remplacé par la simplification du31octobre : qualifier celle-ci puis publier/préparer une seule mise à jour. Aucun nouveau schéma ou dépendance. Smartphone physique, Safari et fichier original du client restent non reproduits ; tests de sauvegarde reportés et réserves antérieures inchangés.
