# Node 24.22.0 — activation pour JessieMessage 0.86

**Activé et vérifié le 20 octobre 2026 à 14:41:34.716387 UTC / 16:41:34 Europe/Paris.** L’ancienne dette Node 24.15.0 est levée pour ce service au 20 octobre ; la maintenance annoncée du 21 octobre reste distincte. Application 0.86, code et dépendances inchangés ; aucun nouveau service, migration ou budget. [Pins courants](REPRISE.md).

## Application et binaire

| Élément | Valeur vérifiée |
| --- | --- |
| Application | 0.86, checkout/source `c61d1eecfefe786254416652877ba82d30cf4c90`, arbre `78c8e46224503b0691b381bf07c5aefd51ca5c7f` ; diff applicatif vide entre cette source et le commit CI sur package/public/server/scripts/tests. |
| Runtime actif | [Node officiel 24.22.0 LTS](https://nodejs.org/en/blog/release/v24.22.0), publié le 14 octobre 2026 ; `/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node`. Le binaire système fournisseur reste inchangé ; seul JessieMessage utilise ce Node privé. |
| Archive Linux x64 | `node-v24.22.0-linux-x64.tar.xz`, 32 015 600 octets ; SHA-256 `cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008`. |
| Binaire extrait | SHA-256 `67ca5783f8bb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a6506751c`. |
| Vérification de distribution | Concordance avec le checksum officiel vérifiée ; **signature GPG non vérifiée**. Aucune authentification GPG revendiquée. |
| Composition | Un seul service Manager, sans NVM ; lanceur `/srv/customer/jessiemessage-private/start-primary-node2422-c61d1eec.sh`, SHA-256 `e54392621a7f63f7665f44c191783d467ccb214630e65449fb4ae57138cc9881` ; journal `jm086-node2422.log`. |

## Qualification et activation

| Contrôle | Résultat |
| --- | --- |
| CI Node épinglé | [Run 39439751937](https://github.com/fredbuhr/jessiemessage/actions/runs/39439751937), source `3545de2931b3acc4d43878236bf2f4fe283ba8a0` : quatre `setup-node` épinglés à 24.22.0, sans changement métier ; **5/5 réussis**, tous confirmés sous 24.22.0 : général 3 101 réussites/35 wrappers SQL ignorés, Chrome 164/164, HTTPS 2/2, MariaDB 466/466 chacune sans omission ; zéro échec, syntaxe 568 et build validés. |
| Plateforme, JPEG, fichiers privés | Précontrôle 20 octobre 14:32:58.849424 UTC : `checks_passed`, trois contrôles `node_runtime`, `sharp_jpeg`, `scratch_filesystem` réussis, mode `linux-dirfd`. |
| Décodeur photo | PNG synthétique normalisé en JPEG et vignette par le vrai fork ; `process.execPath` et `decoderExecPath` sont exactement `/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node`, version v24.22.0. Aucun média client ni SQL. |
| Fermetures locales | `local_closure_precheck/passed` sous le nouveau binaire ; aucune fermeture en attente, aucun démarrage/effacement, continuité externe non vérifiée. |
| Service Manager | Build normal réussi à 16:39 Europe/Paris, Node actif, sans réinstallation ni migration ; reçu unique `recurring_supervisor/started` du parent confirmant v24.22.0. Activation vérifiée à 16:41:34. |
| Contrôles HTTPS | 26 réponses conformes sur deux origines : quatre santé/disponibilité 200, JSON exact et `no-store` ; huit API auth/accès/chat 401 ; quatorze ressources publiques 200 identiques au code. HSTS unique et aucun `Set-Cookie` partout. Dix empreintes sensibles et identité PC préservées ; moniteur OK (`checkedAt:1792507260426`). |
| Repli | Ancien lanceur 0.86 sous Node 24.15.0 conservé : son réemploi rouvrirait A01. Ancien repli applicatif 0.85 préservé ; commandes dans REPRISE. |

[Preuve Manager](verification-proofs/jm086-node2422-manager.jpg) : JPEG 59 901 octets, SHA-256 `f7c346eaab877845dc7c225b251ed08a5e88abc05abecf2054eac389d26ca31f`. Les contrôles HTTP ne sont pas des GET privés authentifiés ; le reçu du parent ne constitue pas une nouvelle preuve de version propre à l’enfant applicatif.

## Limite de maintenance

La mise à niveau effective de ce service de 24.15.0 vers 24.22.0 est vérifiée. Elle ne prouve pas la correction de vulnérabilités futures.

Le [bulletin officiel Node](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) annonce des correctifs de sévérité maximale **HAUTE** pour les branches 24.x, 22.x et 26.x le **21 octobre 2026 ou après**. Au 20 octobre, cette publication est annoncée, non livrée : elle constitue une prochaine maintenance distincte, sans résolution anticipée.

La V1 applicative reste décrite dans le [bilan 0.86](production-086.md). A07/PC et A08 restent différés et non résolus, sans préalable aux lots messages. Aucun nouveau test mail/PC, envoi réel, effacement, restauration ou garantie historique ajouté ; gardes, clés, journaux, marqueurs, autorité et D1 préservés.
