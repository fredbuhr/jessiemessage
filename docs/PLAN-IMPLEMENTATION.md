# Plan d'implémentation de JessieMessage

**20 octobre 2026 — phase courante : lot 1 des corrections, candidat 0.80.0 codé en qualification.** La V1 technique 0.79.0 reste déployée et vérifiée ; aucun correctif de cet audit n’est encore déployé. La messagerie reste sur le mutualisé actuel, sans nouveau serveur ni abonnement. KISS permanent. Lire l'[état courant](REPRISE.md), le [lot 1](audit-corrections-080.md), l'[audit](AUDIT-CODE-2026-10-20.md) et les [preuves de livraison 0.79](verification-proofs/jm079-verification.json).

Ce plan S1/S2/S3 remplace l'ancien découpage en six lots. Le compteur « 4/6 » conservé dans les précédents en-têtes était obsolète ; il n'indique pas deux lots actuels oubliés. Les anciennes exigences de cadence externe fiable, d'alerte de panne totale et de recette sur deux appareils habituels ne sont pas déclarées acquises : leur portée réelle reste dans les limites en fin de document.

## Plan proposé des corrections — 20 octobre

**Quatre lots correctifs, puis une clôture de livraison. Lot 1 codé en qualification ; les suivants restent à faire.** Ce découpage traite les constats de l’audit ; il n’ajoute aucune fonction produit et ne rouvre pas la livraison S1/S2/S3. Un lot peut demander plusieurs échanges ou PR : ce n’est pas une promesse de cinq messages ni une nouvelle échéance de production.

| Ordre | Périmètre | Résultat attendu et critère de fin |
| --- | --- | --- |
| **1 — Sécurité et échéances** | A02–A04, A11 ; A01 en parallèle indépendant | Un réseau refusé ne consomme plus le budget utile aux autres, avec travail SQL/cardinalité toujours bornés. Les échéances sont revérifiées après les verrous pertinents. HSTS est défini sur HTTPS avec portée maîtrisée. Chaque défaut a sa régression. Une version Node 24 corrigée disponible chez Infomaniak est qualifiée puis appliquée séparément ; une indisponibilité côté hébergeur reste explicitement en attente sans bloquer les corrections applicatives. |
| **2 — Fiabilité des copies existantes** | A05, A07 ; préparation proportionnée A08 | Volume applicatif et volume sauvegardable cohérents sur toute la chaîne ; les nouveautés sont atteintes malgré un gros historique. Tests synthétiques aux limites et de progression sur plusieurs passages. Pour A08 : relever le nombre actuel de reçus, ajouter l’avertissement et préparer la procédure de rotation/archivage ; une mise en œuvre plus large reste distincte et ne bloque pas A05/A07 si le seuil est lointain. |
| **3 — Restauration et arrêt du service** | A06, A09, A10 | Une copie média partielle peut être reprise ou abandonnée explicitement vers une nouvelle cible isolée, sans écraser de fichier divergent. Un arrêt forcé remonte comme échec. Une FK vers une autre base est refusée. Régressions ciblées et qualification native du parcours modifié, sur données synthétiques uniquement. |
| **4 — Interface et entretien KISS** | C01, C02 ; documentation et petits résidus | Reproduire les deux candidats dans Chrome avec scénarios contrôlés ; corriger les comportements confirmés et conserver les non-reproduits comme tels. Rendre README/PRODUCT/DESIGN-KISS cohérents avec REPRISE. Retirer éventuellement l’export sans consommateur applicatif après vérification du contrat ; extraire seulement les petites duplications utiles à une correction. |
| **5 — Clôture de livraison** | Ensemble des corrections livrées | Dernier code épinglé, CI requise verte, déploiements vérifiés et repli documenté. Contrôler connexion, texte/photo, notification vers le message, export et état des copies dans les environnements adaptés. Bilan par constat : corrigé et vérifié, non reproduit, ou restant avec raison exacte. |

### Choix bornés à résoudre pendant l’implémentation

