# Transport vidéo privé — Évolution 6, socle 1.7.0

Le lot 6 prépare le transport des vidéos, séparément des photos. Il fournit stockage chiffré incrémental, admission privée et HTTP avec lecture partielle. **Le socle est dormant : aucune route vidéo n'est enregistrée par le serveur normal, aucune donnée vidéo n'est créée sur l'hébergement et le produit en production reste la 1.6.0.** La version 1.7.0 identifie cette nouvelle capacité de code compatible ; elle ne désigne pas une activation utilisateur.

## Périmètre et critère de fin

Les parcours synthétiques exercent le véritable handler HTTP, le service et les fichiers chiffrés privés : téléversement avec capacité réservée, lecture entière ou partielle, refus intercompte, authentification révoquée, erreurs et interruptions. Le transport traite des blocs bornés et respecte la contre-pression du disque et du réseau. Il ne charge pas une vidéo entière en mémoire.

La composition de production et le SQL ne changent pas. Les tables et inventaires photos supposent deux JPEG et une surcharge de 80 octets ; les y faire entrer rendrait les contrôles existants invalides. Le lot 7 intégrera catalogue durable, cycle de vie complet et interface ensemble, avant toute activation. Aucun nouveau service, paquet, secret ou outil de transcodage n'est installé sur l'hébergement pour ce socle.

## Contrat de transport

| Élément | Contrat du socle |
| --- | --- |
| Entrée | Corps binaire `video/mp4`, taille totale connue de 1 à 104 857 600 octets (100 Mio), sans compression HTTP. |
| Inspection | Au plus 64 Kio : premier atom `ftyp` complet, taille 32/64 bits bornée, marque principale MP4 reconnue ; MOV/QuickTime et M4A refusés. |
| Limite de validation | L'inspection du conteneur ne prouve ni présence d'une piste vidéo, ni décodage, codecs, durée, métadonnées ou lecture progressive. Les fixtures sont synthétiques. |
| Écriture | Un bloc clair de 256 Kio, chiffrement immédiat vers un temporaire privé ; publication exclusive après réception exacte et synchronisation. Aucun temporaire clair. |
| Lecture | Un intervalle `bytes` à la fois sur GET : entier 200, partiel 206, non satisfaisable/multiple/malformé 416. Bornes ouvertes, suffixes et fin au-delà du fichier sont traités. Une unité inconnue est ignorée ; les unités sont insensibles à la casse. |
| HEAD / If-Range | HEAD ignore Range et renvoie les en-têtes de la ressource entière, sans lire les blocs. Un `If-Range` entraîne une réponse entière : aucun validateur ETag n'est annoncé. |
| Confidentialité HTTP | Cookies de rôle, Origin/CSRF pour mutation, autorisation courante avant lecture du corps ou accès fichier ; no-store, nosniff, CORP same-origin et nom fixe `video.mp4`. |
| Budgets | Deux téléversements et quatre lectures dans le processus, également partagés entre instances ; un téléversement et deux lectures par propriétaire au service. Budgets persistants par compte et globaux avant transfert. |
| Délais | Téléversement total 5 minutes ; lecture totale 5 minutes et inactivité 30 secondes. La source HTTP observe le signal d'annulation et ne fournit que des blocs de 64 Kio maximum. |

Les routes du handler injecté sont `POST /api/video/{admin|client}/assets` et `GET/HEAD /api/video/{admin|client}/assets/{id}/content`. Elles restent absentes du runtime normal. Les paramètres inconnus sont refusés ; aucune identité de propriétaire ou clé de stockage n'est acceptée depuis le client. Le service fournit seulement `{id, bytes, mime}` après succès. Une URL propriétaire n'autorise jamais l'autre partie de la conversation ; les liens par message et leurs ACL appartiennent au lot 7.

Référence du traitement Range/HEAD : [RFC 9110, section 14.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.2).

Une erreur après le début d'une réponse détruit le transfert ; elle n'ajoute pas de JSON à une vidéo partielle. La fermeture du socket annule le travail coopératif et les descripteurs sont fermés ; le créneau n'est libéré qu'après la fin de l'opération et de son nettoyage. Les adapters et sources injectés doivent observer l'annulation et terminer leurs opérations ; le socle ne peut interrompre de force une transaction ou un producteur arbitraire bloqué.

