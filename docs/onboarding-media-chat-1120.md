# Évolution1.12.0 — inscription et échanges

Périmètre demandé le30octobre : délai des confirmations, accès après confirmation sans deuxième approbation admin, photos mobiles et Entrée pour envoyer avec bouton de retour à la ligne. Production1113 conservée selon son dernier relevé utilisateur ; métadonnées privées finales non rapportées, à inspecter avant une prochaine activation.

## Constats de départ

- Worker e-mail : poll15secondes après chaque lot de5, aucune notification du commit d’inscription. Le délai de réception réel des boîtes clientes reste non mesuré.
- Photos : refus au-delà de10MiB avant redimensionnement local, limitant inutilement les grandes photos compressibles. Autres erreurs de formats/décodage à examiner.
- Validation admin : règle existante explicite désormais retirée sur instruction utilisateur ; invitation et confirmation e-mail restent obligatoires.
- Entrée : comportement à changer dans le compositeur, avec prise en compte des claviers/IME et des envois en cours.

## État du travail

Implémentation groupée sur `feat/onboarding-media-chat-1120` : worker réveillable après commit et drainage immédiat des lots prêts (44tests mail ciblés), activation après confirmation et rattrapage des anciens comptes confirmés, préparation des grandes photos vers2MiB avec fallback navigateur, Entrée/envoi et bouton de retour à la ligne. Contrôles ciblés :162tests admission/UI/session,44tests mail et204tests échéances média/compositeur passent, sans omission. Revue indépendante d’admission effectuée ; suites natives navigateur/SQL et revue des captures encore attendues. Aucune qualification globale, fusion, publication ou activation de1.12.0 encore effectuée. Aucune migration SQL nouvelle prévue. Aucun test réel d’e-mail, compte, photo privée ou sauvegarde reportée.

Les preuves et limites seront complétées avant la qualification finale. Une omission ne sera pas comptée comme réussite.

## Résultat fonctionnel visé

- Une confirmation nouvellement mise en file réveille le worker immédiatement après commit. SMTP reste asynchrone et les erreurs conservent leur attente bornée ; le délai final imposé par la boîte destinataire n’est pas promis.
- Après l’invitation et la confirmation e-mail, le client est actif avec sa conversation et sa durée d’accès. Suspensions/révocations, invitation unique, dates et droits restent contrôlés. L’ancienne action d’approbation est idempotente pour les pages admin encore ouvertes, sans prolongation.
- Une photoJPEG/PNG/WebP peut provenir d’un fichier50MiB (64MP/16384px maximum) ; elle est inspectée puis réduite localement vers2MiB avant upload. La protection serveur10MiB reste. HEIC/HEIF non décodable n’est pas accepté silencieusement : un message demande une copieJPEG. Le cas réel du client n’a pas été reproduit sur son appareil.
- Entrée envoie depuis le compositeur uniquement. Le bouton↵ ajoute une ligne au curseur, conserve le brouillon et le focus. IME, répétitions et envois en cours sont protégés ; contrôleFR/EN, admin/client, mobile/desktop.

## Revue et limites

Deux durcissements intégrés après revue indépendante de l’admission : rollback si la session expire pendant activation, et refus d’une conversation historique fermée ou appartenant à un autre administrateur. Les protections ne sont pas supprimées pour activer un compte.

Les essais locaux complets rencontrent un environnement sans `/tmp` et sans procfs ; un échec synthétique de fichiers vidéo est résolu par un TMPDIR isolé (8/8), sans modification du code de sauvegarde ni essai hébergé. Ce lancement général incomplet/échoué n’est pas compté comme une qualification. La syntaxe de780sources est vérifiée. Les nouveaux parcours Chrome doivent être exécutés dans la CI, Chrome étant absent localement.

## Réseau mobile et contrôle d’expiration

La réception photo dispose d’une échéance totale60s, admission65s, serveur Node photo65s et attente du client90s (traitement compris). Les limites3uploads globaux/1parcompte et10MiB serveur sont conservées. Délais texte15s, archives65s et vidéo300s inchangés. Les tests couvrent réception après35s, expiration à60s et ticket refusé à65s.

Le cas natif de récupération d’un compte expiré conserve lecture/envoi403 et absence de modification des messages/droits. Une modification d’assertion trop large a été retirée après revue ; aucun garde d’expiration n’a été assoupli.
