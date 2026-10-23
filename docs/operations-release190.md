# Mise en service de la 1.9.0 — terminée

**Application, checkpoint privé et publication/latest alignés sur la 1.9.0.** Le [reçu final utilisateur](verification-proofs/jm190-hosted-metadata.json) confirme `release190_metadata_recorded`, `publicReady:true` et l’écriture des seules métadonnées sans redémarrage. Aucune commande de livraison à exécuter.

## Références actives

| Élément | Valeur acquise |
| --- | --- |
| Version | 1.9.0 |
| Source | `5dda0dd4453d34a0be839d2a1402301dea835381` |
| Arbre | `f06a140e738f20994425c714a278b0646f651c1b` |
| Node | v24.22.1 |
| Schéma | 38 migrations, référence qualifiée37 tables ; aucun nouvel inventaire indépendant |
| Démarrage | 23/10/2026 17:31:26.560 Europe/Paris, epoch1792769486560 |
| Checkpoint | `01692bfda8ef4a0cab2d102a183c0ab88fe9e8d99858d6e9b583f8b85ffde674` |
| Tag/release/latest | v1.9.0, release421892314, source exacte revérifiée |
| Repli | 1.8.5 compatibleSQL38, précontrôlé et enregistré, jamais démarré |

Configuration de référence du service Node239143 déjà actif, nommé `recette.jessiemessage.com` et desservant aussi `jessiemessage.com` :

- **Commande d’exécution :** `bash /srv/customer/jessiemessage-private/start-primary-release190-5dda0dd4.sh`
- **Commande de build :** `bash /srv/customer/jessiemessage-private/check-primary-release190-5dda0dd4.sh`
- **Port :**3000 ; Node privé épinglé24.22.1.

Ces références servent à une reprise future ; aucune modification Manager ou relance n’est demandée.184 et172 sont incompatibles avec SQL38.

## Preuves de clôture

Préparation, upgrade SQL38, CHECKs185/190, précontrôle complet et identité de démarrage sont acquis selon les preuves liées dans [REPRISE](REPRISE.md). Le [writer corrigé](verification-proofs/jm190/writer-precheck-count-native.json), opérateur `1b54fa79bb4ab8fa92867b9764ed497a30cca23e`, SHA256 `4bf91668b9ae60b74a1269e35e3c7dc21b176c450e4dae41cb7431fcbbd8bf72`, a réussi13/13 sous Nodev24.22.1 puis enregistré le checkpoint selon le reçu utilisateur. Source, journaux, identité, quatre HTTP publics et publication sont vérifiés avant l’écriture gardée et la relecture. Le statut final préserve l’état antérieur, l’historique184 et les autres blocs.

Les champs Manager inversés et le refus de l’ancien writer à plus de16 reçus sont résolus. [Inspection des21 succès](verification-proofs/jm190-hosted-precheck-log-inspection.json) ; [refus historique conservé](verification-proofs/jm190-hosted-writer-precheck-refusal.json). Chaque ligne reste strictement validée dans64KiB ; aucun journal effacé ou filtré.

Aucune préparation, migration, CHECK, activation ou exécution du writer à répéter. Les tests natifs et le reçu hébergé restent distincts des essais fonctionnels sur téléphone et entre appareils, non acquis. Sauvegarde hébergée toujours reportée, aucun nouveau chantier.
