import test from "node:test";
import assert from "node:assert/strict";
import { main, parseArguments, DataCliError } from "../scripts/data-export.mjs";
import { DATA_POLICY } from "../server/data/policy.mjs";
import { DELETION_FACT_NAMES } from "../server/data/deletion-store.mjs";

const client = "11".repeat(16), now = 1800000000000;
const args = (command = "inventory") => [command, "--offline", "--database", "jessiemessage_test_data", "--client", client, "--confirm-client", client, "--output", "/synthetic/private-exports/new-export"];
const rejected = (code = "DATA_OPERATION") => (error) => error instanceof DataCliError && error.code === code
  && !error.message.includes("private-marker") && error.cause === undefined;
const emptySummary = () => ({ messages: 0, mediaFiles: 0, libraryItems: 0, mediaBytes: 0, rows: 0 });
function fixture() {
  const events = [], output = [], files = new Map();
  const state = { role: "client", clientId: Buffer.from(client, "hex"), sourceError: false, poolError: false, writerError: false,
    config: { databaseName: "jessiemessage_test_data", mediaRoot: null, messageKey: Buffer.alloc(32, 3) } };
  const reader = { account: { id: state.clientId, role: "client" }, async inventory() {
    return DATA_POLICY.map((entry) => ({ table: entry.table, scope: entry.scope, count: entry.scope === "subject" ? 1 : null,
      truncated: false, payload: "private-marker@example.invalid" }));
  }, async deletionFacts() {
    events.push("deletion-facts");
    return DELETION_FACT_NAMES.map((name) => ({ name, count: 0, truncated: false, payload: "private-marker" }));
  } };
  const writer = Object.fromEntries(["empty", "json", "line", "media"].map((name) => [name, async (path, value) => {
    events.push([name, path]); if (state.writerError) throw new Error("private-marker payload and absolute path");
    files.set(path, value === undefined ? "" : structuredClone(value));
  }]));
  writer.finalize = async (summary) => { events.push("finalize"); files.set("COMPLETE.json", structuredClone(summary)); };
  writer.close = async () => { events.push("writer-close"); };
  const pool = { async end() { events.push("pool-end"); if (state.poolError) throw new Error("private-marker SQL password"); } };
  const dependencies = { configure: () => state.config, clock: () => now,
    async createPool() { events.push("pool"); return pool; },
    makeSchemaStore: () => ({ async assertSchema() { events.push("schema"); } }),
    async withClientData(options, callback) {
      events.push("snapshot-start"); assert.equal(options.pool, pool); assert.equal(options.clientId.toString("hex"), client);
      reader.account = { id: state.clientId, role: state.role };
      const value = await callback(reader); if (state.sourceError) throw new Error("private-marker snapshot commit");
      events.push("snapshot-end"); return value;
    },
    async makeWriter(options) { events.push("writer"); assert.ok(options.protectedRoots.length >= 1); return writer; },
    async exportContent(options) { events.push("export"); assert.equal(options.clientId.toString("hex"), client);
      await options.writer.empty("messages.jsonl"); return { ...emptySummary(), privatePayload: "private-marker" }; },
    outputStream: { write(value) { output.push(value); } } };
  return { state, reader, writer, pool, dependencies, events, output, files };
}

test("data CLI requires exact offline, database, repeated canonical client and private output arguments", () => {
  for (const command of ["inventory", "export", "plan"]) {
    const result = parseArguments(args(command)); assert.equal(result.clientId.toString("hex"), client); assert.equal(result.command, command);
  }
  const bad = [[], args("purge"), args().filter((value) => value !== "--offline"), [...args(), "--force"],
    args().map((value, index) => index === 7 ? "22".repeat(16) : value),
    args().map((value, index) => index === 5 || index === 7 ? "AA".repeat(16) : value),
    args().map((value, index) => index === 9 ? "relative" : value),
    args().map((value, index) => index === 9 ? "/private/../public/export" : value),
    args().map((value, index) => index === 9 ? "/private/new\nexport" : value)];
  for (const input of bad) assert.throws(() => parseArguments(input), rejected("DATA_USAGE"));
});

