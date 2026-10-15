# Diagnostic privé des grants runtime — étape 0.25

Le 15 octobre 2026 à **18:49:08 UTC (20:49:08 à Paris)**, le propriétaire a exécuté la commande de la [PR 32](https://github.com/fredbuhr/jessiemessage/pull/32). La capture jointe puis le rapport 0600 enregistré ont été relus : configuration, connexion, identité, moteur, transport, historique, lectures de schéma et fermeture **passent** ; seul `privileges` **échoue**. Le résultat est `RUNTIME_INPUT_DATABASE`, `configSaved:null`, observation de privilèges non vérifiée. L’absence de `runtime-database.json` dans le répertoire privé a été confirmée séparément. Le contrôle physique d’authentification n’a donc pas été atteint.

La cause précise n’est pas encore connue. Il ne faut ni attribuer ce refus au mot de passe ni modifier les grants sur la seule base de cette sortie. Le Manager indique toujours lecture/écriture sur la seule recette, administration désactivée. Les [profils Infomaniak documentés](https://www.infomaniak.com/fr/support/faq/2588/comprendre-les-actions-mysql-possibles) et la [syntaxe MariaDB de GRANT](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant) permettent plusieurs formes ; une différence de format, de portée ou de droits doit être observée avant toute correction.

## Observation bornée, sans sortie brute

Le nouveau module de diagnostic classe les lignes `SHOW GRANTS FOR CURRENT_USER` en métadonnées fermées : six droits attendus en booléens, présence de droits supplémentaires, forme du scope, type d’authentification et de TLS, options de ressources reconnues, délégation/rôle/PROXY et nombre d’instructions inconnues. Les noms, comptes, motifs réels, valeurs de limites, chaînes d’authentification, hashes et extraits SQL ne sont jamais copiés dans le résultat.

Les entrées et résultats sont bornés et validés. Les données inconnues restent inconnues. Cette classification **n’approuve aucun privilège**, ne modifie pas le diagnostic normal et ne prouve pas l’ensemble des droits effectifs. Les avertissements existants sur les correspondances utilisateur/hôte demeurent ; les underscores non échappés ne sont pas acceptés par le profil normal pour autant. La [documentation SHOW GRANTS](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-grants) reste la référence de la requête de lecture.

## Une copie de connexion dédiée au diagnostic

La commande précédente a retiré le mot de passe de sa mémoire sans l’enregistrer, conformément à sa règle de sauvegarde après validation. Une nouvelle saisie masquée par le propriétaire est donc nécessaire. Le mode **diagnostic** explique avant la saisie qu’il conservera une copie privée dédiée à l’investigation, afin de permettre les prochains contrôles locaux sans répéter cette saisie.

```sh
bash scripts/capture-runtime.sh diagnose \
  --host sql.example.invalid \
  --database BASE_RECETTE \
  --confirm-database BASE_RECETTE \
  --user COMPTE_RUNTIME \
  --private-directory /REPERTOIRE_PRIVE \
  --privilege-profile infomaniak-shared \
  --private-path-mode linux-dirfd
```

Les métadonnées fictives ci-dessus ne sont pas celles de l’hébergement. Le mode par défaut de `capture-runtime.sh` continue d’appeler exclusivement la préparation normale. Le mot `diagnose`, uniquement en première position, sélectionne une autre entrée Node constante ; aucun chemin de programme ou commande arbitraire n’est accepté. Les mêmes contrôles de cible et de saisie s’appliquent : console interactive, trace désactivée, saisie invisible, pipe stdin, aucun secret en argument ou environnement exporté.

Avant de conserver la copie, les **huit contrôles hors privilèges doivent réussir**, avec TLS et certificat vérifié, puis une nouvelle connexion en lecture relève les grants. Les libérations et fermetures sont attendues avant toute écriture. Une cible, session, histoire, lecture, observation ou fermeture non conforme bloque le fichier de diagnostic. Il n’y a aucune migration, modification de ligne, changement de permissions SQL ou création d’administrateur.

Le fichier de diagnostic est **distinct** : `runtime-diagnostic.json`, format `jessiemessage-runtime-diagnostic`, version 1, horodatage canonique et objet de connexion strictement validé. Le fichier normal `runtime-database.json` et son format ne changent pas. Les lecteurs refusent la confusion entre ces deux formats. Même répertoire propriétaire 0700, fichier régulier 0600 avec un seul lien, accès ancrés par descripteurs, publication complète exclusive, synchronisations, lecture bornée et comparaison après sauvegarde. Aucun fichier existant n’est écrasé et une copie publiée reste préservée en cas de durabilité incertaine.

La sortie de réussite du diagnostic annonce seulement `diagnostic_only`, `diagnosticSaved:true`, **`configSaved:false`** et **`launchApproved:false`**, avec les contrôles et classifications filtrés. Le fichier conserve le mot de passe dans le stockage privé de l’hébergement ; l’agent n’en reçoit aucune valeur. Il n’est pas une configuration prête au démarrage ni une sauvegarde indépendante.

Une fois la cause établie et la correction revue, la préparation normale devra réussir tous ses contrôles, y compris le schéma physique d’authentification, avant toute publication du fichier runtime normal. Une copie de diagnostic ne lève jamais ce préalable. Son retrait ne sera effectué qu’après vérification d’une configuration valide conservant les mêmes identifiants, ou dans une opération de nettoyage explicite limitée à ce fichier.

Application **0.24.0**, étape **0.25**. Les huit fonctions privées et le serveur HTTP neutre restent dans leur état précédent ; aucune initialisation MFA n’est engagée pendant ce blocage. Aucun support contacté, aucune action sur ZTIKIX. **contact@jessiemessage.com** demeure l’adresse officielle.
