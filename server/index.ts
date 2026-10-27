
import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";

const app = express();
const PORT = Number(process.env.API_PORT ?? 4000);

const SESSION_COOKIE = "pharmasathi_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
    sessionId: string;
  };
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
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

// Read the session cookie without requiring an additional cookie package.
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

// Require a valid, unexpired session for protected endpoints.
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
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        user: {
          select: { isActive: true },
        },
      },
    });

    if (
      !session ||
      session.expiresAt <= new Date() ||
      !session.user.isActive
    ) {
      if (session) {
        await prisma.session.deleteMany({
          where: { id: session.id },
        });
      }

      clearSessionCookie(res);
      res.status(401).json({
        success: false,
        message: "Your session is invalid or expired. Please log in again.",
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

// Basic API health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "PharmaSathi API",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// Database connectivity check
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

// Register a user and create their pharmacy.
app.post("/auth/register", async (req, res) => {
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
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
      cleanEmail.length > 254
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

    res.status(201).json({
      success: true,
      message: "Account and pharmacy created successfully.",
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

// Log in using email and password.
app.post("/auth/login", async (req, res) => {
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

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt,
      },
    });

    setSessionCookie(res, token, expiresAt);

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

// Get the currently authenticated user and their pharmacy memberships.
app.get("/auth/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        name: true,
        email: true,
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

// Log out and revoke the current session.
app.post("/auth/logout", requireAuth, async (req: AuthenticatedRequest, res) => {
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
});

// Unknown endpoint handler
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
