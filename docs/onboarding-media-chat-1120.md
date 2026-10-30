# Évolution1.12.0 — inscription et échanges

Périmètre demandé le30octobre : délai des confirmations, accès après confirmation sans deuxième approbation admin, photos mobiles et Entrée pour envoyer avec bouton de retour à la ligne. Production1113 conservée selon son dernier relevé utilisateur ; métadonnées privées finales non rapportées, à inspecter avant une prochaine activation.

## Constats de départ

- Worker e-mail : poll15secondes après chaque lot de5, aucune notification du commit d’inscription. Le délai de réception réel des boîtes clientes reste non mesuré.
- Photos : refus au-delà de10MiB avant redimensionnement local, limitant inutilement les grandes photos compressibles. Autres erreurs de formats/décodage à examiner.
- Validation admin : règle existante explicite désormais retirée sur instruction utilisateur ; invitation et confirmation e-mail restent obligatoires.
- Entrée : comportement à changer dans le compositeur, avec prise en compte des claviers/IME et des envois en cours.

## État du travail

Développement en cours sur `feat/onboarding-media-chat-1120`. Worker réveillable et drainage immédiat des lots prêts implémentés ;44tests mail ciblés passent. Admission, préparation des photos et compositeur en cours. Aucune qualification globale, fusion, publication ou activation de1.12.0 encore effectuée. Aucune migration SQL nouvelle prévue. Aucun test réel d’e-mail, compte, photo privée ou sauvegarde reportée.

Les preuves et limites seront complétées avant la qualification finale. Une omission ne sera pas comptée comme réussite.
