# Reprise et livraison de JessieMessage

Lire d'abord `docs/REPRISE.md`, puis `docs/PLAN-IMPLEMENTATION.md`. Le premier donne l'état courant unique ; les documents versionnés et `docs/REPRISE-HISTORIQUE-20261019.md` conservent les faits datés, pas les commandes courantes.

## Avant de poursuivre

- Relever la branche, le commit, l'arbre et les modifications locales. Vérifier dans GitHub le statut réel de la PR et la CI du commit concerné ; une réponse perdue ne prouve ni échec ni succès.
- Avant de relancer une opération distante interrompue, lire son résultat durable : PR/merge, run CI, paramètres persistés, processus, journal ou reçu. Reprendre depuis cet état ; ne pas répéter l'action pour découvrir ce qu'elle a fait.
- Distinguer explicitement **codé**, **fusionné**, **déployé**, **vérifié** et **en attente du PC**. Un état absent, inconnu, ancien ou un test ignoré n'est pas un succès.
- Conserver les choix acquis : Jessie en France, conversations jusqu'à fermeture définitive ; copies PC et mails déjà acceptés. Ne pas relancer un audit complet, un test de mail ou un questionnaire général à chaque reprise.

## Portée V1 choisie : mutualisé et récupération manuelle

- La demande actuelle est une messagerie privée sur le mutualisé existant, **sans infrastructure ni budget ajoutés**. Ne pas réintroduire VPS, migration ou décision de budget comme prochaine action depuis un ancien document.
- Conserver les copies chiffrées PC fonctionnelles ; le secours Infomaniak sur sept jours ne garantit pas une capture simultanée fichiers/base. La V1 prévoit une restauration applicative manuelle en maintenance et un contrôle des comptes fermés avant publication, avec fermeture locale journalisée à composer et vérifier.
- La garantie de récupération autonome après perte complète de l'hôte, le témoin frais à chaque phase, la succession de propriétaire et l'inventaire SQL exhaustif ne sont plus des prérequis de cette V1. Ne pas rouvrir ces chantiers pour bloquer sa livraison, ni prétendre conserver leurs garanties.
- Ce choix change la portée produit, **pas les preuves des anciens mécanismes**. Leurs gardes restent stricts tant qu'une nouvelle composition explicite n'est pas codée et testée ; ne jamais déclarer un contrôle vérifié par suppression du refus, requalification du scheduler `OFF`, effacement de marqueur ou réinitialisation d'état. Préserver C1–C5, les fichiers d'autorité et le PC existants.

## Préserver les états existants

- La genèse et la permission du témoin existent déjà. Ne jamais rejouer `plan-witness`, `prepare-witness` ou `prepare-witness-enrollment` sur le service courant, ni supprimer/déplacer un état pour faire passer un contrôle.
- Ne pas réapparier le PC, exporter/régénérer la clé privée ou supprimer sa configuration DPAPI, ses marqueurs ou son dossier `temoin`. Après une initialisation incertaine, inspecter les états PC et serveur avant toute action.
- Le service reste en observation avec `closuresEnabled:false`. Une copie chiffrée reçue ne prouve ni déchiffrement, ni témoin externe, ni restauration. Aucune fermeture réelle avant les préalables du plan.
- `recette.jessiemessage.com` partage le runtime et la base du site principal : ce n'est pas une cible isolée pour restaurer ou détruire des données.

## Un objectif terminé à la fois

- Choisir un seul objectif borné et son critère de fin avant d'agir. Il peut inclure code, tests, CI, fusion et déploiement du même correctif si nécessaire pour le terminer. Après ce résultat, mettre à jour le point de reprise et livrer le bilan ; ne pas ouvrir un nouveau lot fonctionnel avant clôture.
- Enregistrer après chaque opération distante le commit/arbre, les liens PR/CI, l'état observé, l'heure, la prochaine action exacte et les limites. Les preuves vont dans les dossiers existants ; aucun secret ni contenu client dans Git.
- Mettre à jour `docs/REPRISE.md` en remplaçant l'état courant, sans empiler d'anciens présents. Relier les preuves datées et tenir `docs/PLAN-IMPLEMENTATION.md` à jour.
- Dire à quelle étape le travail commence et se termine. Ne pas prétendre empêcher ou diagnostiquer les coupures ChatGPT sans trace correspondante ; organiser une reprise sans répétition ni état ambigu.
- L'utilisateur a déjà autorisé le développement, les corrections, fusions et déploiements du projet. Ne pas redemander une permission générale ; respecter les préconditions techniques et les actions personnelles nécessaires sur son PC. Cette autorisation ne demande aucun envoi réel ni effacement de compte réel.
