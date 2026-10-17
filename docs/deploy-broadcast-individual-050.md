# Étape 0.50 — activation de la correction

Ces instructions permettent d’activer la [correction des messages individuels](broadcast-individual-delivery-050.md). L’accès d’exécution et le navigateur de l’agent sont actuellement déconnectés (`environment_offline`) : cette procédure est préparée, pas exécutée. La production reste sur le lot 0.49 tant que le Build/redémarrage n’a pas été réalisé.

Source applicative à utiliser : `0a1cafd85c3d8699be1961075b18e80e36bcd041`, arbre `17db89aa165e23ca427d073f5a3fcc28387f5168`. Les commits de documentation ultérieurs ne changent pas ce choix. [Les cinq validations de cette source](https://github.com/fredbuhr/jessiemessage/actions/runs/39078063012) sont réussies. Aucune clé, migration, restauration SQL, réinitialisation de compte ou nouvelle autorisation du destinataire n’est nécessaire.

## 1. Préparer le nouveau dossier dans le terminal SSH

Ouvrir le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), puis exécuter ce bloc complet. Il crée un dossier séparé et effectue le contrôle sans démarrer un second serveur :

```bash
set -euo pipefail
JM050_ROOT=/srv/customer/jessiemessage-operator/broadcast-direct-delivery-0a1cafd8
test ! -e "$JM050_ROOT"
git clone --single-branch --branch feat/broadcast-direct-delivery https://github.com/fredbuhr/jessiemessage.git "$JM050_ROOT"
cd "$JM050_ROOT"
git checkout --detach 0a1cafd85c3d8699be1961075b18e80e36bcd041
test "$(git rev-parse HEAD)" = 0a1cafd85c3d8699be1961075b18e80e36bcd041
test "$(git rev-parse HEAD^{tree})" = 17db89aa165e23ca427d073f5a3fcc28387f5168
test -z "$(git status --porcelain)"
npm ci --ignore-scripts
npm run check
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd PORT=3000 node scripts/start-private-messaging.mjs check --deployment primary-transition --profile photos-notify-recovery-crm-broadcast --private-directory /srv/customer/jessiemessage-private/primary-origin-candidate-4a355851 --private-path-mode linux-dirfd
```

Le dernier résultat doit indiquer `checks_passed`, le profil `messaging-photos-notify-recovery-crm-broadcast`, `primary-transition` et `started: false`. Si une commande échoue ou que le dossier existe déjà, conserver la version active et reprendre à partir du résultat précis ; ne pas supprimer le dossier ni les données pour recommencer.

## 2. Enregistrer les commandes de l’application Node.js

Dans le [Manager, paramètres avancés de l’application](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), remplacer uniquement les champs **Run** et **Build**. Conserver Node.js 24 et le port 3000.

**Run :**

```bash
bash -c 'set -euo pipefail; cd /srv/customer/jessiemessage-operator/broadcast-direct-delivery-0a1cafd8; test "$(git rev-parse HEAD)" = 0a1cafd85c3d8699be1961075b18e80e36bcd041; test "$(git rev-parse HEAD^{tree})" = 17db89aa165e23ca427d073f5a3fcc28387f5168; test -z "$(git status --porcelain)"; exec env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd PORT=3000 node scripts/start-private-messaging.mjs start --deployment primary-transition --profile photos-notify-recovery-crm-broadcast --private-directory /srv/customer/jessiemessage-private/primary-origin-candidate-4a355851 --private-path-mode linux-dirfd'
```

**Build :**

```bash
cd /srv/customer/jessiemessage-operator/broadcast-direct-delivery-0a1cafd8 && test "$(git rev-parse HEAD)" = 0a1cafd85c3d8699be1961075b18e80e36bcd041 && test "$(git rev-parse HEAD^{tree})" = 17db89aa165e23ca427d073f5a3fcc28387f5168 && test -z "$(git status --porcelain)" && npm run check
```

Cliquer sur **Enregistrer**, revenir au [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard), puis lancer **Build**. Conserver **Non** pour la réinstallation des dépendances : le nouveau dossier contient déjà les dépendances verrouillées installées à l’étape 1. Cocher la confirmation du Build et lancer. Attendre le Build réussi et l’état **Actif** ; ce Build effectue le redémarrage de l’application avec la nouvelle commande Run.

## 3. Vérifier puis utiliser

Vérifier sur les deux adresses que `/api/health` répond 200, que `/broadcast-preference.js`, `/api/broadcast/client/session` et `/api/broadcast/client/preference` répondent 404 en lecture, et que les pages/modules d’administration restent protégés sans session.

Dans JessieMessage, actualiser la page, ouvrir **Messages → Diffusions**, choisir les destinataires, préparer le message et confirmer. Le destinataire n’a aucune démarche supplémentaire : il reçoit le message dans sa conversation privée. La limite reste 100 destinataires par campagne. Un premier essai personnel sur un compte de confiance reste à constater ; l’agent n’a envoyé aucun message réel.

Les vérifications HTTPS exactes, le préflight hébergé et l’heure de redémarrage devront être ajoutés au relevé d’activation après leur exécution. La réussite de la CI seule ne prouve pas l’activation sur le serveur.

## Retour à la version 0.49 en cas d’échec

Réenregistrer les commandes suivantes, puis relancer le Build/redémarrage :

Run :

```bash
bash /srv/customer/jessiemessage-private/start-primary-broadcast-checked-d77f16fb.sh
```

Build :

```bash
cd /srv/customer/jessiemessage-operator/broadcast-runtime-backup-d77f16fb && test "$(git rev-parse HEAD)" = d77f16fbddbee4bad90f0230ad344d148823aac5 && test "$(git rev-parse HEAD^{tree})" = 5897917c0e7810e16ab51e600e2cf1c6eff02f47 && test -z "$(git status --porcelain)" && npm run check
```

Ce repli réintroduit l’ancien accord de diffusion. Il ne supprime pas de campagne, ne restaure pas de SQL et ne révoque aucune session.
