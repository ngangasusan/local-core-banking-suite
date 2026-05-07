import { authenticator } from "otplib";
import QRCode from "qrcode";

authenticator.options = { window: 1, step: 30 };

export const generateMfaSecret = () => authenticator.generateSecret();

export const verifyMfaToken = (token: string, secret: string): boolean => {
  try { return authenticator.check(token, secret); } catch { return false; }
};

export const buildOtpauthUrl = (email: string, secret: string, issuer = "Corebank") =>
  authenticator.keyuri(email, issuer, secret);

export const buildQrDataUrl = (otpauthUrl: string) => QRCode.toDataURL(otpauthUrl);
