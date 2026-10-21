# JessieMessage — bilan et plan du 22 octobre 2026

## État vérifié et priorité immédiate

La messagerie est déjà en service en **1.6.0 / schéma 33**. « Passer vraiment en production » signifie ici livrer et vérifier la **version complète avec vidéo et les corrections demandées**, sans confondre sa branche de développement avec l'application active. Le socle vidéo 1.7.0 publié reste dormant ; la branche 1.8.0 a qualifié 7.1, 7.2 et 7.3a/b sur la PR 125. La suppression, la restauration et l'interface vidéo restent incomplètes.

Un correctif **1.7.1** distinct, `fix/security-entry-171`, traite la sécurité Node, l'entrée discrète, l'authentification mobile et l'accueil. Son code doit terminer sa CI avant toute livraison. La mise à jour urgente du moteur Node sur la source active 1.6.0 peut être réalisée séparément, après préparation et précontrôle ; elle n'active pas la vidéo. L'identité réellement exécutée et les reçus restent exclusivement dans REPRISE.

## Sécurité Node et PHP

L'avis officiel Node du 21 octobre publie **24.22.1** sur la branche 24, dont des corrections de gravité élevée. Le candidat conserve la branche 24 et épingle la distribution officielle, le binaire, les lanceurs et la CI. Le binaire existant et les anciens lanceurs restent conservés. Le nouveau helper prépare des copies séparées ; il ne démarre aucun service et ne modifie ni Manager ni checkpoint. Une préparation n'est pas une mise à jour active.

Pour PHP, les correctifs sont **8.2.35, 8.3.36, 8.4.27 et 8.5.12**, pour les CVE-2026-109618 et CVE-2026-109619, permettant une exécution de code à distance sans authentification. La messagerie Node n'utilise pas PHP ; le site distinct `accueil.jessiemessage.com`, également alias `www.jessiemessage.com`, dépend du PHP géré par Infomaniak. Le Manager observé affiche **8.4.26**. Son sélecteur expose la branche 8.4, pas un correctif mineur à installer manuellement. L'avis Infomaniak annonce des mesures et un déploiement centralisés, avec maintenance estimée jusqu'au 22 octobre à 03:00. L'installation complète sur ce site reste à vérifier ; le libellé « recommandée » ne la prouve pas. Aucun changement aveugle de branche PHP ni mitigation partielle présentée comme une réparation complète.

