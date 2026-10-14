# Récupération administrateur par l'opérateur

Ce lot fournit une récupération **hors ligne par CLI**, réservée à un opérateur autorisé disposant de la configuration privée de JessieMessage et de l'accès à sa base dédiée. Il permet de remplacer ensemble le mot de passe administrateur, le secret TOTP et les huit codes de secours lorsque le mot de passe ou tous les facteurs ont été perdus. Il n'ajoute aucune route HTTP de réinitialisation, aucun courriel de récupération et aucun compte automatique.

Un code de secours ordinaire reste un second facteur à usage unique : il exige le mot de passe actuel. Il ne réinitialise pas le compte. La procédure ci-dessous modifie un administrateur **existant et actif**, identifié simultanément par son ID exact et son adresse de connexion. Elle ne crée pas d'administrateur supplémentaire, ne change pas son rôle ou son adresse et ne réactive pas un compte suspendu, révoqué ou supprimé.

## Conditions avant utilisation

- Vérifier l'autorisation de l'opérateur et l'identité de l'administratrice par un canal privé fiable. L'accès technique à ce CLI donne le pouvoir de remplacer ses facteurs ; aucune décision d'identité n'est confiée à une requête publique.
- Disposer d'une sauvegarde privée vérifiée et de la clé maître MFA actuelle. La configuration et le compte MariaDB d'application suivent [auth-admin.md](auth-admin.md). Le CLI vérifie en lecture seule les migrations et les structures avant de générer le fichier privé ; il ne migre pas la base.
- Vérifier la cible `JESSIEMESSAGE_DB_NAME` et sa confirmation `JESSIEMESSAGE_APPLICATION_DATABASE`. Utiliser exclusivement la base JessieMessage, jamais celle de ZTIKIX.
- Donner au compte d'application les droits `SELECT, UPDATE` sur `users` et `SELECT, INSERT, UPDATE, DELETE` sur `admin_recovery_codes`, en plus des droits de session/MFA déjà documentés. Aucun droit DDL ou de modification de `schema_migrations` n'est nécessaire.
- Préparer un répertoire privé, appartenant à l'opérateur, en `0700`, **hors de tout le dépôt**. Ses ancêtres ne doivent être ni des liens symboliques ni accessibles en écriture à un groupe ou à tous. Les fichiers de sortie existants ne sont jamais écrasés.

Pour déterminer la cible, un opérateur peut lire en privé `id`, `email`, `role` et `status` dans `users` avec son accès à la base dédiée. L'ID passé au CLI est l'encodage hexadécimal minuscule des 16 octets de `users.id`, soit exactement 32 caractères. Ne pas recopier un ID, une adresse ou un état de compte dans un ticket public ou des journaux.

## Exécution contrôlée

Créer par un éditeur privé un fichier d'entrée `0600` contenant exactement `email` et `password`. L'adresse est canonisée en minuscules ; le mot de passe doit compter 14 à 128 caractères JavaScript, au plus 512 octets UTF-8, et reste conservé exactement avant hachage scrypt. Ne pas inclure `pseudonym`, un rôle, l'ancien mot de passe ou des champs supplémentaires. Ne pas saisir le mot de passe dans un argument shell ni dans l'historique.

Après avoir configuré les variables privées, exécuter :

```sh
npm run admin:recover -- --output /chemin/absolu/prive/recovery-setup.json --admin-id ID_HEXADECIMAL_32_CARACTERES --confirm-reset < /chemin/absolu/prive/recovery-input.json
```

Remplacer les chemins et l'ID par les valeurs privées vérifiées. L'argument `--confirm-reset` est obligatoire à chaque lancement ; il atteste une action volontaire de l'opérateur. Les cinq arguments doivent apparaître dans l'ordre montré. Le CLI lit exclusivement du JSON borné sur l'entrée standard et refuse la saisie interactive. Il n'existe aucun mot de passe ou secret par défaut.

Le fichier de sortie nouveau est réservé atomiquement en `0600`, puis synchronisé avant toute écriture MariaDB. Il utilise le même format privé que le bootstrap : nouveau secret TOTP, URI `otpauth://` et huit codes de secours. Il ne contient ni le nouveau mot de passe, ni son hash, ni la clé maître MFA. La console n'affiche ni facteur, ni adresse, ni ID, ni chemin privé.

