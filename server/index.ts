import "dotenv/config";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { generateOtp, hashOtp, verifyOtpHash, OTP_CONFIG } from "./otp";
import { sendOtpEmail } from "./email";

const app = express();
const PORT = Number(process.env.API_PORT ?? 4000);

const SESSION_COOKIE = "pharmasathi_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
function createAuthRateLimiter(
  windowMs: number,
  limit: number,
  message: string,
) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        message,
      });
    },
  });
}

const registerLimiter = createAuthRateLimiter(
  15 * 60 * 1000,
  5,
  "Too many registration attempts. Please try again later.",
);

const loginLimiter = createAuthRateLimiter(
  15 * 60 * 1000,
  10,
  "Too many login attempts. Please try again later.",
);

const verifyEmailLimiter = createAuthRateLimiter(
  10 * 60 * 1000,
  10,
  "Too many verification attempts. Please try again later.",
);

const resendVerificationLimiter = createAuthRateLimiter(
  60 * 60 * 1000,
  3,
  "Too many verification emails requested. Please try again later.",
);

const forgotPasswordLimiter = createAuthRateLimiter(
  60 * 60 * 1000,
  3,
  "Too many password reset requests. Please try again later.",
);

const resetPasswordLimiter = createAuthRateLimiter(
  15 * 60 * 1000,
  10,
  "Too many password reset attempts. Please try again later.",
);

type OtpPurpose = "VERIFY_EMAIL" | "RESET_PASSWORD";

type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
    sessionId: string;
  };
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    path: "/",
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    path: "/",
  });
}

