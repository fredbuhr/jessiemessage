# Adresses et entrée publique — étape 0.32

## Problème et correction

Le 17 octobre 2026, le propriétaire signale que `jessiemessage.com` bloque les visiteurs. Chrome confirme le parcours : accueil public, bouton **Ouvrir mon espace**, puis `/app` avec le message de préparation sans lien de connexion. Le domaine public sert toujours l’export neutre Apache ; la messagerie, les sessions durables et les notifications fonctionnent sur `recette.jessiemessage.com`. Le propriétaire accepte les notifications dans ce même retour.

L’adresse **recette est temporaire**. L’adresse finale destinée aux utilisateurs reste **https://jessiemessage.com**.

Une correction d’accueil est préparée : l’option `--connect-recipe` du bâtisseur public fait répondre `/app` et `/app/` en **302** vers l’entrée HTTPS fixe `https://recette.jessiemessage.com/app`. L’accueil conserve son bouton familier. Les paramètres d’URL sont abandonnés avec `QSD` ; aucun en-tête ni paramètre ne choisit la destination. Les méthodes autres que GET/HEAD restent refusées avant ce lien. L’API d’entrée publique reste neutre, les routes privées restent fermées et aucun proxy n’est ajouté. Sans l’option, l’export existant reste inchangé.

Cette étape ne déplace pas l’origine de l’application : les appareils continuent à utiliser leurs cookies, installations et abonnements actuels. Le nom temporaire reste visible après ouverture jusqu’à la bascule définitive. Il ne faut pas présenter ce lien comme une mise en production complète.

## Construction et validation

Depuis un checkout exact, vers un nouveau dossier absolu hors checkout :

```sh
node scripts/build-neutral-site.mjs --output /absolute/new-directory --connect-recipe
```

Les dix tests du bâtisseur passent, dont le mode par défaut, la destination fixe temporaire, l’absence de propagation des paramètres, l’ordre des contrôles de méthode, la liste fermée des fichiers et l’indépendance des constructions successives. `npm run check` réussit. Ces tests ne remplacent pas un contrôle Apache réel.

Avant affectation, comparer les 25 fichiers au manifeste et conserver l’ancien document root pour repli. Après affectation, vérifier les variantes apex/`www`, HTTP/HTTPS, `/app` et `/app/`, la disparition de l’impasse dans Chrome, la destination exacte sans paramètre, le refus des méthodes et routes privées, ainsi que la santé de la recette. Aucun changement DNS, SQL, SMTP, clé, session ou abonnement n’est requis pour cette correction limitée.

## Plan de bascule définitive

1. **Terminer l’accès public temporaire.** Déployer le nouvel export séparé, contrôler le vrai parcours et consigner les preuves. Garder l’adresse de recette pour les essais ; communiquer l’adresse principale comme point d’entrée.
2. **Préparer l’origine définitive.** Adapter explicitement les diagnostics actuellement limités à un sous-domaine officiel ; accepter l’apex dans un profil de lancement validé, sans supprimer les vérifications d’origine, TLS ou privilèges. Préparer les configurations privées avec l’origine finale et conserver les mêmes clés, comptes et données.
3. **Préparer le routage et le repli.** Vérifier domaines et certificat Node, quotas, DNS Web uniquement, préservation des enregistrements de messagerie, snapshot cohérent au schéma 30 et copie indépendante. Établir une procédure d’arrêt/bascule et de retour cohérent avant toute affectation du domaine principal à Node.
4. **Prévoir la transition des appareils.** Les cookies `__Host-` et les inscriptions Push dépendent de l’origine ; ils ne se transfèrent pas par renommage DNS. Choisir et éprouver soit une reprise de session ponctuelle sécurisée, soit une reconnexion unique annoncée, puis activer les notifications et réinstaller l’app si nécessaire sur l’adresse finale. Les sessions durables restent ensuite la règle. Ne pas promettre une migration silencieuse ni partager un cookie sur tous les sous-domaines.
5. **Basculer et accepter.** Faire servir l’application par `jessiemessage.com`, canonicaliser `www`, vérifier invitations/e-mails, connexions existantes, appareils simultanés, textes/photos, notifications en arrière-plan et ouverture depuis l’icône. Garder un parcours de transition pour les anciens liens ; réserver ensuite la recette aux essais, sans en faire une adresse client.

La validation des notifications ne vaut pas encore validation simultanée de six à huit appareils. CRM, récupération client, diffusions, politique de conservation et autres points du plan principal gardent leur statut ; cette correction d’adresse ne les active pas.

Référence technique : [drapeaux Apache 2.4, redirection et QSD](https://httpd.apache.org/docs/2.4/rewrite/flags.html).
