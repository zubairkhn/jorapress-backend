import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { config, PLANS, type Tier } from "../config.js";
import { LicenseModel } from "../models/license.js";
import { daysLeft, isValid } from "../license.js";
import { signToken, requireAdmin, ADMIN_TTL } from "../auth.js";
import { asyncHandler } from "../util.js";

export const adminRouter = Router();

function passwordMatches(input: string): boolean {
  const a = Buffer.from(input || "");
  const b = Buffer.from(config.adminPassword || "");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Monthly value of one license (annual plans normalised to /12). */
function monthlyValue(tier: Tier): number {
  const plan = PLANS[tier];
  if (!plan) return 0;
  const perYear = plan.interval === "year" ? plan.amount : plan.amount * 12;
  return perYear / 12;
}

/** POST /api/admin/login { password } → admin session token. */
adminRouter.post(
  "/admin/login",
  asyncHandler(async (req, res) => {
    if (!config.adminPassword) {
      return res.status(503).json({ error: "Admin access is not configured." });
    }
    if (!passwordMatches(String(req.body?.password ?? ""))) {
      return res.status(401).json({ error: "Incorrect password." });
    }
    return res.json({ token: signToken({ t: "admin" }, ADMIN_TTL) });
  })
);

/** GET /api/admin/stats → headline numbers for the dashboard. */
adminRouter.get(
  "/admin/stats",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const all = await LicenseModel.find().exec();

    let activeCount = 0;
    let mrrCents = 0;
    const byTier: Record<string, number> = {};
    let activations = 0;

    for (const lic of all) {
      activations += lic.activations.length;
      byTier[lic.tier] = (byTier[lic.tier] ?? 0) + 1;
      if (isValid(lic)) {
        activeCount += 1;
        mrrCents += monthlyValue(lic.tier as Tier);
      }
    }

    const customers = new Set(all.map((l) => l.email)).size;

    return res.json({
      totalLicenses: all.length,
      customers,
      active: activeCount,
      cancelled: all.filter((l) => l.status === "cancelled").length,
      expired: all.filter((l) => l.status === "expired").length,
      byTier,
      activations,
      mrr: Math.round(mrrCents) / 100, // dollars
      arr: Math.round(mrrCents * 12) / 100,
      currency: "usd",
    });
  })
);

/**
 * GET /api/admin/licenses?search=&status=&tier=&page=&limit=
 * Paginated, searchable list for the customers table.
 */
adminRouter.get(
  "/admin/licenses",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const tier = String(req.query.tier ?? "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));

    const filter: Record<string, unknown> = {};
    if (search) {
      filter.$or = [
        { email: { $regex: search, $options: "i" } },
        { licenseKey: { $regex: search, $options: "i" } },
        { "activations.siteUrl": { $regex: search, $options: "i" } },
      ];
    }
    if (status) filter.status = status;
    if (tier) filter.tier = tier;

    const total = await LicenseModel.countDocuments(filter);
    const docs = await LicenseModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();

    return res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
      licenses: docs.map((lic) => ({
        key: lic.licenseKey,
        email: lic.email,
        tier: lic.tier,
        status: lic.status,
        valid: isValid(lic),
        maxSites: lic.maxSites,
        sitesUsed: lic.activations.length,
        expiresAt: lic.expiresAt,
        daysLeft: daysLeft(lic),
        createdAt: lic.createdAt,
      })),
    });
  })
);

/** GET /api/admin/licenses/:key → full detail incl. linked sites. */
adminRouter.get(
  "/admin/licenses/:key",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const lic = await LicenseModel.findOne({ licenseKey: req.params.key }).exec();
    if (!lic) return res.status(404).json({ error: "License not found." });
    return res.json({
      key: lic.licenseKey,
      email: lic.email,
      tier: lic.tier,
      status: lic.status,
      valid: isValid(lic),
      maxSites: lic.maxSites,
      sitesUsed: lic.activations.length,
      expiresAt: lic.expiresAt,
      daysLeft: daysLeft(lic),
      stripeCustomerId: lic.stripeCustomerId,
      stripeSubscriptionId: lic.stripeSubscriptionId,
      createdAt: lic.createdAt,
      updatedAt: lic.updatedAt,
      sites: lic.activations.map((a) => ({
        url: a.siteUrl,
        version: a.version,
        activatedAt: a.activatedAt,
        lastSeenAt: a.lastSeenAt,
      })),
    });
  })
);
