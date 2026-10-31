# Invitations et médias — évolution1.14.0

**Développement en cours, ni publié ni déployé.** La version active reste1.13.0/sourceb9e2ad78, finalisée selon les reçus utilisateur. [REPRISE](REPRISE.md) donne l’identité et le checkpoint actuels. Branche `feat/media-library-1140`, base documentaire `6506b757edfa6e8843343241bc77069332e8151c` ; code de départ identique au tagv1.13.0.

## Résultat demandé

Quatre demandes regroupées en une seule version mineure compatible :

1. Une invitation nouvelle propose **Accès sans limite de durée** par défaut. Les durées finies restent un choix explicite ; la validité d’utilisation de l’invitation et les comptes existants ne sont pas modifiés.
2. La sélection des photos d’une diffusion présente de vraies miniatures, une sélection accessible et un ajout direct depuis l’appareil. Aucun ajout ou sélection de fichier n’envoie une campagne : aperçu des destinataires et confirmation restent explicites.
3. Les photos de téléphone sont préparées et adaptées automatiquement, avec conversion HEIC/HEIF locale de secours, sans demander systématiquement une copie JPEG. Réduire les refus évitables de type déclaré, dimensions, débit et envoi groupé de photos ; préserver propriété, sessions, identifiants d’envoi et reprise sans doublon. Aucun traitement externe des photos.
4. Une page **Médias**, accessible directement du dashboard, gère la bibliothèque propre à l’admin : miniatures de photos, aperçu photo/vidéo, ajout, navigation bornée et suppression explicite sous les gardes existantes. Les médias de clients ne deviennent pas des assets possédés par l’admin. Les fichiers utilisés dans des messages ou profils ne sont pas effacés à l’aveugle.

« Toutes les photos » est traité comme l’élimination des refus évitables sur les formats courants, sans promesse d’accepter un fichier corrompu ni de disposer d’une mémoire, d’un stockage ou d’un temps infinis. Les bornes techniques effectivement implémentées et qualifiées seront consignées avant publication. Les protections de saturation et les droits d’accès restent obligatoires.

## Choix de simplicité

- Réutiliser les API de médias, la préparation d’images, les composants d’administration et la confirmation de diffusion existants. Aucune nouvelle table ni migration prévue.
- Bibliothèque : pages remplaçables20éléments, miniatures photos différées, aperçu vidéo chargé seulement après sélection. L’ajout vidéo renvoie vers le parcours d’envoi vidéo existant au lieu de dupliquer son transfert.
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
| Backend | Admission et ACL conservées ; aucun affaiblissement des suspensions/révocations/expirations ; quotas et concurrence bornés ; schéma38 inchangé. |
| Livraison | Tests ciblés utiles, revue du diff, CI native PR puis commit main, captures inspectées, preuves exactes et omissions distinctes. Une publication ne vaut pas activation. |

Les résultats ciblés sont consignés par étape ; ils peuvent se recouper et ne sont pas additionnés en un total unique. Les nouveaux scénarios Chrome restent non attestés avant lecture de leur CI native. Téléphones physiques, Safari et photo originale problématique ne sont pas déduits des fixtures synthétiques.

## Références techniques consultées

- [Sharp : distribution précompilée et formats](https://sharp.pixelplumbing.com/install/), [HEIF/HEIC](https://sharp.pixelplumbing.com/api-output/#heif) : ne pas supposer un décodeurHEVC disponible dans les binaires actuels.
- [libheif-js : source et variantes navigateur](https://github.com/catdad-experiments/libheif-js), version1.23.5 épinglée dans package/lock. Les notices et la provenance du codec sont conservées avec l’intégration.
