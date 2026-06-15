import { Router } from "express";
import { stripe } from "../stripe.js";
import { config, getPlan } from "../config.js";

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
 * Lets the success page show the plan + email without exposing Stripe keys.
 */
checkoutRouter.get("/checkout/session", async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Not configured." });
  const id = String(req.query.id ?? "");
  if (!id) return res.status(400).json({ error: "Missing id." });
  try {
    const s = await stripe.checkout.sessions.retrieve(id);
    return res.json({
      plan: s.metadata?.plan ?? null,
      email: s.customer_details?.email ?? null,
      status: s.payment_status,
    });
  } catch {
    return res.status(404).json({ error: "Session not found." });
  }
});
