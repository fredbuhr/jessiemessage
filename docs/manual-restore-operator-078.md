# Restauration manuelle : parcours opérateur — 0.78

**Lot S2b en implémentation.** Ce guide décrit l'API prévue ; commandes et résultats doivent être relus contre le code final avant utilisation. Il ne constate ni CI réussie, ni restauration réelle, ni activation des fermetures. L'état du service déployé reste dans [REPRISE](REPRISE.md).

Cette procédure ponctuelle conserve l'hébergement existant. Elle restaure une capture applicative sur une **nouvelle base et un nouveau dossier média**, traite les fermetures connues, puis exige une ouverture explicite. Le PC reste une destination de copie ; aucune confirmation PC par phase ni réinitialisation n'est demandée.

## Préparer une fois le dossier de l'opération

1. Choisir la capture déchiffrée et vérifiée, ainsi que le registre de fermetures récent et complet. Conserver les fichiers originaux, leurs reçus et leurs empreintes. Une ancienne capture peut contenir un compte fermé depuis.
2. Préparer dans le Manager Infomaniak une **nouvelle base vide**, avec un opérateur d'import autorisé sur cette seule cible. Conserver son mot de passe pour la lecture unique par stdin pendant `restore` ; ne l'écrire ni dans une commande, ni dans `job.json`.
3. Préparer `/private/operator`, dossier privé **0700**, hors dépôt, configurations source et anciens dossiers D1. Les chemins ci-dessous sont des exemples à adapter à cette nouvelle opération. **Ne pas créer son sous-dossier `target`** : `restore` l'alloue après avoir contrôlé le vide SQL. Sa racine média sera obligatoirement `/private/operator/target/media` ; ne pas choisir les médias source ou D1.
4. Préparer les six configurations privées cible, fichiers **0600**, dans un dossier séparé de `/private/operator`. Garder les **six mêmes clés**, l'hôte SQL et l'origine du site ; adapter la base et les identités SQL à la cible, ainsi que la racine média vers le nouveau dossier. Ne pas modifier les configurations source.
5. Épingler le checkout opérateur/runtime revu par commit et arbre exacts. Mettre l'application en maintenance et arrêter ses producteurs par le chemin habituel avant le traitement et la réouverture. La commande ne remplace pas cette exclusion opérateur.

`recette.jessiemessage.com` partage runtime et base du principal : ce n'est pas une cible isolée. Le clone D1 et son marqueur sont des preuves à préserver, pas des dossiers à recycler pour cette opération.

## Le fichier `job.json`

Créer `/private/operator/job.json` en **0600**, fichier régulier privé sans lien. Format canonique sur une seule ligne, suivi d'un retour ligne (`JSON.stringify(job) + "\n"`), sans indentation ni clé dupliquée. Son objet est fermé : exactement les champs suivants, sans mot de passe ni champ ajouté.

| Champ | Valeur à préparer |
|---|---|
| `version` | Nombre `1`. |
| `runtimeDirectory` | Chemin absolu du checkout revu. |
| `runtimeHead` | Commit exact, 40 caractères hexadécimaux. |
| `runtimeTree` | Arbre exact, 40 caractères hexadécimaux. |
| `sourcePrivateDirectory` | Configurations originales, lues seulement. |
| `sourceOperationsDirectory` | Opérations source et registre récent choisi, lus seulement. |
| `checkpointDirectory` | Capture déchiffrée : reçu, manifeste, SQL, médias et capsule. |
| `targetPrivateDirectory` | Six configurations adaptées à la nouvelle cible. |
| `targetDatabase` | Nom de la nouvelle base vide. |
| `importUser` | Identifiant SQL de l'opérateur d'import. |
| `sqlSha256` | SHA-256 du SQL décompressé authentifié par le reçu. |
| `registrySha256` | Empreinte de l'inventaire opérationnel récent explicitement choisi. |

Ne pas utiliser un `HEAD` mobile ni reprendre une empreinte au hasard. Le registre est sélectionné et épinglé localement : cela ne prouve pas sa fraîcheur hors de l'hôte. Si sa complétude récente est incertaine, ne pas republier les anciens comptes ou conversations sans contrôle opérateur.

