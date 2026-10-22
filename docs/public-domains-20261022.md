# Domaines publics de JessieMessage — 22 octobre 2026

**État : redirection accueil autorisée explicitement, pas encore appliquée. Le helper Node s’est arrêté sans écriture sur `SOURCE_NOT_FOUND` ; utiliser la procédure Web FTP ci-dessous.** L’application est déjà en production en **1.8.1**, source `1ae4c75152795ea6f31c2ff364e337a1d5a04e31`, Node **24.22.1**, SQL **36** ; [REPRISE](REPRISE.md) conserve l’identité, le checkpoint et le repli. Cette opération corrige uniquement le routage de l’ancien accueil secondaire.

## Adresses à conserver

| Adresse | Rôle et comportement attendu | État de cette opération |
| --- | --- | --- |
| `https://jessiemessage.com/` | Adresse publique principale, servie par l’unique application Node. | Déjà en production ; 200 dans l’audit initial, disponibilité à conserver après correction. |
| `https://jessiemessage.com/app` | Entrée de la messagerie ; les nouveaux liens et e-mails utilisent le principal. | Adresse à communiquer aux utilisateurs. |
| `https://jessiemessage.com/help` | Aide publique. | Chemin à conserver sur le principal. |
| `https://jessiemessage.com/admin/login` | Connexion administrative canonique. | Adresse privée d’usage courant ; mot de passe et second facteur restent nécessaires. |
| `https://jessiemessage.com/admin/messages` | Messages administrateur, sous contrôle de session. | Chemin à conserver sur le principal. |
| `https://jessiemessage.com/admin/readiness` | Identité et état du service, sous contrôle administratif. | Référence de version active. |
| `www.jessiemessage.com` | Canonicalisation Apache vers `https://jessiemessage.com`, chemin et paramètres conservés. | GET HTTP et HTTPS : 308 direct vers le principal, chemin et query conservés dans le contrôle initial. |
| `accueil.jessiemessage.com` | Même canonicalisation 308 vers le principal, afin que l’ancien accueil ne soit plus présenté. | HTTP déjà à 308 ; HTTPS sert encore l’ancien accueil ou redirige `/app` vers recette en perdant la query. Correction autorisée et préparée, non appliquée. |
| `recette.jessiemessage.com` | Ancienne origine compatible, rattachée au même runtime et à la même base que le principal. | À garder sans redirection : GET HTTPS `/`, `/app` et disponibilité à 200 dans le contrôle initial ; ce n’est pas un environnement isolé. |

Les requêtes HTTP des domaines secondaires doivent aboutir à la même destination HTTPS fixe. Exemple attendu : `https://accueil.jessiemessage.com/app?source=ancien` → `https://jessiemessage.com/app?source=ancien`. La conservation du chemin ne garantit pas l’existence de chaque chemin sur l’application principale.

## Contrôle public initial

L’[audit HTTP initial](verification-proofs/public-domains-20261022.json) porte sur **38 requêtes GET anonymes**, avant modification. Les pages publiques du principal et leurs ressources attendues répondent à 200 ; la redirection `/admin/login/` conserve ses paramètres. Les protections privées restent présentes : `/admin/messages` renvoie une redirection de connexion à 303 et `/admin/readiness` refuse la requête anonyme à 401. Ce sont des réponses attendues, pas un défaut d’accès public.

HTTP sur le principal redirige en 301 vers HTTPS. `www` redirige en 308 directement vers le principal, en HTTP et HTTPS, y compris le contrôle synthétique `/app?jm_redirect_probe=1%2B2&lang=fr`. **Le défaut restant est borné à l’ancienne entrée HTTPS accueil** : sa racine répond à 200 avec l’ancien aperçu ; `/app` redirige en 302 vers recette et perd les paramètres. La règle préparée doit remplacer ces deux comportements par le 308 canonique avec chemin et query conservés. Aucun changement de DNS n’est nécessaire pour cette correction.

Ces observations anonymes ne qualifient ni une session administrateur, ni un appareil/PWA réel, ni la réception de Push, ni la sauvegarde. Les vérifications après application de la règle restent à acquérir.

## Pourquoi garder recette

