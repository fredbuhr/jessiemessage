# Audit frontend/backend avant la mise à jour1.11.2 — 25 octobre2026

**Audit terminé : GO technique pour l’unique mise à jour 1.11.2. PR et main qualifiés, publication immuable acquise, captures inspectées. Préparation et CHECK hébergés acquis selon le reçu utilisateur ; dernière production confirmée1.11.1.** Les corrections sont regroupées dans une seule version applicative ; activation et enregistrement final1112 restent à observer.

La production de référence reste1.11.1, source `80b7fbf5f9b5ba32ac1aae817043126e93025946`, arbre `ba1289bae9ce095560922a7ed6665f17709d07ed`, Node24.22.1 et checkpoint privé `41a51d38a50c3ff07b1878a6cfd96de9e383dbafc5ccff9c96a3a97aa272d90a`, acquis selon le reçu utilisateur. Le point de départ documentaire main39e0d134 a pour arbre7f0541c6573c3c75f815d360d4f00a9db37504c4 ; le parent local65236ce6 a exactement le même arbre. Cette différence de SHA liée à la copie de travail ne représente pas une perte de code.

## Méthode et checklist

La [checklist détaillée](verification-proofs/jm1112/audit-checklist.json) contient **171 contrôles dans24domaines**. Elle complète l’audit historique134points, les contre-revues précédentes et leurs limites. Inventaire actuel :119fichiersfrontend,241backend,56scripts,33migrations normales,430fichiers de tests et3workflows. Tous les chemins frontend/backend sont rattachés à un domaine ; aucun module n’est omis de la grille.

La méthode combine inventaire, relecture fraîche des frontières HTTP, autorisations, services, chemins transactionnels/fichiers et changements réels, contrôles structurels, puis suites complètes sur le SHA candidat. **Le nombre de fichiers inventoriés ne prétend pas que chaque ligne a été relue intégralement.** Les domaines inchangés sont examinés par leurs contrats, gardes et tests ; les modifications sont relues dans leur diff. Les essais utilisent uniquement des comptes, contenus, bases et médias synthétiques isolés.

| Domaine | Contrôles |
| --- | ---: |
| Reprise et versionnage | 6 |
| Navigation, chargements et responsive | 7 |
| Accessibilité et langues | 7 |
| Authentification et appareils | 7 |
| Invitations, codes et admission | 8 |
| Changement de mot de passe | 6 |
| Origines, entrée et transition | 6 |
| Messagerie et cohérence | 10 |
| Profils privés et préférences | 9 |
| Profil public de Jessie | 9 |
| Photos et bibliothèque | 8 |
| Vidéos | 7 |
| Fiches et organisation clients | 7 |
| Réponses, suivi et tâches | 6 |
| Diffusions et annonces | 7 |
| Notifications et PWA | 7 |
| Frontière HTTP et disponibilité | 8 |
| Base, transactions et migrations | 7 |
| Fichiers et chiffrement | 6 |
| Export, fermeture et restauration | 8 |
| Configuration et exploitation | 7 |
| Dépendances et chaîne de livraison | 6 |
| Accueil, aide et contrôles communs | 6 |
| Revue finale de couverture et livraison | 6 |

## Corrections regroupées

| Constat | Correction et vérification |
| --- | --- |
| Le bootstrap et la reprise mobile pouvaient masquer la zone privée puis effacer son message d’attente. | Coquille neutre visible, état de chargement/erreur et reprise explicite ; capacités indépendantes chargées ensemble ; retour arrière revalidé sans reload forcé. Aucun cache privé ajouté. |
| Le changement de conversation ne signalait pas clairement l’attente dans la zone des messages. | Indicateur neutre et aria-busy pendant le chargement, sans conversation fictive ni ancien contenu. |
| Les profils/préférences clients étaient difficiles à atteindre. | Entrée explicite dans la vue reçue et dans une conversation ; cible du profil indépendante du chat, choix en lecture seule, photo et préférences avant les notes ; consultation sans marquage lu. |
| Le nouveau parcours de profil utilisait parfois une ancienne conversation en mémoire pour choisir la photo. | Défaut reproduit par la première qualification HTTPS ; priorité aux métadonnées actualisées de la vue reçue lorsqu’aucune conversation n’est sélectionnée. La preuve d’échec est conservée. |
| Un rafraîchissement de la vue reçue pouvait détacher le bouton Profil, et perdre le retour de focus. | Résolution du bouton actuel par conversation et maintien du focus lors du rafraîchissement ; test unitaire et scénario HTTPS sous dialogue ouvert. |
| Le logo de l’app remplaçait la personne de Jessie. | Avatar privé autorisé dans les deux identités du chat client ; portrait public issu exclusivement de la copie explicitement publiée ; initiales si photo absente/indisponible. L’icône d’installation reste celle de l’application. |
| Le libellé long du nouveau bouton occupait une forte part de l’en-tête à320px ; Fermer conservait une petite cible. | Libellé visible « Profil » et nom accessible « Profil du client », place conservée pour le nom ; cible Fermer44px. Le scénario HTTPS contrôle les dimensions et capture l’en-tête admin320/1280. |
| La capture admin320px montrait le placeholder du message sur deux lignes partiellement coupées ; celui de la légende était aussi long. | Libellés courts « Message… » / « Légende… » ; le caractère facultatif reste expliqué dans l’aide. Mesure native des textes et de la largeur intérieure dans les deux langues, plus légende réelle à320px. |
| Un profil client sans choix pouvait afficher un message de recherche alors que le champ est masqué. | État vide en lecture seule, sans suggestion de recherche inaccessible ; contrôle FR/EN. |
| La vue reçue répétait cinq lectures d’autorisation admin par aperçu. | Preuve admin verrouillée commune, comme la liste des conversations ; verrous/preuves client, liaison et expiration fraîche maintenus.250lectures répétées retirées pour50aperçus, sans promesse de latence ou capacité hébergée. |

