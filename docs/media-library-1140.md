# Invitations et médias — évolution1.14.0

**Codé, fusionné, qualifié et publié ; installation hébergée en attente.** La version active reste1.13.0/sourceb9e2ad78, finalisée selon les reçus utilisateur. [REPRISE](REPRISE.md) donne l’identité et le checkpoint actuels. Branche `feat/media-library-1140`, base documentaire `6506b757edfa6e8843343241bc77069332e8151c` ; code de départ identique au tagv1.13.0.

## Résultat demandé

Quatre demandes regroupées en une seule version mineure compatible :

1. Une invitation nouvelle propose **Accès sans limite de durée** par défaut. Les durées finies restent un choix explicite ; la validité d’utilisation de l’invitation et les comptes existants ne sont pas modifiés.
2. La sélection des photos d’une diffusion présente de vraies miniatures, une sélection accessible et un ajout direct depuis l’appareil. Aucun ajout ou sélection de fichier n’envoie une campagne : aperçu des destinataires et confirmation restent explicites.
3. Les photos de téléphone sont préparées et adaptées automatiquement, avec conversion HEIC/HEIF locale de secours, sans demander systématiquement une copie JPEG. Réduire les refus évitables de type déclaré, dimensions, débit et envoi groupé de photos ; préserver propriété, sessions, identifiants d’envoi et reprise sans doublon. Aucun traitement externe des photos.
4. Une page **Médias**, accessible directement du dashboard, gère la bibliothèque propre à l’admin : miniatures de photos, aperçu photo/vidéo, ajout, navigation bornée et suppression explicite sous les gardes existantes. Les médias de clients ne deviennent pas des assets possédés par l’admin. Les fichiers utilisés dans des messages ou profils ne sont pas effacés à l’aveugle.

« Toutes les photos » est traité comme l’élimination des refus évitables sur les formats courants, sans promesse d’accepter un fichier corrompu ni de disposer d’une mémoire, d’un stockage ou d’un temps infinis. Les bornes implémentées et leur qualification réelle sont consignées ci-dessous. Les protections de saturation et les droits d’accès restent obligatoires.

## Choix de simplicité

- Réutiliser les API de médias, la préparation d’images, les composants d’administration et la confirmation de diffusion existants. Aucune nouvelle table ni migration prévue.
- Bibliothèque : pages remplaçables de 20 éléments, miniatures photos différées, aperçu vidéo chargé seulement après sélection. L’ajout vidéo renvoie vers le parcours d’envoi vidéo existant au lieu de dupliquer son transfert.
- HEIC : ajout de `libheif-js` **1.23.5** verrouillé ; bundle local chargé uniquement si le décodage natif échoue, dans un worker jetable et borné. La permission WebAssembly est limitée à la réponse du worker ; aucune permission `unsafe-eval` générale, CDN d’exécution, conversion distante ou nouvelle bibliothèque native sur l’hébergement.
- Les autres dépendances et Node24.22.1 restent inchangés. La dépendance HEIC supplémentaire exigera une préparation dédiée des dépendances1140 ; ne pas réutiliser à tort le `node_modules`1130 sans ce paquet.
- Les suppressions réellement exercées pendant le développement utilisent seulement des données synthétiques. Aucune modification de compte, message ou média réel, sauvegarde reportée, opération d’hébergement ou chantier juridique à ouvrir.

## Critères de qualification

| Parcours | Couverture attendue |
| --- | --- |
| Invitations | Défaut illimité au chargement, après reset/rechargement ; durée finie explicite conservée ; validité d’utilisation et contrôles backend inchangés. |
| Diffusions | Miniatures réelles FR/EN mobile/desktop ; clavier ; pagination bornée ; ajout puis choix sans campagne envoyée ; erreurs/annulation/session périmée ; sélection et brouillon conservés. |
| Photos clients | MIME vide/inexact avec signature valide ; JPEG/PNG/WebP/AVIF et HEIC courants ; grandes photos réduites ; annulation, orientation, délais/ressources ; chargeur HEIC paresseux local sous CSP réelle ; reprise seulement sur refus explicite et identités de messages stables. |
| Bibliothèque | Page/ressources admin protégées ; liens dashboard/retour de connexion ; photos et vidéos propres ; pagination ; chargement borné ; ajout, suppression explicite, refus in-use, session modifiée et réponses périmées. |
| Backend | Admission et ACL conservées ; aucun affaiblissement des suspensions/révocations/expirations ; quotas et concurrence bornés ; schéma 38 inchangé. |
| Livraison | Tests ciblés utiles, revue du diff, CI native PR puis commit main, captures inspectées, preuves exactes et omissions distinctes. Une publication ne vaut pas activation. |

