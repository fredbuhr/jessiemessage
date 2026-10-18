export class BroadcastConfigError extends Error {
  constructor() {
    super("Explicit and valid broadcast configuration is required.");
    this.name = "BroadcastConfigError";
    this.code = "BROADCAST_CONFIG";
  }
}

export function broadcastConfiguration(env = process.env, { crmEnabled = false } = {}) {
  const flag = env.JESSIEMESSAGE_ENABLE_BROADCAST;
  if (flag === undefined || flag === "0") return { enabled: false };
  if (flag !== "1" || crmEnabled !== true) throw new BroadcastConfigError();
  return { enabled: true };
}
