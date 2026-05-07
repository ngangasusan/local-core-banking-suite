import type { NextFunction, Request, Response } from "express";
import { verifyAccess, type AccessClaims, type AppRole } from "./jwt.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: AccessClaims;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "missing_token" });
  try {
    req.user = verifyAccess(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

export const requireRole = (...roles: AppRole[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "missing_token" });
    if (!req.user.roles.some((r) => roles.includes(r)))
      return res.status(403).json({ error: "forbidden" });
    next();
  };

export function requireMfa(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "missing_token" });
  if (!req.user.mfa) return res.status(403).json({ error: "mfa_required" });
  next();
}

export const hasRole = (req: Request, ...roles: AppRole[]) =>
  !!req.user && req.user.roles.some((r) => roles.includes(r));
