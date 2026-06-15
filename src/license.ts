import { randomBytes } from "node:crypto";
import { LicenseModel, type LicenseDoc } from "./models/license.js";
import { PLANS, type Tier } from "./config.js";

/** Generates a key like JP-A1B2-C3D4-E5F6-G7H8 (no ambiguous chars). */
export function generateKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const group = () => {
    const bytes = randomBytes(4);
    let out = "";
    for (let i = 0; i < 4; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  };
  return `JP-${group()}-${group()}-${group()}-${group()}`;
}

export function getByKey(key: string): Promise<LicenseDoc | null> {
  return LicenseModel.findOne({ licenseKey: (key || "").trim() }).exec();
}

export function getBySubscription(subId: string): Promise<LicenseDoc | null> {
  return LicenseModel.findOne({ stripeSubscriptionId: subId }).exec();
}

/** Normalize an email for case-insensitive matching/storage. */
export function normalizeEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

/** All licenses belonging to an email, newest first. */
export function getByEmail(email: string): Promise<LicenseDoc[]> {
  return LicenseModel.find({ email: normalizeEmail(email) }).sort({ createdAt: -1 }).exec();
}

/** Whole-number days until expiry (null = no expiry; 0 = expired). */
export function daysLeft(lic: LicenseDoc): number | null {
  if (!lic.expiresAt) return null;
  const ms = lic.expiresAt.getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

export function createLicense(params: {
  email: string;
  tier: Tier;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  expiresAt?: Date | null;
}): Promise<LicenseDoc> {
  return LicenseModel.create({
    licenseKey: generateKey(),
    email: normalizeEmail(params.email),
    tier: params.tier,
    status: "active",
    maxSites: PLANS[params.tier].maxSites,
    stripeCustomerId: params.stripeCustomerId ?? null,
    stripeSubscriptionId: params.stripeSubscriptionId ?? null,
    expiresAt: params.expiresAt ?? null,
  });
}

export async function setStatus(
  lic: LicenseDoc,
  status: "active" | "cancelled" | "expired",
  expiresAt?: Date | null
): Promise<void> {
  lic.status = status;
  if (expiresAt !== undefined) lic.expiresAt = expiresAt;
  await lic.save();
}

/** A license is usable if active and not past its expiry. */
export function isValid(lic: LicenseDoc): boolean {
  if (lic.status !== "active") return false;
  if (lic.expiresAt && lic.expiresAt.getTime() < Date.now()) return false;
  return true;
}

export function activeSiteCount(lic: LicenseDoc): number {
  return lic.activations.length;
}

export function hasSite(lic: LicenseDoc, siteUrl: string): boolean {
  const site = normalizeSite(siteUrl);
  return lic.activations.some((a) => a.siteUrl === site);
}

/**
 * Activate a license on a site. Idempotent for an already-activated site
 * (refreshes last_seen). Enforces the tier's site limit.
 */
export async function activateSite(
  lic: LicenseDoc,
  siteUrl: string,
  version?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const site = normalizeSite(siteUrl);
  if (!site) return { ok: false, error: "Missing site URL." };

  const existing = lic.activations.find((a) => a.siteUrl === site);
  if (existing) {
    existing.version = version ?? null;
    existing.lastSeenAt = new Date();
    await lic.save();
    return { ok: true };
  }

  if (lic.activations.length >= lic.maxSites) {
    return {
      ok: false,
      error: `Site limit reached (${lic.maxSites} for the ${lic.tier} plan). Deactivate another site first.`,
    };
  }

  lic.activations.push({
    siteUrl: site,
    version: version ?? null,
    activatedAt: new Date(),
    lastSeenAt: new Date(),
  });
  await lic.save();
  return { ok: true };
}

export async function deactivateSite(lic: LicenseDoc, siteUrl: string): Promise<boolean> {
  const site = normalizeSite(siteUrl);
  const before = lic.activations.length;
  lic.activations = lic.activations.filter((a) => a.siteUrl !== site) as typeof lic.activations;
  if (lic.activations.length === before) return false;
  await lic.save();
  return true;
}

/** Strip protocol/trailing slash so http/https + trailing-slash variants match. */
export function normalizeSite(url: string): string {
  return (url || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** Unix-seconds expiry for the plugin API (or null). */
export function expiresUnix(lic: LicenseDoc): number | null {
  return lic.expiresAt ? Math.floor(lic.expiresAt.getTime() / 1000) : null;
}
