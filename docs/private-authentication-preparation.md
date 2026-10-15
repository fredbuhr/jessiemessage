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

La séparation du routage a été effectuée le **15 octobre 2026**. Après approbation explicite par le propriétaire de la perte annoncée des statistiques Web de l’ancien nom, `recette.jessiemessage.com` est devenu le domaine principal du projet Node, qui conserve son alias de prévisualisation. L’apex a été délié sans demander la suppression des entrées DNS, puis l’apex et `www` ont été rattachés au site Apache neutre.

L’accueil public est servi sur Apache avec certificat Let’s Encrypt valide pour l’apex, `www` et `accueil`. Les enregistrements A/AAAA de l’apex et de `www` pointent vers Apache ; la recette reste sur Node. Les enregistrements de messagerie MX, TXT et DMARC ont été contrôlés inchangés à **21:09:37 UTC**. Le nom principal du site Apache dans le Manager reste `accueil` : la redirection vers l’apex public ne requiert pas une seconde inversion de nom principal ou de statistiques. Les ressources de l’hébergement restent partagées ; cette séparation du routage ne constitue pas une garantie d’isolation système.

La révision publique `1573b18` a ses dix jobs CI verts et neuf tests ciblés du bâtisseur réussis. Son nouveau document root a été vérifié : manifeste exact de 25 fichiers, bits d’accès de répertoires/fichiers `0755`/`0644`, bit setgid hérité des répertoires et anciens exports conservés. Sur l’apex, le probe de **21:17:54.585 UTC** a réussi 91 requêtes et 1 033 assertions ; les quatre avertissements de format `Allow` restent distingués de la sémantique des méthodes. La campagne de **21:17:54.728 UTC** a réussi 18 cas de canonicalisation, avec 308 HTTP/apex, HTTP/`www` et HTTPS/`www` vers l’apex HTTPS fixe, conservation des chemins/requêtes encodés testés et absence de boucle HTTPS sur l’apex et `accueil`. Le détail et la limite de preuve sont consignés dans [l’accueil public neutre](neutral-public-host.md).

La recette Node reste neutre : HTTPS `/api/health` répond 200, `/api/ready` répond 503 et `/admin/login` répond 404. À **21:21:29.782 UTC**, les douze cas HTTP du frontal ont réussi : GET `/`, `/admin/login`, `/api/auth/session` et POST vide `/api/auth/login`, chacun sans en-tête transféré, avec `X-Forwarded-Proto: https` forgé, puis avec `Forwarded: proto=https` forgé. Chaque cas a répondu 301/308 avec une destination `Location` exactement égale à l’URL HTTPS de recette et au même chemin, sans cookie. HTTP `/api/health` avait également répondu 301. Le port 3000 du backend n’était pas joignable depuis ce probe ; ce résultat ne constitue pas une preuve de confinement Internet global.

Le code opérateur d’authentification reste à la révision `715bba`, tandis que le processus Node neutre reste à `55fb30a`. Aucun démarrage privé, aucune rotation de clé et aucune création d’administrateur n’ont été effectués ; les fonctions privées restent à `0`.

Après le changement de domaines, les neuf contrôles SQL ont de nouveau réussi, avec schéma d’authentification validé et **zéro administrateur**. Le wrapper de saisie installé a été vérifié à l’identique de sa source, avec propriétaire contrôlé, mode `0700` et lien unique. La prochaine action exige maintenant la saisie personnelle d’un **nouveau mot de passe administrateur** par le propriétaire dans son terminal privé : 14 à 128 unités UTF-16 JavaScript, avec deux saisies masquées et confirmation exacte. Aucun mot de passe ne doit être transmis dans le chat. Le TOTP doit être enrôlé dans son application personnelle ; les secrets et codes de secours restent sous son contrôle.

À **21:21 UTC**, Chrome a confirmé le rendu public neutre de `/app` sur l’apex en FR/EN. Le contrôle navigateur final a également confirmé la nouvelle vérification en anglais, puis le retour en français ; la navigation depuis `http://www.jessiemessage.com/app` aboutit exactement à `https://jessiemessage.com/app`, sans avertissement intermédiaire.

La [documentation Node Infomaniak](https://www.infomaniak.com/fr/support/faq/2537/creer-un-site-nodejs-chez-infomaniak), la [procédure d’inversion](https://www.infomaniak.com/fr/support/faq/2070/modifier-le-nom-de-domaine-dun-site) et le [déliage](https://www.infomaniak.com/fr/support/faq/1997/delier-un-nom-de-domaine-lie-au-site) décrivent les opérations d’affectation utilisées. Les tests automatisés utilisent uniquement des identités et clés synthétiques. Aucun administrateur réel n’a été créé par l’agent. L’installation PWA réelle reste également à vérifier. L’étape **0.25 demeure en cours** jusqu’à l’initialisation du compte, l’enrôlement MFA par le propriétaire et la recette privée réelle.
