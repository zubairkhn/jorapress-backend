import Stripe from "stripe";
import { config } from "./config.js";

/** Shared Stripe client, or null when no secret key is configured. */
export const stripe: Stripe | null = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: "2026-05-27.dahlia" })
  : null;
