import { validBody, validCaption } from "./chat-model.js";

// Unicode text only: no image service, network lookup or stored conversation
// data. Names and search aliases belong to this local, bilingual catalogue.
const groups = [
  ["smiles", "Sourires", "Smiles", [
    ["grinning", "😀", "Grand sourire", "Grinning face", "heureux joyeux happy smile"],
    ["happy-eyes", "😃", "Sourire lumineux", "Happy eyes", "heureux joyeux happy smile"],
    ["smiling-eyes", "😄", "Sourire aux yeux rieurs", "Smiling eyes", "rire heureux laugh happy"],
    ["beaming", "😁", "Sourire radieux", "Beaming face", "dents heureux grin teeth"],
    ["laughing", "😆", "Éclat de rire", "Laughing face", "rire rigoler laugh lol"],
    ["relieved-laugh", "😅", "Rire soulagé", "Relieved laugh", "sueur ouf sweat relief"],
    ["tears-of-joy", "😂", "Larmes de joie", "Tears of joy", "rire rigoler laugh lol"],
    ["rolling-laugh", "🤣", "Mort de rire", "Rolling with laughter", "rire mdr rofl lol"],
    ["gentle-smile", "🙂", "Petit sourire", "Gentle smile", "sourire gentil nice smile"],
    ["upside-down", "🙃", "Tête à l’envers", "Upside-down face", "ironie ironique irony"],
    ["blushing-smile", "😊", "Sourire timide", "Blushing smile", "rougir timide blush shy"],
    ["angel", "😇", "Petit ange", "Little angel", "innocent sage halo"],
    ["yummy", "😋", "Délicieux", "Yummy", "miam gourmand delicious tasty"],
    ["tongue", "😛", "Langue tirée", "Tongue out", "joueur playful tongue"],
    ["zany", "🤪", "Complètement fou", "Zany face", "folle fou crazy silly"],
    ["cool", "😎", "Trop cool", "Looking cool", "soleil lunettes sunglasses"],
    ["nerd", "🤓", "Petit génie", "Nerdy face", "lunettes geek clever"],
    ["monocle", "🧐", "Regard curieux", "Curious look", "curieux question curious"],
    ["party-face", "🥳", "Humeur festive", "Party face", "fete anniversaire celebration"],
    ["happy-tears", "🥹", "Ému aux larmes", "Happy tears", "emue emotion touched"],
    ["cowboy", "🤠", "Sourire cowboy", "Cowboy smile", "chapeau hat western"],
    ["disguise", "🥸", "Incognito", "In disguise", "moustache lunettes secret"],
    ["melting", "🫠", "Je fonds", "Melting face", "fondre chaleur melting warm"],
    ["warm-smile", "☺️", "Sourire tendre", "Warm smile", "tendre doux sweet smile"],
  ]],
  ["kisses", "Bisous", "Kisses", [
    ["kiss-face", "😘", "Bisou envoyé", "Blowing a kiss", "bisous baiser embrasser kiss mwah"],
    ["little-kiss", "😗", "Petit bisou", "Little kiss", "bisous baiser kiss"],
    ["smiling-kiss", "😙", "Bisou souriant", "Smiling kiss", "bisous baiser kiss"],
    ["blushing-kiss", "😚", "Bisou timide", "Blushing kiss", "bisous baiser blush kiss"],
    ["loving-face", "🥰", "Visage amoureux", "Loving face", "amour tendresse love affection"],
    ["heart-eyes", "😍", "Yeux amoureux", "Heart eyes", "amour craquer love crush"],
    ["star-eyes", "🤩", "Yeux émerveillés", "Star-struck eyes", "admirer etoiles wow adore"],
    ["hugging-face", "🤗", "Gros câlin", "Big hug", "calins tendresse cuddle hug"],
    ["hug", "🫂", "Dans les bras", "A warm embrace", "calins tendresse cuddle hug"],
    ["kiss-mark", "💋", "Trace de baiser", "Kiss mark", "bisous levres lips lipstick kiss"],
    ["heart-hands", "🫶", "Cœur avec les mains", "Heart hands", "amour merci love hands"],
    ["love-letter", "💌", "Lettre d’amour", "Love letter", "message amour love letter"],
    ["couple-kiss", "💏", "Baiser partagé", "A shared kiss", "couple amoureux kiss love"],
    ["loving-couple", "💑", "Couple amoureux", "Loving couple", "amour ensemble together love"],
  ]],
  ["hearts", "Cœurs", "Hearts", [
    ["red-heart", "❤️", "Cœur rouge", "Red heart", "amour love heart"],
    ["pink-heart", "🩷", "Cœur rose", "Pink heart", "amour love heart"],
    ["orange-heart", "🧡", "Cœur orange", "Orange heart", "amour love heart"],
    ["yellow-heart", "💛", "Cœur jaune", "Yellow heart", "amitie amour friendship love"],
    ["green-heart", "💚", "Cœur vert", "Green heart", "amour love heart"],
    ["blue-heart", "💙", "Cœur bleu", "Blue heart", "amour love heart"],
    ["light-blue-heart", "🩵", "Cœur bleu clair", "Light blue heart", "amour love heart"],
    ["purple-heart", "💜", "Cœur violet", "Purple heart", "amour love heart"],
    ["brown-heart", "🤎", "Cœur marron", "Brown heart", "amour love heart"],
    ["black-heart", "🖤", "Cœur noir", "Black heart", "amour love heart"],
    ["grey-heart", "🩶", "Cœur gris", "Grey heart", "amour gray love heart"],
    ["white-heart", "🤍", "Cœur blanc", "White heart", "amour love heart"],
    ["sparkling-heart", "💖", "Cœur scintillant", "Sparkling heart", "amour etoiles sparkle love"],
    ["growing-heart", "💗", "Cœur qui grandit", "Growing heart", "amour love heart"],
    ["beating-heart", "💓", "Cœur qui bat", "Beating heart", "amour battement heartbeat love"],
    ["revolving-hearts", "💞", "Cœurs enlacés", "Revolving hearts", "amour ensemble love together"],
    ["two-hearts", "💕", "Deux cœurs", "Two hearts", "amour love hearts"],
    ["cupid-heart", "💘", "Coup de foudre", "Cupid’s heart", "amour fleche crush arrow love"],
    ["gift-heart", "💝", "Cœur cadeau", "Gift heart", "amour cadeau present love"],
    ["heart-on-fire", "❤️‍🔥", "Cœur enflammé", "Heart on fire", "amour passion chaud hot love"],
  ]],
  ["flirt", "Flirt", "Flirt", [
    ["wink", "😉", "Clin d’œil", "Wink", "clin oeil complice flirt"],
    ["smirk", "😏", "Sourire malicieux", "Knowing smile", "coquin charme smirk flirt"],
    ["little-devil", "😈", "Petit diable", "Little devil", "coquin malice naughty devil"],
    ["grumpy-devil", "👿", "Diable contrarié", "Grumpy devil", "diable colere naughty angry"],
    ["biting-lip", "🫦", "Lèvre mordillée", "Biting lip", "levres charme lips flirt"],
    ["lipstick", "💄", "Rouge à lèvres", "Lipstick", "maquillage levres makeup lips"],
    ["lips", "👄", "Jolies lèvres", "Lovely lips", "bouche bisou mouth kiss"],
    ["fire", "🔥", "Ça chauffe", "Getting hot", "feu chaud flamme hot fire"],
    ["candle", "🕯️", "Aux chandelles", "Candlelight", "bougie romantique romantic candle"],
    ["rose", "🌹", "Une rose", "A rose", "fleur romantique romantic flower"],
    ["wilted-rose", "🥀", "Rose fanée", "Wilted rose", "fleur nostalgie flower wistful"],
    ["peeking", "🫣", "Je regarde quand même", "Taking a peek", "timide curiosite shy peek"],
    ["giggle", "🤭", "Petit rire complice", "A cheeky giggle", "rire coquin giggle cheeky"],
    ["secret", "🤫", "Notre secret", "Our secret", "chut discret silence shh"],
    ["playful-wink", "😜", "Clin d’œil joueur", "Playful wink", "langue coquin tongue playful"],
    ["playful-tongue", "😝", "Taquinerie", "Feeling playful", "langue taquiner tongue teasing"],
    ["hot-face", "🥵", "Coup de chaud", "Feeling hot", "chaleur chaud coquin hot spicy"],
    ["drooling", "🤤", "Ça donne envie", "Looking tempting", "envie gourmand charme drool tempting"],
    ["woozy", "🥴", "Tu me fais tourner la tête", "You make my head spin", "trouble charme woozy dizzy"],
    ["exhaling", "😮‍💨", "Petit soupir", "A little sigh", "souffle soupir soulagement breath sigh"],
    ["dizzy-eyes", "😵‍💫", "La tête qui tourne", "Head spinning", "vertige charme dizzy swirl"],
    ["eyes", "👀", "Je te regarde", "I’m watching", "regard yeux curiosite eyes look peek"],
    ["playful-taste", "👅", "Langue", "Tongue", "langue gourmand coquin tongue tease"],
  ]],
  ["double-meanings", "Doubles sens", "Double meanings", [
    ["peach", "🍑", "Pêche", "Peach", "peche fruit fesses booty bum flirt coquin"],
    ["eggplant", "🍆", "Aubergine", "Eggplant", "legume aubergine aubergines eggplant aubergine coquin naughty suggestif suggestive"],
    ["cucumber", "🥒", "Concombre", "Cucumber", "concombre courgette cornichon cucumber courgette zucchini pickle coquin naughty"],
    ["banana", "🍌", "Banane", "Banana", "banane fruit banana coquin naughty suggestif suggestive"],
    ["cherries", "🍒", "Cerises", "Cherries", "cerise cerises fruit cherry cherries coquin teasing"],
    ["carrot", "🥕", "Carotte", "Carrot", "carotte legume carrot coquin naughty"],
    ["melon", "🍈", "Melon", "Melon", "melon fruit gourmand tease"],
    ["watermelon", "🍉", "Pastèque", "Watermelon", "pasteque fruit gourmand juicy tease"],
    ["coconut", "🥥", "Noix de coco", "Coconut", "noix coco fruit coconut gourmand tease"],
    ["avocado", "🥑", "Avocat", "Avocado", "avocat fruit moitie avocado half tease"],
    ["corn", "🌽", "Maïs", "Corn", "mais epi legume corn cob coquin naughty"],
    ["mushroom", "🍄", "Champignon", "Mushroom", "champignon mushroom coquin naughty"],
    ["hot-dog", "🌭", "Hot-dog", "Hot dog", "saucisse sandwich sausage hotdog coquin naughty"],
    ["baguette", "🥖", "Baguette", "Baguette", "pain baguette bread coquin naughty"],
    ["pretzel", "🥨", "Bretzel", "Pretzel", "bretzel noeud torsade pretzel twist playful"],
    ["doughnut", "🍩", "Donut", "Doughnut", "donut beignet gourmand doughnut sweet tease"],
    ["lollipop", "🍭", "Sucette", "Lollipop", "sucette bonbon gourmand lollipop candy tease"],
    ["candy", "🍬", "Bonbon", "Candy", "bonbon sucre gourmand candy sweet treat"],
    ["honey", "🍯", "Pot de miel", "Honey pot", "miel douceur gourmand honey sweet tease"],
    ["milk", "🥛", "Verre de lait", "Glass of milk", "lait milk gourmand tease"],
    ["ice-cream", "🍦", "Glace à l’italienne", "Soft ice cream", "glace creme dessert ice cream gourmand sweet tease"],
    ["ice-cube", "🧊", "Glaçon", "Ice cube", "glacon froid fraicheur ice cold chill"],
    ["oyster", "🦪", "Huître", "Oyster", "huitre coquillage perle oyster shell pearl coquin tease"],
    ["chestnut", "🌰", "Châtaigne", "Chestnut", "chataigne marron chestnut nut gourmand tease"],
    ["chili", "🌶️", "Un peu épicé", "A little spicy", "piment chaud spicy hot"],
    ["droplet", "💧", "Une goutte", "A drop", "goutte eau drop water frais fresh"],
    ["sweat-drops", "💦", "Gouttes", "Droplets", "gouttes eau sueur splash sweat drops chaud hot coquin naughty"],
    ["wave-water", "🌊", "Vague", "Wave", "vague eau ocean wave water emporter feeling"],
    ["bathtub", "🛁", "Baignoire", "Bathtub", "bain mousse baignoire bath bubbles detente relax"],
    ["bed", "🛏️", "Lit", "Bed", "lit chambre draps bed bedroom nuit night"],
    ["high-heel", "👠", "Escarpin", "High heel", "talon chaussure escarpin heel shoe charme sexy"],
    ["bikini", "👙", "Bikini", "Bikini", "bikini maillot lingerie swimwear charme sexy"],
    ["underwear", "🩲", "Sous-vêtement", "Underwear", "sous vetement slip lingerie underwear briefs charme sexy"],
    ["feather", "🪶", "Plume", "Feather", "plume douceur chatouille feather soft tickle"],
    ["chains", "⛓️", "Chaînes", "Chains", "chaine chaines attache chains lien link coquin playful"],
    ["key", "🗝️", "Clé", "Key", "cle secret ouvrir key secret unlock"],
    ["lock", "🔒", "Cadenas", "Lock", "cadenas secret prive lock private"],
    ["magnet", "🧲", "Aimant", "Magnet", "aimant attraction attire magnet attraction"],
    ["battery", "🔋", "Plein d’énergie", "Full of energy", "batterie energie recharge battery energy charged"],
    ["electric-plug", "🔌", "Prise électrique", "Electric plug", "prise branche connexion plug connect coquin playful"],
    ["rocket", "🚀", "Décollage", "Taking off", "fusee decollage rocket takeoff ciel sky"],
    ["volcano", "🌋", "Volcan", "Volcano", "volcan lave eruption chaleur volcano lava hot"],
  ]],
  ["gestures", "Gestes", "Gestures", [
    ["thumbs-up", "👍", "Pouce levé", "Thumbs up", "oui accord yes ok"],
    ["thumbs-down", "👎", "Pouce baissé", "Thumbs down", "non desaccord no"],
    ["applause", "👏", "Bravo", "Applause", "applaudir bravo clap"],
    ["raised-hands", "🙌", "Mains en l’air", "Hands up", "victoire bravo hooray"],
    ["handshake", "🤝", "Poignée de main", "Handshake", "accord ensemble deal"],
    ["thank-you", "🙏", "Merci", "Thank you", "priere s il te plait please thanks"],
    ["strong", "💪", "En pleine forme", "Feeling strong", "force muscle courage"],
    ["okay-hand", "👌", "Parfait", "Perfect", "ok accord excellent"],
    ["peace", "✌️", "Paix", "Peace", "victoire victory peace"],
    ["fingers-crossed", "🤞", "Doigts croisés", "Fingers crossed", "chance espoir luck hope"],
    ["love-you-hand", "🤟", "Je t’aime en geste", "Love-you gesture", "amour mains love hands"],
    ["rock-on", "🤘", "Rock", "Rock on", "concert musique music"],
    ["call-me", "🤙", "Appelle-moi", "Call me", "telephone appel phone call"],
    ["wave", "👋", "Coucou", "Hello", "salut bonjour revoir hello goodbye"],
    ["open-hand", "🖐️", "Main ouverte", "Open hand", "bonjour cinq hello five"],
    ["stop-hand", "✋", "Un instant", "One moment", "stop attendre wait hand"],
    ["back-hand", "🤚", "Main levée", "Raised hand", "coucou hello hand"],
    ["finger-heart", "🫰", "Petit cœur des doigts", "Finger heart", "amour love fingers"],
    ["point-you", "🫵", "Toi", "You", "toi personne you"],
    ["point-left", "👈", "Par ici à gauche", "Over here, left", "direction gauche left"],
    ["point-right", "👉", "Par ici à droite", "Over here, right", "direction droite right"],
    ["point-up", "👆", "Juste au-dessus", "Just above", "direction haut up"],
    ["point-down", "👇", "Juste en dessous", "Just below", "direction bas down"],
    ["hand-raised", "🙋", "Moi !", "Me!", "question volontaire volunteer"],
    ["pinching-hand", "🤏", "Un tout petit peu", "Just a little", "pincer doigts petit pinching fingers little"],
    ["pinched-fingers", "🤌", "Doigts réunis", "Pinched fingers", "doigts main fingers hand gesture"],
    ["index-up", "☝️", "Un doigt levé", "One finger up", "index doigt haut finger up"],
    ["open-palms", "👐", "Mains ouvertes", "Open hands", "mains ouvertes calin open hands hug"],
    ["palms-up", "🤲", "Mains tendues", "Palms up", "mains tendre offrir recevoir hands offering receive"],
    ["palm-up", "🫴", "Main tendue", "Offering hand", "paume main tendre offrir palm hand offer"],
    ["palm-down", "🫳", "Paume vers le bas", "Palm down", "paume main bas palm hand down"],
    ["fist-bump", "👊", "Check du poing", "Fist bump", "poing check fist bump"],
    ["nail-polish", "💅", "Vernis à ongles", "Nail polish", "vernis ongles manicure nails polish charme"],
    ["selfie", "🤳", "Selfie", "Selfie", "selfie photo telephone camera phone"],
  ]],
  ["people", "Personnes", "People", [
    ["adult-person", "🧑", "Personne adulte", "Adult person", "personne adulte neutre non binaire person adult neutral nonbinary"],
    ["woman", "👩", "Femme", "Woman", "femme adulte woman adult"],
    ["man", "👨", "Homme", "Man", "homme adulte man adult"],
    ["curly-person", "🧑‍🦱", "Personne aux cheveux bouclés", "Person with curly hair", "personne adulte cheveux boucles curly hair person adult"],
    ["curly-woman", "👩‍🦱", "Femme aux cheveux bouclés", "Woman with curly hair", "femme adulte cheveux boucles curly hair woman adult"],
    ["curly-man", "👨‍🦱", "Homme aux cheveux bouclés", "Man with curly hair", "homme adulte cheveux boucles curly hair man adult"],
    ["bald-person", "🧑‍🦲", "Personne au crâne rasé", "Bald person", "personne adulte chauve crane rase bald person adult"],
    ["bearded-person", "🧔", "Personne à barbe", "Bearded person", "personne adulte barbe bearded person adult"],
    ["woman-dancing", "💃", "Femme qui danse", "Woman dancing", "femme danse dance dancing woman adulte adult"],
    ["man-dancing", "🕺", "Homme qui danse", "Man dancing", "homme danse dance dancing man adulte adult"],
    ["massage-person", "💆", "Un moment de détente", "Time to relax", "personne massage detente spa relax adult"],
    ["sauna-person", "🧖", "Au spa", "At the spa", "personne spa sauna vapeur relax adult"],
    ["bath-person", "🛀", "Dans le bain", "Taking a bath", "personne bain mousse bath bubbles relax adult"],
    ["shrug-person", "🤷", "Qui sait ?", "Who knows?", "personne hausse epaules shrug person"],
    ["facepalm-person", "🤦", "Oh là là", "Oh dear", "personne main front facepalm person"],
    ["women-heart", "👩‍❤️‍👩", "Deux femmes amoureuses", "Two women in love", "couple femmes amour lesbienne lgbt women love lesbian"],
    ["men-heart", "👨‍❤️‍👨", "Deux hommes amoureux", "Two men in love", "couple hommes amour gay lgbt men love"],
    ["woman-man-heart", "👩‍❤️‍👨", "Femme et homme amoureux", "Woman and man in love", "couple femme homme amour woman man love"],
    ["women-kiss", "👩‍❤️‍💋‍👩", "Baiser entre femmes", "Women kissing", "couple femmes bisou baiser lesbienne lgbt women kiss lesbian"],
    ["men-kiss", "👨‍❤️‍💋‍👨", "Baiser entre hommes", "Men kissing", "couple hommes bisou baiser gay lgbt men kiss"],
    ["woman-man-kiss", "👩‍❤️‍💋‍👨", "Baiser entre femme et homme", "Woman and man kissing", "couple femme homme bisou baiser woman man kiss"],
  ]],
  ["moods", "Humeurs", "Moods", [
    ["relieved", "😌", "Soulagé", "Relieved", "ouf calme relaxed"],
    ["thoughtful", "😔", "Pensif", "Thoughtful", "reflechir triste pensive"],
    ["disappointed", "😞", "Déçu", "Disappointed", "deception triste sad"],
    ["worried", "😟", "Inquiet", "Worried", "souci peur worry"],
    ["confused", "😕", "Perplexe", "Confused", "question perplexe confused"],
    ["slightly-sad", "🙁", "Un peu triste", "A little sad", "tristesse sadness"],
    ["sad", "☹️", "Triste", "Sad", "tristesse sadness"],
    ["struggling", "😣", "Je tiens bon", "Holding on", "effort courage persevere"],
    ["frustrated", "😖", "Contrarié", "Frustrated", "frustration frustration"],
    ["tired", "😫", "Épuisé", "Exhausted", "fatigue dormir tired"],
    ["weary", "😩", "À bout", "Feeling weary", "fatigue soupir sigh"],
    ["pleading", "🥺", "S’il te plaît", "Pretty please", "suppliant mignon puppy eyes"],
    ["crying", "😢", "Petite larme", "A little tear", "pleurer triste cry sad"],
    ["sobbing", "😭", "Gros chagrin", "Sobbing", "pleurer triste cry sad"],
    ["determined", "😤", "Déterminé", "Determined", "souffler fierte triumph"],
    ["angry", "😠", "Fâché", "Angry", "colere furieux mad"],
    ["furious", "😡", "Très en colère", "Furious", "colere rouge rage"],
    ["mind-blown", "🤯", "Incroyable", "Mind blown", "surprise wow amazing"],
    ["flushed", "😳", "Tout rouge", "Feeling flushed", "rougir surprise blush"],
    ["shocked", "😱", "Stupéfait", "Shocked", "peur surprise scream"],
    ["afraid", "😨", "Inquiet et surpris", "Feeling afraid", "peur effraye scared"],
    ["anxious", "😰", "Un peu nerveux", "A little anxious", "stress sueur nervous"],
    ["broken-heart", "💔", "Cœur brisé", "Broken heart", "tristesse amour heartbreak"],
    ["healing-heart", "❤️‍🩹", "Cœur qui guérit", "Healing heart", "reconfort guerir healing comfort"],
  ]],
  ["celebration", "Fête", "Celebration", [
    ["party-popper", "🎉", "C’est la fête", "Let’s celebrate", "fete confettis party"],
    ["confetti", "🎊", "Confettis", "Confetti", "fete party celebration"],
    ["balloon", "🎈", "Ballon", "Balloon", "fete anniversaire birthday"],
    ["gift", "🎁", "Petit cadeau", "A little gift", "cadeau surprise present"],
    ["ribbon", "🎀", "Joli ruban", "Pretty ribbon", "noeud cadeau bow gift"],
    ["disco", "🪩", "Boule disco", "Disco ball", "danser fete dance party"],
    ["cheers", "🥂", "À nous", "Cheers", "trinquer champagne toast"],
    ["champagne", "🍾", "Champagne", "Champagne", "bouteille fete bottle party"],
    ["wine", "🍷", "Un verre de vin", "A glass of wine", "soir verre wine evening"],
    ["cocktail", "🍸", "Cocktail", "Cocktail", "verre soiree drink evening"],
    ["tropical-drink", "🍹", "Cocktail fruité", "Tropical drink", "cocktail vacances holidays"],
    ["beer-cheers", "🍻", "Santé", "A toast", "biere trinquer beer cheers"],
    ["birthday-cake", "🎂", "Joyeux anniversaire", "Happy birthday", "gateau anniversaire cake"],
    ["cupcake", "🧁", "Petite douceur", "A sweet treat", "gateau doux sweet cake"],
    ["cake", "🍰", "Part de gâteau", "A slice of cake", "dessert gateau sweet"],
    ["music-notes", "🎶", "En musique", "With music", "musique chanter song"],
    ["music-note", "🎵", "Petite mélodie", "A little melody", "musique chanter song"],
    ["trophy", "🏆", "Tu as gagné", "You’re a winner", "victoire bravo winner"],
  ]],
  ["moments", "Petits moments", "Little moments", [
    ["sun", "☀️", "Soleil", "Sunshine", "bonjour matin good morning"],
    ["moon", "🌙", "Bonne nuit", "Good night", "lune soir moon evening"],
    ["star", "⭐", "Étoile", "Star", "briller etoile shine"],
    ["glowing-star", "🌟", "Étoile brillante", "Glowing star", "briller etoile shine"],
    ["sparkles", "✨", "Paillettes", "Sparkles", "briller magie glitter magic"],
    ["rainbow", "🌈", "Arc-en-ciel", "Rainbow", "couleurs bonheur colors happy"],
    ["cloud", "☁️", "Petit nuage", "Little cloud", "ciel reve sky dream"],
    ["rain", "🌧️", "Petite pluie", "A little rain", "pluie cocooning rain cozy"],
    ["cherry-blossom", "🌸", "Fleur de cerisier", "Cherry blossom", "fleur printemps flower spring"],
    ["hibiscus", "🌺", "Fleur tropicale", "Tropical flower", "fleur vacances flower holidays"],
    ["tulip", "🌷", "Tulipe", "Tulip", "fleur printemps flower spring"],
    ["bouquet", "💐", "Bouquet pour toi", "A bouquet for you", "fleurs cadeau flowers gift"],
    ["clover", "🍀", "Porte-bonheur", "Good luck", "chance trefle lucky"],
    ["butterfly", "🦋", "Papillon", "Butterfly", "leger liberte freedom"],
    ["cat", "🐱", "Petit chat", "Little cat", "chaton mignon kitten cute"],
    ["dog", "🐶", "Petit chien", "Little dog", "chiot mignon puppy cute"],
    ["bear", "🐻", "Petit ours", "Little bear", "peluche calin teddy hug"],
    ["coffee", "☕", "Pause café", "Coffee break", "cafe matin chaud morning warm"],
    ["chocolate", "🍫", "Chocolat", "Chocolate", "douceur gourmand sweet treat"],
    ["strawberry", "🍓", "Fraise", "Strawberry", "fruit douceur sweet"],
  ]],
  ["combos", "Combinaisons", "Combinations", [
    ["hot-kiss", "😘🔥", "Bisou brûlant", "A fiery kiss", "bisous chaud passion hot kiss"],
    ["devil-fire", "😈🔥", "Humeur malicieuse", "Feeling mischievous", "diable coquin chaud naughty hot"],
    ["kiss-heart", "💋❤️", "Baiser du cœur", "A heartfelt kiss", "bisou amour kiss love"],
    ["wink-kiss", "😉💋", "Clin d’œil et bisou", "A wink and a kiss", "complice bisou flirt kiss"],
    ["lip-fire", "🫦🔥", "Ça chauffe un peu", "Getting a little warm", "levre chaud lips hot"],
    ["peach-sparkles", "🍑✨", "Pêche pétillante", "Sparkling peach", "peche brillant flirt peach"],
    ["passion-kiss", "❤️‍🔥😘", "Cœur passionné et bisou", "A passionate heart and kiss", "amour passion bisou love kiss"],
    ["rose-kiss", "🌹💋", "Une rose et un baiser", "A rose and a kiss", "romantique fleur romantic flower"],
    ["loving-hearts", "🥰💞", "Plein de tendresse", "Lots of affection", "amour tendre love sweet"],
    ["sparkling-love", "🫶✨", "Un peu de magie pour toi", "A little magic for you", "amour paillettes love glitter"],
    ["cheeky-wink", "😏😉", "Petit jeu complice", "A knowing wink", "malice taquin flirt teasing"],
    ["double-fire", "🔥🔥", "Très chaud", "Extra hot", "feu flamme fire flame"],
    ["double-kiss", "💋💋", "Deux bisous", "Two kisses", "bisous baisers kisses"],
    ["dance-night", "💃🪩", "On danse", "Let’s dance", "danser soiree dance night"],
    ["goodnight-kiss", "🌙😘", "Bonne nuit, bisous", "Good night, kisses", "soir lune evening moon"],
    ["sunny-smile", "☀️😊", "Bonjour en douceur", "A sunny hello", "bonjour matin good morning"],
    ["sparkling-cheers", "🥂✨", "À notre soirée", "Here’s to our evening", "trinquer soiree cheers evening"],
    ["wrapped-gift", "🎁🎀", "Surprise pour toi", "A surprise for you", "cadeau surprise present"],
    ["spicy-peach", "🍑🌶️", "Pêche épicée", "Spicy peach", "peche piment fruit coquin peach spicy naughty"],
    ["cheeky-eggplant", "🍆😏", "Aubergine malicieuse", "Cheeky eggplant", "aubergine coquin eggplant cheeky suggestif suggestive"],
    ["cheeky-cucumber", "🥒😉", "Concombre complice", "A knowing cucumber", "concombre courgette coquin cucumber zucchini cheeky"],
    ["cherry-kiss", "🍒💋", "Bisou cerise", "Cherry kiss", "cerise bisous gourmand cherry kiss sweet"],
    ["sweet-tease", "🍯😋", "Douce tentation", "Sweet temptation", "miel gourmand tentation honey sweet tease"],
    ["hot-cold", "🔥🧊", "Chaud et froid", "Hot and cold", "chaud froid glacon jeu hot cold ice playful"],
    ["feather-wink", "🪶😉", "Chatouille complice", "A playful tickle", "plume chatouille coquin feather tickle cheeky"],
    ["magnetic-attraction", "🧲❤️‍🔥", "Attraction magnétique", "Magnetic attraction", "aimant attraction passion magnet attraction"],
    ["night-in", "🛏️🌙", "Soirée sous les draps", "A night under the covers", "lit draps nuit coquin bed night covers naughty"],
    ["dance-together", "💃🕺", "On danse à deux", "Let’s dance together", "danse couple fete dance together party"],
  ]],
];

