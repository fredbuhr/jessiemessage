# Reprendre JessieMessage

**État courant unique — 19 octobre 2026, 15:18:47 UTC (17:18:47 Europe/Paris). Étape 4/6 ; correction Windows 0.70.2 livrée et vérifiée, lot B en attente d'une nouvelle exécution personnelle du kit corrigé.** Le lot A reste terminé. Les fermetures réelles restent désactivées.

Lire le [plan](PLAN-IMPLEMENTATION.md), les [règles de reprise](../AGENTS.md) et les [preuves 0.70.2](verification-proofs/jm0702-verification.json). Les preuves [0.70.1](activation-proofs/jm0701-activation.json), [0.70](activation-proofs/jm070-activation.json) et l'[historique](REPRISE-HISTORIQUE-20261019.md) conservent leur portée datée ; leurs anciens lanceurs ne sont pas les commandes courantes.

## Code, validation et service

| État | Résultat vérifié |
|---|---|
| Code fonctionnel actif | **0.70.2**, source `d1720d8af17081ddcc7150e24d77128fcf8ff4fe`, arbre `8ffe6911cc9c5e1b18d609a239d9f9b2038e06cf`. |
| Fusion | [PR #92](https://github.com/fredbuhr/jessiemessage/pull/92), merge `dd9af4c172832f5e471e19596008886c0da5d79e`. Les commits documentaires suivants ne changent pas ce runtime épinglé. |
| Reproduction du défaut | Nouveau test Windows sur l'ancien helper : échec réel à `File.Replace(..., $null)`, avant initialisation. [Run 39274989758](https://github.com/fredbuhr/jessiemessage/actions/runs/39274989758), job `118136838505`. L'ancienne fixture n'exerçait que la création des scripts dans un dossier neuf. |
| Correctif Windows | `File.Replace` reçoit `[NullString]::Value`, comme le writer de configuration existant. La fenêtre d'échec indique maintenant sa phase sans révéler l'exception ou les secrets. |
| CI du candidat | Six jobs réussis : [application](https://github.com/fredbuhr/jessiemessage/actions/runs/39275452683), [Windows](https://github.com/fredbuhr/jessiemessage/actions/runs/39275452944). **90 assertions Windows**, dont remplacement des deux scripts existants et préservation des octets DPAPI et du marqueur d'initialisation. |
| CI du code fusionné | Six jobs également réussis : [application main](https://github.com/fredbuhr/jessiemessage/actions/runs/39276004608), [Windows main](https://github.com/fredbuhr/jessiemessage/actions/runs/39276004551), relus par l'API. |
| Hébergement | Manager actif, Build terminé à 17:17 Europe/Paris, Run et Build enregistrés sur cette source, checkout propre. Journal du nouveau lanceur : enfant et superviseur démarrés ; moniteur `current / OK`, aucun incident. Le terminal SSH ne voit pas les PID applicatifs dans son espace de processus. |
| Contrôle final | HTTPS `/api/health` et `/api/ready` : **200**, `ok` et `ready`, à 15:18:47 UTC. Contrôle authentifié `check-witness-observer` : **passed**, `observe_only`, `started:false`, témoin externe non confirmé et fermetures désactivées. |
| Kit courant | ZIP généré depuis le checkout actif : **53 022 octets**, six fichiers, action `Activer-le-temoin.cmd`, aucune capacité de nouvel appariement. SHA-256 du script embarqué : `abfb5daac7a5815ffdbe9e8e26b59b50c647eefd24e2e32610c50f2a70ac1bb1`, conforme à la source corrigée. Le téléchargement authentifié dans le navigateur et l'exécution sur le PC personnel restent distincts et non confirmés. |

Deux tests locaux de composition du kit et la syntaxe de 526 sources réussissent. Aucun nouvel appariement, contrat, permission, clé, message réel, mail, import SQL ou effacement de compte pour ce correctif. Les 66 anciennes PR déjà intégrées restent closes.

## Paramètres et états à préserver

- Checkout actif : `/srv/customer/jessiemessage-operator/windows-existing-pc-update-0702-d1720d8a` ; parent public 3000, enfant configuré en boucle locale 3001.
- Run permanent : `bash /srv/customer/jessiemessage-private/start-primary-witness-observer-0702-d1720d8a.sh`, mode 0700 ; SHA-256 `c6a51eb48e35104936f57f81ddef43176a38888e03d037da9c1124f6e1a49377`.
- Journal : `/srv/customer/jessiemessage-private/jm0702-witness-observer.log`. Moniteur lu à `1792423111896` : `current / OK`, zéro incident ; observation à `1792423122631` : `enrollment_required`, `externalWitnessConfirmed:false`, `closuresEnabled:false`.
- Contrat : `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1/contract/witness-genesis.json`, **813 octets, 0600**, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10`, inchangé.
- Permission dans `enrollment` : origine **968 octets, 0600**, SHA-256 `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` ; état **226 octets, 0600**, SHA-256 `ac4c7287aaaa5abc758ddb4cc8b8fd86d433c6c8a187e048c7dc12a6dba4b728`, inchangés. Phase **ready**, révision 1 : la tentative PC non confirmée n'a pas consommé l'autorisation.
- Repli : `/srv/customer/jessiemessage-private/manager-before-existing-pc-update-0702.json`, mode 0600. Checkpoint privé : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`.

**Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`.** Ne pas réinitialiser les états, réapparier le PC ou régénérer une clé. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd` dans l'environnement des commandes natives, en plus de l'option CLI. La messagerie quotidienne ne dépend pas de la présence continue du PC. `recette.jessiemessage.com` partage runtime et base du principal ; ce n'est pas une cible de restauration isolée.

## Prochaine action exacte — lot B

**Sur le PC habituel : fermer l'ancienne fenêtre d'échec, puis Administration → Sauvegardes → Gérer cette destination → Mettre à jour le PC. Télécharger à nouveau le ZIP, l'extraire entièrement dans un nouveau dossier, puis ouvrir `Activer-le-temoin.cmd`.** Le nouveau kit est nécessaire : l'ancien ZIP contient toujours le défaut. Le lanceur installe lui-même les scripts corrigés ; aucun autre lancement préalable n'est requis.

Conserver configuration DPAPI, archives, reçus, dossier `temoin` et marqueurs existants. Ne pas utiliser « Raccorder Windows » pour cette action. Si une ancienne page reste ouverte, Ctrl+F5 recharge son code ; le bouton « Actualiser la page » ne relit actuellement que les données.

Relever la fenêtre « Témoin initialisé sur ce PC » puis contrôler séparément l'observation fraîche acceptée sur le serveur. En cas d'échec, sa nouvelle phase affichée sert au diagnostic. En cas de réponse perdue, relire marqueurs PC et état serveur avant toute autre tentative. Une preuve CI ne remplace pas ce constat sur le PC personnel.

Le lot B demande aussi le déchiffrement de l'archive courante avec `Verifier.cmd` et le trousseau GPG existant. Ni la génération du kit, ni la CI Windows, ni le reçu de copie ne prouvent ce résultat personnel. Ce contexte Windows ne peut pas être certifié depuis le serveur.

## Sauvegardes et suite

Le relevé initial a confirmé l'archive `capture-1792386945745-204e0e8e073b6131`, **402 552 octets**, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`, horaire **05:15 UTC**, et reçu PC `1792419653468` concordant. Ce reçu daté n'a pas été relu pendant la clôture du correctif ; le moniteur final n'est pas un nouveau reçu. Déchiffrement courant, témoin externe frais et import natif isolé restent non confirmés. Les preuves antérieures du coffre et de la restauration 0.46 gardent leur portée historique.

Ne pas lancer `capture --offline` pendant le service. Garder le superviseur existant. Les mails déjà confirmés reçus restent acquis. Invitations, messages/photos, notifications, récupération du mot de passe, fiches, diffusions individuelles, réponses rapides et exports sont conservés avec leurs limites documentées. Jessie en France, sans structure ; conversations jusqu'à fermeture définitive, hors suppressions volontaires. Ne pas redemander ces choix ou une permission générale de développement.

Après B : récupération/réconciliation (C), inspection SQL/import isolé (D), fermeture/conservation/notice (E), alerte externe de panne totale (F), recette sur deux appareils (G), selon le plan. Une ancienne fenêtre d'erreur du raccourci Paramètres parle encore de « nouveau kit » ; elle ne réapparie rien automatiquement et n'est pas utilisée par l'action d'activation actuelle. Clarification facultative ultérieure.
