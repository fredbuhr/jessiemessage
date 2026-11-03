# Invitations, inscription et connexion — 3 novembre 2026

L’utilisateur rapporte qu’un client reçoit « code expiré » avec plusieurs codes nouvellement générés. Le parcours exact, le code, l’horloge et l’appareil ne sont pas fournis. Le diagnostic porte sur le code1.15.0 et des comptes strictement synthétiques ; aucune cause individuelle n’est déclarée certaine.

État initial relu : dépôt propre, main documentaire04b98b24, version publiée/exécutée selon reçu1.15.0/source6712028e/arbrec80ee33e, dernier checkpoint989de548. CI main41339290231 réussie ; aucune suite de cette livraison n’est relancée pour la seule reprise. Node24.22.1 et schéma38/37tables attendu conservés.

## Défauts établis et corrections codées

| Point | Avant correction et preuve | Résultat codé |
| --- | --- | --- |
| A01 — saisie du code | Le contrôleur réel refuse NBSP périphériques, espaces insécables et tiret U+2011 avant tout HTTP, avec le mot « expiré ». ASCII identique accepté. | Même normalisation limitée et explicite sur navigateur/serveur ; variantes de collage et alias Crockford, sans changer le code canonique ni son empreinte. |
| A02 — horloges | Une invitation acceptée200 par le serveur est refusée si le téléphone est avancé ; même comparaison à la création admin. | Le serveur arbitre la validité ; le navigateur contrôle seulement la forme du reçu et affiche la date serveur. |
| A03 — erreurs | Code mal formé, secret refusé et mauvais identifiants réutilisent des textes parlant d’expiration. | Distinguer saisie, invitation indisponible, identifiants et réseau ; accès existant vers connexion/confirmation/récupération. |
| A04 — inscription interrompue | POST accepté après masquage de page : réponse abandonnée et formulaire réaffiché sans avertissement, invitation déjà consommée. | Aucun POST répété automatiquement ; résultat incertain explicite et orientation vers vérification du mail/connexion/renvoi. |
| A05 — confirmation hors ordre | Chaque renvoi révoque le lien précédent, même encore valide ; un ancien e-mail livré tard induit un refus. | Les liens encore valides coexistent jusqu’à la première confirmation ; activation unique, révocation des frères et annulation d’outbox atomiques. |
| A06 — mot de passe oublié avant confirmation | Renvoi exige le mot de passe ; récupération refuse le compte non confirmé : impasse. | Renvoi par adresse seulement, réponse uniforme et quotas existants ; après confirmation, récupération normale disponible. |

