# Cycle de vie vidéo 1.8.0 en développement — jalon 7.3

**7.3a, 7.3b et 7.3c sont qualifiés sur `feat/video-messaging`. Le jalon 7.3 reste incomplet ; prochaine étape 7.3d.1, inventaire vidéo en lecture seule avant capture, restauration et anciens formats.** La version de développement demeure **1.8.0**, sans tag, release, fusion ou déploiement intermédiaire. Les [preuves du catalogue 7.1](video-catalogue-180.md) et du [message privé 7.2](video-messages-180.md) conservent leurs sources et résultats propres. La version active, son checkpoint et son repli restent exclusivement identifiés dans [REPRISE](REPRISE.md).

## Découpage borné de 7.3

Le diagnostic du code établit trois couplages : l’export photo assemble un JPEG dans un `Buffer` ; le [ZIP de conversation](../server/chat/conversation-export.mjs) assemble l’archive en mémoire avec une limite de 32 Mio ; capture, inventaire et restauration imposent encore le schéma 33, les fichiers photo et leurs bindings de racine/formats authentifiés. Ajouter une vidéo de 100 Mio dans ces contrats sans les adapter serait incohérent. Cette subdivision organise une reprise durable ; elle ne prétend ni expliquer ni résoudre les coupures internes de ChatGPT.

| Sous-étape | Résultat et critère de fin | État |
| --- | --- | --- |
| **7.3a — Export opérateur candidat** | Export privé en flux depuis un snapshot SQL en lecture seule ; déduplication, légendes, tombstones et fichiers vérifiés par taille/SHA-256 ; aucun marqueur complet avant le commit de lecture. Qualification synthétique des interruptions, corruption de bloc et perte d’accusé. | Qualifié sur branche, CI 5/5. |
| **7.3b — ZIP de conversation** | Adapter l’archive au flux sans charger la vidéo entière ni réutiliser implicitement la limite historique de 32 Mio ; droits, annulation et erreurs qualifiés sur un téléchargement synthétique. | Qualifié sur branche, CI 5/5. |
| **7.3c — Suppression, fermeture et capacité** | Suppression durable et reprise après interruption, références partagées préservées, absence de fichiers vérifiée avant remboursement de charge ; fermeture synthétique sans toucher le client témoin. | Qualifié sur branche, CI 5/5, MariaDB 552/552 chacune sans omission. |
| **7.3d — Inventaire, capture et restauration** | Recenser les vidéos et réservations, capturer/restaurer une fixture non vide, comparer données et empreintes, préserver les anciens formats selon leur propre version et qualifier la compatibilité avant promotion des migrations. | À réaliser. |

Ces sous-étapes restent dans la même branche et la même PR de travail. Elles n’ajoutent aucune livraison produit, version ou activation ; 7.3 n’est terminé qu’après les quatre critères. Le [lot 7](PLAN-IMPLEMENTATION.md) conserve une seule livraison complète en 7.6.

## Contrat qualifié de 7.3a

La composition est explicite et réservée à l’appelant opérateur candidat :

| Point d’intégration | Contrat |
| --- | --- |
| [`withClientData`](../server/data/store.mjs) avec `video: createVideoDataReader()` | Les messages et la bibliothèque vidéo sont lus sur la même connexion et dans le même snapshot SQL `READ ONLY`. L’extension vidéo n’utilise ni écriture ni verrou `FOR UPDATE`. |
| [`createVideoDataReader()`](../server/video/data-store.mjs) | Vidéos enregistrées du client et vidéos livrées par ses messages vivants ; refus des dérives de propriétaire, rôle, conversation ou double lien photo/vidéo. Les tombstones n’exigent pas la lecture d’un asset vivant. |
| [`exportClientContent`](../server/data/export.mjs) avec `videoStorage` | Lecture authentifiée de l’original, par blocs de **256 Kio maximum**, jusqu’à **100 Mio** ; taille totale et SHA-256 comparés aux métadonnées du catalogue. Aucun `Buffer` de la vidéo entière. Les buffers déchiffrés sont effacés après consommation ; les fichiers source chiffrés ne sont pas modifiés. |
| [`createDataWriter`](../server/data/writer.mjs) avec `video: true` | `writer.video(name, source, { bytes, signal })` écrit le flux dans un dossier opérateur privé, distinct des racines source protégées. La finalisation appartient à l’appelant après le succès de `withClientData`, donc après son commit de lecture. |

