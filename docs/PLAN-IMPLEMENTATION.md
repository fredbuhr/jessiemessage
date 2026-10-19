# Plan d'implémentation de JessieMessage

**20 octobre 2026 — étape 4/6.** Direction demandée : terminer la messagerie sur le mutualisé existant, sans nouveau serveur ni abonnement. La proposition VPS et l'attente d'un budget sont retirées. Lire l'[état courant](REPRISE.md) et les [solutions étudiées](mutualise-simple-20261019.md).

## Portée et acquis

V1 : messagerie privée, sauvegarde applicative chiffrée, copie PC existante et restauration manuelle accompagnée en maintenance. La récupération autonome après perte complète de l'hôte, un témoin frais à chaque phase et la succession de propriétaire sortent des prérequis. Cette décision ne prétend pas fournir les mêmes garanties.

Les anciens contrats, gardes, preuves C1–C5, clés et états PC sont conservés. Aucun refus n'est transformé en succès en supprimant un marqueur ou en inventant une qualification SQL. L'[ancien plan complet](https://github.com/fredbuhr/jessiemessage/blob/6ef81692e01220cd3fd1d41a38c1b1d87568984d/docs/PLAN-IMPLEMENTATION.md) reste l'historique de ce périmètre plus exigeant.

Acquis : service **0.76.0 déployé/vérifié**, démarrage simple sans observateur, fermetures désactivées ; copie PC et déchiffrement personnel conservés ; D1 importé/vérifié sur le mutualisé, trente tables, six clés et quatre fichiers photo chiffrés. D1 reste en quarantaine et n'est pas une restauration rouverte. [Preuves S1](verification-proofs/jm076-verification.json).

Un lot borné à la fois : code, contrôles pertinents, CI, fusion, déploiement et vérification du même résultat si nécessaire. Avant de répéter une opération interrompue, lire son résultat durable. Après chaque résultat, remplacer l'état courant dans REPRISE ; distinguer codé, fusionné, déployé et vérifié. Aucun secret ni contenu client dans Git.

## S1 — Simplifier le fonctionnement quotidien et l'administration — clos

**Réalisé en 0.76.0 :** démarrage `start` existant sans observateur indépendant, capture chiffrée/copieur/moniteur/alertes conservés. Le PC reste une destination de copie ; aucune action personnelle supplémentaire n'a été demandée.

- L'administration montre les dates de sauvegarde et de copie concordante, le raccourci du dossier PC et l'état de suspension. Suspendre conserve la preuve de copie déjà reçue. Changement d'appareil et outils ponctuels sont dans leurs détails ; les instructions de mise à jour indiquent `Mettre-a-jour.cmd`.
- La barrière locale existante refuse toujours une intention non terminée, un compte réapparu et le marqueur de restauration. Le vrai serveur est disponible avec un journal terminé non vide, sans PC, fermetures désactivées. Aucun nouveau mécanisme de démarrage n'a été ajouté.
- [PR #98](https://github.com/fredbuhr/jessiemessage/pull/98) fusionnée ; cinq contrôles candidat et cinq main réussis, dont 418 tests sur chaque MariaDB et 157 Chrome. Build normal du Manager réussi (dernière modification affichée : 23:34 Europe/Paris), sans réinstallation des dépendances.
- À 21:39:01 UTC, lanceur/source propres et épinglés, rapports de démarrage et HTTPS santé/disponibilité sur les deux origines vérifiés. Six configurations, trois fichiers d'autorité et le marqueur D1 sont inchangés. Moniteur `current / OK` ; API privée toujours protégée. Le catalogue de processus SSH ne montre pas les processus Web : la preuve de démarrage utilise le lanceur, les rapports et HTTPS.

**Critère de fin acquis. Suite : S2 ci-dessous.** Aucun nouveau raccordement, GPG, import D1 ou retrait de quarantaine pour répéter S1.

## S2 — Composer la fermeture locale et la restauration manuelle

### S2a — Composition locale et réconciliation en quarantaine — clos

Le code **0.77.0** réutilise le moteur d’effacement, les journaux et le superviseur existants. Seul `start-local-closures` compose le propriétaire local ; `start` reste inchangé. La preuve locale est distincte du contrat témoin historique. Le moteur de restauration exige un registre récent sélectionné par l’opérateur, crée de nouveaux journaux cible, révoque les sessions et laisse la cible en quarantaine, sans publication implicite. [Parcours](local-closures-manual-077.md), [preuves](verification-proofs/jm077-verification.json).

[PR #99](https://github.com/fredbuhr/jessiemessage/pull/99) fusionnée, source `7318f4e406f4bec826257a85521d0a259632b750`, merge `3b25b754b441005757e10a8c5743c517ae5c3e51`. Cinq contrôles candidat réussis, dont **429/429 sur chaque MariaDB sans test ignoré**, Chrome 157 et authentification HTTPS 1. Suite générale : 2 940 réussis, 33 wrappers SQL ignorés, zéro échec ; syntaxe 551. CI main 39334173585 également réussie (5/5), avec les mêmes résultats et l’arbre identique au candidat. Préflight réel **en lecture seule** réussi le 19 octobre à 22:10:30 UTC, sans redémarrage ni effacement : dix fichiers sensibles/modes et les journaux sont inchangés. La source inspectée était `d823471bdf61fb3fe259c0ab85628097a1c1e8a5` : seul un test natif diffère du candidat final. Ce contrôle ne prouve pas un effacement réel ou une restauration publiée.

Le service courant reste **0.76.0**, fermetures désactivées. Aucun réappariement, import D1 ou changement du marqueur D1 n’a été effectué.

### S2b — Raccord opérateur et réouverture explicite — clos

**0.78.0**, [PR #100](https://github.com/fredbuhr/jessiemessage/pull/100), merge `b724400689131449c2ad0bcea7ec92559943f692`, source `61ca15f669bfc34a2ff4840771a42a32ba41a665`. L'outil unique `manual-restore.mjs` réutilise import natif, médias, quarantaine, moteur manuel et parent quotidien. Cible neuve vide avant import ; journal opérateur CAS unique ; aucune réimportation après réconciliation. Confirmation explicite du plan, vérifications fraîches et réel IPC/ready avant succès ; perte d'accusé ou de reçu impose arrêt/drain et hold cible restauré. Réglages PC et préparation privée sélectionnée conservés ; originaux/D1 intacts. [Guide](manual-restore-operator-078.md), [preuves](verification-proofs/jm078-verification.json).

Candidat : cinq contrôles réussis, **436/436 sur chaque MariaDB sans omission**, Chrome 157, HTTPS 1, suite générale 2 992 réussis / 35 wrappers SQL ignorés / zéro échec, syntaxe 557. Vrai dump/import et enfant applicatif dans l'exercice, CLI exercé jusqu'à `opened`, arrêt et redémarrage normaux vérifiés. Arbre main identique ; CI main 39338761055 également réussie, cinq contrôles et mêmes résultats sans omission SQL. Le correctif du premier candidat change seulement une assertion d'ordre des champs JSON du test.

**Service toujours 0.76.0, fermetures désactivées.** Préservation et HTTPS revérifiés le 19 octobre à 22:58:22 UTC, sans déploiement ni manipulation PC/D1. Aucun nouveau lot de sauvegarde requis : suite S3 puis déploiement final et activation locale.

Les critères S2 sont acquis sur données synthétiques : fermeture locale reprenable, registre minimal récent choisi par l'opérateur, import isolé des trente tables et médias, réconciliation des fermetures, révocation des sessions et publication explicite sous maintenance. Les preuves détaillées restent dans les comptes rendus S2a/S2b ; aucune restauration de production ni garantie autonome de fraîcheur externe n'est revendiquée. Aucun nouveau sous-lot de sauvegarde n'est requis avant le déploiement final.

## S3 — Parcours utiles et recette de la messagerie — clos techniquement

**0.79.0**, [PR #101](https://github.com/fredbuhr/jessiemessage/pull/101), source `2342f749d59222104a3d6458c2617aa9f63ba69c`, merge `bc6103a73ce63752eda27a0bce83a7e53e409d09` ; arbre identique au candidat. [Compte rendu](messaging-acceptance-079.md), [preuves](verification-proofs/jm079-verification.json).

- Trois sessions Chrome indépendantes avec vrai HTTPS, MariaDB et médias : deux connexions du même client, texte/photo, brouillon, notification vers le message exact, déconnexion d'un seul appareil et reconnexion. Les conflits de fiches, réponses rapides et exports gardent leurs tests séparés existants. Aucune diffusion réelle de test demandée ni envoyée.
- La page Confidentialité décrit la capacité de fermeture réellement activée, en français et en anglais ; un brouillon ne peut pas la modifier.
- Le [guide court](guide-jessie.md) décrit les actions quotidiennes et les limites d'une restauration : maintenance, messages postérieurs à la capture potentiellement perdus, copie PC parfois plus ancienne. Pas de promesse de vingt-quatre heures de perte maximale.
- Le [registre de conservation](data-retention-register.md) consigne les conversations jusqu'à fermeture définitive et les nettoyages techniques existants. Aucune rotation automatique des archives ni durée générale de trente jours ajoutée ; aucune purge effectuée.
- La [surveillance externe existante](../MONITORING.md) est relevée en lecture seule : douze passages réussis, mais intervalles réels de plusieurs heures. Le canal d'alerte externe n'est pas attesté. Aucun nouveau mail, incident provoqué, service ou abonnement.

[CI candidat 39341320771](https://github.com/fredbuhr/jessiemessage/actions/runs/39341320771) : **5/5 réussis**, 2 996 tests généraux réussis / 35 wrappers SQL ignorés / zéro échec ; **436/436 sur chaque MariaDB sans omission**, Chrome 160, recettes HTTPS 2, syntaxe 558, aperçu construit. [CI main 39342025957](https://github.com/fredbuhr/jessiemessage/actions/runs/39342025957) **5/5 réussis**, mêmes résultats, arbre identique au candidat.

**Critère de fin technique acquis :** CI candidat et main acquises, trois contextes Chrome indépendants et acceptations personnelles déjà acquises dans leur portée. Téléphones physiques, arrière-plan système/PWA et réception d'une alerte externe restent des limites déclarées, sans nouveau test personnel imposé pour fermer ce lot. Le service reste 0.76.0, fermetures désactivées.

**Prochaine action : déploiement final de 0.79 et vérification du service avec activation des fermetures locales.** Préserver les copies PC, clés, autorité et D1 ; ne pas relancer une étude de sauvegarde, D2, un achat VPS ou une initialisation PC.
