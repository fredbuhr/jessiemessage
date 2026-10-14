import { readFile } from "node:fs/promises";
import { canonicalEmail } from "../auth/config.mjs";
import { tokenDigest } from "../auth/crypto.mjs";

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

export async function createVerificationTransport(config, { createTransport } = {}) {
  let transport;
  try {
    if (config?.enabled !== true || ![465, 587].includes(config.smtp?.port)) throw new Error();
    const origin = new URL(config.origin);
    if (origin.protocol !== "https:" || origin.origin !== config.origin || origin.username || origin.password) throw new Error();
    if (canonicalEmail(config.smtp.from) !== config.smtp.from) throw new Error();
    const tls = { rejectUnauthorized: true, minVersion: "TLSv1.2" };
    if (config.smtp.caPath) tls.ca = await readFile(config.smtp.caPath, "utf8");
    const factory = createTransport ?? (await import("nodemailer")).default.createTransport;
    transport = factory({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      requireTLS: true,
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
  let closed = false;
  return Object.freeze({
    async sendVerification(input) {
      if (closed) throw new MailDeliveryError();
      validateMessage(input);
      const { email, token, jobId } = input;
      const link = `${config.origin}/access#verification=${token}`;
      try {
        const result = await transport.sendMail({
          from: config.smtp.from,
          to: email,
          envelope: { from: config.smtp.from, to: [email] },
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
          from: config.smtp.from,
          to: email,
          envelope: { from: config.smtp.from, to: [email] },
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
    async close() {
      if (closed) return;
      closed = true;
      try { await transport.close(); } catch { throw new MailDeliveryError("MAIL_TRANSPORT_CLOSE"); }
    },
  });
}
