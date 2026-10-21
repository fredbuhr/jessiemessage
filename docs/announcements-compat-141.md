# Compatibilité du schéma des annonces — version 1.4.1

**Référence publiée, préparée et précontrôlée sur le schéma 32, sans démarrage.** La 1.4.1 est désormais le repli compatible hébergé de la [1.5.0](announcements-150.md). Activation et identité HTTP 1.5.0 restent à constater ; le checkpoint conserve ses métadonnées antérieures 1.4.0.

La 1.4.1 reconnaît la migration 0032 et les annonces chiffrées. Elle conserve le traitement des campagnes v2, y compris leur disponibilité programmée et leur expiration. Les annonces restent désactivées dans son runtime normal ; les diffusions à grande échelle restent disponibles. Aucun worker, secret ou paquet supplémentaire n’est ajouté. Les vérifications du schéma, la sauvegarde et la fermeture des comptes reconnaissent la nouvelle table sans modifier les preuves historiques ni rouvrir les opérations PC.

## Référence publiée

La [PR 119](https://github.com/fredbuhr/jessiemessage/pull/119), head `c28b296d4cfcf160f771561b1934058c9a9f0f55`, est fusionnée sur **`bf022233fcb76ee4db89e0c33c64b9498adb9d50`**, arbre **`a2f29930fe8ead853db6b6e8b76b613891ae4a04`** identique à celui de la PR. La [CI PR finale](https://github.com/fredbuhr/jessiemessage/actions/runs/39619128778) et la [CI main propre](https://github.com/fredbuhr/jessiemessage/actions/runs/39620191652) réussissent chacune **5/5 à la tentative 1**, cinq logs propres relus sous Node **24.22.0**.

Chacune compte **3 304 tests généraux, 3 266 réussis, zéro échec et 38 ignorés**, syntaxe/build **605 sources** ; MariaDB **10.11/11.4, 496/496 chacune**, Chrome **183/183** et HTTPS/MariaDB **3/3**, sans omission native. Les annonces couvrent neuf sous-cas SQL et cinq tests Chrome dans dix contextes. Les omissions générales ne constituent pas une qualification native. Les premiers échecs locaux et la [première CI PR échouée](https://github.com/fredbuhr/jessiemessage/actions/runs/39617941943), suivie de quatre corrections de fixtures, sont conservés dans les [preuves](verification-proofs/jm141-verification.json). Aucun garde produit n’a été retiré.

Le [tag et la release v1.4.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.4.1), identifiant **419688886**, sont vérifiés sur ce commit exact ; publication le **`2026-10-21T14:56:19Z`**. Le [workflow de publication](https://github.com/fredbuhr/jessiemessage/actions/runs/39621225009), job `119294843956`, provient du commit opérateur `1d6458cf852a457e1723ed8f92d9689a17612af0`. Ce dernier ne désigne pas la source applicative.

## Vérifications locales et limites

La suite locale commune passe sous Node **24.19.0** : **3 300 tests, 3 083 réussis, zéro échec, 217 ignorés**, en 23 977,837963 ms. Build et syntaxe de **605 sources** passent ; la revue statique finale ne relève plus de blocage. La première passe avait trois échecs de compteurs de fixtures, corrigés dans les tests sans retirer de garde produit. Ces omissions locales ne qualifient ni MariaDB ni Chrome ; leurs CI propres sont distinguées ci-dessus.

La restauration native générique valide son fixture de schéma 32, sans annonce non vide. Le vérificateur cryptographique des annonces est testé unitairement ; la persistance et le refus d’altération d’une annonce non vide sont vérifiés séparément en SQL natif. Aucune restauration native complète d’annonce chiffrée non vide, aucun téléphone physique, débit réel du mutualisé ou fonctionnement courant du PC n’est revendiqué.

## Migration et précontrôles hébergés confirmés

Le [reçu de préparation](verification-proofs/jm150-hosted-staging.json), le [diagnostic SQL préalable](verification-proofs/jm150-hosted-sql-status.json) puis les [deux reçus de migration et précontrôles](verification-proofs/jm150-hosted-schema32.json) conservent chaque étape séparément. Le dernier confirme le schéma **32**, une migration appliquée et 31 conservées, `schema32Confirmed:true`, `rollback141HostedQualified:true` et `release150PrecheckPassed:true`. L’arrêt est attesté par l’opérateur, sans observation privée directe de l’agent. `runtimeStarted:false`, `managerChanged:false` et `checkpointChanged:false` décrivent le helper ; aucun relevé HTTP 1.5.0 n’est encore fourni. Aucune date non fournie n’est déduite.

Le [helper épinglé](https://github.com/fredbuhr/jessiemessage/blob/c798f96b631464e51c7ce212c37ceeaa681af904/ops/upgrade-release150.sh), SHA-256 `0162b6a364decae68b5f6c0d76f84a20c869d6e9269ee12d40d0251bf425381c`, conserve ses 32 tests synthétiques après épinglage des lanceurs. Ces tests et les 59 tests initiaux restent distincts des reçus hébergés. **Ne rejouer ni préparation, ni migration, ni précontrôles pour retrouver les résultats acquis ; ne tronquer aucun journal.**

La 1.4.1 est préparée et précontrôlée, jamais démarrée. La 1.4.0 et la 1.3.4 restent préservées historiquement, mais ne doivent pas être redémarrées sur le schéma 32. La seule action actuelle est l’[activation 1.5.0](REPRISE.md#activation-150--seule-étape-actuelle) avec ses lanceurs exacts, puis le relevé des quatre champs admin. Aucun démarrage intermédiaire de 1.4.1 n’est requis. Le writer de métadonnées attend l’identité et le relevé de démarrage réels ; le checkpoint est encore 1.4.0. Aucun travail PC ni évolution suivante n’est ouvert.
