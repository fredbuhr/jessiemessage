# Corrections de l’audit — lot 2, version 0.81

**Serveur 0.81.0 déployé et vérifié le 20 octobre 2026 à 03:48 Europe/Paris. Le kit PC est prêt ; son installation sur le PC personnel reste en attente.** A08 est partiellement préparé, sans exécuteur d’archivage actif.

## Périmètre

A05 : rendre les nouvelles admissions de photos compatibles avec les limites de capture des médias. A07 : atteindre et acquitter la dernière archive avant de revérifier l’historique sur Windows. A08 : mesurer la capacité restante du journal, prévenir avant saturation et préparer une procédure d’archivage sans purge automatique.

Le mutualisé, les quotas persistés, les données, les clés et le raccordement PC sont conservés. Aucun nouveau service, schéma SQL ou mécanisme d’appariement.

## Mesure avant modification

Le 20 octobre 2026 à 01:18:58 UTC, l’inventaire existant en lecture seule est complet et sain : deux photos actives, quatre fichiers chiffrés, **380 528 octets**, aucun fichier inconnu, temporaire ou manquant, aucune réservation ou suppression en attente. La charge SQL et le volume observé concordent. Ce contrôle porte sur la structure ; il ne remplace pas le déchiffrement déjà accepté sur le PC.

À 01:17:14 UTC, le dossier d’opérations contient **8 reçus**, **4 captures** et **20 entrées** au total. Les plafonds de lecture restent respectivement 2 000 reçus et 4 096 entrées. Les paramètres historiques restent 1 Gio par propriétaire, 10 Gio au total et 512 Mio de réserve disque ; ils ne sont ni réinitialisés ni abaissés sous les données existantes.

## Corrections livrées

Les nouvelles réservations de médias respectent un budget de sauvegarde explicite de **1 Gio chiffré et 50 000 objets non libérés**, soit au plus 100 000 fichiers. Les réservations et suppressions non acquittées gardent leur charge. La déduplication et les reprises d’une réservation existante restent possibles au plafond. La décision est prise sous le verrou SQL de capacité existant.

Ce budget traite les octets et fichiers des médias. Le budget d’archive est vérifié sous les limites SQL et métadonnées existantes, dont 100 000 lignes SQL cumulées et 64 Mio de dump brut. Il ne promet pas une croissance illimitée de la base.

Le copieur valide d’abord tout le catalogue canonique, puis commence par l’archive la plus récente. Son reçu est envoyé dès que cette archive est effectivement vérifiée. Les anciennes copies ne peuvent plus consommer tout le passage avant elle ni faire reculer ce reçu. Les limites de temps, taille et nombre de nouveaux téléchargements sont conservées.

L’avertissement commence à 1 500 reçus ou 3 072 entrées du dossier ; il ne suspend pas les copies et ne masque pas un échec prioritaire. La [procédure dédiée](backup-capacity-and-history-081.md) précise les limites et le dry-run synthétique qualifié. L’avertissement de capacité du journal ne remplace pas une rotation. Son exécuteur reste différé et A08 demeure ouvert pour cette partie ; aucune archive, aucun reçu ni registre de fermeture n’est supprimé automatiquement.

## Mise à jour du PC existant

Le serveur et le kit corrigé sont livrés. Administration → Sauvegardes → carte du PC raccordé → **Mettre à jour le PC**. Extraire le ZIP, puis ouvrir **Mettre-a-jour.cmd** sur ce PC. Le dossier, les copies et l’autorisation existants sont conservés. Attendre la fin d’une copie en cours avant de relancer si l’outil le demande.

Ne pas lancer `Activer-le-temoin.cmd`, refaire le raccordement ou manipuler les clés pour ce correctif. La génération du kit avec le copieur exact est vérifiée, ainsi que son expansion et les scénarios natifs sous Windows en CI. L’installation sur le PC personnel reste **non observée** ; aucun nouveau raccordement ni contrôle général de déchiffrement n’est requis.

## Qualification et livraison

