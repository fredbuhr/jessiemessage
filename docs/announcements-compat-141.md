# Compatibilité du schéma des annonces — version 1.4.1

**Implémentation en cours, non publiée et non déployée.** Cette référence prépare le retour arrière compatible de la [1.5.0 — Annonces](announcements-150.md). La production reste la 1.4.0 close, sur le schéma 31, selon [REPRISE](REPRISE.md).

La 1.4.1 reconnaît la migration 0032 et les annonces chiffrées. Elle conserve le traitement des campagnes v2, y compris leur disponibilité programmée et leur expiration. Son runtime normal n’expose pas la création d’annonces ; aucune nouvelle infrastructure n’est ajoutée. Les diffusions à grande échelle de la 1.4.0 restent disponibles.

L’intégration adapte les vérifications du schéma, la sauvegarde et la fermeture des comptes sans modifier les reçus historiques ni rouvrir les opérations PC. L’ancien service 1.4.0 reste préservé, mais son lecteur du schéma 31 ne constitue pas le repli après migration.

Code, qualifications propres, publication, précontrôle hébergé et rôle de repli restent à constater. Les preuves de la 1.4.0 et de son repli actuel 1.3.4 ne sont pas réattribuées à cette nouvelle référence.

## Vérifications locales

La suite complète finale passe sous Node **24.19.0** : **3 300 tests, 3 083 réussis, zéro échec, 217 ignorés**, en 23 977,837963 ms. Build et syntaxe de **605 sources** passent ; la revue statique finale ne relève plus de blocage. La première passe avait trois échecs de compteurs de fixtures, corrigés dans les tests sans retirer de garde produit. Les omissions locales ne qualifient ni MariaDB ni Chrome : leurs parcours dédiés restent à exécuter dans les CI propres. [Preuves](verification-proofs/jm141-verification.json).
