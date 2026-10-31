# Livraison 1.14.0 — préparation/CHECK acquis, activation en attente

État du 31 octobre 2026. [REPRISE](REPRISE.md) reste la référence. La 1.13.0 est toujours active et finalisée selon ses reçus ; aucune étape 1130 à rejouer. `recette.jessiemessage.com` et `jessiemessage.com` partagent le service Node239143 et la même base.

## Résultat qualifié et publié

Source/tag **`4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd`**, arbre **`e5a239eaf7b8c3395a843c9e0d600efeb7aa569b`**, [v1.14.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.14.0), release/latest **430149586**. [PR145](https://github.com/fredbuhr/jessiemessage/pull/145), puis main, **5/5 jobs** chacun : général 4 295 tests / 4 243 réussis / 52 omissions explicites ; Chrome 296/296, HTTPS 14/14, MariaDB 613/613 sur chacune des deux versions. [Bilan et couverture](media-library-1140.md), [preuve main](verification-proofs/jm1140/main-native.json).

Publication [41235813737](verification-proofs/jm1140/publication-native.json) : onze tests natifs exécutés en tentative1 ; seul le job de publication a repris en tentative2 après lecture indépendante du tag correct déjà créé et de la release encore absente. Le tag n’a pas été déplacé. Échec initial et journaux conservés. Opérateur `a051c7ebd821b76e9e8554481a91b89ea875b140`, script relu identique aux octets qualifiés. Aucun déploiement déduit de cette publication.

Node24.22.1 et schéma 38/37tables attendues inchangés. Seule nouvelle dépendance : `libheif-js@1.23.5`. Les dépendances anciennes restent préservées ; le nouveau préparateur installe un `node_modules` séparé avec npm11.19.1 extrait de l’archive officielle Node déjà épinglée. [Qualification opérateur](verification-proofs/jm1140/preparation-native.json), run41235719521, **23/23 tests et une installation réelle isolée**, versions, Sharp et fichiers HEIC vérifiés ; aucune action hébergée. L’échec initial de configuration npm est conservé et corrigé, sans ancien outil rejoué.

## Préparation et CHECK1140 — acquis, ne pas rejouer

Le [reçu utilisateur](verification-proofs/jm1140/hosted-preparation.json) confirme les sources exactes et la préparation séparée des dépendances. Empreinte canonique **`2fe494a43a446c882ce509f4ecf51925bd5789a94bdbdf2ce6923d83e5ff7d72`**, recalculée identique ; `CHECK1140_EXIT=0` puis `PREPARATION_1140_CHECK_OK`.

- Checkout `/srv/customer/jessiemessage-operator/production-1140-4f3ce5de`, mode0700 ; dépendances distinctes, six versions verrouillées et inventaire1082entrées/914fichiers/SHA547c6ec0 identiques à la qualification native. Sharp et les deux fichiers HEIC vérifiés selon le reçu.
- Lanceur SHA256 `12f9b0c634c89912eb15ca02244c76f14694a84a3e8499051e52e4988c316635`, CHECK SHA256 `ae4999d70f15be6cd1491c30ac5ad99494e5f0d35a3fcc1b3e0daf3748424419`, tous deux mode0700.
- Checkpoint13/cdcb3f8b, staging13/08eb6309, lanceurs et anciennes dépendances préservés selon le reçu. Ancien inventaire1109entrées/937fichiers conservé, sans confusion avec le nouveau.
- Les flags faux et journaux vides décrivent l’état avant le CHECK séparé ; ne pas les réécrire pour fabriquer une qualification ni déduire un démarrage14 ou un inventaire SQL physique indépendant.

Préparateur immuable `10083087598a96248698cbe76309e1b3afda163c`, SHA256 `4b6d1b3d8212b107ccdfb7fa3a285e93b6936298f685b360423fa31a8ac18686`, déjà qualifié. Le [bloc utilisé est conservé dans l’historique](https://github.com/fredbuhr/jessiemessage/blob/f8b967f209949ae4d8b8787a61aec36cfeaab01b/docs/verification-proofs/jm1140/preparation-command.sh). **Ne rejouer ni préparation ni CHECK SSH1140.** Aucune action hébergée effectuée directement par l’agent.

## Prochaine action unique : activation personnelle14

Le CHECK est confirmé. L’activation personnelle se fait dans le [Manager Run/Build](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), application Node nommée `recette.jessiemessage.com`, qui dessert aussi le principal. Renseigner les valeurs suivantes :

| Champ | Valeur1140 après CHECK confirmé |
| --- | --- |
| Commande d’exécution, champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1140-4f3ce5de.sh` |
| Commande de build, champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1140-4f3ce5de.sh` |
| Port | `3000` |

Enregistrer les paramètres, puis ouvrir le [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) et cliquer sur **Redémarrer** pour appliquer la nouvelle livraison. Cette séparation enregistrement/redémarrage est décrite dans la [FAQ officielle Infomaniak2535](https://www.infomaniak.com/fr/support/faq/2535/modifier-la-configuration-dun-site-nodejs-infomaniak), relue le31octobre2026. Garder le port3000 et le Node privé épinglé ; les autres réglages ne font pas partie de cette activation.

Après activation, relever les quatre valeurs de l’identité dans [l’état du service](https://jessiemessage.com/admin/readiness) : version1.14.0, commit `4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd`, Nodev24.22.1 et date/heure réelle de démarrage. Aucun démarrage14 n’est encore attesté à l’enregistrement de ce guide. Préparer ensuite et qualifier l’enregistrement final lié à ce vrai démarrage et au staging acquis ; aucun writer14 n’est fourni avant cette identité. Le checkpoint13, ses historiques et les anciens replis restent préservés ; aucune qualification de downgrade nouvelle n’est inventée.

Téléphone physique, Safari et photo originale problématique restent non attestés. Les preuves Chrome et SQL utilisent exclusivement des fixtures synthétiques isolées. Aucun envoi réel, compte ou média client modifié, test de sauvegarde reporté, nouvelle opération PC ou chantier juridique.
