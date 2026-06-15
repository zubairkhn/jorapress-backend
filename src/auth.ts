import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

/**
 * Tiny stateless token helper (HMAC-SHA256 signed JSON), used for two things:
 *  - "magic" tokens: short-lived, emailed to a customer to prove they own an inbox.
 *  - "session"/"admin" tokens: longer-lived, sent as a Bearer header by the SPA.
 *
 * No JWT dependency — a signed `base64url(payload).signature` is enough here.
 */

type TokenType = "magic" | "session" | "admin";

interface BasePayload {
  t: TokenType;
  exp: number; // unix seconds
  email?: string;
}

const b64url = (s: string | Buffer): string => Buffer.from(s).toString("base64url");

export function signToken(
  payload: Omit<BasePayload, "exp">,
  ttlSeconds: number
): string {
  const body: BasePayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const data = b64url(JSON.stringify(body));
  const sig = createHmac("sha256", config.authSecret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token: string, type: TokenType): BasePayload | null {
  const [data, sig] = (token || "").split(".");
  if (!data || !sig) return null;

  const expected = createHmac("sha256", config.authSecret).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let body: BasePayload;
  try {
    body = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
  if (body.t !== type) return null;
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

export const MAGIC_TTL = 15 * 60; // 15 minutes
export const SESSION_TTL = 7 * 24 * 60 * 60; // 7 days
export const ADMIN_TTL = 12 * 60 * 60; // 12 hours

/** Reads `Authorization: Bearer <token>`. */
function bearer(req: Request): string {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/** Adds the authenticated customer email to the request. */
export interface AccountRequest extends Request {
  accountEmail?: string;
}

export function requireAccount(req: AccountRequest, res: Response, next: NextFunction): void {
  const payload = verifyToken(bearer(req), "session");
  if (!payload?.email) {
    res.status(401).json({ error: "Please sign in again." });
    return;
  }
  req.accountEmail = payload.email.toLowerCase();
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const payload = verifyToken(bearer(req), "admin");
  if (!payload) {
    res.status(401).json({ error: "Admin sign-in required." });
    return;
  }
  next();
}
