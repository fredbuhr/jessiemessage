# JessieMessage — bilan et chemin vers le pilote

Document de travail public, mis à jour le 15 octobre 2026. Aucune donnée de client, photographie personnelle ni configuration de production.

## État de référence

Dépôt : [fredbuhr/jessiemessage](https://github.com/fredbuhr/jessiemessage). Domaine cible : `jessiemessage.com`. Hébergement envisagé : site Node.js 24 et MariaDB dédiée chez Infomaniak ; capacités et configuration réelles à confirmer.

Branche courante : `feat/private-crm`, construite sur `feat/private-media`. Les modifications restent empilées, sans fusion ni déploiement automatique : [#1 identité](https://github.com/fredbuhr/jessiemessage/pull/1), [#2 MariaDB](https://github.com/fredbuhr/jessiemessage/pull/2), [#3 authentification](https://github.com/fredbuhr/jessiemessage/pull/3), [#4 accès](https://github.com/fredbuhr/jessiemessage/pull/4), [#5 messagerie](https://github.com/fredbuhr/jessiemessage/pull/5), [#6 médias](https://github.com/fredbuhr/jessiemessage/pull/6). Le lot CRM est préparé pour une septième PR brouillon.

L'identité Nuit approuvée conserve les fichiers exacts de la silhouette dorée sur bleu nuit. Les portraits personnels restent hors Git et des artefacts publics. Le prototype autonome 0.3.1 contient des données fictives ; il ne démontre pas le fonctionnement des comptes réels.

## Ce qui est implémenté

| Domaine | Comportement disponible dans le code | Limite avant utilisation réelle |
| --- | --- | --- |
| Accès administrateur | Mot de passe, MFA, codes de secours, sessions révocables, récupération privée | Initialisation du vrai compte et conservation des clés à organiser |
| Accès client | Invitation unique, inscription atomique, vérification e-mail en file chiffrée, approbation et expiration | SMTP réel, fournisseur de majorité et récupération client à intégrer |
| Messagerie 1:1 | Persistance chiffrée, isolation par conversation, pagination, reprise sans doublon, lecture, suppression par auteur | Recette HTTPS, charge et appareils réels à vérifier |
| Photos privées | JPEG/PNG/WebP normalisés sans métadonnées, stockage chiffré, lectures autorisées, galerie et médiathèque propriétaire | Hébergement natif, ressources, sauvegarde et nettoyage des orphelins à valider |
| Outils clients 0.8 | Surnoms et notes privées, tags/groupes, dates de suivi, recherche et filtres ; conflits entre onglets | CI MariaDB du lot en attente ; recette de l'interface à réaliser |
| Présentation | Identité Nuit, icônes approuvées, aperçu autonome fictif | Contrôles navigateur, accessibilité et responsive réels à terminer |

Les outils clients restent réservés à l'administrateur affecté. Les notes sont chiffrées ; les listes n'incluent ni notes ni adresse e-mail. Les dates de suivi ne déclenchent aucune notification. Les groupes sont des classements privés, pas des salons.

## Ce qui est vérifié, ce qui ne l'est pas

- Médias 0.7 : révision finale `189d742a7e6d93936f159d14c318d3a62d85c91f`, [CI 38651204840](https://github.com/fredbuhr/jessiemessage/actions/runs/38651204840) réussie : 320 tests généraux, 10 groupes DB ignorés dans le job sans base, puis 126 tests réels sans saut sur **chacune** des versions MariaDB 10.11 et 11.4. Sharp 0.35.5 est verrouillé ; aucune vulnérabilité npm signalée lors de ce lot.
- CRM 0.8 : les contrôles locaux initiaux passent avec 399 tests généraux ; les 12 groupes DB attendent leur exécution dédiée. Le résultat final doit être lu sur la révision et la CI du lot ci-dessous.
- Les intégrations HTTP/SQL emploient exclusivement des fixtures synthétiques et des bases jetables, avec un compte d'exécution limité aux opérations DML.
- Aucune livraison SMTP réelle, preuve de majorité externe, migration de base Infomaniak, création de compte réel ou mise en production n'a été effectuée.
- Aucune nouvelle recette navigateur n'a été exécutée : aucun moteur installé ; un téléchargement antérieur a été refusé par le contrôle automatique d'autorisation. Les tests de modèle et de protocole ne remplacent pas les essais sur iPhone/Android.

## Risques et travail manquant

Les fonctions du prototype de diffusion et de Push restent fictives. Le serveur ne fournit pas encore de diffusion durable ni de notifications Web Push. Le parcours client de mot de passe oublié manque. Les textes légaux, la rétention, les exports, les sauvegardes et leur restauration doivent être finalisés avec les informations réelles. La récupération/rotation des clés n'est pas automatisée. Les fichiers photo pouvant rester après un résultat SQL incertain sont conservés par prudence ; aucun nettoyage automatique n'est encore implémenté.

Les exigences d'accès des majeurs et les conditions d'hébergement doivent être résolues avant ouverture de contenus concernés. Une déclaration « 18+ » ne constitue pas une preuve. Aucun chemin actuel ne transforme cette déclaration en vérification.

## Plan de livraison réaliste

Les durées ci-dessous sont des ordres de grandeur de travail, à recalibrer après chaque lot ; les accès externes peuvent allonger le calendrier. On peut avancer le code sans attendre ces accès.

| Étape | Résultat concret et critère de sortie | Ordre de grandeur |
| --- | --- | --- |
| 1. Terminer le CRM | CI verte sur Node 24 et les deux MariaDB ; conflits et confidentialité vérifiés ; PR brouillon documentée | Lot en cours |
| 2. Débloquer le parcours pilote | SMTP testé sur domaine réel, majorité intégrée, récupération du mot de passe client avec jetons uniques et révocation | 2 à 4 jours de code, plus délai des fournisseurs |
| 3. Diffusion individuelle | Sélection explicite des destinataires, préférences, exclusion des accès inactifs, reprise sans doublon et journal durable | 2 à 3 jours |
| 4. Recette privée sous HTTPS | Environnement de test isolé ; parcours invitation → accès → texte/photo → révocation sur iPhone/Android ; corrections de l'interface | 1 à 2 jours après accès à l'hébergement |
| 5. Exploitation et publication | Sauvegarde/restauration éprouvée, rétention et nettoyage, limites de charge, pages légales ; revue puis fusion ordonnée des PR | 2 à 3 jours, avec validations externes |
| 6. PWA et notifications | Installation vérifiée ; Push volontaire discret, désinscription et révocation ; compatibilité appareils | 1 à 2 jours, peut suivre le pilote si non indispensable |

Pour publier rapidement, le pilote peut viser d'abord les conversations privées texte/photo et les fiches clients, avec un nombre limité de comptes. La diffusion et le Push peuvent arriver ensuite si le périmètre du pilote le permet. Les prérequis d'accès et la restauration restent nécessaires dans tous les cas.

Le déploiement sera préparé comme une opération explicite : sauvegarde, état des migrations, revue des paramètres, test de santé, parcours complet, possibilité de retour à la version précédente et observation. Aucun changement de ZTIKIX ni publication automatique depuis une branche de travail.

## Preuve finale du lot CRM

À compléter après publication de la PR et exécution réelle de la CI. Voir [périmètre, configuration et limites du CRM](private-crm.md).
