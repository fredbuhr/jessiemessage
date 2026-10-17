# Récupération du mot de passe client — développement 0.9

**Runtime actuel :** le [lot 0.40](help-contact.md) `5ea9c40a`, activé à 19:16 le 17 octobre 2026, conserve la récupération et ajoute l’aide. Les preuves datées 0.39 et l’acceptation du mot de passe ci-dessous restent acquises.

**État courant — 17 octobre 2026 :** le [lot 0.39](client-recovery-activation.md) est activé à 18:28 sur le runtime `b651d44e`, schéma 30, profil privé `photos-notify-recovery`, récupération sur l’apex uniquement. Le propriétaire accepte le parcours essayé à 18:52:47 : « test mot de passe ok, continue ». Voir la [portée exacte de cette acceptation](client-recovery-activation.md) ; aucune nouvelle recette globale n’est demandée. Le présent guide conserve les résultats historiques 0.9 ; ses 22 migrations et son activation par environnement ne sont pas la procédure du lanceur privé actuel.

Ce lot ajoute une récupération optionnelle par e-mail. Elle reste désactivée par défaut. Elle ne crée aucun compte, ne connecte pas le client et ne renouvelle pas son accès. La [CI 0.9 vérifiée](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255) réussit ; les tests emploient exclusivement des comptes synthétiques, des adresses `example.invalid` et un transport de mail injecté. Aucun SMTP réel, déploiement, test visuel ou essai mobile sous HTTPS n'est revendiqué.

La [récupération administrateur](admin-recovery.md) reste une procédure privée distincte. Les fonctionnalités de [messagerie](private-messaging.md), [photos](private-media.md) et [CRM](private-crm.md) conservent leurs droits et leur configuration.

## Activation privée

Appliquer explicitement les 22 migrations avec le compte de migration, puis utiliser le compte MariaDB d'exécution distinct limité au DML et à la lecture du registre. Le serveur vérifie les schémas requis ; il ne crée aucune table au démarrage. Les migrations existantes `0001`–`0020` restent immuables.

| Configuration | Effet |
| --- | --- |
| `JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY` absente ou `0` | Fonction désactivée ; ses pages, assets et API ne sont pas enregistrés. |
| `JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY=1` | Exige les accès/inscriptions activés et leur configuration SMTP valide. Toute autre valeur est refusée. |
| `JESSIEMESSAGE_SITE_ORIGIN` | Origine HTTPS canonique exacte, sans chemin ni barre finale. |
| `JESSIEMESSAGE_MAIL_KEY` | Clé privée existante de 32 octets, en base64url canonique ; aucune nouvelle clé n'est ajoutée. |
| Migrations `0021`, `0022` | Challenges client et file de récupération chiffrée séparée. |

L'authentification, l'accès et la livraison de mail doivent satisfaire leur propre configuration. Chat, media et CRM sont facultatifs pour la récupération. La clé de mail conserve ses règles de séparation avec les autres clés. Le chiffrement AES-256-GCM utilise une finalité distincte `jessiemessage:password-reset-mail:v1:` et lie chaque contenu à son identifiant de job : les charges de vérification d'e-mail et de récupération ne sont pas interchangeables.

Voir la [configuration de mail](verification-mail.md), les [accès clients](invitations-client-access.md) et la [base MariaDB](DATABASE.md). Aucun secret ni fichier d'environnement rempli ne doit être ajouté à Git, aux artefacts ou aux journaux.

## Éligibilité et réponse neutre

Le compte courant doit être un client `pending` ou `active`, posséder un mot de passe, une adresse actuellement vérifiée et une version d'identifiants pouvant encore être incrémentée. Un client actif dont la période d'accès a expiré peut récupérer son mot de passe : son accès reste expiré. Un compte administrateur, inconnu, non vérifié, suspendu, révoqué ou supprimé ne reçoit pas de challenge utilisable.

Pour une requête correctement formée et non limitée, l'API répond `202 {"status":"accepted"}` indépendamment de l'existence ou de l'éligibilité du compte. Une adresse de forme canonique invalide reçoit aussi cette réponse sans mise en file. Les corps mal formés, limites et pannes conservent des erreurs fixes. Cette protection ne garantit pas une durée SQL parfaitement identique ni l'absence d'observations dans une boîte mail maîtrisée par l'utilisateur.

## Durée de vie du lien et transactions

