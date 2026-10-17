# JessieMessage — profil des fiches et reprise SQL/photos

## Lot 0.45

Le profil explicite `photos-notify-recovery-crm` ajoute les fiches privées au runtime primaire existant : notes chiffrées, surnoms, tags, groupes et rappels. Il conserve la récupération du mot de passe et laisse les diffusions désactivées. Le schéma reste à trente migrations ; ce lot n’en ajoute aucune.

La configuration et les outils de sauvegarde sont préparés sur une branche empilée depuis `10b049dc` (lot 0.44). Leur validation ne constitue pas une activation. Le service hébergé reste le lot 0.42 `ed78b55e` tant qu’un relevé ultérieur ne dit pas explicitement le contraire.

## Démarrage fermé

Le chargeur lit les six fichiers privés via une seule ancre de répertoire protégée et valide leur origine primaire commune ainsi que la séparation des sept clés privées, VAPID compris. Il crée une enveloppe en mémoire possédée par l’opération. Aucune clé n’est acceptée depuis une variable d’environnement héritée et aucun fichier existant n’est réécrit.

Un retour au lanceur 0.42 désactive les fiches sans supprimer leurs lignes ni leur clé. Il ne faut restaurer ni un ancien mot de passe ni un ancien état des sessions pour effectuer ce repli.

Seule la sélection de ce profil active CRM et récupération dans cette enveloppe. Les anciens chargeurs gardent leurs champs et leurs domaines autorisés. Le serveur exige aussi les options explicites `deviceTransition`, `recovery` et `crm`, avec l’origine principale. Les diffusions sont toujours refusées dans ce profil.

La commande `check` valide la configuration, les droits SQL, les schémas physiques — dont les trois tables CRM — et le stockage des photos avant tout appel de démarrage. Elle n’ouvre ni listener, ni transport de livraison, ni worker, et n’effectue aucune migration. Les contrôles de schéma sont des lectures ; ils ne déchiffrent pas toutes les notes. La sauvegarde vérifiée ci-dessous assure cette seconde vérification.

Depuis un checkout épinglé et vérifié :

```bash
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd PORT=3000 \
  node scripts/start-private-messaging.mjs check \
  --deployment primary-transition --profile photos-notify-recovery-crm \
  --private-directory /srv/customer/jessiemessage-private/primary-origin-candidate-4a355851 \
  --private-path-mode linux-dirfd
```

Le résultat attendu porte `profile: "messaging-photos-notify-recovery-crm"` et `started: false`. Remplacer `check` par `start` relève du lanceur hébergé, après les sauvegardes et leur contrôle ; ne pas lancer une deuxième application SSH à côté du service actif.

## Formats de reprise

| Profil SQL/photos | Manifeste | Reçu | Clés authentifiées |
| --- | --- | --- | --- |
| `photos-notify` | 3 | 1 | MFA, mail, messages, photos, notifications |
| `photos-notify-application` | 4 | 2 | Les mêmes cinq clés, couverture applicative explicite |
| `photos-notify-recovery` | 5 | 3 | Les mêmes cinq clés, données de récupération incluses |
| `photos-notify-recovery-application` | 6 | 4 | Récupération et couverture applicative explicites |
| `photos-notify-recovery-crm` | 7 | 5 | Les cinq clés et la clé des notes CRM |
| `photos-notify-recovery-crm-application` | 8 | 6 | Les six clés, récupération et couverture applicative explicites |

Ces versions appartiennent aux manifestes et reçus SQL/photos. Le [coffre des configurations](crm-private-configuration.md) a son propre format v5, distinct du reçu v5 ci-dessus. Les formats antérieurs conservent leur signification et refusent les domaines qu’ils ne couvrent pas. Aucun manifeste n’est simplement renommé ou réétiqueté après capture.

Le vérificateur CRM authentifie les notes avec leur administrateur, leur conversation et leur révision ; il vérifie aussi MFA, mails, messages, photos, abonnements et tâches Push, ainsi que les mails de récupération. Les tags, groupes, appartenances, rappels et versions sont inclus dans le digest de toutes les lignes SQL. Les tables de diffusion doivent rester vides, même si elles ne contiennent aucune donnée chiffrée.

