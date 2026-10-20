# Audit transversal de JessieMessage — 20 octobre 2026

Audit demandé explicitement par le propriétaire : code mort, doublons, bugs, sécurité, redondance et complexité inutile. **Audit terminé ; corrections applicatives non réalisées dans ce lot.** Le service 0.79 reste en ligne sur le mutualisé existant. Aucun redémarrage, envoi réel, effacement, restauration, changement de clé ou d’appariement n’a été effectué.

## Conclusion

La messagerie possède des contrôles d’accès et une couverture de tests solides, mais plusieurs comportements de bord méritent correction. **Aucun P0/P1, accès intercompte ou contournement d’authentification n’a été démontré dans les chemins examinés.** Cela ne certifie pas leur absence.

Les priorités sont le maintien des correctifs Node, la disponibilité des connexions, les échéances franchies pendant des attentes SQL et la fiabilité des copies à mesure que leur volume augmente. Les refus de sauvegarde/restauration examinés protègent l’intégrité : leurs défauts concernent la disponibilité ou la reprise, sans perte réelle démontrée.

**Le principal problème KISS est l’exploitation et la documentation historique, davantage que les clones exacts de code.** Une réécriture ou une suppression massive de mécanismes anciens apporterait davantage de risque qu’un petit ensemble de corrections. Aucun changement d’hébergement ni budget supplémentaire n’est justifié par ces constats.

## Référence, méthode et limites

| Élément | Référence auditée |
| --- | --- |
| Dépôt / branche | `fredbuhr/jessiemessage`, `main`, propre au début de l’audit |
| Commit / arbre | `f62913771cfd827b3f7f556b135be99aecbbb816` / `b6df729c1aeefef5acf865a076e1bfd8335afd9f` |
| Code exécuté | 0.79.0, `bc6103a73ce63752eda27a0bce83a7e53e409d09`, arbre `39ac4fdabc55b7661742fbd6acc5763d65a42dab` |
| Concordance | Aucun diff dans `server/`, `public/`, `scripts/`, `package.json` et `package-lock.json` entre ces deux commits |
| Composition active | `start-local-closures`, port 3000 direct, sans observateur/passerelle |
| Inventaire de départ | 846 fichiers suivis, 176 modules serveur ; syntaxe de 558 fichiers JavaScript/shell vérifiée |
| Environnement local | Node 24.19.0 ; absence locale de MariaDB, Chrome/ChromeDriver et des ancrages procfs requis par certains tests |
| Hébergement relu | `/usr/local/bin/node` 24.15.0, utilisé par le lanceur courant ; quotas média 1 Gio/propriétaire, 10 Gio/global |

Revue parallèle des domaines auth/accès/récupération, transport et exports, chat/médias/CRM/diffusions, SQL et migrations, interface/PWA, sauvegardes/copieur Windows/restauration/fermetures. Inventaire global des imports, ressources et liens ; lectures ciblées des chemins sensibles ; reproductions isolées avec données synthétiques, connexions SQL doublées et un vrai processus enfant synthétique. Les constats ont été relus pour distinguer bug, limite volontaire et risque conditionnel.

Il s’agit d’un audit transversal du dépôt et des chemins actifs, pas d’une preuve formelle ni d’une mesure de couverture de chaque ligne ou export. Aucun test de charge, scan offensif de production, test de compte réel ou nouvelle recette sur appareil physique. Les attentes SQL nouvelles ont été simulées, sans reproduction MariaDB native pendant cet audit. Les preuves CI natives antérieures restent distinctes.

Échelle : **P0** urgence absolue ; **P1** impact grave démontré ; **P2** correction utile à prioriser, parfois sous condition explicite ; **P3** faible impact, durcissement ou entretien. La priorité ne transforme pas une condition non observée en incident actuel.

## Constats priorisés