Un original est copié une seule fois par identifiant vidéo même si plusieurs messages ou la bibliothèque le référencent. Chaque message garde sa propre légende ; le corps et son lien vidéo sont vérifiés avec l’empreinte typée de 7.2. Le fichier exporté est `media/<id>.mp4` et sa référence publique d’export comporte `file`, `type: "video/mp4"` et `bytes`. Un tombstone conserve une ligne sans contenu ni vidéo. Les originaux administrateur non livrés et les données d’un autre client sont exclus.

Ce mode produit **`account.json` version 2** et **`COMPLETE.json` version 2**. Les compteurs `mediaFiles`, `mediaBytes` et `libraryItems` restent les totaux tous médias ; `videoFiles`, `videoBytes` et `videoLibraryItems` détaillent la vidéo. Sans ces options explicites, la forme du mode historique version 1 reste inchangée et un contenu vidéo vivant n’est pas réinterprété comme du texte.

L’export ne publie jamais lui-même `COMPLETE.json`. Une interruption, une erreur d’authentification d’un bloc ou un accusé perdu après le commit SQL laisse un export incomplet ; aucun succès n’est déduit de l’exception ou de fichiers déjà écrits. Les sorties privées partielles restent identifiées comme incomplètes. Le lecteur ne modifie ni messages, ni catalogue, ni capacité, ni fichiers source.

## Qualification et limites de 7.3a