function readCookie(req: Request, cookieName: string): string | undefined {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex < 0) continue;

    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (name === cookieName) {
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidOtp(code: unknown): code is string {
  return typeof code === "string" && /^\d{6}$/.test(code);
}

type OtpIssueResult =
  { status: "created"; otpId: string; code: string } | { status: "cooldown" };

// Create an OTP while holding a PostgreSQL lock on its user.
// This serializes OTP issuance for the same account.
async function issueOtp(
  userId: string,
  purpose: OtpPurpose,
  enforceCooldown = false,
): Promise<OtpIssueResult> {
  const code = generateOtp();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "User"
      WHERE "id" = ${userId}
      FOR UPDATE
    `;

    const latestCode = await tx.emailVerificationCode.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (
      enforceCooldown &&
      latestCode &&
      Date.now() - latestCode.createdAt.getTime() < OTP_CONFIG.resendCooldownMs
    ) {
      return { status: "cooldown" };
    }

    await tx.emailVerificationCode.updateMany({
      where: {
        userId,
        purpose,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    const record = await tx.emailVerificationCode.create({
      data: {
        userId,
        purpose,
        codeHash: hashOtp(userId, purpose, code),
        expiresAt: new Date(Date.now() + OTP_CONFIG.expiryMs),
      },
      select: { id: true },
    });

    return {
      status: "created",
      otpId: record.id,
      code,
    };
  });
}

// Send the OTP and invalidate only the exact code created by this request
// if email delivery fails.
async function sendUserOtp(
  user: { id: string; name: string; email: string },
  purpose: OtpPurpose,
  enforceCooldown = false,
): Promise<"sent" | "cooldown"> {
  const result = await issueOtp(user.id, purpose, enforceCooldown);

  if (result.status === "cooldown") {
    return "cooldown";
  }

  try {
    await sendOtpEmail({
      email: user.email,
      name: user.name,
      code: result.code,
      purpose,
    });
  } catch (error) {
    console.error("OTP email delivery error:", error);

    await prisma.emailVerificationCode.updateMany({
      where: {
        id: result.otpId,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    throw new Error("OTP email delivery failed.");
  }

  return "sent";
}

// Verify that the authenticated user belongs to the requested pharmacy.
async function verifyPharmacyMembership(userId: string, pharmacyId: string) {
  return prisma.membership.findUnique({
    where: {
      userId_pharmacyId: {
        userId,
        pharmacyId,
      },
    },
    select: {
      id: true,
      role: true,
      pharmacy: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });
}

// Authentication middleware.
async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = readCookie(req, SESSION_COOKIE);

    if (!token || token.length > 200) {
      res.status(401).json({
        success: false,
        message: "Please log in to continue.",
      });
      return;
    }

    const session = await prisma.session.findUnique({
      where: {
        tokenHash: hashToken(token),
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        user: {
          select: {
            isActive: true,
            emailVerified: true,
          },
        },
      },
    });

    if (
      !session ||
      session.expiresAt <= new Date() ||
      !session.user.isActive ||
      !session.user.emailVerified
    ) {
      if (session) {
        await prisma.session.deleteMany({
          where: { id: session.id },
        });
      }

      clearSessionCookie(res);

      res.status(401).json({
        success: false,
        message:
          "Your session is invalid, expired or your email is not verified. Please log in again.",
      });
      return;
    }

    req.auth = {
      userId: session.userId,
      sessionId: session.id,
    };

    next();
  } catch (error) {
    console.error("Session verification failed:", error);

    res.status(500).json({
      success: false,
      message: "Could not verify your session.",
    });
  }
}

// Basic API health check.
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "PharmaSathi API",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// Database connectivity check.
app.get("/health/database", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      success: true,
      service: "PharmaSathi API",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(503).json({
      success: false,
      service: "PharmaSathi API",
      database: "unavailable",
      message: "Could not connect to the database.",
    });
  }
});

// --------------------------------------------------
// REGISTER
// --------------------------------------------------

app.post("/auth/register", registerLimiter, async (req, res) => {
  try {
    const { name, email, password, pharmacyName } = req.body ?? {};

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof pharmacyName !== "string"
    ) {
      res.status(400).json({
        success: false,
        message: "Name, email, password and pharmacy name are required.",
      });
      return;
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPharmacyName = pharmacyName.trim();

    if (
      cleanName.length < 2 ||
      cleanName.length > 100 ||
      cleanPharmacyName.length < 2 ||
      cleanPharmacyName.length > 120 ||
      password.length < 12 ||
      password.length > 72 ||
      !isValidEmail(cleanEmail)
    ) {
      res.status(400).json({
        success: false,
        message: "Enter valid details. Password must be 12–72 characters.",
      });
      return;
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
      select: { id: true },
    });

    if (existingUser) {
      res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const baseSlug =
      cleanPharmacyName
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 45) || "pharmacy";

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: cleanName,
          email: cleanEmail,
          passwordHash,
          emailVerified: false,
        },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });

      const pharmacy = await tx.pharmacy.create({
        data: {
          name: cleanPharmacyName,
          slug: `${baseSlug}-${randomBytes(6).toString("hex")}`,
        },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          pharmacyId: pharmacy.id,
          role: "OWNER",
        },
      });

      return { user, pharmacy };
    });

    try {
      await sendUserOtp(result.user, "VERIFY_EMAIL");
    } catch {
      console.error("Verification email delivery failed.");

      res.status(503).json({
        success: false,
        message:
          "Your account was created, but the verification email could not be sent. Please try resending the code shortly.",
      });
      return;
    }

    res.status(201).json({
      success: true,
      message:
        "Account created. Please check your email for the verification code.",
      user: result.user,
      pharmacy: result.pharmacy,
    });
  } catch (error) {
    console.error("Registration failed:", error);

    res.status(500).json({
      success: false,
      message: "Could not create the account. Please try again.",
    });
  }
});

// --------------------------------------------------
// VERIFY EMAIL
// --------------------------------------------------

app.post("/auth/verify-email", verifyEmailLimiter, async (req, res) => {
  try {
    const { email, code } = req.body ?? {};

    if (
      typeof email !== "string" ||
      !isValidEmail(email.trim().toLowerCase()) ||
      !isValidOtp(code)
    ) {
      res.status(400).json({
        success: false,
        message: "Enter a valid email address and 6-digit code.",
      });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
      select: { id: true },
    });

    if (!user) {
      res.status(400).json({
        success: false,
        message: "Invalid or expired verification code.",
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "User"
        WHERE "id" = ${user.id}
        FOR UPDATE
      `;

      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { emailVerified: true },
      });

      if (!currentUser) return { status: "invalid" as const };

      if (currentUser.emailVerified) {
        return { status: "already-verified" as const };
      }

      const otp = await tx.emailVerificationCode.findFirst({
        where: {
          userId: user.id,
          purpose: "VERIFY_EMAIL",
          consumedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otp) return { status: "invalid" as const };

      const now = new Date();

      if (otp.expiresAt <= now || otp.attempts >= OTP_CONFIG.maxAttempts) {
        await tx.emailVerificationCode.update({
          where: { id: otp.id },
          data: { consumedAt: now },
        });

        return { status: "expired" as const };
      }

      if (!verifyOtpHash(user.id, "VERIFY_EMAIL", code, otp.codeHash)) {
        const attempts = otp.attempts + 1;

        await tx.emailVerificationCode.update({
          where: { id: otp.id },
          data: {
            attempts,
            ...(attempts >= OTP_CONFIG.maxAttempts ? { consumedAt: now } : {}),
          },
        });

        return {
          status: "incorrect" as const,
          attempts,
        };
      }

      await tx.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });

      await tx.emailVerificationCode.updateMany({
        where: {
          userId: user.id,
          purpose: "VERIFY_EMAIL",
          consumedAt: null,
        },
        data: { consumedAt: now },
      });

      return { status: "verified" as const };
    });

    if (result.status === "already-verified" || result.status === "verified") {
      res.status(200).json({
        success: true,
        message:
          result.status === "verified"
            ? "Email verified successfully. You can now log in."
            : "Your email is already verified. You can log in.",
      });
      return;
    }

    res.status(400).json({
      success: false,
      message:
        result.status === "incorrect"
          ? result.attempts >= OTP_CONFIG.maxAttempts
            ? "Too many incorrect attempts. Please request a new code."
            : "Incorrect verification code."
          : "Invalid or expired verification code. Please request a new code.",
    });
  } catch (error) {
    console.error("Email verification failed:", error);

    res.status(500).json({
      success: false,
      message: "Could not verify your email. Please try again.",
    });
  }
});

// --------------------------------------------------
// RESEND VERIFICATION OTP
// --------------------------------------------------

// --------------------------------------------------
// RESEND VERIFICATION OTP
// --------------------------------------------------

app.post(
  "/auth/resend-verification",
  resendVerificationLimiter,
  async (req, res) => {
    const genericMessage =
      "If an unverified account exists for this email, a verification code will be sent.";

    try {
      const { email } = req.body ?? {};

      if (
        typeof email !== "string" ||
        !isValidEmail(email.trim().toLowerCase())
      ) {
        res.status(400).json({
          success: false,
          message: "Enter a valid email address.",
        });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
        },
      });

      if (!user || user.emailVerified) {
        res.status(200).json({
          success: true,
          message: genericMessage,
        });
        return;
      }

      const result = await sendUserOtp(user, "VERIFY_EMAIL", true);

      // Same response for cooldown and successful delivery.
      res.status(200).json({
        success: true,
        message: genericMessage,
      });

      if (result === "cooldown") {
        return;
      }
    } catch (error) {
      console.error("Resend verification failed:", error);

      // Keep account existence private even if email delivery fails.
      res.status(200).json({
        success: true,
        message: genericMessage,
      });
    }
  },
);

