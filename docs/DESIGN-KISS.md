# JessieMessage — direction KISS et atelier d’interface

Archive de la première direction du 14 octobre 2026. Les choix de palette et de monogramme ci-dessous ont été remplacés par [Nuit V2](NUIT-V2.md) et l’[identité approuvée](IDENTITE-VALIDEE.md). Les principes de simplicité restent utiles ; pour l’état fonctionnel, lire le [bilan actuel](NEXT-STEPS.md).

## Positionnement

Une conversation personnelle, pas un réseau social. Sensualité discrète, accueil humain et lisibilité avant les effets visuels. Palette ivoire, anthracite, vert profond, accents champagne ponctuels. Une photographie d’accueil suffit ; pas de carrousel, vidéo automatique, compteur de fans ou fausse présence « en ligne ». La confiance doit correspondre aux fonctionnalités effectivement livrées.

La référence en haut noir et jean est retenue pour l’aperçu local. Aucune retouche de visage ou de corps n’est nécessaire. Le favicon fourni est une référence, pas un choix définitif : le prototype emploie un monogramme J discret. Ne pas committer les portraits personnels sans validation explicite de leur publication dans le dépôt public.

## Parcours cible

- Client : invitation valide, activation du compte, puis conversation unique. Les contrôles de majorité applicables sont distincts de l’invitation. Ne demander que les informations nécessaires. Préférer une session persistante correctement sécurisée à des reconnexions répétées.
- Notifications : demande facultative, contextualisée après la découverte de la conversation. Aucun aperçu intime sur l’écran verrouillé. Ne pas demander simultanément l’installation, les notifications et plusieurs consentements.
- Administration : trois entrées principales, Messages / Médiathèque / Diffusion. Tags, notes et rappel dans une fiche secondaire, pas sur une page d’accueil remplie de statistiques.
- Groupes : commencer par des segments internes fondés sur les tags et une sélection de destinataires. Ajouter les combinaisons de filtres et groupes manuels lorsque l’usage le justifie. Ne jamais exposer les groupes aux clients.
- Diffusion : destinataires, médias, texte, résumé, confirmation. Comptes suspendus exclus ; distinction entre contenu attendu et communication promotionnelle facultative. Retirer les médias déjà remis, en expliquant les exclusions. Une publication crée des messages individuels.
- Brouillons : propres à chaque conversation, pour ne pas envoyer au mauvais destinataire le texte préparé pour un autre.
- Médias : stockage privé distinct du code ; un fichier peut être référencé plusieurs fois. L’historique d’envoi ne prouve pas une consultation effective.

Pas de paiement, de fil public, de recherche d’autres membres ou d’appel audio/vidéo dans le premier périmètre. Émojis natifs d’abord ; intégration d’un fournisseur de GIF seulement après validation de ses règles et de la confidentialité.

## Atelier interactif : design/preview.html

Fichier autonome à ouvrir dans un navigateur après téléchargement, sans shell, installation de dépendances ni serveur. Les boutons Accueil / Côté client / Administration servent uniquement à examiner les interfaces.

L’atelier permet de tester localement les messages, les émojis, la galerie, les tags, notes et rappels, la sélection de médias et la diffusion simulée. Il contient uniquement des comptes fictifs. Aucun accès réel, aucune connexion à MariaDB, aucun Web Push, aucun envoi d’e-mail et aucun paiement ne sont implémentés. Tout est en mémoire et disparaît au rechargement.

Le bouton Photo lit une image localement avec FileReader. Les fichiers personnels ne sont pas transmis et ne sont pas conservés par l’application. La version source a un bloc local-branding vide. Un export remis directement au propriétaire peut contenir une référence fournie dans la conversation ; cet export ne doit pas être ajouté au dépôt public.

**Ne pas déployer l’atelier comme application client.** La bascule client/admin et les données globales sont des instruments de démonstration, jamais un système d’autorisation. Le serveur Node.js existant ne dessert pas le dossier design. Les versions de production devront obtenir leurs données au moyen d’API avec autorisations vérifiées côté serveur.

La politique CSP de ce fichier de démonstration interdit les connexions réseau ; elle autorise les scripts/styles intégrés pour permettre un aperçu autonome. Ce n’est pas une recommandation de CSP pour la production.

## Majorité : ne pas confondre les états

La maquette comprend une déclaration « Je déclare avoir au moins 18 ans ». Elle ne renseigne que ageDeclared, jamais un état ageVerified.

Un achat ou un compte sur une plateforme tierce n’est pas automatiquement une preuve de majorité transmissible à cette application. Aucune attestation vérifiable ou intégration de ce type n’a été établie pour le projet.

Le seul écran déclaratif ne doit pas être présenté comme une conformité suffisante pour distribuer des contenus pornographiques. L’article 227-24 du Code pénal mentionne explicitement la simple déclaration de majorité ; le champ exact des règles Arcom pour le service envisagé doit être qualifié avant l’ouverture réelle. Ne pas inventer une dispense liée à l’accès sur invitation. Conserver le développement des interfaces et la décision juridique séparés.

Sources primaires à revalider au lancement :
- Code pénal, article 227-24 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044394218
- Référentiel Arcom : https://www.arcom.fr/sites/default/files/2024-10/Arcom-Referentiel-technique-sur-la-verification-de-age-pour-la-protection-des-mineurs-contre-la-pornographie-en-ligne.pdf
- Web Push Apple : https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers

## Pages et promesses

Les fenêtres Confidentialité / Conditions / Mentions légales ne contiennent qu’une structure de travail et les informations exactes sur cet aperçu local. Elles ne constituent pas les documents finaux du service. Ne pas inventer de société, de contact ou de numéro d’immatriculation. Ne pas promettre un chiffrement de bout en bout non implémenté ni une réception garantie des notifications.

## Vérification de cette étape

Dix tests Node couvrent notamment la séparation déclaration/vérification, le filtrage des destinataires, les doublons, l’idempotence d’une campagne et l’absence de portrait intégré dans la source publique. Le workflow existant lance tests/*.test.mjs.

Des essais locaux Chromium ont vérifié les interactions et des largeurs de 320 à 1440 pixels. Ils ne remplacent ni des essais Safari/iPhone réels, ni un audit de sécurité, ni des tests de charge. Aucun service de production n’est activé par cette étape.
