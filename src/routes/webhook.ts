import { Router, raw } from "express";
import type Stripe from "stripe";
import { stripe } from "../stripe.js";
import { config, getPlan, type Tier } from "../config.js";
import { createLicense, getBySubscription, setStatus } from "../license.js";
import { sendLicenseEmail } from "../mailer.js";

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
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || !session.subscription) break;

      const subId = String(session.subscription);
      if (await getBySubscription(subId)) break; // already fulfilled

      // Tier comes from OUR metadata (set at checkout) — not from Stripe products.
      const planKey = (session.metadata?.plan || "").toLowerCase();
      const plan = getPlan(planKey);
      if (!plan) {
        console.warn(`webhook: unknown plan "${planKey}" on session ${session.id}`);
        break;
      }

      const customer = session.customer;
      const customerEmail =
        customer && typeof customer !== "string" && !customer.deleted
          ? customer.email
          : null;
      const email = session.customer_details?.email || customerEmail || "";
      if (!email) {
        console.warn(`webhook: no email on session ${session.id}`);
        break;
      }

      const sub = await stripe.subscriptions.retrieve(subId);
      const license = await createLicense({
        email,
        tier: plan.tier as Tier,
        stripeCustomerId: customer ? String(customer) : null,
        stripeSubscriptionId: subId,
        expiresAt: currentPeriodEnd(sub),
      });
      console.log(`✅ Issued ${plan.tier} license ${license.licenseKey} to ${email}`);
      await sendLicenseEmail(license);
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

function currentPeriodEnd(sub: Stripe.Subscription): Date | null {
  const end = (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof end === "number" ? new Date(end * 1000) : null;
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const sub = (invoice as unknown as { subscription?: string | { id: string } })
    .subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}
