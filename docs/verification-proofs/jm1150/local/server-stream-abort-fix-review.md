# Revue RO du correctif d’annulation aprèsEOF

Revue du 1 novembre2026, sur le seul delta signal écrit après le checkpoint871a54b549c3ddb847abc80ce0af07f05b366d5b. Le P2 initial a été reproduit sur592b8263 ; ses sources, probe et résultat restent conservés sans réécriture.

Le correctif HTTP crée un AbortController après admission, écoute response.close seulement si !writableFinished et traite une réponse déjàdestroyed. Il transmet le signal dans options à service.prepareStream, dont le forward existant reste inchangé. Enfin, le hook réponse est retiré et l’admission libérée selon son état existant.

Le préparateur refuse un signal non natif/déjàannulé, conserve sa listener abort après la fin du corps et la retire à stop/exit. La course d’un signal annulé entre validation et attachement est recontrôlée avant child.send. L’annulation détruit stdin et SIGKILL l’enfant, refuse toute réponse tardive, puis garde active=true jusqu’à exit. Aucun signal ni octet original nouveau dans l’IPC. Le close normal du Readable aprèsEOF reste détaché et ne devient pas une annulation client.

Journal auteur backend-abort-after-eof-final.log lu :2tests nouveaux,2succès,0échec/omission. Premier cas HTTP réel annule la réponse après originalEOF puis admet une nouvelle demande ; second cas helper prouve le kill postEOF, l’occupation jusqueexit, le rejet du résultat tardif et le nettoyage des timers. La revue n’a relancé aucun test ni probe. Le diff ciblé est sans erreur d’espacement.

Aucun bloqueur résiduel établi dans ce delta. P2 corrigé et couvert localement ; qualification CI du candidat final encore requise. Les codecs ajoutés en parallèle ne sont pas couverts par cet avis de lifecycle. Aucun hôte, message, média ou compte réel concerné.

SHA256 relus :

- server/media/http.mjs : a274d33d093462292b02ccc249a069905050cb30a44cfa0f989f145e813734d7
- server/media/image.mjs :3afdfbc1894e263e2a8d3f166d23f1a6c10d1f929d9975aece24c6673cf10ae9
- server/media/service.mjs (forward inchangé) :330533b17ab4b92673637f5311e74e16354b7f6781d2437a5057c15c807fa8a5
- tests/media-http.test.mjs : aaae3eaf7c7fc24fca6a3da558956b56bd3cb58f2bcd0ee2437dca7921161a97
- tests/media-preparation-stream.test.mjs :31965623f63a6f6cb36b8bedf3b33d92b8969e6e96055f8f10180895c234b1d3
- journal backend-abort-after-eof-final.log :6e5ddbc0c8b4af000b7fe981934395e8b98f361ee0042e8d7795b8b07ba84dda