Des corrections concernent uniquement la fiabilité des tests : attendre le bootstrap réellement en cours pour la liaison WebCrypto du brouillon, au lieu d’un nombre de tours de boucle ; mettre à jour les libellés attendus « Profil du client / Client profile » et le placeholder court, sans retirer les assertions de clavier ou de balisage. Les conditions de sécurité, conflits, propriétaire et absence de POST automatique restent contrôlées.

## Préservation métier et formats

Le diff ne retire aucun module métier, aucune route historique, migration ou dépendance. Les invitations par lien/code, validation e-mail et admin, renouvellement, sessions indépendantes, mot de passe/MFA, texte/photos/vidéos, bibliothèque/galerie, messages non lus et suivi des réponses, réponses communes/personnelles, notes/tags/groupes/tâches, diffusions/annonces, notifications et exports/fermetures conservent leurs suites de contrôle. Une seule entrée reçue par client et l’ordre nonlus/date restent requis.

Les trois versions package/lock concordent à1.11.2 ; les dépendances et tous les fichiers SQL sont inchangés. Schéma attendu38,37tables physiques dont le ledger ;33migrations normales+3vidéo+2expérience. Le catalogue conserve25catégories,691préférences/934alias et l’empreinte `5ce26f14f15fb9c3447b07777aa5c8d17a6e823e8099dbb37959fc48f00f93cb`.

Le snapshot publicformat2 associe JPEG et préférences dans la même écriture atomique bornée à262144octets. Les anciennes copiesformat1 restent lisibles sans modification. Le JSON public garde exactement quatre champs ; l’image possède une URL publique versionnée distincte. Un GET ne publie jamais un avatar privé. Pour ajouter une photo à une copie déjà publiée, Jessie doit choisir explicitement **Mettre à jour le profil public** après avoir enregistré son avatar. Une modification privée seule ne change pas cette copie ; le retrait public invalide son URL.

**Limite de retour :** le backend1111 ne relit pas le nouveau snapshotformat2. Un ancien backend ne constitue donc pas un retour fonctionnel complet du profil public après republication. Le repli185 compatibleSQL38 reste une preuve distincte, jamais démarrée ; ne pas déplacer un tag historique ou relancer les anciens opérateurs pour effacer cette limite. La copie publique ne remplace pas les médias privés et reste hors des archives historiques.

## Preuves et état de qualification

