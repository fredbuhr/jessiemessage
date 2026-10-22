import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";

const fail = () => { throw Object.assign(new Error("The managed private runtime could not start."), { code: "PRIVATE_MESSAGING_CHILD" }); };
const path = value => typeof value === "string" && value.startsWith("/") && value !== "/" && resolve(value) === value
  && value.length <= 4096 && !/[\\\x00-\x1f\x7f]/.test(value);
export function parseArguments(args) {
  if (!Array.isArray(args) || args.length < 6 || args.length > 14 || args.length % 2 || args[0] !== "--runtime-directory" || args[2] !== "--private-directory"
    || args[4] !== "--port" || !path(args[1]) || !path(args[3]) || !/^[1-9]\d{0,4}$/.test(args[5]) || Number(args[5]) > 65535) fail();
  const result = { runtimeDirectory: args[1], privateDirectory: args[3], port: Number(args[5]) };
  const flags = ["--operations-directory", "--account-closures", "--parent-gateway", "--video"];
  let previous = -1;
  for (let index = 6; index < args.length; index += 2) {
    const position = flags.indexOf(args[index]);
    if (position <= previous || position < 0) fail(); previous = position;
    if (position === 0) { if (!path(args[index + 1])) fail(); result.operationsDirectory = args[index + 1]; }
    else { if (args[index + 1] !== "managed") fail(); result[position === 1 ? "accountClosures" : position === 2 ? "parentGateway" : "video"] = true; }
  }
  if (result.accountClosures && !result.operationsDirectory || result.video && (!result.accountClosures || result.parentGateway)) fail();
  return result;
}

/** The loader seam is for subprocess fixtures; production only imports pinned local source. */
export async function run(options, { loadRuntime = async directory => {
  const [{ main }, { start }] = await Promise.all([import(pathToFileURL(`${directory}/scripts/start-private-messaging.mjs`).href),
    import(pathToFileURL(`${directory}/server/index.mjs`).href)]);
  return { main, start };
} } = {}) {
  const selected = parseArguments(["--runtime-directory", options?.runtimeDirectory, "--private-directory", options?.privateDirectory, "--port", String(options?.port),
    ...(options?.operationsDirectory === undefined ? [] : ["--operations-directory", options.operationsDirectory]), ...(options?.accountClosures === true ? ["--account-closures", "managed"] : []), ...(options?.parentGateway === true ? ["--parent-gateway", "managed"] : []), ...(options?.video === true ? ["--video", "managed"] : [])]);
  if (typeof process.send !== "function" || process.connected !== true || typeof loadRuntime !== "function") fail();
  try { if (privateAuthenticationProcessOptions(process.env, process.execArgv).port !== String(selected.port)) fail(); } catch { fail(); }
  let closing = false, stopping = null, runtime = null, startupComplete;
  const started = new Promise(resolveStarted => { startupComplete = resolveStarted; });
  const stop = () => {
    closing = true;
    if (stopping) return stopping;
    stopping = (async () => {
      await started;
      try {
        if (runtime) {
          const result = await runtime.drain();
          if (result?.failed || result?.timedOut) process.exitCode = 1;
          if (result?.timedOut) process.exit(1);
        }
      } catch { process.exitCode = 1; }
      finally {
        process.off("SIGTERM", onStop); process.off("SIGINT", onStop); process.off("disconnect", onStop);
        if (process.connected) { try { process.disconnect(); } catch { process.exitCode = 1; } }
      }
    })();
    return stopping;
  };
  const onStop = () => { void stop(); };
  process.on("SIGTERM", onStop); process.on("SIGINT", onStop); process.on("disconnect", onStop);
  try {
    const loaded = await loadRuntime(selected.runtimeDirectory);
    if (typeof loaded?.main !== "function" || typeof loaded.start !== "function" || closing) fail();
    await loaded.main(["start", "--deployment", "primary-transition", "--profile", selected.video ? "photos-notify-recovery-crm-broadcast-video" : "photos-notify-recovery-crm-broadcast",
      "--private-directory", selected.privateDirectory, "--private-path-mode", "linux-dirfd"], {
      ...(selected.video ? { managedVideo: true } : {}),
      async startServer(env, startupOptions) {
        if (closing) fail();
        runtime = await loaded.start(env, { ...startupOptions, ...(selected.operationsDirectory === undefined ? {} : { backupDirectory: selected.operationsDirectory }),
          ...(selected.accountClosures ? { accountClosures: true } : {}), ...(selected.video ? { video: true } : {}), ...(selected.parentGateway ? { parentGateway: true } : {}) });
        if (typeof runtime?.drain !== "function" || closing) fail();
        return runtime;
      },
    });
    if (closing || !runtime) fail();
    await new Promise((yes, no) => { process.send({ type: "runtime_started" }, error => error ? no(error) : yes()); });
  } catch {
    if (!closing) process.exitCode = 1;
    closing = true;
  } finally { startupComplete(); }
  if (closing) await stop();
  return Object.freeze({ started: !closing });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(parseArguments(process.argv.slice(2))); }
  catch { process.stderr.write("PRIVATE_MESSAGING_CHILD: The managed private runtime could not start.\n"); process.exitCode = 1; if (process.connected) process.disconnect(); }
}
