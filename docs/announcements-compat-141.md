# Compatibilité du schéma des annonces — version 1.4.1

**Code revu, fusionné, qualifié par ses propres CI PR/main et publié ; non préparé ou déployé sur Infomaniak.** Cette référence est le futur repli compatible de la [1.5.0 — Annonces](announcements-150.md). La production et le checkpoint restent la 1.4.0 close, Node 24.22.0, schéma 31 et repli 1.3.4, selon [REPRISE](REPRISE.md).

La 1.4.1 reconnaît la migration 0032 et les annonces chiffrées. Elle conserve le traitement des campagnes v2, y compris leur disponibilité programmée et leur expiration. Les annonces restent désactivées dans son runtime normal ; les diffusions à grande échelle restent disponibles. Aucun worker, secret ou paquet supplémentaire n’est ajouté. Les vérifications du schéma, la sauvegarde et la fermeture des comptes reconnaissent la nouvelle table sans modifier les preuves historiques ni rouvrir les opérations PC.

## Référence publiée

La [PR 119](https://github.com/fredbuhr/jessiemessage/pull/119), head `c28b296d4cfcf160f771561b1934058c9a9f0f55`, est fusionnée sur **`bf022233fcb76ee4db89e0c33c64b9498adb9d50`**, arbre **`a2f29930fe8ead853db6b6e8b76b613891ae4a04`** identique à celui de la PR. La [CI PR finale](https://github.com/fredbuhr/jessiemessage/actions/runs/39619128778) et la [CI main propre](https://github.com/fredbuhr/jessiemessage/actions/runs/39620191652) réussissent chacune **5/5 à la tentative 1**, cinq logs propres relus sous Node **24.22.0**.

Chacune compte **3 304 tests généraux, 3 266 réussis, zéro échec et 38 ignorés**, syntaxe/build **605 sources** ; MariaDB **10.11/11.4, 496/496 chacune**, Chrome **183/183** et HTTPS/MariaDB **3/3**, sans omission native. Les annonces couvrent neuf sous-cas SQL et cinq tests Chrome dans dix contextes. Les omissions générales ne constituent pas une qualification native. Les premiers échecs locaux et la [première CI PR échouée](https://github.com/fredbuhr/jessiemessage/actions/runs/39617941943), suivie de quatre corrections de fixtures, sont conservés dans les [preuves](verification-proofs/jm141-verification.json). Aucun garde produit n’a été retiré.

Le [tag et la release v1.4.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.4.1), identifiant **419688886**, sont vérifiés sur ce commit exact ; publication le **`2026-10-21T14:56:19Z`**. Le [workflow de publication](https://github.com/fredbuhr/jessiemessage/actions/runs/39621225009), job `119294843956`, provient du commit opérateur `1d6458cf852a457e1723ed8f92d9689a17612af0`. Ce dernier ne désigne pas la source applicative.

## Vérifications locales et limites

La suite locale commune passe sous Node **24.19.0** : **3 300 tests, 3 083 réussis, zéro échec, 217 ignorés**, en 23 977,837963 ms. Build et syntaxe de **605 sources** passent ; la revue statique finale ne relève plus de blocage. La première passe avait trois échecs de compteurs de fixtures, corrigés dans les tests sans retirer de garde produit. Ces omissions locales ne qualifient ni MariaDB ni Chrome ; leurs CI propres sont distinguées ci-dessus.

La restauration native générique valide son fixture de schéma 32, sans annonce non vide. Le vérificateur cryptographique des annonces est testé unitairement ; la persistance et le refus d’altération d’une annonce non vide sont vérifiés séparément en SQL natif. Aucune restauration native complète d’annonce chiffrée non vide, aucun téléphone physique, débit réel du mutualisé ou fonctionnement courant du PC n’est revendiqué.

## Préparation hébergée restante

La migration additive 0032 porte le schéma à **32 migrations, 31 tables applicatives et 32 avec le registre**, avec 44 clés étrangères et 13 contraintes CHECK propres aux annonces. La 1.4.0 reste préservée, mais ne constitue pas un repli après cette migration. La **1.4.1 doit d’abord réussir son précontrôle hébergé sur le schéma 32** avant d’être qualifiée comme repli utilisable ; aucun démarrage intermédiaire de cette référence n’est requis. Préparation, statut SQL, migration, précontrôles et activation 1.5.0 restent à constater séparément selon [REPRISE](REPRISE.md). Une publication n’est pas un déploiement.

Les [helpers opérateur publiés](https://github.com/fredbuhr/jessiemessage/blob/40027be898f1a82cd9c2aed7c4a313096d8db4d4/ops/prepare-release150.sh) au commit `40027be898f1a82cd9c2aed7c4a313096d8db4d4` sont qualifiés par **59/59 tests synthétiques** et leurs octets publiés vérifiés. La seule action actuelle est la préparation sans SQL ni arrêt décrite dans [REPRISE](REPRISE.md#préparation-opérateur--seule-étape-actuelle). Aucun reçu hébergé n’est acquis. Le helper de migration reste non exécutable tant que ses quatre empreintes de lanceurs ne proviennent pas du reçu de staging utilisateur.
