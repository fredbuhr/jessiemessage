# Registre de conservation — préparation 0.41

**Registre de décision, pas politique active.** Référence : schéma 30 et `server/data/policy.mjs`. Les 29 catégories applicatives se répartissent en 22 client, cinq administrateur et deux globales. Toutes gardent `retentionDays: null` et `decisionRequired: true`. Le registre des migrations reste hors de ce catalogue. Une catégorie « administrateur » ou « globale » peut contenir des données personnelles ; cette portée décrit l’inventaire technique, pas une exemption aux droits.

Pour chaque ligne : la finalité est décrite à partir du code ; l’événement est un **candidat à décider**, sans durée adoptée. Le sort futur et les dépendances servent à préparer un protocole, sans ordre d’exécution ni autorisation de purge. Les comptes administrateur et leurs lignes associées sont inclus dans les décisions de conservation, même si l’outil `data` cible uniquement un client.

## Catégories applicatives

| Table | Portée | Finalité et données conservées | Déclencheur candidat ; durée | Sort futur et dépendances à résoudre |
| --- | --- | --- | --- | --- |
| `users` | client | Identité de compte, e-mail, pseudonyme, état, dates d’accès et hash du mot de passe ; table contenant aussi les administrateurs | Clôture, fin de relation ou inactivité à définir ; à décider | Effacement/anonymisation à définir après traitement de toutes les références ; ne pas toucher aux autres comptes |
| `invitations` | client | Admission : empreinte de jeton, créateur, validité, consommation et client consommateur | Expiration, révocation ou fin de compte ; à décider | Une invitation consommée lie consommateur et date ; conserver les contraintes et le contrôle d’admission, sans détacher une seule colonne |
| `sessions` | client | Connexion par appareil : empreinte, compte, dates, révocation ; table commune aux rôles | Expiration ou révocation ; à décider | Révoquer les seules sessions concernées avant effacement ; états client/admin et inscriptions Push dépendants ; 180 jours renouvelables ≠ délai de suppression des lignes |
| `conversations` | client | Échange privé : participants, séquences, ouverture/clôture | Clôture de la relation ; à décider | Traiter messages, événements, reçus, médias livrés, CRM et destinataires de campagnes ; préserver les autres conversations |
| `admin_mfa` | administrateur | Sécurité : facteur chiffré, version et état TOTP | Remplacement ou fin du compte administrateur ; à décider | Domaine de sécurité distinct ; aucune suppression depuis une demande client ; dépend de `users` |
| `admin_recovery_codes` | administrateur | Secours administrateur : empreintes et consommation des codes | Usage, remplacement ou fin du compte administrateur ; à décider | Préserver la sécurité du propriétaire ; aucune exportation des secrets ; dépend de `users` |
| `auth_session_state` | administrateur | Preuve MFA et dernière activité des sessions admin | Fin de session ; à décider | Lié aux sessions ; une ligne rattachée à un client serait une anomalie, pas une suppression automatique |
| `auth_rate_limits` | globale | Anti-abus : compartiments HMAC, fenêtre et compteur partagés | Début de fenêtre ; comportement de 24 h existant, politique à décider | Nettoyage opportuniste décrit ci-dessous ; pas d’attribution fiable à un client ni d’effacement global sur sa demande |
| `client_auth_state` | client | Déclaration d’âge et génération d’identifiants | Clôture du compte ; à décider | Ne prouve pas une majorité indépendante ; la génération empêche le retour de sessions anciennes ; dépend de `users` |
| `email_verifications` | client | Vérification e-mail : empreinte, dates, consommation/révocation | Expiration, consommation ou révocation ; à décider | Pas de purge générale des challenges ; traiter d’abord la file associée |
| `client_session_state` | client | Génération et activité de la session client | Fin de session ; à décider | Dépend de `sessions` ; ne pas restaurer une génération devenue invalide |
| `mail_outbox` | client | Livraison de vérification : destination/jeton chiffrés, état, tentatives et bail | Échéance ou envoi ; nettoyage de 7 j existant, politique à décider | Neutraliser les travaux et baux ; un mail déjà transmis ne peut pas être rappelé ; challenge parent conservé séparément |
| `messages` | client | Texte/légende chiffrés, empreinte, auteur, séquence, dates, tombstone | Suppression par auteur, fin de relation ou ancienneté à définir ; à décider | Le bouton retire déjà le corps vivant ; la ligne, l’empreinte et les liens restent. Traiter événements, reçus, photos et Push ; pas d’effacement des copies destinataires garanti |
| `chat_receipts` | client | Curseurs et dates de lecture des participants | Clôture/effacement de conversation ; à décider | Inclut le curseur du pair dans cet échange ; ne pas étendre à ses autres conversations |
| `chat_events` | client | Synchronisation : création/suppression, message et séquence d’événement | Fin d’utilité de synchronisation/conversation ; à décider | Dépend de `messages` et `conversations` ; continuité et reprise à préserver |
| `media_assets` | client | Bibliothèque : propriétaire, dimensions, digests, références privées, état ; octets chiffrés hors SQL | Retrait de bibliothèque, fin de relation ou ancienneté à définir ; à décider | Références de messages et campagnes, vignettes et fichiers complets ; protocole durable avant libération de capacité ; les médias admin réutilisés restent distincts |
| `message_media` | client | Association photo/message/conversation | Suppression du partage ou de conversation ; à décider | Un tombstone ne supprime pas le lien ; ne pas effacer une photo partagée ailleurs |
| `crm_profiles` | client | Organisation interne : noms/notes chiffrés liés à la conversation | Fin de relation ; à décider avant activation | Module actuellement désactivé ; analyser les données concernant le demandeur lors d’un droit d’accès, malgré leur exclusion de l’export technique |
| `crm_labels` | administrateur | Catalogue de libellés chiffrés du propriétaire | Retrait du libellé ou fin de son usage ; à décider | Module désactivé ; catalogue partagé, traiter les appartenances sans supprimer les libellés des autres clients ; examiner les libellés personnels éventuels |
| `crm_memberships` | client | Appartenance de conversation aux libellés | Retrait du libellé ou fin de relation ; à décider | Module désactivé ; dépend du libellé, de l’administrateur et de la conversation |
| `client_password_resets` | client | Récupération : empreintes de jeton/e-mail, génération, dates et état | Expiration, consommation ou révocation ; à décider | Validité de 30 min ≠ suppression ; aucune purge de ces lignes ; traiter d’abord la file sans ressusciter d’anciens identifiants |
| `password_reset_outbox` | client | Livraison reset : charge chiffrée, destinataire, tentatives et bail | Échéance ou envoi ; nettoyage de 7 j existant, politique à décider | Même précaution de mail déjà transmis ; formats de sauvegarde recovery toujours requis après création de demandes |
| `broadcast_preferences` | client | Préférence actuelle et date de mise à jour | Changement de préférence ou fin de relation ; à décider | Diffusions désactivées ; une préférence actuelle ne constitue pas à elle seule un historique complet de preuve de consentement |
| `broadcast_campaigns` | administrateur | Corps/audience chiffrés, empreinte immuable, propriétaire, médias et compteurs | Fin/annulation de campagne ; à décider avant activation | Diffusions désactivées ; le client peut figurer dans une audience partagée ; stratégie de réécriture/minimisation à concevoir, sans retirer un seul destinataire SQL |
| `broadcast_recipients` | client | Livraison individuelle : client, conversation, état et identifiants de reprise | Fin/annulation de livraison ou fin de relation ; à décider | Diffusions désactivées ; cohérence audience/compteurs et messages déjà livrés ; travaux en cours à neutraliser |
| `media_storage_state` | globale | Association du stockage, plafonds et comptabilité globale | Remplacement du stockage ; à décider | Jamais une purge de compte ; réassociation contrôlée, compteurs et réservations de tous les propriétaires à préserver |
| `media_storage_objects` | client | Journal : propriétaire, allocation, digests, références et états `reserved`/`registered`/`cleanup_pending`/`released` | Fin de réservation ou d’effacement durable ; à décider | Même `released` conserve une référence propriétaire ; fichier incertain reste compté ; synchronisation avant libération et contrôle des références |
| `push_subscriptions` | client | Notification par appareil : endpoint/clés chiffrés, rôle, session, génération, langue et état ; table commune aux rôles | Désactivation, expiration ou révocation ; à décider | Désactivation/inéligibilité ≠ effacement des lignes ; traiter les jobs ; permissions détenues par le navigateur et liées à l’origine |
| `push_outbox` | client | Notification : message/abonnement, état, échéance, tentatives et bail | Fin de job ; nettoyage terminal de 30 j existant, politique à décider | Jobs pending/sending distincts des terminaux ; pas de suppression de messages, d’abonnements ou de notifications déjà affichées par ce nettoyage |

