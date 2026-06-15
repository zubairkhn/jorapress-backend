import { Router } from "express";
import {
  activateSite,
  activeSiteCount,
  deactivateSite,
  expiresUnix,
  getByKey,
  isValid,
} from "../license.js";
import { asyncHandler } from "../util.js";
import type { LicenseDoc } from "../models/license.js";

export const licenseRouter = Router();

/** Shape returned to the plugin so it can set its tier + entitlements. */
function licenseStatus(lic: LicenseDoc, valid: boolean) {
  return {
    valid,
    tier: valid ? lic.tier : null,
    status: lic.status,
    expires_at: expiresUnix(lic),
    max_sites: lic.maxSites,
    sites_active: activeSiteCount(lic),
  };
}

/** POST /api/license/activate  { key, site, version? } */
licenseRouter.post("/license/activate", asyncHandler(async (req, res) => {
  const { key, site, version } = req.body ?? {};
  const lic = await getByKey(String(key ?? ""));
  if (!lic) return res.status(404).json({ valid: false, error: "Unknown license key." });

  if (!isValid(lic)) {
    return res
      .status(403)
      .json({ ...licenseStatus(lic, false), error: `License is ${lic.status}.` });
  }

  const result = await activateSite(lic, String(site ?? ""), version ? String(version) : undefined);
  if (!result.ok) {
    return res.status(409).json({ ...licenseStatus(lic, true), error: result.error });
  }
  return res.json(licenseStatus(lic, true));
}));

/** POST /api/license/validate  { key } */
licenseRouter.post("/license/validate", asyncHandler(async (req, res) => {
  const { key } = req.body ?? {};
  const lic = await getByKey(String(key ?? ""));
  if (!lic) return res.status(404).json({ valid: false, error: "Unknown license key." });
  return res.json(licenseStatus(lic, isValid(lic)));
}));

/** POST /api/license/deactivate  { key, site } */
licenseRouter.post("/license/deactivate", asyncHandler(async (req, res) => {
  const { key, site } = req.body ?? {};
  const lic = await getByKey(String(key ?? ""));
  if (!lic) return res.status(404).json({ ok: false, error: "Unknown license key." });
  const removed = await deactivateSite(lic, String(site ?? ""));
  return res.json({ ok: removed, sites_active: activeSiteCount(lic) });
}));
