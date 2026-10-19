# Plan d'implémentation de JessieMessage

Point de départ : [état courant vérifié](REPRISE.md), étape 4/6 le 19 octobre 2026. Les six étapes historiques situent le projet ; les lots ci-dessous découpent leur fin en résultats vérifiables. Ce plan organise une reprise sûre après interruption ; il ne promet pas d'empêcher les coupures ChatGPT.

## Règle commune à tous les lots

Chaque réponse poursuit **un seul objectif borné avec un résultat et un critère de fin annoncés**. Il peut inclure code, tests, CI, fusion et déploiement du même correctif pour le terminer, avec un checkpoint après chaque opération distante. Ne pas ouvrir un nouveau lot fonctionnel avant clôture du précédent. Les dépendances ci-dessous sont techniques, pas de nouvelles demandes générales de permission.

Avant le lot, lire REPRISE et contrôler le commit/arbre, les modifications locales, la PR/CI et le service concernés. Après toute opération distante, noter résultat durable et heure dans les preuves existantes ; remplacer l'état courant dans REPRISE avec la prochaine action exacte. En cas de coupure, lire d'abord ce résultat. **Absent/inconnu ne vaut ni échec ni succès** : ne pas rejouer une opération sensible pour retrouver son état.

Le bilan distingue toujours **codé / fusionné / déployé / vérifié / en attente du PC**. Les preuves ne contiennent ni secret ni contenu client. Pas de nouveau mécanisme parallèle de déploiement, de journalisation ou de sauvegarde.

## A — Corriger et publier les consignes du kit Windows — clos

**Résultat acquis le 19 octobre 2026 : 0.70.1 codée, fusionnée, déployée et vérifiée.** Le kit de mise à jour/activation réutilise le raccordement existant ; aucune initialisation personnelle n'est déduite de cette livraison.

