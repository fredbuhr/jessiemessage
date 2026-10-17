# Lot 0.39 — préparer la récupération de compte client

**État : préparation à réaliser, non livrée.** L’état opérationnel de départ est le runtime 0.38 `4433309f09f0eb6bd2a4f498d32394d0d39b5cb2`, arbre `b8f82034b61c1837552c2d50c7749475453a1909`, schéma 30, profil `messaging-photos-notify`, déploiement `primary-transition`. Les constats métier ci-dessous ont été établis sur `0c88f61b` ; le lot 0.38 ne modifie que l’interface de reprise et les conserve. La récupération client reste inactive. Le [confort bilingue 0.38](device-transition-language.md) est livré ; ce plan n’annonce aucune activation de récupération.

Le métier, les routes, les formulaires et les tests de récupération existent déjà. L’activation n’est toutefois pas un simple changement de variable dans le Manager. Le lot proposé ajoute un profil explicite **`photos-notify-recovery`**, avec récupération **sur l’apex seulement**, en conservant recette pour les connexions et notifications existantes.

## État des prérequis

| Élément | Constat sur le code de départ |
| --- | --- |
| Base | Les migrations `0021_client_password_resets.sql` et `0022_password_reset_outbox.sql` font déjà partie des trente migrations. Aucune nouvelle migration prévue. |
| Droits | Le diagnostic SQL exige déjà les lectures et droits DML sur les deux tables. Aucun élargissement de droits prévu ; leur présence et leurs contraintes restent à recontrôler. |
| Secrets et dépendances | Même clé de mail, SMTP et paquets existants. Les mails de récupération utilisent une finalité cryptographique distincte. Aucune clé, configuration de coffre ou dépendance supplémentaire prévue. |
| Profil privé | `private-auth-environment.mjs` refuse les variables applicatives ambiantes ; le profil `photos-notify` et son préflight imposent la récupération désactivée. |
| Transition primaire | `createConfiguredServer()` refuse actuellement `resetConfig.enabled` en mode `primary-transition`. Le nouveau profil doit être autorisé explicitement, sans assouplir les profils existants ni activer CRM/diffusions. |
| Origines | Le handler de récupération existant utilise l’origine canonique. Aucun handler de récupération recette n’est affecté. Le périmètre apex évite de dupliquer ce parcours. |
| Interface | **Mot de passe oublié ?**, `/recover`, le contrôleur, le modèle, le style et les textes FR/EN existent. Le lien apparaît lorsque les capacités annoncent la fonction active. |

Les migrations et droits nouveaux ne sont donc pas prévus pour ce périmètre. Un échec des assertions physiques reste un arrêt de préparation à diagnostiquer, pas une raison de recréer les tables ou d’élargir automatiquement les privilèges.

## Priorité : sauvegarde et restauration avec des resets présents

Le vérificateur actuel `verifyPhotoNotificationBackupData()` utilise le profil limité `photos-notify`. Dans `server/backup/verify.mjs`, les tables `client_password_resets` et `password_reset_outbox` sont considérées comme inactives : **une seule ligne suffit à provoquer `inactive_domain_populated`**. `scripts/backup.mjs` et `scripts/verify-private-checkpoint.mjs` utilisent ce vérificateur, y compris pour le checkpoint applicatif. La première demande éligible de récupération rendrait donc cette chaîne incompatible avec les données nouvellement créées.

**Résoudre ce point avant toute activation réelle :**

1. Ajouter un mode de sauvegarde explicite qui authentifie les charges reset avec la clé de mail existante, tout en refusant les domaines CRM et diffusions encore inactifs.
2. Adapter la sélection du profil dans la capture, le manifeste/reçu et les outils de vérification/import. Conserver la lecture et la vérification des anciens checkpoints selon leur profil enregistré.
3. Tester avec de vraies lignes SQL synthétiques : challenge, mail chiffré, états de file et liens de destinataire. Capturer, importer dans une copie isolée et vérifier snapshot, chiffrement et médias sans lancer de worker.
4. Faire échouer une charge altérée ou une liaison incohérente, sans masquer ni supprimer les lignes pour obtenir une réussite.

Ne pas passer au profil complet avec une clé CRM fictive. La couverture reste celle des trente tables applicatives et des médias chiffrés ; les objets SQL exécutables restent exclus/non prouvés. Ce lot n’ajoute pas de clé métier.

## Mise en œuvre prévue

