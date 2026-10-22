# Reprendre JessieMessage

**22 octobre 2026 — production, checkpoint privé et latest : 1.8.1 / Node v24.22.1 / SQL36.** L’identité et les reçus hébergés sont rapportés par l’utilisateur (**USER_REPORTED**), sans nouvelle observation du processus par l’agent. La branche de correction développe **1.8.2**, sans fusion, publication ni déploiement.

## État de livraison courant

| Élément | Référence acquise |
| --- | --- |
| Application active | **1.8.1**, source `1ae4c75152795ea6f31c2ff364e337a1d5a04e31`, arbre `eb427f887248fa9db5c656c3773e016f8688efc9` ; [tag/release v1.8.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.8.1). |
| Identité au démarrage | Node **v24.22.1**, relevé UI exact **`22/10/2026 15:30:16`** ; [preuve d’identité](verification-proofs/jm181-hosted-identity.json). L’epoch **`1792675816926`** vient séparément du vrai journal relu par le writer. |
| Base | **SQL36** : 33 migrations de base conservées et 3 migrations vidéo appliquées ; [reçu de migration/précontrôles](verification-proofs/jm180-hosted-schema36.json). Aucune migration au démarrage ni pour la 1.8.1. |
| Préparation et qualification | [Préparation/CHECK181](verification-proofs/jm181-hosted-preparation.json) acquis ; [CI PR/main 1.8.1](verification-proofs/jm181-verification.json) **5/5 chacune** sur leurs sources exactes. |
| Checkpoint privé | **1.8.1 / SQL36**, SHA-256 `53bd5312c42f34934de04d1e4e7994a864892cdf5a945c6a72c7b4c46ef5be76` ; [reçu final](verification-proofs/jm181-hosted-metadata.json), `publicReady:true`, métadonnées seules, **sans redémarrage**, anciens états et autres blocs préservés. |
| Repli compatible SQL36 | **1.7.2**, source `6b3319a77c307ed7d6b003fe33de36807c70c266`, arbre `924d500375a69ae50bc63414b15df71271e2bf8a` ; préparé et **précontrôlé sur l’hôte, jamais démarré**, selon le reçu SQL36. |
| Dernier état actif antérieur | **1.8.0**, source `fd6e53b14b520231b0b307a2761331dd8c740a5b`, arbre `324c3563fc6b1cfce669bcf58d90962c23c966b8` ; [reçu historique](verification-proofs/jm180-hosted-metadata.json) inchangé. |
| Disponibilité et interface | [HTTP anonyme 1.8.1](verification-proofs/jm181-public-http.json) acquis ; liste commune des réponses rapides et [parcours vidéo](verification-proofs/jm180-hosted-interface.json) rapportés fonctionnels. La [sauvegarde hébergée](verification-proofs/jm181-hosted-interface.json) reste **non vérifiée et reportée à un autre jour à la demande de l’utilisateur**. |

**Ne rejouer ni préparation, CHECK, migration, bascule ou writer déjà acquis. Ne démarrer ni 1.7.1 ni 1.6.0 sur SQL36.** `main` peut avancer pour les preuves ; le tag et le commit réellement exécuté restent la référence de production.

## Développement courant — audit 1.8.2

