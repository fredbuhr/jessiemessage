import { readFile } from "node:fs/promises";
import { isIP, Socket } from "node:net";
import { canonicalEmail } from "../auth/config.mjs";
import { tokenDigest } from "../auth/crypto.mjs";
import { SITE_CONTACT_EMAIL, isOfficialOrigin } from "../site.mjs";

export class MailDeliveryError extends Error {
  constructor(code = "MAIL_DELIVERY_FAILED") {
    super("Private email delivery could not be confirmed.");
    this.name = "MailDeliveryError";
    this.code = code;
  }
}

function validateMessage({ email, token, jobId }) {
  try {
    if (canonicalEmail(email) !== email || !Buffer.isBuffer(jobId) || jobId.length !== 16) throw new Error();
    tokenDigest(token);
  } catch { throw new MailDeliveryError("PAYLOAD_INVALID"); }
}

export async function createVerificationTransport(config, {
  createTransport, verifyTimeoutMilliseconds = 20000,
  connectSocket = (socket, options) => socket.connect(options),
} = {}) {
  let transport, from, replyTo;
  let closed = false, closing, verifying = false;
  const sockets = new Set(), operations = new Set();
  function getSocket(_options, callback) {
    if (closed) { callback(new MailDeliveryError()); return; }
    // getSocket is a public Nodemailer SMTP option. Own the raw TCP socket
    // before DNS/connect starts; destroying it also closes a later TLS wrapper.
    // Nodemailer still performs implicit TLS/STARTTLS with the original host,
    // certificate verification, CA and TLS options. Never mark this socket TLS.
    const socket = new Socket();
    let delivered = false, timer, finishClosed;
    const record = { socket, finished: new Promise((resolve) => { finishClosed = resolve; }) };
    sockets.add(record);
    const finish = (error) => {
      if (delivered) return;
      delivered = true;
      clearTimeout(timer);
      socket.off("connect", connected);
      if (error) socket.destroy();
      callback(error ?? null, error ? undefined : { connection: socket });
    };
    const connected = () => finish(closed ? new MailDeliveryError() : null);
    // Retain this neutral listener after handing the socket over: close can
    // happen before Nodemailer attaches listeners or during a TLS upgrade.
    socket.on("error", () => finish(new MailDeliveryError()));
    socket.once("close", () => {
      clearTimeout(timer);
      sockets.delete(record);
      finishClosed();
      finish(new MailDeliveryError());
    });
    socket.once("connect", connected);
    timer = setTimeout(() => finish(new MailDeliveryError()), 15000);
    timer.unref();
    try { connectSocket(socket, { host: config.smtp.host, port: config.smtp.port }); }
    catch { finish(new MailDeliveryError()); }
  }
  try {
    if (config?.enabled !== true || ![465, 587].includes(config.smtp?.port)) throw new Error();
    if (!Number.isSafeInteger(verifyTimeoutMilliseconds) || verifyTimeoutMilliseconds < 1
      || verifyTimeoutMilliseconds > 30000 || typeof connectSocket !== "function") throw new Error();
    if (typeof config.smtp.host !== "string" || config.smtp.host.length < 1 || config.smtp.host.length > 253
      || (!isIP(config.smtp.host) && config.smtp.host.split(".").some((label) => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))) throw new Error();
    for (const [value, maximum] of [[config.smtp.user, 256], [config.smtp.password, 1024]]) {
      if (typeof value !== "string" || value.length < 1 || value.length > maximum || !value.isWellFormed() || /[\x00-\x1f\x7f]/.test(value)) throw new Error();
    }
    const origin = new URL(config.origin);
    if (origin.protocol !== "https:" || origin.origin !== config.origin || origin.username || origin.password) throw new Error();
    from = canonicalEmail(config.smtp.from);
    replyTo = config.smtp.replyTo === undefined ? from : canonicalEmail(config.smtp.replyTo);
    if (from !== config.smtp.from || (config.smtp.replyTo !== undefined && replyTo !== config.smtp.replyTo)
      || replyTo !== from || (isOfficialOrigin(config.origin) && from !== SITE_CONTACT_EMAIL)) throw new Error();
    const tls = { rejectUnauthorized: true, minVersion: "TLSv1.2" };
    if (config.smtp.caPath) tls.ca = await readFile(config.smtp.caPath, "utf8");
    const factory = createTransport ?? (await import("nodemailer")).default.createTransport;
    transport = factory({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      requireTLS: true,
      forceAuth: true,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      tls,
      getSocket,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 45000,
      pool: false,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  } catch { throw new MailDeliveryError("MAIL_TRANSPORT_CONFIG"); }
  const close = () => {
    if (closing) return closing;
    closed = true;
    for (const cancel of operations) cancel();
    const waiting = [...sockets].map(({ socket, finished }) => { socket.destroy(); return finished; });
    closing = (async () => {
      let failed = false;
      try { await transport.close(); } catch { failed = true; }
      await Promise.all(waiting);
      if (failed) throw new MailDeliveryError("MAIL_TRANSPORT_CLOSE");
    })();
    return closing;
  };
  async function operation(work, code) {
    if (closed) throw new MailDeliveryError(code);
    let cancel;
    const cancelled = new Promise((_, reject) => { cancel = () => reject(new MailDeliveryError(code)); operations.add(cancel); });
    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        if (closed) throw new MailDeliveryError(code);
        return work();
      }), cancelled]);
      if (closed) throw new MailDeliveryError(code);
      return result;
    } catch { throw new MailDeliveryError(code); }
    finally { operations.delete(cancel); }
  }
  return Object.freeze({
    async verify() {
      if (closed || verifying) throw new MailDeliveryError("MAIL_VERIFY_FAILED");
      verifying = true;
      let timer;
      try {
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => {
            // This transport belongs to this check; close it even if its verify promise stalls.
            void close().catch(() => {});
            reject(new MailDeliveryError("MAIL_VERIFY_FAILED"));
          }, verifyTimeoutMilliseconds);
          timer.unref();
        });
        const result = await Promise.race([
          operation(() => transport.verify(), "MAIL_VERIFY_FAILED"), deadline,
        ]);
        if (result !== true || closed) throw new MailDeliveryError("MAIL_VERIFY_FAILED");
        return true;
      } catch { throw new MailDeliveryError("MAIL_VERIFY_FAILED"); }
      finally { clearTimeout(timer); verifying = false; }
    },
    async sendVerification(input) {
      if (closed) throw new MailDeliveryError();
      validateMessage(input);
      const { email, token, jobId } = input;
      const link = `${config.origin}/access#verification=${token}`;
      try {
        const result = await operation(() => transport.sendMail({
          from,
          replyTo,
          to: email,
          envelope: { from, to: [email] },
          messageId: `<verification-${jobId.toString("hex")}@${new URL(config.origin).hostname}>`,
          subject: "Confirmez votre adresse e-mail — JessieMessage",
          text: `Bonjour,\n\nPour confirmer votre adresse e-mail sur JessieMessage, ouvrez ce lien :\n${link}\n\nCe lien est personnel, temporaire et utilisable une seule fois. Si vous n'avez pas demandé cette inscription, ignorez ce message.\n\nJessieMessage`,
        }), "MAIL_DELIVERY_FAILED");
        const accepted = Array.isArray(result?.accepted) && result.accepted.some((address) => {
          try { return canonicalEmail(address) === email; } catch { return false; }
        });
        if (!accepted) throw new Error();
        return true;
      } catch { throw new MailDeliveryError(); }
    },
    async sendPasswordReset(input) {
      if (closed) throw new MailDeliveryError();
      validateMessage(input);
      const { email, token, jobId } = input;
      const link = `${config.origin}/recover#reset=${token}`;
      try {
        const result = await operation(() => transport.sendMail({
          from,
          replyTo,
          to: email,
          envelope: { from, to: [email] },
          messageId: `<password-reset-${jobId.toString("hex")}@${new URL(config.origin).hostname}>`,
          subject: "Retrouver ton accès — JessieMessage",
          text: `Bonjour,\n\nPour retrouver ton espace JessieMessage, choisis un nouveau mot de passe en ouvrant ce lien :\n${link}\n\nCe lien est personnel, valable 30 minutes et utilisable une seule fois.\n\nSi tu n'as pas demandé ce lien, tu peux ignorer cet e-mail. Ton mot de passe reste inchangé tant que tu n'en choisis pas un nouveau.\n\nÀ bientôt,\nJessieMessage`,
        }), "MAIL_DELIVERY_FAILED");
        const accepted = Array.isArray(result?.accepted) && result.accepted.some((address) => {
          try { return canonicalEmail(address) === email; } catch { return false; }
        });
        if (!accepted) throw new Error();
        return true;
      } catch { throw new MailDeliveryError(); }
    },
    close,
  });
}