// --------------------------------------------------
// LOGIN
// --------------------------------------------------
app.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length > 72
    ) {
      res.status(400).json({
        success: false,
        message: "A valid email and password are required.",
      });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
      select: {
        id: true,
        name: true,
        email: true,
        passwordHash: true,
        isActive: true,
        emailVerified: true,
      },
    });

    if (
      !user ||
      !user.isActive ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
      return;
    }

    if (!user.emailVerified) {
      res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        message:
          "Please verify your email before logging in. You can request a new verification code.",
      });
      return;
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt,
      },
    });

    setSessionCookie(res, token);

    res.status(200).json({
      success: true,
      message: "Login successful.",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Login failed:", error);

    res.status(500).json({
      success: false,
      message: "Could not log in. Please try again.",
    });
  }
});

// --------------------------------------------------
// FORGOT PASSWORD
// --------------------------------------------------

app.post("/auth/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const genericMessage =
    "If an eligible account exists for this email, a password reset code will be sent.";

  try {
    const { email } = req.body ?? {};

    if (
      typeof email !== "string" ||
      !isValidEmail(email.trim().toLowerCase())
    ) {
      res.status(400).json({
        success: false,
        message: "Enter a valid email address.",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive || !user.emailVerified) {
      res.status(200).json({
        success: true,
        message: genericMessage,
      });
      return;
    }

    await sendUserOtp(user, "RESET_PASSWORD", true);

    res.status(200).json({
      success: true,
      message: genericMessage,
    });
  } catch (error) {
    console.error("Forgot-password request failed:", error);

    // Keep the response generic to prevent account enumeration.
    res.status(200).json({
      success: true,
      message: genericMessage,
    });
  }
});

// --------------------------------------------------
// RESET PASSWORD
// --------------------------------------------------

app.post("/auth/reset-password", resetPasswordLimiter, async (req, res) => {
  try {
    const { email, code, newPassword } = req.body ?? {};

    if (
      typeof email !== "string" ||
      !isValidEmail(email.trim().toLowerCase()) ||
      !isValidOtp(code) ||
      typeof newPassword !== "string" ||
      newPassword.length < 12 ||
      newPassword.length > 72
    ) {
      res.status(400).json({
        success: false,
        message:
          "Enter a valid email, 6-digit code and a new password of 12–72 characters.",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        emailVerified: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive || !user.emailVerified) {
      res.status(400).json({
        success: false,
        message: "Invalid or expired password reset code.",
      });
      return;
    }

    // Hash the new password only after the OTP has been verified.

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
          SELECT "id"
          FROM "User"
          WHERE "id" = ${user.id}
          FOR UPDATE
        `;

      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
        select: {
          isActive: true,
          emailVerified: true,
        },
      });

      if (!currentUser || !currentUser.isActive || !currentUser.emailVerified) {
        return { status: "invalid" as const };
      }

      const otp = await tx.emailVerificationCode.findFirst({
        where: {
          userId: user.id,
          purpose: "RESET_PASSWORD",
          consumedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otp) return { status: "invalid" as const };

      const now = new Date();

      if (otp.expiresAt <= now || otp.attempts >= OTP_CONFIG.maxAttempts) {
        await tx.emailVerificationCode.update({
          where: { id: otp.id },
          data: { consumedAt: now },
        });

        return { status: "invalid" as const };
      }

      if (!verifyOtpHash(user.id, "RESET_PASSWORD", code, otp.codeHash)) {
        const attempts = otp.attempts + 1;

        await tx.emailVerificationCode.update({
          where: { id: otp.id },
          data: {
            attempts,
            ...(attempts >= OTP_CONFIG.maxAttempts ? { consumedAt: now } : {}),
          },
        });

        return {
          status: "incorrect" as const,
          attempts,
        };
      }
      const passwordHash = await bcrypt.hash(newPassword, 12);

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      await tx.emailVerificationCode.updateMany({
        where: {
          userId: user.id,
          purpose: "RESET_PASSWORD",
          consumedAt: null,
        },
        data: { consumedAt: now },
      });

      // Revoke all sessions after password change.
      await tx.session.deleteMany({
        where: { userId: user.id },
      });

      return { status: "reset" as const };
    });

    if (result.status === "reset") {
      res.status(200).json({
        success: true,
        message:
          "Password reset successfully. Please log in with your new password.",
      });
      return;
    }

    res.status(400).json({
      success: false,
      message:
        result.status === "incorrect"
          ? result.attempts >= OTP_CONFIG.maxAttempts
            ? "Too many incorrect attempts. Request a new reset code."
            : "Incorrect password reset code."
          : "Invalid or expired password reset code.",
    });
  } catch (error) {
    console.error("Password reset failed:", error);

    res.status(500).json({
      success: false,
      message: "Could not reset your password. Please try again.",
    });
  }
});
// --------------------------------------------------

// Shared catalogue reviewer access is independent of pharmacy membership.
async function requireCatalogueReviewer(
  req: AuthenticatedRequest,
  res: Response,
): Promise<boolean> {
  const allowedEmails = (process.env.CATALOGUE_REVIEWER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (!req.auth || allowedEmails.length === 0) {
    res.status(403).json({
      success: false,
      message: "Catalogue reviewer access is not configured.",
    });
    return false;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { email: true, isActive: true, emailVerified: true },
  });

  if (
    !user ||
    !user.isActive ||
    !user.emailVerified ||
    !allowedEmails.includes(user.email.trim().toLowerCase())
  ) {
    res.status(403).json({
      success: false,
      message: "You are not authorized to review the shared catalogue.",
    });
    return false;
  }

  return true;
}

// SHARED MEDICINE CATALOGUE
// --------------------------------------------------

// Search verified medicines available to all authenticated users.
app.get(
  "/catalogue/medicines",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const search =
        typeof req.query.search === "string" ? req.query.search.trim() : "";

      const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));

      const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));

      const where = {
        status: "VERIFIED" as const,
        isActive: true,
        ...(search
          ? {
              OR: [
                {
                  brandName: { contains: search, mode: "insensitive" as const },
                },
                {
                  genericName: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  manufacturer: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
                { barcode: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      };

      const [medicines, total] = await Promise.all([
        prisma.masterMedicine.findMany({
          where,
          orderBy: { brandName: "asc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            status: true,
            brandName: true,
            genericName: true,
            strength: true,
            dosageForm: true,
            manufacturer: true,
            category: true,
            barcode: true,
            registrationNumber: true,
            description: true,
          },
        }),
        prisma.masterMedicine.count({ where }),
      ]);

      res.status(200).json({
        success: true,
        medicines,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Medicine catalogue search failed:", error);

      res.status(500).json({
        success: false,
        message: "Could not search the medicine catalogue.",
      });
    }
  },
);

// Get one verified medicine.
app.get(
  "/catalogue/medicines/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rawId = req.params.id;
          const id = Array.isArray(rawId) ? rawId[0] : rawId;

      const medicine = await prisma.masterMedicine.findFirst({
        where: {
          id,
          status: "VERIFIED",
          isActive: true,
        },
        select: {
          id: true,
          brandName: true,
          genericName: true,
          strength: true,
          dosageForm: true,
          manufacturer: true,
          category: true,
          barcode: true,
          registrationNumber: true,
          description: true,
        },
      });

      if (!medicine) {
        res.status(404).json({
          success: false,
          message: "Verified medicine was not found.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        medicine,
      });
    } catch (error) {
      console.error("Medicine catalogue lookup failed:", error);

      res.status(500).json({
        success: false,
        message: "Could not retrieve medicine details.",
      });
    }
  },
);

// Submit a medicine for catalogue review.
// New submissions remain PENDING and are not visible in public search.
app.post(
  "/catalogue/medicines",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const input = req.body ?? {};

      const fields = {
        brandName: input.brandName,
        genericName: input.genericName ?? "",
        strength: input.strength ?? "",
        dosageForm: input.dosageForm ?? "",
        manufacturer: input.manufacturer ?? "",
        category: input.category ?? "",
        barcode: input.barcode ?? "",
        registrationNumber: input.registrationNumber ?? "",
        description: input.description ?? "",
      };

      if (
        typeof fields.brandName !== "string" ||
        fields.brandName.trim().length < 2 ||
        fields.brandName.trim().length > 150
      ) {
        res.status(400).json({
          success: false,
          message: "A valid medicine brand name is required.",
        });
        return;
      }

      const limits: Record<string, number> = {
        genericName: 150,
        strength: 80,
        dosageForm: 80,
        manufacturer: 150,
        category: 100,
        barcode: 80,
        registrationNumber: 100,
        description: 500,
      };

      for (const [key, max] of Object.entries(limits)) {
        const value = fields[key as keyof typeof fields];

        if (typeof value !== "string" || value.trim().length > max) {
          res.status(400).json({
            success: false,
            message: `Invalid ${key}. Maximum length is ${max} characters.`,
          });
          return;
        }
      }

      const clean = {
        brandName: fields.brandName.trim(),
        genericName: fields.genericName.trim(),
        strength: fields.strength.trim(),
        dosageForm: fields.dosageForm.trim(),
        manufacturer: fields.manufacturer.trim(),
        category: fields.category.trim(),
        barcode: fields.barcode.trim(),
        registrationNumber: fields.registrationNumber.trim(),
        description: fields.description.trim(),
      };

      const duplicate = await prisma.masterMedicine.findFirst({
        where: {
          brandName: { equals: clean.brandName, mode: "insensitive" },
          genericName: { equals: clean.genericName, mode: "insensitive" },
          strength: { equals: clean.strength, mode: "insensitive" },
          dosageForm: { equals: clean.dosageForm, mode: "insensitive" },
          manufacturer: { equals: clean.manufacturer, mode: "insensitive" },
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (duplicate) {
        res.status(409).json({
          success: false,
          message:
            duplicate.status === "VERIFIED"
              ? "This medicine already exists in the verified catalogue."
              : "This medicine has already been submitted for review.",
        });
        return;
      }

      const medicine = await prisma.masterMedicine.create({
        data: {
          ...clean,
          status: "PENDING",
        },
        select: {
          id: true,
          brandName: true,
          status: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        success: true,
        message: "Medicine submitted for review.",
        medicine,
      });
    } catch (error) {
      console.error("Medicine catalogue submission failed:", error);

      res.status(500).json({
        success: false,
        message: "Could not submit this medicine.",
      });
    }
  },
);
// --------------------------------------------------

// List active pending medicines for authorized catalogue reviewers.
app.get(
  "/catalogue/review/pending",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!(await requireCatalogueReviewer(req, res))) return;

      const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
      const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim().slice(0, 100)
          : "";

      const where = {
        status: "PENDING" as const,
        isActive: true,
        ...(search
          ? {
              OR: [
                { brandName: { contains: search } },
                { genericName: { contains: search } },
                { strength: { contains: search } },
                { dosageForm: { contains: search } },
                { manufacturer: { contains: search } },
                { category: { contains: search } },
                { barcode: { contains: search } },
                { registrationNumber: { contains: search } },
              ],
            }
          : {}),
      };

      const [medicines, total] = await Promise.all([
        prisma.masterMedicine.findMany({
          where,
          orderBy: { createdAt: "asc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            brandName: true,
            genericName: true,
            strength: true,
            dosageForm: true,
            manufacturer: true,
            category: true,
            barcode: true,
            registrationNumber: true,
            description: true,
            createdAt: true,
          },
        }),
        prisma.masterMedicine.count({ where }),
      ]);

      res.status(200).json({
        success: true,
        medicines,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Pending catalogue review list failed:", error);
      res.status(500).json({
        success: false,
        message: "Could not load pending catalogue reviews.",
      });
    }
  },
);

// Approve or reject a pending medicine and record the decision atomically.
app.patch(
  "/catalogue/review/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!(await requireCatalogueReviewer(req, res))) return;

      const id = req.params.id;
      const decision = req.body?.decision;
      const rawNote = req.body?.note;

      if (
        typeof id !== "string" ||
        id.length < 1 ||
        id.length > 100 ||
        (decision !== "VERIFIED" && decision !== "REJECTED")
      ) {
        res.status(400).json({
          success: false,
          message:
            "A valid medicine ID and VERIFIED or REJECTED decision are required.",
        });
        return;
      }

      if (rawNote !== undefined && typeof rawNote !== "string") {
        res.status(400).json({
          success: false,
          message: "Review note must be text.",
        });
        return;
      }

      const note = typeof rawNote === "string" ? rawNote.trim() : "";

      if (note.length > 500) {
        res.status(400).json({
          success: false,
          message: "Review note cannot exceed 500 characters.",
        });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.masterMedicine.updateMany({
          where: {
            id,
            status: "PENDING",
            isActive: true,
          },
          data: { status: decision },
        });

        if (updated.count !== 1) return null;

        const medicine = await tx.masterMedicine.findUnique({
          where: { id },
          select: {
            id: true,
            brandName: true,
            status: true,
            updatedAt: true,
          },
        });

        if (!medicine) {
          throw new Error("Reviewed medicine could not be retrieved.");
        }

        const review = await tx.catalogueReview.create({
          data: {
            medicineId: id,
            reviewerId: req.auth!.userId,
            decision,
            note,
          },
          select: {
            id: true,
            decision: true,
            note: true,
            createdAt: true,
          },
        });

        return { medicine, review };
      });

      if (!result) {
        res.status(409).json({
          success: false,
          message:
            "This medicine is not pending or is no longer active. Refresh the review list.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message:
          decision === "VERIFIED"
            ? "Medicine approved and added to the verified catalogue."
            : "Medicine rejected.",
        ...result,
      });
    } catch (error) {
      console.error("Catalogue review decision failed:", error);
      res.status(500).json({
        success: false,
        message: "Could not save the catalogue review decision.",
      });
    }
  },
);

// CURRENT USER
// --------------------------------------------------

app.get("/auth/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        memberships: {
          select: {
            role: true,
            pharmacy: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: "Account not found. Please log in again.",
      });
      return;
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Current-user lookup failed:", error);

    res.status(500).json({
      success: false,
      message: "Could not retrieve your account.",
    });
  }
});

// --------------------------------------------------
// REGISTER DESKTOP DEVICE
// --------------------------------------------------

app.post(
  "/devices/register",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { pharmacyId, deviceCode, deviceName } = req.body ?? {};

      if (
        typeof pharmacyId !== "string" ||
        typeof deviceCode !== "string" ||
        typeof deviceName !== "string"
      ) {
        res.status(400).json({
          success: false,
          message: "Pharmacy ID, device code and device name are required.",
        });
        return;
      }

      const cleanPharmacyId = pharmacyId.trim();
      const cleanDeviceCode = deviceCode.trim();
      const cleanDeviceName = deviceName.trim();

      if (
        cleanPharmacyId.length < 1 ||
        cleanPharmacyId.length > 128 ||
        !/^[a-zA-Z0-9_-]{16,128}$/.test(cleanDeviceCode) ||
        cleanDeviceName.length < 2 ||
        cleanDeviceName.length > 100
      ) {
        res.status(400).json({
          success: false,
          message: "Invalid pharmacy or device details.",
        });
        return;
      }

      const membership = await verifyPharmacyMembership(
        req.auth!.userId,
        cleanPharmacyId,
      );

      if (!membership) {
        res.status(403).json({
          success: false,
          message: "You do not have access to this pharmacy.",
        });
        return;
      }

      const existingDevice = await prisma.device.findUnique({
        where: { deviceCode: cleanDeviceCode },
        select: {
          id: true,
          pharmacyId: true,
          deviceName: true,
          isActive: true,
          createdAt: true,
        },
      });

      if (existingDevice) {
        if (existingDevice.pharmacyId !== cleanPharmacyId) {
          res.status(409).json({
            success: false,
            message:
              "This device code is already registered to another pharmacy.",
          });
          return;
        }

        if (!existingDevice.isActive) {
          res.status(403).json({
            success: false,
            message:
              "This device has been deactivated. Contact your pharmacy administrator.",
          });
          return;
        }

        const updatedDevice = await prisma.device.update({
          where: { id: existingDevice.id },
          data: { deviceName: cleanDeviceName },
          select: {
            id: true,
            pharmacyId: true,
            deviceName: true,
            deviceCode: true,
            isActive: true,
            createdAt: true,
          },
        });

        res.status(200).json({
          success: true,
          message: "Device is already registered. Details updated.",
          device: updatedDevice,
        });
        return;
      }

      const device = await prisma.device.create({
        data: {
          pharmacyId: cleanPharmacyId,
          deviceCode: cleanDeviceCode,
          deviceName: cleanDeviceName,
        },
        select: {
          id: true,
          pharmacyId: true,
          deviceName: true,
          deviceCode: true,
          isActive: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        success: true,
        message: "Device registered successfully.",
        device,
      });
    } catch (error) {
      console.error("Device registration failed:", error);

      res.status(500).json({
        success: false,
        message: "Could not register this device.",
      });
    }
  },
);

// --------------------------------------------------

app.post("/sync/push", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { pharmacyId, deviceCode, events } = req.body ?? {};

    if (
      typeof pharmacyId !== "string" ||
      typeof deviceCode !== "string" ||
      !Array.isArray(events) ||
      events.length < 1 ||
      events.length > 100
    ) {
      res.status(400).json({
        success: false,
        message: "Valid pharmacy, device and 1–100 sync events are required.",
      });
      return;
    }

    const cleanPharmacyId = pharmacyId.trim();
    const cleanDeviceCode = deviceCode.trim();

    if (
      !cleanPharmacyId ||
      cleanPharmacyId.length > 128 ||
      !/^[a-zA-Z0-9_-]{16,128}$/.test(cleanDeviceCode)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid pharmacy or device details.",
      });
      return;
    }

    const membership = await verifyPharmacyMembership(
      req.auth!.userId,
      cleanPharmacyId,
    );

    if (!membership) {
      res.status(403).json({
        success: false,
        message: "You do not have access to this pharmacy.",
      });
      return;
    }

    const device = await prisma.device.findUnique({
      where: { deviceCode: cleanDeviceCode },
      select: { id: true, pharmacyId: true, isActive: true },
    });

    if (!device || device.pharmacyId !== cleanPharmacyId || !device.isActive) {
      res.status(403).json({
        success: false,
        message: "Device is invalid, inactive or belongs to another pharmacy.",
      });
      return;
    }

    const preparedEvents: any[] = [];
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    for (const event of events) {
      if (
        !event ||
        typeof event !== "object" ||
        typeof event.eventId !== "string" ||
        !uuidPattern.test(event.eventId) ||
        !["UPSERT", "DELETE"].includes(event.eventType) ||
        !["MEDICINE", "MEDICINE_BATCH", "SALE", "PURCHASE"].includes(
          event.entityType,
        ) ||
        !event.payload ||
        typeof event.payload !== "object" ||
        Array.isArray(event.payload) ||
        typeof event.payload.syncId !== "string" ||
        !uuidPattern.test(event.payload.syncId)
      ) {
        res.status(400).json({
          success: false,
          message: "One or more sync events have an invalid format.",
        });
        return;
      }

      if (event.entityType === "SALE" && event.eventType !== "UPSERT") {
        res.status(400).json({
          success: false,
          message: "Invalid sale sync operation.",
        });
        return;
      }

      if (event.entityType === "PURCHASE" && event.eventType !== "UPSERT") {
        res.status(400).json({
          success: false,
          message: "Invalid purchase sync operation.",
        });
        return;
      }

      preparedEvents.push(event);
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const db = tx as any;
        let accepted = 0;
        let duplicates = 0;

        const resolveMedicine = async (syncId: string) => {
          const medicine = await db.medicine.findUnique({
            where: {
              deviceId_localId: {
                deviceId: device.id,
                localId: syncId,
              },
            },
          });

          if (!medicine || medicine.pharmacyId !== cleanPharmacyId) {
            throw new Error("A referenced medicine has not been synchronized.");
          }

          return medicine;
        };

        const resolveBatch = async (syncId: string) => {
          const batch = await db.medicineBatch.findUnique({
            where: {
              deviceId_localId: {
                deviceId: device.id,
                localId: syncId,
              },
            },
          });

          if (!batch || batch.pharmacyId !== cleanPharmacyId) {
            throw new Error(
              "A referenced medicine batch has not been synchronized.",
            );
          }

          return batch;
        };

        for (const event of preparedEvents) {
          const alreadyProcessed = await db.syncEvent.findUnique({
            where: {
              deviceId_localEventId: {
                deviceId: device.id,
                localEventId: event.eventId,
              },
            },
            select: { id: true },
          });

          if (alreadyProcessed) {
            duplicates++;
            continue;
          }

          const data = event.payload;
          const localId = data.syncId;

          const syncRecord = await db.syncEvent.create({
            data: {
              pharmacyId: cleanPharmacyId,
              deviceId: device.id,
              localEventId: event.eventId,
              eventType: event.eventType,
              payload: {
                entityType: event.entityType,
                data,
              },
              status: "PENDING",
            },
          });

          if (event.entityType === "MEDICINE") {
            if (event.eventType === "DELETE") {
              await db.medicine.deleteMany({
                where: {
                  pharmacyId: cleanPharmacyId,
                  deviceId: device.id,
                  localId,
                },
              });
            } else {
              await db.medicine.upsert({
                where: {
                  deviceId_localId: {
                    deviceId: device.id,
                    localId,
                  },
                },
                create: {
                  pharmacyId: cleanPharmacyId,
                  deviceId: device.id,
                  localId,
                  name: String(data.name ?? ""),
                  genericName: String(data.genericName ?? ""),
                  manufacturer: String(data.manufacturer ?? ""),
                  category: String(data.category ?? ""),
                  barcode: String(data.barcode ?? ""),
                  minimumStock: Math.max(0, Number(data.minimumStock ?? 10)),
                },
                update: {
                  name: String(data.name ?? ""),
                  genericName: String(data.genericName ?? ""),
                  manufacturer: String(data.manufacturer ?? ""),
                  category: String(data.category ?? ""),
                  barcode: String(data.barcode ?? ""),
                  minimumStock: Math.max(0, Number(data.minimumStock ?? 10)),
                },
              });
            }
          }

          if (event.entityType === "MEDICINE_BATCH") {
            if (event.eventType === "DELETE") {
              await db.medicineBatch.deleteMany({
                where: {
                  pharmacyId: cleanPharmacyId,
                  deviceId: device.id,
                  localId,
                },
              });
            } else {
              const medicine = await resolveMedicine(data.medicineSyncId);
              const expiryDate = new Date(data.expiryDate);

              if (!Number.isFinite(expiryDate.getTime())) {
                throw new Error("Invalid batch expiry date.");
              }

              await db.medicineBatch.upsert({
                where: {
                  deviceId_localId: {
                    deviceId: device.id,
                    localId,
                  },
                },
                create: {
                  pharmacyId: cleanPharmacyId,
                  deviceId: device.id,
                  localId,
                  medicineId: medicine.id,
                  batchNumber: String(data.batchNumber ?? ""),
                  purchasePrice: Number(data.purchasePrice),
                  salePrice: Number(data.salePrice),
                  quantity: Number(data.quantity),
                  expiryDate,
                },
                update: {
                  medicineId: medicine.id,
                  batchNumber: String(data.batchNumber ?? ""),
                  purchasePrice: Number(data.purchasePrice),
                  salePrice: Number(data.salePrice),
                  quantity: Number(data.quantity),
                  expiryDate,
                },
              });
            }
          }

          if (event.entityType === "SALE") {
            if (!Array.isArray(data.items) || data.items.length === 0) {
              throw new Error("Sale has no valid items.");
            }

            const sale = await db.sale.create({
              data: {
                pharmacyId: cleanPharmacyId,
                deviceId: device.id,
                localId,
                invoiceNumber: String(data.invoiceNumber ?? ""),
                subtotal: Number(data.subtotal),
                total: Number(data.total),
                paymentMethod: String(data.paymentMethod ?? "CASH"),
                amountPaid: Number(data.amountPaid),
                changeDue: Number(data.changeDue ?? 0),
              },
            });

            for (const item of data.items) {
              const medicine = await resolveMedicine(item.medicineSyncId);
              const batch = await resolveBatch(item.batchSyncId);
              const quantity = Number(item.quantity);
              const stockDelta = Number(item.stockDelta);

              if (
                !Number.isSafeInteger(quantity) ||
                quantity <= 0 ||
                stockDelta !== -quantity ||
                batch.medicineId !== medicine.id
              ) {
                throw new Error("Invalid sale item or stock adjustment.");
              }

              if (!data.snapshot) {
                const stockUpdate = await db.medicineBatch.updateMany({
                  where: {
                    id: batch.id,
                    pharmacyId: cleanPharmacyId,
                    deviceId: device.id,
                    quantity: { gte: quantity },
                  },
                  data: { quantity: { decrement: quantity } },
                });

                if (stockUpdate.count !== 1) {
                  throw new Error(
                    `Insufficient cloud stock for ${item.medicineName ?? "a medicine"}.`,
                  );
                }
              }

              await db.saleItem.create({
                data: {
                  saleId: sale.id,
                  medicineId: medicine.id,
                  batchId: batch.id,
                  pharmacyId: cleanPharmacyId,
                  deviceId: device.id,
                  medicineName: String(item.medicineName ?? ""),
                  batchNumber: String(item.batchNumber ?? ""),
                  quantity,
                  unitPrice: Number(item.unitPrice),
                  unitCost: Number(item.unitCost),
                  lineTotal: Number(item.lineTotal),
                },
              });
            }
          }

          if (event.entityType === "PURCHASE") {
            if (!Array.isArray(data.items) || data.items.length === 0) {
              throw new Error("Purchase has no valid items.");
            }

            const purchase = await db.purchase.create({
              data: {
                pharmacyId: cleanPharmacyId,
                deviceId: device.id,
                localId,
                invoiceNumber: String(data.invoiceNumber ?? ""),
                supplierName: String(data.supplierName ?? ""),
                supplierInvoice: String(data.supplierInvoice ?? ""),
                total: Number(data.total),
                notes: String(data.notes ?? ""),
              },
            });

            for (const item of data.items) {
              const medicine = await resolveMedicine(item.medicineSyncId);
              const batch = await resolveBatch(item.batchSyncId);
              const quantity = Number(item.quantity);

              if (
                !Number.isSafeInteger(quantity) ||
                quantity <= 0 ||
                batch.medicineId !== medicine.id ||
                Number(item.stockDelta) !== quantity
              ) {
                throw new Error("Invalid purchase item.");
              }

              await db.purchaseItem.create({
                data: {
                  purchaseId: purchase.id,
                  medicineId: medicine.id,
                  batchId: batch.id,
                  pharmacyId: cleanPharmacyId,
                  deviceId: device.id,
                  medicineName: String(item.medicineName ?? ""),
                  batchNumber: String(item.batchNumber ?? ""),
                  quantity,
                  unitCost: Number(item.unitCost),
                  unitSalePrice: Number(item.unitSalePrice),
                  lineTotal: Number(item.lineTotal),
                },
              });
            }
          }

          await db.syncEvent.update({
            where: { id: syncRecord.id },
            data: {
              status: "SYNCED",
              syncedAt: new Date(),
              error: null,
            },
          });

          accepted++;
        }

        await db.device.update({
          where: { id: device.id },
          data: { lastSyncedAt: new Date() },
        });

        return { accepted, duplicates };
      },
      { maxWait: 10000, timeout: 30000 },
    );

    res.status(200).json({
      success: true,
      received: events.length,
      accepted: result.accepted,
      duplicates: result.duplicates,
      message: "Cloud records synchronized successfully.",
    });
  } catch (error) {
    console.error("Cloud sync processing failed:", error);

    res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Could not process cloud sync events.",
    });
  }
});

// --------------------------------------------------
// --------------------------------------------------

// --------------------------------------------------
// RESTORE CLOUD DATA FOR THE CURRENT PHARMACY DEVICE
// --------------------------------------------------

app.get("/sync/pull", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const pharmacyId = req.query.pharmacyId;
    const deviceCode = req.query.deviceCode;

    if (
      typeof pharmacyId !== "string" ||
      !pharmacyId.trim() ||
      typeof deviceCode !== "string" ||
      !deviceCode.trim()
    ) {
      res.status(400).json({
        success: false,
        message: "Pharmacy ID and device code are required.",
      });
      return;
    }

    const normalizedPharmacyId = pharmacyId.trim();
    const normalizedDeviceCode = deviceCode.trim();

    const membership = await verifyPharmacyMembership(
      req.auth!.userId,
      normalizedPharmacyId,
    );

    if (!membership) {
      res.status(403).json({
        success: false,
        message: "You do not have access to this pharmacy.",
      });
      return;
    }

    const device = await prisma.device.findUnique({
      where: { deviceCode: normalizedDeviceCode },
      select: { id: true, pharmacyId: true, isActive: true },
    });

    if (!device || device.pharmacyId !== normalizedPharmacyId) {
      res.status(404).json({
        success: false,
        message: "Device is not registered to this pharmacy.",
      });
      return;
    }

    if (!device.isActive) {
      res.status(403).json({
        success: false,
        message: "This device has been deactivated.",
      });
      return;
    }

    // Restore all business records belonging to this pharmacy.
    // The requesting device is still validated above.
    const scope = { pharmacyId: normalizedPharmacyId };

    const [medicines, batches, sales, purchases] = await prisma.$transaction([
      prisma.medicine.findMany({
        where: scope,
        orderBy: { createdAt: "asc" },
      }),
      prisma.medicineBatch.findMany({
        where: scope,
        orderBy: { createdAt: "asc" },
      }),
      prisma.sale.findMany({
        where: scope,
        include: { items: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.purchase.findMany({
        where: scope,
        include: { items: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: { medicines, batches, sales, purchases },
    });
  } catch (error) {
    console.error("Cloud restore data retrieval failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not retrieve cloud backup data.",
    });
  }
});

// LIST DEVICES
// --------------------------------------------------
// --------------------------------------------------

app.get("/devices", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const pharmacyId = req.query.pharmacyId;

    if (typeof pharmacyId !== "string" || pharmacyId.trim().length === 0) {
      res.status(400).json({
        success: false,
        message: "A pharmacy ID is required.",
      });
      return;
    }

    const membership = await verifyPharmacyMembership(
      req.auth!.userId,
      pharmacyId.trim(),
    );

    if (!membership) {
      res.status(403).json({
        success: false,
        message: "You do not have access to this pharmacy.",
      });
      return;
    }

    const devices = await prisma.device.findMany({
      where: {
        pharmacyId: pharmacyId.trim(),
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        deviceName: true,
        deviceCode: true,
        isActive: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    });

    res.status(200).json({
      success: true,
      devices,
    });
  } catch (error) {
    console.error("Device listing failed:", error);

    res.status(500).json({
      success: false,
      message: "Could not retrieve registered devices.",
    });
  }
});

// --------------------------------------------------
// VERIFY CURRENT DEVICE
// --------------------------------------------------

app.get(
  "/devices/current",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const pharmacyId = req.query.pharmacyId;
      const deviceCode = req.query.deviceCode;

      if (typeof pharmacyId !== "string" || typeof deviceCode !== "string") {
        res.status(400).json({
          success: false,
          message: "Pharmacy ID and device code are required.",
        });
        return;
      }

      const membership = await verifyPharmacyMembership(
        req.auth!.userId,
        pharmacyId.trim(),
      );

      if (!membership) {
        res.status(403).json({
          success: false,
          message: "You do not have access to this pharmacy.",
        });
        return;
      }

      const device = await prisma.device.findUnique({
        where: {
          deviceCode: deviceCode.trim(),
        },
        select: {
          id: true,
          pharmacyId: true,
          deviceName: true,
          deviceCode: true,
          isActive: true,
          lastSyncedAt: true,
        },
      });

      if (!device || device.pharmacyId !== pharmacyId.trim()) {
        res.status(404).json({
          success: false,
          message: "Device is not registered to this pharmacy.",
        });
        return;
      }

      if (!device.isActive) {
        res.status(403).json({
          success: false,
          message: "This device has been deactivated.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        device,
      });
    } catch (error) {
      console.error("Current device verification failed:", error);

      res.status(500).json({
        success: false,
        message: "Could not verify this device.",
      });
    }
  },
);

// --------------------------------------------------
// LOGOUT
// --------------------------------------------------

app.post(
  "/auth/logout",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      await prisma.session.deleteMany({
        where: {
          id: req.auth!.sessionId,
          userId: req.auth!.userId,
        },
      });

      clearSessionCookie(res);

      res.status(200).json({
        success: true,
        message: "Logged out successfully.",
      });
    } catch (error) {
      console.error("Logout failed:", error);

      res.status(500).json({
        success: false,
        message: "Could not log out. Please try again.",
      });
    }
  },
);

// Unknown endpoint handler.
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found.",
  });
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`PharmaSathi API listening on http://127.0.0.1:${PORT}`);
});

function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    console.log("PharmaSathi API stopped.");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