Branche **`fix/audit-182`**, [PR 129 en brouillon](https://github.com/fredbuhr/jessiemessage/pull/129). Les [lots 1](verification-proofs/jm182-lot1-verification.json) et [2](verification-proofs/jm182-lot2-verification.json) sont qualifiés. Le **lot 3, entretien des documents, du code et de la CI, est codé et attend sa qualification native** ; le lot 4 regroupera qualification finale et livraison. Le [plan courant](PLAN-IMPLEMENTATION.md) fixe les critères et limites ; l’[audit initial](AUDIT-FINAL-20261022.md) et sa [preuve](verification-proofs/audit-final-20261022.json) décrivent le code avant correction.

| Qualification acquise sur branche | Source et arbre qualifiés | CI |
| --- | --- | --- |
| Lot 1 — fiabilité backend et médias | `bc2b1c0d6a8e124b4256ffd20156ce005f614711` ; `2d69a984129f1878545ad5aa2d1448952fce69f3` | [39817588326](https://github.com/fredbuhr/jessiemessage/actions/runs/39817588326), **5/5**, tentative 1 de la révision corrigée. |
| Lot 2 — continuité de saisie et aide factuelle | `bfaf637dfcb230e198032d8fc43eb5ee508745f9` ; `3d73ee2197f7c7daa6a47bc493158312ff795478` | [39826096824](https://github.com/fredbuhr/jessiemessage/actions/runs/39826096824), **5/5**, tentative 1 de la révision corrigée ; [cinq journaux hashés](verification-proofs/jm182-lot2-ci-corrected.json). |

Le lot 2 qualifie brouillons texte dans le même onglet après rechargement, demandes incertaines conservant leur identité exacte sans envoi automatique, reprise des diffusions après revalidation du propriétaire et protection des dates/options d’annonce. Aucun fichier, identifiant média ou secret d’authentification réutilisable n’est persisté. Un navigateur refusant le stockage ne garantit pas la reprise après rechargement. Chrome **223/223**, HTTPS **4/4**, MariaDB **575/575 chacune**, sans omission ; général **3 869 tests / 3 821 réussis / 48 omissions**. Les omissions générales restent distinctes des essais natifs. Les premiers échecs et leurs corrections sont conservés dans les preuves.

**Limites encore ouvertes :** les faits juridiques **D01–D07** de l’aide A10 restent à établir ; l’aide harmonisée n’est pas une notice complète ni une certification juridique. Le dossier privé reste `draft_only`. **A11** demande une observation privée du pair réseau lors du contrôle hébergé final, sans ajouter de confiance proxy par supposition. Les appareils physiques non essayés restent non vérifiés. Le test de sauvegarde hébergée reste reporté : aucun diagnostic, nouvel essai, rappel ou surveillance automatique n’est ouvert.

**Prochaine action : qualifier le lot 3 sur cette branche**, selon sa [preuve courante](verification-proofs/jm182-lot3-verification.json), puis préparer la livraison unique du lot 4. Aucun merge, tag/release, déploiement, migration ou changement Manager n’est effectué par les lots de développement.

## Accès et commandes de l’application active

Le service Node **239143**, nommé **recette.jessiemessage.com** dans le Manager, dessert aussi **jessiemessage.com**, avec **le même runtime et la même base**. Recette est une origine de compatibilité pour les anciens appareils/PWA/Push, jamais une cible de qualification destructive. Accès directs : [SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), [Run/Build](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard), [état du service](https://jessiemessage.com/admin/readiness), [tâches](https://jessiemessage.com/admin/tasks), [connexion admin directe](https://jessiemessage.com/admin/login).

| Champ Manager | Valeur active 1.8.1 — référence, pas consigne de redémarrage |
| --- | --- |
| Run | `bash /srv/customer/jessiemessage-private/start-primary-release181-1ae4c751.sh` |
| Build | `bash /srv/customer/jessiemessage-private/check-primary-release181-1ae4c751.sh` |
| Port | **3000** |
| Checkout | `/srv/customer/jessiemessage-operator/production-181-1ae4c751` |
| Journal | `/srv/customer/jessiemessage-private/jm181-node24221.log` — ne pas tronquer. |

Le repli 1.7.2 conserve les lanceurs `start-primary-release172-6b3319a7.sh` et `check-primary-release172-6b3319a7.sh` sous `/srv/customer/jessiemessage-private`, précontrôlés sans démarrage. Les anciens lanceurs 1.7.1/1.6.0 restent historiques et inutilisables sur SQL36. Le Node privé officiel est épinglé ; ne pas remplacer le binaire système du fournisseur.

## Domaines et éléments à préserver

La [redirection accueil/www](public-domains-20261022.md) est achevée : édition Web FTP déclarée enregistrée, puis [13/13 GET anonymes](verification-proofs/accueil-redirect-confirmed-20261022.json), en **308** vers `https://jessiemessage.com`, chemins et paramètres conservés. L’échec antérieur `SOURCE_NOT_FOUND` du helper Node reste historique. **Ne rejouer ni helper SSH, édition Web FTP, DNS, certificat, PHP ou routage.** Le PHP du site secondaire relève d’Infomaniak.

- Préserver les archives, clés, autorités, reçus, journaux, quarantaines, fermetures et états historiques. Ne pas réapparier le PC, régénérer ses clés, remettre un enrollment à `ready` ni retirer le marqueur D1. Les [références PC/autorité/D1](REPRISE-HISTORIQUE-20261022.md#préserver-pc-autorité-et-d1) restent disponibles ; aucun parcours PC n’est rouvert.
- Sauvegardes et archivage automatiques sont abandonnés ; conserver la sauvegarde simple à la demande dans l’administration. Le signalement Infomaniak avant son écran ne prouve pas une maintenance du fournisseur.
- Aucun navigateur cloud. Toute action personnelle nécessaire sera donnée ici avec lien et instructions exacts, sans demander de secret. Aucun envoi ni effacement de compte réel, test mail ou charge sur recette n’est autorisé par une qualification synthétique.

L’[historique de reprise du 22 octobre](REPRISE-HISTORIQUE-20261022.md), l’[historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md) et la [passation du 21 octobre](PASSATION-20261021-160.md) conservent leurs propres états. Ils ne donnent pas les prochaines commandes courantes. [AGENTS](../AGENTS.md), [PRODUCT](PRODUCT.md) et [PLAN](PLAN-IMPLEMENTATION.md) restent les références de règles, périmètre et travail restant.
