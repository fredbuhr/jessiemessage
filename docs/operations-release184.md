# JessieMessage 1.8.4 — livraison close

**Aucune commande à réexécuter.** Qualification, publication, préparation, CHECK, activation et enregistrement final sont acquis. [REPRISE](REPRISE.md) reste la référence courante ; les anciennes consignes ne doivent pas être rejouées.

| Élément | Résultat acquis |
| --- | --- |
| Application | **1.8.4**, source `1a41e08abc87c3a29d9163fbf8cd2342eb04693c`, arbre `e0964b50c03d3881d851f01f86f58777d22b2c10` |
| Runtime et schéma | **Node v24.22.1 / SQL36**, inchangés |
| Démarrage | UI `23/10/2026 11:44:16` ; epoch du journal rapporté par le writer `1792748656772`, soit `11:44:16.772` à Paris |
| Publication | Tag/release/latest **v1.8.4**, release421341347, sur la même source |
| Préparation et CHECK | [Reçu utilisateur](verification-proofs/jm184-hosted-preparation.json), `PREPARATION_184_CHECK_OK`, stagingSHA `d188abf49b9a61035f0b4790a1512eb89ed7851025726dd63f47ad493f2b7f57` |
| Enregistrement | [Reçu final](verification-proofs/jm184-hosted-metadata.json), `release184_metadata_recorded`, `metadataOnly:true`, `noRestart:true`, `publicReady:true` |
| Checkpoint | **1.8.4**, SHA256 `3b1781bebf857c465fce429b5160d7432f1e9afa98e0c2a983784bcc3127a212` |
| Repli et historiques | Repli1.7.2 précontrôlé jamais démarré ; état antérieur, autres blocs et historiques183/182/181/180/171/160 préservés selon le reçu |

Le writer immuable `054f19dfd0fd5fa8a7e7db4a51077540ff079592`, SHA256 `60f9cf6a518da4d91733ed1e40bd1e8b5d8fcbe05a639ce606cba19a46bfe27b`, était qualifié **26/26**, tentative1, par le [run39933260498](https://github.com/fredbuhr/jessiemessage/actions/runs/39933260498). Il a contrôlé sources, lanceurs, reçus, journal de démarrage, HTTP publics et publication avant le remplacement atomique du seul checkpoint. Le checkpoint183 antérieur `17f575ebe83d0a9d9acf74e9436bff59eabcf8b5ed1bb8f0f99897c867c78a22` reste préservé dans l’historique. [Contre-revue finale](verification-proofs/jm184/hosted-metadata-independent-review.json).

L’identitéUI et l’exécution hébergée sont **USER_REPORTED**, sans accès privé direct de l’agent. Aucune nouvelle lecture SQL, vérification physique du clavier ou réception Push n’est déduite de ce reçu ; sauvegarde hébergée et PC restent reportés, réservesA10/A11/A12 inchangées.

Les commandes de préparation, d’activation et d’enregistrement restent dans l’historique de ce document. Les chemins du checkout et des lanceurs actifs sont conservés dans [REPRISE](REPRISE.md#accès-et-commandes-de-lapplication-active), comme références, sans consigne de redémarrage.
