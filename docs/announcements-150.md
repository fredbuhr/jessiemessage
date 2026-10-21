# Annonces — Évolution 4, version 1.5.0

**Code revu, fusionné, qualifié par ses propres CI PR/main, publié et préparé sur Infomaniak ; migration, précontrôle et activation non attestés.** Le dernier état de production confirmé reste la [1.4.0 close](REPRISE.md), sur le schéma 31. Le staging n’a effectué aucune lecture SQL.

## Parcours retenu

Jessie dispose d’une annonce courante : texte, début immédiat ou programmé, fin obligatoire. Le bandeau apparaît seulement pendant cette période. Il reste compact dans la discussion mobile ; son texte complet s’ouvre à la demande et le client peut le masquer. Une nouvelle annonce remplace la précédente.

L’option **Envoyer aussi en message privé** prépare une diffusion vers les clients éligibles après aperçu et confirmation du nombre. Les notifications habituelles s’appliquent aux appareils abonnés. L’audience des messages est figée à la confirmation ; les nouveaux invités peuvent ensuite voir le bandeau. Les envois restent progressifs selon les budgets existants, sans promesse de remise exactement à l’heure de début.

La période se termine au plus tard sept jours après l’enregistrement. Les messages en attente ne sont plus envoyés après la fin ; les notifications préparées ont aussi une échéance bornée. Retirer ou remplacer une annonce arrête son affichage et ses envois restants. Les messages déjà remis restent dans les conversations.

## Intégration

Une table `announcements` contient une ligne par administrateur, le texte chiffré, la période et la révision. L’annonce et sa campagne facultative sont enregistrées dans la même transaction. Les diffusions conservent leur format compact v2 et leurs dates de disponibilité/expiration existantes. Aucun worker, fournisseur, secret ou paquet supplémentaire n’est nécessaire.

La migration additive 0032 porte le schéma à **32 migrations, 31 tables applicatives et 32 avec le registre des migrations**. Le repli prévu est la [1.4.1 compatible](announcements-compat-141.md), dont le runtime normal conserve la création d’annonces désactivée. La 1.4.0 reste préservée ; elle n’est pas un repli qualifié pour le nouveau schéma.

La lecture d’une annonce reste soumise à la session et à la conversation du client. Révision et identifiant de mutation protègent les modifications simultanées et les réessais après réponse perdue. La fermeture d’un client conserve le bandeau global et détache, si nécessaire, sa référence à une campagne devenue vide. Sauvegarde et vérification intègrent le nouveau format ; les preuves historiques gardent leur couverture propre.

## Référence et qualification propres

