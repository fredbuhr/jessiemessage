# Préparation privée de l’authentification — étape 0.25

Application **0.24.0**. La [configuration SQL runtime](observed-shared-database-scope.md) a été publiée et relue indépendamment le 15 octobre 2026 à **19:46:18 UTC** : neuf contrôles SQL réussis, schéma physique d’authentification validé, fichiers privés propriétaire 0600 dans un répertoire 0700, TLS strict et huit fonctions privées désactivées. L’initialisation administrateur et son activation HTTP restent des opérations distinctes.

## Configuration MFA durable avant le compte

Le troisième fichier fixe `runtime-auth.json` contient uniquement `format:jessiemessage-runtime-auth`, `version:1`, une origine HTTPS officielle canonique sur un sous-domaine distinct de l’apex/`www`, et `mfaKey`. Cette clé de chiffrement est composée de 32 octets aléatoires, encodés en base64url canonique. Elle n’est ni le mot de passe administrateur, ni le secret TOTP de son application d’authentification. Aucun drapeau d’activation, identifiant SQL ou matériel d’enrôlement n’est admis dans ce fichier.

```sh
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node scripts/prepare-runtime-auth.mjs \
  --private-directory /private/operator-root \
  --origin https://recette.jessiemessage.com \
  --private-path-mode linux-dirfd
```

Le chemin est un exemple à remplacer par l’emplacement privé déjà contrôlé. La présence de n’importe quelle entrée au nom attendu bloque la génération ; il n’existe aucun remplacement ou renouvellement implicite. La publication est complète, exclusive, propriétaire 0600, synchronisée puis relue et comparée. Un échec de durabilité ne permet ni une annonce de réussite ni l’effacement d’une copie déjà publiée. Cette commande ne contacte pas SQL et ne lance aucun serveur.

Le chargeur lit la configuration SQL normale et celle d’authentification sous **un même descripteur de répertoire privé**. Il conserve les validations bornées des types, champs, liens, propriétaires, modes, UTF-8 et métadonnées stables. Cela évite de combiner deux racines après remplacement du chemin ; ce n’est pas une transaction de création des deux fichiers ni une isolation contre un autre programme du même UID. Le fichier diagnostique n’est jamais un repli de démarrage.

## Environnement explicite et démarrage fermé

Le chargeur reconstruit un environnement neuf : authentification à `1`, sept autres fonctions à `0`, origine et clé issues du fichier privé, identifiants SQL issus du fichier normal, TLS strict. Aucun secret n’est affecté à `process.env`.

L’entrée opérateur refuse les réglages `JESSIEMESSAGE_*` hérités, à l’exception du mode explicite `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Seul `PORT`, validé séparément, est repris pour l’application. Elle refuse aussi les surcharges de confiance `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_USE_SYSTEM_CA`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `OPENSSL_CONF` et tout argument d’exécution Node supplémentaire. Ce sont des contrôles de démarrage, pas une protection contre un opérateur ou un préchargement qui contrôle déjà le processus.

```sh
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node scripts/start-private-auth.mjs \
  --private-directory /private/operator-root \
  --private-path-mode linux-dirfd
```

Cette entrée est préparée pour un démarrage ultérieur ; elle **active effectivement l’authentification lorsqu’on l’exécute**. Elle exige de nouveau les neuf contrôles SQL, puis le serveur vérifie son schéma physique avant toute écoute. Aucun échec de fichier, de preuve SQL ou d’écoute ne provoque un démarrage neutre de secours. La réussite attend l’écoute réelle ; un échec de bind attend le drainage avant de rejeter. Le démarrage direct historique reste neutre sans configuration explicite.

Le garde d’autorité optionnel compare le véritable `Host` à l’origine prévue, refuse les doublons bruts et les cibles absolues ou ambiguës avant toute admission, lecture de session ou requête SQL. Les en-têtes `Forwarded` et `X-Forwarded-Host` n’accordent aucun accès. Le refus est fixe et sans cookie. L’absence de Host HTTP/1.1 conserve le refus natif du parseur Node. En mode strict, `/api/health` répond directement avec son état générique, sans appel privé ni SQL ; `/api/ready` demeure derrière le garde.

## Initialisation par le propriétaire

```sh
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd bash scripts/capture-admin.sh \
  --private-directory /private/operator-root \
  --private-path-mode linux-dirfd
