# Plan d'implémentation de JessieMessage

**19 octobre 2026 — étape 4/6.** Direction demandée : terminer la messagerie sur le mutualisé existant, sans nouveau serveur ni abonnement. La proposition VPS et l'attente d'un budget sont retirées. Lire l'[état courant](REPRISE.md) et les [solutions étudiées](mutualise-simple-20261019.md).

## Portée et acquis

V1 : messagerie privée, sauvegarde applicative chiffrée, copie PC existante et restauration manuelle accompagnée en maintenance. La récupération autonome après perte complète de l'hôte, un témoin frais à chaque phase et la succession de propriétaire sortent des prérequis. Cette décision ne prétend pas fournir les mêmes garanties.

Les anciens contrats, gardes, preuves C1–C5, clés et états PC sont conservés. Aucun refus n'est transformé en succès en supprimant un marqueur ou en inventant une qualification SQL. L'[ancien plan complet](https://github.com/fredbuhr/jessiemessage/blob/6ef81692e01220cd3fd1d41a38c1b1d87568984d/docs/PLAN-IMPLEMENTATION.md) reste l'historique de ce périmètre plus exigeant.

Acquis : service 0.72.0 en observation, fermetures désactivées ; copie PC et déchiffrement personnel vérifiés ; D1 importé et vérifié sur le mutualisé, trente tables, six clés et quatre fichiers photo chiffrés. D1 reste en quarantaine et n'est pas une restauration rouverte. Aucune bascule de production dans cette réorientation documentaire.

Un lot borné à la fois : code, contrôles pertinents, CI, fusion, déploiement et vérification du même résultat si nécessaire. Avant de répéter une opération interrompue, lire son résultat durable. Après chaque résultat, remplacer l'état courant dans REPRISE ; distinguer codé, fusionné, déployé et vérifié. Aucun secret ni contenu client dans Git.

## S1 — Simplifier le fonctionnement quotidien et l'administration

**Résultat attendu :** la messagerie et sa sauvegarde quotidienne fonctionnent sans observateur indépendant obligatoire ; l'administration indique clairement la dernière capture, la dernière copie PC et les actions utiles.

- Conserver le superviseur, la capture applicative cohérente, le chiffrement, les clés, la cadence 05:15 UTC, le copieur PC et les alertes existants. Le PC est une destination de copie, pas une présence continue nécessaire à la messagerie. Pas de nouveau raccordement ni d'action GPG personnelle.
- Le mode `start` sans observateur existe. Il faut en vérifier la composition avant changement du lanceur : il peut démarrer avec des intentions non terminées, et ne compose pas à lui seul une fermeture sûre. Garder les fermetures désactivées pendant S1. L'observateur courant exige un journal initial vide ; ne pas lui confier une première fermeture réelle.
- Simplifier la page Sauvegardes autour de l'état, du dossier PC et d'une aide à la récupération. Réserver les contrôles techniques ponctuels aux détails. Réutiliser les outils fonctionnels plutôt que demander de nouvelles preuves déjà acquises.
- Vérifier sur données synthétiques démarrage et capture avec journal valide non vide, messagerie PC éteint, copie différée et refus du marqueur D1 existant. Déployer ensuite le seul changement borné, avec repli documenté.

**Critère de fin :** composition quotidienne vérifiée et administration compréhensible, sans toucher aux clés, à l'autorité historique ni à la quarantaine D1.

## S2 — Composer la fermeture locale et la restauration manuelle

**Résultat attendu :** fermer réellement un compte et pouvoir récupérer une sauvegarde avec intervention opérateur, sans confirmation PC à chaque phase.

- Réutiliser l'arrêt effectif de tous les producteurs et captures, les transactions, l'intention reprenable, les contrôles de graphe, les fichiers photo et le contrôle final d'absence. Composer un propriétaire local explicite et sa barrière de démarrage/reprise. Ne pas injecter de faux `registrySha256` ou `witnessRevision` dans le contrat existant.
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

**Prochaine action : S1.** Ne pas relancer D2, un achat VPS, une demande de budget ou une initialisation PC comme préalable à cette V1.
