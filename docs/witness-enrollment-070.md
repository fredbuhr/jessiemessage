# Initialisation explicite du témoin sur le PC existant — 0.70

Étape 4/6. **Lot local en cours, sans CI ni déploiement 0.70 acquis à ce relevé.** Le service hébergé conserve l'enfant 0.65 et le parent 0.69.1. Le correctif 0.69.2 est fusionné et vérifié ; lire [son diagnostic](witness-origin-hosted-0692.md). Aucun témoin personnel ni aller-retour indépendant réel n'est encore prouvé par ce document. Les fermetures de comptes restent désactivées.

## Validation locale

Le lot complet passe 2 641 tests ; 195 intégrations ou contrôles natifs indisponibles dans ce conteneur sont ignorés, zéro échec sur 2 836 cas. La syntaxe et le build passent. Le scénario MariaDB de la passerelle utilise les vrais processus, le superviseur, l’autorité durable, le témoin persistant et des défis frais via HTTP ; il attend la CI, tout comme PowerShell 5.1 natif. Les fichiers, configurations et tables des fixtures restent synthétiques.

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

Le parseur attend exactement **17 arguments après le chemin du script : une commande et huit paires option/valeur**. Le port reste fourni par `PORT`, pas par un argument. Gabarit à compléter avec les chemins et identités 0.70 validés, avant toute exécution réelle :

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

Après activation hébergée vérifiée, télécharger le kit depuis le PC déjà raccordé, extraire tout le ZIP et ouvrir `Activer-le-temoin.cmd`. Cette action met à jour les scripts puis demande au service l'autorisation unique ; `Mettre-a-jour.cmd` seul n'initialise aucun témoin. Le kit ne contient ni nouveau code d'appariement ni bearer. Le dossier des archives, l'identifiant, les reçus et la configuration DPAPI existante restent conservés. Les copies gardent la cadence de 15 minutes ; le travailleur témoin est distinct.

Le script conserve un identifiant de tentative puis les marqueurs de permission et de début avant la première publication durable du témoin. Le travailleur planifié n'appelle jamais l'initialisation ; sans head il ne crée pas de nouvelle preuve. **Ne jamais supprimer le dossier `temoin`, les marqueurs d'initialisation, la configuration DPAPI ou l'état hébergé pour réessayer ; ne pas réapparier le PC.** Un état perdu ou incomplet exige un diagnostic de récupération.

`TEMOIN_INITIALISE` prouve seulement la création et la relecture locales. Il ne prouve ni échange indépendant accepté par le serveur, ni déchiffrement personnel, ni import SQL. Après cette action, relever séparément l'observation fraîche du serveur et l'identité du registre, sans publier les secrets ou le contenu client.

## Observation et limites restantes

L'observateur contacte le PC avant toute interruption. PC éteint, copies suspendues ou échange indisponible : observation `not_confirmed`, sans imposer sa présence aux messages et captures ordinaires. La lecture réservée à l’observation authentifie toujours le contrat et la capacité exacte lorsque les copies sont suspendues ; elle ne donne aucune permission native, car le transport et l’inscription refusent le PC suspendu. La préparation de genèse et sa lecture stricte restent inchangées. Une révocation ou un remplacement de capacité reste bloquant. Lors du premier échange complet d'une connexion, il vérifie le registre sous maintenance réelle ; les contrôles suivants rafraîchissent l'observation sans arrêter le serveur chaque minute. Une reconnexion et chaque redémarrage du parent exigent à nouveau une vérification complète. Une altération du contrat, de la configuration ou du registre original reste bloquante ; la reprise quotidienne après un simple échec PC n'est permise qu'après revérification indépendante de cet état original vide.

Ce mode reste `observe_only`, `closuresEnabled:false`. Il ne fournit pas la barrière fraîche de récupération après fermeture, ni la réconciliation source/cible ou l'inspection SQL privilégiée. La preuve Windows personnelle, l'aller-retour indépendant réel, le déchiffrement courant et l'import natif isolé restent des étapes distinctes à relever. Aucun résultat de test local, de CI ou de déploiement 0.70 ne doit être déduit de cette préparation documentaire.
