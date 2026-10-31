import test from "node:test";
import assert from "node:assert/strict";
import { createTasksState, acceptTasksSession, clearTasks, taskTicket, currentTaskTicket, parseTask, parseTaskPage, parseTaskSummary, setTaskFilter, taskQuery, applyTaskPage, editTask, changeTaskDraft, prepareTaskMutation, retryTaskMutation, uncertainTaskMutation, rejectTaskMutation, taskConflict, completeTaskMutation, localTaskDate, readTaskDate } from "../public/tasks-model.js";
const id = value => value.toString(16).padStart(32, "0"), now = 1792594800000;
const session = value => ({ user: { id: id(value), role: "admin", pseudonym: "Jessie" }, csrf: "A".repeat(43), expiresAt: now + 3600000 });
const task = (value, extra = {}) => ({ id: id(value), conversationId: id(50), clientName: "Client <script>", title: "  Photo promise 💋\n", dueAt: null, done: false, version: "1", createdAt: now - 1000, updatedAt: now, ...extra });
const page = (tasks, extra = {}) => ({ tasks, hasMore: false, nextCursor: null, serverTime: now, ...extra });
function state() { const value = createTasksState(id(50)); value.visible = true; assert.equal(acceptTasksSession(value, session(1)), true); return value; }

test("tasks session tickets become obsolete on visibility handoff and cannot adopt another owner without clearing", () => {
  const s = state(), old = taskTicket(s); assert.equal(currentTaskTicket(s, old), true);
  s.visible = false; s.generation += 1; assert.equal(currentTaskTicket(s, old), false);
  s.visible = true; assert.equal(acceptTasksSession(s, session(2)), false); clearTasks(s);
  assert.equal(s.draft, null); assert.equal(s.tasks.size, 0); assert.equal(acceptTasksSession(s, session(2)), true);
});
test("task response text remains literal and preserves intentional whitespace while invalid control text is refused", () => {
  assert.deepEqual(parseTask(task(1)), task(1));
  for (const title of ["", " \n\t", "\u200b", "x\u202e", "x\u0001", "x".repeat(501), "\ud800"]) assert.throws(() => parseTask(task(1, { title })));
  for (const extra of [{ clientName: "" }, { version: "01" }, { version: "4294967296" }, { version: "0" }, { dueAt: -1 }, { updatedAt: now - 2000 }]) assert.throws(() => parseTask(task(1, extra)));
});
test("task pages reject reordered, repeated, cross-context or incorrectly filtered rows without corrupting an accepted list", () => {
  const s = state(); applyTaskPage(s, page([task(1)]));
  for (const rows of [[task(2), task(1)], [task(1), task(1)]]) assert.throws(() => parseTaskPage(page(rows)));
  assert.throws(() => applyTaskPage(s, page([task(2), task(3, { conversationId: id(51) })]))); assert.deepEqual([...s.tasks.keys()], [id(1)]);
  assert.throws(() => applyTaskPage(s, page([task(2, { done: true })]))); assert.deepEqual([...s.tasks.keys()], [id(1)]);
});
test("task filters invalidate old pages, retain explicit client context and page deterministically", () => {
  const s = state(), epoch = s.listEpoch; setTaskFilter(s, "due");
  assert.equal(applyTaskPage(s, page([task(1)]), { epoch }), false); assert.equal(s.tasks.size, 0);
  applyTaskPage(s, page([task(1, { dueAt: now })], { hasMore: true, nextCursor: id(1) }));
  applyTaskPage(s, page([task(2, { dueAt: now - 1 })]), { afterId: id(1) }); assert.equal(s.tasks.size, 2);
  const query = new URLSearchParams(taskQuery(s, id(2))); assert.equal(query.get("filter"), "due"); assert.equal(query.get("conversationId"), id(50)); assert.equal(query.get("afterId"), id(2));
  assert.throws(() => applyTaskPage(s, page([task(3, { dueAt: now + 1 })])));
});
test("lost task confirmations retry the same id and frozen payload despite later field edits", () => {
  const s = state(); editTask(s); changeTaskDraft(s, { title: " Photo promise 💋 ", dueAt: now });
  const pending = prepareTaskMutation(s, id(7)); uncertainTaskMutation(s);
  assert.equal(changeTaskDraft(s, { title: "Changed" }), false); assert.equal(prepareTaskMutation(s, id(8)), null);
  const retry = retryTaskMutation(s); assert.equal(retry, pending); assert.equal(retry.id, id(7)); assert.equal(retry.body.title, " Photo promise 💋 "); assert.equal(Object.isFrozen(retry.body), true);
  const saved = completeTaskMutation(s, { task: task(7, { title: retry.body.title, dueAt: now }), duplicate: true }); assert.equal(saved.id, id(7)); assert.equal(s.pending, null); assert.equal(s.draft.dirty, false);
});
test("unconfirmed task results cannot silently complete another request or modified content", () => {
  const s = state(); editTask(s, task(1)); changeTaskDraft(s, { dueAt: now }); prepareTaskMutation(s, id(7));
  for (const value of [task(2, { dueAt: now, version: "2" }), task(1, { dueAt: null, version: "2" }), task(1, { dueAt: now, version: "3" })]) assert.throws(() => completeTaskMutation(s, { task: value, duplicate: false }));
  assert.ok(s.pending); completeTaskMutation(s, { task: task(1, { dueAt: now, version: "2" }), duplicate: false }); assert.equal(s.pending, null);
});
test("a lost creation acknowledgement followed by another-device edit keeps one task identity through conflict resolution", () => {
  const s = state(); editTask(s); changeTaskDraft(s, { title: "First request" });
  prepareTaskMutation(s, id(7)); uncertainTaskMutation(s); assert.equal(s.draft.id, id(7));
  const retry = retryTaskMutation(s); assert.equal(retry.id, id(7));
  // The backend committed creation, then another device saved revision two.
  // Its conflict response must not turn a fresh Save into another creation.
  rejectTaskMutation(s); taskConflict(s, task(7, { title: "Other device", version: "2" }));
  assert.equal(s.draft.title, "First request"); assert.throws(() => prepareTaskMutation(s, id(8)));
  const overwrite = prepareTaskMutation(s, id(8), { overwrite: true });
  assert.equal(overwrite.id, id(7)); assert.equal(overwrite.body.expectedVersion, "2");
  completeTaskMutation(s, { task: task(7, { title: "First request", version: "3" }), duplicate: false });
  assert.equal(s.draft.id, id(7)); assert.equal(s.pending, null);
});
test("a concurrent task edit preserves the draft and requires an explicit choice before overwrite", () => {
  const s = state(); editTask(s, task(1)); changeTaskDraft(s, { title: "Local draft" }); prepareTaskMutation(s, id(7)); rejectTaskMutation(s);
  taskConflict(s, task(1, { title: "Other device", version: "2" })); assert.equal(s.draft.title, "Local draft"); assert.throws(() => prepareTaskMutation(s, id(7)));
  const pending = prepareTaskMutation(s, id(7), { overwrite: true }); assert.equal(pending.body.expectedVersion, "2"); assert.equal(pending.body.title, "Local draft");
  rejectTaskMutation(s); editTask(s, s.draft.conflict); assert.equal(s.draft.title, "Other device"); assert.equal(s.draft.dirty, false);
});
test("completion, reopening and postponement retain the task identity and expected revision", () => {
  const s = state(); editTask(s, task(1)); changeTaskDraft(s, { done: true }); assert.equal(prepareTaskMutation(s, id(7)).id, id(1));
  completeTaskMutation(s, { task: task(1, { done: true, version: "2" }), duplicate: false });
  changeTaskDraft(s, { done: false, dueAt: now + 3600000 }); const next = prepareTaskMutation(s, id(7)); assert.equal(next.body.expectedVersion, "2"); assert.equal(next.body.done, false); assert.equal(next.body.dueAt, now + 3600000);
});
test("task dates preserve local minute precision, permit no deadline and reject impossible calendar dates", () => {
  const time = new Date(2026, 9, 21, 18, 30).getTime(); assert.equal(readTaskDate(localTaskDate(time)), time); assert.equal(readTaskDate(""), null);
  for (const value of ["2026-02-30T12:00", "2026-10-21", "not-a-date", "1969-01-01T12:00"]) assert.throws(() => readTaskDate(value));
});
test("task summary refuses malformed counts or time instead of presenting a false all-clear", () => {
  assert.deepEqual(parseTaskSummary({ dueCount: 3, serverTime: now }), { dueCount: 3, serverTime: now });
  for (const value of [{ dueCount: -1, serverTime: now }, { dueCount: "0", serverTime: now }, { dueCount: 0, serverTime: -1 }]) assert.throws(() => parseTaskSummary(value));
});


