# Audit ciblé du démarrage1.9.0 —23octobre2026

Le blocage persiste selon la nouvelle capture de maintenance. La cause exacte de la dernière tentative n’est pas encore établie : cette capture ne montre ni le statut Node courant, ni les champs Manager enregistrés, ni une erreur de lancement. [Preuve détaillée](verification-proofs/jm190-startup-targeted-audit.json).

## Constats établis

| Point | Résultat et limite |
| --- | --- |
| Préparation et SQL | Sources190/185 préparées, SQL38 migré et reçu confirmé. Rien à répéter. |
| CHECK185/190 | Les deux contrôles `local_closure_precheck` sont acquis. Ils vérifient les fermetures locales et leurs préalables, pas toute l’initialisation de la messagerie. |
| Journal190 vide | Lecture antérieure acquise. Elle ne décrit pas une nouvelle tentative effectuée ensuite. |
| Ancien champ Build | La capture précédente plaçait start190 dans Build. La correction réellement enregistrée et le champ Run courant restent non observés. |
| Code190 | Option experience transmise du parent au serveur ; dépendances184→190 inchangées. Aucun défaut fonctionnel établi comme cause du blocage. |
| Journaux | Le catch du processus enfant absorbe le code précis d’un échec ; le parent peut ne remonter que MANAGED_RUNTIME_START. C’est une limite du diagnostic, sans preuve qu’elle provoque l’arrêt. |
| Lanceur | Le vrai corps demeure privé. Les scripts de préparation remplacent source/arbre/répertoire/journal et ajoutent experience ; aucun guard de version184 oublié n’est établi. Les fixtures synthétiques ne prouvent pas l’exécution des guards réels dans Manager. |

Les branches vérifiées sont parseRecurring → superviseur → managed-runtime → enfant IPC → start-private-messaging → serveur. Le mode check existant de la messagerie ajoute les contrôles du runtime SQL, des schémas et du stockage photo/vidéo sans ouvrir le serveur. Les appels vérifiés utilisent des lectures, un snapshot SQL READONLY avec rollback et une image synthétique en mémoire ; aucune migration ou donnée applicative n’est modifiée.

## Documentation officielle et portée

La [FAQ2535](https://www.infomaniak.com/fr/support/faq/2535/modifier-la-configuration-dun-site-nodejs-infomaniak) distingue Build et lancement, indique le dossier d’exécution et exige la concordance du port Manager avec l’application. La [FAQ2536](https://www.infomaniak.com/fr/support/faq/2536/resoudre-un-probleme-de-site-nodejs) recommande d’examiner le statut et la console d’exécution pour identifier l’erreur réelle.

Une [maintenance Node.js officielle](https://infomaniakstatus.com/fr/Jnqlo5Qrxr/) court depuis le22octobre avec une fin estimée au30octobre et une interruption annoncée de30secondes à5minutes par site. L’annonce ne prouve pas que le site239143 soit actuellement affecté et n’explique pas à elle seule un blocage durable. Ne pas attendre arbitrairement la fin générale de la maintenance, changer de Node ou contacter le support par défaut.

## Reprise KISS

1. Faire une seule lecture complète du précontrôle de messagerie existant, avec source/Node épinglés et un garde refusant toute ouverture de serveur. [Commande exacte](operations-release190.md). Ce n’est pas un replay du CHECK local déjà réussi.
2. Recueillir une capture des champs réellement enregistrés : dossier, port, Build et Run, ainsi que l’erreur de la console Exécution du Manager. Ne pas cliquer Run/Build pour la produire.
3. Si une phase échoue, corriger ce seul défaut. Ne pas attribuer un manque de privilège sur la nouvelle table sans résultat `privileges`/`schema_reads` ; un grant partagé sur la base couvre les nouvelles tables.
4. Si tout passe, examiner le lancement Manager/lanceur, son environnement, puis l’écoute et le proxy. Le précontrôle complet ne prouve pas l’instanciation du serveur ou son port effectif.
5. Après correction démontrée, un démarrage190 borné, l’identité réelle puis le writer déjà qualifié restent la suite.

Aucun nouveau service, audit général, réinstallation, modification de droits, migration ou patch produit n’est justifié par la seule capture de maintenance. La récupération de ces résultats est une action personnelle nécessaire faute d’accès privé de l’agent ; aucun navigateur cloud ou secret n’est demandé.