test("database mismatch and invalid export key are refused before any pool or output", async () => {
  for (const change of ["database", "key"]) {
    const f = fixture(); if (change === "database") f.state.config.databaseName = "other"; else f.state.config.messageKey = Buffer.alloc(31);
    await assert.rejects(main(args("export"), {}, f.dependencies), rejected("DATA_CONFIG"));
    assert.equal(f.events.length, 0); assert.equal(f.output.length, 0);
  }
});

test("administrator or mismatched target cannot allocate an output directory", async () => {
  for (const change of ["role", "target"]) {
    const f = fixture(); if (change === "role") f.state.role = "admin"; else f.state.clientId = Buffer.alloc(16, 99);
    await assert.rejects(main(args(), {}, f.dependencies), rejected());
    assert.equal(f.events.includes("writer"), false); assert.equal(f.events.filter((event) => event === "pool-end").length, 1);
    assert.equal(f.output.length, 0);
  }
});

test("inventory writes scoped categories without private row fields and completes after snapshot and pool closure", async () => {
  const f = fixture(); const result = await main(args(), {}, f.dependencies);
  assert.deepEqual(result, { command: "inventory", status: "complete", inventoryCategories: 29 });
  assert.equal(f.files.get("policy.json").automaticPurge, false);
  assert.equal(f.files.get("inventory.json").categories.length, 29);
  assert.equal(f.files.get("inventory.json").categories.find((item) => item.table === "admin_mfa").count, null);
  assert.doesNotMatch(JSON.stringify(f.files.get("inventory.json")), /private-marker|payload/);
  assert.ok(f.events.indexOf("snapshot-end") < f.events.indexOf("pool-end"));
  assert.ok(f.events.indexOf("pool-end") < f.events.indexOf("finalize"));
  assert.equal(f.events.filter((event) => event === "pool-end").length, 1);
  assert.doesNotMatch(f.output.join(""), new RegExp(`${client}|private-marker|synthetic|password`, "i"));
});

test("export needs only message configuration until a selected photo is requested", async () => {
  const f = fixture();
  const environment = { JESSIEMESSAGE_DB_HOST: "127.0.0.1", JESSIEMESSAGE_DB_NAME: "jessiemessage_test_data",
    JESSIEMESSAGE_APPLICATION_DATABASE: "jessiemessage_test_data", JESSIEMESSAGE_RUNTIME_DB_USER: "runtime",
    JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-private", JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1",
    JESSIEMESSAGE_MESSAGE_KEY: Buffer.alloc(32, 3).toString("base64url") };
  delete f.dependencies.configure;
  const result = await main(args("export"), environment, f.dependencies);
  assert.deepEqual(result, { command: "export", status: "complete", ...emptySummary() });
  assert.equal(f.events.includes("export"), true); assert.doesNotMatch(f.output.join(""), /private-marker/);
});

test("media reader is allocated once only when selected content needs it", async () => {
  const f = fixture(); f.state.config.mediaRoot = "/synthetic/private-media"; let creations = 0, reads = 0;
  f.dependencies.makeStorage = async (options) => { creations++; assert.equal(options.key.length, 32); return { async get() { reads++; return Buffer.from("private image"); } }; };
  f.dependencies.exportContent = async (options) => { await options.storage.get({}); await options.storage.get({}); return emptySummary(); };
  await main(args("export"), { JESSIEMESSAGE_MEDIA_KEY: Buffer.alloc(32, 4).toString("base64url") }, f.dependencies);
  assert.equal(creations, 1); assert.equal(reads, 2);
});

test("snapshot, file write and pool cleanup failures leave no completion and no success output", async () => {
  for (const failure of ["sourceError", "writerError", "poolError"]) {
    const f = fixture(); f.state[failure] = true;
    await assert.rejects(main(args(), {}, f.dependencies), rejected());
    assert.equal(f.files.has("COMPLETE.json"), false); assert.equal(f.output.length, 0);
    assert.equal(f.events.includes("writer-close"), true);
  }
});