## 1. Vérifier la préparation

Depuis le checkout épinglé, avec l'environnement privé prévu et `linux-dirfd` :

```sh
node scripts/manual-restore.mjs check --operator-directory /private/operator
```

`check` vérifie la préparation sans importer, effacer ou démarrer l'application. Un refus se corrige à sa cause ; ne pas supprimer un marqueur ni modifier une empreinte pour le contourner.

## 2. Restaurer et réconcilier, sans démarrer

```sh
node scripts/manual-restore.mjs restore --operator-directory /private/operator
```

Cette commande reçoit **une seule fois** le mot de passe d'import par stdin. Le lecteur refuse un terminal TTY direct et attend le secret sans retour ligne : la commande ci-dessus décrit la destination du flux. Pour l'exécuter depuis le terminal avec saisie masquée, utiliser ce lanceur, sans secret dans les arguments, l'environnement ou `job.json` :

```sh
python3 - <<'PY'
import getpass
import subprocess

password = getpass.getpass("Mot de passe SQL de l'opérateur d'import : ")
result = subprocess.run([
    "node", "scripts/manual-restore.mjs", "restore",
    "--operator-directory", "/private/operator",
], input=password.encode("utf-8"), check=False)
password = None
raise SystemExit(result.returncode)
PY
```

Le parcours contrôle la base vide et le SQL applicatif authentifié, importe les trente tables attendues, copie les médias vers la nouvelle racine et crée une quarantaine. La réconciliation applique les fermetures avec une progression cible propre, depuis le début ; les phases ou curseurs source ne sont pas un avancement cible. Les anciennes sessions cible sont révoquées et les données restantes sont vérifiées.

Le résultat conserve la cible **arrêtée et en quarantaine** et retourne `planSha256`. Conserver cette empreinte exacte et le résultat durable. Ni les fichiers/états source, ni l'ancien D1, ni l'autorité ou les états PC ne sont modifiés par cette opération.

Après une interruption, relire le résultat durable et les journaux avant de reprendre. Ne pas relancer un import sur une base désormais remplie pour découvrir ce qui a réussi ; ne pas effacer la progression ou recréer `job.json` pour masquer une opération incertaine.

## 3. Ouvrir explicitement la cible vérifiée

Remplacer `EMPREINTE_DU_PLAN` par les 64 caractères hexadécimaux `planSha256` retournés par `restore` :

```sh
node scripts/manual-restore.mjs open --operator-directory /private/operator --confirm-plan-sha256 EMPREINTE_DU_PLAN
```

`open` refait les vérifications sous maintenance. Une dérive du job, du registre, de la cible ou des résultats bloque l'ouverture. Seul le **nouveau marqueur manuel exact** de cette opération peut être retiré dans la même exclusion/drain ; le marqueur historique D1 n'est jamais levé par ce chemin.

La commande lance ensuite le vrai parent quotidien `start-local-closures` sur les configurations et journaux cible. Elle **reste en cours d'exécution** : elle ne se termine pas simplement après avoir affiché une réussite. Ne pas lancer un second parent sur le même port. Pour l'arrêter, utiliser l'arrêt habituel par SIGTERM et attendre sa fin, en conservant les journaux et configurations. Une erreur ne constitue pas une autorisation de retirer le marqueur à la main.

## Portée de la récupération

Le profil couvre les **trente tables applicatives**, les six clés, les médias chiffrés et les états opérationnels ; `completeDatabase:false`, objets SQL exécutables exclus. Il fait confiance à l'administration de l'hébergeur et ne remplace pas l'ancien inventaire SQL exhaustif.

Le registre choisi reste sous la responsabilité de l'opérateur ; aucune continuité externe ni garantie autonome contre la perte simultanée de l'hôte et des fermetures non encore copiées n'est fournie. Les messages postérieurs à la capture peuvent être perdus. Les sauvegardes de l'hébergeur sont un secours distinct, sans capture simultanée des fichiers et de la base.

Le périmètre moteur S2a et ses limites restent dans [Fermeture locale et réconciliation manuelle](local-closures-manual-077.md). L'ouverture effective et l'état déployé doivent être constatés séparément ; la présence de ce guide ne les prouve pas.
