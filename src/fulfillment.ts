import type Stripe from "stripe";
import { stripe } from "./stripe.js";
import { getPlan, type Tier } from "./config.js";
import { createLicense, getBySubscription } from "./license.js";
import type { LicenseDoc } from "./models/license.js";
import { sendLicenseEmail } from "./mailer.js";

/**
 * Turn a paid Checkout Session into a license — idempotently.
 *
 * Called from two places:
 *  - the Stripe webhook (the reliable path), and
 *  - the success page's session lookup (a fallback so the key shows up even if
 *    the webhook is delayed or not yet configured).
 *
 * Safe to call repeatedly: if a license already exists for the subscription it
 * is returned without creating a duplicate or re-sending the email.
 */
export async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<LicenseDoc | null> {
  if (!stripe) return null;
  if (session.mode !== "subscription" || !session.subscription) return null;
  if (session.payment_status !== "paid") return null;

  const subId = String(session.subscription);
  const existing = await getBySubscription(subId);
  if (existing) return existing; // already fulfilled — no duplicate, no re-email

  const planKey = (session.metadata?.plan || "").toLowerCase();
  const plan = getPlan(planKey);
  if (!plan) {
    console.warn(`fulfillment: unknown plan "${planKey}" on session ${session.id}`);
    return null;
  }

  const customer = session.customer;
  const customerEmail =
    customer && typeof customer !== "string" && !customer.deleted ? customer.email : null;
  const email = session.customer_details?.email || customerEmail || "";
  if (!email) {
    console.warn(`fulfillment: no email on session ${session.id}`);
    return null;
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
  return license;
}

export function currentPeriodEnd(sub: Stripe.Subscription): Date | null {
  const end = (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof end === "number" ? new Date(end * 1000) : null;
}