test("malformed inventory counts are refused rather than silently truncated or published", async () => {
  const f = fixture(); f.reader.inventory = async () => DATA_POLICY.map((entry) => ({ table: entry.table, scope: entry.scope,
    count: entry.scope === "subject" ? 7 : null, truncated: entry.scope === "subject" }));
  await assert.rejects(main(args(), {}, f.dependencies), rejected());
  assert.equal(f.files.has("COMPLETE.json"), false); assert.equal(f.output.length, 0);
});

test("interruption prevents subsequent records and completion while still closing private resources", async () => {
  const f = fixture(), controller = new AbortController(); f.dependencies.signal = controller.signal;
  f.dependencies.exportContent = async (options) => { await options.writer.empty("messages.jsonl"); controller.abort(); await options.writer.line("messages.jsonl", { body: "private-marker" }); return emptySummary(); };
  await assert.rejects(main(args("export"), {}, f.dependencies), rejected("DATA_ABORTED"));
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === "line"), false);
  assert.equal(f.files.has("COMPLETE.json"), false); assert.equal(f.output.length, 0);
  assert.equal(f.events.includes("pool-end"), true); assert.equal(f.events.includes("writer-close"), true);
});

test("deletion plan is a keyless private diagnostic, completed after the same snapshot and pool close", async () => {
  const f = fixture(); f.state.config.messageKey = null;
  f.dependencies.makeStorage = () => assert.fail("simulation must never allocate media storage");
  f.dependencies.exportContent = () => assert.fail("simulation must never decrypt client content");
  const result = await main(args("plan"), {}, f.dependencies);
  const report = f.files.get("deletion-plan.json");
  assert.equal(report.simulationOnly, true); assert.equal(report.executable, false); assert.equal(report.retentionDecided, false);
  assert.equal(report.categories.length, 29); assert.equal(report.observations.length, 23);
  assert.equal(report.candidateOrder.every((entry) => entry.blocked && entry.proposedAction === "review"), true);
  assert.deepEqual(result, { command: "plan", status: "complete", inventoryCategories: 29, observations: 23,
    affectedCategories: report.affectedCategories, blockers: report.blockers.length });
  assert.deepEqual(f.files.get("COMPLETE.json"), { inventoryCategories: 29, observations: 23,
    affectedCategories: report.affectedCategories, blockers: report.blockers.length });
  assert.equal(f.files.has("account.json"), false); assert.equal(f.files.has("messages.jsonl"), false);
  assert.ok(f.events.indexOf("deletion-facts") < f.events.indexOf("snapshot-end"));
  assert.ok(f.events.indexOf("snapshot-end") < f.events.indexOf("pool-end"));
  assert.ok(f.events.indexOf("pool-end") < f.events.indexOf("finalize"));
  assert.doesNotMatch(JSON.stringify(report) + f.output.join(""), /private-marker|payload|11111111111111111111111111111111|synthetic-private/);
});

test("failed or malformed deletion facts and migration input cannot publish a plan completion", async () => {
  for (const problem of ["read", "missing", "history"]) {
    const f = fixture();
    if (problem === "read") f.reader.deletionFacts = async () => { throw new Error("private-marker SQL and path"); };
    if (problem === "missing") f.reader.deletionFacts = async () => [];
    if (problem === "history") f.dependencies.loadMigrations = async () => [];
    await assert.rejects(main(args("plan"), {}, f.dependencies), rejected());
    assert.equal(f.files.has("COMPLETE.json"), false); assert.equal(f.files.has("deletion-plan.json"), false);
    assert.equal(f.output.length, 0); assert.equal(f.events.includes("writer-close"), true);
    assert.equal(f.events.filter((entry) => entry === "pool-end").length, 1);
  }
});