- **Node :** vérifier les versions réellement proposées et qualifier une version 24 corrigée. Aucune installation improvisée d’un runtime parallèle ni migration d’hébergement. Si le binaire disponible ne suffit pas, documenter la dépendance plutôt que déclarer A01 corrigé.
- **Volumes :** mesurer d’abord l’usage actuel en lecture seule. Retenir le plafond le plus simple compatible avec médias chiffrés, SQL, compression/GPG, transfert PC et espace disponible ; ne pas relever isolément le plafond de capture ni abaisser un quota sous les données existantes.
- **Historique :** A08 est un risque de durée de vie, autour de mille tentatives normales au premier seuil, pas une urgence actuelle démontrée. Commencer par la mesure, l’avertissement et une procédure de rotation à qualifier sur données synthétiques, préservant les registres de fermeture de toutes les archives encore restaurables. Aucune purge automatique, aucune durée arbitraire de conservation des conversations. Une simple alerte ne suffit pas à déclarer la rotation résolue : la partie restant différée demeure explicitement ouverte avec un seuil d’intervention.
- **PC :** conserver le raccordement, la clé et les copies. Si A07 modifie le script installé, livrer le kit de mise à jour du PC existant ; seul ce déploiement et un contrôle ciblé peuvent nécessiter l’action du propriétaire. Aucun nouvel appariement ni répétition générale du déchiffrement déjà accepté.
- **Nettoyage :** les refactors de crypto mail et de mécanismes historiques sont facultatifs ; leur réalisation n’est pas un critère de clôture des bugs. Garder les archives documentaires clairement datées et le point de reprise unique.

### Méthode de livraison pour chaque lot

Un objectif borné, correctif minimal, régressions liées au comportement, revue du diff, CI requise puis déploiement épinglé avec repli. Vérifications SQL sur MariaDB 10.11/11.4 et Chrome selon les chemins modifiés ; un test ignoré n’est pas compté comme une validation. Ne pas relancer sans motif des suites déjà vertes sur le même code lors du lot 5 : consolider les preuves et compléter seulement les parcours ou changements encore non couverts.

Les déploiements suivent les lots terminés ; le lot 5 ne retarde pas tous les correctifs jusqu’à une livraison géante. Aucune nouvelle recette de compte réel, campagne envoyée aux clients, suppression réelle ou restauration en production. `recette.jessiemessage.com` partage la base du principal : les essais destructifs exigent une cible synthétique réellement isolée, distincte de D1 préservé.

A09 est indépendant des autres corrections de reprise et peut être livré plus tôt comme petit correctif autonome. A05 précède la qualification finale d’A07 si le volume ou le protocole de transfert change. Les tâches d’entretien et le traitement de durée de vie lointain ne retardent pas les corrections de fonctionnement courant.

**Lot 1 en cours : qualification du candidat 0.80.0 avant livraison.** A01 reste ouvert : Manager limité au choix de branche, 24 déjà sélectionnée, binaire fourni toujours 24.15.0 ; cela ne bloque pas A02–A04/A11. L’audit reste la preuve datée des constats, et REPRISE décrit l’état courant.

## Portée V1

Messagerie privée sur invitation, texte/photos, sessions indépendantes, CRM, export, notifications, copies chiffrées PC existantes et restauration applicative manuelle en maintenance. Conversations jusqu'à fermeture définitive, hors suppressions volontaires. Les moteurs et états historiques sont conservés ; aucun refus n'est transformé en succès par effacement de marqueur ou fausse qualification SQL.

