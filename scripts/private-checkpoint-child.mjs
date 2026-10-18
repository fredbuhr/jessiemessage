import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class PrivateCheckpointChildError extends Error {
  constructor() { super("The managed private checkpoint was not confirmed."); this.code = "PRIVATE_CHECKPOINT_CHILD"; }
}

/** The normal checkpoint parser owns all arguments; this shim only owns IPC. */
export async function run(args, { loadMain = async () => (await import("./private-checkpoint.mjs")).main } = {}) {
  if (typeof process.send !== "function" || process.connected !== true || !Array.isArray(args)
    || args.some(value => typeof value !== "string") || typeof loadMain !== "function") throw new PrivateCheckpointChildError();
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.on("SIGTERM", cancel); process.on("SIGINT", cancel); process.on("disconnect", cancel);
  try {
    const main = await loadMain();
    if (typeof main !== "function" || cancellation.signal.aborted) throw new PrivateCheckpointChildError();
    const result = await main(args, { signal: cancellation.signal });
    // Waiting for main also waits for its finally blocks, native child exit,
    // pinned descriptor closure and private temporary-file cleanup.
    if (cancellation.signal.aborted) throw new PrivateCheckpointChildError();
    return result;
  } catch { throw new PrivateCheckpointChildError(); }
  finally {
    process.off("SIGTERM", cancel); process.off("SIGINT", cancel); process.off("disconnect", cancel);
    if (process.connected) { try { process.disconnect(); } catch { process.exitCode = 1; } }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(process.argv.slice(2)); }
  catch {
    process.stderr.write("PRIVATE_CHECKPOINT_CHILD: The managed private checkpoint was not confirmed.\n");
    process.exitCode = 1;
    if (process.connected) { try { process.disconnect(); } catch {} }
  }
}
