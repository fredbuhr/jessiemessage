# Diffusions à grande échelle — Évolution 3, cible 1.4.0

**21 octobre 2026 — lot ouvert et implémentation en cours ; qualification, fusion, publication et déploiement non encore rapportés.** La production reste **1.3.3 close**, source `ca0d40648036d57fdee55b91d47d5d5a874a626e`, Node **v24.22.0**, schéma **31** et repli actuel 1.3.1. [État courant](REPRISE.md), [preuves 1.4.0](verification-proofs/jm140-verification.json), [plan restant](PLAN-IMPLEMENTATION.md).

## Périmètre du lot

Le résultat attendu est de préparer et envoyer un message privé individuel à plusieurs milliers de clients sans plafond métier de cent, en gardant un nombre confirmé, une mémoire et un affichage bornés, une reprise après interruption et une protection contre les doublons. La file de diffusion, la base et l’unique service Node existants sont réutilisés sur l’hébergement mutualisé. Aucun changement SQL ou de dépendance n’est prévu.

Trois modes explicites sont préparés : sélection manuelle, tous les clients et tous les clients correspondant aux filtres. Les modes globaux ou filtrés ciblent aussi les pages non affichées, sans charger leurs identifiants dans le navigateur. La sélection manuelle conserve les choix entre pages ; la taille technique d’une requête reste bornée. Cette borne de transport ne doit pas être transformée en plafond métier des audiences globales.

## Aperçu, confirmation et création atomique

La prévisualisation doit fournir le nombre total, le nombre éligible, les exclusions et les répétitions de photo, avec un aperçu des cinquante premiers noms au plus. Elle lie la confirmation au propriétaire, au sélecteur, à la photo et à l’ensemble éligible exact. Une modification de mode, filtre ou photo invalide cet aperçu ; une modification de contenu demande de nouveau l’acquittement. Si les destinataires ont changé avant la confirmation, l’application doit refuser l’élargissement silencieux et demander de revérifier.

La création utilise la transaction administrateur existante : découverte par pages de cent, contrôles des accès actuels, insertions groupées et comparaison de l’ensemble final à celui confirmé avant commit. Une interruption avant commit doit annuler toute la création. Si seul l’accusé de réception est perdu, la même identité de demande retrouve la campagne déjà créée ; elle ne recrée pas des messages.

Les destinataires deviennent visibles au worker avec la campagne complète. Le nouveau format chiffré reste compact : nombre, empreinte ordonnée et empreinte du sélecteur remplacent la liste complète dans le payload. Chaque ligne de destinataire porte en plus une preuve authentifiée liée à sa campagne, au propriétaire, au client, à la conversation et au message proposé. Le worker doit vérifier cette preuve avant quota ou écriture ; les campagnes historiques conservent leur garde d’appartenance actuel.

## Progression et interface

Les contacts, la sélection affichée et les destinataires de campagne doivent rester limités à une page de cinquante éléments. Les compteurs globaux sont séparés de cette page. Le suivi périodique recharge le résumé, sans recharger tous les noms. Une commande de reprise après un résultat incertain conserve la même charge utile et le même identifiant ; l’audience, les filtres et le contenu restent gelés pendant cette incertitude. Les contrôles de compte, session, CSRF et réponses devenues obsolètes restent conservés.

Le traitement reste séquentiel, avec les baux et l’écriture atomique message/événement/notification/état de destinataire existants. Le contrat prévoit, pour le nouveau format, un budget de diffusion distinct de celui des réponses manuelles, puis le budget global partagé. Le débit est borné et progressif ; aucun temps de remise ni débit réel de l’hébergement n’est encore qualifié. Le client reçoit toujours un message individuel dans sa conversation ; aucune mention de groupe ni salon partagé n’est ajouté.

## Compatibilité et livraison

Le [correctif 1.3.4](broadcast-compat-134.md) doit d’abord qualifier la lecture, le traitement, la consultation paginée, la suppression ciblée et la vérification des formats ancien et compact. Sa création élargie reste désactivée dans le runtime normal. La cible 1.4.0 activera cette capacité après le gel du snapshot de compatibilité. La 1.3.4 préparée et qualifiée sur l’hébergement sera le repli prévu de 1.4.0 ; cette qualification n’est pas encore acquise.

Les sources exactes, CI PR/main, tags/releases immuables et preuves des deux versions seront consignés après observation. Une seule préparation ultérieure pourra préparer les deux checkouts et leurs lanceurs depuis la 1.3.3 préservée, sans activation intermédiaire de 1.3.4. Aucune commande opérateur ni pin de préparation n’est fournie à ce stade. La préparation, l’activation et l’alignement privé de 1.4.0 devront rester distingués avant de déclarer le lot clos.

Les contrôles locaux du code partagé sont consignés dans le [bilan de compatibilité 1.3.4](broadcast-compat-134.md) : ils ne constituent pas la qualification du futur commit 1.4.0 ni une activation de sa capacité. Les CI exactes des deux livraisons restent distinctes.

## Qualification prévue et limites

Une fixture native synthétique de **2 500 clients** doit exercer création réelle, pages bornées, annulation de création interrompue, répétition d’une demande après perte d’accusé, refus d’un aperçu devenu obsolète, reprise de bail et absence de doublons. Les quotas seront exercés avec une horloge injectée, sans attendre la durée réelle d’une campagne. Des fixtures plus petites doivent couvrir photos, accès, suppression ciblée et vérification des données. Une nouvelle qualification Chrome doit exercer la page Diffusions, car les parcours de messagerie existants ne constituent pas ce test.

Les critères incluent le parcours mobile FR/EN, les modes global, filtré et manuel dépassant cent, la confirmation explicite, l’affichage borné, les pages de résultat, le focus, le changement de compte et le rejeu de la même demande incertaine. Les CI natives requises restent celles des commits exacts, sous Node 24.22.0 et MariaDB 10.11/11.4. Aucun résultat manquant, test ignoré ou parcours physique de téléphone n’est annoncé comme réussi. Aucun essai de masse ne cible les comptes ou conversations réels ; les états C1–C5, D1 et PC restent préservés.
