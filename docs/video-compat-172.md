# Repli compatible vidéo — référence 1.7.2

**G4 en cours : référence technique de repli fusionnée, qualifiée et publiée, non préparée sur l’hôte.** La production reste 1.7.1 / Node 24.22.1 / SQL 33, selon [REPRISE](REPRISE.md). La référence produit 1.8.0 est également publiée, sans activation hébergée ; ce repli n’est pas une activation intermédiaire.

La branche `fix/video-compat-172` part du checkpoint G3 `92a59e3de98bcc848b507aa593901e0d57e5e2ce`, dont la source fonctionnelle `4f6587aee355b213b58734b576809eae0943553c` est qualifiée. Elle conserve le profil vidéo explicite, ses sept configurations et SQL 36. Le chargeur normal reste SQL 33. Aucun nouveau schéma, paquet, clé ou service n’est ajouté par le repli.

## Comportement attendu du repli

Les lecteurs vidéo, Range, galerie, ZIP, campagnes v3, capsules contenant les réponses personnelles, reçus mixtes et fermetures restent disponibles. Les diffusions vidéo déjà enregistrées peuvent terminer leur livraison. Le catalogue privé reste lisible et ses phrases peuvent être insérées dans un message texte.

Les nouvelles créations vidéo et les modifications de réponses personnelles sont désactivées distinctement, côté serveur et interface. Le runtime ne coupe pas la lecture vidéo pour bloquer la création. Les refus gardent les contrôles de session, origine et CSRF. Les envois texte/photo, le CRM, les annonces, tâches et sauvegardes manuelles continuent ; aucun automatisme abandonné n’est réintroduit.

## Qualification acquise et livraison restante

La [PR 127](https://github.com/fredbuhr/jessiemessage/pull/127) est fusionnée sur `6b3319a77c307ed7d6b003fe33de36807c70c266`, arbre `924d500375a69ae50bc63414b15df71271e2bf8a`. Les [CI PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39760004711) et [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39761371046) passent chacune 5/5 à la première tentative : général 3 799 tests / 3 752 réussis / 47 omissions ; Chrome 218/218 ; HTTPS 4/4 ; chaque moteur MariaDB 564/564 sans omission. Les dix journaux et métriques sont liés dans la [preuve 1.7.2](verification-proofs/jm172-verification.json).

Le parcours HTTPS utilise une base SQL 36 déjà peuplée par les services directs avant le démarrage de l’application, puis révoque les sessions de seed. L’application garde ses constantes de création fermées sans override. Les refus d’écriture, lectures H264/Range/galerie/ZIP, octets du catalogue et livraison v3 sont attestés. Le worker réel séparé conserve lui aussi la création désactivée sur son store. Les suites natives qualifient capture, fermeture et restauration.

La [release v1.7.2](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.7.2), identifiant `420600213`, est publiée le `2026-10-22T10:46:31Z` sur la source exacte `6b3319a77c307ed7d6b003fe33de36807c70c266`. Le tag pointe sur ce même commit immuable et latest reste 1.7.1. La [publication opérateur 39765553787](https://github.com/fredbuhr/jessiemessage/actions/runs/39765553787) réussit à la première tentative, avec ses deux jobs `operator-tests` et `publish` ; les empreintes des journaux complets sont conservées dans la [preuve](verification-proofs/jm172-verification.json). Les checkouts et lanceurs, la configuration vidéo et le précontrôle hébergé restent à attester avant activation de la 1.8.0. Le repli n’est pas encore prêt sur l’hôte et n’a jamais été démarré. Ne jamais redémarrer 1.7.1 ou 1.6.0 sur SQL 36.

Les preuves G1–G3 restent historiques et inchangées. Un test synthétique ne qualifie ni téléphone physique, ni débit du mutualisé, ni activation hébergée.
