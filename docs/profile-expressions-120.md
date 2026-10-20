# Évolution 2 — Profil et expressions, 1.2.0

**21 octobre 2026 — code fusionné, qualifié et publié en 1.2.0 ; migration 0031 et précontrôles hébergés réussis ; identité active 1.2.0 confirmée par relevé admin utilisateur ; checkpoint encore en 1.1.0, alignement final en attente.** L’[état courant](REPRISE.md) distingue la production des candidats et consigne les références opérateur. Ce bilan décrit le périmètre et les critères de livraison du lot ; les preuves de son commit sont consignées ci-dessous.

## Périmètre

- **Mon profil**, côté client et administration : pseudonyme public de 64 caractères maximum et avatar, visibles dans les échanges authentifiés. Le nom public reste distinct du surnom privé CRM. E-mail, mot de passe et notes privées conservent leurs parcours existants.
- **Avatar** : aperçu rond, choix/remplacement/retrait puis enregistrement explicite. Le navigateur réutilise la préparation d’image existante et recadre le centre en JPEG carré de 256 pixels. L’asset passe par le stockage média privé existant ; le serveur contrôle l’appartenance et les limites avant de l’attacher au profil. L’upload ne crée aucun message. Si les médias sont désactivés, l’édition du nom reste possible.
- **Modifications simultanées** : version du profil contrôlée à l’enregistrement ; un conflit garde le brouillon et propose de recharger le profil enregistré ou de garder son brouillon avant une nouvelle confirmation. Fermer, masquer la page ou perdre le contexte du compte interrompt les opérations et libère les aperçus ; aucun profil n’est persisté dans le stockage local du navigateur.
- **Expressions** : catalogue de **180 emojis Unicode**, organisé par catégories, avec recherche en français et anglais. Un choix s’insère dans le brouillon du message ; l’utilisateur confirme toujours l’envoi. Aucun sticker graphique ni média supplémentaire n’est créé.

Le service Node et l’hébergement mutualisé sont conservés ; aucune dépendance ni infrastructure nouvelle. Annonces, vidéo, alertes de rappels et diffusion à grande échelle restent des évolutions distinctes.

## Migration et repli

Les profils nécessitent la migration **`0031`**, désormais appliquée sur l’hébergement selon les reçus utilisateur. Le repli compatible est **1.1.1**, précontrôlé sur le schéma 31 et non démarré ; la dernière identité HTTP 1.1.0 est historique depuis la maintenance. La [release 1.1.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.1.1) est publiée sur `cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a`, après CI complète du commit exact. Le [bilan de compatibilité](profile-schema-111.md) conserve sa portée ; la préparation et le précontrôle hébergé du repli sont confirmés par reçus utilisateur, sans démarrage.

