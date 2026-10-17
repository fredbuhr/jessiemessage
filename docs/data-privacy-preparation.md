# Lot 0.41 — données et confidentialité : préparation

**État : préparation, sans activation ni publication d’une notice définitive.** Base relue : `a4828caf725ccc7807ea8723b17be626ec56eaf6`, branche `feat/help-contact`, arbre `fd741aa31cd7839e8c0de85204b59110890fb247`. Le service reste celui du [lot 0.40](help-contact.md), source `5ea9c40a`, profil `messaging-photos-notify-recovery`, schéma 30. Les acceptations du propriétaire restent acquises.

## Résultat préparé

- [Registre des 29 catégories et des copies extérieures à la base](data-retention-register.md) : finalités, contenu, comportement actuel, événements candidats et dépendances avant effacement.
- [Brouillon de notice FR/EN](privacy-notice-draft.md), avec champs explicites à compléter. Ce fichier n’est ni servi par HTTP ni intégré au build public.
- [Procédure de réponse aux demandes de données](data-rights-procedure.md), fondée sur l’inventaire, l’export et la simulation déjà présents. Aucun nouveau formulaire ni second exporteur.
- Correction descriptive de `DATA_POLICY_METADATA.existingCleanup` : les compteurs partagés anti-abus ont déjà un nettoyage opportuniste après 24 heures. Les trois nettoyages de files existants sont conservés. Aucun worker, seuil, SQL, format d’export ou droit d’accès n’est modifié.
- Après précision du propriétaire à 20:15 Europe/Paris le 17 octobre 2026, l’aide FR/EN indique que Jess et son partenaire utilisent ensemble le compte administrateur et peuvent lire les échanges. Le texte est préparé sur la branche, sans déploiement.

Les fondations restent `simulationOnly: true`, `executable: false`, `retentionDecided: false` : 29 catégories, dont 22 client, cinq administrateur et deux globales ; 23 observations et 40 clés étrangères `RESTRICT`, soit 38 relations distinctes. Aucun exécuteur de suppression de compte n’est ajouté.

## Fonctionnement privé confirmé par le propriétaire

Jess et son partenaire gèrent ensemble JessieMessage et utilisent **le même compte administrateur simultanément**. Les sessions indépendantes par appareil et les 180 jours renouvelables sont conservés ; aucun second compte ni système de rôles supplémentaire n’est demandé. Les actions sont attribuées au compte commun : le service ne permet pas d’établir lequel des deux opérateurs a réalisé une action. L’acceptation sur l’ensemble des appareils ne se déduit pas de cette préférence.

Le service reste privé, sur invitation et à usage restreint. Le propriétaire souhaite un fonctionnement simple et aucune démarche déclarative lancée par l’assistant ; aucune démarche ni contact administratif n’est effectué. Cette préférence ne décide pas les durées, l’étendue de l’effacement ou la qualification du responsable au sens du RGPD.

