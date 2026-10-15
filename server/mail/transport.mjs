import { readFile } from "node:fs/promises";
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
} = {}) {
  let transport, from, replyTo;
  try {
    if (config?.enabled !== true || ![465, 587].includes(config.smtp?.port)) throw new Error();
    if (!Number.isSafeInteger(verifyTimeoutMilliseconds) || verifyTimeoutMilliseconds < 1
      || verifyTimeoutMilliseconds > 30000) throw new Error();
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
  let closed = false, closing, verifying = false;
  const close = () => {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      try { await transport.close(); } catch { throw new MailDeliveryError("MAIL_TRANSPORT_CLOSE"); }
    })();
    return closing;
  };
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
          Promise.resolve().then(() => transport.verify()), deadline,
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
        const result = await transport.sendMail({
          from,
          replyTo,
          to: email,
          envelope: { from, to: [email] },
          messageId: `<verification-${jobId.toString("hex")}@${new URL(config.origin).hostname}>`,
          subject: "Confirmez votre adresse e-mail — JessieMessage",
          text: `Bonjour,\n\nPour confirmer votre adresse e-mail sur JessieMessage, ouvrez ce lien :\n${link}\n\nCe lien est personnel, temporaire et utilisable une seule fois. Si vous n'avez pas demandé cette inscription, ignorez ce message.\n\nJessieMessage`,
        });
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
        const result = await transport.sendMail({
          from,
          replyTo,
          to: email,
          envelope: { from, to: [email] },
          messageId: `<password-reset-${jobId.toString("hex")}@${new URL(config.origin).hostname}>`,
          subject: "Réinitialisez votre mot de passe — JessieMessage",
          text: `Bonjour,\n\nPour choisir un nouveau mot de passe JessieMessage, ouvrez ce lien :\n${link}\n\nCe lien est personnel, valable 30 minutes et utilisable une seule fois. Si vous n'avez pas demandé cette réinitialisation, ignorez ce message. Votre mot de passe reste inchangé tant que vous n'en avez pas choisi un nouveau.\n\nJessieMessage`,
        });
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
