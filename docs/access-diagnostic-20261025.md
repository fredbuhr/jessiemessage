# Diagnostic d’accès du25octobre — production1112 conservée

L’utilisateur signale désormais un refus de connexion directe après confirmation et approbation déclarées, l’absence d’e-mail après renvoi et une page de maintenance Infomaniak sur `/admin/`. Il déclare ne pas avoir exécuté la préparation1113. Cette préparation, son CHECK, l’activation et le writer restent suspendus. Le correctif frontend1113 publié garde sa qualification et son tag immuable, sans preuve de résolution du refus des identifiants.

## Constats acquis et limites

- Le backend1112 renvoie le même401 pour plusieurs refus : compte/état non admissible, mot de passe refusé, achèvement de connexion ou session finale refusés. Le message visible ne permet pas de les départager. Aucun mot de passe réel n’a été vérifié par l’agent.
- Le renvoi de confirmation ne crée un nouveau message que pour un client `pending`, non confirmé, avec mot de passe correct et génération d’identifiants conservée. La réponse publique reste générique. Pour un compte déjà confirmé, aucun nouvel e-mail n’est créé ; cela ne prouve pas une panne SMTP. L’état réel du compte n’est pas encore inspecté.
- Une [observation HTTP anonyme](verification-proofs/jm1113/access-diagnostic-native.json) du25octobre à21:33:36UTC, soit22:33:36Paris, obtient santé200, disponibilité200 et accès200. `/admin` répond303 vers `/admin/login`, qui répond200 ; `/admin/` répond404 `Not found`. Aucune redirection de maintenance n’est observée. C’est un instantané, sans preuve du commit actif ni de disponibilité continue.
- L’[état officiel Infomaniak](https://infomaniakstatus.com/en/) consulté ce25octobre annonce une maintenance de sécurité Node.js du22au30octobre, avec30secondes à5minutes d’interruption par site. La capture utilisateur ne suffit pas à attribuer sa coupure à cet événement. L’application ne génère pas cette page fournisseur et sa route `/admin/` est actuellement absente.

## Relevé hébergé qualifié — prochaine action unique

[Qualification40236054759](https://github.com/fredbuhr/jessiemessage/actions/runs/40236054759), tentative1,3/3 :8tests Python de fichiers/sorties synthétiques,15tests natifs surMariaDB10.11 et15sur11.4, aucun échec ni omission native. Les transactions de diagnostic préservent toutes les lignes synthétiques et MariaDB refuse une écriture pendant `READ ONLY`. La source téléchargée a été relue et comparée exactement aux octets qualifiés. [Preuve structurée](verification-proofs/jm1113/access-diagnostic-native.json).

- Opérateur : `1d4c38e98633ddcde5f308295e09412343533788` ; arbre : `dbddc7c7173b6dca958ff52d024f45ace7a126c1`.
- Script : `ops/inspect-access1112.py`, SHA256 `acc623ef5a0ea1018fecfeebe4b119e25bbf77a7f87b3f6c4208c1a9c0a97af8`.
- Préconditions : checkpoint et staging1112, source/arbre propres, binaire privé24.22.1 et configuration inchangés, dépendances réutilisées. Aucun module serveur de démarrage ou store pouvant modifier `last_seen_at` n’est appelé.
- Adresse saisie localement et sans écho dans le terminal, transmise à Node par stdin seulement ; aucune adresse, identifiant, hash, token, contenu de mail ou valeur de configuration dans la sortie. Aucun mot de passe demandé ou traité.
- SQL dans une transaction `READ ONLY`, terminée par `ROLLBACK` : état du compte, dates sous forme de booléens, comptes de sessions/vérifications et états d’e-mails. Pas de `FOR UPDATE`, d’écriture, de connexion réelle, de renvoi, de migration ou de redémarrage. Les lectures HTTP sont anonymes et ne suivent pas les redirections.

Dans le [terminal du service Node existant](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), coller ce seul bloc. Saisir ensuite localement l’adresse exacte du compte concerné ; ne pas l’envoyer dans la discussion.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_DIAG_ACCES'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/1d4c38e98633ddcde5f308295e09412343533788/ops/inspect-access1112.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_DIAGNOSTIC_A_VERIFIER')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != 'acc623ef5a0ea1018fecfeebe4b119e25bbf77a7f87b3f6c4208c1a9c0a97af8':
    raise SystemExit('EMPREINTE_DIAGNOSTIC_INCORRECTE : aucun outil exécuté.')
exec(compile(code, '<diagnostic-acces>', 'exec'), {'__name__': '__main__'})
PY_DIAG_ACCES
```

Recueillir uniquement le JSON ou le court message d’arrêt. Un arrêt ne demande pas de copie du journal, de mot de passe, de code d’invitation ou de lien de confirmation. Aucun relevé SQL de production n’a encore été reçu. Choisir ensuite la correction adaptée et regrouper les éventuels changements avant une seule activation ; ne pas déployer1113 par défaut, déplacer son tag ou recréer le compte pour diagnostiquer.
