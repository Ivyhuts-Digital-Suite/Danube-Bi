import path from "node:path";
import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z
    .string()
    .min(1, "MONGODB_URI is required (see .env.example)")
    .refine((v) => v.startsWith("mongodb://") || v.startsWith("mongodb+srv://"), "MONGODB_URI must start with mongodb:// or mongodb+srv://"),
  DATA_DIR: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(1024).default(200),
});

export type Env = {
  MONGODB_URI: string;
  DATA_DIR: string;
  INCOMING_DIR: string;
  DLD_DIR: string;
  MAX_UPLOAD_BYTES: number;
};

let cached: Env | null = null;

/** Validated server-side configuration. Throws a message that never includes the URI itself. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  // Runtime-configured directory: exclude from bundler file tracing.
  const dataDir = path.resolve(/*turbopackIgnore: true*/ parsed.data.DATA_DIR ?? path.join(process.cwd(), "data"));
  cached = {
    MONGODB_URI: parsed.data.MONGODB_URI,
    DATA_DIR: dataDir,
    INCOMING_DIR: path.join(dataDir, "incoming"),
    DLD_DIR: path.join(dataDir, "incoming", "dld"),
    MAX_UPLOAD_BYTES: parsed.data.MAX_UPLOAD_MB * 1024 * 1024,
  };
  return cached;
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}
