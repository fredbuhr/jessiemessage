# Données et confidentialité — préparation privée

## État courant — préparation factuelle pour 1.8.2

[REPRISE](REPRISE.md) est l’unique référence de l’application active, de Node, du schéma et des preuves de livraison. Le dossier **Administration → Confidentialité** reste privé, chiffré et **`draft_only`**. Les décisions **D01–D08 restent à compléter** : les choix produit déjà acquis ne déterminent pas les fondements, l’identité juridique exacte, les durées des autres familles de données ou les prestataires et transferts précis. La présente correction documentaire ne publie aucune notice, ne modifie aucune préparation privée enregistrée et ne déclenche aucune opération sur l’hébergement.

Le [brouillon FR/EN](privacy-notice-draft.md) est un modèle chargé par le service pour initialiser les textes du dossier privé ; il n’est pas servi comme une notice publique. Les sections FR/EN sont accessibles à l’administration autorisée dans ce dossier. Une préparation déjà enregistrée prévaut sur le modèle et conserve ses propres textes ; modifier le fichier ne la met pas à jour silencieusement.

Les faits techniques à prendre en compte pour la rédaction sont les suivants :

- Les échanges comprennent les photos et vidéos ; l’archive de conversation peut inclure ces médias. Les photos sont normalisées et leurs métadonnées d’origine retirées ; les vidéos peuvent conserver celles de leur fichier d’origine. Le chiffrement est côté serveur, sans chiffrement de bout en bout.
- La règle acquise conserve les conversations jusqu’à la fermeture définitive du compte, sauf suppressions volontaires de messages et médias. Déconnexion, expiration et suspension d’accès ne ferment pas définitivement le compte. Cette règle ne fixe pas la durée de toutes les autres données ou copies.
- La fermeture locale par l’administration et son moteur d’effacement existent sous leurs gardes, avec suivi durable. Leur portée vise la base active et les médias appartenant au client ; les copies extérieures sont distinctes. Le client ne dispose pas d’une action autonome de suppression du compte. Une demande enregistrée ou un accès révoqué ne prouve pas un effacement terminé.
- Les brouillons texte de conversation peuvent être conservés dans le stockage de session de l’onglet, selon les possibilités du navigateur, avec des limites de nombre et de taille. Ils ne sont réaffichés qu’après vérification du compte, de la session et de l’accès à la conversation, sans envoi automatique. Ils ne comprennent pas les fichiers, identifiants de médias ou identifiants de connexion réutilisables. La durée de reprise des brouillons ordinaires ne constitue pas une promesse d’effacement physique du navigateur ; le texte et la référence d’un envoi incertain restent conservés jusqu’à confirmation ou nettoyage par l’application.
- Les fiches CRM, classements, rappels privés et diffusions individuelles sont livrés. L’application ne demande plus au client un accord distinct pour recevoir un envoi groupé depuis 0.50 ; ce choix de parcours ne décide pas le fondement juridique des communications.
- La sauvegarde simple à la demande remplace les automatismes précédents. Les anciennes archives, clés, reçus et copies restent préservés. Leur sort et leur durée ne sont pas déterminés par le seul fonctionnement de cette sauvegarde ; son essai hébergé reste reporté à la demande de l’utilisateur, sans action à reprendre ici.

## Fonctionnement privé retenu

JessieMessage reste un espace privé sur invitation, géré par Jessie en France. L’administration utilise un compte commun sur plusieurs appareils, avec des sessions indépendantes et 180 jours renouvelables. Le service attribue les actions à cette identité applicative sans distinguer les personnes qui utilisent le compte. Aucun nouveau rôle ni compte supplémentaire n’est créé par cette préparation.

Les écrans utilisent uniquement le nom Jessie. L’aide décrit l’accès des personnes autorisées à gérer cet espace sans identifier de personnes supplémentaires ni promettre un accès réservé à une seule personne. Aucun usage commercial, aucune origine extérieure des invitations ni statut juridique ne sont déduits de ce fonctionnement. Les décisions encore manquantes restent distinctes de la règle de conservation des conversations déjà acquise ; aucune démarche administrative n’est engagée par ce document.

## Décisions et faits encore nécessaires

Les identifiants ci-dessous relient le brouillon aux informations manquantes. « À décider » ne vaut pas accord implicite ; aucun nombre de jours général n’est proposé comme fait établi.

