# Reprendre JessieMessage

La source complète **0.54.0** est maintenant réunie dans `main` et activée. Ce fichier est le point d'entrée courant après une interruption de discussion. Le [relevé 0.54](stable-release-054.md), les [preuves d'activation](activation-proofs/jm054-activation.json) et le [plan avant usage privé régulier](production-readiness-2026-10-17.md) complètent cette fiche.

## Source et code réellement exécuté

| Élément | Référence courante |
| --- | --- |
| Dépôt | `https://github.com/fredbuhr/jessiemessage` ; branche par défaut `main`, application complète |
| Version | `0.54.0` ; repère `release/0.54.0` |
| Source exécutée, runtime et superviseur | `6cfce890827c835fdbda2488163b5c0f1695b2dc`, arbre `9308cb4dc736e7a869fa50796801ddc83a098d69` |
| Intégration dans main | [PR #69](https://github.com/fredbuhr/jessiemessage/pull/69), fusion `12c16c6f0a63da3b20ba9af522447caf19f6fc5f`, arbre identique ; documentation ultérieure distincte du code exécuté |
| Runtime | Profil `messaging-photos-notify-recovery-crm-broadcast`, déploiement `primary-transition`, Node 24, port 3000 |
| Données | Schéma 30, six configurations privées existantes, mêmes clés/comptes/sessions |

**Reprendre depuis la tête vérifiée de main. Pour déployer, épingler un commit et son arbre validés ; une branche peut évoluer.** Avant la consolidation, `main` ne contenait que la surveillance externe : cet ancien avertissement dans les relevés datés est historique. La fusion conserve les deux historiques, sans rebase ni réécriture des anciennes branches.

## Hébergement et commandes

- Principal : `https://jessiemessage.com` ; recette conservée : `https://recette.jessiemessage.com`. Elles partagent le runtime et les données ; la recette n'est pas une base de test indépendante.
- [Manager Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) ; [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal).
- Checkout actif, runtime et superviseur : `/srv/customer/jessiemessage-operator/release-054-6cfce890`.
- Configuration : `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851`.
- Sauvegardes et état des alertes : `/srv/customer/jessiemessage-private/recurring-backup-052`.
- Run Manager : `bash /srv/customer/jessiemessage-private/start-primary-release-054-6cfce890.sh`.
- Build : depuis le checkout actif, vérifier HEAD `6cfce890...`, arbre `9308cb4d...`, propreté Git, puis `npm run check`. La [procédure 0.54](stable-release-054.md) contient la commande complète.
- Capture quotidienne : **05:15 UTC**. Contrôle du journal chaque minute, incident après trois échecs, reprise SMTP espacée de 1 à 15 minutes.

Ne pas modifier le checkout actif : sa propreté est contrôlée. Préparer tout nouveau code dans un checkout séparé. Ne jamais lancer une capture `--offline` pendant que l'application tourne. Ne pas lire, afficher ou copier les secrets dans les preuves ou dans le dépôt.

## Repli prêt

Les commandes Run/Build précédentes sont sauvegardées exclusivement dans `/srv/customer/jessiemessage-private/manager-before-release-054.json`, mode 0600. Elles restaurent :

- superviseur `e1842a395925b19a50dcabbccfb7e9b9b03fcd8e`, arbre `ad44e230db9a1ec89902e616b1315496b4afe284`, checkout `backup-alerts-e1842a39` ;
- runtime 0.50 `0a1cafd85c3d8699be1961075b18e80e36bcd041`, arbre `17db89aa165e23ca427d073f5a3fcc28387f5168`, checkout `broadcast-direct-delivery-0a1cafd8` ;
- Run `bash /srv/customer/jessiemessage-private/start-primary-alerts-e1842a39.sh`.

Les deux checkouts de repli sont contrôlés épinglés/propre et le lanceur passe `bash -n`. Le repli réel n'a pas été provoqué pendant ce lot. Reprendre les commandes sauvegardées puis utiliser le cycle Manager normal ; **aucune restauration SQL pour un simple repli de code**.

Les replis antérieurs restent dans `manager-before-alerts-053.json`, puis `manager-before-monitor-053.json` et `recurring-backup-052/manager-before-activation-052.json`. Ne pas les confondre avec le repli immédiat ci-dessus.

## Acquis à conserver

- Invitations, messages, photos, notifications, mot de passe oublié et parcours des fiches déjà acceptés. Ne pas demander une répétition générale des appareils ou parcours acquis.
- Compte administrateur partagé, sessions indépendantes par appareil, 180 jours renouvelables, sans déconnexion d'inactivité.
- Diffusions livrées comme des messages individuels, sans accord supplémentaire du client ni métadonnées d'audience. Limite actuelle : **100 destinataires par campagne**. Conserver la table historique `broadcast_preferences` et ses migrations pour la compatibilité des sauvegardes.
- Adresse officielle : **contact@jessiemessage.com**.
- `COFFRE_DECHIFFRE_OK` et `COPIE_CRM30_OK` acquis en 0.46 ; restauration native isolée des trente tables/photos/recovery/CRM vérifiée.
- Première capture quotidienne 0.52 du 18 octobre : **05:15:33.262 → 05:15:39.807 UTC**, chiffrement/reprise et empreintes vérifiés. Ce n'est plus un passage futur.
- **Réception des deux courriels [TEST] incident/rétablissement confirmée par le propriétaire le 18 octobre à 15:54:05 Europe/Paris.** Le [reçu personnel](activation-proofs/jm053-alerts-owner-confirmation.json) complète les acceptations SMTP. Les anciennes recherches IMAPS sans résultat restent historiques ; ne pas renvoyer les tests.

## Preuves de la version 0.54

Les cinq jobs CI de la [source candidate](https://github.com/fredbuhr/jessiemessage/actions/runs/39133998681) et de son [intégration dans main](https://github.com/fredbuhr/jessiemessage/actions/runs/39134356546) passent. La vérification Windows passe aussi sur les deux références. Syntaxe de 431 fichiers et build réussis ; **111/111 tests natifs** passent sur l'hébergement, sans saut, ainsi que le préflight sans lancement ni capture.

Le cycle normal Manager réussit le 18 octobre, modification affichée **16:09 Europe/Paris**. Deux observations après le nouveau démarrage, **14:10:01.303 et 14:11:01.348 UTC**, sont `current / OK`, zéro incident et zéro alerte en attente. À **14:10:31.318 UTC**, **38/38 lectures HTTPS et seize empreintes exactes** passent sur les deux origines. Le journal garde quatre enregistrements et le succès du matin : aucune capture supplémentaire. Les sources de fichiers et la version 0.54.0 sont relues propres à 14:12:42.640 UTC.

Cette vérification utilise les commandes épinglées du Manager, le démarrage du profil complet et les réponses HTTPS. L'inspection directe des PID depuis la session SSH n'a pas confirmé les processus applicatifs ; ne pas présenter cette sonde supplémentaire comme une preuve acquise. Les parcours authentifiés réels n'ont pas été répétés dans ce lot, leurs acceptations antérieures sont conservées.

## Suite concrète

1. **Copie indépendante récurrente** : aucune destination automatique hors hébergement n'est encore raccordée. Choisir un espace réellement disponible ; transférer seulement l'archive chiffrée, contrôler taille/empreinte et écrire un reçu. Aucune purge automatique ou nouveau prestataire choisi par défaut.
2. **Nouvelle archive 0.52 sur le PC** : sa copie/déchiffrement restent non confirmés ; attendre une observation ciblée `SAUVEGARDE_052_OK`. Les clés privées et phrases restent exclusivement sur le PC. Les acceptations 0.46 ne sont pas à refaire.
3. **Sonde externe** : trois passages planifiés GitHub réussis, mais espacés de plusieurs heures ; ne pas garantir cinq minutes de détection. La réception confirmée des mails locaux ne valide pas les notifications GitHub ni une panne totale de l'hébergement.
4. **Observations et données** : première diffusion personnelle, administration simultanée et téléchargement du diagnostic non consignés ; décisions de confidentialité/conservation et exécuteur d'effacement complet encore ouverts. Voir le plan courant ; ne pas les annoncer comme finalisés.

L'[audit de récupération du 18 octobre](AUDIT-REPRISE-2026-10-18.md) garde la source complète retrouvée `dc02ec6...` et l'ancien état de main comme preuves historiques. La consolidation 0.54 et le présent point de reprise sont la référence actuelle.
