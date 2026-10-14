import { accessConfiguration } from "../access/config.mjs";

export class ClientRecoveryConfigError extends Error {
  constructor() { super("Explicit and valid private client recovery configuration is required."); this.name = "ClientRecoveryConfigError"; this.code = "RESET_CONFIG"; }
}

export function clientRecoveryConfiguration(env = process.env) {
  const flag = env.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY;
  if (flag === undefined || flag === "0") return { enabled: false };
  if (flag !== "1") throw new ClientRecoveryConfigError();
  try {
    const access = accessConfiguration(env);
    if (!access.enabled) throw new ClientRecoveryConfigError();
    return { enabled: true, origin: access.origin, key: Buffer.from(access.mail.key) };
  } catch { throw new ClientRecoveryConfigError(); }
}
