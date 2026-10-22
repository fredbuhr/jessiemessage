# Repli compatible vidéo — référence 1.7.2

**Référence technique de repli fusionnée, qualifiée, publiée et précontrôlée sur l’hôte en SQL36 ; jamais démarrée.** La production est 1.8.0 / Node 24.22.1 / SQL36 ; son checkpoint est enregistré et latest pointe sur v1.8.0, selon [REPRISE](REPRISE.md) et le [reçu hébergé](verification-proofs/jm180-hosted-metadata.json). G4 conserve seulement la recette de l’interface hébergée. Ce repli n’a pas servi d’activation intermédiaire.

La branche `fix/video-compat-172` part du checkpoint G3 `92a59e3de98bcc848b507aa593901e0d57e5e2ce`, dont la source fonctionnelle `4f6587aee355b213b58734b576809eae0943553c` est qualifiée. Elle conserve le profil vidéo explicite, ses sept configurations et SQL 36. Le chargeur normal reste SQL 33. Aucun nouveau schéma, paquet, clé ou service n’est ajouté par le repli.

## Comportement attendu du repli

Les lecteurs vidéo, Range, galerie, ZIP, campagnes v3, capsules contenant les réponses personnelles, reçus mixtes et fermetures restent disponibles. Les diffusions vidéo déjà enregistrées peuvent terminer leur livraison. Le catalogue privé reste lisible et ses phrases peuvent être insérées dans un message texte.

Les nouvelles créations vidéo et les modifications de réponses personnelles sont désactivées distinctement, côté serveur et interface. Le runtime ne coupe pas la lecture vidéo pour bloquer la création. Les refus gardent les contrôles de session, origine et CSRF. Les envois texte/photo, le CRM, les annonces, tâches et sauvegardes manuelles continuent ; aucun automatisme abandonné n’est réintroduit.

## Qualification et préparation du repli

La [PR 127](https://github.com/fredbuhr/jessiemessage/pull/127) est fusionnée sur `6b3319a77c307ed7d6b003fe33de36807c70c266`, arbre `924d500375a69ae50bc63414b15df71271e2bf8a`. Les [CI PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39760004711) et [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39761371046) passent chacune 5/5 à la première tentative : général 3 799 tests / 3 752 réussis / 47 omissions ; Chrome 218/218 ; HTTPS 4/4 ; chaque moteur MariaDB 564/564 sans omission. Les dix journaux et métriques sont liés dans la [preuve 1.7.2](verification-proofs/jm172-verification.json).

Le parcours HTTPS utilise une base SQL 36 déjà peuplée par les services directs avant le démarrage de l’application, puis révoque les sessions de seed. L’application garde ses constantes de création fermées sans override. Les refus d’écriture, lectures H264/Range/galerie/ZIP, octets du catalogue et livraison v3 sont attestés. Le worker réel séparé conserve lui aussi la création désactivée sur son store. Les suites natives qualifient capture, fermeture et restauration.

La [release v1.7.2](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.7.2), identifiant `420600213`, est publiée le `2026-10-22T10:46:31Z` sur la source exacte `6b3319a77c307ed7d6b003fe33de36807c70c266`. Le tag pointe sur ce même commit immuable. Lors de cette publication, latest restait 1.7.1 ; il a ensuite été aligné sur v1.8.0 par l’[opérateur qualifié](verification-proofs/jm180-metadata-operator-verification.json). La [publication opérateur 39765553787](https://github.com/fredbuhr/jessiemessage/actions/runs/39765553787) réussit à la première tentative, avec ses deux jobs `operator-tests` et `publish` ; les empreintes des journaux complets sont conservées dans la [preuve](verification-proofs/jm172-verification.json).

Après la [préparation des checkouts/lanceurs et du bundle vidéo](verification-proofs/jm180-hosted-preparation.json), les trois migrations ont porté le schéma de 33 à 36. Les [précontrôles hébergés 1.7.2 et 1.8.0 ont réussi](verification-proofs/jm180-hosted-schema36.json), avant l’activation du seul produit 1.8.0. Le [reçu final](verification-proofs/jm180-hosted-metadata.json) confirme le repli 1.7.2 précontrôlé et non démarré, et la conservation des références historiques. Ne jamais redémarrer 1.7.1 ou 1.6.0 sur SQL36.

Les preuves G1–G3 restent historiques et inchangées. L’activation hébergée est attestée séparément par les reçus utilisateur ; les essais synthétiques ne qualifient ni téléphone physique ni débit du mutualisé. Le [retour utilisateur sur la vidéo](verification-proofs/jm180-hosted-interface.json) confirme sélection, retrait avant envoi, envoi et suppression. La création/téléchargement d’une sauvegarde et la persistance/insertion d’une réponse personnelle enregistrée restent à vérifier dans l’interface de production.