- **Fusion et CI :** [PR #90](https://github.com/fredbuhr/jessiemessage/pull/90), merge `bfa77a2559cfd1ab02bd53cb419509e01fa26c7a` ; source `0fd6c30658f3b6434e8833743da564ea84a47878`, arbre `b35ad5ccabbb772c6163a52489b84fa1c3482b18`. Les six jobs main ont réussi : [application](https://github.com/fredbuhr/jessiemessage/actions/runs/39270343447) et [Windows](https://github.com/fredbuhr/jessiemessage/actions/runs/39270343496).
- **Déploiement :** Manager actif, Build épinglé à cette source, checkout propre et Run `bash /srv/customer/jessiemessage-private/start-primary-witness-observer-0701-0fd6c306.sh` relu. Lanceur et démarrages effectifs confirmés ; `/api/health` et `/api/ready` répondent HTTPS 200. Empreintes du contrat et de la permission inchangées.
- **Portée de la vérification du kit :** génération et deux tests de composition réussis sur l'hébergement depuis la source déployée ; téléchargement authentifié par l'interface non effectué, la session navigateur étant à reconnecter. Le parcours Windows personnel reste au lot B. Aucun raccordement, clé, mail ni initialisation personnelle rejoué.
- **Reprise :** conserver cette source et les états existants ; ne pas republier ni redémarrer pour répéter un résultat déjà établi. Les commandes natives gardent l'environnement strict, dont `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`.

**Suite : lots B acquis et C à poursuivre**, comme consigné ci-dessous. Les preuves personnelles déjà acquises ne sont pas à répéter.

## B — Acquérir les preuves personnelles manquantes — clos

**Trois preuves acquises le 19 octobre :** capture Windows `image(20261019-162033).png` montrant `TEMOIN_INITIALISE` et la fenêtre de réussite ; journal actif relu à **18:23:38 Europe/Paris** montrant `confirmed`, `externalWitnessConfirmed:true`, observation `1792426995688`, vérification complète `1792426871839` ; capture `image(20261019-163401).png` reçue à **18:34:19**, montrant **`DECHIFFREMENT_VERIFIE`** pour `capture-1792386945745-204e0e8e073b6131`, 402 552 octets, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. La permission originale est légitimement passée à **spent, révision 2** ; contrat et origine inchangés. Le service reste `observe_only`, `closuresEnabled:false`. **B est clos pour cette archive.** Aucun contrôle PC supplémentaire demandé pour répéter ces résultats. [Preuves](verification-proofs/jm0702-verification.json).

Le défaut de remplacement des scripts existants a été reproduit sous PowerShell 5.1 puis corrigé dans la **0.70.2**, [#92](https://github.com/fredbuhr/jessiemessage/pull/92) fusionnée. Six contrôles PR et six contrôles main réussis ; 90 assertions Windows. Déploiement et ZIP corrigé vérifiés à 17:18:47 Europe/Paris ; la réussite personnelle ultérieure est une preuve distincte. À 18:24:40, archive courante et reçu PC concordants relus ; le déchiffrement personnel confirmé ensuite compare le contenu en mémoire à cette capture et ne certifie pas encore une restauration SQL.

**Résultat :** trois preuves séparées pour le PC existant : initialisation locale, aller-retour indépendant frais accepté par le service et déchiffrement de l'archive courante. La copie chiffrée par reçu reste une quatrième preuve déjà acquise à sa date.

- **Préconditions :** lot A déployé/vérifié ; PC habituel et configuration existante conservés. Lire l'état serveur et, après tout essai incertain, les marqueurs PC avant de reprendre.
- **Phases :** action PC indiquée ci-dessus et constat de la fenêtre « Témoin initialisé sur ce PC » ; observation fraîche du serveur/identité du registre ; vérification locale `Verifier.cmd` de l'archive courante avec le trousseau existant. Ce sont des constats séparés, jamais une réussite déduite d'une autre.
- **Validation finale :** `TEMOIN_INITIALISE` local consigné sans secret, échange indépendant accepté et daté, archive courante identifiée par taille/empreinte et résultat `DECHIFFREMENT_VERIFIE`. Une attente PC reste « en attente », pas un échec du service.
- **Reprise :** ne jamais réinitialiser permission, témoin ou appariement après une coupure ; vérifier `ready`/`spent`, tentative et marqueurs durables. Une réponse inconnue exige un diagnostic de récupération.

## C — Raccorder la barrière fraîche et la réconciliation

**Résultat :** démarrage et récupération réels contrôlent la continuité indépendante avant réouverture ; la restauration compare explicitement source et cible et préserve les fermetures plus récentes que l'archive.

**Sous-étape C1, 0.71.0 — intégrée et vérifiée, non activée :** rendre obligatoire une preuve fraîche avant chaque ouverture du runtime lorsqu'un propriétaire de fermeture est fourni : première ouverture sans intention en attente, reprise après capture et reprise après traitement des fermetures. La vérification lie les reçus locaux au registre indépendant et contrôle l'absence des comptes déjà fermés, sous l'exclusion de capture existante. Un refus garde le runtime arrêté sans réparer ni rejouer de données. Le CLI de production courant fournit uniquement l'observateur, sans propriétaire de fermeture ; cette sous-étape ne l'active pas et ne change pas la disponibilité quotidienne avec le PC éteint. La composition de production et la réconciliation explicite source/cible restent ensuite à terminer ; C n'est pas clos. [PR #93](https://github.com/fredbuhr/jessiemessage/pull/93) fusionnée, source `8d93461cd1d22c62a33349a13bc6a05d080b09c8`, merge `ec15e9f234bf22c798d046dbac162bc355cfd04d`. Cinq jobs candidat et cinq jobs main réussis ; 410/410 sur chacune des MariaDB, 157/157 Chrome et chemins natifs du témoin vérifiés. Voir les [preuves C1](verification-proofs/jm071-verification.json). Le code C1 est embarqué dans la 0.72.0 déployée ; le propriétaire de fermeture reste non composé et non activé. C2 raccorde désormais la lecture indépendante au parcours de récupération, sans lever la quarantaine.

**Sous-étape C2, 0.72.0 — codée, fusionnée, déployée et vérifiée :** vrai CLI relié au transport PC du parent par contrôle Unix privé ; chaque défi neuf est authentifié ; témoin ≥ journal local et sauvegarde ; confirmation liée à la source/cible/capsule. [PR #94](https://github.com/fredbuhr/jessiemessage/pull/94), source `94fb7882cf74eb5f2ec165e67833ac2e7cdf13f3`, merge `6a829880543fe7280f3ca52dcbc0c5d702b37ac0`, arbre `c6d304e49209a1194d91c0992096e59ff3685b6e`. Cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39292971066) et cinq [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39293603482) réussis ; parcours complet CLI → Unix → HTTP PC → témoin durable éprouvé sur chaque MariaDB, reçu récent conservé et source SQL intacte. Build achevé le 19 octobre à 19:29 Europe/Paris ; HTTPS santé/disponibilité 200 ; lecture authentifiée via le contrôle hébergé et le PC existant réussie à 17:30:06.642 UTC (révision 1, zéro reçu). La copie reste en quarantaine, sans SQL ni ouverture cible. Voir [C2](witness-recovery-072.md) et ses [preuves](verification-proofs/jm072-verification.json).

**Sous-étape C3, 0.73.0 — codée, fusionnée et vérifiée en CI candidat/main ; non déployée :** parent explicite sous provenance originale et permission `spent`, transport PC existant et contrôle `recover-only`, sans enfant applicatif, producteur, capture ou tick d'observation initial vide. Le démarrage normal de l'observateur, l'initialisation et la réservation restent limités au registre initial vide. [PR #95](https://github.com/fredbuhr/jessiemessage/pull/95), source `fed209f3cc256afd83de139a19f8a3b92a301a5c`, merge `cf2b9f3843643a627d933217453a484013024fb9`, arbre `6a59673806e27231c47b9aa7bcdc374ab54717ec`. Cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39300959900) réussis : 2 868 tests généraux réussis (30 wrappers SQL ignorés), 410/410 sans omission sur chaque MariaDB, Chrome et authentification HTTPS réussis, syntaxe 533 sources. Les cinq jobs [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39302243763) ont aussi réussi sur le même arbre, avec les mêmes comptes ; Chrome 157/157 et HTTPS 1/1. Deux parents réellement redémarrés avec journal non vide/perdu et le vrai CLI conservent le reçu récent avec marqueur, cinq défis neufs par cas ; provenance copiée, rejeu, absence et annulation refusent la réussite. Aucun SQL source ni appariement modifié. Le service reste 0.72.0 en observation, sans bascule. La réconciliation SQL cible et l'import isolé de D restent nécessaires ; C n'est pas clos. Voir le [parcours C3](witness-recovery-parent-073.md) et les [preuves](verification-proofs/jm073-verification.json).

- **Préconditions :** preuve externe du lot B ; contrat original et empreinte physique contrôlés ; fermetures encore désactivées. Énoncer le comportement lorsque le PC est éteint sans rendre silencieusement la messagerie quotidienne dépendante de sa présence.
- **Phases :** raccorder la barrière au processus réel ; raccorder la réconciliation source/cible ; valider puis déployer séparément. Ne pas créer un témoin de remplacement ou traiter un registre courant vide comme une provenance originale.
- **Validation finale :** essais synthétiques du témoin absent/périmé, journal perdu, ancien registre vide, intention inachevée et compte réapparu ; récupération gardée en quarantaine dans ces cas ; reprise autorisée seulement sur preuve fraîche cohérente. Arrêt/reprise du vrai processus éprouvés.
- **Reprise :** relire journal, maintenance, identité source/cible et marqueur de récupération. Une opération interrompue reste bloquante tant que son résultat durable n'est pas réconcilié ; aucune répétition destructive automatique.

## D — Qualifier SQL et prouver un import courant isolé

**D1 acquis le 19 octobre :** nouvelle base et opérateur dédiés, connexion TLS/vide SQL et namespace observé, copie physique indépendante, inspection applicative source et précontrôle réussis. Vraie récupération PC en quarantaine à 19:04:10 UTC, puis import natif courant à 19:06:43 et seconde vérification du clone complet à 19:06:45 **sans réimport** : trente tables/migrations, six clés, quatre fichiers photo et capsule concordants. Marqueur bloquant conservé ; aucun rebind ni ouverture cible ; service source 0.72.0 sain et inchangé. Les CLI sont inchangés ; voir [parcours](isolated-checkpoint-20261019.md) et [preuves](verification-proofs/jm-d19-isolated-restore.json). Le profil demeure applicatif (`completeDatabase:false`) : **C/D restent ouverts** pour l’inventaire strict et le protocole final de réconciliation source → cible. Le prochain lot définit puis implémente ce protocole ; il ne répète pas D1 ni les preuves personnelles du PC.

**Résultat :** inventaire SQL qualifié et restauration native de la capture courante sur une cible réellement isolée, couvrant les données et états opérationnels attendus.

- **Préconditions :** déchiffrement du lot B et canal de récupération C1/C2/C3 acquis ; la réconciliation finale C est éprouvée avec cet import. Cible distincte en base, racine et capacités, sans trafic réel. `recette.jessiemessage.com` n'est pas cette cible. Identifier un lecteur privilégié d'inventaire avant de conclure sur les objets exécutables ; l'identité DML seule ne suffit pas.
- **Phases :** inspection qualifiée, import natif isolé, contrôle des données/photos/capsule/journaux et des restrictions de démarrage ; chaque opération a son reçu et son checkpoint.
- **Validation finale :** objets SQL masqués ou inattendus refusés ; couverture courante précisément documentée, sans déclarer la base complète si elle ne l'est pas ; cible restaurée contrôlée et quarantaine respectée, production intacte. La restauration 0.46 reste un acquis historique distinct.
- **Reprise :** relever l'état réel de l'import et les empreintes source/cible avant de relancer ; ne pas réimporter sur une cible incertaine ni connecter la cible restaurée au service réel.

## E — Terminer fermeture, conservation et notice concordante

**Résultat :** parcours de fermeture de la version de base exploitable avec conservation, copies et notice FR/EN correspondant au comportement effectivement livré.

- **Préconditions :** lots C/D acquis avant activation des fermetures ; Jessie/France et conversation jusqu'à fermeture définitive déjà confirmés. Compléter seulement les décisions encore manquantes et leur traduction en code ; pas de nouveau questionnaire général.
- **Phases :** raccorder le propriétaire de fermeture à l'exclusion de tous les producteurs et à l'inspection qualifiée ; définir/raccorder fin de vie des autres familles, journaux et copies ; aligner notice/aide ; tests de bout en bout sur comptes fictifs puis activation bornée et vérifiée.
- **Validation finale :** reprise après interruption sans compte réapparu ni libération prématurée ; sauvegardes anciennes ne ressuscitant pas un compte fermé ; textes exacts sur fermeture, conservation et limites des copies ; aucun compte réel effacé pour valider le développement.
- **Reprise :** journal d'intention et reçu final font foi. Ne jamais déduire une fermeture terminée d'une réponse HTTP perdue. Après une première fermeture réelle, ne pas revenir à un ancien runtime ignorant le registre.

## F — Fiabiliser l'alerte externe de panne totale

**Résultat :** surveillance indépendante du parent/hébergement avec cadence maximale explicitée et preuve de réception d'une alerte de panne totale puis de rétablissement.

- **Préconditions :** relire sonde et workflow existants, passages réels et mode de notification. Ce lot peut être traité séparément de C–E ; il conserve leurs checkpoints et ne les avance pas implicitement.
- **Phases :** corriger la cadence ou le canal existant selon les limites constatées ; éprouver une panne synthétique sans interrompre le service réel ; constater livraison et rétablissement.
- **Validation finale :** relevés externes datés et borne de délai vérifiée, alerte indépendante reçue par le canal prévu. Les mails locaux déjà acceptés ne sont pas à refaire et ne prouvent pas une panne totale.
- **Reprise :** vérifier passages et notifications déjà créés avant de les répéter ; préciser ce qui est seulement configuré et ce qui est réellement reçu.

## G — Recette finale sur deux appareils et clôture de la base

**Résultat :** version de base vérifiée sur les deux appareils habituels, guide et repli consolidés, limites restantes explicites.

- **Préconditions :** lots A–F acquis avec leurs preuves ; les fonctions antérieurement acceptées restent acquises. Identifier un compte invité de test pour tout essai personnel de diffusion ; l'envoi réel n'est pas implicite dans l'autorisation générale de développement.
- **Phases :** sessions simultanées et conflit de fiche ; ouverture notification vers le bon message et conversation ; parcours photos et export ; première diffusion personnelle ciblée lorsqu'elle est explicitement demandée ; diagnostic et repli documentaire.
- **Validation finale :** aucun doublon/perte de brouillon ou déconnexion imprévue observé, message de diffusion individuel conforme, état de sauvegarde et récupération lisible ; code, runtime, CI, guide et liste des limites concordants.
- **Reprise :** ne répéter que le parcours échoué ou non constaté. Publier le bilan des critères clos et ouverts ; les connexions directes à Drive et fonctions de confort restent une phase ultérieure.

Amélioration ultérieure facultative : clarifier le message d'échec de `Start-JmBackup` en mode réglages, qui évoque encore un « nouveau kit ». Il ne réapparie rien automatiquement et n'est pas utilisé par les lanceurs de mise à jour/activation ; ce reliquat ne rouvre pas le lot A.
