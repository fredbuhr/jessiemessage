# Reprise et livraison de JessieMessage

Lire d'abord `docs/REPRISE.md`, puis `docs/PLAN-IMPLEMENTATION.md`. Le premier donne l'état courant unique ; les documents versionnés et `docs/REPRISE-HISTORIQUE-20261019.md` conservent les faits datés, pas les commandes courantes.

## Avant de poursuivre

- Relever la branche, le commit, l'arbre et les modifications locales. Vérifier dans GitHub le statut réel de la PR et la CI du commit concerné ; une réponse perdue ne prouve ni échec ni succès.
- Avant de relancer une opération distante interrompue, lire son résultat durable : PR/merge, run CI, paramètres persistés, processus, journal ou reçu. Reprendre depuis cet état ; ne pas répéter l'action pour découvrir ce qu'elle a fait.
- Distinguer explicitement **codé**, **fusionné**, **déployé**, **vérifié** et **en attente du PC**. Un état absent, inconnu, ancien ou un test ignoré n'est pas un succès.
- Conserver les choix acquis : Jessie en France, conversations jusqu'à fermeture définitive ; copies PC et mails déjà acceptés. Ne pas relancer un audit complet, un test de mail ou un questionnaire général à chaque reprise.

## Portée V1 choisie : mutualisé et récupération manuelle

- Appliquer **KISS à tout le développement** : réutiliser le parcours existant le plus simple qui répond au besoin, limiter les changements au résultat utile du lot et éviter nouvelles abstractions, infrastructures ou garanties non demandées.
- La demande actuelle est une messagerie privée sur le mutualisé existant, **sans infrastructure ni budget ajoutés**. Ne pas réintroduire VPS, migration ou décision de budget comme prochaine action depuis un ancien document.
- Priorité durable demandée par l’utilisateur le 20 octobre à **15:12** : avancer sur le **cœur de la messagerie**. Sauvegardes et PC sont différés et ne conditionnent pas les lots messages. Ne pas les rouvrir comme préalable ; préserver intégralement gardes, clés, journaux, marqueurs, autorité, D1 et artefact PC, sans fausse qualification ni action PC demandée.
- Conserver les copies chiffrées PC fonctionnelles ; le secours Infomaniak sur sept jours ne garantit pas une capture simultanée fichiers/base. La V1 prévoit fermeture locale journalisée, restauration applicative manuelle en maintenance et contrôle des comptes fermés avant publication. S2a et S2b en fournissent le code et le parcours opérateur avec publication explicitement vérifiée ; ne pas ouvrir un nouveau sous-lot de sauvegarde comme préalable à S3.
- La garantie de récupération autonome après perte complète de l'hôte, le témoin frais à chaque phase, la succession de propriétaire et l'inventaire SQL exhaustif ne sont plus des prérequis de cette V1. Ne pas rouvrir ces chantiers pour bloquer sa livraison, ni prétendre conserver leurs garanties.
- Ce choix change la portée produit, **pas les preuves des anciens mécanismes**. Leurs gardes restent stricts tant qu'une nouvelle composition explicite n'est pas codée et testée ; ne jamais déclarer un contrôle vérifié par suppression du refus, requalification du scheduler `OFF`, effacement de marqueur ou réinitialisation d'état. Préserver C1–C5, les fichiers d'autorité et le PC existants.

## Préserver les états existants

- La genèse et la permission du témoin existent déjà. Ne jamais rejouer `plan-witness`, `prepare-witness` ou `prepare-witness-enrollment` sur le service courant, ni supprimer/déplacer un état pour faire passer un contrôle.
- Ne pas réapparier le PC, exporter/régénérer la clé privée ou supprimer sa configuration DPAPI, ses marqueurs ou son dossier `temoin`. Après une initialisation incertaine, inspecter les états PC et serveur avant toute action.
- Service déployé/vérifié : **0.85.0**, runtime `de335f6cfce6e362a5595f2418ed142b44376fe2`, arbre `0026c652e9cdf29cef6771b81cbd39da0b46fb7b`, `start-local-closures`, port 3000 direct, `linux-dirfd`, repli immédiat 0.84. Pins/commandes/preuves dans REPRISE. A01 fournisseur 24.15.0, A07 Avast et A08 exécuteur restent ouverts/différés ; aucune action PC ni chantier sauvegarde comme préalable.
- **Lot 0.85 terminé**, PR #107, livré/vérifié le 20 octobre à **13:43:44.068382 UTC / 15:43:44 Europe/Paris** : confirmation du même envoi après perte de réponse HTTP, brouillon correspondant nettoyé et Réessayer arrêté, nouveau texte préservé. CI candidat/main 5/5, local 46/46 ; quatre variantes Chrome natives client/admin × texte/photo, général 3 101 réussites/35 wrappers ignorés, SQL 466 par MariaDB, Chrome 164, HTTPS/SQL 2 ; vingt HTTPS conformes, dix empreintes/une identité PC préservées, moniteur OK. Bilan `docs/chat-send-ack-085.md`. Aucun GET privé authentifié de production ni état PC qualifié, aucun nouveau chantier après ce lot.

- `recette.jessiemessage.com` partage le runtime et la base du site principal : ce n'est pas une cible isolée pour restaurer ou détruire des données.

## Un objectif terminé à la fois

- Choisir un seul objectif borné et son critère de fin avant d'agir. Il peut inclure code, tests, CI, fusion et déploiement du même correctif si nécessaire pour le terminer. Après ce résultat, mettre à jour le point de reprise et livrer le bilan ; ne pas ouvrir un nouveau lot fonctionnel avant clôture.
- Enregistrer après chaque opération distante le commit/arbre, les liens PR/CI, l'état observé, l'heure, la prochaine action exacte et les limites. Les preuves vont dans les dossiers existants ; aucun secret ni contenu client dans Git.
- Mettre à jour `docs/REPRISE.md` en remplaçant l'état courant, sans empiler d'anciens présents. Relier les preuves datées et tenir `docs/PLAN-IMPLEMENTATION.md` à jour.
- S1/S2/S3 restent clos depuis 0.79. Le plan explicite des corrections de l’audit du 20 octobre comporte quatre lots puis une clôture ; les lots 1/2/3/4 serveur sont livrés en 0.80/0.81/0.82/0.83 ; plan correctif clos 5/5 avec réserves, sans nouveau lot automatique ; incident A07 différé par l’utilisateur sans bloquer le développement, rotation active A08 et A01 restent distincts et ouverts. 0.85 est livrée ; garder la priorité durable au cœur messagerie, sans réouverture des garanties historiques ni nouveau chantier automatique. Annoncer le lot réellement en cours. L’ancien « étape 4/6 » est historique ; ne jamais annoncer « 6/6 » comme validation des anciennes garanties.
- Dire à quelle étape le travail commence et se termine. Ne pas prétendre empêcher ou diagnostiquer les coupures ChatGPT sans trace correspondante ; organiser une reprise sans répétition ni état ambigu.
- L'utilisateur a déjà autorisé le développement, les corrections, fusions et déploiements du projet. Ne pas redemander une permission générale ; respecter les préconditions techniques et les actions personnelles nécessaires sur son PC. Cette autorisation ne demande aucun envoi réel ni effacement de compte réel.