const invalid = () => { throw new TypeError("invalid_emoji"); };
const normalize = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("œ", "oe").replaceAll("æ", "ae");
const languageIndex = (language) => language === "fr" ? 2 : language === "en" ? 3 : invalid();
const skinTones = [
  ["default", "", "Couleur par défaut", "Default color"],
  ["light", "🏻", "Peau claire", "Light skin tone"],
  ["medium-light", "🏼", "Peau moyennement claire", "Medium-light skin tone"],
  ["medium", "🏽", "Peau intermédiaire", "Medium skin tone"],
  ["medium-dark", "🏾", "Peau moyennement foncée", "Medium-dark skin tone"],
  ["dark", "🏿", "Peau foncée", "Dark skin tone"],
];
const tonesById = new Map(skinTones.map((tone) => [tone[0], tone]));
// Only the modifier bases used by this catalogue. A modifier replaces a base's
// optional VS16 and precedes its ZWJ, while heart selectors stay untouched.
// Generic kiss/couple and handshake have their own RGI single-modifier forms.
// https://www.unicode.org/Public/emoji/16.0/emoji-test.txt
const toneBases = /([☝✌✋🖐👍👎👏🙌🤝🙏💪👌🤞🤟🤘🤙👋🤚🫰🫵👈👉👆👇🙋🤏🤌👐🤲🫴🫳👊💅🤳🫶🧑👩👨🧔💃🕺💆🧖🛀🤷🤦💏💑])\uFE0F?/gu;
const toneFor = (id) => typeof id === "string" && tonesById.has(id) ? tonesById.get(id) : invalid();
const withSkinTone = (text, modifier) => modifier ? text.replace(toneBases, (_, base) => base + modifier) : text;
const catalogue = groups.flatMap(([category, , , rows]) => rows.map(([id, text, fr, en, aliases]) => Object.freeze({
  id, text, fr, en, category, search: normalize([id.replaceAll("-", " "), text, fr, en, aliases].join(" ")),
})));
const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
const categoryIds = new Set(["all", ...groups.map(([id]) => id)]);

