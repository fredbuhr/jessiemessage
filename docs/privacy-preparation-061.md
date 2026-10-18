# Préparation privée de la confidentialité — 0.61

Itération 1 du plan de six lots avant la clôture de la version de base. L’écran **Administration → Confidentialité** réunit les huit décisions D01–D08 et les deux textes FR/EN. Trois panneaux regroupent responsable/demandes, échanges/conservation et copies/effacement. Les réponses peuvent rester partielles ; le compteur indique seulement les points renseignés, jamais une validation juridique.

## Usage

1. Ouvrir Confidentialité depuis l’accueil administrateur.
2. Renseigner les informations connues, puis relire les textes en français ou en anglais. Les deux aperçus sont indépendants de la langue de l’interface. Les données saisies ne sont pas traduites automatiquement.
3. Choisir **Enregistrer le brouillon**. Un changement de langue conserve les saisies. Le masquage de l’onglet efface le DOM privé ; les modifications non enregistrées ne sont conservées qu’en mémoire et ne sont remises à l’écran qu’après preuve du même compte **et du même CSRF**. Un changement de connexion les retire. Aucun brouillon dans localStorage/sessionStorage, ni envoi automatique.

Deux appareils ne peuvent pas écraser silencieusement leurs versions. Un conflit conserve la saisie locale, présente la version enregistrée et propose soit de la charger, soit de reprendre explicitement les modifications locales sur la nouvelle révision. Ce dernier choix demande ensuite un clic distinct sur Enregistrer ; aucune répétition automatique du POST.

Le brouillon de notice est actualisé pour les fiches, le suivi et le téléchargement personnel des conversations. Les champs manquants restent visibles dans l’administration. Les notes, noms et coordonnées du responsable restent dans le brouillon privé tant que la notice n’est pas finalisée. Aucun fichier de préparation personnelle dans Git ou CI.

## Accès et stockage

Les ressources et `/api/admin/privacy` nécessitent une session administrateur actuelle, uniquement sur le domaine principal et lorsque le répertoire privé d’exploitation existant est configuré. Les mutations imposent origine exacte, CSRF, JSON borné et champs fermés. Le compte et le CSRF sont relus immédiatement avant le remplacement durable et avant la réponse ; une réponse 401 tardive n’efface pas un cookie de remplacement. Les ressources portent no-store et aucune autorisation CORS.

`privacy-preparation.json` est conservé dans le répertoire privé d’exploitation existant, hors du checkout. Fichier 0600, répertoire 0700 et ancêtres épinglés par des descripteurs Linux ; liens symboliques, liens multiples, fichiers non privés, JSON non canonique et dépassements de taille refusés. Écriture exclusive, verrou court, révision optimiste, fsync, remplacement atomique et vérification après remplacement. Un verrou abandonné est un incident à inspecter ; il n’est pas cassé automatiquement.

Les réponses, textes et date sont chiffrés avec AES-256-GCM. La sous-clé HKDF-SHA-256 est dérivée de la clé CRM existante et d’un domaine distinct lié à l’origine et au format ; aucune nouvelle clé persistante, rotation ou migration. L’authentification lie aussi la révision. Une ancienne préparation indéchiffrable ne peut pas être remplacée par la sauvegarde ; ses octets restent conservés. Ce fichier constitue une configuration d’exploitation préparatoire : son inclusion et sa fin de vie dans les sauvegardes doivent être traitées dans les lots conservation/restauration avant de le considérer couvert par une restauration applicative. La copie actuelle SQL/photos ne prouve pas sa sauvegarde.

La primitive d’écriture privée de l’ancien état des destinations est mutualisée dans `server/files/private-json.mjs`, sans changer nom, format, limites ou API des destinations. Ses essais de régression sont conservés.

## Limites de clôture

La réponse reste `publication: draft_only`, `retention: not_enabled`, même si les huit réponses sont renseignées. Ce lot n’ajoute pas de route publique de notice, de consentement, de purge ou d’exécuteur de suppression. Enregistrer des durées dans un brouillon ne change aucune durée réelle. La publication définitive dépend des faits et décisions D01–D08, de textes concordants et des fonctions réellement présentes. Un éventuel parcours distinct de consentement devra être implémenté si cette condition est retenue ; la lecture d’une notice n’en tient pas lieu.

Le déchiffrement personnel de la capture courante et sa restauration native restent à constater. Les mails d’incident/rétablissement déjà acceptés, la copie automatique sur PC, les sessions longues et les exports restent acquis.

## Validation

Essais ciblés : schéma fermé, textes bornés, chiffrement/relecture réelle, mauvaise clé, tag/révision modifiés, concurrent/stale writers, verrou existant, refus des liens et permissions anormales, révocation avant remplacement et absence de publication malgré huit réponses. La CI Linux doit aussi exercer le vrai ancrage procfs ; l’environnement local sans procfs le signale explicitement.

HTTP : sessions/rôle, ressources privées, GET/HEAD sans écriture, origine, CSRF, corps excessif, conflit, révocation pendant l’opération, arrêt et refus sur l’origine historique. Chrome : 320/375/1280 px, FR/EN, navigation clavier, conservation après changement de langue, rechargement, conflits sans répétition, masquage, changement de connexion et texte HTML toujours littéral. Les résultats exacts et l’éventuelle activation sont consignés après leurs observations ; aucune activation n’est revendiquée par ce document préparatoire.

## Sources de rédaction

Relues le 18 octobre 2026 : [CNIL — information et transparence](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence), [CNIL — durées de conservation](https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees), [RGPD — principes, articles 6 et 9](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2). Ces sources structurent les informations à réunir ; elles ne fixent pas à elles seules les faits, durées ou fondements propres à JessieMessage.

Le plan conserve six lots : (1) confidentialité/conservation, (2) moteur d’effacement complet, (3) interface et application des règles, (4) déchiffrement/restauration actuels, (5) surveillance externe fiable, (6) recette et consolidation finale. Les fonctionnalités de confort supplémentaires sont une phase ultérieure.
