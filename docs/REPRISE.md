# Reprendre JessieMessage

**État courant unique — 19 octobre 2026, 16:34:19 UTC (18:34:19 Europe/Paris). Étape 4/6 ; lots A et B clos. 0.70.2 livrée ; initialisation personnelle, échange indépendant du témoin et déchiffrement de l'archive courante confirmés. Prochain objectif : lot C, raccordement des contrôles de récupération et de réconciliation.** Les fermetures réelles restent désactivées.

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
| Contrôle final | HTTPS `/api/health` et `/api/ready` : **200**, `ok` et `ready`, relus à 16:25:12 UTC. Le précontrôle authentifié du déploiement à 15:18:47 UTC reste acquis ; la nouvelle preuve du témoin vient du journal d'observation actif, ci-dessous. |
| Kit courant et PC | ZIP généré depuis le checkout actif : **53 022 octets**, six fichiers, action `Activer-le-temoin.cmd`, aucune capacité de nouvel appariement. SHA-256 du script embarqué : `abfb5daac7a5815ffdbe9e8e26b59b50c647eefd24e2e32610c50f2a70ac1bb1`, conforme à la source corrigée. Capture personnelle `image(20261019-162033).png` : console `TEMOIN_INITIALISE` et fenêtre « Témoin initialisé sur ce PC », dossier et raccordement conservés. L'empreinte des fichiers sur le PC n'a pas été relue directement. |
| Témoin indépendant | Journal actif relu à **16:23:38 UTC** : `confirmed`, `externalWitnessConfirmed:true`, `observe_only`, `closuresEnabled:false`. Dernière vérification complète `1792426871839` ; observation fraîche `1792426995688`. Cette preuve serveur est distincte de la fenêtre Windows. |
| Déchiffrement personnel | Capture `image(20261019-163401).png`, reçue à **16:34:19 UTC** : fenêtre et statut **`DECHIFFREMENT_VERIFIE`**, contenu déchiffré identique à la capture pour `JessieMessage-capture-1792386945745-204e0e8e073b6131.tar.gz.gpg` (19 octobre, 07:15 heure du PC). Cette preuve clôt B pour cette archive ; elle ne certifie pas un import SQL ni les captures futures. |

Deux tests locaux de composition du kit et la syntaxe de 526 sources réussissent. Aucun nouvel appariement, contrat, permission, clé, message réel, mail, import SQL ou effacement de compte pour ce correctif. Les 66 anciennes PR déjà intégrées restent closes.

## Paramètres et états à préserver

- Checkout actif : `/srv/customer/jessiemessage-operator/windows-existing-pc-update-0702-d1720d8a` ; parent public 3000, enfant configuré en boucle locale 3001.
- Run permanent : `bash /srv/customer/jessiemessage-private/start-primary-witness-observer-0702-d1720d8a.sh`, mode 0700 ; SHA-256 `c6a51eb48e35104936f57f81ddef43176a38888e03d037da9c1124f6e1a49377`.
- Journal : `/srv/customer/jessiemessage-private/jm0702-witness-observer.log`. Moniteur lu à `1792427012309` : `current / OK`, zéro échec consécutif, aucun incident actif ; observation à `1792426995688` : `confirmed`, `externalWitnessConfirmed:true`, `closuresEnabled:false`. Dernière vérification complète à `1792426871839`. Ces constats sont datés et ne promettent pas la présence future du PC.
- Contrat : `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1/contract/witness-genesis.json`, **813 octets, 0600**, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10`, inchangé.
- Permission dans `enrollment` : origine **968 octets**, SHA-256 `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1`, inchangée. État désormais **256 octets**, SHA-256 `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a`, phase **spent**, révision **2**, après initialisation personnelle réussie. La phase `ready` et son ancienne empreinte étaient le constat antérieur au succès ; ne pas tenter de les rétablir. Les permissions de fichiers 0600 avaient été vérifiées au déploiement ; elles n'ont pas été relues dans ce relevé de contenu.
- Repli : `/srv/customer/jessiemessage-private/manager-before-existing-pc-update-0702.json`, mode 0600. Checkpoint privé : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`.

**Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`.** Ne pas réinitialiser les états, réapparier le PC ou régénérer une clé. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd` dans l'environnement des commandes natives, en plus de l'option CLI. La messagerie quotidienne ne dépend pas de la présence continue du PC. `recette.jessiemessage.com` partage runtime et base du principal ; ce n'est pas une cible de restauration isolée.

## Prochaine action exacte — lot C

**Les trois preuves de B sont acquises et consignées.** Aucun nouveau contrôle personnel de cette archive n'est demandé. Le contrôle GPG s'est déroulé sur le PC avec le trousseau existant, sans transmission de clé ou de phrase.

Commencer C par une lecture ciblée du vrai démarrage et du CLI de restauration, des contrôles de continuité déjà codés et des tests associés. Choisir une seule sous-étape bornée, la valider avant intégration et garder `closuresEnabled:false`. La messagerie quotidienne doit rester disponible lorsque le PC est éteint ; une récupération incertaine reste en quarantaine. La restauration native isolée relève de D.

Conserver configuration DPAPI, archives, reçus, dossier `temoin` et marqueurs existants. Ne répéter ni activation, ni appariement, ni déchiffrement de cette archive pour retrouver un état déjà prouvé. Les preuves serveur sont datées : C doit demander sa propre fraîcheur au moment d'une récupération, sans transformer ce constat historique en autorisation permanente.

## Sauvegardes et suite

Le service de copie a été relu sans mutation à **16:24:40 UTC** : quatre archives, horaire **05:15 UTC**, archive courante `capture-1792386945745-204e0e8e073b6131`, **402 552 octets**, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. Nom proposé par le vérificateur : `JessieMessage-capture-1792386945745-204e0e8e073b6131.tar.gz.gpg`. PC raccordé et activé ; dernier reçu `1792426743461` concordant par identifiant/taille/empreinte ; dernier contact `1792426862668`. Déchiffrement de cette archive confirmé ensuite par la capture personnelle ; import natif isolé toujours non confirmé. Les preuves antérieures du coffre et de la restauration 0.46 gardent leur portée historique.

Ne pas lancer `capture --offline` pendant le service. Garder le superviseur existant. Les mails déjà confirmés reçus restent acquis. Invitations, messages/photos, notifications, récupération du mot de passe, fiches, diffusions individuelles, réponses rapides et exports sont conservés avec leurs limites documentées. Jessie en France, sans structure ; conversations jusqu'à fermeture définitive, hors suppressions volontaires. Ne pas redemander ces choix ou une permission générale de développement.

Après B : récupération/réconciliation (C), inspection SQL/import isolé (D), fermeture/conservation/notice (E), alerte externe de panne totale (F), recette sur deux appareils (G), selon le plan. Une ancienne fenêtre d'erreur du raccourci Paramètres parle encore de « nouveau kit » ; elle ne réapparie rien automatiquement et n'est pas utilisée par l'action d'activation actuelle. Clarification facultative ultérieure.
