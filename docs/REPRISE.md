# Reprendre JessieMessage

**État courant unique — 19 octobre 2026, vérification SSH à 14:24 UTC (16:24 Europe/Paris), contrôles complémentaires ci-dessous. Étape 4/6 : sauvegarde/restauration et témoin indépendant.** Les fermetures réelles de comptes restent désactivées. Lire aussi le [plan de livraison](PLAN-IMPLEMENTATION.md) et les [règles de reprise](../AGENTS.md).

L'[ancien point de reprise intégral](REPRISE-HISTORIQUE-20261019.md) est conservé comme historique. Ses versions antérieures et leurs commandes ne sont pas l'état courant. Les [preuves d'activation 0.70](activation-proofs/jm070-activation.json) et le [contrat du lot](witness-enrollment-070.md) gardent leurs dates et leur portée.

## Code, fusion et déploiement

| État | Fait vérifié |
|---|---|
| Code fusionné au départ de cette reprise | `main` : `a18d6afd32d6a9f138e78b60273eb1ee9ba5cf81`, après la PR documentaire [#89](https://github.com/fredbuhr/jessiemessage/pull/89). La PR [#88](https://github.com/fredbuhr/jessiemessage/pull/88) a intégré 0.70. |
| Runtime réellement déployé | Parent et enfant **0.70.0**, source `61878b174b239c8d009fedd9714701214dadbfbe`, arbre `1efa835b44a6baeaa06b7e7e5ccf4351ece3e58c`, checkout propre. Les commits documentaires suivants ne changent pas ce runtime. |
| Correctif courant | **0.70.1** : deux consignes Windows de mise à jour/activation corrigées localement pour préserver le raccordement existant ; exemples de contrôle natif remis dans l'environnement strict. **Pas encore déployé** à ce relevé. |
| PR anciennes intégrées | **66/66 PR ancêtres déjà intégrées par #69 fermées**, puis relues à **14:26:59.676 UTC** ; aucune PR ouverte restante à ce contrôle. Aucune nouvelle fusion ni suppression de branche. |
| Preuves Windows personnelles | Initialisation du témoin, aller-retour indépendant frais et déchiffrement de l'archive courante **non confirmés**. |

La CI 0.70 est acquise : cinq jobs réussis pour source/PR/main et Windows ; 410 tests par version MariaDB, 157 tests Chrome et 85 assertions Windows du témoin. Ces preuves portent sur 0.70, pas sur la CI distante du correctif 0.70.1. Les détails et liens des runs restent dans le [relevé 0.70](witness-enrollment-070.md#validation-acquise-avant-activation).

La vérification ciblée locale du correctif et du superviseur compte **103 réussites, deux contrôles procfs indisponibles ignorés, zéro échec**. Elle ne constitue pas un déploiement ni une exécution Windows personnelle.

## Service courant et états à préserver

- Checkout : `/srv/customer/jessiemessage-operator/witness-enrollment-070-f4c7333f` ; parent public **3000**, enfant en boucle locale **3001**.
- Run permanent : `bash /srv/customer/jessiemessage-private/start-primary-witness-observer-070-61878b17.sh` ; lanceur **1 131 octets, 0700**, SHA-256 `cd888f05bab47253fe79783d5c05e5b2a16827cff8b3a1d2b43be85808f41bb6`, inchangé.
- Journal privé : `/srv/customer/jessiemessage-private/jm070-witness-observer.log`.
- Contrat original : `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1/contract/witness-genesis.json` ; **813 octets, 0600**, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10`, inchangé.
- Permission : **`ready`**, origine **968 octets**, SHA-256 `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` ; état **226 octets**, SHA-256 `ac4c7287aaaa5abc758ddb4cc8b8fd86d433c6c8a187e048c7dc12a6dba4b728`. Empreintes inchangées, fichiers 0600 dans le sous-dossier `enrollment`.
- Observation : **`externalWitnessConfirmed:false`**, **`closuresEnabled:false`**. La présence de cette permission ne prouve pas un témoin externe.
- Trois relevés récents du moniteur : `1792419728656`, `1792419788662`, `1792419848667`, **OK**. Ils attestent ce relevé, pas une surveillance externe de panne totale.

Le contrôle authentifié `witness_observer_precheck` a réussi : `observe_only`, `started:false`, `externalWitnessConfirmed:false`, `closuresEnabled:false`. Lancer ce contrôle dans **l'environnement strict du lanceur**, notamment `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd` ; `--private-path-mode` seul ne remplace pas cette variable. Le premier appel privé incomplet a été refusé `ENVIRONMENT` sans modification d'état ; ce refus n'est pas une panne applicative.

À `checkedAt:1792420084903`, la sonde HTTPS exécutée depuis l'hébergement a validé `/api/health` et `/api/ready` en **116 ms**, état `healthy`. La sonde depuis scratch a expiré sur le chemin réseau ; elle n'est ni un contrôle réussi ni une preuve de panne du service.

**Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`.** Ne pas réinitialiser genèse/permission, réapparier le PC, supprimer ses marqueurs ou régénérer une clé. Après une réponse perdue, lire les états durables avant de décider comment reprendre.

Le mode courant observe le registre original vide. La messagerie quotidienne ne dépend pas de la présence continue du PC. Ce mode n'est ni une barrière de récupération après effacement, ni une autorisation de fermeture réelle. `https://recette.jessiemessage.com` partage runtime et base avec le principal.

## Sauvegarde courante : preuves distinctes

| Preuve | État au relevé |
|---|---|
| Capture quotidienne | Horaire **05:15 UTC** ; archive `capture-1792386945745-204e0e8e073b6131`, **402 552 octets**, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. |
| Copie PC | Reçu `receivedAt:1792419653468` (14:20:53.468 UTC), identifiant/taille/empreinte concordants. PC déjà raccordé ; garder configuration DPAPI, dossier et reçus. |
| Déchiffrement personnel courant | **Non confirmé** ; le reçu de copie ne le prouve pas. Les acceptations du coffre et de la restauration 0.46 restent acquises avec leur portée historique. |
| Témoin indépendant frais | **Non confirmé** ; `TEMOIN_INITIALISE` local et observation fraîche acceptée par le serveur devront être relevés séparément. |
| Import natif isolé courant | **Non confirmé** ; le précontrôle CLI acquis n'a ni importé SQL ni démarré une cible restaurée. |

Ne jamais lancer `capture --offline` pendant que le service fonctionne. Utiliser le superviseur existant. Les mails de test incident/rétablissement déjà confirmés reçus ne sont pas à renvoyer.

## Prochaine action exacte

**Publier, valider, fusionner puis déployer le correctif 0.70.1 des consignes Windows qui préserve le raccordement avant toute action demandée sur le PC.** Contrôler le kit réellement servi et enregistrer le commit/arbre ainsi que les vérifications de déploiement. Ce correctif n'exige ni nouvelle genèse ni nouvelle permission.

Après ce lot seulement, donner l'action PC existante avec les consignes corrigées, puis relever séparément l'initialisation locale et l'observation externe fraîche. Ne pas annoncer « PC initialisé » ou « sauvegarde restaurable » avant leurs preuves. Le [plan](PLAN-IMPLEMENTATION.md) donne les dépendances et les critères de fin ; ne pas démarrer les lots suivants dans cette reprise documentaire.

## Acquis et limites de la version de base

Les comptes sur invitation, messages/photos, notifications, récupération du mot de passe, fiches et diffusions individuelles sont conservés. Les sessions administrateur sont indépendantes par appareil et durent 180 jours glissants. Six réponses rapides FR/EN et l'export HTML/JSON d'une conversation sont disponibles.

Jessie en France, sans structure ; conversations conservées jusqu'à fermeture définitive, hors suppressions volontaires. Ne pas redemander ces choix. Moteur/parcours d'effacement livrés dans le code, **non activés**. Barrière fraîche de démarrage/récupération, réconciliation source/cible, inspection SQL qualifiée, import isolé courant, notice définitive, alerte de panne totale et recette personnelle à deux appareils restent ouverts.

## Repli et reprise après interruption

Les paramètres précédant 0.70 sont conservés dans `/srv/customer/jessiemessage-private/manager-before-witness-enrollment-070.json`, **461 octets, 0600**, SHA-256 `e91932557d5d2bbea7ad1f9c90ce9ff38eb231eed038f583f1e2f4b4a88170c0`. Aucun repli réel ni restauration SQL n'est demandé par ce relevé. Le lanceur ponctuel de préparation reste une preuve historique, jamais le Run permanent.

Au prochain lot : lire ce fichier et le plan, vérifier repo/PR/CI et service réels, puis choisir un seul objectif borné. Il peut inclure code, tests, CI, fusion et déploiement du même correctif. Après une opération distante, enregistrer son résultat durable, l'heure, la prochaine action et les limites ; clôturer le lot avant d'en ouvrir un autre. Si le résultat est inconnu, inspecter avant de relancer. Les [règles de travail](../AGENTS.md) rendent cette méthode durable sans promettre d'empêcher une coupure de ChatGPT.
