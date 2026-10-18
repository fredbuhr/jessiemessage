# JessieMessage — vérification locale des sauvegardes 0.56

## Copie réelle acquise

Lecture technique du runtime 0.55 le **18 octobre 2026 à 15:57:53.689 UTC** : destination Mon PC raccordée à **15:49:46.459**, dernier contact et reçu à **15:50:47.747**. Le reçu correspond exactement à la dernière archive disponible : `capture-1792300533262-3ae62972be4d93f5`, **402 792 octets**, SHA-256 `dbd63e6d1a7d91b0f9372a062a761d5e92a4b3abb9dd9a44ddbcdd330d983578`. Deux archives au catalogue, quatre enregistrements au journal ; dernière capture réussie à 05:15:39.807 UTC, aucun incident actif et aucune alerte en attente. Cette lecture ne certifie pas encore un deuxième passage automatique ni le déchiffrement.

## Parcours proposé

Dans **Administration → Sauvegardes → Vérifier le déchiffrement sur le PC**, télécharger la vérification Windows. Extraire tout le ZIP, puis ouvrir **Verifier.cmd**. Choisir le fichier chiffré indiqué dans la fenêtre. Le dossier existant `Downloads\JessieMessage-recuperation-052` est proposé ; le bouton Changer permet de sélectionner le trousseau s'il a été déplacé. La clé n'est ni recréée ni exportée. Si nécessaire, GPG ouvre son propre Pinentry pour la phrase, exclusivement sur le PC.

Le succès affiche **DECHIFFREMENT_VERIFIE**. Il concerne l'archive indiquée dans ce kit. Aucune donnée n'est restaurée dans l'application, aucun résultat n'est transmis automatiquement. Le propriétaire doit constater ce message pour clore le déchiffrement personnel. L'état serveur `decryptionStatus: not_checked` demeure exact : un téléchargement ou un reçu de copie ne vaut pas déchiffrement.

## Contrôles

Le kit ZIP contient quatre fichiers fixes : lanceur, script PowerShell 5.1, métadonnées fermées et courte notice. Il ne contient aucun jeton, clé, secret administrateur, identifiant de destination ou chemin serveur. Sa durée n'est pas limitée puisqu'il ne délègue aucun droit. Ses empreintes concernent la capture choisie lors du clic ; retélécharger pour une nouvelle capture.

Le nouveau POST `/api/admin/backups/verification-kit` reste réservé à l'origine primaire, avec session administrateur, Origin, CSRF, JSON borné et champs fermés. Le corps contient uniquement `captureId`. Une deuxième preuve serveur de la même session précède l'envoi du ZIP ; le navigateur vérifie également l'identité avant et après la requête. Une réponse devenue obsolète ne crée pas de téléchargement et la requête n'est pas rejouée.

Le catalogue n'exporte ces métadonnées qu'à partir d'une capture réussie au journal et d'un reçu de chiffrement valide, épinglé au destinataire public configuré. Il conserve les contrôles de descripteurs Linux, de propriétaire, de modes 0700/0600 et d'identité des fichiers. Le manifeste du collecteur demeure limité au chiffré ; l'empreinte du contenu clair est réservée au kit administrateur.

Le vérificateur Windows contrôle les chemins sans jonction, le format fermé et les tailles bornées. Il garde un handle en lecture interdisant écriture et suppression de la copie pendant le contrôle. Les octets chiffrés sont hachés avant et après GPG. La sortie binaire de GPG passe directement dans SHA-256, par blocs effacés en mémoire, sans fichier déchiffré. Le nombre d'octets et l'empreinte doivent correspondre au reçu source. Le code de sortie, `DECRYPTION_OKAY`, la clé primaire de `DECRYPTION_KEY` et la protection AES-256/MDC ou OCB sont aussi contrôlés. Les diagnostics sont bornés à 16 Kio et restent locaux ; l'opération GPG a une limite de dix minutes et peut être annulée sans bloquer la fenêtre. Les détails GPG ne sont pas affichés dans le message d'échec.

Références primaires : [interface de statut GnuPG](https://github.com/gpg/gnupg/blob/master/doc/DETAILS) et [manuel GPG 2.4](https://www.gnupg.org/documentation/manuals/gnupg24/gpg.1.html). Aucun choix de phrase ou de mode Pinentry loopback n'est ajouté au parcours propriétaire.

## Validation et activation

Les tests couvrent le catalogue, le ZIP réel, l'authentification et sa révocation pendant préparation, les champs et tailles fermés, ainsi que le téléchargement clavier en FR/EN à trois largeurs. Windows exerce un vrai GPG avec une clé synthétique jetable et des octets binaires, le job asynchrone, l'absence de fichier clair, les mauvais hashes/clés/protections, la corruption, l'annulation et les processus trop lents ou bavards. Aucun essai n'utilise une sauvegarde ou clé personnelle. Les résultats exacts de CI et d'activation sont à consigner après validation de la source.

Le collecteur 0.55 déjà installé reste compatible. Aucun format persistant, schéma SQL, clé, règle de session ou horaire de capture n'est modifié. Le repli applicatif peut reprendre la source 0.55 et ses mêmes états de copie. La restauration native d'une capture contenant les campagnes reste une preuve distincte ; les décisions de conservation et de données restent ouvertes.
