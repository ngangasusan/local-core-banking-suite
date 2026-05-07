import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import pino from "pino";
import { ZodError } from "zod";
import { env } from "./env.js";
import { pool } from "./db.js";
import authRoutes from "./routes/auth.routes.js";

const log = pino({ level: env.NODE_ENV === "production" ? "info" : "debug" });
const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(pinoHttp({ logger: log }));

// Strict rate limit on auth endpoints (login + refresh)
app.use("/auth/login", rateLimit({ windowMs: 60_000, max: 10 }));
app.use("/auth/mfa/verify", rateLimit({ windowMs: 60_000, max: 10 }));
app.use("/auth/refresh", rateLimit({ windowMs: 60_000, max: 30 }));

app.get("/health", async (_req, res) => {
  try {
    await pool().query("SELECT 1");
    res.json({ ok: true, db: "up" });
  } catch (e) {
    res.status(503).json({ ok: false, db: "down", error: (e as Error).message });
  }
});

app.use("/auth", authRoutes);

// 404
app.use((_req, res) => res.status(404).json({ error: "not_found" }));

// error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "validation_error", details: err.flatten() });
  }
  const message = err instanceof Error ? err.message : "internal_error";
  log.error({ err, path: req.path }, "request_failed");
  res.status(500).json({ error: "internal_error", message: env.NODE_ENV === "production" ? undefined : message });
});

app.listen(env.PORT, () => log.info(`backend listening on :${env.PORT}`));