Le Manager nomme toujours le service Node **recette.jessiemessage.com**, application **239143**, environnement **118579**, hébergement **812119**. `jessiemessage.com` est lié à ce même service. Supprimer l’application Node arrêterait aussi le principal ; changer son libellé n’est pas nécessaire au fonctionnement public.

L’ancienne origine reste utile aux sessions, installations PWA et destinations de notifications Push déjà enregistrées. Les permissions et installations ne migrent pas silencieusement d’une origine à l’autre. Garder ce nom pour la compatibilité n’ajoute pas un second service ; il ne faut pas y exécuter de restauration ou de test destructif. Le [compte rendu de bascule](primary-origin-cutover.md) et la [transition des appareils](device-origin-transition.md) conservent le détail historique. Une suppression ou redirection ultérieure de recette demanderait d’abord de vérifier l’abandon effectif de cette ancienne origine par les appareils et liens concernés ; ce n’est pas une condition pour utiliser le principal en production.

## Correction Apache bornée

Le site Apache **1532641**, nommé **accueil.jessiemessage.com**, est distinct du service Node. Son document root Manager documenté est `/sites/jessiemessage-entry-1f669e45`. Le helper a testé `/sites/jessiemessage-entry-1f669e45/.htaccess` et `/srv/customer/sites/jessiemessage-entry-1f669e45/.htaccess` dans le terminal Node : les deux chemins y sont absents. Ce constat ne prouve pas la disparition du fichier ou du site. Le [rappel d’accès déjà consigné](application-table-checkpoint.md) précise que le Web FTP du Manager concerne Apache/PHP, tandis que l’accès SSH/SFTP utilisé concerne Node.js. L’empreinte source historique attendue reste `daa58abe55ca39cfb2a931f2caa8d6fc5f19e01c872e32603abc9cea8d6eff63` ; aucune nouvelle empreinte du fichier Apache n’a été lue lors de cet échec.

La modification préparée remplace seulement :

```apache
RewriteCond %{HTTP_HOST} ^www\.jessiemessage\.com(?::(?:80|443))?$ [NC]
```

par :

```apache
RewriteCond %{HTTP_HOST} ^(?:www|accueil)\.jessiemessage\.com(?::(?:80|443))?$ [NC]
```

La cible et la règle existantes sont conservées :

```apache
RewriteRule ^(.*)$ https://jessiemessage.com/$1 [R=308,END]
```

L’origine de destination est fixe. Aucun retrait des paramètres par `QSD`, aucune modification de DNS, certificat, PHP, service Node, clé ou schéma SQL n’est inclus. Le [refus automatique antérieur](verification-proofs/jm171-secondary-entry.json) reste une preuve historique intacte ; l’autorisation précise de l’utilisateur est maintenant acquise. Le helper et ses 14 tests restent qualifiés historiquement ; cette qualification n’établissait pas que son fichier cible serait accessible depuis le terminal Node.

## Arrêt observé, sans modification

L’utilisateur a transmis le reçu exact :

```json
{"status":"accueil_redirect_unconfirmed","code":"SOURCE_NOT_FOUND","noAutomaticRetry":true}
```

Le refus survient dans `select_source()`, premier appel de l’opération, avant l’ouverture du fichier cible, la lecture du répertoire privé ou la création de la copie. Aucun changement de configuration ni copie privée n’est acquis. La [preuve de domaines](verification-proofs/public-domains-20261022.json) conserve ce résultat **USER_REPORTED**, séparément de l’audit HTTP initial et de la qualification synthétique.

## Procédure manuelle via Web FTP

Depuis le navigateur personnel de l’utilisateur :

1. Ouvrir [FTP / SSH dans le Manager Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ftp-ssh), pour l’hébergement **812119**.
2. Ouvrir le **Web FTP de l’environnement Apache/PHP**, celui du site **accueil.jessiemessage.com**, site **1532641**. L’accès Node.js utilisé précédemment ne donne pas le fichier attendu ; aucun nouveau compte ni mot de passe n’est à créer ou à transmettre dans le chat.
3. Dans le Web FTP, ouvrir **sites**, puis **jessiemessage-entry-1f669e45**. Afficher les fichiers cachés si nécessaire pour voir **`.htaccess`**.
4. Télécharger ce fichier sur l’ordinateur avant de l’éditer, pour conserver sa copie d’origine.
5. Ouvrir `.htaccess` dans l’éditeur du Web FTP et retrouver la ligne exacte suivante :

   ```apache
   RewriteCond %{HTTP_HOST} ^www\.jessiemessage\.com(?::(?:80|443))?$ [NC]
   ```

