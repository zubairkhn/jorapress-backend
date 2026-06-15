import nodemailer from "nodemailer";
import { config } from "./config.js";
import type { LicenseDoc } from "./models/license.js";

function transporter() {
  const { host, user, pass, port, secure } = config.smtp;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

/** Minimal branded HTML shell so all our emails look consistent. */
function shell(inner: string): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#111;max-width:520px;margin:0 auto">
    <div style="font-weight:800;font-size:20px;letter-spacing:-0.02em;margin-bottom:18px">Jora<span style="color:#06b6d4">Press</span></div>
    ${inner}
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0" />
    <p style="color:#999;font-size:12px;margin:0">JoraPress · <a href="${config.appUrl}/account" style="color:#06b6d4">Manage your account</a></p>
  </div>`;
}

/** Sends a passwordless sign-in link to the customer's account area. */
export async function sendMagicLinkEmail(email: string, link: string): Promise<void> {
  const tx = transporter();
  if (!tx) {
    console.warn(`✉️  SMTP not configured — sign-in link for ${email} was NOT sent.`);
    return;
  }
  await tx.sendMail({
    from: config.smtp.from,
    to: email,
    subject: "Sign in to your JoraPress account",
    text: [
      `Use this link to sign in to your JoraPress account:`,
      ``,
      link,
      ``,
      `This link expires in 15 minutes. If you didn't request it, you can ignore this email.`,
    ].join("\n"),
    html: shell(`
      <h2 style="margin:0 0 12px;font-size:18px">Sign in to your account</h2>
      <p>Click the button below to access your license key, linked sites and subscription.</p>
      <p style="margin:22px 0">
        <a href="${link}" style="background:#06b6d4;color:#062a2e;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;display:inline-block">Sign in to JoraPress →</a>
      </p>
      <p style="color:#666;font-size:13px">This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`),
  });
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
    html: shell(`
      <h2 style="margin:0 0 12px;font-size:18px">Thanks for purchasing JoraPress ${tierName}!</h2>
      <p>Your license key:</p>
      <p style="font:700 18px ui-monospace,monospace;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:14px 16px;letter-spacing:1px;text-align:center">
        ${lic.licenseKey}
      </p>
      <p>Activate it in WordPress under <strong>JoraPress → Settings → License</strong>.
      This key can be activated on up to <strong>${sites} site${sites === 1 ? "" : "s"}</strong>.</p>
      <p style="margin:22px 0">
        <a href="${config.appUrl}/account" style="background:#06b6d4;color:#062a2e;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;display:inline-block">View your account →</a>
      </p>
      <p style="color:#666;font-size:13px">From your account you can copy your key again, see linked sites and manage billing.</p>`),
  });
}
