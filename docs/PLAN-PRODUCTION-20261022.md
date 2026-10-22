# JessieMessage — bilan et plan du 22 octobre 2026

## État vérifié et priorité immédiate

La messagerie est en service en **1.7.1 / Node 24.22.1 / schéma 33** ; son identité réelle, les contrôles HTTP et l’alignement final des métadonnées sont confirmés dans [REPRISE](REPRISE.md). La prochaine version complète doit intégrer **la sauvegarde à la demande dans l’administration et la vidéo**, sans confondre la branche de développement avec l’application active. La décision de simplification du 22 octobre ne désactive encore aucun automatisme en service. Le socle vidéo 1.7.0 publié reste dormant ; la branche 1.8.0 a qualifié 7.1, 7.2 et 7.3a/b/c sur la PR 125. La suppression/fermeture est qualifiée ; inventaire, capture/restauration et interface vidéo restent incomplets.

Le correctif **1.7.1** est fusionné, qualifié par ses CI PR/main propres et publié sur son commit exact ; [preuves CI](verification-proofs/jm171-verification.json), [publication](verification-proofs/jm171-publication.json), [préparation Node et repli](verification-proofs/jm171-hosted-node-preparation.json), [identité hébergée](verification-proofs/jm171-hosted-identity.json). Le [reçu final de métadonnées](verification-proofs/jm171-hosted-metadata.json), `release171_metadata_recorded`, clôt la livraison sans redémarrage, avec repli 1.6.0 sur Node corrigé précontrôlé et jamais démarré, états historiques et autres blocs préservés. L’entrée discrète, l’authentification mobile et le nouvel accueil sont intégrés, sans migration SQL ni activation vidéo. L’identité et les commandes réellement utilisées restent exclusivement dans REPRISE.

## Node livré et périmètre fournisseur

L'avis officiel Node du 21 octobre publie **24.22.1** sur la branche 24, dont des corrections de gravité élevée. La version active conserve la branche 24 et épingle la distribution officielle, le binaire, les lanceurs et la CI. Le binaire précédent et les anciens lanceurs restent conservés. La préparation de copies séparées et les précontrôles sont attestés avant l’activation, elle-même identifiée dans le journal réel ; ces preuves restent distinctes. Le repli 1.6.0 a été précontrôlé sur Node 24.22.1 sans démarrage.

Le PHP du site secondaire relève d’Infomaniak. Conformément à la décision du 22 octobre, **aucune vérification ni intervention PHP n’est une action restante du projet**. L’application de messagerie utilise Node. Les observations PHP déjà consignées restent des faits historiques ; elles ne créent plus un chantier à reprendre.

Source Node de la livraison : [avis officiel](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). Les preuves hébergées et de qualification sont celles de [REPRISE](REPRISE.md).

## Accès administrateur et confidentialité

Solution KISS retenue : **aucun choix Administration pour un visiteur sans session admin valide**, et un favori direct vers `https://jessiemessage.com/admin/login`. Une session admin déjà prouvée garde son accès normal. Le chemin reste devinable et le dépôt public contient les routes : cette discrétion n'est pas un secret ni un remplacement du mot de passe/TOTP et des droits serveur. Un chemin aléatoire, une porte cachée ou un sous-domaine supplémentaire apporteraient ici de la maintenance sans cette garantie.

Les tâches, demandes et rappels privés sont réservés à Jessie/admin dans HTTP, le service et SQL. Les capacités, historiques, profils, notifications et ZIP client ne révèlent pas leurs titres ou dates ; les sondes synthétiques vérifient aussi les URL directes et un token client présenté dans le cookie admin. L'export opérateur conserve uniquement le nombre de tâches. Aucun module de rendez-vous partagé n'existe : une date de tâche ne devient jamais un rendez-vous client. Le sujet des rendez-vous partagés reste à préciser et non ouvert ; s’il est retenu, il exige un partage explicite distinct des tâches privées.

## Authentification mobile

Cause établie : `visibilitychange` masquait le formulaire **et effaçait ses champs**, puis le retour anonyme les effaçait une seconde fois. Le correctif conserve le brouillon dans les champs DOM d'un formulaire déjà anonyme, au simple passage en arrière-plan. Le mot de passe est remasqué ; une nouvelle vérification de session précède le réaffichage. Navigation, session changée, requête en cours ou erreur continuent de nettoyer les secrets. Aucun mot de passe ou TOTP n'est ajouté à localStorage, sessionStorage, cookie ou cache. Un rechargement ou une destruction du processus par le téléphone ne peut pas conserver ce brouillon purement en mémoire.

Le parcours HTTPS/Chrome a vérifié la conservation des valeurs et de la sélection avant la connexion avec un vrai TOTP. Une simulation navigateur ne certifie pas un téléphone physique ; l’aller-retour avec l’application Authenticator reste à vérifier sur l’appareil utilisé, sans nouvelle saisie de secrets demandée pour clore les tests synthétiques.

