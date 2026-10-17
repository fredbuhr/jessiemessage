# Reprise des appareils et coexistence des adresses — étape 0.35

**État courant : activation réalisée en 0.37, runtime courant `4433309f` depuis 18:03 Europe/Paris le 17 octobre 2026, déploiement `primary-transition`, schéma 30.** L’adresse principale et recette sont conservées par le même service. La [correction après coupure](device-transition-retry.md) conserve la notification lors d’une nouvelle tentative ; la [présentation des actions](device-transition-interface.md) est corrigée. Le propriétaire confirme globalement le parcours proposé à 17:28. Le [compte rendu 0.37](primary-origin-cutover.md) et la [recette sur les appareils](notifications-device-acceptance.md) distinguent cette acceptation du relevé par plateforme et de la simultanéité non précisés. Les contrôles préparatoires ci-dessous conservent leur état historique de 0.35 et ne constituent pas une validation sur tous les appareils réels. La [continuité de langue 0.38](device-transition-language.md) conserve maintenant le choix FR/EN sur le pont, ses reprises et sa sortie vers la connexion.

**Préparation et contrôles terminés le 17 octobre 2026.** Révision `a0b17ce0a82a317b8a4f6782b26eef52fe9430b6`, arbre `44ea8cf1e0c3c2d0cbfe80aba6ac98ea22224af0`, [PR brouillon #46](https://github.com/fredbuhr/jessiemessage/pull/46). Les cinq jobs de la [CI exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/38990150146) passent : **1 917 tests généraux**, 27 wrappers SQL ignorés seulement dans ce job ; **367 tests sans saut sur chacune des MariaDB 10.11 et 11.4** ; **20 tests Chrome applicatifs**, dont le parcours de reprise et ses neuf scénarios ; **un test Chrome/HTTPS/MariaDB**. Les lecteurs de vrais fichiers privés sous Linux passent. Aucun échec.

Le checkout distinct `/srv/customer/jessiemessage-operator/device-transition-a0b17ce0` est installé et vérifié à **03:18:41.929 Europe/Paris**. Le préflight opérateur sur le candidat primaire existant passe à **03:18:59** : `checks_passed`, `deployment: primary-transition`, `started: false`, `launchApproved: false`. À **03:19:19.834**, le préflight du runtime alors actif 0.33 passe encore ; santé/disponibilité répondent 200 et l’apex `/app` conserve son 302 vers recette. Pendant cette préparation, aucun lanceur, domaine, secret ou schéma n’a été changé ; aucun serveur supplémentaire n’a été démarré. La préparation 0.35 est alors validée ; son activation attend encore le checkpoint du schéma 30.

Ce lot prépare le passage de `recette.jessiemessage.com` à `jessiemessage.com` en conservant les connexions existantes. À la fin de la préparation 0.35, le runtime reste 0.33 `f2677249`, schéma 30. Le candidat de configuration primaire du lot 0.34 conserve les mêmes comptes, réglages et clés ; son activation sur les deux domaines est ensuite réalisée en 0.37.

## Parcours de reprise

Sur le domaine principal, l’entrée propose **Retrouver mon espace** ou **Retrouver l’administration** si le rôle concerné n’y est pas encore connecté. Les deux rôles restent des choix explicites. Une session déjà ouverte sur cette adresse continue directement vers son espace habituel.

La page de reprise demande confirmation avec un bouton simple. Elle crée une demande liée à ce navigateur, rejoint l’ancienne adresse pour vérifier la session encore ouverte, puis revient sur l’adresse principale. Elle y réinstalle le même jeton de session protégé. Le mot de passe ou le code de sécurité ne sont pas redemandés lorsque cette session est toujours valide et disponible dans le même navigateur. La connexion de l’ancienne adresse reste ouverte.

Si la session n’existe plus, la page propose la connexion normale. Si un autre compte du même rôle est déjà connecté sur l’adresse principale, la reprise s’arrête sans le remplacer. Si le même compte y possède déjà une session valide, cette session est conservée. Les clients en attente ou dont l’accès a expiré retrouvent leur page d’accès, sans obtenir de nouveaux droits sur les messages.

Une référence de notification valide est conservée jusqu’au message autorisé, y compris si une connexion normale redevient nécessaire. Une requête réseau sans réponse, même pendant la lecture JSON, expire après huit secondes et rend **Réessayer** disponible. Quitter la page annule les demandes et empêche une réponse tardive de provoquer une navigation.

## Garanties du protocole

- Une clé aléatoire indépendante est créée dans le processus ; elle n’est ni enregistrée ni dérivée des clés des données. Aucun nouveau secret de coffre et aucune migration SQL.
- La demande et le ticket sont chiffrés avec AES-256-GCM. Ils portent rôle, origines fixes, empreinte du nonce, dates et référence de notification éventuelle. Le ticket contient seulement le jeton de session déjà existant et l’identité qui devra être revérifiée.
- Chaque rôle possède son cookie de nonce `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, de 120 secondes. Les reprises administrateur et client peuvent avancer indépendamment dans deux onglets.
- Les paquets passent entre les deux pages dans un fragment effacé immédiatement. Les jetons de session en clair restent dans les cookies HttpOnly et côté serveur ; ils ne sont placés ni dans JavaScript, ni dans une URL, ni dans un stockage Web. Les requêtes HTTP n’incluent pas les fragments.
- Chaque API est un POST JSON à sa propre origine. L’export exige la session et son CSRF ; la réception exige le nonce du navigateur et revalide les droits actuels. Aucune exception CORS ni règle générique de redirection.
- Le registre mémoire est borné à 2 048 demandes par défaut, 4 096 au maximum, avec expiration de 120 secondes. Une demande est réservée avant les lectures asynchrones ; un rejeu ou un second concurrent échoue. Un redémarrage invalide les paquets en cours et permet une nouvelle tentative.
- Une nouvelle connexion normale sur la destination annule la reprise en cours du même rôle. Une réponse de reprise ne réécrit pas le cookie d’un compte déjà valide à destination.
- Les pages et réponses utilisent `no-store`, `no-referrer`, une CSP stricte et l’interdiction d’encadrement. Les paramètres d’URL, corps trop grands, champs supplémentaires et doublons sont refusés. Les erreurs restent fixes, sans contenu de compte ni secret.

Cette reprise conserve un seul enregistrement de session pour les deux origines sur cet appareil. Une déconnexion ou révocation de ce jeton vaut donc pour les deux adresses. Elle ne restaure jamais une session révoquée, des identifiants changés ou des droits expirés. La garantie de consommation porte sur ce processus unique : ce protocole n’est pas une infrastructure SSO distribuée.

## Runtime de transition

L’activation est explicite : `--deployment primary-transition --profile photos-notify`. Elle exige la configuration primaire exacte préparée au lot 0.34. Sans cette option, les lanceurs et lecteurs conservent leur comportement de recette et n’exposent pas les pages ou API de reprise.

Le serveur de transition garde **un listener HTTP, un pool SQL, une admission, un moniteur et un ensemble de workers**. Deux familles de handlers vérifient chacune leur Host et leur Origin exacts. Les invitations créées sur chaque origine portent leur bonne adresse. Les nouveaux e-mails de service utilisent la configuration primaire. Les domaines arbitraires et les faux en-têtes de forwarding ne choisissent aucune autorité. `www` doit être canonicalisé par le routage externe, sans devenir une troisième origine privée.

Le préflight opérateur primaire conserve les exigences TLS, privilèges SQL, contraintes physiques et stockage privé. Il nomme son contrôle d’origine `primary_origin` ; le diagnostic de recette garde `official_subdomain`. Le seul diagnostic générique local de tests conserve son exception SQL de loopback explicite déjà existante ; elle ne permet pas de contourner le lanceur opérateur.

Contrôle préparatoire depuis le checkout exact validé, sans ouvrir de listener :

```sh
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node scripts/start-private-messaging.mjs check \
  --deployment primary-transition --profile photos-notify \
  --private-directory /srv/customer/jessiemessage-private/primary-origin-candidate-4a355851 \
  --private-path-mode linux-dirfd
```

Un succès doit annoncer `checks_passed`, `deployment: primary-transition`, `started: false`, `launchApproved: false`. Ce contrôle ne déplace aucun domaine et ne modifie ni les données ni les sessions.

## Préconditions de l’activation et recette réelle

Les préconditions de sauvegarde sont acceptées en 0.36 ; le rattachement et le runtime sont activés en 0.37. Les vérifications de routage courantes et le repli coordonné sont détaillés dans le [compte rendu de bascule](primary-origin-cutover.md). Les essais sur les appareils restent en attente.

1. Conserver le checkpoint cohérent au **schéma 30**, sa copie indépendante et la preuve de restauration isolée vérifiée. Ne pas réutiliser l’ancien script photo qui attend 28 migrations. La révision 0.33 reste compatible avec le schéma, mais ne suffit pas seule pour un repli tant que l’apex est dirigé vers Node.
2. Conserver les domaines et certificats du même site Node ainsi que le document root Apache et ses valeurs de repli. Aucun retour de runtime ne doit précéder l’analyse du routage et des caches décrite dans le compte rendu 0.37. Les enregistrements de messagerie restent inchangés.
3. Préserver `recette.jessiemessage.com` comme alias **sans redirection automatique** pendant la transition. Son Host original, ses pages privées, API et service worker doivent continuer à répondre. Le guide générique de changement de domaine propose ensuite de retirer l’ancien nom : cette dernière étape ne convient pas tant que les appareils et liens existants l’utilisent.
4. Après affectation contrôlée et démarrage, vérifier sur les deux adresses : santé/disponibilité, Host/Origin/CSRF, sessions existantes, invitations/e-mails, texte/photos, service worker et réception des notifications. N’exécuter aucune migration SQL pour activer ce lot.
5. Reprendre chaque appareil, puis accepter ensemble les six à huit sessions. Ne pas se déconnecter de recette pour terminer la reprise : le même enregistrement de session vaut pour les deux origines. Sur iOS et selon les installations PWA, le navigateur et l’application peuvent utiliser des stockages distincts : conserver l’ancienne installation tant que la nouvelle n’a pas été éprouvée.
6. Activer explicitement les notifications sur la nouvelle origine, tester une nouvelle alerte vers le bon message, puis choisir quand désactiver l’ancienne inscription. Les permissions Push et l’icône installée ne sont pas transférées silencieusement ; les anciennes alertes restent utilisables sur recette.

Le profil actuel autorise jusqu’à seize inscriptions Push actives par compte. Conserver temporairement les anciennes et nouvelles inscriptions peut donc produire deux alertes sur un appareil ; la transition des notifications doit être acceptée appareil par appareil. Aucun ancien abonnement n’est supprimé par le pont de session.

Références consultées le 17 octobre 2026 : [OWASP — gestion des sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [MDN — cookies et préfixe `__Host-`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie), [Infomaniak — sous-domaine vers domaine](https://www.infomaniak.com/fr/support/faq/2160/remplacer-un-sous-domaine-par-un-domaine). Ces sources orientent les contrôles ; elles ne certifient pas ce protocole propre à JessieMessage.
