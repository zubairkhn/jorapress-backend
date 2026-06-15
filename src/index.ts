import express from "express";
import { config } from "./config.js";
import { connectDB } from "./db.js";
import { webhookRouter } from "./routes/webhook.js";
import { checkoutRouter } from "./routes/checkout.js";
import { licenseRouter } from "./routes/license.js";
import { updateRouter } from "./routes/update.js";
import { accountRouter } from "./routes/account.js";
import { adminRouter } from "./routes/admin.js";
import { errorHandler } from "./util.js";

const app = express();
app.disable("x-powered-by");

// Minimal CORS for the marketing site's browser calls (checkout). License/update
// calls come from WordPress servers (no Origin) so they're unaffected.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Stripe webhook needs the RAW body — mount it before express.json().
app.use("/api", webhookRouter);

// JSON parser for everything else.
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, version: config.plugin.version }));

app.use("/api", checkoutRouter);
app.use("/api", licenseRouter);
app.use("/api", updateRouter);
app.use("/api", accountRouter);
app.use("/api", adminRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found." }));
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 JoraPress backend on http://localhost:${config.port}`);
  if (!config.stripe.secretKey) console.warn("   ⚠️  STRIPE_SECRET_KEY not set — payments disabled.");
  if (!config.smtp.pass) console.warn("   ⚠️  SMTP not fully set — license emails disabled.");
});

// Connect to Mongo in the background so /health stays up during DB hiccups;
// data operations will error clearly until the connection succeeds.
void connectDB();
