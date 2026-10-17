# Coffre privé des secrets — étape 0.25

**Lot 0.44 — configuration primaire et fiches privées :** le [profil de coffre `primary-crm`](crm-private-configuration.md) ajoute un format v5 explicite pour les six configurations de l’adresse principale, nouvelle clé CRM comprise, sans dépendre du fichier historique d’enrôlement absent de ce répertoire. Les coffres historiques restent conservés. Aucune nouvelle capture avec un ancien profil ne doit omettre la clé CRM préparée. Ce coffre ne sauvegarde ni SQL ni les photos et n’active aucune fonction.

**Lot 0.26 extension:** the default AUTH coffre still has three files. Once `runtime-messaging.json` is prepared, use `--profile messaging` to create a four-file v2 coffre, covering the durable mail/chat keys and SMTP configuration as well. New code refuses a three-file AUTH creation when the messaging file already exists. Existing v1 coffres remain intact and readable. See the [current operator order](manual-invitation-runtime.md); neither profile dumps SQL.


La connexion personnelle de **Jess** avec TOTP a été confirmée le 15 octobre 2026 à 22:33:37 UTC. La correction d’affichage de la [PR #37](https://github.com/fredbuhr/jessiemessage/pull/37) est déployée sur la recette : son JavaScript HTTPS correspond à `d4c1b95`, et les contrôles de 22:46 ont confirmé 41 requêtes / 163 assertions ainsi que le maintien du MFA, d’une session active et des huit codes de secours inutilisés. La validation visuelle dans le navigateur personnel du propriétaire reste distincte.

Ce lot prépare un **coffre des secrets** pour permettre leur conservation hors hébergement. Il ne change pas le service actif, les identifiants, les clés, les comptes ou les fonctions activées. Version applicative **0.24.0**, étape **0.25**, PR empilée sans fusion.

## Contenu et limites

Le coffre AUTH contient les trois fichiers ci-dessous, leur nom, leur contenu UTF-8 et leur empreinte SHA-256, avec le format, la version et la date du coffre. Ces informations sont toutes à l’intérieur du chiffrement.

| Fichier | Rôle |
| --- | --- |
| `runtime-auth.json` | Origine HTTPS et clé durable de chiffrement du MFA |
| `admin-setup.json` | Graine TOTP initiale et huit codes de secours bruts |
| `runtime-database.json` | Configuration et identifiants SQL runtime |

Aucun parcours récursif du répertoire privé, fichier diagnostique, journal, dépendance ou ancien réglage Manager n’est inclus. L’outil ne contacte pas SQL, HTTP ou un service de sauvegarde.

**Ce coffre ne remplace pas la sauvegarde de la base.** Le hash du mot de passe, le MFA chiffré, sa version, le dernier pas TOTP accepté, la consommation des codes, les sessions et les limitations de connexion restent en SQL. Le fichier initial de secours ne prouve pas qu’un code est encore utilisable. La sauvegarde complète et son exercice de restauration devront conserver les 28 tables, dont le registre des 27 migrations, dans une copie cohérente et isolée.

Le lot médias `npm run backup` exige les cinq clés de ses domaines et une configuration complète ; il ne crée lui-même ni dump ni archive. Il n’est pas utilisé pour fabriquer artificiellement une configuration complète sur cette recette AUTH seule.

## Création personnelle

L’opérateur installe le code vérifié dans un checkout immuable, puis une commande privée propriétaire `0700`, hors fichiers HTTP. Son contrôle préalable doit confirmer les trois métadonnées privées et GnuPG sans afficher leur contenu.

Le propriétaire exécute ensuite dans sa console SSH :

```bash
bash /srv/customer/jessiemessage-private/save-private-secrets.sh
```

La commande demande deux fois une phrase secrète masquée, d’au moins 20 caractères ; cinq mots aléatoires sont conseillés. Cette phrase doit être différente du mot de passe administrateur et conservée séparément du coffre. Ne pas la transmettre dans le chat, une capture, les arguments ou un fichier. La variable de saisie du shell n’est pas exportée et est effacée à la sortie ; le programme la reçoit uniquement par stdin, puis GnuPG par un descripteur dédié.

Le résultat attendu donne seulement un état fixe, le nom du fichier chiffré, sa taille et l’empreinte SHA-256 du **coffre chiffré**. Aucune valeur source ni empreinte de secret n’est affichée. La réussite de création et relecture sur le serveur ne vaut pas encore sauvegarde indépendante.

L’outil tient un même descripteur de répertoire privé pendant la lecture, le chiffrement, la publication et leur fermeture. Les trois fichiers doivent être réguliers, propriétaires, `0600`, à lien unique et limités chacun à 16 Kio ; leur identité et leur stabilité sont contrôlées. Le JSON clair est limité à 64 Kio et le coffre à 128 Kio. Le clair reste en mémoire. GnuPG utilise AES-256, une dérivation S2K itérée SHA-512, un répertoire éphémère privé et aucun cache de phrase ou agent démarré automatiquement. Le déchiffrement doit terminer sans erreur, confirmer l’intégrité MDC et retrouver exactement le JSON avant la publication exclusive et sa relecture durable. Les sous-processus sont bornés ; les erreurs ne recopient pas leurs diagnostics. Les buffers maîtrisés et références sont effacés au mieux ; JavaScript ne garantit pas l’effacement de toutes ses copies mémoire.

## Conservation et vérification hors hébergement

La [documentation Infomaniak](https://www.infomaniak.com/fr/support/faq/446/comprendre-les-protocoles-de-transfert-web) réserve SSH/SFTP à l’environnement Node.js. Le compte Node.js SSH/SFTP a depuis été créé personnellement et son activation confirmée dans le Manager. Sa connexion depuis le PC reste à vérifier ; le propriétaire signale un refus du mot de passe. Ne pas recréer ce compte ni modifier les autres comptes. Les mots de passe restent saisis personnellement.

1. Télécharger uniquement le fichier `.json.gpg` par SFTP privé vers le PC du propriétaire. Ne pas créer de route HTTP publique, ni envoyer les configurations ou le coffre dans le chat.
2. Sur Windows, comparer son SHA-256 avec le résultat du serveur :

   ```powershell
   Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\chemin\jessiemessage-secrets.json.gpg'
   ```

3. Vérifier le déchiffrement local avec un outil OpenPGP de confiance, par exemple [Gpg4win/Kleopatra](https://www.gpg4win.org/download.html). Le contenu JSON inclut les trois fichiers nommés ; la phrase secrète reste saisie personnellement dans le logiciel. Conserver le clair dans un emplacement privé protégé, jamais dans Git ou une capture.
4. Conserver une seconde copie indépendante et la phrase secrète séparée. Ne rien supprimer du serveur tant que le téléchargement, l’empreinte et le déchiffrement local ne sont pas confirmés.

Une copie de ce coffre ne doit pas servir à démarrer automatiquement un clone avec les identifiants SQL de la recette. Une restauration réelle exige une autre base isolée, des identifiants adaptés, les contrôles de schéma et une décision explicite sur les sessions restaurées.

## État de recette

Le coffre AUTH réel a été créé et son empreinte contrôlée côté serveur le 15 octobre. Son téléchargement et son déchiffrement local personnel restent à vérifier. La future préparation messaging exige un nouveau coffre à quatre fichiers. Les essais automatisés et hébergés doivent utiliser exclusivement des fichiers et phrases synthétiques ; leurs résultats exacts sont consignés dans la demande de fusion de ce lot. L’installation d’une commande ne constitue pas une preuve de sauvegarde. L’étape 0.25 reste ouverte jusqu’à cette vérification indépendante, la recette du correctif dans le navigateur personnel et les contrôles d’installation PWA.
