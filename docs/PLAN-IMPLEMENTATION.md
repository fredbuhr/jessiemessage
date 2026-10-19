# Plan d'implémentation de JessieMessage

**19 octobre 2026 — étape 4/6.** Direction demandée : terminer la messagerie sur le mutualisé existant, sans nouveau serveur ni abonnement. La proposition VPS et l'attente d'un budget sont retirées. Lire l'[état courant](REPRISE.md) et les [solutions étudiées](mutualise-simple-20261019.md).

## Portée et acquis

V1 : messagerie privée, sauvegarde applicative chiffrée, copie PC existante et restauration manuelle accompagnée en maintenance. La récupération autonome après perte complète de l'hôte, un témoin frais à chaque phase et la succession de propriétaire sortent des prérequis. Cette décision ne prétend pas fournir les mêmes garanties.

Les anciens contrats, gardes, preuves C1–C5, clés et états PC sont conservés. Aucun refus n'est transformé en succès en supprimant un marqueur ou en inventant une qualification SQL. L'[ancien plan complet](https://github.com/fredbuhr/jessiemessage/blob/6ef81692e01220cd3fd1d41a38c1b1d87568984d/docs/PLAN-IMPLEMENTATION.md) reste l'historique de ce périmètre plus exigeant.

Acquis : service **0.76.0 déployé/vérifié**, démarrage simple sans observateur, fermetures désactivées ; copie PC et déchiffrement personnel conservés ; D1 importé/vérifié sur le mutualisé, trente tables, six clés et quatre fichiers photo chiffrés. D1 reste en quarantaine et n'est pas une restauration rouverte. [Preuves S1](verification-proofs/jm076-verification.json).

Un lot borné à la fois : code, contrôles pertinents, CI, fusion, déploiement et vérification du même résultat si nécessaire. Avant de répéter une opération interrompue, lire son résultat durable. Après chaque résultat, remplacer l'état courant dans REPRISE ; distinguer codé, fusionné, déployé et vérifié. Aucun secret ni contenu client dans Git.

## S1 — Simplifier le fonctionnement quotidien et l'administration — clos

**Réalisé en 0.76.0 :** démarrage `start` existant sans observateur indépendant, capture chiffrée/copieur/moniteur/alertes conservés. Le PC reste une destination de copie ; aucune action personnelle supplémentaire n'a été demandée.

- L'administration montre les dates de sauvegarde et de copie concordante, le raccourci du dossier PC et l'état de suspension. Suspendre conserve la preuve de copie déjà reçue. Changement d'appareil et outils ponctuels sont dans leurs détails ; les instructions de mise à jour indiquent `Mettre-a-jour.cmd`.
- La barrière locale existante refuse toujours une intention non terminée, un compte réapparu et le marqueur de restauration. Le vrai serveur est disponible avec un journal terminé non vide, sans PC, fermetures désactivées. Aucun nouveau mécanisme de démarrage n'a été ajouté.
- [PR #98](https://github.com/fredbuhr/jessiemessage/pull/98) fusionnée ; cinq contrôles candidat et cinq main réussis, dont 418 tests sur chaque MariaDB et 157 Chrome. Build normal du Manager réussi (dernière modification affichée : 23:34 Europe/Paris), sans réinstallation des dépendances.
- À 21:39:01 UTC, lanceur/source propres et épinglés, rapports de démarrage et HTTPS santé/disponibilité sur les deux origines vérifiés. Six configurations, trois fichiers d'autorité et le marqueur D1 sont inchangés. Moniteur `current / OK` ; API privée toujours protégée. Le catalogue de processus SSH ne montre pas les processus Web : la preuve de démarrage utilise le lanceur, les rapports et HTTPS.

**Critère de fin acquis. Prochain lot : S2.** Aucun nouveau raccordement, GPG, import D1 ou retrait de quarantaine pour répéter S1.

## S2 — Composer la fermeture locale et la restauration manuelle

**Résultat attendu :** fermer réellement un compte et pouvoir récupérer une sauvegarde avec intervention opérateur, sans confirmation PC à chaque phase.

- Réutiliser l'arrêt effectif de tous les producteurs et captures, les transactions, l'intention reprenable, les contrôles de graphe, les fichiers photo, le contrôle final d'absence et la barrière locale déjà appliquée au démarrage du serveur. Composer le traitement local et sa reprise sous maintenance. Ne pas injecter de faux `registrySha256` ou `witnessRevision` dans le contrat existant.
- Conserver un registre minimal des fermetures (identifiant et date), exportable et copié de façon asynchrone. Sa conservation doit couvrir les archives encore restaurables. Aucune confirmation indépendante du PC n'est requise pour chaque fermeture du nouveau mode.
- Définir un parcours de restauration manuelle distinct : maintenance de tous les producteurs → import isolé → vérification tables/photos/clés → traitement des comptes fermés après la capture → révocation des anciennes sessions → réouverture explicite. Conserver les contrôles réels d'identité de cible et de capacité nécessaires ; un reçu source ne vaut pas réussite cible.
- Utiliser le profil applicatif existant : trente tables, médias chiffrés, objets exécutables exclus, `completeDatabase:false`. Le nouveau contrat fait confiance à l'administration de l'hébergeur et vérifie le schéma de l'application. Il ne prétend pas satisfaire l'ancien inventaire exhaustif des objets SQL invisibles.
- Si le registre récent manque ou est incomplet, ne pas republier aveuglément les anciens comptes/conversations : les maintenir bloqués jusqu'au contrôle opérateur, ou réinviter sans republier l'historique incertain. Une perte simultanée de l'hôte et des fermetures non encore copiées n'offre pas de garantie automatique anti-retour arrière.
- Préserver les acquis D1 et son marqueur. Ne pas réimporter pour répéter la preuve ; le nouveau parcours doit gérer explicitement l'état restauré avant toute levée de quarantaine.
- Vérifier avec données synthétiques fermeture normale, interruption et reprise, redémarrage après fermeture, ancienne archive contenant un compte fermé, registre manquant, photos et relations entre comptes.

**Critère de fin :** fermeture locale et exercice de restauration manuelle vérifiés, sans données clientes effacées pour tester et sans prétendre avoir restauré la production.

## S3 — Terminer les parcours utiles et la recette de la messagerie

- Terminer les seuls parcours utilisateur encore non constatés : sessions sur deux appareils, brouillons et conflits, notifications vers le bon message, photos, export et diffusion ciblée de test lorsqu'elle est explicitement demandée.
- Réutiliser la surveillance externe ; vérifier son délai réel et son canal sans rejouer les mails déjà acceptés.
- Définir une rétention compréhensible avant toute purge. Le collecteur actuel ne supprime pas automatiquement toutes les anciennes archives : aucune durée de trente jours n'est présentée comme déjà appliquée. Ne supprimer aucune archive dans ce lot de documentation.
- Expliquer les limites utiles : interruption pendant restauration ; messages postérieurs à la capture choisie potentiellement perdus ; copie externe parfois plus ancienne lorsque le PC reste éteint. Ne pas promettre vingt-quatre heures de perte maximale sans copie externe assez récente.
- Recette finale sur deux appareils, guide court, état déployé exact et repli cohérents.

**Prochaine action : S2.** Ne pas relancer D2, un achat VPS, une demande de budget ou une initialisation PC comme préalable à cette V1.