Sources : [Node](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases), [PHP](https://www.php.net/archive/2026.php#2026-10-21-1), [statut Infomaniak](https://infomaniakstatus.com/), [version PHP dans le Manager](https://www.infomaniak.com/fr/support/faq/2116/afficher-les-informations-techniques-type-phpinfo).

## Accès administrateur et confidentialité

Solution KISS retenue : **aucun choix Administration pour un visiteur sans session admin valide**, et un favori direct vers `https://jessiemessage.com/admin/login`. Une session admin déjà prouvée garde son accès normal. Le chemin reste devinable et le dépôt public contient les routes : cette discrétion n'est pas un secret ni un remplacement du mot de passe/TOTP et des droits serveur. Un chemin aléatoire, une porte cachée ou un sous-domaine supplémentaire apporteraient ici de la maintenance sans cette garantie.

Les tâches, demandes et rappels privés sont réservés à Jessie/admin dans HTTP, le service et SQL. Les capacités, historiques, profils, notifications et ZIP client ne révèlent pas leurs titres ou dates ; les sondes synthétiques vérifient aussi les URL directes et un token client présenté dans le cookie admin. L'export opérateur conserve uniquement le nombre de tâches. Aucun module de rendez-vous partagé n'existe : une date de tâche ne devient jamais un rendez-vous client. Un futur rendez-vous nécessitera un type distinct et un partage explicite.

## Authentification mobile

Cause établie : `visibilitychange` masquait le formulaire **et effaçait ses champs**, puis le retour anonyme les effaçait une seconde fois. Le correctif conserve le brouillon dans les champs DOM d'un formulaire déjà anonyme, au simple passage en arrière-plan. Le mot de passe est remasqué ; une nouvelle vérification de session précède le réaffichage. Navigation, session changée, requête en cours ou erreur continuent de nettoyer les secrets. Aucun mot de passe ou TOTP n'est ajouté à localStorage, sessionStorage, cookie ou cache. Un rechargement ou une destruction du processus par le téléphone ne peut pas conserver ce brouillon purement en mémoire.

Le parcours HTTPS/Chrome doit vérifier la conservation des valeurs et de la sélection avant la saisie du vrai TOTP. Une simulation navigateur ne certifie pas un téléphone physique ; l'aller-retour avec l'application Authenticator devra aussi être vérifié sur l'appareil utilisé.

## Accueil et expérience

Le faux aperçu de messagerie et son CSS/traductions inutiles sont supprimés. La nouvelle page garde l'identité sombre, des tons chauds, une typographie plus douce et une seule action : **« Ouvrir ma conversation »**. Le titre **« On garde le contact ? »** parle directement au visiteur. Les restrictions ne prennent plus toute la place ; invitation, adultes, contact et confidentialité restent compréhensibles. Version anglaise, clavier, petits écrans et contrastes sont contrôlés.

Les références publiques consultées mettent l'accent sur la relation avec le créateur, la conversation et une action principale claire : [Patreon](https://www.patreon.com/), [Messenger](https://about.fb.com/news/2018/10/say-hello-to-the-new-messenger-introducing-messenger-4/), [GOV.UK](https://design-system.service.gov.uk/components/button/). Ce sont des repères de conception, pas une preuve qu'une formule rendrait un public masculin dépendant ou prêt à payer. Le choix est une relation personnelle crédible, la continuité et la confiance : pas de faux message, fausse rareté, promesse de disponibilité permanente ou fausse exclusivité. Aucun effet sur la fidélisation ou les revenus n'est annoncé sans usage mesuré.

Les réponses rapides existent déjà : six phrases FR/EN proposées à l'admin puis insérées dans son brouillon avant envoi explicite. Leur personnalisation persistante, les paiements intégrés, les rendez-vous partagés, l'IA et Lovense ne sont pas des fonctions déjà implémentées. Le plan ci-dessous porte sur la messagerie convenue et les nouvelles corrections ; ajouter un de ces produits demanderait un périmètre et une estimation propres.

## Onze itérations prévues jusqu'à la version complète

**Onze résultats de travail, dont l'itération en cours ; estimation de onze à treize si les audits découvrent des corrections importantes.** Ce ne sont ni onze versions ni onze actions demandées à l'utilisateur. Les contrôles adaptés accompagnent chaque changement. La demande du 22 octobre place les validations combinées, mesures et portabilité du lot 8 **avant l'activation vidéo finale**, au lieu d'après sa livraison ; le correctif de sécurité urgent reste indépendant.

| N° | Résultat | Contrôle de fin |
| --- | --- | --- |
| 1 | Sécurité et corrections d'entrée — en cours | Node officiel et copies de lanceurs qualifiés, PHP identifié, rappels privés contrôlés, accueil/admin/auth mobile testés ; CI propre et point poussé. |
| 2 | Livraison du correctif 1.7.1 et contrôle hébergé | Source fusionnée qualifiée, tag/release, préparation et activation distinctes, identité réelle ; synchronisation de l'accueil statique distinct si nécessaire, PHP corrigé ou état fournisseur explicitement ouvert, essai Authenticator physique. |
| 3 | 7.3c — Suppression, fermeture, capacité | Reprise après interruption, originaux partagés préservés, octets remboursés après absence durable vérifiée. |
| 4 | 7.3d — Inventaire et capture | Vidéos et réservations inventoriées, fixture non vide capturée, racines/formats authentifiés explicites. |
| 5 | 7.3d — Restauration et anciens formats | Restauration isolée comparée aux empreintes/messages/droits ; interprétation des anciens formats selon leur version avant promotion SQL. |
| 6 | 7.4 — Interface vidéo complète | Sélection, aperçu, progression, annulation/réessai, lecture/seek, légende, galerie et export ; MP4 réellement décodable, contrat 32 Mio/Blob et délai HTTP adaptés. |
| 7 | 7.5 — Diffusion vidéo | Envois individuels idempotents, isolation, révocation et accusé perdu ; références partagées cohérentes avec export/suppression. |
| 8 | 8.1 — Parcours combinés et audits | Audit fonctionnel/global/sécurité ciblant authentification, ACL, données privées, fichiers, injections, dépendances et erreurs ; texte/photo/vidéo/CRM/tâches/annonces/notifications ensemble, corrections prouvées. |
| 9 | 8.2 — Capacité et optimisation utile | Mesures progressives sur une cible isolée : mémoire, concurrence, débit et délais ; corrections seulement motivées par les mesures, aucune refonte générale par principe. |
| 10 | 8.3 — Portabilité et repli | Deux transferts synthétiques comparés ; repli réellement compatible avec le schéma et les données vidéo, sans manipulation du PC témoin. |
| 11 | 7.6 — Qualification finale et activation | Diff revu, CI requises sur les sources exactes, version/tag/release cohérents, précontrôles, migration et activation consignées séparément ; smoke tests hébergés et identité active avant de déclarer la version complète en production. |

Les audits ne promettent pas l'absence absolue de faille. Une suite ignorée ou un appareil indisponible reste explicitement non vérifié. Les mêmes suites vertes ne sont pas répétées sans nouveau changement ou préoccupation. Les essais de charge, restauration et suppression restent synthétiques et isolés ; `recette` partage la production. Le chantier PC/Avast ne bloque pas ce parcours.