1. **Réalisé en qualification synthétique** : passage 30→31 et fonctionnement de la 1.1.1 sur le schéma 31, y compris les contrôles d’exploitation concernés ; commit et release figés. Préparation hébergée et précontrôle après migration désormais confirmés.
2. **Réalisé** : [PR 112](https://github.com/fredbuhr/jessiemessage/pull/112), [CI main exacte 5/5](https://github.com/fredbuhr/jessiemessage/actions/runs/39500108614), puis [tag/release 1.2.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.2.0) sur `763b632185ce13eb875110c9107687b2d278ff67`, arbre `c7dce7bcdb99b298ffc43c9e31dd22ee87453926`.
3. **Migration et précontrôles réalisés** : après arrêt attesté par l’opérateur, reçu `schema31_confirmed_before_prechecks`, migrateur `upgraded`, 31 migrations, une appliquée et 30 inchangées. Le reçu final `schema31_prechecks_passed` confirme les précontrôles 1.1.1/1.2.0, sans runtime démarré, changement Manager ou checkpoint. Les commandes exécutées restent conservées comme preuves ; ne pas les rejouer.
4. **Activation réalisée** : Run/Build enregistrés et identité admin 1.2.0 confirmée, puis quatre GET publics conformes. **Reste uniquement l’alignement du checkpoint**, sans redémarrage, avec repli compatible et autres blocs conservés. Ne pas répéter l’activation ni le relevé admin.

**Après application de `0031`, ne pas revenir au code 1.1.0 ni 1.0.0.** Le repli applicatif prévu est la **1.1.1 préqualifiée sur ce schéma**. Un repli de code ne retire pas la migration et n’implique aucune restauration SQL automatique. L’identité active et le repli compatible sont consignés dans REPRISE.

## Identité active et disponibilité

Le relevé admin transmis par l’utilisateur confirme **1.2.0**, commit `763b632185ce13eb875110c9107687b2d278ff67`, Node **v24.22.0**, relevé au démarrage **`21/10/2026 00:21:24`**. Le texte affiché est conservé ; fuseau du navigateur et epoch non fournis. Cette preuve identifie le processus HTTP répondant ; l’agent n’a pas lu directement le GET privé et n’atteste ni PID/socket ni empreinte du binaire actif. Le Run et le Build précontrôlé sont déjà enregistrés ; aucun redémarrage supplémentaire n’est demandé.

À `2026-10-20T22:24:58.673794+00:00`, les quatre GET HTTPS directs santé/disponibilité sur les deux origines sont conformes : HTTP 200, JSON exact `ok`/`ready`, `no-store`, aucun cookie, certificat vérifié et redirections refusées. Le premier essai réseau partiel reste conservé comme tentative, sans diagnostic de panne applicative. Ces GET attestent la disponibilité, pas la version. [Relevé structuré](verification-proofs/jm120-verification.json).

## Alignement du checkpoint — en attente

Le checkpoint est encore enregistré en **1.1.0** ; la production est déjà **1.2.0**. Le [writer publié](https://github.com/fredbuhr/jessiemessage/blob/5afd2ac70635579a0645b001bb30e590f95a0c18/ops/record-release120.py), SHA-256 `744943663e267e360c8692e8fcb48a40456faf4cb60283595a62e744d8debfda`, a réussi **8/8 tests synthétiques**, dont la reproduction du fichier empaqueté. Son exécution serveur reste à constater.

Il archive l’ancien `activeService` 1.1.0 intégral sous `release120.priorActiveService`, avec empreinte et `priorActiveServiceUsableRollback:false`. Le véritable repli est la 1.1.1 compatible schéma 31, avec ses source/arbre/lanceur vérifiés et précontrôle réussi, sans lui attribuer une identité HTTP de démarrage. Les autres blocs sont conservés. L’écriture est limitée aux métadonnées, sans redémarrage.

Depuis le terminal SSH existant, la seule commande restante est :

```sh
python3 - <<'PY120RECORD'
import hashlib, urllib.request
url = "https://raw.githubusercontent.com/fredbuhr/jessiemessage/5afd2ac70635579a0645b001bb30e590f95a0c18/ops/record-release120.py"
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != "744943663e267e360c8692e8fcb48a40456faf4cb60283595a62e744d8debfda":
    raise SystemExit("Empreinte incorrecte : arrêt.")
exec(compile(code, "<enregistrement>", "exec"))
PY120RECORD
```

Le reçu attendu est `release120_metadata_recorded`, source `763b632185ce13eb875110c9107687b2d278ff67`, version `1.2.0`, `schemaMigrations:31`, `rollbackRelease:1.1.1`, `metadataOnly:true`, `noRestart:true`, `priorActivePreserved:true`, `rollbackPreserved:true`, `otherBlocksPreserved:true`. Aucun reçu d’écriture 1.2.0 n’est encore acquis ; le lot n’est pas déclaré entièrement clos. Après une interruption, lire le reçu et l’état durable avant toute relance.

## Validation et limites

Les contrôles ciblés couvrent les requêtes du profil, les conflits de version, le maintien des brouillons, les réponses ou aperçus devenus obsolètes, le nettoyage des URL et l’accès clavier. Le catalogue est borné et son insertion n’envoie pas le message. La persistance réelle et les contrôles intercomptes sont confirmés par les tests SQL et le nouveau parcours HTTPS/Chrome ; le retrait invalide les anciennes URLs sans supprimer l’asset propre.

Les CI de PR et du commit exact livré réussissent 5/5 : général 3 177 réussis/36 ignorés/0 échec ; MariaDB 10.11 et 11.4 : 479/479 chacune sans omission ; Chrome 168/168 ; HTTPS/MariaDB 3/3 ; syntaxe/build 583 sources. La publication vérifiée du tag immuable est le [run 39500847054](https://github.com/fredbuhr/jessiemessage/actions/runs/39500847054). Un test local ou ignoré ne vaut pas qualification native ; ces résultats ne prouvent pas une activation hébergée. Aucun appareil physique, campagne réelle ou capacité de charge nouvelle n’est revendiqué. Les preuves de la 1.1.0, les clés, les sauvegardes/PC et les états D1 restent préservés.
