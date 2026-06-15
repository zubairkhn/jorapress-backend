import { Router, raw } from "express";
import type Stripe from "stripe";
import { stripe } from "../stripe.js";
import { config } from "../config.js";
import { getBySubscription, setStatus } from "../license.js";
import { fulfillCheckoutSession, currentPeriodEnd } from "../fulfillment.js";

export const webhookRouter = Router();

/**
 * POST /api/stripe/webhook
 * Stripe fulfillment. Uses the raw body for signature verification, so this
 * router is mounted BEFORE the global express.json() parser.
 */
webhookRouter.post(
  "/stripe/webhook",
  raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe || !config.stripe.webhookSecret) {
      return res.status(503).json({ error: "Webhook not configured." });
    }
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).json({ error: "Missing signature." });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        sig,
        config.stripe.webhookSecret
      );
    } catch (err) {
      console.error("webhook: signature verification failed", err);
      return res.status(400).json({ error: "Invalid signature." });
    }

    try {
      await handleEvent(event);
    } catch (err) {
      console.error(`webhook: handler error for ${event.type}`, err);
      return res.status(500).json({ error: "Handler error." });
    }

    return res.json({ received: true });
  }
);

async function handleEvent(event: Stripe.Event): Promise<void> {
  if (!stripe) return;

  switch (event.type) {
    case "checkout.session.completed": {
      // Idempotent: issues + emails a license, or no-ops if already fulfilled.
      await fulfillCheckoutSession(event.data.object as Stripe.Checkout.Session);
      break;
    }

    case "invoice.paid": {
      // Renewal — extend the license's expiry to the new period end.
      const invoice = event.data.object as Stripe.Invoice;
      const subId = subscriptionIdFromInvoice(invoice);
      if (!subId) break;
      const lic = await getBySubscription(subId);
      if (!lic) break;
      const sub = await stripe.subscriptions.retrieve(subId);
      await setStatus(lic, "active", currentPeriodEnd(sub));
      console.log(`🔁 Renewed license ${lic.licenseKey}`);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const lic = await getBySubscription(sub.id);
      if (lic) {
        await setStatus(lic, "cancelled");
        console.log(`🚫 Cancelled license ${lic.licenseKey}`);
      }
      break;
    }

    default:
      break;
  }
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const sub = (invoice as unknown as { subscription?: string | { id: string } })
    .subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}
