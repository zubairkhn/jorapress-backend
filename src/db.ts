import mongoose from "mongoose";
import { config } from "./config.js";

// Fail fast instead of buffering forever when Mongo is unreachable.
mongoose.set("bufferCommands", false);

export async function connectDB(): Promise<boolean> {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
    console.log(`🗄️  Connected to MongoDB (${mongoose.connection.name})`);
    return true;
  } catch (err) {
    console.error("❌ MongoDB connection failed:", (err as Error).message);
    return false;
  }
}

export { mongoose };
