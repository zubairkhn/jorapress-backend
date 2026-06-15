import mongoose from "mongoose";
import type { RequestHandler } from "express";
import { config } from "./config.js";

// Fail fast instead of buffering forever when Mongo is unreachable.
mongoose.set("bufferCommands", false);

// Cache the connection promise. In serverless (Vercel) each request may hit a
// fresh-ish container, so we reuse one in-flight/established connection rather
// than reconnecting per request.
let connPromise: Promise<typeof mongoose> | null = null;

export function connectDB(): Promise<typeof mongoose> {
  if (connPromise) return connPromise;
  connPromise = mongoose
    .connect(config.mongoUri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 10 })
    .then((m) => {
      console.log(`🗄️  Connected to MongoDB (${mongoose.connection.name})`);
      return m;
    })
    .catch((err) => {
      console.error("❌ MongoDB connection failed:", (err as Error).message);
      connPromise = null; // let the next request retry the connection
      throw err;
    });
  return connPromise;
}

/**
 * Express middleware: guarantees the DB is connected before a route runs.
 * Required because `bufferCommands = false` makes queries throw if issued
 * before the initial connection completes (the serverless cold-start race).
 */
export const ensureDB: RequestHandler = (_req, res, next) => {
  connectDB()
    .then(() => next())
    .catch(() => res.status(503).json({ error: "Service temporarily unavailable." }));
};

export { mongoose };