La CNIL distingue la suppression des déclarations ordinaires de fichiers de la protection des données qui reste applicable. L’exception personnelle/domestique vise les activités sans lien professionnel ou commercial ; la restriction d’accès ne suffit donc pas à établir une exemption pour des échanges avec des clients. C’est l’analyse retenue pour ce projet, sans engager de formalité au nom du couple. Sources consultées le 17 octobre 2026 : [CNIL — fin des déclarations](https://www.cnil.fr/fr/le-rgpd-cest-maintenant-les-changements-retenir-et-les-outils-pour-bien-se-preparer), [RGPD, considérant 18](https://www.cnil.fr/fr/reglement-europeen-protection-donnees).

## Décisions et faits encore nécessaires

Les identifiants ci-dessous relient le brouillon aux informations manquantes. « À décider » ne vaut pas accord implicite ; aucun nombre de jours général n’est proposé comme fait établi.

| Référence | Élément à obtenir | Travail déjà préparé | Condition avant mise en œuvre |
| --- | --- | --- | --- |
| D01 | Qualification et identité exacte du responsable, coordonnées utilisables, pays d’établissement ; contact données et DPO s’il existe | Exploitation à deux confirmée : Jess et son partenaire ; contact `contact@jessiemessage.com` | La gestion technique à deux ne suffit pas à conclure à une responsabilité conjointe au sens juridique ; ne pas publier de coordonnées personnelles dans le dépôt public |
| D02 | Fondement applicable à chaque finalité, caractère obligatoire/facultatif et éventuels intérêts légitimes | Finalités recensées : accès, échanges, sécurité, notifications, demandes de droits | Documenter la justification ; l’autorisation de développer ne choisit pas ces fondements |
| D03 | Traitement prévu des contenus révélant la vie sexuelle ; condition applicable de l’article 9, modalités et preuve si consentement retenu | Les textes et photos peuvent comporter ces informations ; pas de preuve spécifique démontrée par le parcours actuel | Analyse liée à cet usage précis ; ni invitation, ni majorité déclarée, ni permission Push ne constituent cette preuve |
| D04 | Conservation par famille : compte, historique, médias, preuves d’accès, sécurité, files et éventuel CRM | Événements candidats dans le registre ; nettoyages techniques existants distingués des durées à choisir | Choisir déclencheur, durée ou critère, sort final et éventuelles exceptions justifiées |
| D05 | Portée d’une clôture/effacement, médias réutilisés, audiences et exceptions documentées | Simulation non destructive et blocages existants | Définir la portée avant un exécuteur durable et ses tests ; ne pas assimiler révocation et effacement |
| D06 | Copies SQL/médias, PC, exports partiels, coffre, clones et sauvegardes fournisseur : responsables, lieux, fréquence, rotation et fin de vie | Restauration réelle 0.36 et compatibilité recovery conservées | Aucun planning automatique ou effacement des copies n’est prouvé ; prévoir l’anti-réapparition après restauration |
| D07 | Entités prestataires, lieux et transferts, sous-traitants, journaux et sauvegardes de l’hébergeur | Deux opérateurs confirmés sur le compte commun : Jess et son partenaire ; hébergement Infomaniak, mail et Push identifiés fonctionnellement | Informer les invités des deux lecteurs ; vérifier les contrats/configurations précis ; ne pas promettre que toutes les données restent dans un pays donné |
| D08 | Opérateur des demandes, canal de remise, lieu protégé du suivi et durée de ses preuves | Procédure et champs minimaux de suivi prêts | Compléter dans l’espace privé d’exploitation ; aucun dossier client dans Git/CI |

**Lecture du point D03 :** les données concernant la vie sexuelle font partie des catégories particulières. Il faut identifier une base de l’article 6 et une condition de l’article 9 adaptée au traitement envisagé. Le consentement explicite est une possibilité à examiner, pas une qualification déjà retenue pour JessieMessage. Sources : [RGPD, articles 6 à 9](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2), [définition CNIL](https://www.cnil.fr/fr/definition/donnee-sensible), consultés le 17 octobre 2026. Aucune nouvelle formalité ou intégration de prestataire n’est activée par ce dossier.

La notice devra fournir une information accessible sur le responsable, les finalités, destinataires, conservation et droits. Les champs manquants sont rassemblés ici pour éviter des mentions inventées. Référence : [CNIL — information et transparence](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence), consultée le 17 octobre 2026.

## Ordre de livraison restant

1. Compléter D01–D08 dans la configuration/documentation privée ; faire concorder les textes FR/EN avec les choix réels et l’état du code. La lecture ou l’acceptation d’une notice ne remplace pas une éventuelle action de consentement distincte.
2. Préparer l’intégration de la notice définitive depuis l’aide et les points de collecte. Garder les règles de liens fermés et de nettoyage d’URL du lot 0.40 ; ne transporter aucun jeton ni brouillon vers la notice.
3. Si les décisions autorisent un effacement : concevoir son journal durable, les arrêts de producteurs, la révocation ciblée, le traitement des files et références partagées, les médias et la reprise après erreur. Tester sur copies synthétiques avant toute opération réelle. Un simple ordre de tables ne suffit pas.
4. Compléter le suivi d’exploitation en réutilisant `server/operations/`, puis préparer la recette du CRM ; activer les diffusions seulement avec leur consentement propre. Aucune activation dans ce lot.

## Vérifications et limites

La relecture cible `server/data/`, les suppressions ponctuelles chat/médias, les quatre nettoyages SQL existants, les cookies, `sessionStorage` et le service worker. Elle n’accède à aucune base, compte, sauvegarde ou configuration privée hébergée. Elle ne constitue pas un nouvel audit global du produit.

Le contrôle documentaire doit comparer les 29 noms et leurs portées au catalogue et aux migrations, puis vérifier les liens locaux ajoutés. Les tests existants de données doivent préserver l’export borné, la lecture seule et l’impossibilité d’exécuter la simulation. Les résultats réellement obtenus sont consignés après vérification ; les chiffres du lot 0.40 ne sont pas attribués à cette branche.

**Résultats locaux de cette préparation, Node.js 24.19.0 :** `npm ci --ignore-scripts` réussit ; `npm test` compte **2 058 réussites, 143 intégrations ignorées, zéro échec sur 2 201 cas**. `npm run build`, qui inclut `npm run check`, réussit. Le contrôle documentaire compare exactement les 29 noms/portées aux sources et aux trente migrations, vérifie douze liens locaux dans les quatre nouveaux documents et reconstruit une simulation synthétique : 22 candidats toujours bloqués, 23 observations, 38 relations distinctes, `executable: false`. Les intégrations ignorées ne sont pas présentées comme exécutées ; aucune base hébergée ni aucun appareil réel n’a été utilisé.

Le runtime hébergé, le schéma, les sessions de 180 jours, les clés, les domaines et les notifications ne sont pas modifiés par cette préparation. Aucune demande de données réelle n’est traitée et aucun courrier n’est envoyé.
