# JessieMessage — bilan et chemin vers le pilote

Document de travail public, mis à jour le 15 octobre 2026. Aucune donnée de client, photographie personnelle ni configuration de production.

## État de référence

Dépôt : [fredbuhr/jessiemessage](https://github.com/fredbuhr/jessiemessage). Domaine cible : `jessiemessage.com`. Hébergement envisagé : site Node.js 24 et MariaDB dédiée chez Infomaniak ; capacités et configuration réelles à confirmer.

Branche courante : `feat/client-recovery`, construite sur `feat/private-crm`, puis `feat/private-media`. Les modifications restent empilées, sans fusion ni déploiement automatique : [#1 identité](https://github.com/fredbuhr/jessiemessage/pull/1), [#2 MariaDB](https://github.com/fredbuhr/jessiemessage/pull/2), [#3 authentification](https://github.com/fredbuhr/jessiemessage/pull/3), [#4 accès](https://github.com/fredbuhr/jessiemessage/pull/4), [#5 messagerie](https://github.com/fredbuhr/jessiemessage/pull/5), [#6 médias](https://github.com/fredbuhr/jessiemessage/pull/6). Le lot CRM est disponible dans la [PR brouillon #7](https://github.com/fredbuhr/jessiemessage/pull/7). Le lot récupération client prépare une huitième PR brouillon.

L'identité Nuit approuvée conserve les fichiers exacts de la silhouette dorée sur bleu nuit. Les portraits personnels restent hors Git et des artefacts publics. Le prototype autonome 0.3.1 contient des données fictives ; il ne démontre pas le fonctionnement des comptes réels.

## Ce qui est implémenté

| Domaine | Comportement disponible dans le code | Limite avant utilisation réelle |
| --- | --- | --- |
| Accès administrateur | Mot de passe, MFA, codes de secours, sessions révocables, récupération privée | Initialisation du vrai compte et conservation des clés à organiser |
| Accès client | Invitation unique, inscription atomique, vérification e-mail en file chiffrée, approbation et expiration | SMTP réel et fournisseur de majorité à intégrer |
| Messagerie 1:1 | Persistance chiffrée, isolation par conversation, pagination, reprise sans doublon, lecture, suppression par auteur | Recette HTTPS, charge et appareils réels à vérifier |
| Photos privées | JPEG/PNG/WebP normalisés sans métadonnées, stockage chiffré, lectures autorisées, galerie et médiathèque propriétaire | Hébergement natif, ressources, sauvegarde et nettoyage des orphelins à valider |
| Outils clients 0.8 | Surnoms et notes privées, tags/groupes, dates de suivi, recherche et filtres ; conflits entre onglets | CI MariaDB vérifiée ; recette de l'interface à réaliser |
| Récupération client 0.9 | Lien e-mail unique de 30 minutes, changement atomique, anciens liens et sessions révoqués | CI du lot en attente ; SMTP et recette HTTPS à valider |
| Présentation | Identité Nuit, icônes approuvées, aperçu autonome fictif | Contrôles navigateur, accessibilité et responsive réels à terminer |

Les outils clients restent réservés à l'administrateur affecté. Les notes sont chiffrées ; les listes n'incluent ni notes ni adresse e-mail. Les dates de suivi ne déclenchent aucune notification. Les groupes sont des classements privés, pas des salons.

## Ce qui est vérifié, ce qui ne l'est pas

- Médias 0.7 : révision finale `189d742a7e6d93936f159d14c318d3a62d85c91f`, [CI 38651204840](https://github.com/fredbuhr/jessiemessage/actions/runs/38651204840) réussie : 320 tests généraux, 10 groupes DB ignorés dans le job sans base, puis 126 tests réels sans saut sur **chacune** des versions MariaDB 10.11 et 11.4. Sharp 0.35.5 est verrouillé ; aucune vulnérabilité npm signalée lors de ce lot.
- CRM 0.8 : 402 tests généraux réussis et 159 tests réels sans saut sur chacune des deux versions MariaDB ; détail et révision ci-dessous. Les 12 groupes DB sont explicitement ignorés uniquement dans le job général sans base.
- Les intégrations HTTP/SQL emploient exclusivement des fixtures synthétiques et des bases jetables, avec un compte d'exécution limité aux opérations DML.
- Aucune livraison SMTP réelle, preuve de majorité externe, migration de base Infomaniak, création de compte réel ou mise en production n'a été effectuée.
- Aucune nouvelle recette navigateur n'a été exécutée : aucun moteur installé ; un téléchargement antérieur a été refusé par le contrôle automatique d'autorisation. Les tests de modèle et de protocole ne remplacent pas les essais sur iPhone/Android.

## Risques et travail manquant

Les fonctions du prototype de diffusion et de Push restent fictives. Le serveur ne fournit pas encore de diffusion durable ni de notifications Web Push. Le parcours de mot de passe oublié est implémenté en 0.9, derrière un drapeau explicite ; sa validation SQL complète est en cours. Les textes légaux, la rétention, les exports, les sauvegardes et leur restauration doivent être finalisés avec les informations réelles. La récupération/rotation des clés n'est pas automatisée. La file d'e-mails de récupération possède un nettoyage borné des anciens jobs ; les lignes de jetons expirés attendent encore une politique de purge. Les fichiers photo pouvant rester après un résultat SQL incertain sont conservés par prudence ; aucun nettoyage automatique n'est encore implémenté.

Les exigences d'accès des majeurs et les conditions d'hébergement doivent être résolues avant ouverture de contenus concernés. Une déclaration « 18+ » ne constitue pas une preuve. Aucun chemin actuel ne transforme cette déclaration en vérification.

## Plan de livraison réaliste

Les durées ci-dessous sont des ordres de grandeur de travail, à recalibrer après chaque lot ; les accès externes peuvent allonger le calendrier. On peut avancer le code sans attendre ces accès.

| Étape | Résultat concret et critère de sortie | Ordre de grandeur |
| --- | --- | --- |
| 1. Terminer le CRM | CI verte sur Node 24 et les deux MariaDB ; conflits et confidentialité vérifiés ; PR brouillon documentée | Terminé pour ce lot de code |
| 2. Débloquer le parcours pilote | Récupération client implémentée en 0.9 ; terminer sa CI, tester SMTP sur domaine réel et intégrer la majorité | Délais des accès et du fournisseur, puis recette |
| 3. Diffusion individuelle | Sélection explicite des destinataires, préférences, exclusion des accès inactifs, reprise sans doublon et journal durable | 2 à 3 jours |
| 4. Recette privée sous HTTPS | Environnement de test isolé ; parcours invitation → accès → texte/photo → révocation sur iPhone/Android ; corrections de l'interface | 1 à 2 jours après accès à l'hébergement |
| 5. Exploitation et publication | Sauvegarde/restauration éprouvée, rétention et nettoyage, limites de charge, pages légales ; revue puis fusion ordonnée des PR | 2 à 3 jours, avec validations externes |
| 6. PWA et notifications | Installation vérifiée ; Push volontaire discret, désinscription et révocation ; compatibilité appareils | 1 à 2 jours, peut suivre le pilote si non indispensable |

Pour publier rapidement, le pilote peut viser d'abord les conversations privées texte/photo et les fiches clients, avec un nombre limité de comptes. La diffusion et le Push peuvent arriver ensuite si le périmètre du pilote le permet. Les prérequis d'accès et la restauration restent nécessaires dans tous les cas.

Le déploiement sera préparé comme une opération explicite : sauvegarde, état des migrations, revue des paramètres, test de santé, parcours complet, possibilité de retour à la version précédente et observation. Aucun changement de ZTIKIX ni publication automatique depuis une branche de travail.

## Preuve finale du lot CRM

Implémentation `9e399e6dd5589d21597fb35b0a3fe6d2d2856ee0`, [PR brouillon #7](https://github.com/fredbuhr/jessiemessage/pull/7) : [CI 38653885864](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864) réussie sous Node.js 24.21.0. **402 tests généraux réussis**, 12 groupes DB explicitement ignorés dans ce job sans base ; **159 tests réels réussis sans saut sur chacune des versions MariaDB 10.11 et 11.4**. Douze groupes séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 13, file e-mail 11, HTTP accès 9, persistance chat 19, HTTP chat 12, persistance médias 16, HTTP médias 10, persistance CRM 19 et HTTP CRM 14. Syntaxe et build réussis ; aucune nouvelle dépendance ou modification des icônes approuvées.

Les tests vérifient notamment l'autorisation SQL actuelle, les conflits entre onglets, les notes chiffrées, la suppression d'étiquette sans perte des notes et l'absence de CRM dans les réponses client. La revue des réponses tardives corrige aussi fermeture/réouverture de fiche, ordre des listes d'étiquettes et changement d'affectation. Aucune recette visuelle, SMTP réel ou mise en production. Voir [périmètre, configuration et limites du CRM](private-crm.md).

## Lot récupération client 0.9

Le formulaire « Mot de passe oublié ? » demande un lien sans révéler si un compte existe. Seuls les clients actifs ou en attente avec e-mail déjà vérifié peuvent recevoir un lien ; un accès expiré reste récupérable sans être renouvelé. Les comptes administrateur, suspendus, révoqués ou supprimés restent exclus. Un nouveau lien remplace le précédent sans déconnecter le client.

La validation explicite du nouveau mot de passe consomme le lien une seule fois, incrémente la version des identifiants et révoque toutes les anciennes sessions dans la même transaction. Elle ne crée aucune session et ne change ni l'e-mail ni les preuves de majorité/approbation ni la durée d'accès. Le jeton reste dans le fragment du lien puis en mémoire ; aucun paramètre URL de récupération n'est accepté par le serveur.

Deux migrations portent le schéma à 22. Les mails de récupération emploient la même configuration SMTP et la même clé de file, mais une finalité cryptographique et des tables distinctes de la vérification d'e-mail. Le transport partagé est fermé après les deux workers. La validation SMTP demeure au moins une fois : une révocation après la réservation d'un mail peut laisser partir un lien devenu inutilisable.

CI et preuve finale de cette révision en attente. Voir [configuration, comportement et limites de la récupération](client-recovery.md). Aucune livraison SMTP réelle, recette visuelle ou mise en production.
