# Recette de la messagerie — 0.79

**20 octobre 2026 Europe/Paris : S3 clos techniquement, fusionné/vérifié en CI candidat et main ; non déployé.** Source `2342f749d59222104a3d6458c2617aa9f63ba69c`, arbre `39ac4fdabc55b7661742fbd6acc5763d65a42dab`, [PR #101](https://github.com/fredbuhr/jessiemessage/pull/101), merge `bc6103a73ce63752eda27a0bce83a7e53e409d09` de même arbre. [CI candidat 39341320771](https://github.com/fredbuhr/jessiemessage/actions/runs/39341320771) : cinq contrôles réussis, 2 996 tests généraux réussis / 35 wrappers SQL ignorés / zéro échec, 436/436 sur chaque MariaDB sans omission, Chrome 160, recettes HTTPS 2, syntaxe 558 et aperçu construit. [CI main 39342025957](https://github.com/fredbuhr/jessiemessage/actions/runs/39342025957) également cinq contrôles réussis, mêmes résultats et arbre identique au candidat. [Preuves structurées](verification-proofs/jm079-verification.json). Le service en ligne reste **0.76.0**, fermetures désactivées ; [REPRISE](REPRISE.md) donne ses pins et les preuves déployées.

## Exercice ajouté sur le vrai parcours applicatif

`tests/rehearsal/messaging.rehearsal.mjs` utilise le serveur applicatif, une MariaDB jetable explicitement autorisée, le stockage média et trois sessions WebDriver indépendantes : deux connexions du même client, aux largeurs 390 et 1 280 pixels, puis une connexion administrateur. HTTPS utilise un certificat local de fixture accepté par ces navigateurs ; ce n'est pas une observation du site de production.

Les assertions ajoutées portent sur :

- deux cookies clients distincts, `Secure`, `HttpOnly`, `SameSite=Strict`, conservés après rechargement ;
- un message administrateur reçu par les deux sessions via le vrai polling, sans remplacer le texte non envoyé sur la première ;
- le choix, l'envoi, le stockage, le téléchargement autorisé et le décodage d'une photo JPEG avec légende dans les trois sessions ;
- le brouillon conservé pendant une séquence DOM contrôlée de masquage/retour et lors de l'ouverture d'une référence de notification dans le même document ;
- la déconnexion du premier navigateur, son cookie retiré et son accès refusé, tandis que le second conserve sa session et peut encore répondre ;
- la reconnexion depuis un lien de notification vers la photo exacte, malgré un message plus récent ; le brouillon de l'ancienne connexion reste effacé après déconnexion.

Un abonnement synthétique est enregistré par l'API authentifiée et une référence réelle de notification est résolue par le service. Les travailleurs de livraison sont arrêtés avant l'exercice : aucune permission Push, livraison par un fournisseur, alerte système ou émission SMTP n'est utilisée. Le compte client et son admission sont préparés en SQL ; ce scénario ne teste pas l'inscription ni la vérification e-mail. `npm run test:auth-browser` rassemble cette recette et l'exercice d'authentification existant ; le job CI dédié les exécute sur sa MariaDB 10.11 isolée.

**Portée : trois contextes Chrome, pas trois appareils physiques.** Une largeur de téléphone ne prouve pas Safari/iOS, Android, une installation PWA, une mise en arrière-plan par le système ou une notification reçue application fermée. La séquence de visibilité est pilotée dans le DOM. Les acceptations personnelles antérieures restent acquises dans leur portée, sans demander de les répéter ni les étendre à toutes les plateformes ([relevé des appareils](notifications-device-acceptance.md)).

## Confidentialité : afficher la capacité réellement activée

Le service de préparation reçoit le booléen `accountClosures` du runtime. Sa réponse donne `permanentClosure:not_enabled` ou `administrator_local` ; le brouillon enregistré ne décide pas de cette capacité. L'écran et sa traduction FR/EN affichent soit l'absence d'activation, soit le chemin **Fermetures de comptes** dans l'administration. Les tests de service couvrent les deux capacités ; le test Chrome vérifie les textes et le changement de langue à partir d'une fixture HTTP.

Le choix accepté reste **conversation conservée jusqu'à la fermeture définitive**, hors suppressions volontaires. Une déconnexion, une expiration ou une suspension ne ferme pas le compte. Ce changement d'affichage n'active pas les fermetures : le service 0.76 reste inchangé et les moteurs S2 restent acquis en code/CI, non déployés. Sources : `server/privacy/service.mjs`, `server/index.mjs`, `public/privacy.js` et `tests/browser/privacy-preparation.browser.mjs`.

## Guide, conservation et surveillance

Le [guide quotidien de Jessie](guide-jessie.md) rassemble les chemins utiles : messages/photos, fiches et conflits, notifications par appareil, export ZIP, copies PC et fermeture explicite après activation. Les brouillons de message et modifications non enregistrées restent dans la page ouverte ; les exports téléchargés sont des copies lisibles distinctes. Fiches/conflits, réponses rapides et export gardent leurs tests existants séparés ; ils ne font pas partie du nouveau scénario HTTPS/MariaDB.

Le [registre de conservation](data-retention-register.md) distingue le critère produit acquis, les nettoyages techniques bornés existants et les durées encore non adoptées. Le catalogue historique conserve `retentionDecided:false`. **Aucune rotation automatique des archives serveur/PC ni durée de trente jours n'est adoptée.** Les reçus de fermeture doivent couvrir toutes les archives encore restaurables ; ce lot n'effectue aucune purge.

La [surveillance existante](../MONITORING.md) est conservée. Le [relevé en lecture seule du 20 octobre](verification-proofs/jm079-monitor-observation.json), observé le 19 octobre à **23:15:37.195 UTC**, consigne douze runs `schedule` réussis. Le dernier contrôle, run `39339574058`, est sain à **23:07:44.330 UTC** : deux sondes, premier passage, 759 ms. Les intervalles entre lancements relevés vont de **1 h 54 min 18 s à 7 h 12 min 12 s** : le cron demandé de cinq minutes ne donne pas de délai maximal de détection. Le canal et la réception d'une alerte externe restent non vérifiés. La réception déjà confirmée des deux mails locaux de sauvegarde ne couvre pas une panne complète de l'hébergement ; aucun nouveau mail ou arrêt du site n'a été provoqué.

## État de livraison

Le candidat, la fusion et la CI main sont acquis. S3 est clos techniquement ; la prochaine action est le déploiement final validé sur le mutualisé. Le premier candidat omettait la conversation du compte synthétique : la fixture reprend maintenant la transaction réelle d’approbation, sans changer le produit ni augmenter les délais. Les limites physiques et de surveillance déclarées ne demandent aucun nouvel essai personnel pour clore ce lot technique. Le déploiement final et l’activation explicite des fermetures restent distincts. Aucun effacement de compte réel, restauration de production, nouveau test PC ou nouveau sous-lot de sauvegarde n'est revendiqué par cette recette.