| ID | Priorité | Constat | Niveau de preuve et portée |
| --- | --- | --- | --- |
| A01 | P2 | Node en production en retard de correctifs de sécurité | Version et lanceur relus sur l’hôte ; bulletins officiels vérifiés. Exploitabilité dans cette composition non démontrée. |
| A02 | P2 | Les refus réseau consomment encore le budget global de connexion | Reproduit avec vrai service et double de quotas ; seuils HTTP relus. Sessions existantes utilisables. |
| A03 | P2 | Une diffusion peut dépasser son échéance pendant une attente SQL | Reproduction synthétique et contrepreuve avec heure fraîche ; aucune diffusion réelle. |
| A04 | P3 | Même défaut temporel pour récupération, invitation et vérification email | Reset reproduit sur double SQL ; autres chemins lus. Possession du lien et usage unique restent nécessaires. |
| A05 | P2 | Plafond média sauvegardable de 1 Gio contre quota global de 10 Gio | Limite reproduite, quotas actifs relus. Aucun volume actuel au-delà du seuil constaté. |
| A06 | P2 | Une copie média interrompue bloque la reprise du job de restauration | Copieur/vérificateur reproduits isolément, branche CLI lue ; cible non publiée, source et états existants préservés. |
| A07 | P2 | Sous charge d’historique, le copieur Windows peut ne jamais atteindre les nouveautés | Mécanisme statique confirmé ; durée sur le PC réel non mesurée. |
| A08 | P2 | L’historique est borné sans parcours de rotation opérationnel | Refus à 2 001 reçus confirmé ; problème de durée de vie, pas incident actuel. |
| A09 | P2 | L’arrêt parent peut annoncer le succès après un arrêt forcé de l’enfant | Reproduit avec vrai enfant synthétique ; gardes de capture/effacement distincts préservés. |
| A10 | P3 | Certains contrôles de FK ignorent le schéma parent | Métadonnées synthétiques acceptées ; suppose une dérive DDL opérateur. Import/snapshot ont des contrôles distincts. |
| A11 | P3 | HSTS absent des réponses HTTPS contrôlées | Observé sur trois API ; autres en-têtes de protection présents. Aucune interception démontrée. |

### A01 — Mettre à jour le runtime Node sans changer d’architecture

