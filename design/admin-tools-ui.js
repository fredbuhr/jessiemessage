/* UI extension for the offline workbench; never a production authorization layer. */
"use strict";
(() => {
  const A = JessieAdmin;
  A.initialize(state);
  const panel = {tab:"members",query:""};
  const originalDemo = JessieDemo;
  const originalAdmin = drawAdmin;
  const originalBroadcast = broadcast;
  const originalProfile = showProfile;
  const originalSend = sendDemo;
  const date = value => value == null ? t("Sans échéance","No expiry") : new Date(value).toLocaleDateString(lang==="fr"?"fr-FR":"en-GB",{day:"2-digit",month:"short",year:"numeric"});
  const labels = status => ({pending:t("En attente","Pending"),used:t("Activée · démo","Activated · demo"),revoked:t("Révoquée","Revoked"),expired:t("Expirée","Expired"),active:t("Actif","Active"),suspended:t("Suspendu","Suspended")})[status];
  const statusOf = c => A.hasAccess(c) ? "active" : c.active ? "expired" : "suspended";
  const statusBadge = status => `<span class="badge ${["pending","expired","suspended","revoked"].includes(status)?"warn":""}">${esc(labels(status))}</span>`;
  function groupName(value) { return value.startsWith("group:") ? state.groups.find(g=>g.id===value.slice(6))?.name ?? t("Groupe supprimé","Deleted group") : value === "all" ? t("Tous les actifs","All active members") : value; }
  function visibleGroups(c) { return state.groups.filter(g=>g.memberIds.includes(c.id)).map(g=>g.name); }
  function selectMembers(selected=[]) {
    return `<div class="member-choices">${state.clients.map(c=>`<label class="check"><input type="checkbox" name="member" value="${esc(c.id)}" ${selected.includes(c.id)?"checked":""}><span>${esc(c.name)} <small class="muted">${A.hasAccess(c)?"":t("· accès inactif","· inactive access")}</small></span></label>`).join("")}</div>`;
  }
  // All delivery paths still run through the original duplicate/marketing rules.
  globalThis.JessieDemo = Object.freeze({...originalDemo,
    plan(s,options={}) {const scope=A.scopedDelivery(s,options);return originalDemo.plan(scope.state,scope.options);},
    dispatch(s,options,key) {
      if(s.campaigns.some(c=>c.key===key))return 0;
      const scope=A.scopedDelivery(s,options);
      const planned=originalDemo.plan(scope.state,scope.options);
      const count=originalDemo.dispatch(scope.state,scope.options,key);
      const campaign=s.campaigns.find(c=>c.key===key);
      if(campaign)Object.assign(campaign,{createdAt:Date.now(),audience:groupName(options.group??"all"),purpose:options.purpose??"service",duplicates:planned.reduce((n,r)=>n+r.duplicates,0),excluded:planned.filter(r=>r.skip).length,mediaIds:[...new Set(options.mediaIds??[])],text:(options.text??"").slice(0,4000)});
      return count;
    }
  });
  const style=document.createElement("style");
  style.textContent=`
    .management-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 20px}.management-tabs button{min-height:40px;padding:8px 14px;border:1px solid var(--line);border-radius:10px;font-size:12px}.management-tabs .active{background:var(--green);color:white;border-color:var(--green)}
    .management-top{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:18px;flex-wrap:wrap}.management-top .search{max-width:270px}.management-top p{font-size:12px;color:var(--muted);margin:0}.member-row{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) auto;gap:18px;align-items:center;padding:18px 20px;border-top:1px solid var(--line)}.member-row:first-child{border:0}.member-meta{min-width:0}.member-meta strong{font-size:13px;overflow-wrap:anywhere}.member-meta p{font-size:11px;margin:3px 0 0;color:var(--muted);overflow-wrap:anywhere}.member-row .row{min-width:0}.member-row .avatar{width:38px;height:38px}.access-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.access-card{padding:22px;min-width:0}.access-card h3{font-size:15px;margin:0;overflow-wrap:anywhere}.access-card p{font-size:12px;color:var(--muted);margin:14px 0;overflow-wrap:anywhere}.access-card .row{flex-wrap:wrap}.member-choices{display:grid;gap:12px;max-height:240px;overflow:auto;border:1px solid var(--line);padding:14px;border-radius:12px}.member-choices .check{font-size:13px}.management-note{font-size:11px;color:var(--muted);line-height:1.7;margin:18px 0}.demo-link{font-family:ui-monospace,monospace;font-size:11px;width:100%;background:var(--paper)}.access-controls{margin-top:20px;padding-top:20px;border-top:1px solid var(--line)}.access-controls .row{flex-wrap:wrap}.dispatch-history{padding:20px 24px;margin-top:20px}.dispatch-history summary{cursor:pointer;font-size:13px;font-weight:600;min-height:32px}.receipt{padding:16px 0;border-top:1px solid var(--line)}.receipt strong{font-size:12px}.receipt p{font-size:11px;color:var(--muted);margin:5px 0;overflow-wrap:anywhere}.management-empty{padding:44px 24px;text-align:center}.management-empty h3{font-family:Georgia,serif;font-size:24px;font-weight:400}.management-empty p{font-size:13px;color:var(--muted)}.management-actions{display:flex;gap:7px;flex-wrap:wrap}.management-note strong{font-weight:650}.group-heading{display:flex;align-items:start;justify-content:space-between;gap:12px}.copy-feedback{font-size:11px;color:var(--green);min-height:20px;margin-top:8px}.identity-description{font-size:11px;line-height:1.7;color:var(--muted)}
    @media(max-width:780px){.side-nav button{flex:1 1 0;min-width:0;flex-direction:column;gap:3px;font-size:10px;padding:8px 2px}.side-nav button span{font-size:15px}.access-grid{grid-template-columns:1fr}.member-row{grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:16px}.member-row>.member-meta{grid-row:2;grid-column:1/-1}.management-tabs{gap:5px}.management-tabs button{padding:8px 10px}.access-card{padding:19px}.dispatch-history{padding:17px}.management-top .search{max-width:none}}
  `;
  document.head.append(style);

  function members() {
    const clients=state.clients.filter(c=>`${c.name} ${c.tags.join(" ")} ${visibleGroups(c).join(" ")}`.toLocaleLowerCase().includes(panel.query.toLocaleLowerCase()));
    return `<div class="management-top"><p>${state.clients.filter(c=>A.hasAccess(c)).length} ${t("membres actifs · données fictives","active members · fictional data")}</p><input class="search" id="member-search" maxlength="80" aria-label="${t("Rechercher un membre","Find a member")}" placeholder="${t("Nom, tag ou groupe…","Name, tag or group…")}" value="${esc(panel.query)}"></div><div class="panel">${clients.length?clients.map(c=>`<article class="member-row"><div class="row">${avatar(c.name)}<div class="member-meta"><strong>${esc(c.name)}</strong><p>${c.tags.map(esc).join(" · ")||t("Aucun tag","No tags")}</p></div></div><div class="member-meta">${statusBadge(statusOf(c))}<p>${c.accessUntil==null?t("Accès sans échéance","Access without expiry"):t("Accès jusqu’au ","Access until ")+date(c.accessUntil)}${visibleGroups(c).length?" · "+visibleGroups(c).map(esc).join(", "):""}</p>${c.reminder?`<p>${t("Suivi : ","Follow up: ")}${esc(c.reminder)}</p>`:""}</div><button class="btn small-btn" data-manage="details" data-id="${esc(c.id)}">${t("Gérer","Manage")}</button></article>`).join(""):`<div class="empty">${t("Aucun membre trouvé.","No matching members.")}</div>`}</div>`;
  }
  function invitations() {
    return `<p class="management-note">${t("Une invitation par personne. L’expiration du lien et la durée d’accès à la messagerie sont deux réglages distincts.","One invitation per person. Link expiry and duration of messaging access are separate settings.")}</p>${state.invitations.length?`<div class="access-grid">${[...state.invitations].reverse().map(invite=>`<article class="panel access-card"><div class="group-heading"><h3>${esc(invite.name)}</h3>${statusBadge(A.invitationStatus(invite))}</div><p>${t("Invitation valable jusqu’au ","Invitation valid until ")}${date(invite.expiresAt)}<br>${t("Accès après activation : ","Access after activation: ")}${invite.accessDays==null?t("sans échéance","no expiry"):invite.accessDays+" "+t("jours","days")}</p><div class="management-actions"><button class="btn small-btn" data-manage="invite-details" data-id="${esc(invite.id)}">${t("Voir l’invitation","View invitation")}</button><button class="btn small-btn" data-manage="revoke" data-id="${esc(invite.id)}" ${A.invitationStatus(invite)!=="pending"?"disabled":""}>${t("Révoquer","Revoke")}</button></div></article>`).join("")}</div>`:`<div class="panel management-empty"><h3>${t("Votre prochain échange commence ici.","Your next conversation starts here.")}</h3><p>${t("Créez une invitation fictive pour tester le parcours.","Create a fictional invitation to test the journey.")}</p><button class="btn primary" data-manage="create-invite">${t("Créer une invitation","Create an invitation")}</button></div>`}`;
  }
  function groups() {
    return `<div class="management-top"><p>${t("Des sélections privées, jamais des salons de discussion.","Private recipient lists, never shared chat rooms.")}</p><button class="btn small-btn" data-manage="create-group">＋ ${t("Nouveau groupe","New group")}</button></div><div class="access-grid">${state.groups.map(g=>`<article class="panel access-card"><div class="group-heading"><h3>${esc(g.name)}</h3><span class="badge">${g.memberIds.length} ${t("membres","members")}</span></div><p>${g.memberIds.map(id=>esc(state.clients.find(c=>c.id===id)?.name??"")).join(", ")||t("Aucun membre pour le moment.","No members yet.")}</p><div class="management-actions"><button class="btn small-btn" data-manage="edit-group" data-id="${esc(g.id)}">${t("Modifier","Edit")}</button><button class="btn small-btn soft" data-manage="send-group" data-id="${esc(g.id)}">${t("Préparer un envoi","Prepare a send")}</button></div></article>`).join("")}</div><p class="management-note">${t("Les tags décrivent un membre. Un groupe rassemble les destinataires que vous choisissez. Un même membre peut appartenir à plusieurs groupes.","Tags describe a member. A group contains recipients you select. One member may belong to several groups.")}</p>`;
  }
  function accessView() {
    return `<div class="management-tabs" role="group" aria-label="${t("Gestion des accès","Access management")}">${["members","invitations","groups"].map((key,i)=>`<button class="${panel.tab===key?"active":""}" data-manage="tab" data-id="${key}" aria-pressed="${panel.tab===key}">${[t("Membres","Members"),t("Invitations","Invitations"),t("Groupes privés","Private groups")][i]}</button>`).join("")}</div>${panel.tab==="members"?members():panel.tab==="invitations"?invitations():groups()}<p class="management-note">${t("Atelier : ces actions sont simulées dans ce navigateur. Aucun compte réel n’est créé et les données disparaissent au rechargement.","Workshop: actions are simulated in this browser. No real account is created; data disappears on reload.")}</p>`;
  }
  drawAdmin = function() {
    if(ui.section!=="access")return originalAdmin().replace('<p class="aside-note">',`<button data-section="access"><span aria-hidden="true">♙</span>${t("Accès","Access")}</button><p class="aside-note">`);
    return `<section class="workspace"><nav class="side-nav" aria-label="${t("Outils administrateur fictifs","Demo admin tools")}"><p class="eyebrow">${t("ESPACE JESSIE","JESSIE’S SPACE")}</p>${["messages","media","broadcast","access"].map((s,i)=>`<button data-section="${s}" class="${s===ui.section?"active":""}"><span aria-hidden="true">${["◯","▧","↗","♙"][i]}</span>${[t("Messages","Messages"),t("Médiathèque","Media library"),t("Diffusion","Broadcast"),t("Accès","Access")][i]}</button>`).join("")}<p class="aside-note">${t("Les groupes et les notes restent dans votre espace. Aucun membre ne voit les autres.","Groups and notes stay in your workspace. Members cannot see one another.")}</p></nav><div class="workspace-content"><div class="workspace-title"><div><h2>${t("À chacun son accès.","A personal way in.")}</h2><p>${t("Inviter, organiser, garder le lien.","Invite, organise, stay connected.")}</p></div><button class="btn small-btn" data-manage="create-invite">＋ ${t("Invitation","Invitation")}</button></div>${accessView()}</div></section>`;
  };
  broadcast = function() {
    let html=originalBroadcast();
    const groupOptions=state.groups.map(g=>`<option value="group:${esc(g.id)}" ${ui.group===`group:${g.id}`?"selected":""}>${esc(g.name)}</option>`).join("");
    html=html.replace('</select>',`<optgroup label="${t("Groupes privés","Private groups")}">${groupOptions}</optgroup></select>`);
    const history=state.campaigns.filter(c=>c.createdAt).slice(-8).reverse();
    return html+`<details class="panel dispatch-history" ${history.length?"open":""}><summary>${t("Journal des envois simulés","Simulated delivery history")} · ${history.length}</summary>${history.length?history.map(c=>`<article class="receipt"><strong>${esc(c.audience)} · ${c.recipients.length} ${t("destinataires","recipients")}</strong><p>${esc(c.text||t("Médias uniquement","Media only"))}</p><p>${c.recipients.map(id=>esc(state.clients.find(x=>x.id===id)?.name??id)).join(", ")||t("Aucun envoi","No delivery")} · ${c.duplicates} ${t("doublon(s) repéré(s)","duplicate(s) detected")} · ${date(c.createdAt)}</p></article>`).join(""):`<p class="management-note">${t("Le prochain envoi apparaîtra ici, avec ses destinataires et les doublons retirés.","Your next delivery will appear here, with its recipients and excluded duplicates.")}</p>`}</details>`;
  };
  showProfile = function() {
    originalProfile();
    const c=state.clients.find(x=>x.id===ui.client);
    const extra=document.createElement("div");extra.className="access-controls";
    extra.innerHTML=`<div class="row between"><h3>${t("Accès à la messagerie","Messaging access")}</h3>${statusBadge(statusOf(c))}</div><p class="small muted">${c.accessUntil==null?t("Sans échéance","No expiry"):t("Jusqu’au ","Until ")+date(c.accessUntil)}</p><div class="row"><button class="btn small-btn" data-manage="toggle-access" data-id="${esc(c.id)}">${c.active?t("Suspendre","Suspend"):t("Réactiver","Reactivate")}</button>${c.accessUntil!=null?`<button class="btn small-btn" data-manage="renew" data-id="${esc(c.id)}">${t("Prolonger de 30 jours","Extend by 30 days")}</button>`:""}</div><p class="identity-description">${t("Les changements d’accès restent simulés. La déclaration 18+ n’est jamais enregistrée comme une vérification de majorité.","Access changes are simulated. The 18+ declaration is never stored as age verification.")}</p>`;
    $("#modal-content").append(extra);
  };
  function saveOpenNotes() {const c=state.clients.find(x=>x.id===ui.client);if(c&&$("#private-note")){c.note=$("#private-note").value;c.reminder=$("#reminder").value;}}
  function createInvite() {
    modal(t("Une invitation, un accès.","One invitation, one access."),`<form id="invite-form"><div class="field"><label for="invite-name">${t("Pseudonyme du client fictif","Fictional client nickname")}</label><input id="invite-name" maxlength="48" required autocomplete="off" placeholder="${t("Ex. Robin","e.g. Robin")}"></div><div class="field"><label for="invite-days">${t("Durée d’accès après activation","Access duration after activation")}</label><select id="invite-days"><option value="7">7 ${t("jours","days")}</option><option value="30" selected>30 ${t("jours","days")}</option><option value="90">90 ${t("jours","days")}</option><option value="none">${t("Sans échéance","No expiry")}</option></select></div><div class="field"><label for="invite-validity">${t("Validité du lien","Link validity")}</label><select id="invite-validity"><option value="24">24 h</option><option value="48" selected>48 h</option><option value="168">7 ${t("jours","days")}</option></select></div><div class="field"><label for="invite-group">${t("Groupe interne facultatif","Optional internal group")}</label><select id="invite-group"><option value="">${t("Aucun","None")}</option>${state.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select></div><button class="btn primary" type="submit">${t("Créer l’invitation de démonstration","Create demo invitation")}</button><p class="management-note">${t("Aucun lien réel. N’utilisez que des pseudonymes fictifs.","No live link. Use fictional nicknames only.")}</p></form>`);
    $("#invite-form").onsubmit=e=>{e.preventDefault();try{const invite=A.createInvitation(state,{name:$("#invite-name").value,accessDays:$("#invite-days").value==="none"?null:Number($("#invite-days").value),validHours:Number($("#invite-validity").value),groupId:$("#invite-group").value});$("#modal").close();ui.section="access";panel.tab="invitations";render();showInvite(invite.id);}catch{toast(t("Vérifiez les informations de l’invitation.","Please check the invitation details."));}};
  }
  function showInvite(id) {
    const invite=state.invitations.find(x=>x.id===id);if(!invite)return;
    const pending=A.invitationStatus(invite)==="pending";
    modal(t("Invitation pour ","Invitation for ")+invite.name,`<div class="stack">${statusBadge(A.invitationStatus(invite))}<p class="small muted">${t("Lien d’exemple inactif : aucun accès à JessieMessage.","Inactive example link: no access to JessieMessage.")}</p><input class="demo-link" id="demo-invite-link" value="https://example.invalid/jessiemessage#${esc(invite.id)}" readonly aria-label="${t("Lien d’exemple inactif","Inactive example link")}"><button class="btn" data-manage="copy-example">${t("Copier le lien d’exemple (inactif)","Copy example link (inactive)")}</button><div id="copy-feedback" class="copy-feedback" role="status"></div><p class="small muted">${t("Valable jusqu’au ","Valid until ")}${date(invite.expiresAt)} · ${invite.accessDays??"∞"} ${t("jours d’accès après activation","days of access after activation")}</p>${pending?`<form id="activate-invite"><label class="check"><input type="checkbox" id="demo-age" required>${t("Simulation : le client déclare avoir au moins 18 ans.","Simulation: the client declares they are at least 18.")}</label><button class="btn primary" style="margin-top:16px" type="submit">${t("Simuler l’activation du compte","Simulate account activation")}</button><p class="management-note">${t("Cela ne vérifie pas la majorité et ne crée qu’une fiche fictive dans ce navigateur.","This does not verify age; it only creates a fictional record in this browser.")}</p></form>`:""}</div>`);
    if($("#activate-invite"))$("#activate-invite").onsubmit=e=>{e.preventDefault();try{const c=A.simulateActivation(state,id,{ageDeclared:$("#demo-age").checked});$("#modal").close();ui.client=c.id;ui.section="messages";ui.mobileChat=true;render();toast(t("Compte fictif créé. L’invitation ne peut plus être utilisée.","Fictional account created. Invitation can no longer be used."));}catch{toast(t("Cette invitation n’est plus utilisable.","This invitation is no longer available."));}};
  }
  function editGroup(id="") {
    const group=state.groups.find(g=>g.id===id);
    modal(group?t("Modifier le groupe","Edit group"):t("Un groupe, à votre façon.","A group, your way."),`<form id="group-form">${group?`<p>${esc(group.name)}</p>`:`<div class="field"><label for="group-name">${t("Nom du groupe","Group name")}</label><input id="group-name" maxlength="48" required placeholder="${t("Ex. Les réguliers","e.g. Regulars")}"></div>`}<div class="field"><label>${t("Membres sélectionnés","Selected members")}</label>${selectMembers(group?.memberIds)}</div><div class="management-actions"><button class="btn primary" type="submit">${t("Enregistrer dans la démo","Save in the demo")}</button>${group?`<button type="button" class="btn" data-manage="delete-group" data-id="${esc(group.id)}">${t("Supprimer le groupe","Delete group")}</button>`:""}</div><p id="group-error" class="copy-feedback" role="status"></p><p class="management-note">${t("Ce groupe n’apparaît jamais dans la vue client.","This group never appears in the client view.")}</p></form>`);
    $("#group-form").onsubmit=e=>{e.preventDefault();const ids=[...document.querySelectorAll('input[name="member"]:checked')].map(x=>x.value);try{if(group)A.setMembers(state,group.id,ids);else A.createGroup(state,$("#group-name").value,ids);$("#modal").close();panel.tab="groups";ui.section="access";render();}catch{$("#group-error").textContent=t("Choisissez un nom différent, non vide.","Choose a different, non-empty name.");}};
  }
  // A separate confirmation prevents accidental repetition in a single conversation too.
  sendDemo = function() {
    const c=state.clients.find(x=>x.id===ui.client);
    if(!A.hasAccess(c)){toast(t("Cet accès est suspendu ou expiré.","This access is suspended or expired."));return;}
    const ids=ui.attachments[draftKey()]??[];
    const duplicates=ui.view==="admin"?ids.filter(id=>c.sent.includes(id)):[];
    if(!duplicates.length){originalSend();return;}
    modal(t("Déjà partagé avec ce membre.","Already shared with this member."),`<p class="legal-note">${duplicates.map(id=>esc(state.media.find(m=>m.id===id)?.title)).join(", ")}</p><div class="stack"><button class="btn primary" data-manage="send-fresh">${t("Retirer les doublons et continuer","Remove duplicates and continue")}</button><button class="btn" data-manage="send-anyway">${t("Renvoyer volontairement","Send again intentionally")}</button></div>`);
  };
  document.addEventListener("input",e=>{
    if(e.target.id!=="member-search")return;
    const input=e.target, position=input.selectionStart;panel.query=input.value;render();
    $("#member-search")?.focus();$("#member-search")?.setSelectionRange(position,position);
  });
  document.addEventListener("click",async e=>{
    const b=e.target.closest("button");if(!b)return;
    if(b.dataset.action==="invite-info"){e.preventDefault();e.stopImmediatePropagation();createInvite();return;}
    const action=b.dataset.manage;if(!action)return;
    e.preventDefault();e.stopImmediatePropagation();
    const id=b.dataset.id;
    try{
      switch(action){
        case"tab":panel.tab=id;render();break;
        case"create-invite":createInvite();break;
        case"invite-details":showInvite(id);break;
        case"revoke":A.revokeInvitation(state,id);render();toast(t("Invitation fictive révoquée.","Fictional invitation revoked."));break;
        case"details":ui.client=id;showProfile();break;
        case"create-group":editGroup();break;
        case"edit-group":editGroup(id);break;
        case"delete-group":A.deleteGroup(state,id);if(ui.group===`group:${id}`)ui.group="all";$("#modal").close();render();break;
        case"send-group":ui.section="broadcast";ui.group=`group:${id}`;ui.bulkDone=false;render();break;
        case"toggle-access":saveOpenNotes();A.setAccess(state,id,!state.clients.find(c=>c.id===id).active);$("#modal").close();render();break;
        case"renew":saveOpenNotes();A.renewAccess(state,id,30);$("#modal").close();render();break;
        case"send-fresh":{const c=state.clients.find(x=>x.id===ui.client);const key=draftKey();ui.attachments[key]=ui.attachments[key].filter(mid=>!c.sent.includes(mid));$("#modal").close();originalSend();render();break;}
        case"send-anyway":$("#modal").close();originalSend();break;
        case"copy-example":{const input=$("#demo-invite-link");input.focus();input.select();let ok=false;try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(input.value);ok=true;}else ok=document.execCommand("copy");}catch{}$("#copy-feedback").textContent=ok?t("Copié. Ce lien est un exemple inactif.","Copied. This is an inactive example link."):t("Le lien est sélectionné : utilisez Copier dans le menu du navigateur.","The link is selected: use Copy from the browser menu.");break;}
      }
    }catch(error){toast(error.message==="Renew access first"?t("Prolongez d’abord l’accès expiré.","Extend expired access first."):t("Action indisponible. Vérifiez la sélection.","Action unavailable. Check the selection."));}
  },true);
  render();
})();
