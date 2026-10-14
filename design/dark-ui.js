/* Dark presentation layer. The offline prototype model remains the source of demo state. */
"use strict";
(() => {
  const svg = path => `<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const icons = {
    chat:svg('<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5A8.5 8.5 0 0 1 11.5 3h1A8.5 8.5 0 0 1 21 11.5Z"/><path d="M8 9h8M8 13h5"/>'),
    image:svg('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
    send:svg('<path d="m5 12 14-7-6 15-2-7-6-1Z"/><path d="m11 13 8-8"/>'),
    people:svg('<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M19 14a5 5 0 0 1 2 4v3"/>'),
    smile:svg('<circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0M8 8.5h.01M16 8.5h.01"/>'),
    plus:svg('<path d="M12 5v14M5 12h14"/>'),
    arrow:svg('<path d="M5 12h14m-5-5 5 5-5 5"/>'),
    settings:svg('<path d="M5 7h14M5 17h14"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="2" fill="currentColor" stroke="none"/>'),
    back:svg('<path d="m14 5-7 7 7 7"/>'),
    lock:svg('<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>')
  };
  const originalRender = render;
  const originalChat = chat;
  const originalArt = art;
  let lastView = '', lastClient = '', lastCount = 0;
  let frame = 0;
  const root = document.documentElement;

  // A CSS-only placeholder for unavailable demo media, not an additional hosted image.
  art = function(media) {
    if (portrait && media.id === 'm1') return originalArt(media);
    const title = ({m1:t('Lumière naturelle','Natural light'),m2:t('Un instant','A moment'),m3:t('Notes du soir','Evening notes')})[media.id] ?? media.title;
    return `<div class="art tone-${Number(media.tone)||1}"><span><span class="art-label">${esc(title)}</span><span class="art-caption">${t('MÉDIA DE DÉMONSTRATION','DEMONSTRATION MEDIA')}</span></span></div>`;
  };

  drawHome = function() {
    return `<section class="landing"><div class="hero-copy"><span class="eyebrow entrance-label">${icons.lock}${t('VOTRE INVITATION À UN ESPACE À PART','YOUR INVITATION TO SOMETHING PERSONAL')}</span><h1>${t('Un message.<em>Un peu plus près.</em>','A message.<em>A little closer.</em>')}</h1><p class="lead">${t('Quelques mots, un sourire, un instant partagé. Retrouvez Jessie dans un espace qui prend le temps de la conversation.','A few words, a smile, a shared moment. Connect with Jessie in a space that makes time for conversation.')}</p><div class="invite-box"><label class="check"><input type="checkbox" id="age-declaration" ${state.ageDeclared?'checked':''}>${t('Je déclare avoir au moins 18 ans.','I declare that I am at least 18 years old.')}</label><button class="btn primary" id="enter-demo" ${state.ageDeclared?'':'disabled'}>${t('Découvrir la conversation','Explore the conversation')}${icons.arrow}</button><span class="small muted">${t('Aperçu uniquement. Aucun compte créé. Cette déclaration ne vérifie pas l’âge.','Preview only. No account is created. This declaration does not verify age.')}</span></div><div class="entrance-rule">${t('Sur invitation. À votre rythme.','By invitation. At your own pace.')}</div></div><div class="hero-portrait">${portrait?`<img src="${esc(portrait)}" alt="${t('Portrait de référence fourni pour JessieMessage','Reference portrait provided for JessieMessage')}">`:'<span class="portrait-fallback">J.</span>'}<div class="photo-note"><span class="eyebrow">JESSIEMESSAGE</span><br><strong>${t('Un espace à nous.','A space for us.')}</strong><p>${t('Une conversation, loin du bruit.','A conversation, away from the noise.')}</p></div></div></section>`;
  };

  renderMessages = function(id, clientView) {
    const messages = state.messages[id];
    const timeline = `<div class="date">${t('AUJOURD’HUI · CONVERSATION FICTIVE','TODAY · FICTIONAL CONVERSATION')}</div>`;
    return timeline + (messages.length ? messages.map(message => {
      const own = clientView ? message.from === 'client' : message.from === 'jessie';
      const media = message.media.map(mid => state.media.find(asset => asset.id === mid)).filter(Boolean);
      const files = media.map(asset => `<button class="media-thumb" data-dark-open="${esc(asset.id)}" aria-label="${t('Agrandir le média fictif : ','Enlarge demo media: ')}${esc(asset.title)}">${art(asset)}</button>`).join('');
      return `<div class="message ${own?'own':''} ${message.from==='jessie'?'from-jessie':'from-client'}"><div class="bubble ${media.length?'with-media':''}">${message.text?`<p class="message-copy">${esc(message.text)}</p>`:''}${files}</div><div class="time">${esc(message.time)}</div></div>`;
    }).join('') : `<div class="empty">${t('Votre prochain message commence ici.','Your next conversation starts here.')}</div>`);
  };

  chat = function(clientView) {
    const html = originalChat(clientView);
    return html.replace('Conversation de démonstration','Votre conversation · aperçu').replace('Demo conversation','Your conversation · preview');
  };

  function sidePanel() {
    return `<aside class="client-aside"><div class="aside-portrait">${portrait?`<img src="${esc(portrait)}" alt="">`:'<span class="portrait-fallback">J.</span>'}</div><div class="aside-copy"><span class="eyebrow">${t('VOTRE ESPACE PERSONNEL','YOUR PERSONAL SPACE')}</span><h2>Jessie.</h2><p>${t('Un mot ou un moment à partager. Prenez votre temps, vous êtes au bon endroit.','A word or a moment to share. Take your time, you’re in the right place.')}</p><button class="btn" data-action="gallery">${icons.image}${t('Nos médias partagés','Our shared media')}</button><button class="btn" data-action="preferences">${icons.settings}${t('Mes préférences','My preferences')}</button></div></aside>`;
  }

  function growComposer() {
    const textarea = document.querySelector('#message-input');
    if (!textarea) return;
    textarea.style.height = '48px';
    const height = Math.min(128,Math.max(48,textarea.scrollHeight+2));
    textarea.style.height = `${height}px`;
    textarea.style.overflowY = height >= 128 ? 'auto' : 'hidden';
  }

  function measure() {
    const viewport = window.visualViewport;
    // Do not counteract pinch-zoom: the user must still be able to magnify the page.
    if (!viewport || Math.abs(viewport.scale-1)<0.02) {
      root.style.setProperty('--app-height',`${Math.round(viewport?.height ?? window.innerHeight)}px`);
      document.body.dataset.keyboard = String(!!viewport && window.innerHeight-viewport.height>150);
    }
    root.style.setProperty('--toolbar-height',`${Math.ceil(document.querySelector('.toolbar').getBoundingClientRect().height)}px`);
    const inbox = document.querySelector('.inbox');
    if(inbox) root.style.setProperty('--inbox-top',`${Math.ceil(inbox.getBoundingClientRect().top+window.scrollY)}px`);
    const nav = document.querySelector('.side-nav');
    if(nav && window.matchMedia('(max-width:780px)').matches) {
      root.style.setProperty('--bottom-nav-height',`${Math.ceil(nav.getBoundingClientRect().height)}px`);
    }
  }
  function scheduleMeasure() {
    if(frame) return;
    frame=requestAnimationFrame(()=>{frame=0;measure();});
  }

  render = function() {
    const previous=document.querySelector('#messages');
    const scrollTop=previous?.scrollTop??0;
    const nearEnd=previous ? previous.scrollHeight-previous.clientHeight-scrollTop<35 : true;
    const viewKey=`${ui.view}:${ui.section}`;
    const sameThread=lastView===viewKey && lastClient===ui.client;
    const count=state.messages[ui.client]?.length??0;
    const newMessage=count!==lastCount;
    document.body.dataset.nightView=ui.view;
    document.body.dataset.panel=ui.section;
    document.body.dataset.chat=String(ui.mobileChat);
    originalRender();
    document.title=t('JessieMessage — Nuit · aperçu interactif','JessieMessage — Night · interactive preview');
    document.querySelector('#prototype-label').textContent=t('Nuit V2 · données fictives','Night V2 · fictional data');
    document.querySelector('[data-view="client"]').textContent=t('Messages','Messages');
    document.querySelector('[data-view="admin"]').textContent='Admin';
    document.querySelector('#header-note').textContent=t('MESSAGERIE PERSONNELLE · SUR INVITATION','PERSONAL MESSENGER · INVITATION ONLY');
    if(ui.view==='client') {
      document.querySelector('.client-intro')?.remove();
      document.querySelector('.client-wrap').insertAdjacentHTML('afterbegin',sidePanel());
    }
    const actionIcons={gallery:'image',preferences:'settings',attach:'plus',emoji:'smile',back:'back'};
    for(const button of document.querySelectorAll('.chat [data-action]')) {
      const name=actionIcons[button.dataset.action];
      if(name) button.innerHTML=icons[name];
    }
    const send=document.querySelector('#message-form button[type="submit"]');
    if(send) send.innerHTML=icons.send;
    const navIcons={messages:'chat',media:'image',broadcast:'send',access:'people'};
    for(const button of document.querySelectorAll('.side-nav [data-section]')) {
      const decoration=button.querySelector('span');
      if(decoration) decoration.outerHTML=icons[navIcons[button.dataset.section]];
      button.setAttribute('aria-current',button.dataset.section===ui.section?'page':'false');
    }
    growComposer();
    measure();
    const next=document.querySelector('#messages');
    if(next) next.scrollTop=sameThread && !newMessage && !nearEnd ? scrollTop : next.scrollHeight;
    lastView=viewKey;lastClient=ui.client;lastCount=count;
  };

  document.addEventListener('input',event=>{if(event.target.id==='message-input')growComposer();});
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-dark-open]');
    if(!button) return;
    // This is a demo media selector, not production permission enforcement.
    const id=button.dataset.darkOpen;
    if(!state.messages[ui.client].some(message=>message.media.includes(id))) return;
    const asset=state.media.find(media=>media.id===id);
    if(!asset) return;
    modal(asset.title,`<div class="lightbox-art">${art(asset)}</div><p class="lightbox-caption">${t('Média de démonstration · aucun partage réel.','Demonstration media · no real sharing.')}</p>`);
  });
  window.addEventListener('resize',scheduleMeasure,{passive:true});
  window.visualViewport?.addEventListener('resize',scheduleMeasure,{passive:true});
  window.visualViewport?.addEventListener('scroll',scheduleMeasure,{passive:true});
  if('ResizeObserver' in window) new ResizeObserver(scheduleMeasure).observe(document.querySelector('.toolbar'));
  // Expose only pure design tokens for automated contrast and layout checks.
  globalThis.JessieNight = Object.freeze({version:'0.3.0',scheme:'dark',palette:Object.freeze({background:'#100d12',surface:'#1b161e',text:'#f5eef2',muted:'#bcaebb',wine:'#71354f',champagne:'#d8b999'})});
  render();
})();
