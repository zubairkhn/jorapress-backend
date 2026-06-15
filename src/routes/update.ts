import { Router } from "express";
import { existsSync, statSync, createReadStream } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { getByKey, hasSite, isValid } from "../license.js";
import { asyncHandler } from "../util.js";

export const updateRouter = Router();

const zipPath = () => resolve(process.cwd(), config.plugin.zipPath);

/** Compares dotted version strings: returns true if `a` > `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da > db;
  }
  return false;
}

/**
 * GET /api/update/check?key=&site=&version=
 * Returns the latest version and a download URL when a newer build exists and
 * the license is valid.
 */
updateRouter.get("/update/check", asyncHandler(async (req, res) => {
  const key = String(req.query.key ?? "");
  const site = String(req.query.site ?? "");
  const current = String(req.query.version ?? "0.0.0");

  const lic = await getByKey(key);
  const valid = Boolean(lic && isValid(lic));
  const latest = config.plugin.version;

  const update_available = valid ? isNewer(latest, current) : false;
  res.json({
    valid,
    latest,
    update_available,
    package: update_available
      ? `${config.publicUrl}/api/update/download?key=${encodeURIComponent(key)}&site=${encodeURIComponent(site)}`
      : null,
  });
}));

/**
 * GET /api/update/download?key=&site=
 * Serves the plugin zip — only to a valid, activated license.
 */
updateRouter.get("/update/download", asyncHandler(async (req, res) => {
  const key = String(req.query.key ?? "");
  const site = String(req.query.site ?? "");

  const lic = await getByKey(key);
  if (!lic || !isValid(lic)) {
    return res.status(403).json({ error: "Invalid or inactive license." });
  }
  if (site && !hasSite(lic, site)) {
    return res.status(403).json({ error: "Site is not activated for this license." });
  }

  const file = zipPath();
  if (!existsSync(file)) {
    return res.status(404).json({ error: "Release artifact not found on server." });
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="jorapress.zip"');
  res.setHeader("Content-Length", statSync(file).size);
  createReadStream(file).pipe(res);
}));
