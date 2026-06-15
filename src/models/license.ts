import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const activationSchema = new Schema(
  {
    siteUrl: { type: String, required: true },
    version: { type: String, default: null },
    activatedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const licenseSchema = new Schema(
  {
    licenseKey: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true },
    tier: { type: String, enum: ["pro", "agency"], required: true },
    status: {
      type: String,
      enum: ["active", "cancelled", "expired"],
      default: "active",
    },
    maxSites: { type: Number, required: true, default: 1 },
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null, index: true },
    expiresAt: { type: Date, default: null }, // null = no expiry
    activations: { type: [activationSchema], default: [] },
  },
  { timestamps: true }
);

// `timestamps: true` adds these at runtime; surface them in the type too.
export type License = InferSchemaType<typeof licenseSchema> & {
  createdAt: Date;
  updatedAt: Date;
};
export type LicenseDoc = HydratedDocument<License>;
export const LicenseModel = model("License", licenseSchema);