## Accueil et expérience

Le faux aperçu de messagerie et son CSS/traductions inutiles sont supprimés **de l’application Node 1.7.1**. Le principal `jessiemessage.com` et www, qui y redirige, servent cet accueil exact. **`accueil.jessiemessage.com` conserve encore l’ancienne illustration** ; [preuve secondaire](verification-proofs/jm171-secondary-entry.json). La nouvelle page garde l'identité sombre, des tons chauds, une typographie plus douce et une seule action : **« Ouvrir ma conversation »**. Le titre **« On garde le contact ? »** parle directement au visiteur. Les restrictions ne prennent plus toute la place ; invitation, adultes, contact et confidentialité restent compréhensibles. Version anglaise, clavier, petits écrans et contrastes sont contrôlés.

Les références publiques consultées mettent l'accent sur la relation avec le créateur, la conversation et une action principale claire : [Patreon](https://www.patreon.com/), [Messenger](https://about.fb.com/news/2018/10/say-hello-to-the-new-messenger-introducing-messenger-4/), [GOV.UK](https://design-system.service.gov.uk/components/button/). Ce sont des repères de conception, pas une preuve qu'une formule rendrait un public masculin dépendant ou prêt à payer. Le choix est une relation personnelle crédible, la continuité et la confiance : pas de faux message, fausse rareté, promesse de disponibilité permanente ou fausse exclusivité. Aucun effet sur la fidélisation ou les revenus n'est annoncé sans usage mesuré.

Les réponses rapides existent déjà : six phrases FR/EN proposées à l’admin puis insérées dans son brouillon avant envoi explicite. Leur personnalisation persistante reste prévue dans le prochain livrable G3. Elle n’est pas disponible actuellement.

## Plan simplifié après la décision du 22 octobre

**Abandonnés : IA, paiements carte/crypto, stickers/GIF, vocaux, réponse citée, édition, transfert de messages et épingles.** Ces sujets sortent des actions futures ; ils ne sont plus différés à arbitrer après la vidéo. Les emojis Unicode, diffusions, suppressions et exports déjà livrés restent conservés.

**Sauvegardes et archivage automatiques : abandon de l’automatisation, remplacement par une sauvegarde simple à la demande via l’administration.** Le parcours cible ne dépend pas du PC et n’ajoute aucun service. Archives, clés, autorités, reçus et fermetures locales restent préservés. La production 1.7.1 conserve encore ses mécanismes existants : le remplacement est codé sur la branche et doit être qualifié puis livré, qualifié et livré avant d’être annoncé effectif.

Le [plan global courant](PLAN-IMPLEMENTATION.md) et le [bilan de l’application](BILAN-GLOBAL-20261022.md) retiennent quatre résultats :

1. **G1 — Sauvegarde à la demande admin**, avec retrait vérifié des automatismes inutiles et préservation des gardes.
2. **G2 — Vidéo complète**, du cycle de vie et de la sauvegarde manuelle à l’interface, la lecture, la galerie et la diffusion.
3. **G3 — Réponses personnelles et qualification globale**, incluant les parcours combinés, corrections utiles, sécurité, mesures et restauration/repli sur cibles synthétiques isolées.
4. **G4 — Livraison unique vérifiée**, avec identité réelle, métadonnées, repli et contrôles hébergés.

L’ancien décompte de huit résultats vidéo puis l’estimation de six à neuf séquences sont dépassés par cette modification de portée. Aucun nouveau décompte précis n’est étayé avant le traitement des dépendances ; les sous-étapes restent des repères techniques. **À chaque étape, indiquer ce qui est fait et ce qui reste.** G1 devient la prochaine action ; les qualifications vidéo acquises sur la branche sont conservées pour G2.

**À préciser, non ouverts : Lovense, rendez-vous partagés, recherche de messages/notes, réactions et rappels privés push.** Ils ne sont pas réputés abandonnés ; aucun fournisseur, service ni chantier n’est ajouté implicitement. Les tâches privées ne sont pas des rendez-vous partagés. La personnalisation des réponses reste, elle, prévue en G3.

Authenticator physique garde sa limite de qualification. Le PHP est à la charge du fournisseur. La redirection Apache refusée reste non appliquée et **ne doit pas être retentée dans ce chantier** ; la décision de simplification ne la contourne pas. L’incident PC/Avast et le défaut du kit restent historiques et non résolus, sans recette PC à reprendre pour la sauvegarde manuelle. L’exécuteur d’archivage automatique est abandonné. Les mesures, restaurations et suppressions de qualification utilisent uniquement des cibles synthétiques isolées ; `recette` partage la production.