test("a bounded task page replaces the previous page and can be refreshed without discarding the editor draft", () => {
  const s = state(); editTask(s, task(1)); changeTaskDraft(s, { title: "Unsaved personal draft" }); const draft = s.draft;
  applyTaskPage(s, page(Array.from({ length: 50 }, (_, index) => task(index + 1)), { hasMore: true, nextCursor: id(50) }), { replace: true });
  applyTaskPage(s, page(Array.from({ length: 50 }, (_, index) => task(index + 51)), { hasMore: true, nextCursor: id(100) }), { afterId: id(50), replace: true });
  assert.equal(s.tasks.size, 50); assert.equal(s.tasks.has(id(1)), false); assert.equal(s.tasks.has(id(100)), true);
  applyTaskPage(s, page([task(51, { title: "Changed on another device", version: "2" })]), { afterId: id(50), replace: true });
  assert.equal(s.tasks.size, 1); assert.equal(s.tasks.get(id(51)).title, "Changed on another device"); assert.equal(s.draft, draft); assert.equal(s.draft.title, "Unsaved personal draft");
  s.pageAfter = id(50); s.pageBack = [null]; s.pageNumber = 2; setTaskFilter(s, "due");
  assert.equal(s.pageAfter, null); assert.equal(s.pageBack.length, 0); assert.equal(s.pageNumber, 1);
});