## Enveloppe chiffrée indépendante

`JMVIDv1\0` est un format distinct de `JMIMGv1`. Son en-tête brut de 32 octets contient magic, taille des blocs (4), taille claire totale (8) et sel aléatoire (12), suivi d'un tag GCM de 16 octets. Chaque bloc clair de 256 Kio au maximum est suivi de son propre tag de 16 octets. La charge exacte est `48 + taille + 16 × ceil(taille / 262144)` ; le contrat d'enveloppe reste version 1, distinct de SemVer.

La clé de fichier est dérivée par HMAC-SHA256 de la clé explicite, d'un domaine vidéo, des identifiants asset/stockage et du sel. Chaque nonce GCM utilise huit octets du sel et un index 32 bits ; l'index `ffffffff` est réservé au tag de l'en-tête. L'AAD lie domaine, identifiants, en-tête et index. Le lecteur authentifie l'en-tête et la taille physique, puis chaque bloc requis **avant** d'en émettre le clair ; les autres blocs ne sont pas déchiffrés pour un Range. Une lecture partielle ne constitue pas une vérification intégrale des blocs non lus.

La racine dédiée doit exister en `0700`, hors checkout, avec des ancêtres contrôlés. Fichiers `0600`, publication par lien exclusif, refus des liens symboliques/durs, dérive de permissions et remplacement de racine. Le mode Linux dirfd reprend les ancêtres épinglés de l'application et conserve ses descripteurs pendant les flux ; le mode strict conserve les contrôles portables existants. Le serveur déchiffre les lectures autorisées ; ce n'est pas du chiffrement de bout en bout.

## Capacité et accusés incertains

`createVideoService` exige un catalogue injecté avec `reserve`, `commit`, `getOwned` et `release`, ainsi que l'autorisation actuelle et les budgets persistants. **Aucun adapter SQL de production n'est fourni par ce lot.** Celui des tests est expressément en mémoire ; il ne démontre pas l'isolation SQL ou la reprise durable.

L'adapter futur doit réserver les octets chiffrés avant écriture et vérifier session, rôle, propriétaire, accès et état du compte dans chaque transaction pertinente. La lecture exige un objet enregistré, vivant et appartenant à l'acteur. La fin du téléversement recontrôle l'acteur puis enregistre les métadonnées. Une révocation ne rappelle pas les octets d'un transfert déjà autorisé.

Une réponse perdue après réservation, publication ou commit garde la charge et les fichiers dont l'état est incertain. Un remboursement après échec d'écriture exige une preuve explicite d'absence de publication **et** de nettoyage durable du temporaire de cet appel. L'abandon d'un ticket encore en attente n'a démarré aucune écriture et peut libérer sa réservation. Le service ne supprime jamais un objet enregistré pour compenser une réponse HTTP perdue. Le catalogue et le parcours de réconciliation avant activation sont à terminer au lot 7.

## Qualification et suite

Les tests dédiés couvrent conteneurs, cryptographie, substitution et altération de blocs, bornes et tailles exactes, chemins privés, nettoyage, lecture HTTP, refus d'accès, interruptions, créneaux et contre-pression. Les preuves exactes et liens de CI seront consignés avec le commit qualifié. Un test omis faute de procfs local reste une omission jusqu'à son exécution Linux en CI.

L'activation attend le lot 7 : catalogue/capacité SQL et migrations compatibles, aperçu/lecteur/légende/galerie/diffusion, export sans chargement intégral, suppression et fermeture, capture/restauration/inventaire du nouveau format, politique de conteneur et codecs, et composition HTTP avec un délai global adapté. Le `requestTimeout` existant de 35 secondes ne doit pas être conservé tel quel en branchant le handler vidéo.

Aucun débit du mutualisé, téléphone réel, vidéo décodable, transfert de 100 Mio sur mobile, restauration vidéo ou fonctionnement PC n'est déduit de ces tests. Les lots 7 et 8 restent séparés. Aucune commande hébergée n'est nécessaire pour conserver un socle dormant ; les pins Run/Build, le checkpoint et le repli 1.5.1 de la production 1.6.0 restent ceux de [REPRISE](REPRISE.md).
