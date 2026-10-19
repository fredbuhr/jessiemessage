# Initialisation explicite du témoin sur le PC existant — 0.70

Étape 4/6. **Activation 0.70 et redémarrage permanent vérifiés le 19 octobre à 13:36:02.552899 UTC.** [PR #88](https://github.com/fredbuhr/jessiemessage/pull/88), source finale `61878b174b239c8d009fedd9714701214dadbfbe`, arbre `1efa835b44a6baeaa06b7e7e5ccf4351ece3e58c`, merge `1877870344191b19729d206805a715a221e3e9b4`. Parent et enfant 0.70 ont publié la permission puis repris derrière la passerelle ; le Run permanent est enregistré, relu et redémarré avec source/arbre propres et permission inchangée. Le correctif 0.69.2 reste acquis ; lire [son diagnostic](witness-origin-hosted-0692.md). Aucun témoin personnel ni aller-retour indépendant réel n'est encore prouvé. Les fermetures de comptes restent désactivées. [Preuves d'activation](activation-proofs/jm070-activation.json), [accès visuel inspecté](activation-proofs/jm070-service-access.jpg).

## Validation acquise avant activation

Les cinq jobs des runs [source 39259576426](https://github.com/fredbuhr/jessiemessage/actions/runs/39259576426), [PR 39259587578](https://github.com/fredbuhr/jessiemessage/actions/runs/39259587578) et [main 39260235199](https://github.com/fredbuhr/jessiemessage/actions/runs/39260235199) sont réussis. Les runs Windows [source 39259576366](https://github.com/fredbuhr/jessiemessage/actions/runs/39259576366), [PR 39259587465](https://github.com/fredbuhr/jessiemessage/actions/runs/39259587465) et [main 39260235066](https://github.com/fredbuhr/jessiemessage/actions/runs/39260235066) sont également réussis.

| Contrôle | Résultat |
|---|---|
| MariaDB 10.11 et 11.4 | 410/410 tests sur chaque version ; composition réelle observateur/inscription, trois défis frais via HTTP et suspension. |
| Chrome | 157/157 tests. |
| Suite générale CI | 2 806 réussites, 30 wrappers ignorés, zéro échec sur 2 836 cas. |
| Syntaxe et build | 526 sources conformes, build réussi. |
| Windows natif | 85 assertions du témoin réussies. |
| Suite locale finale | 2 641 réussites, 195 intégrations ou contrôles natifs indisponibles ignorés, zéro échec sur 2 836 cas. |
| Hébergement, contrôles ciblés | 138/138 contrôles natifs réussis, sans cas ignoré. |

Le scénario MariaDB de la passerelle utilise les vrais processus, le superviseur, l'autorité durable, le témoin persistant et des défis frais via HTTP. Les fichiers, configurations et tables des fixtures restent synthétiques. Le vrai précontrôle `checkInitial` a ensuite réussi contre l'origine existante : `status:passed`, `prepared:false`, `started:false`, `closuresEnabled:false`. Ce précontrôle ne crée pas la permission et ne démarre aucun service. Tests et précontrôle n'attestent ni activation 0.70 ni preuve externe sur le PC personnel.

## Préparation hébergée acquise le 19 octobre

La préparation a été lancée via le cycle Build/démarrage du Manager vers **15:28 Europe/Paris** avec parent et enfant depuis `/srv/customer/jessiemessage-operator/witness-enrollment-070-f4c7333f`, épinglés à la source/arbre ci-dessus. `node_modules` est lié au runtime 0.65 après comparaison des dépendances verrouillées identiques. La publication de la permission et la reprise de l'enfant sur boucle locale **3001**, derrière le parent **3000**, ont réussi ; le CLI de contrôle de l'observateur passe en lecture seule. Le contrat de 813 octets et son empreinte originale sont inchangés.

Les deux fichiers privés d'autorité restent en phase `ready`, mode 0600 :

| Fichier du sous-dossier `enrollment` | Taille | SHA-256 |
|---|---:|---|
| `witness-enrollment-origin.json` | 968 octets | `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` |
| `witness-enrollment.json` | 226 octets | `ac4c7287aaaa5abc758ddb4cc8b8fd86d433c6c8a187e048c7dc12a6dba4b728` |

Le Run permanent enregistré, relu et redémarré est `bash /srv/customer/jessiemessage-private/start-primary-witness-observer-070-61878b17.sh`, lanceur **1 131 octets, 0700**, SHA-256 `cd888f05bab47253fe79783d5c05e5b2a16827cff8b3a1d2b43be85808f41bb6`. **La reprise normale est vérifiée, avec contrat et deux empreintes de permission strictement inchangés.** Le lanceur ponctuel de préparation, 1 135 octets, SHA-256 `d18a6b5873a5a1d9abbfc8e298693463ec26580200e3904ca1f27ed80e0bfa1a`, ne doit plus être rejoué. Journal privé `/srv/customer/jessiemessage-private/jm070-witness-observer.log` : une seule préparation et deux démarrages parent, ponctuel puis normal. Les paramètres précédents sont conservés dans `/srv/customer/jessiemessage-private/manager-before-witness-enrollment-070.json`, 461 octets, 0600, SHA-256 `e91932557d5d2bbea7ad1f9c90ce9ff38eb231eed038f583f1e2f4b4a88170c0`.

À **13:29:38.678942 UTC**, 64/64 contrôles HTTPS et les empreintes de 44 ressources sont conformes. À **13:30:39.766 UTC**, avant le redémarrage normal, quatre archives sont disponibles ; la dernière est `capture-1792386945745-204e0e8e073b6131`, 402 552 octets, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`, avec reçu PC concordant et horaire 05:15 UTC conservé. **La copie d'archive ne prouve pas l'initialisation du témoin : le PC reste non initialisé, `externalWitnessConfirmed:false` et `closuresEnabled:false`.**

Après redémarrage permanent, le Manager affiche **Actif** et **80/80 contrôles HTTPS** sont conformes, soit 64 à **13:32:23.658793 UTC** avec 44 ressources exactes, puis 16 refus natifs à **13:32:24.862573 UTC** ; TLS vérifié et aucune vraie capacité utilisée. Le contrôle authentifié CLI `check-witness-observer` passe en lecture seule. Archives, horaire et reçu PC sont également relus concordants après reprise. Cinq relevés de surveillance, de `1792416668320` à `1792416908346`, sont `current`/OK sans incident ; à `1792416910012`, l'observation reste `enrollment_required`, `externalWitnessConfirmed:false`, `closuresEnabled:false`. Le checkpoint privé courant est `/srv/customer/jessiemessage-private/jm070-activation.json`, **2 555 octets, 0600**, SHA-256 `1a29475a28b745a0bff63dad3ecaeecae84dba3c8b4a488488eec772cd899685`.

## Périmètre

Le lot prépare une permission d'initialisation distincte du contrat original, un endpoint réservé au PC déjà apparié et une commande Windows explicite `Activer-le-temoin.cmd`. Le parent conserve le port public dans une passerelle et relaie le trafic ordinaire vers l'enfant 0.70 sur sa boucle locale. Le raccordement fournit uniquement un observateur du registre original vide : il ne construit aucun propriétaire d'effacement, n'importe pas SQL et n'autorise pas une application restaurée.

Le contrat original existe déjà dans `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1/contract/witness-genesis.json`, 813 octets, mode 0600, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10`. **Ne pas rejouer `plan-witness` ou `prepare-witness`, recréer une genèse, supprimer le contrat ou modifier son empreinte.** Une échéance du plan historique ne rend pas le contrat invalide et n'autorise pas sa recréation.

## Permission et requête native

Le sous-dossier privé `enrollment`, préexistant et 0700, est extérieur aux configurations, opérations restaurables, médias et code. L'origine immuable `witness-enrollment-origin.json` et l'état `witness-enrollment.json` sont authentifiés avec une sous-clé de la clé CRM existante, liée au SHA-256 du contrat. La préparation exige un dossier vide, le contrat authentifié, le registre original complet vide, les configurations et la capacité exacte du PC, puis l'arrêt réel zéro/sans signal du processus sous le verrou commun aux captures. Toute absence ou publication partielle ultérieure bloque ; une lecture ne crée aucun état par défaut.

`POST /api/backup-copy/witness/enroll` accepte seulement un appel natif HTTPS sur l'origine principale, avec `X-Jessie-Backup: 1`, un bearer courant du PC exact et le corps JSON canonique à trois champs `version`, `destinationId`, `attemptId`. Cookies, Origin et en-têtes Sec-Fetch sont refusés ; aucune session de navigateur ne peut consommer la permission. Identité, date d'appariement et empreinte de capacité sont vérifiées avant la réservation et de nouveau avant la réponse. Corps, en-têtes dupliqués, lecteurs concurrents et cadence sont bornés.

Le client Windows réserve 90 secondes à cette requête, qui inclut l’arrêt et la reprise réelle du serveur avant réponse ; les sondes ordinaires conservent 30 secondes.

La permission passe durablement de `ready` à `spent` **avant** la réponse contenant `initialize:true`. Une coupure de réseau ne la remet pas disponible. La même tentative reçoit seulement `initialize:false` et doit retrouver ses marqueurs Windows et son témoin cohérents ; une autre tentative est refusée. Une réponse incertaine, un marqueur absent ou une initialisation interrompue ne donne jamais droit à recommencer sur un dossier vide.

## Précontrôles et commandes opérateur

Avant activation, vérifier les commits et arbres exacts du parent et de l'enfant 0.70 validés, la propreté de leurs checkouts et le montage prévu de `node_modules`. Relire le SHA-256 et l'authentification du contrat existant ; conserver les configurations, la capacité du PC, les archives et les reçus. Vérifier les dossiers privés préexistants, l'absence de quarantaine ou de journal d'effacement et les paramètres du Manager sauvegardés. Ces vérifications ne constituent pas une restauration prouvée.

Le parseur attend exactement **17 arguments après le chemin du script : une commande et huit paires option/valeur**. Le port reste fourni par `PORT`, pas par un argument. Les gabarits ci-dessous documentent le raccordement ; **la première préparation a déjà réussi sur le service actuel et ne doit plus y être rejouée** :

```bash
jmWitnessArguments=(
  --private-directory "$JM_PRIVATE_DIRECTORY"
  --operations-directory "$JM_OPERATIONS_DIRECTORY"
  --runtime-directory "$JM_RUNTIME_070_DIRECTORY"
  --runtime-head "$JM_RUNTIME_070_HEAD"
  --runtime-tree "$JM_RUNTIME_070_TREE"
  --private-path-mode linux-dirfd
  --witness-operator-directory "$JM_WITNESS_OPERATOR_DIRECTORY"
  --witness-contract-sha256 4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10
)
```

| Commande | Usage et effet |
|---|---|
| `prepare-witness-enrollment` | Première préparation explicite seulement. Son précontrôle interne exige `enrollment` vide ; elle démarre le processus, attend la décision de capture initiale, prépare la permission sous maintenance gérée puis observe. Elle reste un processus actif, pas un contrôle qui se termine immédiatement. |
| `check-witness-observer` | Après préparation uniquement. Authentifie le contrat, le registre original et la permission déjà créée, sans démarrer le service et sans prouver le PC externe. Un état absent ne l'initialise pas. |
| `start-witness-observer` | Run permanent après préparation vérifiée. Raccorde la passerelle et observe le PC ; ne rejoue ni genèse ni préparation de permission. |

```bash
# Ponctuel, une fois, puis remplacer le Run par le démarrage normal.
PORT=3000 node "$JM_PARENT_070_DIRECTORY/scripts/start-recurring-private-messaging.mjs" prepare-witness-enrollment "${jmWitnessArguments[@]}"

# Contrôle de la permission existante, avant le Run permanent.
PORT=3000 node "$JM_PARENT_070_DIRECTORY/scripts/start-recurring-private-messaging.mjs" check-witness-observer "${jmWitnessArguments[@]}"

# Run permanent ; enregistrer et relire ses valeurs dans le Manager.
PORT=3000 node "$JM_PARENT_070_DIRECTORY/scripts/start-recurring-private-messaging.mjs" start-witness-observer "${jmWitnessArguments[@]}"
```

Ne pas conserver `prepare-witness-enrollment` comme Run permanent. Une seconde préparation refuse un état existant. Ne pas supprimer cet état pour contourner ce refus. Distinguer le résultat Build, le démarrage du parent, la préparation durable, le contrôle de readiness et les refus anonymes de la passerelle ; conserver les codes techniques neutres et journaux privés.

## Action explicite sur Windows

Le service est maintenant prêt pour l'action personnelle suivante : **sur le PC habituel, Sauvegardes → Mettre à jour le PC → extraire tout le ZIP → ouvrir `Activer-le-temoin.cmd`**. Cette action met à jour les scripts puis demande au service l'autorisation unique ; `Mettre-a-jour.cmd` seul n'initialise aucun témoin. Le kit ne contient ni nouveau code d'appariement ni bearer ; aucun nouveau raccordement ni clé n'est nécessaire. Le dossier des archives, l'identifiant, les reçus et la configuration DPAPI existante restent conservés. Les copies gardent la cadence de 15 minutes ; le travailleur témoin est distinct.

Le script conserve un identifiant de tentative puis les marqueurs de permission et de début avant la première publication durable du témoin. Le travailleur planifié n'appelle jamais l'initialisation ; sans head il ne crée pas de nouvelle preuve. **Ne jamais supprimer le dossier `temoin`, les marqueurs d'initialisation, la configuration DPAPI ou l'état hébergé pour réessayer ; ne pas réapparier le PC.** Un état perdu ou incomplet exige un diagnostic de récupération.

`TEMOIN_INITIALISE` prouve seulement la création et la relecture locales. Il ne prouve ni échange indépendant accepté par le serveur, ni déchiffrement personnel, ni import SQL. Après cette action, relever séparément l'observation fraîche du serveur et l'identité du registre, sans publier les secrets ou le contenu client.

## Observation et limites restantes

L'observateur contacte le PC avant toute interruption. PC éteint, copies suspendues ou échange indisponible : observation `not_confirmed`, sans imposer sa présence aux messages et captures ordinaires. La lecture réservée à l’observation authentifie toujours le contrat et la capacité exacte lorsque les copies sont suspendues ; elle ne donne aucune permission native, car le transport et l’inscription refusent le PC suspendu. La préparation de genèse et sa lecture stricte restent inchangées. Une révocation ou un remplacement de capacité reste bloquant. Lors du premier échange complet d'une connexion, il vérifie le registre sous maintenance réelle ; les contrôles suivants rafraîchissent l'observation sans arrêter le serveur chaque minute. Une reconnexion et chaque redémarrage du parent exigent à nouveau une vérification complète. Une altération du contrat, de la configuration ou du registre original reste bloquante ; la reprise quotidienne après un simple échec PC n'est permise qu'après revérification indépendante de cet état original vide.

Ce mode reste `observe_only`, `closuresEnabled:false`. Il ne fournit pas la barrière fraîche de récupération après fermeture, ni la réconciliation source/cible ou l'inspection SQL privilégiée. La preuve Windows personnelle, l'aller-retour indépendant réel, le déchiffrement courant et l'import natif isolé restent des étapes distinctes à relever. L'activation hébergée et les validations CI, locales et natives consignées plus haut ne certifient pas ces étapes restantes.
