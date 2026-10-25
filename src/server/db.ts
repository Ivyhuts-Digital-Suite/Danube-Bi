import mongoose from "mongoose";
import { getEnv } from "@/lib/env";

// One connection per process, reused across hot reloads in development.
const globalForMongo = globalThis as unknown as { __mongoConn?: Promise<typeof mongoose> };

mongoose.set("strictQuery", true);
// Fail fast instead of queueing queries forever when MongoDB is down.
mongoose.set("bufferCommands", false);

export async function connectDb(uri?: string): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!globalForMongo.__mongoConn) {
    const target = uri ?? getEnv().MONGODB_URI;
    globalForMongo.__mongoConn = mongoose
      .connect(target, { serverSelectionTimeoutMS: 3000, maxPoolSize: 10 })
      .catch((err) => {
        globalForMongo.__mongoConn = undefined;
        throw err;
      });
  }
  return globalForMongo.__mongoConn;
}

export async function disconnectDb() {
  globalForMongo.__mongoConn = undefined;
  await mongoose.disconnect();
}

export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("MongoDB is not reachable. Start MongoDB and check MONGODB_URI.");
    this.name = "DatabaseUnavailableError";
    this.cause = cause;
  }
}

/** Connects or throws DatabaseUnavailableError (with a message that never contains the URI). */
export async function requireDb(): Promise<typeof mongoose> {
  try {
    return await connectDb();
  } catch (err) {
    throw new DatabaseUnavailableError(err);
  }
}

export type DbStatus = { ok: true; database: string } | { ok: false; reason: string };

export async function getDbStatus(): Promise<DbStatus> {
  try {
    const conn = await connectDb();
    await conn.connection.db!.admin().ping();
    return { ok: true, database: conn.connection.name };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Invalid environment")) return { ok: false, reason: err.message };
    return { ok: false, reason: "MongoDB is not reachable. Start MongoDB and check MONGODB_URI." };
  }
}
