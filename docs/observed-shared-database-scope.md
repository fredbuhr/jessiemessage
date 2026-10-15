# Portée SQL mutualisée observée — étape 0.25

Application **0.24.0**, serveur neutre `55fb30aa`, huit fonctions privées désactivées. Le propriétaire a terminé le [diagnostic privé](runtime-grant-diagnostics.md) le 15 octobre 2026 à **19:24:54 UTC (21:24:54 à Paris)**. Une lecture indépendante à **19:27:49 UTC** confirme le fichier diagnostique lisible, les six droits attendus, aucune permission supplémentaire ou délégation reconnue et un motif de base contenant des underscores non échappés. Une nouvelle session TLS voit uniquement la base applicative confirmée et `information_schema`. Le mot de passe demeure dans le stockage privé du serveur ; aucune valeur réelle n’est reçue par l’agent.

## Une différence réelle de portée

Dans un grant au niveau base, MariaDB interprète `_` comme un joker d’un caractère, même entre backticks. Le [guide GRANT](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant) documente ces motifs et les correspondances utilisateur/hôte ; le [guide SHOW DATABASES](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-databases) décrit la visibilité des bases existantes. Le préfixe imposé par Infomaniak ne suffit pas à transformer ce joker en caractère littéral. Le profil d’administration mutualisé [documenté par Infomaniak](https://www.infomaniak.com/fr/support/faq/2588/comprendre-les-actions-mysql-possibles) ne fournit pas `GRANT OPTION` ; aucune normalisation des grants n’est tentée avec le compte de migration.

Le profil existant `infomaniak-shared` conserve son exigence de motif littéral échappé. Le profil `strict` par table reste le défaut. Un **troisième profil explicite**, `infomaniak-shared-pattern`, accepte une portée actuellement observée, avec une limite déclarée sur les futures bases correspondantes. Ce choix ne prouve pas un confinement permanent des identifiants SQL.

## Contrôles du profil explicite

Le module commun valide de nouveau les véritables lignes `SHOW GRANTS FOR CURRENT_USER`. La classification diagnostique seule n’autorise rien. Le motif doit être identique au nom confirmé, contenir au moins un underscore et uniquement des lettres, chiffres et underscores bruts. Aucun `%`, autre nom, échappement, table spécifique, rôle, PROXY, délégation, droit supplémentaire ou suffixe inconnu n’est accepté. Les six droits attendus et les règles USAGE du profil précédent sont conservés.

Une requête fixe non filtrée lit ensuite `information_schema.SCHEMATA`, avec délai de deux secondes et `LIMIT 3`. Le résultat doit contenir exactement la base confirmée et, facultativement, `information_schema` : au plus deux lignes, sans doublon, accesseur, ligne creuse ou champ inattendu. Toute autre base, structure, erreur ou troisième ligne bloque l’accès.

Le pool capture ce profil lors de sa création et effectue ces deux contrôles **avant de remettre chaque connexion** à son appelant. Un refus attend la libération de la connexion ; ses erreurs restent observables lors de la fermeture du pool. Le diagnostic de préproduction répète également l’inspection. Le contrôle protège les opérations de JessieMessage passant par cet adaptateur. Il n’annule pas les permissions SQL réelles, ne constitue pas un contrôle continu d’autres créateurs de bases et ne supprime pas la possibilité d’une collision après l’inspection.

Le rapport du nouveau profil annonce `source:show_grants_and_visible_schemata`, `databaseNamePattern:true`, `visibleApplicationNamespace:selected_only` et **`futureMatchingDatabasesUnproven:true`** lorsque ce contrôle réussit. Si l’observation de privilèges échoue, ces trois derniers champs sont nuls. Une erreur ultérieure d’historique ou de fermeture bloque toujours le résultat global, tout en conservant l’observation déjà effectuée. Les anciens profils gardent leur format de rapport.

Le registre reste modifiable, les tables temporaires et les verrous restent possibles, comme dans le profil mutualisé précédent. `SHOW GRANTS FOR CURRENT_USER` ne certifie pas tous les droits effectifs issus d’autres correspondances utilisateur/hôte. Pour retrouver une portée littérale indépendante de futures bases, il faudra des grants échappés ou par table et le profil correspondant.

## Promotion privée sans nouvelle saisie

Après validation de la révision exacte, la commande opérateur peut réutiliser la copie diagnostique en mémoire :

```sh
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node scripts/promote-runtime-diagnostic.mjs \
  --private-directory /private/operator-root \
  --privilege-profile infomaniak-shared-pattern \
  --private-path-mode linux-dirfd
```

Le chemin est un exemple privé hors dépôt/public, à remplacer par l’emplacement déjà vérifié. La commande n’accepte ni mot de passe ni remplacement de cible en argument. Le profil doit être choisi explicitement ; aucun repli automatique n’existe. Elle clone et valide le fichier diagnostique puis appelle la préparation normale : **neuf contrôles**, schéma physique d’authentification, fermeture des connexions/pools, publication exclusive 0600 et relecture exacte du fichier normal. Tout échec bloque la confirmation. Une publication de durabilité incertaine n’est jamais écrasée.

La sortie réussie reste `prepared`, `configSaved:true`, `authSchemaVerified:true`, **`launchApproved:false`**. Le fichier diagnostique n’est ni écrasé ni supprimé. L’environnement dérivé conserve les huit fonctions privées à zéro. Cette promotion ne génère pas de clé MFA, ne crée pas d’administrateur et ne change aucune commande du serveur HTTP neutre.

## Vérification

Les tests synthétiques couvrent le refus des métadonnées ambiguës, la séparation des profils, l’acquisition retenue jusqu’à l’inspection, la fermeture après refus et les gates complets de promotion. La fixture MariaDB dédiée crée des bases de collision en remplaçant chaque underscore par une lettre : elle démontre leur accessibilité réelle via le grant brut, puis leur refus par le nouveau garde, y compris lorsqu’une base apparaît après une inspection réussie. Ces créations sont réservées à la base CI jetable ; aucune base de collision n’est créée chez l’hébergeur.

Les résultats de la révision exacte et l’application hébergée seront consignés dans la PR. Aucune ouverture de service privé n’est impliquée. L’étape **0.25** continue avec la configuration d’authentification et l’initialisation administrateur, puis sa recette réelle. Aucun support contacté, aucune action sur ZTIKIX ; **contact@jessiemessage.com** reste l’adresse officielle.
