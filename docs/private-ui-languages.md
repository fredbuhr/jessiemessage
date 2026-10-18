# Interfaces privées FR/EN — étape 0.19

Version applicative **0.21.0**, branche `feat/private-ui-languages`, construite sur l’entrée PWA #21. Les écrans réellement servis proposent désormais français et anglais. **contact@jessiemessage.com** reste l’adresse officielle. Aucun déploiement ni changement de configuration privée n’est réalisé.

## Parcours et choix de langue

Le bouton FR/EN partage le choix entre l’accueil, `/app`, accès/invitation, récupération, connexion et gestion administrateur, conversations client/administrateur, photos/galerie/médiathèque, fiches CRM, préférences et diffusions individuelles, ainsi que la préparation du site.

Le navigateur choisit initialement le français si sa langue commence par `fr`, sinon l’anglais. Une préférence explicite remplace ce choix. La seule valeur écrite est `fr` ou `en`, sous la clé `jessiemessage.language` de `sessionStorage`. Elle suit les navigations de cette session ; aucun compte n’est enrichi avec une préférence et aucune synchronisation entre appareils n’est ajoutée. Un stockage bloqué ou incohérent n’empêche ni la page ni la bascule courante de fonctionner.

Les titres, notices, boutons, aides, placeholders et noms accessibles utilisent des sources d’interface explicites. Les dates et nombres sont reformattés lors de la bascule (`fr-FR` / `en-US`), avec le fuseau du navigateur comme auparavant. Les états imbriqués restent réactifs, y compris dans les compteurs, validations et mesures d’exploitation.

## Données et actions préservées

| Élément | Comportement lors de la bascule |
| --- | --- |
| Messages, légendes, pseudonymes et adresses | Texte d’origine conservé, même s’il correspond à un libellé d’interface |
| Notes, surnoms, tags, groupes, titres/textes de campagne | Données privées conservées sans traduction automatique |
| Champs et brouillons | Valeurs, sélection et saisie conservées ; aucun remplacement du formulaire |
| Messages, contrôles photo et miniatures | Nœuds existants conservés ; aucune reconstruction globale de l’historique |
| Mot de passe, MFA, jetons, identifiants et URL | Valeurs inchangées ; aucune valeur sensible stockée par la traduction |
| Session et requête déjà en cours | Contrôles existants conservés ; aucune nouvelle requête ou répétition d’action déclenchée par la langue |

La traduction écrit du texte ou des attributs d’interface autorisés (`placeholder`, `title`, `aria-label`). Elle n’injecte pas de HTML et ne parcourt pas les textes privés pour rechercher des mots français. Les catalogues sont des ressources publiques statiques, sans donnée de compte. Leur assemblage refuse les traductions contradictoires ou les paramètres incohérents.

Les liaisons de texte sont faibles et explicites. Les paramètres dynamiques sont oubliés au masquage et au départ de page ; les contrôleurs conservent leur purge privée existante. Une liaison dont le texte a été remplacé est invalidée. Les chemins de données brutes retirent les anciens marqueurs avant d’écrire. Changer de langue ne peut donc pas réintroduire les valeurs effacées d’un autre compte ou d’une ancienne réponse.

Aucun endpoint, schéma SQL, cookie, envoi, worker, cache privé ou service worker n’est ajouté. Les nouveaux scripts et styles suivent les réponses publiques `no-store` et la CSP locale. Leur disponibilité n’active aucune fonction privée. Les contrôleurs gardent un repli français si le moteur partagé manque ; sans JavaScript les parcours privés interactifs restent indisponibles comme auparavant.

## Vérifications et limites

Les tests exécutent le vrai moteur avec les contrôleurs dans un DOM synthétique : sources et attributs statiques, notices asynchrones, dates/nombres, valeurs brutes qui ressemblent à des traductions, bascules pendant une opération, absence d’appel supplémentaire, stabilité des messages/photos, purge au masquage et réponses tardives. Un test d’assemblage vérifie tous les catalogues ensemble, leur ordre de chargement et le service HTTP des ressources sans activation privée. Les régressions historiques de session et d’isolation restent exécutées.

Ces preuves ne remplacent pas un navigateur réel. La [recette de préproduction](preproduction-acceptance.md) doit encore vérifier débordements, longueur des textes, focus, clavier, annonces accessibles et comportement installé sur les appareils. Aucun moteur de navigateur installé n’est disponible dans l’environnement local de ce lot.

Ce lot porte sur les interfaces privées et leurs erreurs affichées. Les e-mails de vérification/récupération restent en français ; les sorties CLI et documents opérateur gardent leur langue propre. Les données utilisateur ne sont pas traduites. La traduction des e-mails demandera un choix de langue de livraison explicite et ses propres vérifications de confidentialité. L’hébergement, la réception e-mail réelle, la majorité externe, la conservation/suppression, la restauration et la revue/fusion ordonnée des PR restent à terminer avant publication.