La [PR 120](https://github.com/fredbuhr/jessiemessage/pull/120), head `77f6037446a6f533a0864637f8b33dc4fbefe6e7`, est fusionnée sur **`abca467c45c9385371a9095ab359e78c99140370`**, arbre **`3238dd2224ea768e3ab2f8bcb7594cc3890dd5e4`**. Sa [CI PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39619254595) et sa [CI main propre](https://github.com/fredbuhr/jessiemessage/actions/runs/39621183160) réussissent chacune **5/5 à la tentative 1**, cinq logs propres relus sous Node **24.22.0**.

Chaque exécution compte **3 304 tests généraux, 3 266 réussis, zéro échec et 38 ignorés**, syntaxe/build **605 sources** ; MariaDB **10.11/11.4, 496/496 chacune**, Chrome **183/183** et HTTPS/MariaDB **3/3**, sans omission native. Les annonces couvrent neuf sous-cas SQL et cinq tests Chrome dans dix contextes : période/expiration/reprise, isolation d’administrateur, chiffrement/refus d’altération, conflit de révision, rollback atomique, reprise de bail, notifications bornées, annulation des alertes restantes, interface FR/EN, réponse perdue et purge du compte. Les omissions générales ne constituent pas une qualification native.

Le checkout PR est le merge synthétique `3943f1688b035eeee8f1150b46f1ea7fe2784a5d` vers la branche de compatibilité, d’arbre identique au head. Le retarget ultérieur vers main n’est pas une nouvelle CI ; la CI main propre vérifie le commit fusionné `abca467c…`. Les seuls fichiers applicatifs différents de la 1.4.1 sont `package.json`, `package-lock.json` et `server/index.mjs` : version 1.5.0 et annonces activées dans le runtime normal. Documents et helpers sont livrés séparément après les deux releases.

Le [tag et la release v1.5.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.5.0), identifiant **419695814**, sont vérifiés sur ce commit exact ; publication le **`2026-10-21T15:02:51Z`**. Le [workflow de publication](https://github.com/fredbuhr/jessiemessage/actions/runs/39622193999), job `119298305472`, provient du commit opérateur `2e754f8aa60e74689669eab91cd48f0e73dba0e2`, distinct de la source applicative. Les [preuves 1.5.0](verification-proofs/jm150-verification.json) conservent ses résultats propres ; les [preuves 1.4.1](verification-proofs/jm141-verification.json) conservent la base locale et ses premiers échecs sans les réattribuer à cette source exacte.

La restauration native générique valide son fixture de schéma 32, sans annonce non vide. Le vérificateur cryptographique des annonces est testé unitairement ; la persistance et le refus d’altération d’une annonce non vide sont vérifiés séparément en SQL natif. Aucune restauration native complète d’annonce chiffrée non vide, aucun téléphone physique, débit réel du mutualisé ou fonctionnement courant du PC n’est revendiqué.

## Préparation acquise et livraison hébergée restante

Le [reçu SSH utilisateur complet](verification-proofs/jm150-hosted-staging.json) confirme **`staged_awaiting_schema32`** pour les deux références exactes. Les checkouts et lanceurs sont préparés, Node **v24.22.0** et son empreinte vérifiés, les journaux normaux et de précontrôle sont encore vides. Il conserve `started:false`, `sqlStatusChecked:false`, `migrated:false`, `precheckPassed:false`, `runtimeStarted:false`, `managerChanged:false`, `checkpointChanged:false` et `noRestart:true`. La 1.4.1 est préparée mais reste `rollback141HostedQualified:false`. **Ne rejouer ni la préparation ni la création des lanceurs/journaux, et ne tronquer aucun journal.**

Les helpers initiaux du commit `40027be898f1a82cd9c2aed7c4a313096d8db4d4` sont qualifiés par **59/59 tests synthétiques**, distincts de ce reçu hébergé. Les quatre empreintes de lanceurs du reçu sont maintenant épinglées dans le [helper de migration courant](https://github.com/fredbuhr/jessiemessage/blob/c798f96b631464e51c7ce212c37ceeaa681af904/ops/upgrade-release150.sh), commit `c798f96b631464e51c7ce212c37ceeaa681af904`, SHA-256 **`0162b6a364decae68b5f6c0d76f84a20c869d6e9269ee12d40d0251bf425381c`**. Ses **32/32 tests synthétiques après épinglage réel** réussissent. L’ancien template avec placeholders reste historique ; le helper courant est entièrement épinglé. Ses préconditions techniques de statut SQL confirmé et d’arrêt de service observé ne sont pas encore réunies.

La prochaine action est uniquement le [diagnostic SQL en lecture seule](REPRISE.md#lecture-sql-en-lecture-seule--seule-étape-actuelle), avec le compte de migration existant. Le plan connu attend 32 migrations dont 31 appliquées et une en attente, sans interruption ; ce résultat doit être observé et ne se déduit pas du staging. Le mot de passe se saisit masqué dans la console, jamais dans la conversation. Aucune migration ou modification Run/Build n’est à lancer maintenant.

Migration 0032, précontrôles 1.4.1 puis 1.5.0 et activation restent à constater séparément. Le checkpoint et la production restent au dernier état confirmé **1.4.0 / Node 24.22.0 / schéma 31**, avec repli **1.3.4** ; la 1.4.0 ne doit pas être redémarrée après le passage au schéma 32. Aucun démarrage intermédiaire de 1.4.1 n’est requis. Aucune écriture de métadonnées, manipulation PC ou évolution suivante n’est ouverte. L’état courant et l’unique commande opérateur sont dans [REPRISE](REPRISE.md).
