# Enregistrer JessieMessage 1.8.4

L’[identité active](verification-proofs/jm184-hosted-identity.json) est rapportée par l’utilisateur : **1.8.4**, source `1a41e08abc87c3a29d9163fbf8cd2342eb04693c`, Node **v24.22.1**, relevé UI exact **`23/10/2026 11:44:16`**. Préparation, CHECK et activation sont acquis ; ne pas les répéter. Le checkpoint privé reste1.8.3 jusqu’au reçu de succès du writer. [État courant](REPRISE.md).

## Action actuelle : métadonnées seules

1. Ouvrir le [terminal SSH de l’application Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), service239143 nommé **recette.jessiemessage.com** et desservant aussi **jessiemessage.com**.
2. Coller cette commande une seule fois :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD184'
import hashlib, urllib.request

url = "https://raw.githubusercontent.com/fredbuhr/jessiemessage/054f19dfd0fd5fa8a7e7db4a51077540ff079592/ops/record-release184.py"
code = urllib.request.urlopen(url, timeout=30).read()
expected = "60f9cf6a518da4d91733ed1e40bd1e8b5d8fcbe05a639ce606cba19a46bfe27b"
if hashlib.sha256(code).hexdigest() != expected:
    raise SystemExit("Empreinte incorrecte : arrêt.")

exec(compile(code, "<enregistrement184>", "exec"), {"__name__": "__main__"})
PY_RECORD184
```

3. Recopier le JSON complet. Le résultat attendu est `release184_metadata_recorded` (ou `release184_metadata_already_recorded` si déjà effectué), source exacte ci-dessus, `metadataOnly:true`, `noRestart:true`, `publicReady:true`, SQL36 et nouvelle empreinte de checkpoint. En cas d’erreur ou de résultat incomplet, inspecter le reçu et l’état durable avant toute relance.

L’opérateur immuable `054f19dfd0fd5fa8a7e7db4a51077540ff079592`, SHA256 `60f9cf6a518da4d91733ed1e40bd1e8b5d8fcbe05a639ce606cba19a46bfe27b`, est épinglé sur le vrai reçu de préparation `d188abf49b9a61035f0b4790a1512eb89ed7851025726dd63f47ad493f2b7f57` et la release421341347. [Qualification native39933260498](https://github.com/fredbuhr/jessiemessage/actions/runs/39933260498) : **26/26**, tentative1. [Contre-revue identité/opérateur](verification-proofs/jm184/hosted-identity-independent-review.json).

Le writer contrôle le code et les lanceurs, les reçus antérieurs, le journal de démarrage, les HTTP publics et la publication avant de remplacer atomiquement le seul checkpoint. Il conserve les historiques, l’état antérieur et le repli ; aucune migration SQL, action Manager ou opération de démarrage. Aucun succès de ce writer n’est encore rapporté.

## Références à préserver

- Checkout184 : `/srv/customer/jessiemessage-operator/production-184-1a41e08a`.
- Lanceur Run SHA256 : `3e564f1a61d102c53644b9e3449488c183b7321f164321ed915accdce9074473` ; CHECK SHA256 : `db74a9fb9d608c46cae09c89da69c0c335ba9679bfc9ad111b212b59c0a45daf`.
- Journal : `/srv/customer/jessiemessage-private/jm184-node24221.log` ; précontrôle : `/srv/customer/jessiemessage-private/jm184-preflight-node24221-1a41e08a.log`. Les empreintes vides du reçu décrivent leur création avant CHECK et ne sont pas l’état actuel des journaux.
- Checkpoint183 protégé : `17f575ebe83d0a9d9acf74e9436bff59eabcf8b5ed1bb8f0f99897c867c78a22`. Aucune écriture de métadonnées184 acquise.
- Node privé, configurations `runtime-video-180` / `recurring-backup-052`, SQL36 et repli1.7.2 précontrôlé, jamais démarré, conservés. Aucun nouveau test de backup, PC, message ou notification réel.

La commande de préparation exécutée reste consultable dans l’historique de ce document et dans l’opérateur immuable `e7e6f11815007a53a9502672500476f6f87e9f25` ; elle n’est plus l’action courante. L’activation184 est également acquise ; ne pas modifier de nouveau le Manager. [REPRISE](REPRISE.md) distingue la version publiée de la version active.
