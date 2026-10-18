# Reprendre JessieMessage

**0.56.0 est activée le 18 octobre 2026 à 18:59 Europe/Paris. Mon PC est raccordé et reçoit la dernière sauvegarde chiffrée.** L’écran Administration → Sauvegardes propose maintenant une vérification graphique du déchiffrement sur le PC. La copie indépendante est acquise par reçus du collecteur ; le déchiffrement personnel de cette archive reste à constater. Ne pas refaire le raccordement accepté.

Lire le [relevé 0.56](backup-verification-056.md), les [preuves structurées](activation-proofs/jm056-activation.json) et le [plan d’exploitation](production-readiness-2026-10-17.md). Les [destinations 0.55](backup-destinations-055.md) restent en service. Les relevés antérieurs conservent leur valeur historique.

## Source et exécution

| Élément | Référence |
| --- | --- |
| Dépôt complet | `https://github.com/fredbuhr/jessiemessage`, branche `main` |
| Version et repère | `0.56.0`, `release/0.56.0` |
| Runtime et superviseur exécutés | `2faf32ce1bf22553d6dd62f053ebcdc76bdc9a5b`, arbre `8bc8029e0b93166ee33ded9cdb6ab65647fb5b40` |
| Intégration applicative | [PR #71 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/71), fusion `548f419b41c9ecb01797659ea2c97eeaddebd0d1`, même arbre |
| Banc de test sur main | [PR #72 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/72), fusion `8bdb5e261fa5ddc14cd7df9f18de95849decf56b`, arbre `13be35321b60c1f8c0bd0f7b732395bb8fda6a96`. Différences limitées à deux fichiers de tests Chrome ; fichiers de l’application et du kit identiques au runtime |
| Checkout actif | `/srv/customer/jessiemessage-operator/backup-verification-056-2faf32ce` |
| Profil | `messaging-photos-notify-recovery-crm-broadcast`, déploiement `primary-transition`, Node 24, port 3000 |
| Données | Schéma 30, six configurations privées, mêmes comptes et clés |

Les commits de documentation ultérieurs sont distincts du code exécuté. Préparer les futurs changements depuis main, dans un autre checkout, puis épingler leur commit et leur arbre propres. Le principal `https://jessiemessage.com` et la recette `https://recette.jessiemessage.com` partagent runtime et données ; la recette n’est pas une base de test isolée. Les sauvegardes administrées sont réservées au principal.

Configurations : `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851`. Captures, alertes et état de copie : `/srv/customer/jessiemessage-private/recurring-backup-052`, mode 0700 ; fichiers privés en 0600. Aucune clé privée GPG sur le serveur.

Run Manager : `bash /srv/customer/jessiemessage-private/start-primary-backup-verification-056-2faf32ce.sh`. Lanceur 0700, 851 octets, SHA-256 `75596f26fcd861e401f07d99507d41608ca69db02f55887f9bd5ac5926918950`.

Build :

```sh
cd /srv/customer/jessiemessage-operator/backup-verification-056-2faf32ce && test "$(git rev-parse HEAD)" = 2faf32ce1bf22553d6dd62f053ebcdc76bdc9a5b && test "$(git rev-parse HEAD^{tree})" = 8bc8029e0b93166ee33ded9cdb6ab65647fb5b40 && test -z "$(git status --porcelain)" && npm run check
```

[Manager Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) ; [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Cycle normal de Build, sans réinstallation des dépendances ; aucune réinitialisation de site.

## Étape personnelle immédiate : vérifier le déchiffrement

1. Sur le PC Windows, ouvrir [Administration → Sauvegardes](https://jessiemessage.com/admin/backups) dans la session administrateur habituelle.
2. Dans « Vérifier le déchiffrement sur le PC », télécharger la vérification Windows. Extraire tout le ZIP puis ouvrir **Verifier.cmd**.
3. Choisir la copie chiffrée indiquée. Le trousseau existant `Downloads\JessieMessage-recuperation-052` est proposé ; Changer permet de le retrouver s’il a été déplacé. GPG peut ouvrir son Pinentry pour la phrase, exclusivement sur le PC.

Le succès attendu est **DECHIFFREMENT_VERIFIE**. Il confirme cette archive uniquement. Le flux déchiffré est comparé en mémoire au nombre d’octets et au SHA-256 de la capture ; aucun fichier clair, export de clé ou envoi automatique du résultat. Le site conserve donc `decryptionStatus: not_checked`. Attendre le résultat personnel avant de consigner le déchiffrement comme acquis. La restauration SQL reste une preuve distincte.

Le collecteur installé en 0.55 continue ses passages toutes les quinze minutes et à l’ouverture de session : PC allumé, connecté et session Windows ouverte. Le raccourci Bureau **JessieMessage - Sauvegardes-…** change graphiquement son dossier. Le site permet nom/type, suspension/reprise et révocation ; un autre appareil se raccorde par un nouveau kit. Dossier synchronisé ou partage réseau possibles ; API cloud directes et collecteur Linux restent des extensions futures.

## Sauvegardes et alertes

- Capture quotidienne **05:15 UTC**. Ne jamais lancer `capture --offline` pendant que l’application tourne ; utiliser le superviseur.
- Deux archives disponibles, journal de quatre enregistrements ; dernière tentative `1792300533262`, dernier succès `1792300539807` (18 octobre à 05:15:39.807 UTC). Aucun checkpoint déclenché par cette activation.
- Dernière archive `capture-1792300533262-3ae62972be4d93f5` : chiffré 402 792 octets, SHA-256 `dbd63e6d1a7d91b0f9372a062a761d5e92a4b3abb9dd9a44ddbcdd330d983578`.
- Mon PC raccordé à **15:49:46.459 UTC**. Reçus conformes observés à **15:50:47.747**, **16:05:54.244**, puis **17:05:56.485 UTC après l’activation 0.56**. Intervalle entre les deux premiers : 906 497 ms. Copie courante confirmée, pas de synchronisation cloud certifiée.
- À **17:09:14.579 UTC**, source/version relues propres, même journal et dernier succès, aucun incident actif ni alerte en attente, reçu PC courant conservé.
- Deux mails [TEST] incident/rétablissement confirmés reçus le 18 octobre à **15:54:05 Europe/Paris**. Ne pas les renvoyer. Surveillance minute et reprise SMTP espacée jusqu’à quinze minutes.

Le moniteur historique mesure la capture et garde `copyStatus: not_checked` ; l’écran privé lit les reçus du collecteur séparément. Dans l’état d’alertes, `lastObservedAt` date la dernière transition persistée d’incident/rétablissement, pas chaque échantillon sain. Lire les mesures de console après le dernier démarrage pour vérifier la cadence.

## Validation et activation

CI de l’application : [source 39145729016](https://github.com/fredbuhr/jessiemessage/actions/runs/39145729016) et [PR 39145732843](https://github.com/fredbuhr/jessiemessage/actions/runs/39145732843), cinq jobs réussis chacune : **2 483 réussites et 27 wrappers SQL ignorés sur 2 510 cas**, **383/383** par MariaDB 10.11 et 11.4, **110/110 Chrome**, authentification HTTPS intégrée ; syntaxe de 447 fichiers et build conformes.

Windows PowerShell 5.1 : [source](https://github.com/fredbuhr/jessiemessage/actions/runs/39145728910), [PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39145732837) et [fusion applicative](https://github.com/fredbuhr/jessiemessage/actions/runs/39145940881) réussies. GPG natif portable épinglé, vrai déchiffrement binaire MDC et OCB, fenêtre graphique, annulation/échecs et absence de fichier clair ; clé synthétique jetable uniquement.

Le premier passage main a été interrompu après un démarrage Chrome trop long et une fixture conservée ouverte. La PR #72 rend sa fermeture systématique et borne le démarrage initial à 45 s ; les commandes ordinaires gardent 25 s. [CI du correctif 39147068115](https://github.com/fredbuhr/jessiemessage/actions/runs/39147068115) et [main 39147447171](https://github.com/fredbuhr/jessiemessage/actions/runs/39147447171) : cinq jobs réussis, dont 110/110 Chrome. Le passage PR a aussi réussi après une reprise ciblée demandée pour un HTTP 500 WebDriver dans un cas de transition existant ; cet écart reste tracé dans les preuves.

Hébergement : **163/163 tests natifs, sans saut**, préflight réel réussi sans démarrage/capture, puis kit de la véritable archive validé en mémoire (22 529 octets). Préparation finale à **16:38:15.858795 UTC** ; cycle Manager lancé à **16:59:31.136 UTC**, statut Actif et modification 18:59 Europe/Paris. Après le dernier message de démarrage, échantillons **16:59:50.577 et 17:00:50.635 UTC**, intervalle **60 058 ms**, `current / OK`, aucun incident ni alerte en attente.

**66/66 contrôles HTTPS et vingt-deux empreintes exactes** : première lecture à 17:03:19.420436 UTC, deux attentes de statut corrigées et relues à **17:05:34.598593 UTC**. Sur la recette, un POST inconnu reçoit le refus générique 405, tandis que le GET privé reste 404 ; le nouveau téléchargement reste réservé au principal. Le navigateur cloud n’a pas de session administrateur personnelle ; les parcours authentifiés sont testés en CI. [Preuve visuelle](activation-proofs/jm056-activation-20261018.jpg).

## Repli immédiat 0.55

Run/Build sauvegardés dans `/srv/customer/jessiemessage-private/manager-before-backup-verification-056.json`, mode 0600. Reprendre ces paramètres puis le cycle Manager normal :

- checkout `/srv/customer/jessiemessage-operator/backup-copies-055-088e6e1f` ;
- HEAD `088e6e1f1dc283a28ab81359f756d76eb0ac9d9b`, arbre `2c9e81dc0b4c5e0e14d35c5caae051a87ac3fcdb` ;
- Run `bash /srv/customer/jessiemessage-private/start-primary-backup-copies-055-088e6e1f.sh`.

Ancien checkout propre et lanceur vérifié : 839 octets, SHA-256 `c8f220c202d775fa60febba9754c368e8fae6d1d53ed5d3d4b4b8d8aa1527632`. Conserver l’état de copie et ses autorisations. Aucun repli réel ni restauration SQL provoqué ; un repli de code ne demande pas de restauration SQL.

## Acquis et suite

Invitations, messages, photos, notifications, récupération du mot de passe et fiches déjà acceptés. Sessions administrateur indépendantes de 180 jours renouvelables, sans coupure d’inactivité. Diffusions individuelles ordinaires sans accord supplémentaire ni métadonnées d’audience, limite 100 destinataires. Adresse officielle `contact@jessiemessage.com`. Aucun message client, campagne réelle, alerte de test ou rotation de clé réalisé dans ce lot.

Coffre/copie CRM 0.46 acquis (`COFFRE_DECHIFFRE_OK`, `COPIE_CRM30_OK`), restauration native isolée trente tables/photos vérifiée. Ne pas refaire une recette générale des appareils.

Suite : constater le déchiffrement personnel de l’archive courante, puis la restitution native d’une capture contenant les nouvelles campagnes. Utiliser `photos-notify-recovery-crm-broadcast-application`, manifeste 10 / reçu 8, six clés et trente tables ; les objets SQL exécutables restent exclus (`completeDatabase: false`). Décisions de confidentialité, durées et effacement complet encore ouvertes, aucune purge automatique. Cadence effective et réception des alertes de la sonde GitHub restent à éprouver. Première diffusion personnelle, administration simultanée et téléchargement réel du diagnostic non consignés. Ces limites empêchent d’annoncer l’ensemble comme définitivement prêt pour la production.
