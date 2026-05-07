// AES-256-GCM PII vault — replaces the pgcrypto-based customer_pii_vault.
// Format: <12-byte IV>||<ciphertext>||<16-byte auth tag>, base64-encoded.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";

const KEY = Buffer.from(env.PII_KEY, "hex");
if (KEY.length !== 32) throw new Error("PII_KEY must decode to 32 bytes");

export function encryptPII(plaintext: string | null | undefined): Buffer | null {
  if (plaintext == null || plaintext === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]);
}

export function decryptPII(blob: Buffer | null | undefined): string | null {
  if (!blob || blob.length < 28) return null;
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(12, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