**Source finale fusionnée et publiée :** `af352607ff7e12c41185f42b8232c72219a304cd`, arbre `655f759079979d608b0ec1c62a7c892311899515`, identique au candidat PR qualifié. La [CI main40209568701](https://github.com/fredbuhr/jessiemessage/actions/runs/40209568701) a réussi **5/5 dès la tentative1**, avec les mêmes comptes ci-dessous sousNode24.22.1. [Preuve main](verification-proofs/jm1112/main-native.json). Le [tag/release v1.11.2](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.11.2), release423509844, est publié et latest ; la [publication40210405799](verification-proofs/jm1112/publication-native.json) a réussi2/2 avec26tests de préparation et7de publication natifs. Ce workflow n’a effectué aucun déploiement.

**Candidat final qualifié :** `e35d56f6fb849a9096a2accd01362f77045849d7`, arbre `655f759079979d608b0ec1c62a7c892311899515`, [run40208512760](https://github.com/fredbuhr/jessiemessage/actions/runs/40208512760), tentative1, **5/5jobs réussis** : général4072réussis/0échec/52omissions explicites, Chrome275/275, HTTPS14/14, MariaDB608/608 chacune. [Preuve native](verification-proofs/jm1112/pr-native.json). Les sept [captures synthétiques conservées](verification-proofs/jm1112/visual-review.json) sont inspectées, dont état de connexion, conversation admin/client, profils320/1280 et profil publicFR/EN. La correction du texte de saisie est lisible à320px.

- [Premier runPR40203143152](https://github.com/fredbuhr/jessiemessage/actions/runs/40203143152), sourceba2b080b, **non qualifié** : général4071réussis/0échec/52omissions ; MariaDB608/608 chacune ; Chrome270réussis/5échecs comptant le parent ; HTTPS11réussis/2échecs comptant le parent. Les quatre échecs Chrome venaient du libellé attendu ; le scénario HTTPS a détecté le défaut d’avatar décrit ci-dessus. [Preuve initiale](verification-proofs/jm1112/pr-initial.json).
- Les52omissions générales comprennent50scénarios SQL réservés aux suites natives et2branches conditionnelles d’absence de procfs ; elles ne sont pas des succès. Les suites SQL dédiées de ce premier run ont608réussis et0omission chacune.
- [Qualification corrigée40206053487](verification-proofs/jm1112/pr-qualified-before-layout.json), source45ea7cf8/arbre97f5bd4b : cinq jobs réussis dès la tentative1, général4072/0échec/52omissions, Chrome275/275, HTTPS14/14, MariaDB608/608 chacune. Les captures de profils clients et avatars privés/publics sont inspectées. Cette révision précédait les dernières retouches de lisibilité, désormais couvertes par la qualification finale PR/main ci-dessus.
- Après les corrections d’audit :202tests locaux ciblés réussis,0échec et0omission ; syntaxe778sources et qualification native finale acquises.
- [Run40207912976 refusé](verification-proofs/jm1112/pr-composer-test-contract.json) : un test de balisage conservait l’ancien placeholder. Mise à jour de sa seule attente textuelle ; les assertions de clavier, aide et traduction sont conservées. Les nouveaux contrôles de largeur du message et de légende passent en HTTPS.
- [Structure fraîche](verification-proofs/jm1112/global-static-structure.json) :17HTML,262références internes correspondant aux littéraux de routage serveur ; aucun doublon ID, label absent, bouton sans type ou lien externe non protégé détecté dans ces contrôles. Ce résultat n’est pas262GETni une conformité d’accessibilité globale.
- [Audit npm actuel](verification-proofs/jm1112/npm-audit-current.json) :59entrées verrouillées, dépendances transitives et optionnelles incluses ;0vulnérabilité connue signalée. Cela ne couvre pas toutes les bibliothèques système ou une vulnérabilité non publiée. Les cinq dépendances directes restent3.5.4/10.1.4/9.5.2/0.35.5/3.6.7. Node24.22.1 est confirmé par la [publication officielle](https://nodejs.org/en/blog/release/v24.22.1) et le [bulletin sécurité officiel](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

## Limites conservées et clôture de l’audit

Pas d’accès à des comptes, messages, médias, SQL, PID ou journaux privés réels. Pas de navigateur cloud, manipulation Manager/PC, sauvegarde/restauration hébergée, envoi réel, effacement réel ou publication du profil public réel. `recette` partage la production et n’a pas servi de cible jetable.

Les appareils physiques iOS/Android, Safari/Firefox, clavier système et Push avec application fermée ne sont pas fraîchement qualifiés par les tests Chrome. L’événement pageshow.persisted testé n’atteste pas l’éligibilité réelle au BFCache. Le test de sauvegarde hébergée explicitement reporté reste reporté. A10 reste hors chantier ; A11 non concluant et A12 sans qualification de capacité du mutualisé restent distincts des corrections.

**Seconde revue de couverture terminée :** les171points ont chacun une disposition et leurs limites ; aucun défaut de code bloquant identifié ne reste ouvert. Le [contrôle de préservation](verification-proofs/jm1112/scope-integrity.json) confirme86motifs de tests existants,42imports publics et4ressources CSS sans référence manquante,38migrations identiques, dépendances inchangées et aucun chemin applicatif supprimé. Les limites physiques et historiques ci-dessus restent explicites.

Fusion, qualification du SHA main et publication immuable sont acquises. La [préparation et le CHECK hébergés](verification-proofs/jm1112/hosted-preparation.json) sont désormais acquis selon le reçu utilisateur, empreinte reconstituée identique. La suite est l’[activation Manager](operations-release1112.md), puis l’enregistrement de cette seule version1.11.2, après observation de chaque résultat dépendant. Aucune activation de production n’a été réalisée par l’agent.
