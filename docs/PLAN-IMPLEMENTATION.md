# Plan d'implémentation de JessieMessage

**20 octobre 2026 — livraison V1 terminée. Version technique 0.79.0 déployée et vérifiée.** La messagerie reste sur le mutualisé actuel, sans nouveau serveur ni abonnement. KISS permanent. Lire l'[état courant](REPRISE.md) et les [preuves finales](verification-proofs/jm079-verification.json).

Ce plan S1/S2/S3 remplace l'ancien découpage en six lots. Le compteur « 4/6 » conservé dans les précédents en-têtes était obsolète ; il n'indique pas deux lots actuels oubliés. Les anciennes exigences de cadence externe fiable, d'alerte de panne totale et de recette sur deux appareils habituels ne sont pas déclarées acquises : leur portée réelle reste dans les limites en fin de document.

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

**Suite : usage normal de la V1 privée et correction des incidents concrets.** Aucun nouveau sous-lot de sauvegarde, étude VPS, budget, questionnaire, test de mail ou initialisation PC. Préserver PC, clés, autorité et quarantaine D1.
