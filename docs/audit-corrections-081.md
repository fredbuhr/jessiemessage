# Corrections de l’audit — lot 2, version 0.81

État de travail : implémentation et qualification en cours. La version déployée reste 0.80 tant que les preuves de livraison ci-dessous ne sont pas complétées.

## Périmètre

A05 : rendre les nouvelles admissions de photos compatibles avec les limites de capture des médias. A07 : atteindre et acquitter la dernière archive avant de revérifier l’historique sur Windows. A08 : mesurer la capacité restante du journal, prévenir avant saturation et préparer une procédure d’archivage sans purge automatique.

Le mutualisé, les quotas persistés, les données, les clés et le raccordement PC sont conservés. Aucun nouveau service, schéma SQL ou mécanisme d’appariement.

## Mesure avant modification

Le 20 octobre 2026 à 01:18:58 UTC, l’inventaire existant en lecture seule est complet et sain : deux photos actives, quatre fichiers chiffrés, **380 528 octets**, aucun fichier inconnu, temporaire ou manquant, aucune réservation ou suppression en attente. La charge SQL et le volume observé concordent. Ce contrôle porte sur la structure ; il ne remplace pas le déchiffrement déjà accepté sur le PC.

À 01:17:14 UTC, le dossier d’opérations contient **8 reçus**, **4 captures** et **20 entrées** au total. Les plafonds de lecture restent respectivement 2 000 reçus et 4 096 entrées. Les paramètres historiques restent 1 Gio par propriétaire, 10 Gio au total et 512 Mio de réserve disque ; ils ne sont ni réinitialisés ni abaissés sous les données existantes.

## Résultat attendu

Les nouvelles réservations de médias respectent un budget de sauvegarde explicite de **1 Gio chiffré et 50 000 objets non libérés**, soit au plus 100 000 fichiers. Les réservations et suppressions non acquittées gardent leur charge. La déduplication et les reprises d’une réservation existante restent possibles au plafond. La décision est prise sous le verrou SQL de capacité existant.

Ce budget traite les octets et fichiers des médias. Le budget d’archive est vérifié sous les limites SQL et métadonnées existantes, dont 100 000 lignes SQL cumulées et 64 Mio de dump brut. Il ne promet pas une croissance illimitée de la base.

Le copieur valide d’abord tout le catalogue canonique, puis commence par l’archive la plus récente. Son reçu est envoyé dès que cette archive est effectivement vérifiée. Les anciennes copies ne peuvent plus consommer tout le passage avant elle ni faire reculer ce reçu. Les limites de temps, taille et nombre de nouveaux téléchargements sont conservées.

L’avertissement commence à 1 500 reçus ou 3 072 entrées du dossier ; il ne suspend pas les copies et ne masque pas un échec prioritaire. La [procédure dédiée](backup-capacity-and-history-081.md) précise les limites et le dry-run synthétique qualifié. L’avertissement de capacité du journal ne remplace pas une rotation. Son exécuteur reste différé et A08 demeure ouvert pour cette partie ; aucune archive, aucun reçu ni registre de fermeture n’est supprimé automatiquement.

## Mise à jour du PC existant

Après livraison du serveur : Administration → Sauvegardes → carte du PC raccordé → **Mettre à jour le PC**. Extraire le ZIP, puis ouvrir **Mettre-a-jour.cmd** sur ce PC. Le dossier, les copies et l’autorisation existants sont conservés. Attendre la fin d’une copie en cours avant de relancer si l’outil le demande.

Ne pas lancer `Activer-le-temoin.cmd`, refaire le raccordement ou manipuler les clés pour ce correctif. La livraison du script dans le kit ne prouve pas son installation sur le PC personnel ; cet état restera explicitement en attente jusqu’à son application.

## Qualification et livraison

Qualification locale sur Node 24.19.0 : **3 098 tests, 2 884 réussis, 214 ignorés, zéro échec** ; syntaxe de 567 fichiers vérifiée. Les omissions locales ne valent pas preuve native. Les CI MariaDB 10.11/11.4, Chrome, HTTPS/SQL et Windows PowerShell 5.1, puis le déploiement épinglé restent à acquérir. Les [preuves structurées](verification-proofs/jm081-verification.json) distinguent le code, le serveur déployé et l’installation sur le PC.
