import "dotenv/config";

const required = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    console.warn(`⚠️  Missing env ${name} — some features will be disabled.`);
    return "";
  }
  return v;
};

export const config = {
  port: Number(process.env.PORT) || 4000,
  publicUrl: required("PUBLIC_URL", "http://localhost:4000"),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  mongoUri: required("MONGODB_URI", "mongodb://127.0.0.1:27017/jorapress"),

  stripe: {
    secretKey: required("STRIPE_SECRET_KEY"),
    webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
    successUrl: required("CHECKOUT_SUCCESS_URL", "http://localhost:3000/checkout/success"),
    cancelUrl: required("CHECKOUT_CANCEL_URL", "http://localhost:3000/checkout"),
  },

  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.MAIL_FROM ?? "JoraPress <info@jorapress.com>",
  },

  plugin: {
    version: process.env.PLUGIN_VERSION ?? "0.1.0",
    zipPath: process.env.PLUGIN_ZIP_PATH ?? "./releases/jorapress.zip",
  },
};

export type Tier = "pro" | "agency";

/**
 * The product catalog lives HERE — our system is the source of truth for plans
 * and pricing. Stripe only collects the payment (we pass an inline price), so
 * there are no Stripe Products/Prices to manage. Edit prices/limits here.
 */
export interface Plan {
  tier: Tier;
  name: string;
  amount: number; // smallest currency unit (cents)
  currency: string; // ISO 4217
  interval: "month" | "year";
  maxSites: number;
}

export const PLANS: Record<Tier, Plan> = {
  pro: {
    tier: "pro",
    name: "JoraPress Pro",
    amount: 7900, // $79.00
    currency: "usd",
    interval: "year",
    maxSites: 1,
  },
  agency: {
    tier: "agency",
    name: "JoraPress Agency",
    amount: 24900, // $249.00
    currency: "usd",
    interval: "year",
    maxSites: 25,
  },
};

export function getPlan(plan: string): Plan | null {
  const p = plan.toLowerCase();
  return p === "pro" || p === "agency" ? PLANS[p as Tier] : null;
}