Récupération autonome après perte complète de l'hôte, témoin frais par phase, succession de propriétaire et inventaire SQL exhaustif sont hors prérequis de cette V1. Cela ne prétend pas fournir leurs garanties. L'[ancien plan](https://github.com/fredbuhr/jessiemessage/blob/6ef81692e01220cd3fd1d41a38c1b1d87568984d/docs/PLAN-IMPLEMENTATION.md) conserve ce périmètre historique.

## S1 — Fonctionnement quotidien et administration — clos

Démarrage simple sans observateur indépendant, administration des copies clarifiée, capture quotidienne et alertes existantes conservées. Aucun nouveau raccordement ni manipulation de clé. Livré en 0.76, conservé dans 0.79. [Preuves S1](verification-proofs/jm076-verification.json).

## S2a/S2b — Fermeture locale et restauration manuelle — clos

Fermeture locale journalisée et reprenable sous le verrou existant, vrai drainage de l'enfant et des producteurs, absence du compte vérifiée avant réouverture. Sans confirmation PC par phase. Le registre minimal doit couvrir les archives encore restaurables.

L'outil unique `manual-restore.mjs check | restore | open` réutilise import SQL natif, médias séparés, cible neuve et isolée, quarantaine, registre récent sélectionné par l'opérateur, réconciliation des comptes fermés, révocation des sessions et publication explicite après vérifications fraîches. Perte d'accusé ou de reçu : drain et maintien/rétablissement du hold, sans adoption aveugle.

Moteurs inclus dans le déploiement 0.79 ; activation locale constatée par composition et démarrage réel. Le parcours opérateur est qualifié sur données synthétiques en CI native ; aucune restauration de production revendiquée. Couverture applicative de trente tables/médias/six clés, `completeDatabase:false`, objets exécutables exclus. D1 et son marqueur restent intacts. [Composition](local-closures-manual-077.md), [guide opérateur](manual-restore-operator-078.md), [preuves S2a](verification-proofs/jm077-verification.json), [preuves S2b](verification-proofs/jm078-verification.json).

## S3 — Parcours utiles et recette — clos

Trois sessions Chrome indépendantes avec vrai HTTPS, MariaDB et médias : deux connexions du même client, texte/photo, brouillon, notification vers le message exact, déconnexion d'un seul appareil et reconnexion. Les conflits de fiches, réponses rapides et exports gardent leurs tests existants séparés. Aucune diffusion réelle de test demandée ni envoyée. La page Confidentialité affiche la capacité réellement activée, en français et anglais.

[PR #101](https://github.com/fredbuhr/jessiemessage/pull/101), source `2342f749d59222104a3d6458c2617aa9f63ba69c`, merge `bc6103a73ce63752eda27a0bce83a7e53e409d09`, arbre identique. Cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39341320771) et cinq [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39342025957) réussis : 2 996 tests généraux réussis / 35 wrappers SQL ignorés / zéro échec ; **436/436 sur chaque MariaDB sans omission**, Chrome 160, recettes HTTPS 2, syntaxe 558, aperçu construit. [Compte rendu](messaging-acceptance-079.md).

[Guide court](guide-jessie.md), [conservation](data-retention-register.md) et [surveillance](../MONITORING.md) livrés. Aucun nouveau test personnel n'est requis pour clore le lot : les acceptations antérieures restent acquises dans leur portée.

## Déploiement final — clos

**0.79.0 en ligne**, mode `start-local-closures`, port 3000 direct, sans passerelle ni observateur. Préflight en lecture seule réussi, Build normal du Manager affiché **20 octobre 01:41 Europe/Paris**, dépendances réutilisées après comparaison du lockfile, aucune migration.

À **01:45:34 Europe/Paris** : source/lanceur et dix fichiers sensibles vérifiés, vrai enfant/superviseur démarrés, moniteur OK, quatre contrôles HTTPS santé/disponibilité réussis sur deux origines, trois API privées protégées. Fermetures activées par la composition réelle ; GET administrateur authentifié non observé, aucun compte réel effacé pour valider. Repli 0.76 conservé. [Preuves et pins](REPRISE.md).

## Limites déclarées et suite

Trois navigateurs ne prouvent pas toutes les plateformes physiques ni l'arrière-plan système/PWA. Le moniteur externe présente des intervalles réels de plusieurs heures ; aucune réception d'alerte externe ni durée maximale de détection attestée. Aucune rotation automatique des archives ou durée générale de trente jours ajoutée. Pas de promesse de vingt-quatre heures de perte maximale : une copie PC peut être plus ancienne et les messages postérieurs à la capture choisie peuvent être perdus.

## Audit explicite du 20 octobre — terminé

L’[audit transversal du code](AUDIT-CODE-2026-10-20.md), demandé par le propriétaire après livraison, est terminé sur `f629137` ; [preuves](verification-proofs/jm079-audit-20261020.json). Les constats distinguent défauts reproduits, conditions non observées, durcissements et deux candidats navigateur. Aucun correctif applicatif ou changement de production dans ce lot. La clôture de S1/S2/S3 et leurs limites restent inchangées.

**Suite : corrections bornées de l’audit, d’abord A01–A04** : runtime Node corrigé sur l’hébergement actuel, budgets publics et échéances après attente SQL ; puis fiabilité des copies et reprise existantes. Les critères et régressions attendus figurent dans le rapport. Aucun nouveau sous-lot d’architecture de sauvegarde, étude VPS, budget, questionnaire, test de mail ou initialisation PC. Préserver PC, clés, autorité et quarantaine D1.
