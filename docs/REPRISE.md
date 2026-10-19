# Reprendre JessieMessage

**État courant unique — 19 octobre 2026, 17:30:55 UTC (19:30:55 Europe/Paris). Étape 4/6 ; lots A/B clos. C2 (0.72.0) codé, fusionné, déployé et vérifié. Service en observation, `closuresEnabled:false`. Suite : C3, parent explicite de récupération après redémarrage non vide ; C reste ouvert.**

Lire le [plan](PLAN-IMPLEMENTATION.md), les [règles de reprise](../AGENTS.md), les [preuves C2](verification-proofs/jm072-verification.json) et le [parcours de récupération](witness-recovery-072.md). Les preuves [0.70.2](verification-proofs/jm0702-verification.json), [C1](verification-proofs/jm071-verification.json) et l'[historique](REPRISE-HISTORIQUE-20261019.md) conservent leur portée datée ; leurs anciens lanceurs ne sont plus les commandes courantes.

## Code, validation et service

| État | Résultat vérifié |
|---|---|
| Source active | **0.72.0**, `94fb7882cf74eb5f2ec165e67833ac2e7cdf13f3`, arbre `c6d304e49209a1194d91c0992096e59ff3685b6e`, checkout propre. |
| Fusion | [PR #94](https://github.com/fredbuhr/jessiemessage/pull/94), merge `6a829880543fe7280f3ca52dcbc0c5d702b37ac0`, même arbre revu. Les commits documentaires suivants ne changent pas le runtime épinglé. |
| CI candidat | [Run 39292971066](https://github.com/fredbuhr/jessiemessage/actions/runs/39292971066) : cinq jobs réussis. Tests généraux : **2 839 réussis, aucun échec, 30 wrappers SQL ignorés** dans ce job ; **410/410 sans omission sur chaque MariaDB** 10.11 et 11.4 ; Chrome et authentification HTTPS réussis. Syntaxe de 528 sources, Unix/procfs natifs et collisions de socket vérifiés. |
| CI main | [Run 39293603482](https://github.com/fredbuhr/jessiemessage/actions/runs/39293603482) : cinq jobs réussis sur le merge, arbre identique. |
| Parcours réel en CI | Vrai CLI → Unix → parent → HTTP du PC synthétique → témoin durable → quarantaine, dans chaque MariaDB. Cinq défis distincts ; reçu terminé plus récent que la capture conservé malgré journal local vide ; marqueur de quarantaine bloquant ; source SQL inchangée ; enfant non redémarré ; disponibilité HTTP préservée. |
| Hébergement | Build achevé à **19:29 Europe/Paris**, sans réinstaller les dépendances inchangées. Manager : Node actif, Build épinglé ; nouveau journal : enfant et superviseur démarrés. Contrôle privé : dossier **0700**, socket **0600**, UID **33**. |
| Santé | HTTPS `/api/health` et `/api/ready` : **200**, `ok` et `ready`, relus à **17:29:36 UTC**. Moniteur `current / OK` dans le relevé à 17:30:55 UTC. |
| Preuve PC fraîche C2 | **17:30:06.642 UTC** : `createErasureContinuity.recover()` → client Unix par défaut → parent hébergé → PC existant. Réponse originale authentifiée sur défi neuf, **révision 1, zéro reçu**, `reconciliationRequired:true`, `started:false`. Aucune copie de quarantaine ni restauration SQL réelle effectuée sur l'hébergement. Cette lecture ponctuelle est distincte du tick d'observation. |

Le précontrôle authentifié du nouveau lanceur a réussi à **17:23:18 UTC**, avant Build ; il ne constituait pas une preuve de présence du PC. Le contrat, l'origine de permission et l'état `spent / 2` ont été relus après Build, inchangés et en 0600. Le checkpoint privé existant a été mis à jour et relu en 0600 avec `developmentC2.status:deployed_verified`.

## C1 et C2 : portée acquise

C1 ([PR #93](https://github.com/fredbuhr/jessiemessage/pull/93)) impose une preuve fraîche avant chaque ouverture du runtime lorsqu'un propriétaire de fermeture est fourni : première ouverture, reprise après capture et après fermeture. Le code est maintenant embarqué dans 0.72.0, mais **le propriétaire reste non composé et non activé** ; le CLI actif fournit toujours `closureOperations:null`.

C2 raccorde le vrai CLI `scripts/restore-private-operations.mjs` au transport PC du parent. La confirmation `--confirm-plan-sha256` couvre capsule, source, cible, chemins, état local et tête indépendante. La comparaison conserve les reçus plus récents que la capture ; chaque frontière demande une preuve neuve. Un succès annonce `externalRegistryContinuityVerified:true`, **`reconciliationRequired:true`, `sqlRestored:false`, `started:false`**. Les octets et le rattachement source des enveloppes restent intacts. Le marqueur de quarantaine bloque toute ouverture de cible.

**C n'est pas clos.** Construction, contrôle et tick de l'observateur restent limités au registre local initial vide. Le relais de cette instance peut lire une tête PC plus récente ; il ne fournit pas encore un parent redémarrable après un journal source non vide ou perdu. La réconciliation SQL cible, l'import isolé et la procédure de perte totale de l'hôte restent à terminer. Ne pas desserrer le démarrage normal pour contourner cette limite.

## Preuves personnelles B — acquises, à conserver

- Capture `image(20261019-162033).png` : **`TEMOIN_INITIALISE`**, fenêtre de réussite, raccordement et dossier conservés. Journal serveur à **16:23:38 UTC** : témoin `confirmed`, vérification complète `1792426871839`, observation `1792426995688`.
- Capture `image(20261019-163401).png`, reçue à **16:34:19 UTC** : **`DECHIFFREMENT_VERIFIE`**, contenu identique à la capture pour `JessieMessage-capture-1792386945745-204e0e8e073b6131.tar.gz.gpg`, datée du 19 octobre, 07:15 heure du PC. **402 552 octets**, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`.
- Reçu de copie et archive concordants relus à **16:24:40 UTC** : reçu `1792426743461`, dernier contact `1792426862668`, quatre archives, cadence **05:15 UTC**. Les preuves sont datées ; elles ne certifient pas un import SQL ou les captures futures.

Aucun nouvel appariement, contrat, permission, clé, message réel, mail, import SQL ou effacement de compte pour C2. Aucun nouveau contrôle personnel de cette archive n'est demandé. Conserver configuration DPAPI, archives, reçus, dossier `temoin` et marqueurs. Les réussites du kit Windows 0.70.2 et ses 90 assertions restent consignées dans les preuves historiques.

## Paramètres et états à préserver

- Checkout actif : `/srv/customer/jessiemessage-operator/witness-recovery-control-072-94fb7882` ; parent public 3000, enfant en boucle locale 3001.
- Run permanent : `bash /srv/customer/jessiemessage-private/start-primary-witness-observer-072-94fb7882.sh`, mode **0700**, SHA-256 `94c6109b76352f24c9678e2ab85086fe5e7a6906350fd237b3a1751d1c61b495`.
- Journal : `/srv/customer/jessiemessage-private/jm072-witness-recovery.log`. Contrôle : `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1/control/witness-recovery.sock`. Le sous-dossier `control` est exclusivement réservé à l'IPC temporaire, sans donnée métier ; voir son contrat de nettoyage dans [C2](witness-recovery-072.md).
- Contrat : `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1/contract/witness-genesis.json`, **813 octets, 0600**, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10`.
- Permission dans `enrollment` : origine **968 octets, 0600**, SHA-256 `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1`. État **256 octets, 0600**, SHA-256 `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a`, phase **spent**, révision **2**. Ne jamais rétablir l'ancien état `ready`.
- Repli avant C2 : `/srv/customer/jessiemessage-private/manager-before-witness-recovery-072.json`, mode **0600**, conserve Run/Build 0.70.2. Checkpoint privé existant : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`, section `developmentC2`.

**Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`.** Ne pas réinitialiser les états, réapparier le PC ou régénérer une clé. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd` dans l'environnement des commandes natives. La messagerie quotidienne ne dépend pas de la présence continue du PC. `recette.jessiemessage.com` partage runtime et base du principal ; ce n'est pas une cible de restauration isolée.

## Prochaine action exacte — C3

Construire et éprouver **un mode explicite de parent de récupération**, sous provenance originale et permission `spent`, démarrable après redémarrage avec un journal non vide ou perdu. Il expose uniquement le transport PC existant et le contrôle Unix `recover-only`, sans enfant applicatif, producteur, capture ou tick d'observation initial vide. Observation, initialisation et réservation gardent leurs préconditions actuelles. Aucune bascule du service réel vers ce mode pendant son développement.

Critère de fin : vrai processus redémarré → vrai CLI `check/restore` → défi PC neuf → reçu terminé plus récent conservé en quarantaine, avec marqueur bloquant. PC absent, rejeu, dérive de provenance ou annulation refusent la récupération. L'absence effective des comptes dans la cible relève ensuite de la réconciliation et de l'essai SQL isolé de D ; ne pas annoncer C terminé à la seule présence du canal.

Garder `closuresEnabled:false`. Ne pas lancer `capture --offline` pendant le service. Conserver le superviseur et la cadence existants ; aucun nouveau mail de test ou questionnaire général. Jessie en France, sans structure ; conversations jusqu'à fermeture définitive, hors suppressions volontaires. Les mails déjà reçus restent acquis.

Suite : C3, puis inspection SQL qualifiée/import isolé (D) pour achever la réconciliation C ; fermeture/conservation/notice (E), alerte externe de panne totale (F), recette sur deux appareils (G), selon le plan. Les preuves du coffre et de la restauration 0.46 gardent leur portée historique distincte.