[PR #103](https://github.com/fredbuhr/jessiemessage/pull/103), candidat `f723b86f046bfe560c0cf1b267d89b946883e8ee`, merge **`4619c68f05e17accd2c98669377e6458fc4d1f14`**, arbre commun **`f623a5817e90eb1416d094b71a5a410723d05f4f`**. Aucun schéma ni dépendance changé.

| Preuve | Candidat et main |
| --- | --- |
| Suite générale | 3 102 tests ; 3 067 réussis ; 35 wrappers SQL ignorés ; zéro échec |
| MariaDB 10.11 / 11.4 | 460/460 chacune, sans omission ; dernière réservation concurrente en octets/objets qualifiée |
| Chrome | 161 réussis, sans omission ; avertissement FR/EN, disparition et effacement des données privées |
| Recettes HTTPS/SQL | 2 réussies, sans omission |
| Windows PowerShell 5.1 | Job natif réussi ; plusieurs passages, arrivées récentes, ancien préfixe coûteux, reçus, refus des catalogues et ZIP réels |
| Syntaxe et aperçu | 567 fichiers ; aperçu construit |

[CI candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39353610982), [Windows candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39353610976), [CI main](https://github.com/fredbuhr/jessiemessage/actions/runs/39354203686), [Windows main](https://github.com/fredbuhr/jessiemessage/actions/runs/39354203718) : six jobs réussis par étape. Push source également vert. Local sur Node 24.19.0 : 3 098 tests, 2 884 réussis, 214 ignorés, zéro échec ; les omissions locales restent distinctes des preuves natives.

Précontrôle sans démarrage ni effacement à **01:36:11.290382 UTC**, fermeture locale `passed`, aucune intention en attente. Lockfile comparé en excluant seulement les deux versions racine, dépendances réutilisées. Build normal du Manager réussi à **03:42 Europe/Paris**, sans réinstallation ni migration. [Preuve Manager](verification-proofs/jm081-manager.jpg).

À **01:48:32.150446 UTC** : source/arbre/propreté, version/lanceur, modes 0700/0600 vérifiés ; dix empreintes sensibles et identité d’autorisation PC conservées ; reçu de démarrage et moniteur **OK**. Santé/disponibilité **200** sur les deux origines, JSON exact, sans cookie, `no-store`, HSTS unique. Sauvegardes, Confidentialité, Fermetures et le script administratif protégé `/backups.js` **401 anonymes**, HSTS conservé.

Les PID parent/enfant ne sont pas directement observés depuis SSH ; le reçu du superviseur, émis après IPC et disponibilité HTTP de l’enfant, les pins et les contrôles HTTPS frais attestent le démarrage. Aucun GET administrateur authentifié ni installation sur le PC personnel n’est revendiqué.

Les adaptateurs opérateur existants ont relu l’inventaire et le catalogue sans modification : mêmes deux photos / 380 528 octets, quatre archives, une destination raccordée, cadence quotidienne **05:15 UTC**, fraîcheur **OK**. Kit de mise à jour généré en mémoire : six fichiers, 54 786 octets, copieur corrigé exact, aucun fichier `raccordement.json`. Les noms d’entrées ZIP sont vérifiés ; une occurrence de ce nom à l’intérieur du code n’est pas une entrée ZIP.

Le lanceur épinglé est `/srv/customer/jessiemessage-private/start-primary-audit-lot2-081-4619c68f.sh`, SHA-256 `3a9eaa9689e95611a825890704d6462b7d20737dab03b2ea36125894c47fecde`, checkout `/srv/customer/jessiemessage-operator/audit-lot2-081-4619c68f`. Mode `start-local-closures`, port 3000 direct ; clés, médias, base et configurations existants. Repli immédiat **0.80**, sans retour SQL ; pins et commandes dans [REPRISE](REPRISE.md) et le checkpoint privé unique.

## État final et limites

- **A05 : corrigé et serveur vérifié** pour l’admission média, sous les limites SQL/métadonnées/débit distinctes décrites dans la procédure.
- **A07 : code qualifié dans Windows, kit déployé ; installation personnelle en attente.** Le serveur ne peut installer le script sur le PC du propriétaire. Ouvrir seulement `Mettre-a-jour.cmd` depuis le kit du PC existant.
- **A08 : avertissement livré, dry-run de copie/conservation qualifié ; exécuteur d’archivage actif différé et ouvert.** Aucune purge automatique.
- **A01 : toujours ouvert indépendamment**, binaire hébergeur 24.15.0, sans correctif précis sélectionnable dans le Manager.

Aucun message ou mail réel, effacement de compte, restauration de production, nouveau raccordement ou changement de clé pour qualifier ce lot. Autorité et D1 préservés. Lot 2 serveur terminé ; prochain lot de développement après ce bilan : A06/A09/A10, sur cibles synthétiques. Les [preuves structurées](verification-proofs/jm081-verification.json) distinguent serveur livré, qualification native et installation PC.
