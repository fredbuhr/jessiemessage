# Diffusions à grande échelle — Évolution 3, version 1.4.0

**21 octobre 2026 — code revu, fusionné, qualifié, publié, précontrôlé et identifié actif ; alignement privé final restant.** La production **1.4.0** est confirmée par le relevé admin utilisateur, source `56d4595059df9292fc54ba4d4e948eeb793bae96`, Node **v24.22.0**, démarrage affiché **`21/10/2026 15:31:41`**, schéma **31** et repli compatible **1.3.4** précontrôlé sans démarrage. [État courant et alignement final](REPRISE.md#prochaine-action-opérateur--enregistrer-les-métadonnées-140), [preuves 1.4.0](verification-proofs/jm140-verification.json), [plan restant](PLAN-IMPLEMENTATION.md).

## Fonction active

La 1.4.0 prépare des messages privés individuels pour plusieurs milliers de clients, sans plafond métier de cent. Elle réutilise la file persistante, la base et l’unique service Node existants, sans migration SQL ni dépendance ajoutée.

Trois modes sont disponibles : sélection manuelle conservée entre pages, tous les clients et tous les clients correspondant aux filtres, y compris les pages non affichées. La requête manuelle reste bornée à **1 MiB** pour le transport ; les modes globaux ne chargent pas l’ensemble des identifiants dans le navigateur.

L’aperçu fournit les nombres total, éligible, exclu et les répétitions de photo, avec cinquante noms au plus. Il lie la confirmation au propriétaire, au sélecteur, à la photo et à l’ensemble éligible exact. Un changement d’audience, de filtre ou de photo l’invalide ; si l’ensemble a changé avant confirmation, l’application demande de revérifier sans l’élargir silencieusement.

La création utilise la transaction existante et découvre les destinataires par pages de cent. Une interruption avant commit annule la création ; la perte du seul accusé permet de retrouver la campagne avec la même demande. Le format chiffré compact conserve nombres et empreintes ; chaque destinataire porte une preuve authentifiée vérifiée avant quota ou écriture. Les campagnes historiques restent prises en charge.

Contacts, sélection affichée et destinataires de campagne restent paginés par cinquante ; le suivi périodique recharge seulement le résumé. Une demande incertaine garde son identité, son audience et son contenu gelés. Les contrôles de compte, session, CSRF et réponses obsolètes restent conservés.

Le traitement reste séquentiel, avec les baux et l’écriture atomique existants. Les campagnes compactes utilisent d’abord le budget de diffusion **120/minute**, puis le budget global partagé **300/minute** ; le lot par défaut reste de cinq, interrogé toutes les deux secondes. Ces budgets ne sont pas une promesse de délai de remise. Chaque client reçoit le message dans sa conversation privée.

## Références et qualification propres

La [PR 118](https://github.com/fredbuhr/jessiemessage/pull/118), head `b32d16606b140f95e697c4437cf0291608525d9b`, est fusionnée sur **`56d4595059df9292fc54ba4d4e948eeb793bae96`**, arbre **`8129e76c9817e79c062a4437eadee4b7ce4d90a1`**. Son delta depuis la [compatibilité 1.3.4 qualifiée](broadcast-compat-134.md) porte sur les versions dans `package.json`/`package-lock.json` et l’activation `largeAudiencesEnabled:true` dans `server/index.mjs`. La capacité reste false dans le runtime normal de 1.3.4.

La [CI PR 39602271177](https://github.com/fredbuhr/jessiemessage/actions/runs/39602271177) et la [CI main 39604398127](https://github.com/fredbuhr/jessiemessage/actions/runs/39604398127) du commit exact réussissent chacune **5/5 à la tentative 1**, cinq logs relus et Node **24.22.0** observé : Verify **3 256 tests, 3 219 réussis, zéro échec, 37 ignorés** ; Chrome **178/178**, HTTPS **3/3**, MariaDB 10.11 et 11.4 **486/486 chacune**, sans omission native. Ces résultats sont ceux de 1.4.0, distincts de ceux de 1.3.4.

La fixture native de **2 500 clients** réussit ses cinq sous-cas : création réelle et pages bornées, rollback de création interrompue, reprise après perte d’accusé, refus d’un aperçu obsolète et reprise de bail sans doublon. Les index `EXPLAIN` attendus et la suppression ciblée v2 sont observés. Quatre tests Chrome couvrent sept contextes : mobile FR/EN, modes global/filtré/manuel au-delà de cent, confirmation, affichage borné, pages de suivi, focus, changement de compte et demande incertaine. Les [preuves JSON](verification-proofs/jm140-verification.json) conservent les durées et diagnostics exacts.

Le [tag/release v1.4.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.4.0) est vérifié sur cette source et cet arbre, publié le `2026-10-21T13:09:34Z` par le [run 39605497922](https://github.com/fredbuhr/jessiemessage/actions/runs/39605497922).

## Prochaine étape et limites

Le [helper publié](REPRISE.md#préparation-hébergée-acquise) a préparé et précontrôlé ensemble **1.3.4 et 1.4.0**, depuis la 1.3.3 préservée. Ses **28/28 tests synthétiques autonomes**, syntaxes valides, revue indépendante et octets publiés vérifiés restent distincts du reçu SSH utilisateur : `staged_precheck_passed`, `bothPrechecksPassed:true` et `rollback134HostedQualified:true`. Le schéma 31 est inchangé ; aucun runtime, changement Manager ou checkpoint n’a été effectué pendant cette préparation. Aucune activation intermédiaire de 1.3.4 n’est requise. Le relevé admin confirme depuis l’activation de la **1.4.0**, sur son commit exact, Node `v24.22.0` et démarrage affiché `21/10/2026 15:31:41`. Aucune empreinte via PID actif ni observation privée directe n’est revendiquée.

Seul l’[enregistrement privé final](REPRISE.md#prochaine-action-opérateur--enregistrer-les-métadonnées-140) reste à constater avant clôture ; préparation et activation sont acquises et ne doivent pas être rejouées. Le checkpoint confirmé reste en 1.3.3 ; l’alignement suivant enregistrera le repli compatible 1.3.4 sans redémarrage. Les mesures CI utilisent des données synthétiques et une horloge injectée ; elles ne qualifient ni le débit réel du mutualisé, ni un téléphone physique. Aucun essai de masse ne cible des comptes réels ; les états C1–C5, D1 et PC restent préservés.
