/* Prototype model only. In-memory data, no authentication or production tokens. */
"use strict";
globalThis.JessieAdmin = (() => {
  const DAY = 86400000;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const cleanName = value => String(value ?? "").trim().slice(0, 48);
  function initialize(state) {
    state.groups ??= [{id:"regulars",name:"Réguliers",memberIds:["alex","liam"]}];
    state.invitations ??= [];
    state.managementSequence ??= 0;
    return state;
  }
  function requireClient(state, id) {
    const client = state.clients.find(c => c.id === id);
    if (!client) throw new Error("Unknown client");
    return client;
  }
  function hasAccess(client, now = Date.now()) {
    return client.active === true && (client.accessUntil == null || client.accessUntil > now);
  }
  function invitationStatus(invite, now = Date.now()) {
    if (invite.revokedAt != null) return "revoked";
    if (invite.usedAt != null) return "used";
    return invite.expiresAt <= now ? "expired" : "pending";
  }
  function createInvitation(state, {name, accessDays = 30, validHours = 48, groupId = ""}, now = Date.now()) {
    initialize(state);
    name = cleanName(name);
    if (!name) throw new Error("Name required");
    if (accessDays !== null && (!Number.isInteger(accessDays) || accessDays < 1 || accessDays > 365)) throw new Error("Invalid access duration");
    if (!Number.isInteger(validHours) || validHours < 1 || validHours > 168) throw new Error("Invalid invitation duration");
    if (groupId && !state.groups.some(g => g.id === groupId)) throw new Error("Unknown group");
    const id = `demo-invite-${++state.managementSequence}`;
    const invitation = {id, name, accessDays, groupId, createdAt:now, expiresAt:now+validHours*3600000, usedAt:null, revokedAt:null, clientId:null};
    state.invitations.push(invitation);
    return invitation;
  }
  function revokeInvitation(state, id, now = Date.now()) {
    const invite = state.invitations.find(x => x.id === id);
    if (!invite) throw new Error("Unknown invitation");
    if (invitationStatus(invite, now) !== "pending") throw new Error("Invitation unavailable");
    invite.revokedAt = now;
  }
  function simulateActivation(state, id, {ageDeclared = false} = {}, now = Date.now()) {
    const invite = state.invitations.find(x => x.id === id);
    if (!invite || invitationStatus(invite, now) !== "pending") throw new Error("Invitation unavailable");
    if (ageDeclared !== true) throw new Error("Declaration required");
    // Single-use within this synchronous, in-memory demonstration. No real account is created.
    const clientId = `demo-client-${++state.managementSequence}`;
    const client = {id:clientId,name:invite.name,tags:["Nouveau"],active:true,marketing:false,unread:0,note:"",reminder:"",sent:[],ageDeclared:true,ageVerified:false,accessUntil:invite.accessDays === null ? null : now+invite.accessDays*DAY};
    state.clients.push(client);
    state.messages[clientId] = [];
    invite.usedAt = now;
    invite.clientId = clientId;
    const group = state.groups.find(g => g.id === invite.groupId);
    if (group) group.memberIds.push(clientId);
    return client;
  }
  function createGroup(state, name, memberIds) {
    initialize(state);
    name = cleanName(name);
    if (!name) throw new Error("Name required");
    if (state.groups.some(g => g.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("Duplicate group");
    const ids = [...new Set(memberIds)];
    ids.forEach(id => requireClient(state,id));
    const group = {id:`group-${++state.managementSequence}`,name,memberIds:ids};
    state.groups.push(group);
    return group;
  }
  function setMembers(state, id, memberIds) {
    const group = state.groups.find(g => g.id === id);
    if (!group) throw new Error("Unknown group");
    const ids = [...new Set(memberIds)];
    ids.forEach(memberId => requireClient(state,memberId));
    group.memberIds = ids;
  }
  function deleteGroup(state, id) {
    if (!state.groups.some(g => g.id === id)) throw new Error("Unknown group");
    state.groups = state.groups.filter(g => g.id !== id);
    for (const invite of state.invitations) if (invite.groupId === id) invite.groupId = "";
  }
  function setAccess(state, id, active, now = Date.now()) {
    if (typeof active !== "boolean") throw new Error("Invalid account status");
    const client = requireClient(state,id);
    if (active && client.accessUntil != null && client.accessUntil <= now) throw new Error("Renew access first");
    client.active = active;
  }
  function renewAccess(state, id, days, now = Date.now()) {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid access duration");
    const client = requireClient(state,id);
    if (client.accessUntil == null) throw new Error("Unlimited access");
    client.accessUntil = Math.max(now, client.accessUntil) + days * DAY;
    client.active = true;
  }
  function scopedDelivery(state, options, now = Date.now()) {
    let clients = state.clients.filter(c => hasAccess(c,now));
    let group = options.group ?? "all";
    if (group.startsWith("group:")) {
      const selected = (state.groups ?? []).find(g => g.id === group.slice(6));
      if (!selected) throw new Error("Unknown group");
      clients = clients.filter(c => selected.memberIds.includes(c.id));
      group = "all";
    }
    if (own(options,"clientIds")) {
      if (!Array.isArray(options.clientIds)) throw new Error("Invalid recipients");
      options.clientIds.forEach(id => requireClient(state,id));
      clients = clients.filter(c => options.clientIds.includes(c.id));
    }
    return {state:{...state, clients},options:{...options,group}};
  }
  return Object.freeze({initialize,hasAccess,invitationStatus,createInvitation,revokeInvitation,simulateActivation,createGroup,setMembers,deleteGroup,setAccess,renewAccess,scopedDelivery});
})();
