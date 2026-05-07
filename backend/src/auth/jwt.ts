import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../env.js";

export type AppRole =
  | "super_admin" | "admin" | "manager" | "teller"
  | "loan_officer" | "finance_officer" | "auditor";

export interface AccessClaims {
  sub: string;          // user id (uuid)
  email: string;
  roles: AppRole[];
  mfa: boolean;         // true if user completed MFA challenge in this session
}

export interface RefreshClaims {
  sub: string;
  jti: string;          // refresh token id (stored server-side for revocation)
  type: "refresh";
}

export function signAccess(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"] });
}

export function signRefresh(claims: Omit<RefreshClaims, "type">): string {
  return jwt.sign({ ...claims, type: "refresh" } satisfies RefreshClaims, env.JWT_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL as SignOptions["expiresIn"],
  });
}

export function verifyAccess(token: string): AccessClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string") throw new Error("Invalid access token");
  return decoded as unknown as AccessClaims;
}

export function verifyRefresh(token: string): RefreshClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string" || (decoded as RefreshClaims).type !== "refresh") {
    throw new Error("Invalid refresh token");
  }
  return decoded as unknown as RefreshClaims;
}