Les aliasO→0 etI/L→1 sont définis par [Crockford](https://www.crockford.com/base32). Les séparateurs Unicode admis sont une tolérance applicative explicite, pas une normalisation arbitraire de tout Unicode. La recommandation [OWASP de récupération](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) guide le renvoi public : réponse uniforme, travail commun et quotas, preuve de boîte e-mail avant effet sur le compte. Ces références ne constituent pas une certification de sécurité.

## Checklist d’audit et de qualification

| Domaine | Inspection initiale | Qualification corrective |
| --- | --- | --- |
| Génération/copie/code et liens historiques |100bits aléatoires, code72h distinct de l’accès illimité, empreintes compatibles | Qualifiée PR/main |
| Expiration/révocation/usage unique | Dates UTC, contrôles serveur après attentes/verrous ; pas d’expiration systématique serveur reproduite | Qualifiée PR/main |
| Inscription et e-mail déjà inscrit | Compte/code/outbox atomiques ; doublon annule toute transaction et conserve la nouvelle invitation | Qualifiée PR/main |
| Confirmation et renvoi | Activation en un clic ; liens répétés sans nouvelle session/prolongation ; défautsA05/A06 | Qualifiée PR/main |
| Connexion et récupération | E-mail/mot de passe, jamais code d’invitation pour un compte existant ; refus uniformes | Qualifiée PR/main |
| Sessions et concurrence | Preuve propriétaire après login, révocations/générations, aucun cookie restauré par vieille réponse | Qualifiée PR/main |
| Mobile/visibilité/réseau | DéfautA04 reproduit ; effacement des secrets au masquage à conserver | Qualifiée PR/main |
| HTTP/cache/confidentialité | Origin, CSRF authentifié, quotas, fragments nettoyés, no-store et SW sans cachefetch | Qualifiée PR/main |

Contrôles initiaux ciblés :40/40 tests invitations/service/horloges,58/58 tests auth/session/activation/reset, sans omission. Ce sont deux lots de tests existants liés à l’audit ; ils ne prouvent pas la résolution de l’incident. Les résultats correctifs, preuves natives et limites seront consignés après exécution, sans additionner des groupes qui se recoupent.

## Tables et invariants du parcours

Périmètre relu : `users`, `invitations`, `admin_mfa`, `auth_rate_limits`, `sessions`, `auth_session_state`, `client_auth_state`, `client_session_state`, `email_verifications`, `mail_outbox`, `client_password_resets`, `password_reset_outbox` et `conversations`. Les suites natives de migrations, contraintes, access-store et access-flow vérifient les transactions sur bases jetables ; aucun nouvel inventaire de la base hébergée n’en est déduit. Aucun changement DDL.

Invariants conservés : code/compte/mail atomiques, doublon e-mail sans consommation de la nouvelle invitation, verrou émetteur/utilisateur, génération des identifiants, une conversation, jetons individuels bornés par date/révocation, aucune activation ou session au renvoi, première confirmation révoquant les frères et annulant les mails restants. La correction du veto d’horloge porte sur les invitations ; les contrôles de session serveur et l’ordonnanceur existant sont préservés, sans garantie sur un appareil arbitrairement déréglé.

## Qualification locale et contre-revue

Correctifs codés sur `fix/access-onboarding-1151`, sans migration ni dépendance nouvelle. [Preuves locales](verification-proofs/jm1151/local-qualification.json) :85tests backend distincts,45tests UI VM,4tests normalisation et7tests route statique réussis, sans omission ; build réussi. Groupes séparés, non additionnés à la CI. Les deux premiers échecs de fixtures sont conservés, corrigés sans retirer de garde produit.

La contre-revue a reproduit une course supplémentaire : un GET de session commencé avant une inscription pouvait finir pendant le POST, invalider la réponse puis effacer tout avertissement. Un instantané de l’époque de soumission rend ce GET ancien inopérant, pour succès200 et refus401 ; le verrou de vérification est libéré normalement. Reproduction indépendante ensuite corrigée, un seul POST. Le contrôle login compteA suivi de preuve session compteB laisse l’identitéB et aucun e-mailA prérempli dans le renvoi. Aucun autre blocage trouvé à la contre-revue.

Premier candidat23a53758/run41609766319 : Chrome, HTTPS et les deux MariaDB natifs réussis ; général4541tests/4475pass/14échecs/52omissions. Tous les14échecs sont le même chargeur VM de `recovery-lifecycle` resté sans adaptation à l’import ESM réel. Fixture seule corrigée,25/25ciblés réussis. [Échec complet conservé](verification-proofs/jm1151/pr-initial-failure.json). Le candidat corrigé a ensuite passé la qualification complète PR/main ci-dessous ; aucune qualification physique ou hébergée déduite.

## Limites

La livraison initiale1.15.0 reste active. Aucune migration, nouvelle dépendance, modification de compte, révocation, e-mail ou mutation de production n’est exécutée pendant cet audit. Téléphones physiques, Safari, livraison SMTP réelle et cas exact du client ne sont pas attestés par les essais synthétiques. Les chantiers médias déjà livrés, sauvegarde reportée, PC et juridique ne sont pas rouverts.

## Bilan final de qualification et livraison

Les huit domaines de la checklist sont inspectés et qualifiés sur données synthétiques. [PR41610784906](verification-proofs/jm1151/pr-native.json) puis [main41612033199](verification-proofs/jm1151/main-native.json), tentative1,5/5jobs chacun : général4541tests/4489réussites/52omissions explicites, Chrome327/327, HTTPS14/14, MariaDB620/620 sur10.11 et11.4. Les groupes se recoupent et ne sont pas additionnés. Le checkout PR synthétique et le commit main exact ont le même arbre568530e7. Les52omissions ne sont pas des réussites ; les suites SQL/HTTPS natives conservent leur propre preuve.

Six captures natives FR/EN320/390/1280, dont les deux nouveaux écrans d’inscription incertaine, sont inspectées indépendamment puis par le parent. [Preuve visuelle et bornes](verification-proofs/jm1151/visual-native.json). Défilement vertical normal sur petits écrans, aucun débordement horizontal bloquant ; les tailles de contrôles sont des assertions DOM, pas une mesure sur téléphone physique.

[Publication](verification-proofs/jm1151/publication-native.json) acquisev1.15.1/release432505702/sourcea4a07f9f :2/2jobs et24/24tests natifs. [Préparateur](verification-proofs/jm1151/preparation-native.json) qualifié40/40natifs, réemploi exact des dépendances1150 et préservation des états. Sources relues identiques aux opérateurs qualifiés. [Prochaine étape hébergée](operations-release1151.md) : préparation/CHECK1151 encore non exécutés, activation et métadonnées ensuite. La production confirmée reste1.15.0 ; aucune cause individuelle ou résolution déjà observée chez le client n’est inventée.