| Référence | Élément à obtenir | Travail déjà préparé | Condition avant mise en œuvre |
| --- | --- | --- | --- |
| D01 | Qualification et identité exacte du responsable, coordonnées utilisables, pays d’établissement ; contact données et DPO s’il existe | Espace privé Jessie ; contact `contact@jessiemessage.com` | Le compte technique commun ne décide pas la qualification juridique ; ne pas publier de coordonnées personnelles dans le dépôt public |
| D02 | Fondement applicable à chaque finalité, caractère obligatoire/facultatif et éventuels intérêts légitimes | Finalités recensées : accès, échanges, sécurité, notifications, demandes de droits | Documenter la justification ; l’autorisation de développer ne choisit pas ces fondements |
| D03 | Traitement prévu des contenus révélant la vie sexuelle ; condition applicable de l’article 9, modalités et preuve si consentement retenu | Les textes, photos et vidéos peuvent comporter ces informations ; pas de preuve spécifique démontrée par le parcours actuel | Analyse liée à cet usage précis ; ni invitation, ni majorité déclarée, ni permission Push ne constituent cette preuve |
| D04 | Conservation par famille : compte, historique, médias, preuves d’accès, sécurité, files et CRM | Conversations jusqu’à la fermeture définitive, sauf suppressions volontaires ; autres familles, copies et exceptions encore à préciser ; nettoyages techniques distincts des durées à choisir | Choisir déclencheur, durée ou critère, sort final et éventuelles exceptions justifiées |
| D05 | Portée d’une clôture/effacement, médias réutilisés, audiences et exceptions documentées | Fermeture locale admin et moteur d’effacement livrés sous gardes, avec journaux et reçus ; simulation et blocages conservés | Compléter la portée juridique et les exceptions sans réimplémenter le moteur ; ne pas assimiler demande, révocation ou étape inachevée à un effacement terminé |
| D06 | Copies SQL/médias, PC, exports partiels, coffre, clones et sauvegardes fournisseur : responsables, lieux, fréquence, rotation et fin de vie | Sauvegarde manuelle actuelle, anciennes copies et parcours de restauration avec contrôles de réapparition conservés ; essai hébergé de sauvegarde reporté | Préciser la vie des copies sans inventer rotation ou purge ; ne pas attribuer au moteur de fermeture l’effacement des copies extérieures |
| D07 | Entités prestataires, lieux et transferts, sous-traitants, journaux et sauvegardes de l’hébergeur | Accès par l’administration autorisée de l’espace Jessie ; hébergement Infomaniak, mail et Push identifiés fonctionnellement | Décrire les catégories de personnes autorisées ; vérifier les contrats/configurations précis ; ne pas promettre que toutes les données restent dans un pays donné |
| D08 | Opérateur des demandes, canal de remise, lieu protégé du suivi et durée de ses preuves | Procédure et champs minimaux de suivi prêts | Compléter dans l’espace privé d’exploitation ; aucun dossier client dans Git/CI |

