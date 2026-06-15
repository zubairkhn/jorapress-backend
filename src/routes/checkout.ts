import { Router } from "express";
import { stripe } from "../stripe.js";
import { config, getPlan } from "../config.js";
import { fulfillCheckoutSession } from "../fulfillment.js";
import { daysLeft } from "../license.js";

export const checkoutRouter = Router();

/**
 * POST /api/checkout  { plan: "pro" | "agency" }
 * Creates a Stripe Checkout Session using an INLINE price (price_data) built
 * from our own plan catalog — Stripe holds no products/prices of ours. Returns
 * the hosted checkout URL.
 */
checkoutRouter.post("/checkout", async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: "Payments are not configured yet." });
  }

  const planKey = String(req.body?.plan ?? "pro").toLowerCase();
  const plan = getPlan(planKey);
  if (!plan) {
    return res.status(400).json({ error: `Unknown plan "${planKey}".` });
  }

  if (!config.stripe.successUrl.startsWith("http")) {
    console.error("checkout: CHECKOUT_SUCCESS_URL is not set or invalid:", config.stripe.successUrl);
    return res.status(503).json({ error: "Checkout not configured — missing success URL." });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: plan.currency,
            product_data: { name: plan.name },
            unit_amount: plan.amount,
            recurring: { interval: plan.interval },
          },
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: `${config.stripe.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.stripe.cancelUrl}?plan=${plan.tier}`,
      metadata: { plan: plan.tier },
      subscription_data: { metadata: { plan: plan.tier } },
    });
    return res.json({ url: session.url });
  } catch (err) {
    console.error("checkout: create session failed", err);
    return res.status(502).json({ error: "Could not start checkout." });
  }
});

/**
 * GET /api/checkout/session?id=cs_...
 * Powers the success page: returns the plan + email AND the issued license key.
 * Acts as a fulfillment fallback — if the webhook hasn't landed yet (or isn't
 * configured), it issues + emails the license on demand so the customer always
 * sees their key here.
 */
checkoutRouter.get("/checkout/session", async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Not configured." });
  const id = String(req.query.id ?? "");
  if (!id) return res.status(400).json({ error: "Missing id." });
  try {
    const s = await stripe.checkout.sessions.retrieve(id);

    // Ensure the license exists (idempotent). Non-fatal if it can't be issued.
    let license = null;
    try {
      license = await fulfillCheckoutSession(s);
    } catch (err) {
      console.error("checkout/session: fulfillment fallback failed", err);
    }

    return res.json({
      plan: s.metadata?.plan ?? null,
      email: s.customer_details?.email ?? null,
      status: s.payment_status,
      license: license
        ? {
            key: license.licenseKey,
            tier: license.tier,
            maxSites: license.maxSites,
            expiresAt: license.expiresAt,
            daysLeft: daysLeft(license),
          }
        : null,
    });
  } catch {
    return res.status(404).json({ error: "Session not found." });
  }
});