## Comportements de nettoyage déjà présents

Ces seuils sont lus dans les stores actuels ; ils ne définissent pas une durée maximale garantie sur toute copie. L’exécution dépend du processus actif, des passes bornées et de leur succès. Désactiver un module ne crée pas de nettoyage périodique de ses anciennes lignes.

| Source | Critère réel | Limite de la passe | Ce qui reste |
| --- | --- | --- | --- |
| `server/auth/store.mjs`, `consumeRateLimit` | Début de fenêtre strictement antérieur à maintenant − 24 h | Au plus 2 000 lignes ; au plus une passe par 5 min par instance, à l’occasion d’une consommation | Compartiments récents ; pas de purge par client, ni tâche planifiée indépendante |
| `server/mail/store.mjs`, `prune` | `expires_at` ou `sent_at` strictement antérieur à maintenant − 7 j | Deux DELETE distincts, au plus 1 000 lignes chacun ; intervalle minimal de 5 min par instance | Challenges `email_verifications`, copies SMTP et sauvegardes |
| `server/reset/mail-store.mjs`, `prune` | Même critère de 7 j sur sa propre outbox | Même borne de 2 × 1 000 et intervalle minimal de 5 min | `client_password_resets`, copies SMTP et sauvegardes |
| `server/notifications/store.mjs`, `cleanup` | États `accepted`, `skipped`, `failed` et `finished_at` strictement antérieur à maintenant − 30 j | Au plus 100 lignes au total par appel | Abonnements, pending/sending, messages, affichage du système et sauvegardes |