Le 20 octobre à **00:09:41 UTC**, le binaire hébergé donne `v24.15.0` et le lanceur courant référence `/usr/local/bin/node`. Les bulletins officiels [juin 2026](https://nodejs.org/en/blog/vulnerability/june-2026-security-releases) et [juillet 2026](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases) publient des correctifs ultérieurs, notamment en **24.17.0** et **24.18.1**. `npm audit` ne couvre pas ces composants intégrés à Node.

Cette différence de version est certaine ; elle ne prouve pas que chaque CVE soit atteignable dans JessieMessage. Les cas HTTP/2, Permission Model, SQLite ou proxy n’ont pas de chemin actif démontré ici. La composition utilise HTTP/1 derrière le frontal d’hébergement et des transports sortants bornés. Le risque doit donc être traité comme une dette de sécurité du runtime, sans annoncer une compromission.

**Correction attendue :** sélectionner une version Node 24 corrigée disponible chez l’hébergeur, qualifier le démarrage et les parcours utiles sur cette version, puis déployer par le cycle normal avec repli conservé. Ne pas changer de serveur ou de version majeure pour ce seul motif. L’annonce officielle du 21 octobre est une publication à venir au jour de l’audit, pas un correctif déjà validé ici.

### A02 — Un réseau refusé peut bloquer les nouvelles connexions des autres

Références : [auth/service.mjs](../server/auth/service.mjs), ligne 54 ; [access/service.mjs](../server/access/service.mjs), ligne 108 ; [reset/service.mjs](../server/reset/service.mjs), lignes 48–55 ; [admission HTTP](../server/http/admission.mjs), lignes 8–18.

Le budget global est débité avant le refus réseau. Avec le vrai service et un double de quotas, **120 tentatives déjà refusées au réseau** épuisent le plafond administrateur ; une autre adresse reçoit ensuite `AUTH_RATE_LIMIT`, sans recherche de compte. Les opérations publiques accès/reset ont un plafond global de **60/minute**. Ces volumes sont inférieurs à l’admission HTTP de **1 200/minute/pair**.

L’ordre actuel est intentionnel pour borner la création des lignes SQL de quotas ; son amplification du déni de nouvelles connexions est néanmoins évitable. Les sessions existantes et le MFA ne sont pas contournés. Aucun trafic de ce type n’a été envoyé à la production.

**Correction attendue :** qu’un réseau déjà refusé ne débite pas le budget global utile aux autres, tout en conservant une borne sur la création des compteurs et le travail SQL. Un simple échange aveugle des boucles pourrait perdre cette protection. Test attendu : un refus réseau répété laisse une connexion d’un autre réseau admissible, avec cardinalité et travail toujours bornés.

### A03 — Une diffusion peut être envoyée après expiration

Références : [broadcast/store.mjs](../server/broadcast/store.mjs), lignes 283–303 et 416–427 ; [chat/store.mjs](../server/chat/store.mjs), lignes 362–378 ; [worker](../server/broadcast/worker.mjs), lignes 65–68.

`withJob` et `claim` comparent campagne et bail à l’heure d’entrée, malgré une heure actualisée disponible dans `context.now`. Reproduction avec le vrai store et un contexte SQL synthétique : entrée `t`, contexte après verrous `t+2000`, expiration `t+1000` → `delivered:true`, insertion appelée une fois. Avec l’heure fraîche fournie en entrée → `delivered:false`, aucune insertion. Un bail expirant pendant l’attente présente le même motif.

Les droits administrateur/client, l’état du destinataire et la comparaison du jeton de bail restent contrôlés. Pas de fuite intercompte ni de doublon démontré. Les tests natifs existants vérifient une expiration déjà passée à l’entrée, sans franchissement pendant l’attente.

**Correction attendue :** comparer les échéances à une heure actualisée après les verrous pertinents, en réutilisant l’horloge/contexte existant. Ajouter la régression d’expiration pendant l’attente, sans nouvelle abstraction temporelle générale.

### A04 — Des liens peuvent conserver quelques instants une validité périmée

Références : [reset/store.mjs](../server/reset/store.mjs), lignes 164–174 et 208–221 ; [access/store.mjs](../server/access/store.mjs), lignes 285–306 et 399–411 ; composition reset dans [index.mjs](../server/index.mjs), ligne 375.

Les contrôles utilisent `now` obtenu avant acquisition de connexion/verrous. Un double SQL retarde l’acquisition jusqu’après l’expiration du reset : le changement de mot de passe reste accepté. Le même motif apparaît à la consommation d’invitation et à la vérification d’email. Les chemins de session ont déjà un mécanisme de relecture d’heure qui peut servir de modèle.

L’extension est bornée par l’attente réelle ; il faut toujours posséder le lien valide à l’entrée. Identité, génération, révocation et consommation unique restent vérifiées. **Faible priorité relative, sans capacité à fabriquer un lien ou reprendre un lien consommé.** Correction et régression peuvent accompagner A03.

### A05 — Le volume accepté par l’application dépasse le volume sauvegardable

Références : [checkpoint-files.mjs](../server/backup/checkpoint-files.mjs), lignes 7 et 83 ; [media/config.mjs](../server/media/config.mjs), lignes 32–35 ; ancienne limite documentée dans [private-schema30-checkpoint](private-schema30-checkpoint.md).

La capture refuse plus de **1 073 741 824 octets** de fichiers média chiffrés cumulés. Les quotas réellement configurés sont **1 Gio par propriétaire et 10 Gio global**. Reproduction isolée : 103 fichiers sparse de 10 Mio, soit **1 080 033 280 octets**, produisent `CHECKPOINT_FILES_LIMIT` avant toute copie cible.

Le service peut donc encore accepter des photos alors que les nouvelles captures échouent. Le refus préserve l’intégrité et n’efface pas les anciennes archives ; aucun dépassement de volume n’a été mesuré sur le service actuel. Quota applicatif et taille des fichiers de capture ne sont pas nécessairement la même grandeur : aligner seulement deux nombres ne suffit pas.

**Correction attendue :** une politique de volume cohérente de bout en bout, vérifiée avec médias chiffrés, SQL, compression/GPG, taille maximale de transfert et espace disponible. Choisir le plus petit changement compatible avec l’usage actuel ; ne pas relever le seul plafond de capture au-delà des limites des outils PC.

### A06 — Une copie partielle ne se complète pas à la reprise de restauration

Références : [manual-restore.mjs](../scripts/manual-restore.mjs), lignes 190–194 ; [checkpoint-files.mjs](../server/backup/checkpoint-files.mjs), lignes 205–216.

Le copieur conserve correctement les sorties partielles en cas d’interruption. Le parcours `restore` ne copie toutefois que si la cible est vide ; à la reprise, il passe directement à la vérification d’une cible incomplète. Reproduction isolée du copieur puis du vérificateur : interruption pendant le deuxième fichier, deux fichiers conservés, vérification ciblée refusée avec `CHECKPOINT_FILES_UNSAFE`. La branche CLI qui appelle cette vérification est confirmée par lecture ; aucune relance complète du CLI avec SQL natif n’a été effectuée pour cette reproduction.

La source et les éventuelles quarantaines déjà présentes restent intactes ; le job reste `allocated`, sans atteindre `imported` ni `open`. La quarantaine cible est publiée plus tard dans le parcours. Aucune ouverture incorrecte ni perte de production. L’opérateur doit intervenir davantage que ne le laisse penser une reprise transparente.

**Correction attendue :** reprise des seuls fichiers manquants après vérification stricte des fichiers existants et des pins, ou parcours explicite d’abandon vers une nouvelle cible isolée. Conserver le refus sur fichier divergent et toute quarantaine ; aucune suppression automatique pour faire passer la reprise.

### A07 — Les anciennes archives peuvent monopoliser chaque passage Windows

Références : [JessieMessage-sauvegardes-055.ps1](../scripts/JessieMessage-sauvegardes-055.ps1), lignes 116–121, 134 et 147–173.

Chaque passage reprend le catalogue de l’ancien vers le récent. Un fichier déjà présent est entièrement rehaché. Si ce préfixe prend les dix minutes imparties, le passage s’arrête avant les nouveautés ; le suivant recommence au même endroit. Le plafond de vingt téléchargements ne protège pas de cette situation puisque les vérifications d’archives existantes ne l’incrémentent pas.

Le mécanisme est certain par lecture ; son déclenchement sur le PC du propriétaire n’a pas été mesuré. Les tests actuels sur petite archive ne qualifient pas un historique volumineux.

**Correction attendue :** garantir qu’un historique important n’empêche pas l’archive récente d’être atteinte, en gardant les contrôles d’intégrité et les règles de reçus. Tester un historique dont la vérification dépasse le budget d’un passage. Aucun nouveau service PC nécessaire.

### A08 — La borne d’historique exige une gestion de durée de vie

Références : [recurring-checkpoint-files.mjs](../server/backup/recurring-checkpoint-files.mjs), lignes 7–8 et 237–240 ; [recurring-checkpoint.mjs](../server/backup/recurring-checkpoint.mjs), lignes 96 et 127 ; [copy-catalog.mjs](../server/backup/copy-catalog.mjs), ligne 94.

La lecture refuse plus de **2 000 reçus** ou **4 096 entrées** de dossier. Une tentative produit normalement un reçu `running`, puis un reçu `succeeded/failed`. Le premier seuil représente donc environ **1 000 tentatives**, soit **2,74 ans à une tentative par jour**, moins avec essais supplémentaires. Le catalogue et les copies dépendent de cette lecture. Le test à 2 001 reçus confirme le refus fermé.

C’est une borne de sécurité volontaire, pas un dépassement actuellement constaté. L’absence de rotation opérée la transforme à terme en arrêt fonctionnel.

**Correction attendue :** avertissement avant saturation et procédure de rotation/archivage compatible avec les archives encore restaurables et le registre des fermetures. Aucun nettoyage automatique des reçus ou archives dans cet audit. Relever simplement le plafond reporte le problème.

### A09 — Un arrêt forcé peut être rapporté comme réussi

Références : [managed-runtime.mjs](../server/backup/managed-runtime.mjs), lignes 173–177 ; [recurring-supervisor.mjs](../server/backup/recurring-supervisor.mjs), lignes 354–356 ; [CLI](../scripts/start-recurring-private-messaging.mjs), lignes 130–132.

`destroy()` masque les erreurs de `stop()`. Le superviseur peut alors résoudre `finished` avec `{failed:false}`. Reproduction avec un vrai enfant synthétique ignorant SIGTERM : SIGKILL constaté, résultat parent sans échec.

**Portée exacte : défaut de signalement de l’arrêt.** Les captures vérifient séparément la sortie zéro sans signal, et les chemins de fermeture/publication contrôlent eux aussi `stop()`. Aucun contournement de garde d’effacement ou de réouverture n’a été démontré.

**Correction attendue :** propager ou enregistrer l’échec de drainage jusqu’au résultat et au code de sortie parent, tout en terminant le nettoyage. Régression avec enfant nécessitant SIGKILL.

### A10 — Durcir la comparaison du schéma parent des clés étrangères

Référence principale : [erasure-schema.mjs](../server/data/erasure-schema.mjs), lignes 26–32 ; motif également présent dans plusieurs stores.

Des contrôles comparent table/colonne/contrainte/règle sans `REFERENCED_TABLE_SCHEMA`. Des métadonnées synthétiques conformes aux trente migrations et quarante FK, mais avec une FK CRM pointant vers une base homonyme extérieure, restent acceptées.

Cela suppose une dérive DDL opérateur ; le runtime n’a pas ces droits. Le snapshot et l’import SQL fermé contrôlent déjà le schéma parent. **Ce n’est pas un contournement démontré de la restauration normale ni une attaque HTTP.**

**Correction attendue :** inclure le schéma parent dans les comparaisons locales concernées ; cas négatif avec table homonyme hors base. Conserver les différences métier des validateurs.

### A11 — Ajouter une politique HSTS explicite

Les GET HTTPS en lecture seule `/api/health`, `/api/ready` et `/api/admin/backups` renvoient respectivement **200, 200 et 401**, sans `Strict-Transport-Security`. `no-store`, CSP et `nosniff` sont présents. La réponse privée anonyme efface un cookie ; les deux réponses publiques n’en émettent pas. Les constantes [index.mjs](../server/index.mjs), lignes 55–62 et [auth/http.mjs](../server/auth/http.mjs), lignes 6–13, ne définissent pas HSTS.

**Correction attendue :** définir HSTS sur l’origine HTTPS au niveau le plus simple et cohérent, application ou frontal. Qualifier la durée et les sous-domaines avant `includeSubDomains` ou préchargement. L’absence observée n’est pas une preuve d’interception ou d’envoi d’un cookie Secure en clair.

## Deux candidats à confirmer avant de les déclarer bugs de navigateur

| ID | Candidat | Preuve actuelle | Vérification manquante |
| --- | --- | --- | --- |
| C01 | Une navigation externe vers une API peut effacer un cookie de session Strict absent de la requête | Les handlers auth/access renvoient `401 + Max-Age=0` même sans cookie ; reproduction du handler avec navigation principale cross-site. | Rejouer le parcours avec vrai cookie et deux origines dans Chrome. Déconnexion attendue, sans révocation SQL ni lecture privée ; non confirmée en navigateur. |
| C02 | Une ancienne réponse de Sauvegardes peut perturber une nouvelle action après reprise de page | VM du vrai `public/backups.js:161,164` : ancien `catch` relance `bootstrap`, annule la nouvelle action et son `finally` libère `busy`. | Le harness autorise une promesse fetch à ignorer l’abandon ; cette séquence n’est pas reproduite dans Chrome. Aucun rejeu de POST ni fuite démontré. |

Pour C01, éviter l’effacement sur un simple GET sans cookie est une piste locale. Pour C02, le modèle de garde par epoch déjà utilisé ailleurs est la piste naturelle. Leur qualification doit précéder une annonce de faille confirmée.

## Code mort, doublons et complexité

### Inventaire : peu de suppressions évidentes

- Sur **176 modules serveur**, 109 sont atteignables depuis `server/index.mjs`, 173 depuis les racines CLI/serveur, et `media/image-worker.mjs` est réintégré comme entrée d’enfant chargé par `forkProcess(new URL(...))`. Les deux derniers noyaux historiques, `registry-witness` et `closure-reconciliation-replay`, sont explicitement conservés et testés. **Aucun module entier démontré inutile par cet inventaire.** L’atteignabilité d’un module ne prouve pas l’usage de tous ses exports.
- `constantTimeText`, [auth/crypto.mjs](../server/auth/crypto.mjs), lignes 261–268, n’a que des consommateurs de test dans le dépôt. Candidat réel de petit nettoyage interne, sans gain fonctionnel mesuré. Vérifier le contrat d’export avant retrait ; aucun autre consommateur n’a été trouvé.
- **79/81 fichiers publics** ont une route ; les exceptions sont intentionnelles : `public/icon.svg`, archive non servie, et le registre d’intégrité utilisé par build/tests. Les 67 références de ressources examinées ont une cible ; aucun import local manquant.
- **772 liens documentaires relatifs** vérifiés, aucun cassé. Un lien valide peut néanmoins pointer vers un état obsolète.

La composition courante ne démarre pas l’ancien observateur ou la passerelle. Le copieur PC charge encore son fichier témoin et les kits le distribuent : ce contenu ne doit pas être supprimé comme s’il était inutilisé. Les clés, bindings, journaux, marqueurs, gardes dirfd et quarantaines ne sont pas du code mort.

### Duplication : extraction limitée, après les bugs

Mesure sur **270 fichiers `.mjs`, `.js`, `.ps1` et `.sh` de `server/`, `public/` et `scripts/`**, hors tests, documentation, design, dépendances, HTML/CSS/JSON et binaires. Après retrait des lignes vides et des espaces de début/fin de ligne, les clones exacts d’au moins douze lignes et 450 caractères couvrent **359 lignes uniques dans six fichiers, 0,94 % de 38 026 lignes non blanches**. Les chevauchements ne sont pas recomptés. Cette mesure ne compte pas les ressemblances sémantiques ni toutes les petites copies et ne constitue pas une mesure générale de maintenabilité.

| Entretien | Références | Décision KISS |
| --- | --- | --- |
| Analyse syntaxique des CHECK SQL | `broadcast/store.mjs:44–82`, `reset/store.mjs:47–85`, variantes CRM/média/chat | Extraire au plus le noyau syntaxique commun si cela facilite une correction ; préserver grammaires et refus propres aux métiers. |
| Cinq recherches de configuration | `runtime-database-file.mjs:552–600` | Helper privé local possible, environ 32 lignes économisées ; conserver ancrages, `ENOENT` et erreurs métier. |
| Chiffrement des deux types de mail | `mail/crypto.mjs:16–78`, `reset/mail-crypto.mjs:16–78` | Environ 55 lignes clonées chacun. Faible priorité : préserver namespace, séparation des finalités et compatibilité ; ne pas mutualiser uniquement pour le taux de duplication. |
| En-têtes HTTP de sécurité | `index.mjs:55–62`, `auth/http.mjs:6–13` | Deux variantes intentionnelles sur les images blob ; assurer la cohérence lors de A11, sans imposer une abstraction globale. |

### Documentation et exploitation : premier gain de simplicité

`docs/PRODUCT.md` présente encore 0.42 comme actif et des fonctions actuellement livrées comme futures, sans avertissement historique suffisamment clair. `docs/DESIGN-KISS.md` pointe vers `NEXT-STEPS` comme bilan courant. Le README porte un avertissement historique, mais son entrée reste encombrée de nombreux anciens présents et compteurs. Ces documents expliquent une partie du sentiment de tourner en rond.

**Entretien recommandé :** une entrée produit courte et à jour, un seul point de reprise et des archives datées clairement signalées. Garder les preuves passées au lieu d’empiler de nouveaux états courants. L’audit lui-même est une preuve datée ; [REPRISE](REPRISE.md) reste l’entrée courante.

Les réservations média dont l’issue est incertaine restent comptées sans recyclage automatique : limite existante documentée et testée, pas nouveau bug démontré. Un nettoyage automatique sans preuve de propriété pourrait dégrader la sécurité. Les anciennes garanties de récupération autonome ne sont pas réintroduites par cet audit.

## Contrôles positifs et tests

Contrôles cohérents observés dans les chemins examinés : propriétaire et rôle, MFA/rejeu, révocation et générations de session, DTO fermés, corps bornés, SQL paramétré, chiffrement authentifié lié aux identités et finalités, transports DNS/TLS et refus SSRF, exports HTML échappés. Aucun évènement offensif réel n’a été émis pour les éprouver.

Le worker PWA n’intercepte pas `fetch` et ne conserve pas de cache privé ; notifications génériques et destinations fermées. Aucun sink HTML exécutable ni fuite PWA exploitable démontrée dans la revue front. Cela ne qualifie pas toutes les plateformes physiques ou l’exécution en arrière-plan.

| Vérification | Résultat | Limite |
| --- | --- | --- |
| Syntaxe `npm run check` | **558 fichiers, succès** | Vérifie la syntaxe, pas le comportement. |
| Suite locale complète, Node 24.19.0, concurrence 2, TMPDIR dans scratch | **3 027 tests : 2 813 réussis, 214 ignorés, zéro échec** | Plusieurs tests natifs non exécutables ici. Les comptes varient selon les sous-tests conditionnels d’environnement. |
| Première passe locale sans TMPDIR adapté | 3 erreurs `ENOENT` d’export ZIP | `/tmp` absent dans ce sandbox ; la passe complète avec TMPDIR est réussie. Aucune erreur applicative restante attribuée à ces trois cas. |
| CI du code 0.79, run main `39342025957` | **5/5 jobs réussis** : général 2 996 réussis/35 wrappers ignorés ; MariaDB 10.11 et 11.4, **436/436 chacun** ; Chrome **160** ; HTTPS/SQL **2** ; aperçu construit | Statuts/logs relus pendant l’audit ; ces jobs précèdent l’audit et ne couvrent pas automatiquement les nouveaux scénarios adverses. |
| Dépendances verrouillées `npm audit --omit=dev --json` | **0 alerte connue**, commande réussie | Référentiel npm consulté ce jour ; ne couvre ni Node intégré, ni zéro-day, ni logique applicative. |
| Dépendances directes | mariadb 3.5.4, nodemailer 10.1.1, otpauth 9.5.2, sharp 0.35.5, web-push 3.6.7 | Trois paquets extraneous observés uniquement dans le `node_modules` local ; non suivis et non démontrés présents sur l’hôte. |
| Recherche ciblée de secrets dans les fichiers suivis | Aucun jeton GitHub, identifiant AWS ou bloc de clé privée réel trouvé par les motifs utilisés | Le seul bloc PEM trouvé est une fixture TLS synthétique de test ; pas de scan exhaustif d’entropie, de binaire ou de tout l’historique Git. |
| Hôte, lecture seule | Quotas et Node relus ; **10/10 empreintes sensibles préservées** ; santé/disponibilité 200 ; API Sauvegardes anonyme 401 | Pas de GET privé authentifié, de volume SQL/média mesuré, de test de restauration ou de mesure de charge. |

Reproduction de la suite locale :

```sh
TMPDIR=/chemin/prive/temporaire node --test --test-concurrency=2 --test-timeout=90000 tests/*.test.mjs
npm run check
npm audit --omit=dev --json
```

Les tests ciblés des revues se recouvrent avec la suite générale : **leurs totaux ne sont pas additionnés**. Les synthèses machine et références de preuve sont dans [jm079-audit-20261020.json](verification-proofs/jm079-audit-20261020.json).

## Ordre de correction proposé

Les lots ci-dessous sont un ordre de traitement, pas un nouveau préalable architectural ni la réouverture de S1/S2/S3.

1. **Sécurité et comportement courant :** qualifier la mise à jour Node (A01), corriger les budgets publics (A02) et les horloges après verrous (A03/A04). Terminer chaque correctif avec ses régressions et la CI utile. Qualifier C01/C02 dans Chrome avant de les compter comme confirmés.
2. **Fiabilité des copies existantes :** aligner les volumes de bout en bout (A05), garantir la progression Windows (A07), puis définir le seuil d’avertissement et le parcours de rotation (A08). Préserver le PC, ses clés et toutes les copies existantes ; pas de nouvel appariement.
3. **Reprise et diagnostic opérateur :** rendre la copie partielle reprenable (A06), signaler les arrêts forcés (A09), puis durcir FK/HSTS (A10/A11). Données synthétiques et cible isolée uniquement pour les essais destructifs.
4. **Entretien KISS :** raccourcir les points d’entrée documentaires et retirer éventuellement le petit export inutilisé. Mutualiser uniquement quand une correction l’exige ; pas de refonte crypto, de framework de sauvegarde ou de suppression des états historiques.

Critère de fin du présent lot : inventaire, constats avec preuves/conditions, tests distingués de leurs omissions, rapport versionné et prochaine action claire. **Ce critère est atteint.** Le premier lot de corrections reste à exécuter ; aucun correctif de cet audit n’est annoncé fusionné, déployé ou vérifié en production.
