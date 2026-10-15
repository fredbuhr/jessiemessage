const PATH_MODE = "JESSIEMESSAGE_PRIVATE_PATH_MODE";
const FORBIDDEN = new Set(["NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED",
  "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR", "OPENSSL_CONF"]);

export class PrivateAuthenticationEnvironmentError extends Error {
  constructor() {
    super("Private authentication process configuration is unavailable.");
    this.code = "PRIVATE_AUTH_ENVIRONMENT";
  }
}
const fail = () => { throw new PrivateAuthenticationEnvironmentError(); };

// These checks reject ambient application configuration and trust-store
// overrides. They are startup hygiene, not a sandbox against an operator or
// preload that already controls this Node process. No source value is returned.
export function privateAuthenticationProcessOptions(env = process.env, execArgv = process.execArgv) {
  try {
    if (!env || typeof env !== "object" || Array.isArray(env) || Object.getOwnPropertySymbols(env).length
      || !Array.isArray(execArgv) || Object.getOwnPropertyDescriptor(execArgv, "length")?.value !== 0) fail();
    const fields = Object.getOwnPropertyDescriptors(env);
    for (const name of Object.keys(fields)) {
      if (!Object.hasOwn(fields[name], "value") || FORBIDDEN.has(name)
        || name.startsWith("JESSIEMESSAGE_") && name !== PATH_MODE) fail();
    }
    if (fields[PATH_MODE]?.value !== "linux-dirfd") fail();
    const port = fields.PORT === undefined ? "3000" : fields.PORT.value;
    if (typeof port !== "string" || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) fail();
    return { port };
  } catch { fail(); }
}
