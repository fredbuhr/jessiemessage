# Callers HEIC mobile — capability réellement facultative

Delta final borné demandé par root : public/broadcast.js, public/media-library-page.js et leurs deux tests, sans modification des autres callers, du serveur ni du commun.

Avant de préparer la sélection, ces deux callers lisent la capability média sous leurs preuves courantes et le signal de sélection. preparation absente, enabled:false ou endpoint capability404 donnent réellement convert:undefined. Le préparateur commun peut alors conserver son secours HEIC logiciel1140. Lorsque la capability est active, le callback existant demeure fourni et refait sa lecture de capability et ses preuves propriétaire/CSRF au moment de l’appel, avant POST original.128Mio/180s, indice RAW enum et réponse JPEG2Mio restent inchangés ; le POST stockant garde ses états et son identité.

Formats confirme son propre ordre : natif→serveur si callback, puis logiciel local seulement sans callback ou sur404 nonstale/nonabort. Ce delta callers ne rejoue pas les tests communs et n’étend pas leur preuve : il assure seulement que l’absence de capability ne devient pas un callback qui renvoie media_format.

Seuls nouveaux cas exécutés, une fois : `node --test --test-name-pattern='legacy HEIC preparation receives no converter' tests/media-library-ui.test.mjs tests/broadcast-lifecycle.test.mjs`, journal ui-legacy-heic-capability-final.log :8/8,0échec/omission (2parents et6sous-cas absent/disabled/404). Le stub de préparation vérifie originalHEIC identique, signal courant et convert strictementundefined, puis renvoie son JPEG local ; aucun appel /prepare, un seul POST /assets utilisant ce JPEG, pas l’original. La preuve du décodage HEIC réel et de l’ordre commun appartient aux nouveaux cas distincts de formats. Groupes127/10/profil4 et capacité99 non rejoués.

Syntaxe des deux callers et diff ciblé sans erreur. Aucun autre changement, Git, hôte, donnée réelle ou test navigateur. Qualification native du candidat final toujours attendue.

SHA256 gelés :

- public/broadcast.js :817e4bff7140605d6f497a0fc660b41ed8ac2300864df6852b01ce23b8ee83fe
- public/media-library-page.js :50930e7fb414eef12a67cb1d378aa2914733b28c005f086b27cab5bb6cb35d4a
- tests/broadcast-lifecycle.test.mjs :0a20d414c5b5c14b1f4fa5f68b15feef03a788c5fef797d53d4fb7a473f87c30
- tests/media-library-ui.test.mjs :a58210e021419377460f0553aaff07575057f95955cfe532f160f34c3c3c3147
- ui-legacy-heic-capability-final.log : ed757baab0d9e55ad17e571af16c9b7343a7463831965dcbb649b619265621b5
