const ID = /^[a-f0-9]{32}$/;
const MAX_DATE = 253402300799999;
export const TASK_TITLE_MAX = 500;
export const taskId = value => typeof value === "string" && ID.test(value);
const instant = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const text = (value, max) => typeof value === "string" && value.length <= max && value.isWellFormed();
const title = value => text(value, TASK_TITLE_MAX) && value.length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) && !/^[\p{C}\p{Z}]*$/u.test(value);
const invalid = () => { throw new TypeError("invalid_task"); };
export function taskVersion(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,9})$/.test(value) || BigInt(value) > 4294967295n) invalid();
  return value;
}
export function parseTask(value) {
  if (!value || !taskId(value.id) || !taskId(value.conversationId) || !text(value.clientName, 64) || value.clientName.length === 0
    || !title(value.title)
    || value.dueAt !== null && !instant(value.dueAt) || typeof value.done !== "boolean"
    || taskVersion(value.version) === "0" || !instant(value.createdAt) || !instant(value.updatedAt) || value.updatedAt < value.createdAt) invalid();
  return { id: value.id, conversationId: value.conversationId, clientName: value.clientName, title: value.title,
    dueAt: value.dueAt, done: value.done, version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt };
}
export function parseTaskPage(value, afterId = null) {
  if (!value || !instant(value.serverTime) || !Array.isArray(value.tasks) || value.tasks.length > 50
    || typeof value.hasMore !== "boolean" || value.nextCursor !== null && !taskId(value.nextCursor)) invalid();
  const tasks = value.tasks.map(parseTask), ids = tasks.map(task => task.id);
  if (new Set(ids).size !== ids.length || ids.some((id, i) => (i ? id <= ids[i - 1] : afterId !== null && id <= afterId))
    || value.hasMore && (!ids.length || value.nextCursor !== ids.at(-1)) || !value.hasMore && value.nextCursor !== null) invalid();
  return { tasks, hasMore: value.hasMore, nextCursor: value.nextCursor, serverTime: value.serverTime };
}
export function parseTaskSummary(value) {
  if (!value || !Number.isSafeInteger(value.dueCount) || value.dueCount < 0 || !instant(value.serverTime)) invalid();
  return { dueCount: value.dueCount, serverTime: value.serverTime };
}
export function createTasksState(conversationId = null) {
  if (conversationId !== null && !taskId(conversationId)) invalid();
  return { generation: 0, visible: false, session: null, filter: "open", conversationId, clientName: "", tasks: new Map(),
    cursor: null, hasMore: false, listEpoch: 0, serverTime: null, dueCount: 0, draft: null, pending: null, csrfFailed: false };
}
export function clearTasks(state) {
  const next = createTasksState(state.conversationId); next.generation = state.generation + 1; Object.assign(state, next);
}
export function taskTicket(state) { return { generation: state.generation, id: state.session?.user.id ?? null, csrf: state.session?.csrf ?? null }; }
export function currentTaskTicket(state, ticket) {
  return Boolean(state.visible && ticket?.generation === state.generation && ticket.id === (state.session?.user.id ?? null) && ticket.csrf === (state.session?.csrf ?? null));
}
export function acceptTasksSession(state, session) {
  if (!session?.user || session.user.role !== "admin" || !taskId(session.user.id) || !text(session.user.pseudonym, 64)
    || !/^[A-Za-z0-9_-]{43}$/.test(session.csrf) || !instant(session.expiresAt)) return false;
  if (state.session && (state.session.user.id !== session.user.id || state.session.csrf !== session.csrf)) return false;
  state.session = session; return true;
}
export function taskQuery(state, afterId = null) {
  const query = new URLSearchParams({ filter: state.filter, limit: "50" });
  if (state.conversationId) query.set("conversationId", state.conversationId);
  if (afterId) { if (!taskId(afterId)) invalid(); query.set("afterId", afterId); }
  return query.toString();
}
export function setTaskFilter(state, filter) {
  if (!["open", "due", "done"].includes(filter)) invalid();
  state.filter = filter; state.listEpoch += 1; state.tasks.clear(); state.cursor = null; state.hasMore = false;
}
export function applyTaskPage(state, input, { epoch = state.listEpoch, afterId = null } = {}) {
  const page = parseTaskPage(input, afterId);
  if (epoch !== state.listEpoch) return false;
  for (const task of page.tasks) {
    if (state.conversationId && task.conversationId !== state.conversationId || state.filter === "done" && !task.done
      || state.filter !== "done" && task.done || state.filter === "due" && (task.dueAt === null || task.dueAt > page.serverTime)) invalid();
  }
  if (afterId === null) state.tasks.clear();
  for (const task of page.tasks) {
    const prior = state.tasks.get(task.id);
    if (!prior || BigInt(prior.version) <= BigInt(task.version)) state.tasks.set(task.id, task);
  }
  state.cursor = page.nextCursor; state.hasMore = page.hasMore; state.serverTime = page.serverTime; return true;
}
export function editTask(state, task = null) {
  if (state.pending) return false;
  const value = task === null ? null : parseTask(task);
  const conversationId = value?.conversationId ?? state.conversationId;
  if (!taskId(conversationId)) invalid();
  state.draft = { id: value?.id ?? null, conversationId, clientName: value?.clientName ?? state.clientName,
    title: value?.title ?? "", dueAt: value?.dueAt ?? null, done: value?.done ?? false, baseVersion: value?.version ?? "0", dirty: false, conflict: null };
  return state.draft;
}
export function changeTaskDraft(state, values) {
  if (!state.draft || state.pending) return false;
  for (const key of ["title", "dueAt", "done"]) if (Object.hasOwn(values, key)) state.draft[key] = values[key];
  state.draft.dirty = true; return true;
}
export function taskDraftBody(state, { overwrite = false } = {}) {
  const draft = state.draft;
  if (!draft || draft.conflict && !overwrite || !title(draft.title)
    || draft.dueAt !== null && !instant(draft.dueAt) || typeof draft.done !== "boolean") invalid();
  const expectedVersion = taskVersion(overwrite ? draft.conflict?.version ?? draft.baseVersion : draft.baseVersion);
  if (expectedVersion === "4294967295") invalid();
  return { conversationId: draft.conversationId, title: draft.title, dueAt: draft.dueAt, done: draft.done, expectedVersion };
}
export function prepareTaskMutation(state, newId, options = {}) {
  if (state.pending || !state.session || state.csrfFailed) return null;
  const body = taskDraftBody(state, options), id = state.draft.id ?? newId;
  if (!taskId(id)) invalid();
  // A creation identity survives even when its first acknowledgement is lost
  // and a later retry encounters a version edited on another device.
  state.draft.id = id;
  state.pending = { id, body: Object.freeze(body), status: "sending" }; return state.pending;
}
export function retryTaskMutation(state) { if (!state.pending || state.csrfFailed) return null; state.pending.status = "sending"; return state.pending; }
export function uncertainTaskMutation(state) { if (state.pending) state.pending.status = "uncertain"; }
export function rejectTaskMutation(state) { state.pending = null; }
export function taskConflict(state, input) {
  const latest = parseTask(input);
  if (!state.draft || latest.id !== state.draft.id || latest.conversationId !== state.draft.conversationId) invalid();
  state.draft.conflict = latest; return latest;
}
export function completeTaskMutation(state, response) {
  const task = parseTask(response?.task), pending = state.pending;
  if (!pending || typeof response.duplicate !== "boolean" || task.id !== pending.id || task.conversationId !== pending.body.conversationId
    || task.title !== pending.body.title || task.dueAt !== pending.body.dueAt || task.done !== pending.body.done
    || BigInt(task.version) !== BigInt(pending.body.expectedVersion) + 1n) invalid();
  state.pending = null; editTask(state, task); return task;
}
export function localTaskDate(value) {
  if (!instant(value)) return "";
  const date = new Date(value), pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function readTaskDate(value) {
  if (value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) invalid();
  const parsed = new Date(value).getTime();
  if (!instant(parsed) || localTaskDate(parsed) !== value) invalid();
  return parsed;
}
