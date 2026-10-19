# Contrat d’origine du témoin — 0.68

Étape 4/6. Ce lot prépare et authentifie le **contrat d’origine** du registre et du PC existant. Le composant reste hors du lanceur de production : aucune initialisation du PC, aucun canal public, aucune fermeture réelle et aucun redémarrage du site ne sont effectués par ce lot.

## Comportement livré

`prepareWitnessGenesis` exige un dossier de confiance privé déjà créé, distinct et extérieur aux dossiers de code, de configuration et d’opérations restaurables. L’opérateur doit fournir l’identité physique **originale** du dossier d’opérations et une vraie preuve de l’arrêt de tous les producteurs. Le composant prend le verrou commun aux captures, authentifie l’inventaire opérationnel complet et exige un registre d’effacement vide. Une quarantaine de restauration, une intention existante ou une mauvaise identité bloquent. La lecture du registre n’expose aucune conversation.

Le contrat fixe l’origine primaire, la base/racine média, l’identité physique du dossier, l’identité cryptographique du registre et l’empreinte de son état initial vide. Il fixe également l’identifiant, la date d’appariement et l’empreinte exacte de la capacité du PC déjà raccordé. Une simple actualisation du reçu de copie ne change pas cette identité ; pause, révocation, nouvel appariement ou remplacement du jeton la rendent indisponible.

Le fichier canonique est authentifié par HMAC-SHA-256 avec une sous-clé HKDF propre à cette finalité, dérivée de la clé CRM existante. Il ne contient ni cette clé, ni le jeton du PC, ni clé privée GPG, ni contenu client. Il est créé exclusivement en 0600, synchronisé et relu dans les dossiers ancrés. Une création interrompue reste visible et bloque tout remplacement. Aucun fichier existant, même vide, n’est repris comme une autorisation de réinitialiser.

`readWitnessGenesis` exige l’empreinte du fichier, qui devra être épinglée indépendamment des fichiers opérationnels restaurables. Il authentifie le contrat, son contexte, l’identité physique courante et le PC courant. Fichier absent, substitution, liens, permissions larges ou fichier supplémentaire dans le dossier de confiance bloquent. La lecture ne crée jamais un état par défaut. Le contrat retourné est immuable.

**Préparation et preuve externe restent distinctes.** Le résultat indique explicitement `externalWitnessConfirmed:false` et `closuresEnabled:false`. Un contrat signé ou un registre local vide ne remplace pas les inventaires frais, complets et authentifiés de `createErasureContinuity`.

## Portée et limites

L’API interne n’est raccordée à aucune commande, route HTTP, option d’environnement ou démarrage applicatif. Le lanceur actuel et son code 0.65 sont conservés. Les conversations continuent à fonctionner indépendamment de la présence du PC avec cette configuration. Le choix d’exploitation applicable après activation des fermetures reste à établir : ne pas introduire une obligation silencieuse d’allumer le PC à chaque redémarrage.

Le composant sait vérifier une identité originale fournie par l’opérateur ; il ne sait pas déduire l’histoire d’un dossier dont tous les fichiers auraient disparu. La future procédure d’installation doit donc établir cette provenance **avant toute fermeture**, puis épingler le contrat hors des sauvegardes opérationnelles. Ne jamais rappeler la préparation pour « réparer » une perte de registre ou de témoin. Un changement de machine, de base ou de racine exige la réconciliation contrôlée, encore à livrer.

## Vérification

Dix-huit cas couvrent notamment création/rerelecture réelles, verrou commun, course de deux préparations, registre déjà utilisé, quarantaine, remplacement de racine, altération du contrat, substitution de capacité à date identique, annulation, changement pendant la préparation et publication incertaine conservée. Seize passent localement ; deux contrôles natifs sont réservés à Linux CI faute de procfs dans le bac à sable. La CI doit réellement exécuter les ancrages protégés avant de considérer ces deux contrôles acquis.

L’audit de reprise a aussi isolé un test de processus trop sensible à la charge : son délai d’arrêt coopératif était de 80 ms. Le banc lui accorde désormais 400 ms ; le scénario d’arrêt forcé conserve explicitement 80 ms. Aucun délai de production n’est modifié. Le refus d’une readiness invalide et l’exigence d’une sortie réelle zéro restent testés.

## Suite immédiate

1. Raccorder une procédure opérateur qui établit la provenance originale, arrête réellement les producteurs, prépare le contrat et en épingle l’empreinte hors des opérations restaurables.
2. Ajouter l’initialisation explicite authentifiée du PC déjà raccordé, puis constater un aller-retour indépendant réel ; aucune réinitialisation automatique d’un témoin perdu.
3. Raccorder le parent et les barrières fraîches de démarrage/récupération en définissant le comportement quand le PC est éteint.
4. Réconcilier source et cible de restauration en conservant les reçus plus récents ; effectuer l’inspection SQL qualifiée et l’import natif isolé courant.
5. Recevoir uniquement la confirmation personnelle de déchiffrement encore manquante, puis poursuivre les étapes 5 et 6 du plan existant.

Les mails déjà reçus, l’appariement du PC, les choix Jessie/France et la conservation jusqu’à fermeture définitive restent acquis. Aucun nouvel appariement ni aucune clé personnelle ne sont demandés.