La suppression par auteur dans `server/chat/store.mjs` met le corps à `NULL` et conserve un événement/tombstone. Le retrait de bibliothèque dans `server/media/store.mjs` refuse un média encore lié à un message vivant ; `server/media/service.mjs` gère ensuite l’effacement physique et la libération. Aucun de ces chemins n’est un exécuteur de suppression de compte.

## Copies et données hors des 29 catégories

Chaque ligne nécessite aussi un déclencheur, une durée/rotation, un responsable d’exécution et une preuve de fin de traitement. Ces durées restent à décider, même si la source SQL est supprimée.

| Ensemble | Constat et décision à préparer |
| --- | --- |
| Fichiers médias | Images normalisées et vignettes chiffrées dans le répertoire privé ; orphelins, réservations incertaines et références partagées ne doivent pas être effacés à partir d’une simple absence SQL |
| Sauvegardes SQL/médias, PC et clones isolés | Copie et restauration 0.36 acceptées avec couverture applicative limitée ; préciser toutes les copies, leur rotation, leurs accès, leur date de fin et l’invalidation des données effacées lors d’une restauration |
| Coffre et clés | Secrets séparés des données ; ne pas les effacer pour une demande individuelle puisqu’ils servent plusieurs comptes et copies ; politique de cycle de vie distincte |
| Exports complets ou partiels | Texte/photos en clair ; répertoires privés, canal protégé et vérification du manifeste ; pas de purge automatique des sorties partielles ; prévoir leur fin de vie et celle des copies remises |
| Courrier et support | Boîte `contact@jessiemessage.com`, réponses, signalements et éventuels éléments d’identité ; inventorier également les copies opérateur et les traitements du prestataire mail |
| Journaux d’exploitation et fournisseur | Le code limite les informations d’erreur ; les journaux du frontal, de Node/SQL, de SMTP, les métriques et les sauvegardes fournisseur ne sont pas couverts par l’inventaire client ; configuration et conservation exactes à vérifier |
| Navigateur/appareils | Cookies de session Secure/HttpOnly par origine, préférence FR/EN en `sessionStorage` ; le worker ne met pas les conversations en cache. Permissions, abonnements, alertes système, téléchargements et captures sont des copies distinctes ; aucune commande serveur n’en prouve l’effacement global |
| Registre des demandes et futurs journaux d’effacement | Suivi minimal, privé, avec preuve de portée et contrôle des restaurations ; aucun stockage ou schéma nouveau implémenté en 0.41 |
| Historique de migrations et déploiement | Preuve de structure et de code ; ne pas supprimer le registre pour contourner les contrôles ; aucune donnée personnelle ne doit être ajoutée aux commits ou artefacts publics |

## Sauvegardes et restauration : exigence de conception

Le choix d’une rotation de sauvegardes doit tenir compte de leur protection et d’essais de restauration. La [fiche CNIL Sauvegarder](https://www.cnil.fr/fr/securite-sauvegarder), consultée le 17 octobre 2026, recommande notamment protection comparable à la source, copie séparée et tests réguliers. Elle ne décide pas à la place du service d’un nombre de jours de conservation.

Avant une future clôture, inventorier les générations existantes et leur sort. Une restauration ancienne pourrait réintroduire un compte, des messages, un mot de passe ou une session invalidés ensuite. Concevoir un relevé privé minimal des opérations à rejouer sur copie, hors du même jeu restauré, puis vérifier les effacements et révocations avant réouverture, sans workers ni émission. Ce relevé et ce rejeu ne sont pas encore implémentés. Ne pas prétendre qu’une simple rotation résout tous les cas.

La [limitation de conservation](https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees) exige une durée ou un critère adapté à la finalité ; elle ne fournit pas un délai unique pour ces catégories. Les paramètres D04–D06 du [lot 0.41](data-privacy-preparation.md) restent ouverts. Les profils et preuves recovery du lot 0.39 restent obligatoires pour les copies contenant des demandes de récupération.
