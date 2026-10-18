# Configuration SQL runtime privée — étape 0.25

Application **0.24.0**, suite du [profil Infomaniak](infomaniak-runtime-profile.md). Le propriétaire a créé le compte applicatif distinct du migrateur dans son navigateur. Le Manager confirme lecture et écriture sur la seule base de recette, **administration désactivée**. Le mot de passe n’a pas été reçu par l’agent. Les huit fonctions privées du serveur neutre restent désactivées.

La révision `8289768a6f9a8b13a33a39e21457fab1b0a95742` a auparavant passé les deux exécutions CI de la [PR 31](https://github.com/fredbuhr/jessiemessage/pull/31). Le 15 octobre à **18:15:42 UTC (20:15:42 à Paris)**, la sonde hébergée a validé Node, Sharp/JPEG et les opérations de fichiers dans un nouveau répertoire privé 0700 hors checkout et arbre HTTP, via `linux-dirfd`. Son rapport 0600 a été enregistré, synchronisé et relu par un processus indépendant ; les répertoires synthétiques ont été nettoyés. Cette preuve ne couvre pas un redéploiement du fournisseur.

## Une saisie masquée, des contrôles avant enregistrement

Le helper `scripts/capture-runtime.sh` exige une console SSH interactive et valide les arguments avant de demander le mot de passe existant du compte runtime. La saisie Bash `read -r -s` ne s’affiche pas. Le secret est transmis au programme Node par stdin, sans argument secret, historique shell, variable exportée ou journal. La trace shell est désactivée et la variable locale retirée à la sortie. Ne jamais coller le mot de passe dans ChatGPT.

Exemple à métadonnées fictives, depuis une révision opérateur relue et épinglée :

```sh
bash scripts/capture-runtime.sh \
  --host sql.example.invalid \
  --database BASE_RECETTE \
  --confirm-database BASE_RECETTE \
  --user COMPTE_RUNTIME \
  --private-directory /REPERTOIRE_PRIVE \
  --privilege-profile infomaniak-shared \
  --private-path-mode linux-dirfd
```

Le port facultatif vaut 3306. La cible doit être confirmée exactement, le profil SQL et le mode de chemins sont explicites. Les options inconnues, les secrets en argument, les surcharges TLS et les entrées invalides sont refusés. Le programme construit son propre environnement minimal ; il n’hérite d’aucun drapeau d’activation ni exception de transport. TLS 1.2 au minimum, certificat vérifié, reste obligatoire, y compris sur loopback.

Il exécute d’abord le [diagnostic SQL existant](preproduction-preflight.md) : identité, moteur, session chiffrée, privilèges reconnus, historique des 27 migrations et lectures à résultat vide. Ces opérations ne modifient aucune ligne applicative ou du registre. Ensuite, `createAuthStore(pool).assertSchema()` vérifie les colonnes et index critiques de l’authentification et la structure/histoire du registre. Les verrouillages nommés et réglages de session nécessaires sont temporaires. Il ne crée aucun compte, ne lance aucune migration et ne valide pas les contraintes physiques de tous les autres modules.

Les connexions et pools doivent être fermés avant la sauvegarde. Le connecteur MariaDB renvoie une promesse lors de la libération d’une connexion : l’adaptateur runtime la conserve désormais, observe ses erreurs et attend les libérations en cours à la fermeture du pool. Les anciens appels ignorant ce résultat ne produisent pas de rejet non géré ; les contrôles qui l’attendent conservent le signal d’échec. Une erreur de diagnostic, de schéma ou de fermeture bloque l’enregistrement. Les sorties contiennent seulement des états fixes et des observations filtrées ; aucune valeur de connexion, chemin privé, donnée de compte ou erreur SQL native. Le profil mutualisé annonce honnêtement le registre modifiable, les tables temporaires et les verrous de tables. `SHOW GRANTS FOR CURRENT_USER` ne certifie pas toutes les correspondances utilisateur/hôte ni tous les droits effectifs.

## Fichier privé borné et réutilisable

Après réussite seulement, le programme enregistre `runtime-database.json` dans le répertoire privé existant. Tous les accès passent par les descripteurs Linux ancrés ; aucun secret n’est placé dans le dépôt ou les commandes du Manager. Le fichier est propriétaire, régulier, au mode exact **0600**, sans lien supplémentaire, et publié sans écraser un fichier existant. La synchronisation du fichier puis du répertoire est attendue. Un échec après publication peut laisser une copie valide : une sortie d’échec n’autorise ni suppression ni remplacement aveugle.

Le JSON utilise une liste fermée de champs : format, version, host, port, database, user, password et privilegeProfile. Il est limité à 16 384 octets ; le mot de passe est limité à 4 096 octets UTF-8 valides, sans NUL, retour chariot ou saut de ligne. La lecture vérifie taille, propriétaire, mode, liens, type et stabilité du fichier. Aucun champ ne permet d’activer un service ou d’ajouter une clé MFA. Le programme relit et compare le fichier avant d’annoncer la réussite.

Les buffers d’entrée et références de mot de passe maîtrisés sont nettoyés ; cela ne garantit pas l’effacement de toutes les copies en mémoire JavaScript. Le fichier privé est une configuration de l’hébergement, pas une sauvegarde indépendante. Son lecteur est réutilisable par une future entrée serveur ; le serveur HTTP actuel continue de lire son environnement et n’est pas démarré avec ce fichier par cette opération.

## Ce que cette étape permet de constater

Les résultats CI et la révision exacte de la commande installée figurent dans la PR correspondante. Les tests utilisent uniquement des secrets synthétiques ; les cas Linux réels s’exécutent en CI et les schémas MariaDB jetables restent isolés de l’hébergement.

Le propriétaire a ensuite exécuté la commande : le rapport du 15 octobre à **18:49:08 UTC** confirme huit contrôles réussis, mais le contrôle des privilèges échoue. Aucun fichier runtime normal n’a été créé et le schéma physique d’authentification n’a pas été atteint. Le [diagnostic privé distinct](runtime-grant-diagnostics.md), terminé à **19:24:54 UTC**, identifie les six droits attendus et une portée contenant des underscores bruts. La [promotion avec portée actuellement observée](observed-shared-database-scope.md) ajoute un profil distinct et explicite, une inspection à chaque acquisition SQL et une réutilisation privée du mot de passe. Les profils littéraux précédents restent inchangés ; les futures bases correspondant au motif ne sont pas garanties absentes.

L’initialisation administrateur, les clés MFA, le chargement au démarrage, la restauration et la recette privée restent des étapes distinctes. Aucun message de support n’a été envoyé. **contact@jessiemessage.com** demeure l’adresse officielle.
