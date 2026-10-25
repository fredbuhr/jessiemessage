# Diagnostic d’accès du25octobre — production1112 conservée

L’utilisateur signale désormais un refus de connexion directe après confirmation et approbation déclarées, l’absence d’e-mail après renvoi et une page de maintenance Infomaniak sur `/admin/`. Il déclare ne pas avoir exécuté la préparation1113. Cette préparation, son CHECK, l’activation et le writer restent suspendus. Le correctif frontend1113 publié garde sa qualification et son tag immuable, sans preuve de résolution du refus des identifiants.

## Constats acquis et limites

- Le backend1112 renvoie le même401 pour plusieurs refus : compte/état non admissible, mot de passe refusé, achèvement de connexion ou session finale refusés. Le message visible ne permet pas de les départager. Aucun mot de passe réel n’a été vérifié par l’agent.
- Le renvoi de confirmation ne crée un nouveau message que pour un client `pending`, non confirmé, avec mot de passe correct et génération d’identifiants conservée. La réponse publique reste générique. Pour un compte déjà confirmé, aucun nouvel e-mail n’est créé ; cela ne prouve pas une panne SMTP. L’état réel du compte n’est pas encore inspecté.
- Une [observation HTTP anonyme](verification-proofs/jm1113/access-diagnostic-native.json) du25octobre à21:33:36UTC, soit22:33:36Paris, obtient santé200, disponibilité200 et accès200. `/admin` répond303 vers `/admin/login`, qui répond200 ; `/admin/` répond404 `Not found`. Aucune redirection de maintenance n’est observée. C’est un instantané, sans preuve du commit actif ni de disponibilité continue.
- L’[état officiel Infomaniak](https://infomaniakstatus.com/en/) consulté ce25octobre annonce une maintenance de sécurité Node.js du22au30octobre, avec30secondes à5minutes d’interruption par site. La capture utilisateur ne suffit pas à attribuer sa coupure à cet événement. L’application ne génère pas cette page fournisseur et sa route `/admin/` est actuellement absente.

## Relevé hébergé qualifié — prochaine action unique

Le premier relevé, opérateur1d4c38e9, a retourné le message générique `DIAGNOSTIC_ACCES_NON_CONFIRME`. Aucun résultat exploitable du compte n’a été reçu ; l’étape réelle de cet arrêt reste inconnue. Deux défauts de l’outil ont été reproduits : ouvrir un terminal avec le flux Python `r+` impose une capacité de repositionnement absente d’un terminal ; certaines consoles WebSSH ont une sortie PTY sans terminal de contrôle `/dev/tty`. Les anciens tests qualifiaient les fichiers et les requêtes, sans exercer cette saisie interactive.

La nouvelle révision lit directement le terminal de stderr/stdout disponible, sans écho ni utilisation du stdin consommé par le heredoc. Elle restaure ses réglages après saisie ou interruption et refuse une absence totale de terminal. Toute erreur du parcours principal produit un JSON limité à l’étape, un code autorisé et éventuellement un errno numérique : aucun message d’exception, chemin, paramètre SQL ou stderr du sous-processus.

[Qualification40237166078](https://github.com/fredbuhr/jessiemessage/actions/runs/40237166078), tentative1,1/1,14tests Python réussis sans omission, comprenant un vrai PTY sans terminal de contrôle, une interruption, l’absence de terminal, les gardes et la suppression des données privées dans les erreurs. Une régression échoue avant correction et réussit après. Le module de requêtes et l’entrée Node sont relus identiques à la révision précédente et leurs SHA256 contrôlés par test : les qualificationsMariaDB10.11/11.4,15/15 chacune du [run40236054759](verification-proofs/jm1113/access-diagnostic-native.json), sont conservées sans relance des mêmes requêtes. [Preuve de correction terminal](verification-proofs/jm1113/access-diagnostic-terminal-native.json). Ce défaut reproduit localement ne prouve pas l’étape réelle du premier arrêt hébergé.

- Opérateur courant : `2e06b3b463f99fc62851aa215f73f9a0e3436913` ; arbre : `869f25757d322a34d7b1f16765d24940e0d43fc0`.
- Script : `ops/inspect-access1112.py`, SHA256 `8c2520502ef12d5674b4bde41d15acb3945f51664850c57b814122dcba5598e1`, relu à cette source immuable et identique aux octets qualifiés.
- Préconditions : checkpoint et staging1112, source/arbre propres, binaire privé24.22.1 et configuration inchangés, dépendances réutilisées. Aucun module serveur de démarrage ou store pouvant modifier `last_seen_at` n’est appelé.
- Adresse saisie localement et sans écho dans le terminal, transmise à Node par stdin seulement ; aucune adresse, identifiant, hash, token, contenu de mail ou valeur de configuration dans la sortie. Aucun mot de passe demandé ou traité.
- SQL dans une transaction `READ ONLY`, terminée par `ROLLBACK` : état du compte, dates sous forme de booléens, comptes de sessions/vérifications et états d’e-mails. Pas de `FOR UPDATE`, d’écriture, de connexion réelle, de renvoi, de migration ou de redémarrage. Les lectures HTTP sont anonymes et ne suivent pas les redirections.

Dans le [terminal du service Node existant](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), coller ce seul bloc. Saisir ensuite localement l’adresse exacte du compte concerné ; ne pas l’envoyer dans la discussion.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_DIAG_ACCES'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/2e06b3b463f99fc62851aa215f73f9a0e3436913/ops/inspect-access1112.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_DIAGNOSTIC_A_VERIFIER')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '8c2520502ef12d5674b4bde41d15acb3945f51664850c57b814122dcba5598e1':
    raise SystemExit('EMPREINTE_DIAGNOSTIC_INCORRECTE : aucun outil exécuté.')
exec(compile(code, '<diagnostic-acces>', 'exec'), {'__name__': '__main__'})
PY_DIAG_ACCES
```

Recueillir uniquement le JSON ou le court message d’arrêt. Un arrêt ne demande pas de copie du journal, de mot de passe, de code d’invitation ou de lien de confirmation. Aucun relevé SQL de production n’a encore été reçu. Choisir ensuite la correction adaptée et regrouper les éventuels changements avant une seule activation ; ne pas déployer1113 par défaut, déplacer son tag ou recréer le compte pour diagnostiquer.
