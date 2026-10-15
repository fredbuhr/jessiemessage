import { isIP } from "node:net";

export class MigrationInputError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new MigrationInputError(code); };
const MAX_PASSWORD_BYTES = 4096;

export function parseArguments(args) {
  const [command, ...flags] = Array.isArray(args) ? args : [];
  if (!["status", "initialize"].includes(command) || flags.length % 2) fail("MIGRATION_INPUT_USAGE");
  const options = { command };
  const names = new Map([["--host", "host"], ["--port", "port"], ["--database", "database"],
    ["--confirm-database", "confirmation"], ["--user", "user"]]);
  for (let index = 0; index < flags.length; index += 2) {
    const key = names.get(flags[index]);
    const value = flags[index + 1];
    if (!key || Object.hasOwn(options, key) || typeof value !== "string" || !value || value.startsWith("--")) {
      fail("MIGRATION_INPUT_USAGE");
    }
    options[key] = value;
  }
  const { host, database, confirmation, user } = options;
  const port = options.port ?? "3306";
  if (typeof host !== "string" || host.length > 253
    || (!isIP(host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))
    || typeof database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(database) || database !== confirmation
    || typeof user !== "string" || !/^[a-zA-Z0-9_]{1,80}$/.test(user)
    || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) fail("MIGRATION_INPUT_USAGE");
  return { command, host, database, confirmation, user, port: String(Number(port)) };
}

export async function readPassword(stream) {
  if (!stream || stream.isTTY) fail("MIGRATION_INPUT_PASSWORD");
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      bytes += buffer.length;
      if (bytes > MAX_PASSWORD_BYTES) fail("MIGRATION_INPUT_PASSWORD");
    }
    const source = Buffer.concat(chunks);
    try {
      let password;
      try { password = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source); }
      catch { fail("MIGRATION_INPUT_PASSWORD"); }
      if (!password || /[\0\r\n]/.test(password)) fail("MIGRATION_INPUT_PASSWORD");
      return password;
    } finally { source.fill(0); }
  } catch { fail("MIGRATION_INPUT_PASSWORD"); }
  finally { for (const chunk of chunks) chunk.fill(0); }
}
