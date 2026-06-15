import { Router } from "express";
import { existsSync, statSync, createReadStream } from "node:fs";
import { resolve } from "node:path";
import { stripe } from "../stripe.js";
import { config } from "../config.js";
import {
  getByEmail,
  getByKey,
  isValid,
  daysLeft,
  normalizeEmail,
} from "../license.js";
import {
  signToken,
  verifyToken,
  requireAccount,
  type AccountRequest,
  MAGIC_TTL,
  SESSION_TTL,
} from "../auth.js";
import { sendMagicLinkEmail } from "../mailer.js";
import { asyncHandler } from "../util.js";

export const accountRouter = Router();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * POST /api/account/request-link  { email }
 * Emails a magic sign-in link IF the email has at least one license.
 * Always returns 200 so we never reveal whether an email exists.
 */
accountRouter.post(
  "/account/request-link",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(String(req.body?.email ?? ""));
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const licenses = await getByEmail(email);
    if (licenses.length > 0) {
      const token = signToken({ t: "magic", email }, MAGIC_TTL);
      const link = `${config.appUrl}/account/verify?token=${encodeURIComponent(token)}`;
      try {
        await sendMagicLinkEmail(email, link);
      } catch (err) {
        console.error("account: failed to send magic link", err);
      }
    }

    return res.json({ ok: true });
  })
);

/**
 * POST /api/account/verify  { token }
 * Exchanges a valid magic token for a longer-lived session token.
 */
accountRouter.post(
  "/account/verify",
  asyncHandler(async (req, res) => {
    const payload = verifyToken(String(req.body?.token ?? ""), "magic");
    if (!payload?.email) {
      return res.status(401).json({ error: "This sign-in link is invalid or expired." });
    }
    const session = signToken({ t: "session", email: payload.email }, SESSION_TTL);
    return res.json({ token: session, email: payload.email });
  })
);

/**
 * GET /api/account/me   (Bearer session token)
 * Everything the account dashboard renders.
 */
accountRouter.get(
  "/account/me",
  requireAccount,
  asyncHandler(async (req: AccountRequest, res) => {
    const email = req.accountEmail!;
    const licenses = await getByEmail(email);

    return res.json({
      email,
      licenses: licenses.map((lic) => ({
        key: lic.licenseKey,
        tier: lic.tier,
        status: lic.status,
        maxSites: lic.maxSites,
        sitesUsed: lic.activations.length,
        expiresAt: lic.expiresAt,
        daysLeft: daysLeft(lic),
        valid: isValid(lic),
        canManageBilling: Boolean(lic.stripeCustomerId),
        createdAt: lic.createdAt,
        sites: lic.activations.map((a) => ({
          url: a.siteUrl,
          version: a.version,
          activatedAt: a.activatedAt,
          lastSeenAt: a.lastSeenAt,
        })),
      })),
    });
  })
);

/**
 * POST /api/account/portal  { key }   (Bearer session token)
 * Opens the Stripe Customer Portal for that license's customer (billing,
 * invoices, cancel, card updates).
 */
accountRouter.post(
  "/account/portal",
  requireAccount,
  asyncHandler(async (req: AccountRequest, res) => {
    if (!stripe) return res.status(503).json({ error: "Billing not configured." });
    const key = String(req.body?.key ?? "");
    const lic = await getByKey(key);
    if (!lic || normalizeEmail(lic.email) !== req.accountEmail) {
      return res.status(404).json({ error: "License not found." });
    }
    if (!lic.stripeCustomerId) {
      return res.status(400).json({ error: "No billing profile for this license." });
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: lic.stripeCustomerId,
      return_url: `${config.appUrl}/account`,
    });
    return res.json({ url: portal.url });
  })
);

/**
 * GET /api/account/download?key=   (Bearer session token)
 * Streams the licensed plugin zip — only for a valid license owned by the
 * signed-in customer.
 */
accountRouter.get(
  "/account/download",
  requireAccount,
  asyncHandler(async (req: AccountRequest, res) => {
    const key = String(req.query.key ?? "");
    const lic = await getByKey(key);
    if (!lic || normalizeEmail(lic.email) !== req.accountEmail) {
      return res.status(404).json({ error: "License not found." });
    }
    if (!isValid(lic)) {
      return res.status(403).json({ error: "This license is not active." });
    }
    const file = resolve(process.cwd(), config.plugin.zipPath);
    if (!existsSync(file)) {
      return res.status(404).json({ error: "Release artifact not found on server." });
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="jorapress.zip"');
    res.setHeader("Content-Length", statSync(file).size);
    createReadStream(file).pipe(res);
  })
);
