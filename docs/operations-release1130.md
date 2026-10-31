# Livraison 1.13.0 — publication acquise, hébergement non préparé

État du31octobre2026. [REPRISE](REPRISE.md) reste la référence courante ; ce guide distingue la publication de l'installation sur le service Node239143. `recette.jessiemessage.com` et `jessiemessage.com` partagent ce service et sa base.

## Résultat acquis

- [PR144](https://github.com/fredbuhr/jessiemessage/pull/144) fusionnée ; source/tag **`b9e2ad78b47dccb72b8e793cdc448e6b70424430`**, arbre **`dc8933723a54c0307a3fd52719bdd4fd3ac3f96a`**. `main` documentaire peut avancer ensuite, sans déplacement du tag.
- Qualifications finales [PR41221505431](verification-proofs/jm1130/pr-native.json) et [main41222320731](verification-proofs/jm1130/main-native.json), tentative1,5/5 chacune. Général4170réussis/52omissions sur4222 ; Chrome292/292, HTTPS14/14, MariaDB613/613 chacune. Douze captures finales inspectées, arbre complet identique sur main. [Bilan et limites](conversation-lists-1130.md).
- [Publication41223112832](verification-proofs/jm1130/publication-native.json), tentative1,2/2 ; neuf tests natifs de l'opérateur sans omission. Opérateur `01c448fb65432366acb8b07a5df2743053a5611e`, arbre `728079800a5d44ed8c729f647daca75ced4a0c5a`. Scripts et workflow relus aux octets qualifiés. [Tag/release/latestv1.13.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.13.0), release430071184, concordants.
- Nodev24.22.1,38migrations/37tables attendues, dépendances inchangées. Aucun inventaire physique de production nouveau déduit de la CI.

**Aucune préparation1130, aucun CHECK, changement Manager, redémarrage ou writer n'a eu lieu.** La dernière identité active rapportée reste1.12.0/source9bfdae07, arbre4aef91b8, démarrée le31octobre02:29:16Europe/Paris. Sa préparation/CHECK et son démarrage sont acquis et ne sont pas à répéter.

## Prochaine action — inspection en lecture seule

La dernière commande de métadonnées1120 était qualifiée24/24 mais son reçu n'a pas été communiqué. Le dernier checkpoint observé était encore1112, SHA256 `3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f`. Cela ne remet pas en cause le démarrage applicatif1120 confirmé.

Dans son propre navigateur, l'utilisateur ouvre le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), pour le service Node de JessieMessage. Coller ce bloc une fois et transmettre uniquement le JSON affiché. Il lit un fichier de métadonnées privé avec une taille bornée ; il n'accède ni aux messages ni à la base, ne modifie aucun fichier, n'appelle aucun service et ne redémarre rien. Le nom historique du fichier ne demande aucune manipulation PC ou sauvegarde.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_ETAT'
import hashlib, json, os, re, stat
path = '/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json'
try:
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        before = os.fstat(stream.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or stat.S_IMODE(before.st_mode) != 0o600 or before.st_size > 2097152):
            raise ValueError('FILE_GUARD')
        raw = stream.read(2097153)
        after = os.fstat(stream.fileno())
        current = os.stat(path, follow_symlinks=False)
        def identity(value):
            return (value.st_dev, value.st_ino, value.st_mode, value.st_uid,
                    value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        if len(raw) != before.st_size or identity(before) != identity(after) or identity(after) != identity(current):
            raise ValueError('FILE_CHANGED')
    document = json.loads(raw)
    active = document.get('activeService', {})
    development = document.get('developmentSimplification', {})
    if not isinstance(active, dict) or not isinstance(development, dict):
        raise ValueError('SHAPE')
    def safe(key, pattern):
        value = active.get(key)
        return value if isinstance(value, str) and re.fullmatch(pattern, value) else None
    print(json.dumps({'status': 'checkpoint_read_only', 'readOnly': True,
        'checkpointSha256': hashlib.sha256(raw).hexdigest(),
        'metadataRelease': safe('release', r'[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}'),
        'source': safe('source', r'[0-9a-f]{40}'), 'tree': safe('tree', r'[0-9a-f]{40}'),
        'release1120Present': isinstance(development.get('release1120'), dict)}, separators=(',', ':')))
except Exception as error:
    print(json.dumps({'status': 'checkpoint_not_read', 'readOnly': True,
        'code': type(error).__name__}, separators=(',', ':')))
    raise SystemExit(1)
PY_ETAT
```

Le bloc est vérifié sur sept cas locaux synthétiques : [preuve](verification-proofs/jm1130/checkpoint-inspection-command.json). Cette qualification ne vaut pas inspection du serveur.

Ce résultat décrit les **métadonnées**, pas le processus actif ni la disponibilité HTTP. La présence de `release1120` ne prouve pas à elle seule la totalité du reçu ; l'empreinte et l'identité seront comparées avant toute opération dépendante. En cas d'erreur, ne pas changer les permissions, créer le fichier ou rejouer un writer pour obtenir un résultat.

## Après le reçu

Examiner l'état durable puis définir et qualifier le préparateur1130 adapté, avec préservation de l'état existant. Les instructions d'installation, les valeurs Manager et toute activation1130 seront fournies après cette lecture ; aucune commande historique1120/1113 n'est à rejouer. La lecture ne vaut pas autorisation d'envoyer un message réel, modifier un compte ou effacer des données. Aucun nouveau test de sauvegarde, téléphone réel, SMTP/Push réel ou chantier juridique n'est ouvert automatiquement.
