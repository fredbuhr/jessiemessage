# JessieMessage — activation des diffusions privées, étape 0.49

**Relevé historique :** la [correction 0.50 est activée](broadcast-activation-050.md) depuis le 18 octobre à 01:21. Elle retire l’accord invité décrit dans ce lot 0.49. Ce document conserve la preuve et le repli de la version antérieure.

**Livré le 18 octobre 2026 à 00:47 Europe/Paris.** Le profil `messaging-photos-notify-recovery-crm-broadcast` est actif sur `jessiemessage.com` et l’origine recette conservée. Les conversations, photos, notifications, récupération et fiches privées restent incluses. Chaque campagne est choisie et confirmée dans l’interface ; aucune campagne réelle de test n’est créée ni envoyée par l’agent.

## Référence servie et prérequis

Source **`d77f16fbddbee4bad90f0230ad344d148823aac5`**, arbre **`5897917c0e7810e16ab51e600e2cf1c6eff02f47`**, checkout **`/srv/customer/jessiemessage-operator/broadcast-runtime-backup-d77f16fb`**. La [préparation 0.48](broadcast-runtime-backup-048.md) conserve les cinq jobs CI exacts réussis, les formats 9/10 et reçus 7/8, le préflight des schémas et les limites des preuves SQL/natives. Les campagnes réutilisent la clé des messages avec leur finalité distincte ; aucun nouveau secret, coffre, paquet ou schéma n’est introduit.

Le propriétaire accepte le parcours personnel essayé des fiches à **00:31:47** : « C’est bon ça fonctionne ». Le [checkpoint 0.46](crm-checkpoint-046.md), sa copie indépendante, le coffre à six fichiers et la restauration native isolée réelle restent acceptés. Aucun test de conflit non rapporté ni toutes plateformes ne sont déduits.

Le nouveau préflight réussit à **00:44:28.223828** sans démarrage. À **00:44:58.515273**, les domaines actuellement peuplés sont authentifiés en lecture seule avec les six clés et les trois tables de diffusion sont vides. Cette inspection en activité n’est pas une nouvelle capture cohérente. Les campagnes ne peuvent pas être créées via le runtime CRM alors actif, dont les routes de diffusion sont désactivées ; aucun ancien travail de campagne n’est repris lors de cette première activation.

## Commandes enregistrées et build

Lanceur privé créé exclusivement, relu et contrôlé : `/srv/customer/jessiemessage-private/start-primary-broadcast-checked-d77f16fb.sh`, propriétaire `0700`, **802 octets**, SHA-256 **`5bc328588f8640a6af3430527d137dc4c3f2c6e71eb93083f37051655c94d422`**. Il épingle source, arbre et Git propre, enlève les injections Node ambiantes et charge les six fichiers ancrés existants.

Run :

```bash
bash /srv/customer/jessiemessage-private/start-primary-broadcast-checked-d77f16fb.sh
```

Build :

```bash
cd /srv/customer/jessiemessage-operator/broadcast-runtime-backup-d77f16fb && test "$(git rev-parse HEAD)" = d77f16fbddbee4bad90f0230ad344d148823aac5 && test "$(git rev-parse HEAD^{tree})" = 5897917c0e7810e16ab51e600e2cf1c6eff02f47 && test -z "$(git status --porcelain)" && npm run check
```

Le Manager conserve Node 24, port 3000 et les domaines. Run/Build sont enregistrés, puis le build est lancé sans supprimer les dépendances verrouillées préparées. Après succès, le Manager redémarre l’application. Sa console confirme l’écoute sur le port 3000 et le reçu `started`, profil `messaging-photos-notify-recovery-crm-broadcast`, déploiement `primary-transition`. L’état final est **Node.js Actif**, build terminé sans erreur et « Dernière modification le 18/10/2026 à 00:47 ».

