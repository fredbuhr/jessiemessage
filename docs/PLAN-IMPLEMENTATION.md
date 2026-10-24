# Plan global de JessieMessage

Révisé le 23 octobre 2026 après l’[audit final de l’ensemble de l’application](AUDIT-FINAL-20261022.md), en conservant la décision de simplifier son périmètre. Le précédent décompte de huit résultats concernait seulement la vidéo et sa qualification ; il ne mesurait pas toutes les fonctions encore absentes. Il est remplacé par le présent plan. Le [bilan initial](BILAN-GLOBAL-20261022.md) conserve l’état de sa livraison180 ; les correctifs182 et les contrôles restants sont décrits ci-dessous. [REPRISE](REPRISE.md) reste l’unique référence de production et des commandes opérateur.

## Correctif 1.11.1 — dernier message reçu de chaque client

Corriger la vue générale de Messages : un seul aperçu par client, le dernier message reçu encore visible. Conversations non lues d’abord, puis les plus récentes dans chaque groupe. La sélection doit précéder la pagination SQL ; un client ne doit pas se répéter au chargement des pages suivantes. Préserver le clic vers la conversation et l’absence de marquage lu dans la vue générale.

Implémentation fusionnée, CI PR acquise5/5 après reprise du seul job HTTPS en échec et main5/5 dès la tentative1, source80b7fbf5f9b5ba32ac1aae817043126e93025946. [Preuves et portée](REPRISE.md#correctif-1111--démarré-enregistrement-final-en-attente). Tag/release/latest422839761 publiés après33 tests opérateur natifs et workflow2/2. [Préparation/CHECK1111 acquis selon le reçu utilisateur](verification-proofs/jm1111/hosted-preparation.json), empreinte canonique conforme, CHECK0 et `PREPARATION_1111_CHECK_OK`. Ne pas les rejouer. [Activation1111 rapportée](verification-proofs/jm1111/hosted-identity.json), source exacte/Node24.22.1, le24octobre à19:31:34Paris. Ne pas la rejouer. **Seul reste l’[enregistrement final](operations-release1111.md)**, writer épinglé au vrai reçu et qualifié16/16 natifs ; lire son JSON avant clôture. Dernier checkpoint confirmé1110, aucune nouvelle CI du code inchangé. Aucune migration ni nouvelle dépendance ; ne pas rejouer sa livraison acquise.

## Évolution 1.11.0 — livraison terminée

Codes d’invitation et vue des messages reçus qualifiés PR/main5/5, tag/release422775194 et publication2/2 acquis. [Périmètre codes](invitation-codes-1110.md), [messages reçus](received-inbox-1110.md), [source et preuves](REPRISE.md). Démarrage et enregistrement final acquis selon les reçus utilisateur : version1.11.0, commit88bbb4edfa15e7502c25c5e9e319c36f5f60276d, Node24.22.1, démarrage le 24 octobre à **16:59:47.566 à Paris**. Aucune migration ni nouvelle dépendance.

Préparation et CHECK acquis selon le [reçu utilisateur](verification-proofs/jm1110/hosted-preparation.json) : empreinte canonique conforme, `CHECK1110_EXIT=0`, `PREPARATION_1110_CHECK_OK`. Ne pas les rejouer.

Activation acquise selon le [relevé utilisateur](verification-proofs/jm1110/hosted-identity.json). Ne pas la rejouer.

**Enregistrement final acquis selon le [reçu utilisateur](verification-proofs/jm1110/hosted-metadata.json)** : `release1110_metadata_recorded`, `publicReady:true`, checkpoint1110 SHA256 `859727b6d196989cc87c512fec1e1758fb25aa401d8d1ab4753c7d9a744feb11`. Historiques1101/1100/190/184, état actif antérieur et autres blocs préservés ; métadonnées seules, sans redémarrage. Le [writer final](operations-release1110.md), qualifié15/15 natifs, est exécuté. **Aucune étape de livraison restante :** ne rejouer ni préparation, CHECK, activation ou writer, ni les CI vertes du même code.

Aucun envoi réel, test de sauvegarde reporté, migration ou nouvelle manipulation PC. Les limites physiques précédentes restent explicites.

## Audit prépublic et livraison1.10.1 — terminés

Les134 points, la seconde revue de couverture, les six correctifs, les qualifications PR/main5/5 et la publication1.10.1 sont acquis. [Rapport et preuves](AUDIT-PUBLIC-1100-20261023.md), [état actuel](REPRISE.md). Aucun nouveau correctif ni CI du code inchangé n’est à relancer.

La tentative initiale [non confirmée](verification-proofs/final-public-1100/hosted-preparation1101-not-confirmed.json), l’[inspection reçue](verification-proofs/final-public-1100/hosted-inspection1101.json) et la récupération bornée qualifiée6/6 sont conservées comme historique. Le [reçu de préparation1101](verification-proofs/final-public-1100/hosted-preparation1101.json), SHA256 `aa2d9240ded66106ee919ad1baa8949559be816edc93bc6998954359bccc2b1a`, rapporte désormais le candidat exact préparé après correction2700→0700 de la seule nouvelle racine de dépendances, sans CHECK ni démarrage. Ne rejouer aucune de ces opérations.

**CHECK acquis selon le [résultat utilisateur](verification-proofs/final-public-1100/hosted-check1101.json) :** `CHECK1101_EXIT=0`, puis `CHECK_1101_OK`. Ne pas le rejouer.

**Livraison1.10.1 finalisée selon le [reçu utilisateur](verification-proofs/final-public-1100/hosted-metadata1101.json) :** `release1101_metadata_recorded`, version1.10.1/source9eb99f1f68ab4beb5484894249afa8f413cc5dd6/arbre2a09d9d5d6698a04605e9a4b4faa551536cfca13/Nodev24.22.1, SQL38/37 tables physiques, `publicReady:true`. Démarrage1792787440361, soit **23/10/2026 22:30:40.361 à Paris**. Checkpoint aligné1.10.1, SHA256 `6a4ab751f1a89433502df3db898da0ab65aef0e80fc99c38df29978359c02e90` ; historiques1100/190/184, autres blocs et état antérieur préservés, repli185 qualifié et jamais démarré.

**Aucune prochaine action technique de livraison.** Le [writer épinglé et qualifié16/16](verification-proofs/final-public-1100/writer1101-final-native.json), opérateurac101b4b…, est exécuté selon ce reçu. Ne rejouer ni préparation, inspection, récupération, CHECK, activation ou writer, ni les CI vertes du même code.

**GO technique pour l’ouverture dans le périmètre qualifié.** Appareils physiques, Safari/Firefox et Push système non exercés, sauvegarde hébergée reportée et réservesA10/A11/A12 restent des limites explicites. Le profil public est masqué par défaut et sa publication appartient au choix admin ; l’agent ne le publie pas. Aucun envoi, effacement ou manipulation PC réel ajouté.

## Évolution 1.10.0 — livraison terminée

Code fusionné, PR et main qualifiés5/5 sousNode24.22.1. [Source et preuves](REPRISE.md).

Publication immuable de1100 acquise : release422111737, latest à sa livraison sur la source exacte `51b0cf22e3adbad7ed26653e96706ba707aaf839`, opérateurs42/42 et workflow2/2.

**Audit terminé avant de poursuivre :** les25 tags/releases et leurs versions package/lock sont cohérents ; comparaison des sources1.9.0/1.10.0 et des fonctions métier réalisée, états documentaires périmés corrigés. [Résultats et preuves](version-audit-1100.md). Aucun déploiement ni nouvelle publication pendant cet audit.

**Reprise demandée par l’utilisateur après le rapport d’audit.**

1. **Acquis selon le [reçu utilisateur](verification-proofs/jm1100-hosted-preparation.json)** : checkout exact et CHECK, marqueur `PREPARATION_1100_CHECK_OK`, sans démarrage ni modification Manager/checkpoint. Ne pas les rejouer.
2. **Acquis selon l’[identité utilisateur](verification-proofs/jm1100-hosted-identity.json)** :1.10.0, source51b0cf22…, Nodev24.22.1, relevé UI `23/10/2026 19:43:39`. Aucun redémarrage à rejouer.
3. **Acquis selon le [reçu final utilisateur](verification-proofs/jm1100-hosted-metadata.json)** : writer épinglé, [qualifié13/13](verification-proofs/jm1100/writer-final-native.json), run39997775658, puis `release1100_metadata_recorded`, `publicReady:true`, checkpoint1100 `3d60ceb7da3dc61c9ca198ba40a898f6f9ab054650030c7a1632f019ecc73e53`, historiques et autres blocs préservés, sans redémarrage.

SQL38 inchangé ;190 et185 conservées. Aucune migration, sauvegarde ou manipulation PC à ajouter. **Aucune opération de livraison restante.** Ne rejouer ni préparation, CHECK, activation ou writer. [Bilan opérateur clos](operations-release1100.md).

[Périmètre](public-profile-1100.md). Les essais sur téléphone réel ne sont pas déduits des tests synthétiques. Le démarrage et le checkpoint1100 sont rapportés ; aucune qualification exhaustive sur appareil réel n’en est déduite.

## Évolution 1.9.0 — livraison terminée

Les quatre lots et les six fonctions du [cahier](specs/cahier-20261023.md) sont codés, fusionnés, qualifiés PR/main5/5, publiés et déployés. Source `5dda0dd4453d34a0be839d2a1402301dea835381`, release421892314, latest lors de cette livraison, Nodev24.22.1, SQL38. [État et preuves](verification-proofs/experience190-progress.json).

Le [reçu final utilisateur](verification-proofs/jm190-hosted-metadata.json) confirme `release190_metadata_recorded`, `publicReady:true`, checkpoint `01692bfda8ef4a0cab2d102a183c0ab88fe9e8d99858d6e9b583f8b85ffde674`, historiques et autres blocs préservés, sans redémarrage. Le repli1.8.5 compatibleSQL38 est précontrôlé, jamais démarré. Les deux blocages Manager/writer sont résolus et leurs preuves conservées dans REPRISE.

**Aucune étape de livraison restante.** [Bilan opérateur clos](operations-release190.md). Les tests natifs restent acquis sans replay ; les essais fonctionnels sur téléphone et entre appareils ne sont pas déduits du démarrage ou du reçu final. Sauvegardes reportées et autres sujets hors périmètre conservent leur état sans nouvelle action automatique.

## Correctif interface 1.8.4 — terminé

Les cinq demandes et la course préexistante des tâches sont corrigées dans la source publiée `1a41e08abc87c3a29d9163fbf8cd2342eb04693c`, arbre `e0964b50c03d3881d851f01f86f58777d22b2c10`. Contre-revues, PR132 et main **5/5**, captures synthétiques et publication **2/2** acquis. Préparation et CHECK acquis ; l’[identité active184](verification-proofs/jm184-hosted-identity.json) est rapportée : version1.8.4, Nodev24.22.1, UI `23/10/2026 11:44:16`. [Bilan](UX-184-20261023.md), [état](verification-proofs/jm184-progress.json).

Le writer final, qualifié **26/26** (run39933260498), a réussi selon le [reçu utilisateur](verification-proofs/jm184-hosted-metadata.json) : **application, checkpoint et latest1.8.4/SQL36 alignés**, `publicReady:true`, sans redémarrage, historiques et repli préservés. Checkpoint `3b1781bebf857c465fce429b5160d7432f1e9afa98e0c2a983784bcc3127a212`.

Aucune étape de livraison restante. Ne répéter ni préparation, CHECK, Manager, démarrage ou writer. [Bilan opérateur clos](operations-release184.md). Aucun nouvel essai de sauvegarde hébergée, PC, compte réel ou réouverture automatiqueA10/A11/A12.

## Correctif messagerie1.8.3 — terminé

[Périmètre détaillé et critères](UX-183-20261022.md). Nouvelle demande explicite après l’audit : dix signalements UX et revue des parcours client/admin, avec correction des constatsB01–B05/I01.

1. Corrections et contre-revues terminées. LaPR130 est fusionnée sur `48fd42b808b2bc4d95d3f3ba21244c032d0a938f`, arbre `1070a2d4db52e92aa020e4cb8c6d4bacaaf06a58`.
2. Qualification finalePR etmain acquise sousNode24.22.1 : **5/5** chacune ; Chrome230, HTTPS4, MariaDB576 chacune, général3897réussis et48omissions. Captures synthétiques320/1280 inspectées et contre-relues. [Preuve main](verification-proofs/jm183/main-native.json).
3. Publication immuable acquise : [run39865609026](https://github.com/fredbuhr/jessiemessage/actions/runs/39865609026) **2/2**, natif opérateurs38/38 et préparation22/22, tag/release/latest183 sur la source main qualifiée, release421266798. Préparation et CHECK183 acquis selon le [reçu utilisateur](verification-proofs/jm183-hosted-preparation.json), sans démarrage. Le writer final est qualifié26/26 par le [run39867149619](https://github.com/fredbuhr/jessiemessage/actions/runs/39867149619), avec le vrai reçu et la release421266798. L’[identité active1.8.3](verification-proofs/jm183-hosted-identity.json) est rapportée, source48fd42b8…, Nodev24.22.1, UI `23/10/2026 00:56:57`. Le [reçu final183](verification-proofs/jm183-hosted-metadata.json) est acquis : **application, checkpoint et latest1.8.3/SQL36 alignés**, `publicReady:true`, sans redémarrage, historiques et repli préservés. Aucune opération de livraison restante ; ne refaire ni préparation, CHECK, activation ou writer. Aucun PC, nouvel essai de sauvegarde, envoi ou effacement de compte réel.

[État](verification-proofs/jm183-progress.json) et [consignes courantes](REPRISE.md). Les bilans historiques ci-dessous décrivent les constats avant correction et leurs propres livraisons ; ils ne sont pas une seconde liste d’actions à exécuter.

## Second audit après livraison182 — terminé

Le [second rapport](AUDIT-2-20261022.md) est terminé : 447 fichiers sources/configuration/ressources examinés, trois helpers 182 externes épinglés lus ; 390 tests inventoriés dont 202 lus intégralement, 25 partiellement et163 structurellement seulement. Les preuves synthétiques, contre-revues et [couverture exacte](verification-proofs/audit2-182/source-coverage.json) sont conservées. Cinq nouveaux défauts et une amélioration conditionnelle ont été identifiés dans1.8.2 ; leurs correctifs sont désormais fusionnés et qualifiés dans1.8.3, avec activation183 rapportée par son identité, sans validation physique exhaustive présumée.

Corrections intégrées à1.8.3, distinctes des constats historiques de cet audit :

1. **B01/B02/B03 : sessions et horloges.** Empêcher un401 ancien d’effacer une session récente ; réconcilier le calcul d’échéance service/store du renouvellement ; recontrôler le TTL mail après attentes. Préserver permissions finales, CAS et absence de répétition automatique des POST. B01/B02 P2, B03 P3. Les anciens tests qui exigent l’effacement sur 401 doivent changer avec le contrat ; qualification corrective avec navigateur/cookie jar réel pour A→B.
2. **B04 : lien de navigationP3.** Remplacer `/admin/chat` par `/admin/messages` dans la page manuelle ; aucune sauvegarde à exécuter pour vérifier ce lien.
3. **B05 : admission du témoin historiqueP2 conditionnel**, et éventuellement **I01 : refus explicite de l’ancien coffreP3 conditionnel**. Fixtures uniquement, aucune réactivation du témoin, PC ou parcours de sauvegarde reporté. I01 ne démontre aucune perte actuelle ni défaut des archives vidéo actives.
4. Qualification de la source corrective1.8.3 acquise ; publication et activation restent des étapes distinctes. Le constat d’audit seul ne prouvait aucun déploiement.

Les sections182 ci-dessous restent l’historique de livraison acquis ; les cinq défauts et l’amélioration ci-dessus sont corrigés dans la1.8.3 dont l’identité active est désormais rapportée. Les reprises ne doivent ni les oublier, ni rejouer les anciens lots. [État final structuré](verification-proofs/audit2-182-progress.json). À la clôture183, production et checkpoint étaient rapportés1.8.3 / Node24.22.1 / SQL36, avec latest183 concordant ; les livraisons ultérieures et leur état courant sont décrits dans REPRISE. Le chantier juridiqueA10, la sauvegarde hébergée, le PC et les réservesA11/A12 conservent leur statut précédent.

## Point de départ acquis avant le correctif182

L’[identité active **1.8.1 / Node 24.22.1**](verification-proofs/jm181-hosted-identity.json) est rapportée par l’utilisateur après activation, source `1ae4c75152795ea6f31c2ff364e337a1d5a04e31`. **SQL36, initialisation vidéo et précontrôles 1.7.2/1.8.0** sont acquis par leurs preuves séparées ; la [préparation et le CHECK181](verification-proofs/jm181-hosted-preparation.json) ont réussi sans migration. Le [reçu final de métadonnées](verification-proofs/jm181-hosted-metadata.json) confirme production/checkpoint/latest **1.8.1/SQL36**, `publicReady:true`, sans redémarrage et avec historiques et repli préservés. Le [contrôle HTTP anonyme](verification-proofs/jm181-public-http.json) confirme disponibilité et alias de connexion ; il ne prouve pas le parcours sauvegarde. Invitations, authentification et sessions multiples, texte/photos, profils et avatars, 268 emojis Unicode, lecture privée, CRM, diffusions élargies, annonces, tâches privées et exports photo/vidéo sont livrés. La 1.8.0 a ajouté vidéo, sauvegarde manuelle et réponses personnelles ; la 1.8.1 réunit les réponses dans une liste commune et corrige l’alias exact de connexion. Le [retour utilisateur sur l’interface](verification-proofs/jm180-hosted-interface.json) confirme le parcours vidéo, et l’utilisateur confirme l’enregistrement des réponses. L’utilisateur confirme désormais que la liste commune fonctionne ; la sauvegarde complète reste non vérifiée, avec un test reporté à sa demande. La fermeture locale des comptes est disponible sous ses gardes, sans nouveau raccordement PC.

**G1–G3 sont fusionnés dans la 1.8.0, et G4 a qualifié le repli technique 1.7.2.** Sources : produit `fd6e53b14b520231b0b307a2761331dd8c740a5b`, arbre `324c3563fc6b1cfce669bcf58d90962c23c966b8` ; repli `6b3319a77c307ed7d6b003fe33de36807c70c266`, arbre `924d500375a69ae50bc63414b15df71271e2bf8a`. Les PR 125 et 127 sont fusionnées ; leurs CI PR et main sont toutes **5/5, tentative 1**. [Preuve finale 1.8.0](verification-proofs/jm180-final-delivery-verification.json), [preuve 1.7.2](verification-proofs/jm172-verification.json). Les preuves G1–G3 restent historiques. À la livraison 1.8.0, la [1.8.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.8.0) et le [repli v1.7.2](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.7.2) ont été publiés ; latest avait été aligné sur v1.8.0 après [alignement du seul marqueur](verification-proofs/jm180-metadata-operator-verification.json) ; les [sources/lanceurs et le bundle vidéo sont préparés](verification-proofs/jm180-hosted-preparation.json), puis [SQL36 et les deux précontrôles ont réussi](verification-proofs/jm180-hosted-schema36.json), avant l’identité 1.8.0 rapportée. Le plan normal SQL33 reste distinct ; il ne doit pas être démarré sur la base migrée.

## Périmètre décidé le 22 octobre

**Sont abandonnés : IA, paiements carte et crypto, stickers et GIF, messages vocaux, réponse citée, édition, transfert de messages et épingles.** Ces fonctions sortent du backlog ; elles ne sont plus des lots différés à estimer. Les emojis Unicode, la suppression de messages, les diffusions et les exports déjà livrés sont conservés.

**La production 1.8.0 remplace les sauvegardes et l’archivage automatiques par une sauvegarde simple, déclenchée à la demande depuis l’administration.** Aucun exécuteur d’archivage automatique n’est à développer. Les copies, clés, autorités et historiques existants sont préservés ; les fermetures locales et leurs contrôles restent opérationnels. Le code est qualifié et déployé ; **la création, la fin et le téléchargement d’une sauvegarde restent non vérifiés ; le test est reporté à un autre jour à la demande de l’utilisateur**.

## Audit final et plan de correction

L’[audit global du 22 octobre](AUDIT-FINAL-20261022.md) porte sur le backend, le frontend/PWA, les données et médias, les opérations, la CI, les documents, dépendances et références de livraison. Sa [preuve structurée](verification-proofs/audit-final-20261022.json) conserve les observations et reproductions. **À la clôture182, l’identité active1.8.2 était rapportée par l’utilisateur ; les lots1 à3 sont qualifiés, la PR129 est fusionnée et la1.8.2 est qualifiée, publiée, préparée puis démarrée. Le [reçu final182](verification-proofs/jm182-hosted-metadata.json) confirme le checkpoint privé aligné, `publicReady:true`, les historiques et le repli préservés.** Source `78e6b8b2f6b19020c060345b9313a81829e9c8da`, [CI39832723570 5/5](verification-proofs/jm182-main-ci.json), [publication2/2](verification-proofs/jm182-publication.json), tag/release/latestv1.8.2 concordants. Le code audité était identique à la source de production rapportée ; les correctifs conservent leurs preuves distinctes.

Le plan initial regroupe le travail en **quatre lots et une livraison cohérente**. Le lot1 est acquis sur branche : source `bc2b1c0d6a8e124b4256ffd20156ce005f614711`, [CI corrective 5/5](verification-proofs/jm182-lot1-ci-corrected.json). Le premier échec reste conservé. Le lot2 est acquis sur `bfaf637dfcb230e198032d8fc43eb5ee508745f9`, arbre `3d73ee2197f7c7daa6a47bc493158312ff795478`, [CI5/5](verification-proofs/jm182-lot2-ci-corrected.json). Le lot3 est acquis sur `3d0daff8bce9028b41879904ae167268537ca84c`, arbre `f3ac13619dc1a50c5494900229beb76e4bbe6759`, [CI5/5, Windows et tests de sonde](verification-proofs/jm182-lot3-ci.json) ; les résultats natifs existants ont été récupérés sans relance après interruption de la discussion. Les réserves encore non établies conservent leur portée. **La livraison technique du lot4 est close ; aucun lot d’implémentation ou de déploiement ne reste ouvert.** Chaque lot peut contenir plusieurs commits publiés sur la même branche de correction ; il ne nécessite pas une nouvelle version ni une nouvelle permission générale. Les corrections ne doivent pas réintroduire les fonctions abandonnées ou les anciennes opérations automatiques.

**Aucun travail technique supplémentaire n’est planifié pour la livraison182.** L’utilisateur confirme des échanges personnels et consentis et met le dossier RGPD de côté. A10 reste une préparation non finalisée hors du chantier actuel ; les autres limites restent décrites sans être assimilées à des résultats réussis. [Décision de périmètre et clôture](verification-proofs/jm182-current-scope-closure.json).

**Livraison technique182 close : aucune opération de déploiement restante.** [Préparation/CHECK](verification-proofs/jm182-hosted-preparation.json), [identité active](verification-proofs/jm182-hosted-identity.json) et [enregistrement final](verification-proofs/jm182-hosted-metadata.json) sont acquis par retour utilisateur. Le reçu `release182_metadata_recorded` rapporte source, arbre, Node et SQL exacts, `publicReady:true`, repli172 précontrôlé jamais démarré, historiques et autres blocs préservés. Aucune action opérateur supplémentaire n’est en attente ; ne pas relancer le writer. Ne pas rejouer fusion, publication, préparations, CHECK ou CI vertes. Le lot3 termine A09/A13–A15 ; le [diagnostic SQL A12](capacity-182.md) est acquis sans modification de migration, plafond, index ou schéma. Les premières preuves restent historiques.

Les corrections des lots1 à3 étaient actives dès la1.8.2 selon son identité rapportée et sont conservées dans1.8.3 ; leurs preuves natives restent distinctes des essais hébergés. L’aide factuelle A10 est harmonisée ; la préparation de notice reste non finalisée et hors du chantier actuel. Les notes privées D01/D08 sont enregistrées selon l’utilisateur, sans constituer une notice complète. Le relevé A11 exécuté ne permet pas de conclure sur le pair réseau ; aucune confiance proxy n’est ajoutée par supposition. Les appareils physiques non essayés restent non vérifiés.

**Tentative A11 terminée, résultat non concluant :** [reçu USER_REPORTED](verification-proofs/jm182-hosted-peer-observation.json), 40 échantillons et 40 lectures complètes de chaque table sans erreur, mais aucune connexion dans le périmètre port3000/UID courant. [Conclusion et limites](REPRISE.md#observation-a11--exécutée-résultat-non-concluant). Le risque conditionnel de pair partagé reste non levé ; le relevé ne prouve ni une panne, ni un proxy, ni un accès direct. Aucune relance, extension de sonde, modification de quota ou de confiance XFF n’est en attente. Ne rouvrir A11 qu’avec un élément nouveau sur le processus ou le contrat de forwarding applicable.

**A10 mis de côté à la demande de l’utilisateur :** usage déclaré personnel et consenti, sans conclusion juridique ajoutée. Le [candidat556fc385](https://github.com/fredbuhr/jessiemessage/commit/556fc38573a97e52cecdf49fba1c25b7b2de5040), branche `docs/privacy-notice-refresh`, reste conservé sans fusion, qualification native ou activation. Le modèle privé est lu par le runtime ; ne pas le déployer pour clore artificiellement cette réserve. Les notes D01/D08 sont [enregistrées](verification-proofs/jm182-hosted-privacy-notes.json), sans accès aux valeurs ni nouvelle saisie à demander. Aucun questionnaire, mécanisme de consentement ou publication de notice n’est ouvert dans ce lot. Les [critères examinés antérieurement](verification-proofs/jm182-a10-purpose-review.json) restent une preuve historique, pas une question à répéter.

À la clôture182, l’application et le checkpoint étaient en1.8.2/SQL36 selon son reçu final. À la clôture183, l’application, le checkpoint et latest étaient1.8.3 selon son reçu final. L’état courant1.11.0/SQL38 et sa publication sont consignés dans REPRISE. Les tests ciblés suivent les modifications ; une CI complète qualifie chaque source stabilisée, sans relancer des suites vertes identiques. Une éventuelle migration exigerait une qualification explicite et un repli compatible ; aucune n’est ajoutée à ce lot.

A12 décrit aussi de la dette de croissance, sans panne actuelle prouvée : fermeture au-delà de 10 000 campagnes globales, calcul de dernière activité désormais mesuré sur fixtures de 1 000/10 000 événements et budgets de polling. Les durées observées ne sont ni un benchmark ni une qualification de concurrence du mutualisé ; le parcours de l’historique reste une dette de croissance. Ne pas augmenter les plafonds, migrer SQL ou purger l’histoire par principe. Si un seuil ou une mesure démontre un blocage pour l’usage retenu, intégrer le correctif au lot concerné avant qualification. Les extractions générales de parseurs CHECK/contrôleurs restent facultatives après lancement ; retirer seulement les reliquats sans usage démontré.

## Clôture historique1.8.3 et contrôles reportés

Lors de sa clôture, la livraison **1.8.3** était active selon l’identité utilisateur : source `48fd42b808b2bc4d95d3f3ba21244c032d0a938f`, Node24.22.1 ; SQL36 issu de la preuve séparée, repli **1.7.2** précontrôlé et jamais démarré. Son checkpoint privé était aligné1.8.3, SHA-256 `17f575ebe83d0a9d9acf74e9436bff59eabcf8b5ed1bb8f0f99897c867c78a22`, selon le reçu final183 acquis sans redémarrage. G1–G4 et les opérations déjà acquises ne sont pas à rejouer. L’audit et les correctifs à venir ne réétiquettent pas les preuves historiques comme une qualification de leurs nouveaux cas.

**Les domaines sont terminés :** édition Web FTP annoncée enregistrée et [13 GET publics réussis](verification-proofs/accueil-redirect-confirmed-20261022.json), accueil/www vers le principal avec chemins et paramètres conservés. Conserver le service Node239143 et `recette.jessiemessage.com` comme origine de compatibilité ; même runtime/base que le principal, jamais cible de test destructible. Aucun changement Apache, DNS, certificat ou PHP à rejouer.

Le retour utilisateur valide la liste commune et le parcours vidéo. Il ne détaille pas tous leurs sous-cas ; l’audit identifie notamment le nettoyage serveur et les exports à compléter. Le [retour du brouillon de chat après rechargement](verification-proofs/jm182-hosted-draft-reload.json) est confirmé par l’utilisateur dans un cas ; appareil et navigateur non précisés. Les autres essais physiques non effectués restent explicitement non vérifiés.

| Contrôle différé | État et reprise |
| --- | --- |
| Sauvegarde manuelle admin | Création, fin et téléchargement **non vérifiés dans l’interface hébergée**. Test reporté à un autre jour à la demande de l’utilisateur, à reprendre uniquement lorsqu’il le demandera ; aucun diagnostic fournisseur, nouvel essai, rappel ou surveillance automatique n’est lancé. A02 est un constat statique/reproduit sur fixture, pas ce test hébergé. |
| Appareils et navigateurs non précisés | Le cas de retour du texte après le rechargement demandé est acquis par [confirmation utilisateur](verification-proofs/jm182-hosted-draft-reload.json), sans appareil ni navigateur indiqué ; ne pas le redemander. Les autres cas non essayés restent non vérifiés. Ne pas rejouer les parcours vidéo, réponses ou e-mails déjà confirmés, ni déduire un succès pour un téléphone, clavier, Authenticator ou notification système absent des preuves. |

**1.7.1 et 1.6.0 ne doivent plus démarrer sur SQL36.** Préserver clés, autorités, reçus, copies, quarantaines, fermetures et états historiques ; aucun nouveau parcours PC ni récupération totale de l’hôte n’est ouvert.

## Fonctions non abandonnées, à préciser et non ouvertes

La décision cite les fonctions abandonnées ci-dessus. Elle ne suffit pas à supprimer les autres sujets évoqués. Ils gardent le statut **à préciser, non ouvert**, sans prestataire, service, budget ou engagement de réalisation ajouté.

| Sujet | État réel | Limite de portée |
| --- | --- | --- |
| **Lovense** | Aucune intégration. | Action attendue et appareils à préciser avant tout chantier. |
| **Rappels privés push des tâches** | Compteur et rappels dans l’application ouverte ; aucun push de tâche lorsque l’application est fermée. | Éventuel rappel admin hors application à préciser ; aucune alerte au client à ajouter implicitement. |
| **Rendez-vous partagés** | Aucun module ; les tâches et leurs dates restent privées et n’avertissent pas le client. | Distinguer un partage explicite d’une tâche privée avant développement. |
| **Recherche de messages/notes** | Recherche de clients livrée ; recherche dans les contenus absente. | Périmètre à préciser, sans ajout au lot en cours. |
| **Réactions** | Absentes. | Usage à préciser, sans engagement de développement automatique. |

La **personnalisation des réponses**, intégrée depuis 1.8.0, est conservée dans la1.11.0 active ; l’utilisateur confirme le fonctionnement de la liste commune. Les sujets de cette table restent à préciser et non ouverts ; ils n’autorisent pas l’ouverture implicite d’autres évolutions.

## Exploitation et limites conservées

- **Authenticator et notifications sur appareils réels :** les correctifs/parcours navigateur existent, mais l’aller-retour téléphone, le clavier mobile et les notifications système avec application fermée ne sont pas entièrement attestés. Les essais synthétiques G3 ne remplacent pas un appareil absent ; les plateformes non essayées restent non vérifiées.
- **PHP du site secondaire :** relève d’Infomaniak ; aucune vérification ni intervention PHP n’est une action de ce plan. L’application Node utilise 24.22.1.
- **Accueil secondaire :** la redirection 308 vers le principal est désormais confirmée avec chemin et paramètres conservés par [13 GET publics](verification-proofs/accueil-redirect-confirmed-20261022.json), après édition manuelle annoncée enregistrée. L’ancien aperçu et la perte de query restent les constats de l’audit initial ; la [preuve du refus antérieur](verification-proofs/jm171-secondary-entry.json) reste historique et inchangée. Aucun correctif PHP n’est inclus.
- **PC/Avast :** le blocage signalé et le défaut de confirmation du kit restent non résolus, sans recette PC à reprendre pour G1. Le raccordement et ses clés restent préservés. Le parcours manuel qualifié et déployé en 1.8.0 ne dépend pas du PC ; aucune API cloud ou nouvelle infrastructure n’est ajoutée.
- **Archivage :** avertissement/simulation livrés, exécuteur absent. L’automatisation est abandonnée ; préserver copies et états historiques, sans purge ni nouvel exécuteur.

La récupération autonome après perte totale de l’hôte, le témoin frais à chaque phase, la succession et l’inventaire SQL exhaustif ne deviennent pas des prérequis. Le service `recette` partage la production : restauration, charge et suppressions de qualification restent synthétiques sur des cibles réellement isolées.

## Organisation du travail

Conserver des checkpoints Git reprenables et la preuve de chaque opération distante, tout en poursuivant plusieurs sous-tâches cohérentes d’un même livrable sans demander une nouvelle permission générale. Ne pas relancer les mêmes audits et suites vertes sans changement, échec ou préoccupation nouvelle. Regrouper les contrôles quand leurs dépendances le permettent ; ne jamais promouvoir une omission ou un test unitaire en essai réel sur téléphone, hébergement ou compte client.

**À chaque étape, annoncer ce qui est fait et ce qui reste pour le résultat en cours.** Les quatre lots de correction sont livrés ; aucun lot technique ne reste ouvert pour1.8.2, et les réserves conservent leur portée sans ouvrir automatiquement un travail. Conserver un checkpoint publié après chaque résultat cohérent : branche/commit/arbre, contrôles acquis, limites et prochaine action unique. Après interruption, lire le résultat durable avant toute nouvelle mutation. La livraison active rapportée1.11.0, sa publication et son checkpoint privé sont alignés selon le reçu final utilisateur ; ses preuves natives et hébergées restent distinctes des cas non essayés. La sauvegarde hébergée reste volontairement reportée. Les contrats et preuves historiques du [cycle de vie vidéo](video-lifecycle-180.md) sont conservés sans réétiquetage.

## Livraisons closes

- **Messagerie et fiabilité1.8.3** : dix signalements de parcours etB01–B05/I01 corrigés, PR130 fusionnée, CI PR/main5/5, tag/release/latest, préparation/CHECK et identité active acquis. [Reçu final183](verification-proofs/jm183-hosted-metadata.json) : checkpoint1.8.3/SQL36 aligné, `publicReady:true`, historiques et repli1.7.2 jamais démarré préservés, sans redémarrage. Aucune opération technique restante ; essais physiques non acquis et sauvegarde reportée conservés comme limites.


- **Fiabilité182** : lots1–3 qualifiés, PR129 fusionnée, CI main5/5, tag/release/latest sur source `78e6b8b2f6b19020c060345b9313a81829e9c8da`, préparation/CHECK et identité active acquis. Le [reçu final182](verification-proofs/jm182-hosted-metadata.json) aligne le checkpoint SQL36, `publicReady:true`, avec repli172 et historiques préservés, sans redémarrage. A10 reste hors du chantier actuel selon la demande utilisateur ; A11 non concluant et les essais non réalisés restent des limites explicites, sans action automatique planifiée.

- **Sécurité Node et entrée privée 1.7.1** : correctif fusionné, CI PR/main 5/5, tag/release, préparation et précontrôles, identité active et HTTP confirmés. Le [reçu final](verification-proofs/jm171-hosted-metadata.json), `release171_metadata_recorded`, confirme le schéma 33 inchangé, le repli 1.6.0 sur Node 24.22.1 précontrôlé et enregistré sans démarrage, les états historiques et les autres blocs préservés. [Preuves CI](verification-proofs/jm171-verification.json), [publication](verification-proofs/jm171-publication.json), [préparation Node et repli](verification-proofs/jm171-hosted-node-preparation.json), [identité hébergée](verification-proofs/jm171-hosted-identity.json). L’essai Authenticator physique reste non vérifié ; PHP relève du fournisseur. Le principal et www affichent le nouvel accueil, tandis que le sous-domaine accueil conserve l’ancienne illustration ; la redirection refusée n’est pas reprise dans ce chantier, selon la [preuve secondaire](verification-proofs/jm171-secondary-entry.json). La vidéo reste dormante.

- [Transport vidéo privé 1.7.0 — socle du lot 6](video-transport-170.md) : code fusionné, CI PR/main 5/5 et tag/release publiés ; transport dormant, aucune nouvelle route ni donnée vidéo de production, schéma 33 inchangé. [Preuves](verification-proofs/jm170-verification.json). Intégration produit et cycle de vie au lot 7.
- [Tâches et rappels privés 1.6.0 — Évolution 5](tasks-reminders-160.md) : plusieurs tâches par client, échéances, report, terminer et réouvrir, vue commune et alertes dans l’application. Qualification, publication, migration et précontrôles sur le schéma 33, identité active et alignement privé confirmés. Le [reçu final](verification-proofs/jm160-hosted-metadata.json) conserve le [repli compatible 1.5.1](tasks-compat-151.md) précontrôlé et enregistré sans démarrage, l’ancien état 1.5.0 intégral avec son empreinte et les autres blocs. Aucun push de tâche lorsque l’application est fermée. [Preuves](verification-proofs/jm160-verification.json).
- [Annonces 1.5.0 — Évolution 4](announcements-150.md) : bandeau compact, programmation, expiration et messages privés facultatifs ; qualification, publication, migration et précontrôles sur le schéma 32, identité active et alignement privé confirmés. Le [reçu final](verification-proofs/jm150-hosted-metadata.json) confirme le [repli compatible 1.4.1](announcements-compat-141.md) précontrôlé et enregistré, jamais démarré, l’ancien état 1.4.0 intégral et les autres blocs préservés. [Preuves](verification-proofs/jm150-verification.json).
- [Diffusions à grande échelle 1.4.0](broadcast-scale-140.md) : audiences globales, filtrées ou manuelles sans plafond métier de cent, aperçu confirmé et suivi paginé ; qualification sur 2 500 destinataires synthétiques, précontrôles et identité active confirmés. Clôture acquise par `release140_metadata_recorded`, schéma 31 inchangé ; [repli compatible 1.3.4](broadcast-compat-134.md) précontrôlé et enregistré sans démarrage. L’ancien état 1.3.3 et tous les autres blocs sont préservés. [Preuves](verification-proofs/jm140-verification.json).
- [Voix de Jessie, messages compacts et détails des photos 1.3.3](photo-message-details-133.md) : code qualifié et publié, préparation et activation confirmées ; clôture acquise par `release133_metadata_recorded`, schéma 31 inchangé et repli immédiat 1.3.1 préservé. [Preuves](verification-proofs/jm133-verification.json). Aucune manipulation supplémentaire n’est requise pour cette livraison.
- [Messagerie mobile 1.3.1](chat-mobile-131.md) : préparation et activation acquises ; alignement privé confirmé par `release131_metadata_already_recorded`, repli immédiat de 1.3.3.
- [Emojis enrichis et inclusifs 1.3.0](emoji-inclusifs-130.md) : clôture confirmée par `release130_metadata_recorded`, preuves historiques préservées ; référence conservée comme repli de 1.3.1.
- [Profil et expressions 1.2.0](profile-expressions-120.md) : production identifiée, schéma 31, disponibilité et checkpoint alignés ; repli 1.1.1 compatible précontrôlé.
- [Lecture privée 1.1.0](private-read-receipts-110.md) et [preuves d’harmonisation 1.0.0](REPRISE-HISTORIQUE-20261022.md#historique--validation-locale-de-100).
- [Clôture V1 0.86](production-086.md) et [qualification Node associée](node-runtime-086.md).
- [Envoi confirmé après perte de réponse HTTP, 0.85](chat-send-ack-085.md).
- [Clôture des corrections de l’audit, 0.83](audit-closure-083.md), [audit daté](AUDIT-CODE-2026-10-20.md) et [corrections d’interface](audit-corrections-083.md).
- [Recette V1 initiale, S3/0.79](messaging-acceptance-079.md), [preuves S1](verification-proofs/jm076-verification.json), [restauration manuelle S2](manual-restore-operator-078.md).
- [Historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md) et [ancien journal](NEXT-STEPS.md).

Ces bilans conservent leurs versions, heures, réserves et limites ; ils ne constituent pas une seconde liste d’actions courantes. Le compteur historique « 4/6 » ne désigne aucun travail V1 oublié. Les garanties de récupération autonome, de témoin frais par phase, de succession et d’inventaire SQL exhaustif restent hors des prérequis V1.
