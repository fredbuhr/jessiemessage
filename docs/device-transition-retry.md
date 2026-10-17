# Reprise après coupure — conserver le message visé

## Défaut confirmé

Dans le runtime de transition `a0b17ce0`, un clic de notification peut lancer la reprise avec une référence de message. Le premier aller-retour réussit normalement, car le serveur conserve cette référence dans les paquets authentifiés. Mais après une erreur réseau, une réponse 503 ou un délai dépassé pendant l’autorisation ou la fin de reprise, **Réessayer** recommence avec un nouveau `begin` sans cette référence. La connexion peut alors aboutir sans ouvrir le message initial.

La régression est reproduite avec le vrai contrôleur JavaScript. Les anciens tests couvraient surtout une nouvelle tentative du début de reprise, sans référence ; ils ne démontraient pas sa conservation après les deux étapes suivantes.

## Correction simple

Le contrôleur transporte également la référence non secrète de notification dans le fragment des deux sauts. Un parseur fermé n’accepte qu’un paquet borné et, éventuellement, une référence de trente-deux caractères hexadécimaux minuscules. Le fragment est toujours effacé avant tout travail asynchrone.

Cette référence sert à **recommencer** un parcours interrompu. L’autorisation et la fin normales continuent à envoyer leur unique champ de paquet au serveur ; seule sa destination authentifiée décide du résultat. Un indice de fragment différent ne remplace donc pas la destination d’un ticket valable. Les anciens fragments sans indice restent acceptés.

Aucune modification serveur, session, cookie, clé, table ou migration n’est nécessaire. Aucun stockage navigateur supplémentaire n’est ajouté. Le service worker ne met pas les scripts ni les données privées en cache ; les pages de reprise restent servies avec les en-têtes privés existants.

## Validation et livraison

Les régressions couvrent les deux rôles et les erreurs 503, réseau ou délai dépassé pendant l’autorisation et la fin de reprise, le nouveau départ après un ticket consommé, la priorité de la destination authentifiée, les formats refusés et l’annulation en quittant la page. Les scénarios Chrome utilisent deux origines HTTPS locales et les vrais cookies du navigateur avec des comptes synthétiques.

Le code doit passer les contrôles locaux et les cinq jobs CI de sa révision exacte avant activation. Les résultats et la révision effectivement livrée seront consignés après ces contrôles. Aucun test synthétique ne remplace une nouvelle notification système et sa reprise sur les appareils du foyer.

La [recette des appareils](notifications-device-acceptance.md) conserve l’ancienne connexion et les anciennes installations jusqu’à validation de l’apex. Le [compte rendu de bascule](primary-origin-cutover.md) distingue les réponses du nouveau service de la propagation DNS encore observée sur certains parcours.
