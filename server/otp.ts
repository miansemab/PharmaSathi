
import {
  createHmac,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

const OTP_HASH_SECRET = process.env.OTP_HASH_SECRET;
const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

if (!OTP_HASH_SECRET || OTP_HASH_SECRET.length < 32) {
  throw new Error(
    "OTP_HASH_SECRET must be configured with a strong secret.",
  );
}

export function generateOtp(): string {
  return randomInt(0, 1_000_000)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

export function hashOtp(
  userId: string,
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD",
  code: string,
): string {
  return createHmac("sha256", OTP_HASH_SECRET!)
    .update(`${userId}:${purpose}:${code}`)
    .digest("hex");
}

export function verifyOtpHash(
  userId: string,
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD",
  code: string,
  storedHash: string,
): boolean {
  const expected = Buffer.from(
    hashOtp(userId, purpose, code),
    "hex",
  );

  const actual = Buffer.from(storedHash, "hex");

  return (
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
  );
}

export const OTP_CONFIG = {
  expiryMs: OTP_EXPIRY_MS,
  maxAttempts: MAX_OTP_ATTEMPTS,
  resendCooldownMs: RESEND_COOLDOWN_MS,
};