Le jeton contient 32 octets aléatoires, encodés en 43 caractères base64url canoniques. Il expire après 30 minutes et ne peut être consommé qu'une fois. `client_password_resets` conserve son empreinte SHA-256, l'utilisateur, la version courante des identifiants et l'empreinte de l'adresse canonique. La charge `{email, token}` existe temporairement chiffrée dans `password_reset_outbox`, puis dans le message du destinataire ; le jeton n'est jamais un champ d'une réponse API.

Une nouvelle demande éligible révoque les anciens challenges encore utilisables, annule leurs jobs et crée le nouveau challenge/job dans une seule transaction. Elle ne change ni le mot de passe ni les sessions. Un échec annule la transaction entière.

La soumission du nouveau mot de passe inspecte d'abord le lien et ses conditions avant le calcul scrypt coûteux. Après le calcul, une nouvelle vérification transactionnelle exige encore la bonne version, la même adresse, un compte éligible et un jeton non expiré, consommé ou révoqué. La transaction réussie :

1. Remplace le hash de mot de passe et met à jour `users.updated_at`.
2. Incrémente une seule fois la version des identifiants client et consomme le challenge choisi.
3. Révoque les autres challenges et toutes les sessions de ce client.
4. Annule les jobs de récupération restants.

Un rejeu ou une course perdante ne modifie rien. Une connexion commencée avec l'ancien hash/version ne peut créer une session client actuelle après le changement. L'e-mail, sa preuve, la déclaration d'âge, l'assurance de majorité, l'approbation, le statut, l'échéance d'accès, les conversations, les photos et les fiches CRM restent inchangés. Une récupération ne remplace jamais la vérification d'e-mail et ne permet pas de modifier l'adresse.

Le mot de passe suit la même politique que l'inscription : entre 8 et 128 unités JavaScript, chaîne Unicode bien formée, au plus 512 octets UTF-8. Il est traité exactement, sans suppression des espaces ni normalisation Unicode, avec le scrypt et sa file bornée existants. Aucun mot de passe n'est inclus dans un e-mail.

## Parcours et limites HTTP

Le mail contient `/recover#reset=…`. Le fragment n'est pas transmis dans une requête HTTP. Le module retire le fragment et toute query de la barre d'adresse avant ses appels API et conserve le jeton uniquement en mémoire. Les routes refusent les paramètres de query ; aucun jeton n'est accepté dans un chemin, un cookie ou une query.

Charger la page ne vérifie et ne consomme aucun challenge. Le formulaire de nouveau mot de passe n'envoie le jeton qu'après validation explicite. Un rechargement sans fragment exige de reprendre le lien ou de demander un nouvel e-mail. Les mots de passe sont effacés lorsque la page est masquée ; les opérations en vol sont annulées et leurs réponses tardives ne peuvent remplacer l'état courant. Une réponse perdue permet une nouvelle tentative explicite avec le même jeton en mémoire ; aucun retry automatique n'est lancé.

| Route activée | Réponse autorisée |
| --- | --- |
| `GET` / `HEAD` `/recover`, `/recover.js`, `/recover-model.js`, `/recover.css` | Fichiers publics fixes, sans données d'identité. |
| `GET /api/access/recovery/capabilities` | Activation et bornes de mot de passe fixes. |
| `POST /api/access/recovery/request` avec `{email}` | Statut neutre `accepted`. |
| `POST /api/access/recovery/reset` avec `{token,password}` | Statut `password_changed` uniquement après succès. |

Les deux mutations exigent avant lecture du corps : Origin exacte, métadonnées de navigation compatibles, JSON et `X-Jessie-Request: 1`. Elles n'exigent pas de session préalable. Le corps est limité à 4 096 octets et cinq secondes ; les champs supplémentaires et les jetons non canoniques sont refusés. Les réponses utilisent `no-store`, `no-referrer`, les protections CSP existantes et aucun CORS ouvert. Un lien inutilisable répond `401 invalid_reset_link`, sans exposer la raison ni le compte.

Dans le lot historique 0.9, le succès effaçait le cookie `__Host-jessie_client`. Depuis le lot 0.39, cet effacement inconditionnel est supprimé afin de préserver un autre client connecté dans le même navigateur ; les sessions du client ciblé restent révoquées en SQL. Le serveur ne crée aucune session et ne touche pas au cookie administrateur. L'interface propose la connexion normale. Les erreurs ne contiennent ni e-mail, jeton, mot de passe, identifiant d'utilisateur, hash, texte SQL ou détail SMTP.

