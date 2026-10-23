# Activer JessieMessage 1.8.4

La préparation et le CHECK sont acquis par retour utilisateur : `PREPARATION_184_CHECK_OK`, source `1a41e08abc87c3a29d9163fbf8cd2342eb04693c`, arbre `e0964b50c03d3881d851f01f86f58777d22b2c10`, Node v24.22.1. Reçu `d188abf49b9a61035f0b4790a1512eb89ed7851025726dd63f47ad493f2b7f57` recalculé indépendamment. [Preuve](verification-proofs/jm184-hosted-preparation.json). Ne répéter ni préparation SSH ni CHECK autonome. L’application et le checkpoint restent 1.8.3 tant que l’identité184 n’est pas rapportée.

## Action actuelle : commandes Manager puis activation

1. Ouvrir les [paramètres Run/Build](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application) du service Node239143, nommé **recette.jessiemessage.com** dans le Manager et desservant aussi **jessiemessage.com**.
2. Renseigner les champs ci-dessous, puis enregistrer.

| Champ | Valeur exacte préparée et précontrôlée |
| --- | --- |
| Run | `bash /srv/customer/jessiemessage-private/start-primary-release184-1a41e08a.sh` |
| Build | `bash /srv/customer/jessiemessage-private/check-primary-release184-1a41e08a.sh` |
| Port | `3000` |

3. Si l’enregistrement a déjà redémarré l’application, passer directement au relevé d’identité. Sinon, ouvrir le [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) et cliquer **Redémarrer** une seule fois. Aucun nouveau champ de répertoire GUI n’est supposé nécessaire ; les lanceurs utilisent le checkout préparé exact.
4. Ouvrir [État du service](https://jessiemessage.com/admin/readiness), en utilisant [la connexion admin](https://jessiemessage.com/admin/login) si nécessaire. Recopier les quatre champs :

| Champ de l’application | Valeur à vérifier |
| --- | --- |
| Version de l’application | `1.8.4` |
| Commit au démarrage | `1a41e08abc87c3a29d9163fbf8cd2342eb04693c` |
| Version Node.js | `v24.22.1` |
| Relevé au démarrage | La nouvelle date et heure réellement affichées, à recueillir |

Le writer final est épinglé sur le vrai reçu et la release421341347, opérateur `054f19dfd0fd5fa8a7e7db4a51077540ff079592`, SHA256 `60f9cf6a518da4d91733ed1e40bd1e8b5d8fcbe05a639ce606cba19a46bfe27b`. [Qualification native39933260498](https://github.com/fredbuhr/jessiemessage/actions/runs/39933260498) acquise **26/26**, tentative1 ; son exécution attend cette identité réelle. Aucune commande de writer n’est donnée à cette étape.

## Références à préserver

- Checkout184 : `/srv/customer/jessiemessage-operator/production-184-1a41e08a`.
- Lanceur Run SHA256 : `3e564f1a61d102c53644b9e3449488c183b7321f164321ed915accdce9074473` ; CHECK SHA256 : `db74a9fb9d608c46cae09c89da69c0c335ba9679bfc9ad111b212b59c0a45daf`.
- Journal : `/srv/customer/jessiemessage-private/jm184-node24221.log` ; précontrôle : `/srv/customer/jessiemessage-private/jm184-preflight-node24221-1a41e08a.log`. Les empreintes vides du reçu décrivent leur création avant CHECK et ne sont pas l’état actuel des journaux.
- Checkpoint183 protégé : `17f575ebe83d0a9d9acf74e9436bff59eabcf8b5ed1bb8f0f99897c867c78a22`. Aucune écriture de métadonnées184 acquise.
- Node privé, configurations `runtime-video-180` / `recurring-backup-052`, SQL36 et repli1.7.2 précontrôlé, jamais démarré, conservés. Aucun nouveau test de backup, PC, message ou notification réel.

La commande de préparation exécutée reste consultable dans l’historique de ce document et dans l’opérateur immuable `e7e6f11815007a53a9502672500476f6f87e9f25` ; elle n’est plus l’action courante. [REPRISE](REPRISE.md) distingue la version publiée de la version active.