export function emojiCategories(language) {
  const index = languageIndex(language);
  return [{ id: "all", label: language === "fr" ? "Tous" : "All" },
    ...groups.map((group) => ({ id: group[0], label: group[index - 1] }))];
}

export function emojiSkinTones(language) {
  const index = languageIndex(language);
  return skinTones.map((tone) => ({ id: tone[0], text: "✋" + tone[1], label: tone[index] }));
}

export function emojiOptions(language, { category = "all", query = "", skinTone = "default" } = {}) {
  const index = languageIndex(language), tone = toneFor(skinTone);
  if (!categoryIds.has(category) || typeof query !== "string" || query.length > 128 || !query.isWellFormed()
    || /[\p{Cc}]/u.test(query)) invalid();
  const words = normalize(query).trim().split(/\s+/u).filter(Boolean);
  return catalogue.filter((entry) => category === "all" || entry.category === category).flatMap((entry) => {
    const text = withSkinTone(entry.text, tone[1]), changed = text !== entry.text;
    const search = entry.search + " " + normalize(text + (changed ? " " + tone[2] + " " + tone[3] : ""));
    return words.every((word) => search.includes(word)) ? [{
      id: entry.id, text, label: entry[language] + (changed ? " — " + tone[index] : ""), category: entry.category,
    }] : [];
  });
}

function boundary(value, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index > value.length) return false;
  return index === 0 || index === value.length || !(value.charCodeAt(index - 1) >= 0xd800 && value.charCodeAt(index - 1) <= 0xdbff
    && value.charCodeAt(index) >= 0xdc00 && value.charCodeAt(index) <= 0xdfff);
}

export function insertEmoji(draft, emojiId, options = {}) {
  if (typeof draft !== "string" || !draft.isWellFormed() || typeof emojiId !== "string" || !byId.has(emojiId)
    || !options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((name) => !["start", "end", "image", "skinTone"].includes(name))) invalid();
  const { start = draft.length, end = start, image = false, skinTone = "default" } = options;
  const tone = toneFor(skinTone);
  if (!boundary(draft, start) || !boundary(draft, end) || start > end || typeof image !== "boolean") invalid();
  const text = withSkinTone(byId.get(emojiId).text, tone[1]);
  const value = draft.slice(0, start) + text + draft.slice(end);
  if (!(image ? validCaption(value) : validBody(value))) throw new RangeError("emoji_draft_limit");
  return { value, caret: start + text.length };
}
