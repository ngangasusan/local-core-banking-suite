import "dotenv/config";
import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  MYSQL_URL: z.string().min(1),
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  PII_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "PII_KEY must be 64 hex chars (32 bytes)"),
  UPLOAD_DIR: z.string().default("./uploads"),
  SUPABASE_PG_URL: z.string().optional(),
  NOTIFICATION_WORKER_ENABLED: z.coerce.boolean().default(true),
  NOTIFICATION_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
});

export const env = Schema.parse(process.env);
export type Env = typeof env;