La capture, le vérificateur du checkpoint, le contrôle du snapshot du clone et l’import natif acceptent tous `--profile photos-notify-recovery-crm`. Les commandes de capture applicative conservent leur couverture limitée aux trente tables de l’application : elles ne certifient pas l’absence d’objets SQL exécutables invisibles. La reprise reste limitée à une base et à un répertoire média distincts. Les contrôles n’envoient aucun mail ni Push.

Exemple de précontrôle applicatif sans saisie de mot de passe SQL :

```bash
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd \
  node scripts/private-checkpoint.mjs check-application \
  --private-directory /srv/customer/jessiemessage-private/primary-origin-candidate-4a355851 \
  --private-path-mode linux-dirfd \
  --destination-private-directory /srv/customer/jessiemessage-private/checkpoint-primary-crm-045 \
  --profile photos-notify-recovery-crm
```

Le chemin de destination doit être neuf. `check-application` prouve seulement les prérequis locaux ; `inspect-application` contrôle les tables avec les droits runtime ; `capture-application --offline` exige une source hors activité et publie le checkpoint après comparaison avant/après. Un résultat de capture conserve `independentCopyPending: true` et `sqlRestorePending: true` jusqu’aux validations réelles séparées. Suivre la [procédure applicative](application-table-checkpoint.md) pour l’arrêt coordonné, la copie indépendante et la restauration dans un clone vide, en ajoutant le profil CRM à chaque commande.

## Vérifications du lot

- Chargeur primaire : six fichiers cohérents, séparation des clés dont VAPID, refus des accesseurs et des options incomplètes, absence d’activation par les anciens profils, secrets possédés effacés.
- Démarrage : ordre configuration → SQL → schéma → stockage → démarrage ; aucune ouverture si une étape échoue. Répétition MariaDB du vrai serveur avec ses sessions existantes et des trois tables CRM absentes à tour de rôle.
- Formats : authentification des six clés, refus des clés incorrectes ou manquantes, couverture applicative conservée, refus des changements de versions/profils et des anciens formats à cinq clés.
- Outils opérateur : capture des deux variantes, archive et reçu cohérents, vérification en lecture seule de notes/récupération/Push peuplés, import transmettant le profil et refusant un reçu rétrogradé.
- MariaDB : données CRM synthétiques peuplées, notes déchiffrées après reprise du clone, labels/appartenances/versions/rappel conservés, clé incorrecte et note modifiée refusées avant nettoyage, source inchangée, sessions et tâches mail/Push préservées, reprise rejouable.

Les tests locaux et CI seront relevés avec leur source exacte après publication. Les tests SQL utilisent des bases jetables ; ils ne constituent pas une restauration native des données réelles de l’hébergement. Les captures unitaires emploient des adaptateurs SQL/dump synthétiques ; les tests de manifestes utilisent le vrai chiffrement, les tests de vérification déchiffrent de vrais ciphertexts synthétiques, et la répétition MariaDB couvre les vraies tables séparément.

## Suite hébergée

Après validation de la source exacte : préparer son checkout isolé, vérifier les cinq configurations et l’absence de remplacement de clé, puis créer exclusivement le fichier CRM si le contrôle le permet. Exécuter le préflight CRM et le précontrôle du coffre primaire à six fichiers sans démarrer le nouveau profil.

Avant activation, le propriétaire doit saisir personnellement la phrase du coffre dans sa console SSH avec saisie masquée, conserver le fichier chiffré hors de l’hébergement, comparer son empreinte et vérifier son déchiffrement. La phrase, les clés et les mots de passe ne passent ni par le chat ni par les arguments d’une commande. Le checkpoint SQL/photos courant et sa reprise isolée doivent aussi être validés avec ce profil. Les anciens coffres contenant notamment l’enrôlement administrateur restent nécessaires et sont conservés.

Le [bilan avant usage privé régulier](production-readiness-2026-10-17.md) conserve également les sauvegardes récurrentes, la copie indépendante, la surveillance avec alerte éprouvée et l’observation ciblée des deux appareils administrateur.