1. **Profil et garde primaire.** Ajouter `photos-notify-recovery` au parseur et au chemin de chargement/copie strict du lanceur privé. Dériver l’activation explicitement depuis ce profil, avec les cinq configurations existantes, la même origine et les mêmes valeurs. Le préflight et la garde de `primary-transition` doivent reconnaître précisément ce périmètre ; CRM et diffusions restent désactivés. Les anciens profils gardent leurs refus.
2. **Schéma physique sans démarrage.** Ajouter à `checkMessagingSchema()` les assertions du store reset et de sa file. Le diagnostic général lit déjà les colonnes, mais ne remplace pas les contrôles de types, index, clés étrangères et contraintes effectués par ces stores.
3. **Apex uniquement.** Servir capacités, demandes, formulaire et soumission sur `https://jessiemessage.com`. Les e-mails conduisent à `/recover#reset=…` sur cet apex. Recette conserve ses sessions, messages, service worker et Push ; son lien de récupération reste masqué faute de capacité active. Ne pas rediriger l’ensemble de recette ni ouvrir les POST à une autre origine.
4. **Un seul service de livraison.** Réutiliser le transport SMTP existant avec le worker de récupération prévu par le serveur. Vérifier son démarrage unique, sa supervision et son arrêt avec les autres producteurs ; aucun second runtime ou transport parallèle à créer pour l’activation.
5. **Activation après preuve.** Après CI exacte et vérification sauvegarde/restauration, préparer un checkout et un lanceur épinglés, passer le préflight sans listener, puis effectuer le build/redémarrage contrôlé. Aucun changement DNS, rotation de clés ou réinitialisation générale des sessions n’est prévu.

## Effets exacts sur les connexions

**Activer la fonction ou demander un lien ne déconnecte personne.** Une nouvelle demande éligible remplace les anciens challenges de ce client et annule leurs jobs, sans changer son mot de passe ni ses sessions. Le lien expire après trente minutes et ne peut être consommé qu’une fois ; ouvrir la page ne le consomme pas.

Seule la validation du nouveau mot de passe révoque toutes les sessions du **client ciblé**, incrémente sa version d’identifiants et annule ses autres liens de récupération. Ce client doit ensuite se reconnecter normalement sur ses appareils ; le pont recette/apex ne rétablit pas un jeton révoqué. Les sessions administrateur et celles des autres clients restent inchangées côté SQL. Invitation, approbation, statut, échéance d’accès, conversations et photos sont conservés ; un accès expiré reste expiré.

La réponse réussie efface uniquement le cookie client de l’origine répondante, sans créer de session ni toucher au cookie administrateur. Cet effacement est actuellement inconditionnel : si le navigateur est connecté au client B mais termine une récupération du client A, le cookie local de B est aussi effacé. Les sessions SQL et autres appareils de B restent valables. La recette réelle utilisera donc le profil du client de test concerné.

Après un reset, les anciennes inscriptions Push du client restent stockées mais deviennent inéligibles par révocation/version. Après reconnexion, **Activer sur cet appareil** doit les rattacher à la nouvelle session. La permission du navigateur peut rester accordée ; aucune réactivation automatique des inscriptions n’existe actuellement. Les appareils administrateur ne sont pas concernés par ce reset client.

## Vérifications et limites restantes

- Étendre les tests de profil, préflight et runtime : ancien profil inchangé, nouveau profil accepté, configurations incohérentes refusées et aucun démarrage pendant `check`.
- Conserver les tests SQL/HTTP de neutralité des demandes, usage unique, expiration, courses reset/connexion, maintien des droits et préservation de l’administration. Ajouter la coexistence avec les deux origines et le rattachement Push après reconnexion.
- Vérifier la capture/restauration avec le domaine reset peuplé avant activation, puis exécuter les cinq jobs CI de la révision exacte.
- Ajouter un parcours Chrome sur les vrais fichiers : demande, nouveau mot de passe, réussite, lien consommé/expiré, erreurs réseau, français/anglais et écran étroit. Les contrôleurs synthétiques et la preuve historique du lot 0.9 ne suffisent pas à certifier cette activation.
- Après démarrage, vérifier HTTPS, capacités, fichiers exacts, `no-store`, refus cross-origin, routes recette conservées et sessions existantes. Aucun reset n’est nécessaire pour ces sondes anonymes.
- Faire ensuite une recette réelle avec le seul client de test : réception depuis `contact@jessiemessage.com`, lien apex, mot de passe modifié, ancienne connexion refusée, nouveau login et droits/photos conservés ; rattacher Push et vérifier que l’administration reste ouverte. Ne pas réinitialiser le compte administrateur.

Les quotas réseau utilisent `request.socket.remoteAddress`, sans accepter aveuglément les en-têtes de proxy. **Observer le pair réellement présenté par l’hébergement avant d’ajuster les limites** : plusieurs clients peuvent partager un même frontal. Les limites actuelles restent en place tant que cette observation n’établit pas le besoin d’un changement.

La file de récupération possède déjà une purge bornée de certains jobs après sept jours. **Les lignes `client_password_resets` ne sont pas purgées.** Leur conservation et leur suppression restent à définir ; aucune nouvelle durée n’est inventée par ce plan.

Le repli désactive la fonction avec le schéma conservé. Il ne doit ni restaurer les anciens mots de passe, ni ressusciter les sessions révoquées, ni supprimer les nouvelles lignes de récupération. Dès que ces lignes existent, les outils de sauvegarde compatibles restent nécessaires même si la fonction est ensuite désactivée.

Le [guide historique de récupération](client-recovery.md) doit être complété lors de la livraison : ses vingt-deux migrations et résultats 0.9 restent des preuves datées, pas l’état du runtime actuel. Le [plan courant](AUDIT-2026-10-17.md) et le [compte rendu de bascule](primary-origin-cutover.md) conservent les étapes déjà livrées.