```

Avant toute saisie, le helper vérifie la configuration privée, les neuf contrôles SQL, le schéma d’authentification, l’absence d’administrateur et la possibilité de créer le fichier d’enrôlement fixe. Les connexions sont libérées et les pools fermés. Il demande ensuite deux fois un **nouveau mot de passe administrateur**, masqué et confirmé exactement. Le mot de passe SQL déjà enregistré n’est pas redemandé. Le contrat existant est conservé : 14 à 128 unités UTF-16 JavaScript, au plus 512 octets UTF-8 ; la capture est limitée à une ligne sans NUL, CR ou LF et ne normalise pas le texte.

L’identité initiale est **contact@jessiemessage.com**, pseudonyme **Jess**. Le mot de passe est transmis par stdin, jamais dans les arguments, une variable exportée ou un fichier d’entrée. Le JSON destiné au bootstrap existant est construit en mémoire. Ses contrôles de chemin, verrou, transaction, crypto, unicité d’administrateur et écriture durable du fichier d’enrôlement **avant SQL** restent utilisés.

Le helper ne transmet pas le message prématuré du bootstrap : il confirme uniquement après sa fermeture effective du pool. Une issue potentiellement appliquée, y compris une erreur de chemin ou de fermeture après commit, est déclarée incertaine. La clé MFA et le fichier d’enrôlement sont conservés ; aucune relance aveugle ou régénération n’est proposée.

Le secret TOTP, l’URI et les huit codes de secours restent dans `admin-setup.json`, propriétaire 0600, hors dépôt et fichiers HTTP. L’agent ne les affiche pas et ne consulte pas leur contenu réel. Le propriétaire les utilisera dans son propre terminal et son application d’authentification. Aucun service QR externe, capture envoyée dans le chat ou route publique d’enrôlement n’est nécessaire. La première connexion doit utiliser le mot de passe et un code TOTP frais avant l’usage des codes de secours. La sauvegarde privée indépendante de la clé et du matériel d’enrôlement reste à organiser.

## Hébergement et preuve restante

Le 15 octobre à **20:06:40 UTC (22:06:40 à Paris)**, `recette.jessiemessage.com` et l’apex ont répondu à `/api/health` en HTTPS avec certificat vérifié, statut 200. Le sous-domaine est encore un alias du serveur neutre : cette observation n’est **pas une isolation achevée** et aucune fonction privée n’est ouverte. Aucun override de confiance interdit n’était présent dans l’environnement SSH observé.

La [documentation Node Infomaniak](https://www.infomaniak.com/fr/support/faq/2537/creer-un-site-nodejs-chez-infomaniak) prévoit la gestion de domaines et certificats. La [procédure d’inversion](https://www.infomaniak.com/fr/support/faq/2070/modifier-le-nom-de-domaine-dun-site) et le [déliage](https://www.infomaniak.com/fr/support/faq/1997/delier-un-nom-de-domaine-lie-au-site) permettent de préparer une affectation distincte de l’accueil public et de la recette sans acheter un second projet Node, sous réserve des actions réellement disponibles dans le Manager. Les ressources de l’hébergement et l’UID restent partagés ; ce n’est pas une isolation système.

Les résultats de CI de la révision exacte, la préparation hébergée et l’état des affectations seront consignés dans la PR. Les tests utilisent uniquement des identités et clés synthétiques ; les vrais contrôles Linux/procfs doivent s’exécuter en CI. Aucun administrateur réel n’est créé par l’agent. Aucun support contacté, aucune action sur ZTIKIX. L’étape **0.25** reste en cours jusqu’à la configuration administrateur/MFA et sa recette privée réelle.
