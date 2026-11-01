# Contre-revue du flux serveur au checkpoint592b8263

Source relue :592b826353b46f01f474ba8bf1aa01c66fee997c, arbre d3c6272284335f3f70d4447858a1461c35f5ddea. Revue RO via git show pour distinguer le checkpoint des codecs extra encore en travail. Aucun test vert rejoué, aucune édition transport/backend, aucun enfant réel, hôte ou donnée privée.

## P2 établi : annulation après fin du corps ignorée pendant la conversion

Emplacements dans ce pin : server/media/image.mjs172–176 et201–209 ; server/media/http.mjs279–293 ; service147–162.

onEnd valide les octets puis appelle detach, qui retire aborted/error/close du Readable. La route ne transmet pas de signal associé à la réponse HTTP. Un client qui annule après la fin de son original, pendant le décodage, ne peut donc plus interrompre l’enfant. Le résultat n’est pas écrit sur une réponse détruite et aucun original n’est stocké ; le défaut concerne la disponibilité : le décodage inutile conserve l’unique place globale de préparation jusqu’au résultat ou au timer30s, avec concurrence refusée MEDIA_BUSY.

Une seule nouvelle preuve synthétique exécutée : stream-after-end-abort-probe.mjs importe une copie exacte du module image du pin, injecte un faux enfant/Readable/timers, émet data+end puis aborted+close. Les listeners sont absents, kill reste absent, l’appel concurrent retourne MEDIA_BUSY. Le timerdecode30000 provoque ensuite SIGKILL et seul exit libère. Pas de capture, original ni processus natif créé par ce probe.

Correction minimale proposée et acceptée par root pour l’auteur backend : response.close si !response.writableFinished pilote un AbortController local ; signal transmis service/preparer et écouté jusqu’à exit. Ne pas traiter Request.close après EOF comme une annulation : ce close est aussi normal. L’annulation tue l’enfant sans libérer sa place avant exit. Ajouter cas nouveau d’annulation aprèsEOF et cas close normal, sans rejouer les suites vertes. Statut courant : correction auteur attendue, pas encore déclarée qualifiée.

## Gardes relues sans autre bloqueur établi

- HTTP : origine exacte, fetch metadata et encodage ; cookie rôle et acteur courant ; CSRF avant uploadLength/admission et avant tout lecteur de corps. Query fermée, Content-Length canonique<=128Mio et enum RAW validés avant admission.
- Admission : compte authentifié, quota persistant avant corps, une seule préparation lourde globale et une place par compte partagée avec uploads ; ticket opaque lié rôle/token/compte/purpose/deadline, aucune libération anticipée par releaseUpload en processing.
- Pure conversion : le parent transmet les chunks stdin avec backpressure, ne concatène ni IPC-sérialise l’original. L’enfant seul reçoit les octets, charge explicitement des décodeurs Buffer et le HEIC épinglé ; pas de fichier temporaire plaintext. Aucun reserveAsset, put, registerAsset ou message dans prepareStream.
- Sortie : JPEG<=2Mio, dimensions<=2048, digest vérifié ; service relit le contexte et le propriétaire après conversion avant retour ;8 réponses privées/15s pour le binaire, pas d’écriture sur réponse détruite.
- Lifecycle :120s corps puis30s décodage, tailles déclarée/mesurée concordantes, arrêt sur dépassement/erreur/abandon du corps, écoute tardive error absorbée, sortie enfant conditionne libération, erreurs publiques sans détails natifs. Cas source déjàended/destroyed/aborted vérifié avant enfant.

Limites : codecs extra non suivis au début de la revue exclus ; revalidation finale, SQL et navigateurs se fondent sur code et preuves synthétiques acquises, pas sur une qualification CI/hôte de ce candidat. Le fichier/error/device du client initial n’est pas fourni, aucune cause du cas réel attribuée.
