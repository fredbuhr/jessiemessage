# Reprendre JessieMessage

**État courant unique — 19 octobre 2026, tentative PC non confirmée vers 15:00 UTC (17:00 Europe/Paris). Étape 4/6 ; lot A terminé, lot B : correction Windows 0.70.2 en validation.** Le service reste en 0.70.1. Le test Windows du correctif précédent ne couvrait pas le remplacement de scripts déjà présents. Ce cas échoue désormais de façon reproduite sous PowerShell 5.1 à `File.Replace`, avant initialisation. Ne pas réessayer l’ancien ZIP. Les fermetures réelles restent désactivées.

Lire le [plan](PLAN-IMPLEMENTATION.md) et les [règles de reprise](../AGENTS.md). Les [preuves de clôture](activation-proofs/jm0701-activation.json), la [CI](verification-proofs/jm0701-ci.json) et le [relevé initial](activation-proofs/interruptions-20261019-baseline.json) distinguent les observations datées. L'[historique](REPRISE-HISTORIQUE-20261019.md) ne fournit pas les commandes courantes.

## Code et service vérifiés

| État | Résultat |
|---|---|
| Code fonctionnel | **0.70.1**, source `0fd6c30658f3b6434e8833743da564ea84a47878`, arbre `b35ad5ccabbb772c6163a52489b84fa1c3482b18`. |
| Fusion | [PR #90](https://github.com/fredbuhr/jessiemessage/pull/90), merge `bfa77a2559cfd1ab02bd53cb419509e01fa26c7a`. Les commits documentaires ultérieurs ne changent pas le runtime épinglé. |
| CI du code fusionné | Six jobs réussis : [application/Linux/MariaDB/Chrome](https://github.com/fredbuhr/jessiemessage/actions/runs/39270343447) et [Windows](https://github.com/fredbuhr/jessiemessage/actions/runs/39270343496), relus par l'API pendant cette reprise. |
| Hébergement | Manager **Actif**, Build et Run persistés sur cette source ; checkout propre. Journal du lanceur : enfant et superviseur démarrés, observations fraîches sans incident. Le terminal SSH ne voit pas leurs PID dans son espace de processus ; cette limite est conservée dans les preuves. |
| Disponibilité | `/api/health` et `/api/ready` : HTTPS **200**, respectivement `ok` et `ready`, depuis l'hébergement à 14:43 UTC. |
| Contrôle privé | `check-witness-observer` : **passed**, `observe_only`, `started:false`, `externalWitnessConfirmed:false`, `closuresEnabled:false`. Lecture seule, sans préparation ni redémarrage. |
| Kit Windows | Deux tests de composition réussis sur l'hébergement depuis la source déployée. Téléchargement par la vraie interface non effectué : le navigateur demande une connexion administrateur. Aucun téléchargement authentifié n'est prétendu. |

Le correctif conserve le raccordement du PC après une erreur de copie/réseau. Les **66 anciennes PR déjà intégrées** ont été fermées au contrôle initial ; ne pas les réappliquer. Aucun nouveau raccordement, contrat, permission, clé, mail, restauration ou effacement réel pendant cette clôture.

## Paramètres et états à préserver

- Checkout : `/srv/customer/jessiemessage-operator/interruption-reconciliation-0701-0fd6c306` ; parent public 3000, enfant configuré en boucle locale 3001.
- Run permanent : `bash /srv/customer/jessiemessage-private/start-primary-witness-observer-0701-0fd6c306.sh` ; **1 152 octets, 0700**, SHA-256 `25894381fd826936cc8a2d8cd700900e7d58023bb2cc30e87071cd35a1b5fadc`.
- Journal : `/srv/customer/jessiemessage-private/jm0701-witness-observer.log`. Derniers relevés lus : moniteur `current / OK`, aucun incident ; observation `enrollment_required`, témoin externe non confirmé et fermetures désactivées.
- Contrat : `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1/contract/witness-genesis.json`, **813 octets, 0600**, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10`, inchangé.
- Permission dans `enrollment` : origine **968 octets, 0600**, SHA-256 `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` ; état **226 octets, 0600**, SHA-256 `ac4c7287aaaa5abc758ddb4cc8b8fd86d433c6c8a187e048c7dc12a6dba4b728`, inchangés ; phase `ready` au relevé initial et précontrôle final réussi.
- Repli précédent : `/srv/customer/jessiemessage-private/manager-before-interruption-correction-0701.json`, **428 octets, 0600**. Le checkpoint privé existant est `/srv/customer/jessiemessage-private/jm0701-interruption-correction.json`.

**Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`.** Ne pas supprimer les états, réapparier le PC ou régénérer une clé. Les commandes natives conservent `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`, en plus de l'option CLI. La messagerie quotidienne ne dépend pas de la présence continue du PC. `recette.jessiemessage.com` partage runtime et base du principal et n'est pas une cible de restauration isolée.

## Prochaine action exacte — lot B

**Avant une nouvelle tentative PC : terminer la validation et la publication du correctif 0.70.2 ([PR #92](https://github.com/fredbuhr/jessiemessage/pull/92)).** À 15:01:38 UTC, contrat et permission conservent leurs empreintes ci-dessus ; permission `ready`, révision 1, aucune tentative consommée. Le moniteur reste `current / OK`. Ne pas réinitialiser ces états.

Après déploiement vérifié du kit corrigé : **Sur le PC habituel : Administration → Sauvegardes → Gérer cette destination → Mettre à jour le PC → extraire entièrement le ZIP → ouvrir `Activer-le-temoin.cmd`.** Le lanceur installe lui-même la mise à jour. Ne pas utiliser « Raccorder Windows » pour cette action. Conserver configuration DPAPI, archives, reçus, dossier `temoin` et marqueurs existants.

Relever la fenêtre « Témoin initialisé sur ce PC » puis contrôler séparément l'observation fraîche acceptée sur le serveur. En cas de réponse perdue, relire les marqueurs PC et l'état serveur avant toute autre tentative. Une attente de cette action locale n'est ni une panne du service ni un échec du déploiement.

Le lot B demandera aussi la vérification locale de l'archive courante avec `Verifier.cmd` et le trousseau GPG existant. Ni la CI Windows, ni la génération du kit, ni le reçu de copie ne prouvent ce déchiffrement personnel. Ces opérations nécessitent le contexte Windows du PC ; elles ne peuvent pas être certifiées depuis le serveur.

## Sauvegardes : acquis et limites distincts

Le relevé initial a confirmé l'archive `capture-1792386945745-204e0e8e073b6131`, **402 552 octets**, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`, horaire **05:15 UTC**, et le reçu PC `1792419653468` concordant. Ce reçu daté n'a pas été relu pendant la clôture ; le moniteur final ne constitue pas un nouveau reçu. Déchiffrement courant, témoin externe frais et import natif isolé courant restent non confirmés. Les preuves personnelles antérieures du coffre et de la restauration 0.46 gardent leur portée historique.

Ne pas lancer `capture --offline` pendant le service. Garder le superviseur existant. Les mails déjà confirmés reçus restent acquis.

## Suite du développement

Invitations, messages/photos, notifications, récupération du mot de passe, fiches, diffusions individuelles, réponses rapides et exports restent acquis avec leurs limites documentées. Jessie en France, sans structure ; conversations jusqu'à fermeture définitive, hors suppressions volontaires. Ne pas redemander ces choix ou une permission générale de développement.

Après B : barrière de récupération/réconciliation (C), inspection SQL/import isolé courant (D), fermeture/conservation/notice (E), alerte externe de panne totale (F), recette sur deux appareils (G). Le plan fixe les critères. Ne pas réouvrir A pour avancer ces lots.

Une ancienne fenêtre d'erreur du raccourci Windows Paramètres parle encore de « nouveau kit ». Elle ne réapparie rien automatiquement et `Activer-le-temoin.cmd` utilise une autre fonction. Clarification facultative ultérieure, sans bloquer l'action PC actuelle.