Une transaction verrouille l'utilisateur et sa configuration MFA, vérifie à nouveau le rôle, le statut, l'adresse et la version lue, puis effectue ensemble :

1. Remplacement du hash de mot de passe et du secret TOTP chiffré, lié au même ID utilisateur.
2. Incrément de la version MFA, remise à zéro de sa confirmation et de l'état de rejeu TOTP.
3. Suppression de tous les anciens codes de secours et insertion des seuls digests des huit nouveaux codes.
4. Révocation de **toutes** les sessions existantes de cet administrateur.

Un lancement concurrent sur la même version échoue ; il ne peut pas remplacer silencieusement une récupération déjà réussie. Le rôle, le statut, l'adresse et le pseudonyme ne sont pas changés. Les tentatives de connexion et les compteurs persistants ne sont pas réinitialisés par cette opération.

Importer le nouveau secret dans l'application d'authentification et se connecter sur l'origine HTTPS configurée avec le nouveau mot de passe et un **premier TOTP frais**. Les nouveaux codes de secours sont refusés tant que cette confirmation n'a pas eu lieu. Les anciennes sessions, l'ancien mot de passe, l'ancien TOTP et les anciens codes ne doivent plus fonctionner. Après confirmation et sauvegarde privée vérifiée, supprimer les fichiers d'entrée et de setup, puis conserver les codes de secours séparément.

## Échec et reprise

En cas d'échec confirmé avant commit, la transaction revient à son état précédent et le CLI supprime uniquement le nouveau fichier de sortie appartenant à cette tentative. Aucun fichier préexistant n'est écrasé ou supprimé.

`SETUP_UNCERTAIN` signifie que la réponse du `COMMIT` n'a pas permis d'établir son résultat. Le nouveau fichier privé est alors conservé volontairement : **ne pas le supprimer et ne pas relancer aveuglément**. Inspecter en privé la version MFA et l'état du compte pour établir si la transaction a été appliquée. Si la version a avancé, ce fichier contient les nouveaux facteurs à confirmer. Une ancienne version attendue ne peut pas rejouer la récupération.

Une erreur de nettoyage du pool ou de libération d'une connexion ne peut pas effacer un fichier contenant les seuls facteurs nouvellement enregistrés. Les détails du pilote SQL et les données privées ne sont pas affichés.

## Recette et limites

```sh
node --test tests/admin-recovery.test.mjs
node --test tests/admin-recovery.integration.test.mjs
```

La première commande couvre les garde-fous CLI, le format privé, la vérification d'identité, la réservation du fichier avant transaction, le refus d'écrasement, les échecs confirmés ou incertains et la fermeture du pool. La seconde n'exerce une vraie base qu'avec l'opt-in `JESSIEMESSAGE_DB_TEST=1` et une configuration complète de base de test jetable **loopback** portant un nom `jessiemessage_test…`. Sans cet opt-in, elle est ignorée. Elle refuse de nettoyer une base contenant des tables étrangères et ne doit jamais être lancée sur une base réelle d'utilisateurs.

La suite d'intégration vérifie l'atomicité du remplacement, le refus des versions périmées et des cibles suspendues, la concurrence, la révocation des sessions, la première confirmation du nouveau TOTP, les anciens facteurs, les rejeux et un commit appliqué dont l'accusé de réception est perdu. Exécuter les fichiers d'intégration **successivement** sur une même base jetable, car chacun gère ses propres fixtures.

Avant le pilote, valider cette récupération avec des données synthétiques sur l'environnement de recette, puis vérifier la connexion dans un navigateur sous HTTPS. Cette procédure ne remplace ni les contrôles d'accès des futurs messages ni les règles d'âge et d'hébergement. La **rotation de la clé maître MFA** reste distincte et n'est pas implémentée : ne pas changer `JESSIEMESSAGE_MFA_KEY` pour tenter une récupération. Aucune connexion SMTP ni inscription client n'est nécessaire à ce lot.
