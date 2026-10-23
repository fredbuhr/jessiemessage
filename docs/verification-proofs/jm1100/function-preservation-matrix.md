# Conservation fonctionnelle 1.9.0 → 1.10.0

Sources : `5dda0dd4453d34a0be839d2a1402301dea835381` / arbre `f06a140e738f20994425c714a278b0646f651c1b` → source publiée `51b0cf22e3adbad7ed26653e96706ba707aaf839` / arbre `190024a2f30258554e4a18ff6ae18e2be08c8d7b`. Audit en lecture seule ; aucun test relancé, aucune opération hébergée.

Aucune perte métier accidentelle identifiée dans ce périmètre. 339 des348 fichiers de production hérités sont identiques ;9 modifiés et10 ajoutés ; aucun supprimé. Les9 modifications ont été relues en détail. Catalogue,38 migrations, dépendances, scripts npm et fonctionnalités de repli restent inchangés hors numéro de version.

Les5 journaux complets main39991790308 sont revérifiés (octets, SHA256, totaux) : général4026 réussis/52 exclus sur4078 ; Chrome256/256 ; HTTPS12/12 ; MariaDB10.11 et11.4 chacune598/598 ; zéro échec/annulation. Les52 exclusions générales restent explicites ; les4 jobs natifs ont zéro exclusion.

| Métier | Conservation du code hérité | Preuve native existante |
|---|---|---|
| Invitations et accès client | 9/9 fichiers identiques | mariadb1011.log:524 — real HTTP invitation, encrypted verification mail and gated client access (synthetic disposable database only) |
| Authentification, MFA et sessions | 11/11 fichiers identiques | https.log:284 — real Chrome + MariaDB: HTTPS administrator MFA, protected cookie, revocation, expiry and recovery replay |
| Récupération et changement de mot de passe | 15/15 fichiers identiques | https.log:295 — client password change retains current browser and ciphertext, revokes old device/reset link, and preserves photo reads |
| Conversation privée, historique et suppression | 13/16 fichiers identiques; raccordement/cycle relu | mariadb1011.log:1778 — real HTTP private chat, ciphertext, receipts, deletion and live authorization (synthetic disposable database only) |
| Brouillon texte et reprise explicite | 1/2 fichiers identiques; raccordement/cycle relu | browser.log:273 — Chrome: real same-tab reload restores only the authorized text draft and a changed session purges it |
| Photos privées | 14/14 fichiers identiques | mariadb1011.log:2785 — real HTTP private media uses normalized encrypted files and current delivery authorization (synthetic disposable fixtures only) |
| Vidéos réservées administratrice | 14/15 fichiers identiques; raccordement/cycle relu | https.log:308 — real HTTPS SQL36 runtime: admin-only H264 upload, client refusal, two-role decode/seek, idempotent replay and gallery |
| Galerie et retour au message | 15/16 fichiers identiques; raccordement/cycle relu | browser.log:277 — Chrome photo viewer crosses unloaded history, preserves scroll and finds an old month/message |
| Sélection et envoi de plusieurs photos | 15/16 fichiers identiques; raccordement/cycle relu | browser.log:278 — Chrome multiple photos preview before one send and retry only a failed item |
| Profil privé, pseudonyme et avatar | 4/6 fichiers identiques; raccordement/cycle relu | https.log:300 — real HTTPS/SQL profiles: both roles persist names and avatars, foreign reads fail and removed URLs cannot resurrect |
| Émojis | 2/3 fichiers identiques; raccordement/cycle relu | browser.log:232 — Chrome 320px: keyboard emoji panel inserts at the selection without photos or automatic sending, and Escape restores focus |
| Lecture et badges privés | 11/13 fichiers identiques; raccordement/cycle relu | browser.log:228 — Chrome: only Jessie sees a read receipt after a metadata-only poll, with stable focus and French / English labels |
| Téléchargement et export client | 7/7 fichiers identiques | mariadb1011.log:3990 — real HTTP conversation ZIP streams isolate video deliveries and authenticate GCM before a valid ZIP footer |
| CRM et groupes privés | 9/9 fichiers identiques | mariadb1011.log:2045 — real HTTP private CRM, encrypted notes, scoped labels and current authorization (synthetic disposable database only) |
| Diffusions et annonces | 23/23 fichiers identiques | mariadb1011.log:1530 — real MariaDB: 2,500-client audience is bounded, atomic, retryable and resumes without duplicate messages |
| Tâches privées | 10/10 fichiers identiques | mariadb1011.log:3800 — real MariaDB private tasks persist, retry, page and serialize simultaneous administrators |
| Réponses rapides et personnelles | 5/5 fichiers identiques | browser.log:269 — Chrome 320px fr: personal replies join the preset list, persist between sessions and CAS conflicts preserve both catalogue and draft |
| Suivi « À répondre » | 10/11 fichiers identiques; raccordement/cycle relu | mariadb1011.log:3509 — real SQL reply task tracks incoming, concurrent replies, broadcasts, historical requests and two sessions |
| Goûts et fantasmes privés | 11/12 fichiers identiques; raccordement/cycle relu | mariadb1011.log:3264 — real MariaDB preferences: owner-only encrypted selections, cross-device CAS, authorised peer view and safe clearing |
| Notifications et liens profonds | 12/12 fichiers identiques | mariadb1011.log:3190 — real MariaDB private notification transactions (synthetic disposable database only) |
| Sauvegarde manuelle et restauration existantes | 68/68 fichiers identiques | mariadb1011.log:1295 — offline backup restores a separate real MariaDB schema and private encrypted root without changing its source (synthetic fixtures only) |
| Fermetures définitives et cycle des données | 24/24 fichiers identiques | mariadb1011.log:845 — durable account erasure removes the selected graph and actual encrypted files, with peers intact (disposable MariaDB only) |
| Nouveau profil public de Jessie | 0/4 fichiers identiques; raccordement/cycle relu | https.log:292 — public Jessie profile is an explicit admin snapshot; temporary hiding preserves the private draft after actual session proof |
| Brouillon profil après changement de fenêtre | 0/3 fichiers identiques; raccordement/cycle relu | browser.log:280 — Chrome 320px: profile preference draft resumes after same-owner verification and is discarded for a replaced session |

Changement voulu : le masquage temporaire conserve le brouillon du même propriétaire en mémoire ; fermeture explicite, rechargement/pagehide, déconnexion et changement de compte l’effacent. Les champs mot de passe restent effacés à la suspension. Aucun POST incertain n’est rejoué automatiquement.

Un seul ancien intitulé de test change : effacement au masquage remplacé par conservation demandée, avec contrôle de propriétaire. Aucun fichier de test supprimé ;22 intitulés ajoutés contre1 remplacé. La CI ne perd aucun job/commande.

Limites : aucun téléphone physique, Push OS, essai DST ou nouvelle recette fonctionnelle hébergée. La sauvegarde hébergée reste reportée. Le nouveau snapshot public est hors manifeste historique (documenté, republiable) ; aucune ancienne donnée sauvegardée n’est retirée.

Incohérence documentaire signalée : PRODUCT affirme encore1.8.4/SQL36 au début (et1.8.3 actif en fin), alors que1.9.0/SQL38 est déployée selon les reçus utilisateur/REPRISE. Cela ne correspond pas à un recul du code.

Détails, inventaires Git par fichier/module, empreintes et24 lignes de couverture : `function-preservation.json`.