**Lecture du point D03 :** les données concernant la vie sexuelle font partie des catégories particulières. Il faut identifier une base de l’article 6 et une condition de l’article 9 adaptée au traitement envisagé. Le consentement explicite est une possibilité à examiner, pas une qualification déjà retenue pour JessieMessage. Sources : [RGPD, articles 6 à 9](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2), [définition CNIL](https://www.cnil.fr/fr/definition/donnee-sensible), consultés le 17 octobre 2026. Aucune nouvelle formalité ou intégration de prestataire n’est activée par ce dossier.

La notice devra fournir une information accessible sur le responsable, les finalités, destinataires, conservation et droits. Les champs manquants sont rassemblés ici pour éviter des mentions inventées. Référence : [CNIL — information et transparence](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence), consultée le 17 octobre 2026.

## Travail de préparation restant

1. Compléter D01–D08 dans l’espace privé d’exploitation, en distinguant les faits déjà acquis des informations et qualifications encore manquantes. Aucun dossier client ni coordonnées personnelles à ajouter au dépôt public.
2. Mettre les textes FR/EN enregistrés en concordance avec ces faits et décisions, puis relire leur accessibilité et leur cohérence. La mise à jour du modèle source ne remplace pas une préparation déjà enregistrée. La lecture ou l’acceptation d’une notice ne remplace pas une éventuelle action de consentement distincte.
3. Préparer seulement ensuite la publication explicite de la notice définitive depuis l’aide et les points de collecte, en conservant les liens fermés et le nettoyage d’URL. Ne transporter aucun jeton ni brouillon vers la notice. Aucun mécanisme de publication, nouveau consentement ou nouveau moteur d’effacement n’est ajouté par ce document.

Les fiches, les diffusions, les fermetures locales et les contrôles de restauration ne sont pas des travaux à réimplémenter dans cette préparation. Les limites de ces mécanismes, les copies extérieures et les décisions D01–D08 restent explicites ; aucun effacement réel, test de sauvegarde ou nouveau parcours utilisateur n’est déclenché.

## Historique — préparation 0.41/0.42

Les éléments suivants décrivent exclusivement la préparation et ses vérifications au 17 octobre 2026. Ils ne constituent ni l’état actuel ni une liste d’actions restantes. Les numéros, comptes et résultats sont conservés pour leur étape ; ils ne qualifient pas 1.8.2.

**État : dossier préparatoire, sans publication d’une notice définitive.** Base relue : `a4828caf725ccc7807ea8723b17be626ec56eaf6`, branche `feat/help-contact`, arbre `fd741aa31cd7839e8c0de85204b59110890fb247`. Les changements de source sont inclus dans le [runtime 0.42](operations-diagnostic.md) `ed78b55e`, activé le 17 octobre 2026 à 21:03 Europe/Paris, profil `messaging-photos-notify-recovery`, schéma 30. Le brouillon de notice reste non servi ; conservation et effacement restent à décider. Les acceptations du propriétaire restent acquises.

### Résultat préparé à cette étape

- [Registre des 29 catégories et des copies extérieures à la base](data-retention-register.md) : finalités, contenu, comportement actuel, événements candidats et dépendances avant effacement.
- [Brouillon de notice FR/EN](privacy-notice-draft.md), avec champs explicites à compléter. Ce fichier n’est ni servi par HTTP ni intégré au build public.
- [Procédure de réponse aux demandes de données](data-rights-procedure.md), fondée sur l’inventaire, l’export et la simulation déjà présents. Aucun nouveau formulaire ni second exporteur.
- Correction descriptive de `DATA_POLICY_METADATA.existingCleanup` : les compteurs partagés anti-abus ont déjà un nettoyage opportuniste après 24 heures. Les trois nettoyages de files existants sont conservés. Aucun worker, seuil, SQL, format d’export ou droit d’accès n’est modifié.
- L’aide FR/EN présente un espace privé autour de Jessie et décrit l’accès des personnes autorisées à le gérer. Aucun usage commercial ou source d’invitation extérieure n’est attribué au service. Le texte est préparé sur la branche, sans déploiement.

Les fondations restent `simulationOnly: true`, `executable: false`, `retentionDecided: false` : 29 catégories, dont 22 client, cinq administrateur et deux globales ; 23 observations et 40 clés étrangères `RESTRICT`, soit 38 relations distinctes. Aucun exécuteur de suppression de compte n’est ajouté.

### Vérifications et limites de cette étape

La relecture cible `server/data/`, les suppressions ponctuelles chat/médias, les quatre nettoyages SQL existants, les cookies, `sessionStorage` et le service worker. Elle n’accède à aucune base, compte, sauvegarde ou configuration privée hébergée. Elle ne constitue pas un nouvel audit global du produit.

Le contrôle documentaire doit comparer les 29 noms et leurs portées au catalogue et aux migrations, puis vérifier les liens locaux ajoutés. Les tests existants de données doivent préserver l’export borné, la lecture seule et l’impossibilité d’exécuter la simulation. Les résultats réellement obtenus sont consignés après vérification ; les chiffres du lot 0.40 ne sont pas attribués à cette branche.

**Résultats locaux de cette préparation, Node.js 24.19.0 :** `npm ci --ignore-scripts` réussit ; `npm test` compte **2 058 réussites, 143 intégrations ignorées, zéro échec sur 2 201 cas**. `npm run build`, qui inclut `npm run check`, réussit. Le contrôle documentaire compare exactement les 29 noms/portées aux sources et aux trente migrations, vérifie douze liens locaux dans les quatre nouveaux documents et reconstruit une simulation synthétique : 22 candidats toujours bloqués, 23 observations, 38 relations distinctes, `executable: false`. Les intégrations ignorées ne sont pas présentées comme exécutées ; aucune base hébergée ni aucun appareil réel n’a été utilisé.

Le runtime hébergé, le schéma, les sessions de 180 jours, les clés, les domaines et les notifications ne sont pas modifiés par cette préparation. Aucune demande de données réelle n’est traitée et aucun courrier n’est envoyé.