Les limites persistantes utilisent des empreintes HMAC avec une finalité propre ; ni l'adresse, ni le jeton, ni l'adresse réseau ne sont stockés en clair dans leurs buckets. Un budget global de 60 opérations/minute précède l'expansion des compteurs. Les demandes ont des budgets de 10 par réseau sur 15 minutes et 3 par adresse canonique sur 30 minutes. Les soumissions ont des budgets de 20 par réseau et 5 par jeton sur 15 minutes. Seule l'adresse du socket est utilisée : les en-têtes de proxy fournis par le client sont ignorés. Ces budgets restent à ajuster après des essais de charge et l'étude du proxy réellement déployé.

## Livraison, arrêt et conservation

Les deux files utilisent un transport SMTP TLS commun. Le worker de récupération possède sa propre finalité, ses locations et ses tentatives ; il recontrôle compte, version, adresse, échéance et état du challenge à la prise du job. Chaque worker est séquentiel, avec au plus deux envois simultanés par processus lorsque les deux sont activés. L'arrêt attend leurs deux batches actifs, ferme le transport une seule fois, puis ferme le pool MariaDB.

Les locations durent au plus deux minutes et n'excèdent pas la validité du challenge. Le nombre de tentatives est limité à huit. Les erreurs conservées sont les codes fixes `MAIL_DELIVERY_FAILED` et `PAYLOAD_INVALID`. Le `Message-ID` du même job reste stable, dans une catégorie distincte de la vérification d'e-mail.

La livraison est au moins une fois : un arrêt après acceptation SMTP mais avant validation SQL peut provoquer un doublon. Une révocation après la prise du job peut encore laisser partir un mail dont le lien est devenu inutilisable. Une acceptation SMTP ne prouve pas la réception ; ni les boîtes réelles, ni les courriers indésirables ni les quotas du fournisseur n'ont été testés ici.

La purge de la nouvelle file est bornée : au plus toutes les cinq minutes par instance, jusqu'à 1 000 jobs expirés depuis plus de sept jours et 1 000 envoyés depuis plus de sept jours. Le contenu chiffré reste présent jusqu'à cette purge. Désactiver le worker arrête aussi cette purge. Les lignes de `client_password_resets` ne sont pas encore purgées ; une conservation et une suppression contrôlées des challenges restent à réaliser.

## Vérification et travail avant publication

Les tests locaux couvrent la configuration, la neutralité des réponses, les limites opaques, la séparation cryptographique des finalités, le transport injecté, les routes et le modèle de page. Les groupes MariaDB dédiés vérifient avec des données synthétiques les contraintes, snapshots, transactions, conflits, locations et véritables parcours HTTP. Les 14 groupes de `npm run test:db` partagent le même schéma jetable et s'exécutent séquentiellement. **La [CI 0.9 vérifiée](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255) réussit ; ne pas reprendre le résultat CRM 0.8 comme validation de ce lot.**

Avant publication : vérifier SMTP et les conditions du fournisseur, tester le parcours sous HTTPS sur les appareils retenus, finaliser le contrôle de majorité et les textes de confidentialité, définir la conservation des challenges/comptes, tester une sauvegarde/restauration complète et documenter la rotation des clés avec les deux files chiffrées. La rotation et le restore ne sont pas automatisés par ce lot. Aucun compte, média ou secret réel n'est utilisé dans Git, les tests ou les artefacts publics.

## Preuve automatisée du lot

Implémentation `56827b5054511cff9a4cede91a986507da6547aa`, [PR brouillon #8](https://github.com/fredbuhr/jessiemessage/pull/8) : [CI 38655526255](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255), Node.js 24.21.0, réussie. Le contrôle général compte 461 tests réussis et 14 groupes DB explicitement ignorés sans base ; chaque version MariaDB 10.11 et 11.4 réussit ensuite 190 tests sans saut dans quatorze groupes séquentiels. Les deux nouveaux groupes comptent 19 tests de persistance/file et 12 tests HTTP. Syntaxe et build réussis. Les tests emploient uniquement des fixtures synthétiques et un transport injecté, sans preuve de livraison SMTP réelle ni recette navigateur.
