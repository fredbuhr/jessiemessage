# PC : mise à jour bloquée par Avast — 20 octobre 2026

**A07 est bloqué sur le PC par Avast `IDP.Generic`. Une fausse alerte n’est pas confirmée.** Le plan correctif reste clos historiquement avec réserves ; ce nouvel incident empêche de valider l’installation personnelle du kit. Les copies automatiques du PC peuvent être interrompues.

## Faits observés

Les trois captures fournies montrent `Agent actions suspectes` et le processus Windows PowerShell. Elles signalent le même nom `JessieMessage-sauvegardes-055.ps1` à deux emplacements : copie installée sous `%LOCALAPPDATA%\JessieMessage\Sauvegardes\<destination>` mise en quarantaine à **12:03:44.019 UTC**, puis copie extraite du ZIP dans Téléchargements bloquée à **12:12:52.625 UTC**. Il s’agit de chemins locaux Windows. Aucun hash ni contenu des fichiers en quarantaine n’a pu être relu sur le PC.

Le contrôle serveur à **12:21:26.673706 UTC / 14:21:26 Europe/Paris** confirme le service 0.83 disponible, moniteur OK, dix empreintes sensibles et identité d’autorisation PC préservées. Le collecteur livré par le serveur concorde avec le code épinglé. Cela ne qualifie pas l’exécution actuelle du copieur sur le PC. Le reçu relevé à 13:47 Europe/Paris lors de la clôture précède les alertes et reste une preuve historique.

SHA-256 du collecteur attendu côté dépôt et serveur : `31b95cd516028a9be43430bddeb461631279d077ad916df767114cd29bc1e436`. Ce n’est pas une empreinte mesurée sur le fichier quarantainé, ni une preuve d’acceptation par Avast. [Preuve structurée](verification-proofs/jm083-avast-20261020.json).

## Action personnelle nécessaire

La [procédure officielle Avast](https://support.avast.com/en-us/article/use-antivirus-quarantine/) permet l’analyse sans sortir le fichier de la quarantaine :

1. Dans Avast, ouvrir **Protection → Quarantaine**, ou **Ouvrir la Zone de quarantaine** depuis l’alerte.
2. Cocher l’entrée `JessieMessage-sauvegardes-055.ps1` ; si les deux copies sont présentes, sélectionner ces deux entrées uniquement.
3. Choisir **⋯ → Envoyer pour analyse**, puis **Faux positif** comme soupçon à examiner. Indiquer JessieMessage, site `jessiemessage.com`, kit de mise à jour 0.83, détection IDP.Generic à l’exécution PowerShell. Envoyer seulement le script signalé ; configuration DPAPI, archives et clés ne sont pas nécessaires à cette analyse.
4. Garder le fichier en quarantaine pendant l’examen. La mise à jour personnelle reste non confirmée ; sa reprise demande de vérifier les fichiers et tâches sur le PC après résolution du blocage.

L’agent n’a envoyé aucun fichier à un tiers, restauré aucun élément, ajouté aucune exception ni changé de réglage antivirus. L’action de soumission doit être réalisée dans l’Avast du PC, auquel l’agent n’a pas accès. Avast précise qu’une analyse peut être traitée sans réponse individuelle ; aucune date de résolution n’est garantie.

## Limites du kit à corriger avant une nouvelle recette d’installation

La revue du [collecteur](../scripts/JessieMessage-sauvegardes-055.ps1) relève un défaut de confirmation : les deux fichiers sont remplacés séparément, puis les tâches enregistrées, sans relecture finale des fichiers avant le message « mise à jour installée / copies continuent ». Une disparition ou quarantaine pendant cette séquence peut donc laisser une installation partielle ou absente sans confirmation fiable. Le message d’échec invitant seulement à attendre une copie en cours ne distingue pas ce cas.

La qualification Windows existante couvre les fonctions de copie/mise à jour avec réseau et enregistrement de tâches contrôlés ; elle ne couvre pas Avast ni le lancement intégral du CMD sur ce PC. Une correction de préparation/remplacement/confirmation et des essais d’interruption sont à traiter avant de demander un nouvel essai utilisateur. Leur succès ne prouvera pas à lui seul l’acceptation par Avast.

L’usage de PowerShell, sa recopie dans AppData et l’enregistrement de tâches sont des hypothèses de déclenchement, pas la règle Avast identifiée. Le kit signalé reste inchangé pour conserver la référence d’analyse. Aucun réemballage ou changement de nom n’est présenté comme une résolution. Le raccordement, DPAPI, clés, archives, états du témoin et D1 doivent rester préservés. Aucune restauration automatique depuis la quarantaine ou nouvelle tentative de raccordement ne fait partie de la reprise.
