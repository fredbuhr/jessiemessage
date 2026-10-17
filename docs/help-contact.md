# Lot 0.40 — aide et contact accessibles

**État : implémentation en cours, non activée.** Le runtime hébergé reste `b651d44e`, lot 0.39. Le propriétaire confirme « test mot de passe ok » le 17 octobre 2026 à 18:52:47 Europe/Paris. Ce retour valide globalement le parcours de récupération ; il ne décrit pas les plateformes, la réutilisation du lien ou les notifications après reconnexion.

## Résultat attendu

Une page courte `/help`, en français et en anglais, rassemble les réponses utiles : accéder à son espace, rester connecté, recevoir les notifications, retrouver son mot de passe, comprendre les messages/photos et contacter Jessie. Les sections de données et de signalement utilisent l’adresse officielle `contact@jessiemessage.com`.

L’aide est accessible depuis l’accueil, l’entrée, la connexion client et administrateur, la récupération, la conversation, la préparation du site, les diffusions et la reprise d’appareil. Elle s’ouvre dans un nouvel onglet, annoncé dans son nom accessible. La page en cours et son brouillon ne sont pas remplacés. L’application n’ajoute aucun stockage de brouillon ou de contenu privé.

## Langue et liens

`help-link.js` construit seulement `/help#lang=fr` ou `/help#lang=en`, depuis le module de langue existant, et actualise le lien quand la langue change. Aucun identifiant, jeton d’invitation, message, adresse e-mail, chemin privé ou paramètre de retour n’est copié. Le lien statique `/help` reste utilisable sans ce script.

La page d’aide consomme uniquement l’indice de langue fermé et exact prévu, retire la query et le fragment, puis utilise la préférence partagée. Les ancres de sections sont une liste locale fermée. Aucune destination libre n’est acceptée. `noopener noreferrer` protège l’écran source et son contexte ; le retour reste `/app`. Le lien de récupération est fixé sur l’adresse principale, puisque la récupération est volontairement absente sur recette.

Limite distincte : depuis l’aide anglaise de recette, suivre ce lien de récupération primaire utilise la préférence propre à l’apex. Il ne transporte pas la langue vers le formulaire de récupération ; son bouton de langue reste disponible. Ce lot ne change pas la grammaire des liens de récupération ni les contrôles du lot 0.38.

Les liens de contact ouvrent le logiciel de courrier de l’utilisateur avec un sujet fixe seulement. Ils n’envoient aucun e-mail automatiquement et ne préremplissent aucune donnée personnelle. Aucun formulaire, appel API, suivi publicitaire, permission, abonnement ou worker n’est ajouté par l’aide.

## Informations publiées et limites

Les textes décrivent le code réellement actif : accès sur invitation, connexion conservée par appareil, notifications discrètes et facultatives, lien de récupération de trente minutes, portée de la suppression d’un message et moyens de contact. Les messages et photos sont chiffrés côté serveur, puis déchiffrés pour leur affichage autorisé ; aucune promesse de chiffrement de bout en bout n’est faite.

Cette page pratique ne remplace pas une notice juridique complète. L’identité exacte du responsable, les fondements applicables, les durées et le traitement des sauvegardes restent à finaliser avant l’ouverture. Aucune durée de conservation ou suppression de compte automatisée n’est inventée ni activée. Le diagnostic de suppression reste non exécutable.

Références primaires consultées le 17 octobre 2026 : [CNIL — information et transparence](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence), pour une information claire et accessible et les éléments restant à préciser ; [WebKit — notifications des applications ajoutées à l’écran d’accueil](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), pour l’aide iPhone/iPad. Le code conserve la détection des capacités existante, sans nouvelle règle fondée sur le navigateur.

## Vérifications prévues

- HTTP : seules les routes publiques explicitement enregistrées sont servies ; MIME, HEAD, CSP, absence de cache et refus des méthodes restent conformes sur les deux origines.
- Langue : préférence manuelle conservée dans le nouvel onglet ; indice malformé ignoré sans modifier la préférence ; aucune fuite depuis les pages contenant un jeton ou un brouillon.
- Chrome : vrais HTML, styles et scripts, français/anglais, écrans étroits et ordinateur, navigation clavier, accordéons, cibles tactiles et absence de débordement. Les nouveaux liens ne remplacent pas le document source.
- Régression : les fixtures existantes servent la nouvelle dépendance commune ; les catalogues prennent en compte ses traductions sans diminuer leur couverture.
- Livraison : cinq jobs CI sur la révision exacte, préflight du profil recovery existant sans listener, build/redémarrage épinglé puis contrôles HTTPS et lecture visuelle du site réel.

La préférence du propriétaire pour des sessions durables et l’acceptation du mot de passe restent acquises. Ce lot ne réinitialise aucun compte et ne modifie ni schéma, clé, DNS, permissions de notification ou règles de session.
