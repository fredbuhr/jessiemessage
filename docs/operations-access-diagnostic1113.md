# Relevé de confirmation client avant la1.12.0

Le relevé examine la dernière source de production rapportée1.11.3 (`89571636d6fde97b28b5e8aec9257801c1b71f8b`) et le compte choisi localement. Il observe aussi l’identité et l’empreinte du checkpoint privé, dont la finalisation1113 n’a pas été rapportée.

Opérateur immuable `eb3b0ce17e384c041d7e72abea848b6c5d1ca0a3`, arbre `cc218f8510e73c400f5957314d503fc7e40a61d2`, script `ops/inspect-access1113.py`, SHA256 `214471d2d65acacbc89ef1431853aedacb3fddaf818de8144bc9da705d9f5683`. [Qualification native41148965318](https://github.com/fredbuhr/jessiemessage/actions/runs/41148965318)3/3, tentative1 : 16tests opérateur/terminal,10tests du lecteur de checkpoint embarqué,15tests JS/SQL par MariaDB10.11 et11.4, aucun échec/omission. [Preuve](verification-proofs/jm1120/access-diagnostic-native.json), source relue identique aux octets qualifiés.

## Exécution personnelle

Dans le [terminal Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter ce bloc. Saisir l’adresse du client à la demande masquée ; transmettre uniquement le JSON. Aucun mot de passe ou journal privé.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_DIAG_CLIENT'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/eb3b0ce17e384c041d7e72abea848b6c5d1ca0a3/ops/inspect-access1113.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_DIAGNOSTIC_A_VERIFIER')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '214471d2d65acacbc89ef1431853aedacb3fddaf818de8144bc9da705d9f5683':
    raise SystemExit('EMPREINTE_DIAGNOSTIC_INCORRECTE')
exec(compile(code, '<diagnostic-client>', 'exec'), {'__name__': '__main__'})
PY_DIAG_CLIENT
```

## Portée du résultat

L’outil n’appelle aucun store applicatif : même un lecteur de session peut modifier sa date. Il exécute des SELECT paramétrés dans une transaction explicitement READ ONLY puis ROLLBACK, avec délai SQL borné. L’adresse ne sort pas du terminal/stdin ; le résultat n’exporte ni identifiant client, adresse, secret, jeton ou contenu. Les colonnes de compte, sessions, confirmations et file d’envoi deviennent uniquement des états, booléens et compteurs. Les sources, dépendances, binaire Node, reçu1113 et configuration privée sont contrôlés avant ces lectures. Aucune connexion de compte, vérification de mot de passe, remise d’e-mail, validation, migration, modification persistante ou action du service.

Le bloc de checkpoint ne prouve pas qu’un writer a terminé : sa présence est observée, son empreinte doit être reprise exactement avant une future préparation. Le PID et le runtime courant ne sont pas qualifiés (`runtimeIdentityChecked:false`).

Sans relevé, la capture montre seulement « e-mail en attente ». Un lien ouvert sans le bouton final, un lien ancien/expiré ou une fiche périmée restent possibles. Ne pas forcer `email_verified_at`, recréer le compte, approuver à l’aveugle, renvoyer un mail automatiquement ou rejouer l’ancien writer1113. La nouvelle1.12.0 supprime l’approbation manuelle supplémentaire ; la confirmation de l’adresse demeure nécessaire.
