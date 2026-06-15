import nodemailer from "nodemailer";
import { config } from "./config.js";
import type { LicenseDoc } from "./models/license.js";

function transporter() {
  const { host, user, pass, port, secure } = config.smtp;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

/** Emails the license key + setup instructions to the customer. */
export async function sendLicenseEmail(lic: LicenseDoc): Promise<void> {
  const tx = transporter();
  if (!tx) {
    console.warn(
      `✉️  SMTP not configured — license ${lic.licenseKey} for ${lic.email} was NOT emailed.`
    );
    return;
  }

  const tierName = lic.tier.charAt(0).toUpperCase() + lic.tier.slice(1);
  const sites = lic.maxSites;

  await tx.sendMail({
    from: config.smtp.from,
    to: lic.email,
    subject: `Your JoraPress ${tierName} license key`,
    text: [
      `Thanks for purchasing JoraPress ${tierName}!`,
      ``,
      `Your license key:`,
      `  ${lic.licenseKey}`,
      ``,
      `Activate it in WordPress under JoraPress → Settings → License.`,
      `This key can be activated on up to ${sites} site${sites === 1 ? "" : "s"}.`,
      ``,
      `Once activated you'll get the ${tierName} features and automatic updates.`,
      ``,
      `— The JoraPress team`,
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#111">
        <h2 style="margin:0 0 12px">Thanks for purchasing JoraPress ${tierName}!</h2>
        <p>Your license key:</p>
        <p style="font:600 18px ui-monospace,monospace;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:14px 16px;letter-spacing:1px">
          ${lic.licenseKey}
        </p>
        <p>Activate it in WordPress under <strong>JoraPress → Settings → License</strong>.
        This key can be activated on up to <strong>${sites} site${sites === 1 ? "" : "s"}</strong>.</p>
        <p>Once activated you'll unlock the ${tierName} features and automatic updates.</p>
        <p style="color:#666">— The JoraPress team</p>
      </div>`,
  });
}