Les résultats ciblés sont consignés par étape ; ils peuvent se recouper et ne sont pas additionnés en un total unique. Les scénarios Chrome décrits sont désormais attestés par la CI native finale. Téléphones physiques, Safari et photo originale problématique ne sont pas déduits des fixtures synthétiques.

## Références techniques consultées

- [Sharp : distribution précompilée et formats](https://sharp.pixelplumbing.com/install/), [HEIF/HEIC](https://sharp.pixelplumbing.com/api-output/#heif) : ne pas supposer un décodeurHEVC disponible dans les binaires actuels.
- [libheif-js : source et variantes navigateur](https://github.com/catdad-experiments/libheif-js), version1.23.5 épinglée dans package/lock. Les notices et la provenance du codec sont conservées avec l’intégration.

## Bornes implémentées et revue du candidat

Préparation locale : fichiers compressés jusqu’à 128 Mio, dimensions jusqu’à 256 MP et côté 32 768 pixels pour les formats nativement décodables ; secours HEIC jusqu’à 64 MP (plafond également posé dans le codec natif). La sortie vise 2 Mio et 2 048 pixels de côté maximal ; les validations serveur 10 Mio/16 MP restent inchangées. Les formats JPEG/PNG/WebP/AVIF sont reconnus par signature même si le type déclaré est vide/inexact ; le support HEIC dépend du contenu réellement lisible.

Dans le chat, sélection jusqu’à 50 photos, préparation sérialisée et quatre aperçus préparés au maximum ; les requêtes métier restent divisées en lots de 10 avec identifiants stables. Les budgets serveur passent à 60 uploads par compte/minute et 240 globaux/minute en conservant la concurrence 3 globale/1 par compte, le décodeur 1 + file 2 et les plafonds de stockage. Seuls les refus explicites429 portant un délai Retry-After de1à60secondes autorisent deux nouvelles tentatives au maximum ; aucune répétition d’un transfert réseau incertain ni de l’envoi d’un message.

La revue a corrigé la reprise du sélecteur natif après retour d’application, les changements de propriétaire/CSRF, le retour BFCache, l’issue incertaine d’un ajout, l’ACK de suppression suivi d’un échec de rafraîchissement, l’annulation d’une lecture de fichier cloud pendante et le réessai explicite d’une miniature échouée. Les [contrôles ciblés](verification-proofs/jm1140/development-checks.json) constituent l’étape historique avant la CI complète ci-dessous. Aucune opération de production effectuée.

## Qualification finale et couverture

Source/tag `4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd`, arbre `e5a239eaf7b8c3395a843c9e0d600efeb7aa569b`. [PR145](https://github.com/fredbuhr/jessiemessage/pull/145) puis [main](verification-proofs/jm1140/main-native.json) : **5/5 jobs**, général 4 295 tests dont 4 243 réussis et 52 omissions explicites, Chrome 296/296, HTTPS 14/14, MariaDB 613/613 sur chacune des deux versions. Les résultats ne sont pas additionnés ; les omissions ne sont pas des réussites.

La [checklist de couverture](verification-proofs/jm1140/coverage.json) distingue les assertions service/HTTP/VM, les vrais décodages Chrome et le parcours HTTPS/SQL à cinq photos avec confirmation perdue. Le navigateur bibliothèque utilise une API synthétique ; les ACL et services SQL existants sont vérifiés séparément. Aucune qualification sur un appareil client réel n’en est déduite.

Sept [captures finales](verification-proofs/jm1140/visual-native.json) ont été inspectées et conservées, ainsi que les [journaux CI synthétiques](verification-proofs/jm1140/logs.json). Les premiers échecs d’attentes de tests et le débordement de texte des miniatures sont corrigés et conservés dans les preuves. Les durées finies explicites, les droits métier et les fonctionnalités existantes restent préservés ; aucune nouvelle table, suppression de module métier ou infrastructure ajoutée.

[Publication1.14.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.14.0) et [préparateur dédié qualifié](verification-proofs/jm1140/preparation-native.json) acquis. La 1.13.0 reste active tant que les étapes personnelles du [guide1140](operations-release1140.md) ne sont pas attestées.