Source fonctionnelle **`60dd2a3d45fa14be0db5f7336abc7197186a541d`**, arbre **`14a85eb3c604db72aedcaeb03f24358f48d6282a`**, [PR 125 en brouillon](https://github.com/fredbuhr/jessiemessage/pull/125). La [CI propre 39677371107](https://github.com/fredbuhr/jessiemessage/actions/runs/39677371107), terminée le `2026-10-21T21:22:52Z`, réussit **5/5, tentative 1**, sous Node **24.22.0** : général **3 466 tests / 3 424 réussis / zéro échec / 42 ignorés**, Chrome **189/189**, HTTPS **3/3**, MariaDB **10.11 et 11.4 chacune 533/533 sans omission**. Un run PR, aucun run CI de type push ni relance. Merge synthétique testé **`7f3bd43426464d752d1f597cbf325f4655943ddb`**, de même arbre que la source. [Preuve structurée](verification-proofs/jm180-video-export-verification.json).

Les cinq nouveaux scénarios natifs réussissent sur chaque moteur : parcours réel catalogue/stockage/message, deux clients isolés, original administrateur partagé, déduplication, légendes, bibliothèque propre et tombstones ; empreintes de fichiers lues en flux et état SQL/capacité comparés avant/après ; interruption, corruption d’un bloc et perte d’accusé après un véritable commit en lecture seule sans marqueur complet. Les dix scénarios catalogue et les dix scénarios messages restent verts. Les 42 omissions générales (40 SQL, deux procfs) restent distinctes de ces qualifications natives.

Localement : syntaxe **641 sources**, export historique **16/16**, export vidéo **12/12**, store **19/19**, writer **25 réussis et 12 ignorés procfs**. Aucun résultat complet de suite générale locale n’est revendiqué. Les tests dirfd omis localement réussissent réellement en CI ; les parcours synthétiques de l’original de **100 Mio** et de contre-pression aussi. Ces contrôles ne mesurent pas le pic mémoire du processus ni le débit réel du mutualisé. Le suivi documentaire seul utilise `[skip ci]`, sans changement de la source fonctionnelle qualifiée.

7.3a n’ajoute **aucun branchement CLI, runtime ou route**. Les migrations restent candidates : **plan normal 33, plan candidat 36**, sans promotion ni migration hébergée. À la clôture de 7.3a, les étapes b–d restaient à réaliser. La suppression physique, la fermeture, l’inventaire, la capture, la restauration et la compatibilité des anciens formats restent à adapter. Aucun résultat de restauration, débit du mutualisé, pic mémoire mesuré, codec ou téléphone n’est déduit des tests de flux synthétiques.

## Contrat qualifié de 7.3b — ZIP de conversation en flux

`createStreamingConversationExporter` compose explicitement les lecteurs autorisés de messages, photos et vidéos. Le résultat `{ bytes, stream({ signal }), close() }` est à usage unique, avec taille totale connue, fermeture idempotente et déclenchement de l’annulation après cinq minutes au plus. Le slot reste tenu jusqu’à la fin effective des I/O. Le ZIP32/STORED et son CRC32 sont calculés en flux ; répertoire central et footer ne sont émis qu’après le succès de toutes les sources et leur fermeture.

| Contrat | Limite ou comportement |
| --- | --- |
| Archive candidate | **256 Mio** maximum, blocs de **256 Kio** maximum ; original vidéo jusqu’à **100 Mio**. Aucune vidéo entière assemblée en mémoire. |
| Préparation retenue | 10 000 messages, trois documents cumulés ≤8 Mio et photos ≤32 Mio ; ces budgets de payload ne constituent pas une mesure du pic RSS. |
| Vidéo | Ouverture paresseuse et séquentielle via le lecteur du message vivant, avec nouvelle vérification des droits au moment de la lecture ; taille et MIME comparés à l’historique. |
| Intégrité | Authentification GCM de chaque bloc et CRC32 incrémental du ZIP. Le lecteur de message ne fournit pas le SHA-256 du catalogue : aucune comparaison globale à cette empreinte n’est revendiquée. |
| Conversation | JSON version **2**, originaux dédupliqués par identifiant, légendes distinctes, tombstones sans contenu, bibliothèques privées non partagées exclues. `includeVideos:false` conserve un placeholder avec `file:null`. |
| Lecture hors ligne | HTML échappé, lecteur vidéo natif, CSP locale, chemins de fichiers bornés ; aucun URL privé de contenu ni identifiant d’authentification dans l’archive. |
| Transport opt-in | Les handlers client/admin exigent exactement `{ includePhotos, includeVideos }` quand l’exporteur annonce `videos:true`. Autorisation recontrôlée avant les en-têtes, slot partagé jusqu’à la fermeture réelle, écriture attendue avant effacement des buffers. |
| Interruption | Une source interrompue, corrompue ou de taille invalide ne produit aucun répertoire central/footer ; un échec de transport interrompt la réponse sans queue JSON. Les octets déjà transmis ne peuvent pas être repris. Les sources ouvertes sont fermées et les buffers possédés effacés. |

L’exporteur historique reste en `Buffer`, JSON version 1 et limite 32 Mio ; une vidéo vivante inattendue est refusée plutôt qu’omise. Le nouveau mode n’est branché ni dans `server/index.mjs`, ni dans le CLI ou le navigateur. Le récepteur navigateur existant reste limité à 32 Mio et construit un Blob ; son adaptation, ainsi que le délai HTTP global actuel de 35 secondes, appartient à l’intégration avant activation. Le délai candidat de cinq minutes ne change pas ces contraintes du runtime normal.

## Qualification de 7.3b et prochaine action

Source fonctionnelle **`333a6a00a3fe13708a892077d810ea2ff65962a5`**, arbre **`d1ed0244b1581975c5e70febe50224ba199baca3`**, [PR 125 en brouillon](https://github.com/fredbuhr/jessiemessage/pull/125). La [CI propre 39680754396](https://github.com/fredbuhr/jessiemessage/actions/runs/39680754396), terminée le `2026-10-21T21:47:24Z`, réussit **5/5, tentative 1**, sous Node **24.22.0**. Un seul run PR, aucun run push de branche ni relance. Merge synthétique testé **`c506589c52c335da12d4bbfb77b38250b91b4981`**, arbre exactement identique à la source. [Preuve structurée](verification-proofs/jm180-conversation-archive-verification.json).

Les cinq journaux complets sont relus : général **3 504 tests / 3 461 réussis / zéro échec / 43 ignorés**, Chrome **189/189**, HTTPS **3/3**, MariaDB **10.11 et 11.4 chacune 539/539 sans omission**. Les 43 omissions générales sont 41 suites SQL opt-in et deux tests négatifs « procfs absent » inapplicables parce que procfs est disponible ; elles ne sont pas des succès natifs. Chaque moteur réussit les cinq nouveaux scénarios ZIP, les dix catalogue, dix messages et cinq export opérateur.

La fixture native télécharge réellement par HTTP côté client et administrateur vers un fichier privé ; un lecteur ZIP indépendant vérifie répertoire, descripteurs, tailles, CRC32 et SHA-256 en flux. Elle couvre deux clients isolés, partage, légendes, déduplication, tombstone, bibliothèques exclues, refus d’accès, corruption du second bloc GCM et suppression/révocation après préparation. Les données SQL métier, la capacité et les fichiers chiffrés source sont comparés ; les budgets d’authentification et de limitation consommés par ces appels autorisés ne sont pas présentés comme immuables.

Localement : syntaxe **647 sources**, parcours historiques **93/93**, nouveaux ciblés **36 réussis / zéro échec / une suite SQL ignorée** faute de MariaDB. Les 36 nouveaux tests unitaires passent aussi en CI : ZIP **11**, factory **14**, transport HTTP **11**. Ils qualifient une source paresseuse de 100 Mio, la contre-pression et les annulations pendant ouverture, lecture ou écriture. Trois revues croisées sans blocage. Aucun succès complet de suite générale locale, pic RSS mesuré, débit hébergé, codec ou téléphone n’est déduit. Le suivi documentaire seul utilise `[skip ci]` ; il ne change pas la source fonctionnelle qualifiée.

**Prochaine action unique : 7.3c — suppression, fermeture et capacité.** 7.3 reste incomplet ; 7.3d doit encore qualifier inventaire, capture/restauration et anciens formats avant promotion. Plans SQL normal **33** / candidat **36** inchangés. Aucune fusion, publication, migration hébergée, activation ou opération PC/Avast.

## Contrat qualifié de 7.3c — suppression, fermeture et capacité

Le catalogue passe un original sans référence vivante de `committed` à `cleanup_pending` avant toute I/O ; cette transition bloque lectures et nouveaux envois. `service.remove()` lie le catalogue à la racine physique avant et après le nettoyage. Le compteur est décrémenté seulement après `removed:true`, dans la transaction qui passe l’asset à `released`. Les réessais conservent les tombstones et ne redécrémentent pas. Le nettoyage de réservation `release()` reste distinct et ne rembourse jamais un original enregistré.

`storage.remove()` nettoie l’original et les fichiers temporaires strictement associés à sa clé, vérifie l’identité et les permissions des fichiers, synchronise et revérifie l’absence. Une publication interrompue hardlinkée est récupérée seulement si tous ses liens sont les noms final/temporaire attendus ; lien extérieur, remplacement ou erreur de fermeture refusent le succès. L’appelant doit rendre la clé non publiable et arrêter les producteurs concernés ; les vérifications de fichiers ne remplacent pas cette exclusion.

`createVideoErasureExtension()` et `composeVideoErasureStorage()` sont des compositions candidates explicites, sans branchement runtime/CLI/HTTP. Les hooks SQL utilisent la connexion du bail existant. La fermeture supprime les liens de la conversation cible avant ses messages, les fichiers et réservations vidéo du client avant son compte, et préserve les originaux administrateur partagés. Le journal v2 authentifie indépendamment les racines photo et vidéo et des curseurs monotones `p:id` / `v:id`, y compris lorsque les identifiants des deux catalogues sont identiques. V1 demeure inchangé par défaut ; aucun journal ancien n’est converti ni réinterprété implicitement.

La migration candidate 0035 ajoute `cleanup_pending`. Les 33 migrations du parcours normal restent identiques ; les 36 candidates ne sont pas promues. Le schéma candidat est contrôlé sur ses sources exactes, 35 tables et 49 clés étrangères. **7.3d doit encore qualifier inventaire, capture/restauration et compatibilité des anciens formats avant promotion.**

La nouvelle fixture native utilise les vrais fichiers GCM, le journal chiffré et un runtime synthétique réellement démarré puis arrêté avant fermeture. Ses douze scénarios couvrent les références vivantes, la mauvaise racine, les réponses perdues après unlink ou commit SQL réel, la reprise bornée, la collision des identifiants photo/vidéo, les réservations temporaires, le client témoin et une seule connexion SQL. **Ces douze scénarios et leur parent réussissent sur MariaDB 10.11 et 11.4 ; leur omission locale reste distincte de cette qualification native.**

## Qualification de 7.3c et prochaine action

Source corrigée **`231315cc17fd992eb3d9b261ea1e4448b90fd1d3`**, arbre **`29c765ad216a2ad0ab140145e836caeb920dc482`**. La [CI propre 39698017769](https://github.com/fredbuhr/jessiemessage/actions/runs/39698017769) réussit **5/5, tentative 1**, sous Node **24.22.1** : général **3 559 tests / 3 515 réussis / zéro échec / 44 ignorés**, Chrome **196/196**, HTTPS **3/3**, MariaDB **10.11 et 11.4 chacune 552/552 sans omission**. Merge synthétique **`c36d46cb1c195e702bfa92d2fffcc3e6ba548255`**, arbre identique à la source ; cinq journaux complets relus, aucun rerun. [Preuve structurée](verification-proofs/jm180-video-deletion-verification.json).

La première source `53ef2d8923ad22ec63eb7a98e8042d5d9c09566b` conserve son échec **3/5**, [CI 39697059270](https://github.com/fredbuhr/jessiemessage/actions/runs/39697059270), dans la même preuve. Chaque moteur avait 550 réussites et deux échecs : le test attendait `ERASURE_SCHEMA` alors que le ledger vidéo était déjà correctement refusé par `HISTORY_DIVERGED`, puis neutralisé en `ERASURE_UNAVAILABLE` par le store. La correction attend ces erreurs exactes sans modifier le code métier ; une fixture non vide et la comparaison intégrale des tables, capacités et fichiers prouvent l’absence de mutation à chaque refus et que le callback destructif n’est jamais appelé.

Les 44 omissions générales sont 42 suites SQL opt-in et deux tests négatifs procfs inapplicables. Les trois scénarios Linux réels de stockage réussissent. Localement : syntaxe 654 sources, ciblés communs 110 réussis / zéro échec / six omissions explicites ; aucun succès complet de la suite générale locale n’est revendiqué faute de footer. La preuve distingue ces observations des résultats natifs CI. Le suivi documentaire seul utilise `[skip ci]` sans modification fonctionnelle.

**Prochaine action unique : 7.3d.1 — inventaire vidéo candidat en lecture seule sur fixture isolée.** Capture authentifiée à deux racines, restauration, comparaison des données/empreintes et compatibilité des anciens formats viennent ensuite, avant promotion. Aucun branchement runtime/CLI/HTTP, fusion produit, publication, migration hébergée, activation, compte réel ou opération PC/Avast. Les limites navigateur 32 Mio/Blob et délai HTTP 35 secondes restent à traiter avant activation.
