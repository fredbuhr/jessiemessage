function fields(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError("invalid_entry");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some((key) => typeof key !== "string" || !names.includes(key)
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value"))) throw new TypeError("invalid_entry");
  return Object.fromEntries(names.map((name) => [name, descriptors[name].value]));
}

export function parseEntry(input) {
  const value = fields(input, ["status", "client", "administrator"]);
  if (!["available", "unavailable"].includes(value.status)) throw new TypeError("invalid_entry");
  let client = null, administrator = null;
  if (value.client !== null) {
    client = fields(value.client, ["state", "href"]);
    const destinations = { signed_out: ["/access"], pending: ["/access"], active: ["/access", "/messages"], expired: ["/access"] };
    if (typeof client.state !== "string" || !Object.hasOwn(destinations, client.state) || !destinations[client.state].includes(client.href)) throw new TypeError("invalid_entry");
  }
  if (value.administrator !== null) {
    administrator = fields(value.administrator, ["state", "href"]);
    if (!(administrator.state === "signed_out" && administrator.href === "/admin/login"
      || administrator.state === "connected" && ["/admin", "/admin/messages"].includes(administrator.href))) throw new TypeError("invalid_entry");
  }
  if (value.status === "unavailable" ? client !== null || administrator !== null : client === null && administrator === null) throw new TypeError("invalid_entry");
  return { status: value.status, client, administrator };
}

export function createEntryState() { return { epoch: 0, visible: false, phase: "idle", entry: null }; }
export function clearEntry(state, { visible = false } = {}) {
  state.epoch += 1; state.visible = visible; state.phase = "idle"; state.entry = null; return state.epoch;
}
export function currentEntry(state, ticket) { return state.visible && state.epoch === ticket; }
export function beginEntryCheck(state) { const ticket = clearEntry(state, { visible: true }); state.phase = "checking"; return ticket; }
export function acceptEntry(state, ticket, input) {
  if (!currentEntry(state, ticket)) return false;
  const entry = parseEntry(input); state.entry = entry; state.phase = entry.status; return true;
}
export function rejectEntry(state, ticket, { offline = false } = {}) {
  if (!currentEntry(state, ticket)) return false;
  state.entry = null; state.phase = offline ? "offline" : "error"; return true;
}