6. Remplacer **uniquement cette ligne** par :

   ```apache
   RewriteCond %{HTTP_HOST} ^(?:www|accueil)\.jessiemessage\.com(?::(?:80|443))?$ [NC]
   ```

7. Conserver la règle suivante et tous les autres caractères du fichier :

   ```apache
   RewriteRule ^(.*)$ https://jessiemessage.com/$1 [R=308,END]
   ```

8. Enregistrer puis signaler que le fichier est enregistré. Les réponses HTTP réelles seront alors vérifiées avant de déclarer la redirection appliquée.

Si le dossier, le fichier ou la ligne exacte n’est pas présent, ne rien créer ni remplacer ailleurs : conserver ce constat pour retrouver le bon site Apache. La copie locale du seul fichier de configuration est propre à cette intervention manuelle ; elle ne relance pas le test de sauvegarde métier reporté.

Le [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) reste celui du service recette/principal. Aucun arrêt, remplacement de Run/Build, redémarrage, DNS, certificat, version PHP ou schéma SQL n’est à modifier. Le navigateur cloud n’est pas utilisé. La sauvegarde manuelle reste **non vérifiée et reportée à la demande de l’utilisateur**.

## Commande SSH historique — ne pas rejouer

Le helper opérateur est publié sur `1f5b5239530c96c3b780f629b8510758f5dc02fe`, arbre `0cecd0fe54c8070b61bc1b5c45fd83a880194014`, distinct de la source applicative active 1.8.1. Ses octets distants sont comparés au fichier qualifié localement ; la [CI opérateur 39800596245](https://github.com/fredbuhr/jessiemessage/actions/runs/39800596245) a réussi à sa première tentative. Les 14 tests isolés ne démarrent pas Apache ; le reçu reste `httpVerified:false` jusqu’aux observations réelles après application.

Le bloc ci-dessous est conservé comme historique du helper qualifié puis refusé sur ce terminal. **Ne pas le relancer et ne pas le déplacer vers un autre terminal** : ses chemins de cible et de copie privée étaient conçus pour l’environnement Node, sans accès Apache établi. La procédure courante est l’édition Web FTP décrite plus haut.

```bash
env -i PATH=/usr/bin:/bin python3 - <<'PY_ACCUEIL'
import hashlib
import urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/1f5b5239530c96c3b780f629b8510758f5dc02fe/ops/redirect-accueil.py'
with urllib.request.urlopen(url, timeout=30) as response:
    code = response.read(5693)
if len(code) != 5692 or hashlib.sha256(code).hexdigest() != 'a5ba6c1f3796413fd5196634b24145f812ee366b5855130a1a2be77630b61fb1':
    raise SystemExit('Empreinte incorrecte : arrêt.')
exec(compile(code, url, 'exec'), {'__name__': '__main__'})
PY_ACCUEIL
```

L’ancien résultat attendu `accueil_redirect_applied` n’a pas été obtenu. Le seul résultat hébergé acquis est `SOURCE_NOT_FOUND`, sans copie ou écriture. Les 14 tests isolés et le run réussi restent leur qualification historique, sans valider l’accessibilité du `.htaccess` réel. Aucun nouveau helper, script, workflow ou changement de version applicative n’est requis pour l’édition manuelle.

Les réponses publiques à acquérir ensuite sont le 308 de la racine HTTPS accueil et celui de `/app?jm_redirect_probe=1%2B2&lang=fr` vers les mêmes chemins/paramètres sur le principal ; vérifier aussi `www` et la disponibilité du principal. La configuration Apache n’est pas une nouvelle version de l’application : celle-ci reste 1.8.1, sans nouveau tag ni migration. Ne pas redéployer un ancien bundle d’accueil neutre qui rétablirait la condition `www` seule.

Références techniques : [Apache, mod_rewrite et conservation de la query](https://httpd.apache.org/docs/2.4/mod/mod_rewrite.html#rewriterule), [Infomaniak, domaine principal et alias](https://www.infomaniak.com/fr/support/faq/2070/modifier-le-nom-de-domaine-dun-site).