Aucune migration, modification DNS, rotation de clé, remise à zéro de compte ou changement des règles de session/Push. Les autorisations de poursuite du projet couvrent cette activation préparée. Aucun test SMTP ni Push réel n’est déclenché.

## Contrôles hébergés

À **00:48:20.358726 Europe/Paris**, **68/68 contrôles HTTPS** et **seize comparaisons exactes de ressources** réussissent, avec TLS normal et checkout épinglé/propre :

- Santé et disponibilité `ok` / `ready`, HTTP 200 sur les deux origines.
- Accueil, aide, traductions et horloge de session conformes aux ressources attendues.
- Vingt contrôles de diffusion refusés anonymement en 401 avec absence de cache : page, modules, sessions par rôle, préférence individuelle, activité et campagnes.
- Douze contrôles CRM et les ressources du diagnostic restent protégés ; configuration privée et brouillon d’information restent non servis.
- La récupération reste accessible à l’origine principale seulement.

Ces sondes sont des GET sans session réelle, sans modification d’accord, aperçu nominatif ou création de campagne. Elles ne prouvent pas le rendu et la livraison dans les appareils personnels. Les cinq jobs CI réussis de la source exécutée comprennent **383/383 par MariaDB**, **101/101 Chrome**, une authentification HTTPS/MariaDB et **2 281 réussites générales**, 27 wrappers SQL ignorés. La recette SQL couvre consentement partagé, refus Origin, aperçu, retry retrouvé, chiffrement et repli sans effacement. Les fixtures et les livraisons synthétiques du worker ne constituent pas une campagne réelle.

## Premier essai personnel ciblé

Après actualisation, l’administrateur dispose du lien **Diffusions**. Préparer un titre d’historique privé et un message, sélectionner seulement un compte de test choisi, puis utiliser **Vérifier les destinataires**. L’aperçu doit indiquer l’accord et l’accès actuels. Le compte invité ouvre **Les nouvelles de Jessie**, coche **Je souhaite recevoir les messages de diffusion de Jessie.**, puis utilise **Enregistrer mon choix** dans son espace ; le défaut est désactivé, l’administrateur ne peut pas le forcer.

La première campagne réelle, même de test, doit être choisie et confirmée personnellement dans l’application. Le propriétaire peut limiter cet essai à un seul compte et vérifier l’arrivée dans sa conversation puis l’historique. Ce retour n’est pas encore reçu. Les parcours déjà acceptés des fiches, photos, notifications et récupération ne sont pas rejoués en bloc.

## Repli et exploitation

Repli direct : Run CRM 0.47 `bash /srv/customer/jessiemessage-private/start-primary-crm-checked-edf696ec.sh`, accompagné du Build épinglé `edf696ec`, arbre `3daa88c3b180fe1494245ea390807f800f783ae1`, décrit dans [l’activation CRM](crm-activation-047.md). Ce repli exige une relance par le Manager et retire les routes/worker de diffusion en conservant schéma, campagnes, accords, messages déjà inscrits, clés et sessions. Il n’annule pas rétroactivement une campagne. Une campagne encore approuvée et en attente pourra reprendre lors d’une future réactivation si ses droits et son échéance restent valides ; utiliser l’annulation explicite des campagnes si une suspension durable de ces envois est voulue.

**Après toute donnée de diffusion, conserver les outils et formats 9/10 de la source 0.48, y compris lors d’un repli du runtime vers le CRM seul.** Les anciens profils CRM refusent les tables de diffusion peuplées. Aucune restauration SQL ancienne n’accompagne un simple repli logiciel. La restauration native réelle d’une campagne peuplée reste non éprouvée sur l’hébergement ; la preuve actuelle associe le pipeline natif réel 0.46 et les copies SQL peuplées du nouveau profil en CI.

Étape 0.49 : activation et contrôles opérateur terminés ; premier essai personnel ciblé de diffusion encore à recevoir. Les sauvegardes récurrentes avec copie indépendante et la surveillance avec alerte restent à organiser avant extension de l’usage privé.
