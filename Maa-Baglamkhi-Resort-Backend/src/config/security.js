const rateLimit = require("express-rate-limit");

const DEFAULT_DEV_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://192.168.1.5:5173",
  "http://192.168.1.5:4173",
];

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllowedOrigins() {
  const configuredOrigins = parseAllowedOrigins(
    process.env.CORS_ORIGINS || process.env.CORS_ORIGIN,
  );

  if (configuredOrigins.length) {
    return configuredOrigins;
  }

  if (process.env.NODE_ENV === "production") {
    return [];
  }

  return DEFAULT_DEV_ALLOWED_ORIGINS;
}

function isLocalDevelopmentOrigin(origin) {
  try {
    const url = new URL(origin);
    const hostname = String(url.hostname || "").toLowerCase();

    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return true;
    }

    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return true;
    }

    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return true;
    }

    return /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);
  } catch {
    return false;
  }
}

function isOriginAllowed(origin, allowedOrigins, { allowLocalInProduction = false } = {}) {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  if (allowLocalInProduction && isLocalDevelopmentOrigin(origin)) {
    return true;
  }

  if (!allowedOrigins.length) {
    return process.env.NODE_ENV !== "production" && isLocalDevelopmentOrigin(origin);
  }

  return false;
}

function createCorsOriginHandler() {
  const allowedOrigins = getAllowedOrigins();
  const allowLocalInProduction =
    String(process.env.CORS_ALLOW_LOCAL || "").toLowerCase() === "true";

  return (origin, callback) => {
    return callback(
      null,
      isOriginAllowed(origin, allowedOrigins, { allowLocalInProduction }),
    );
  };
}

function getCorsOptions() {
  return {
    origin: createCorsOriginHandler(),
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Audit-Action",
      "X-Audit-Source",
      "X-Audit-User-Email",
    ],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  };
}

// HAG-22: zero-config first start. A fresh machine has no .env — the server
// must still boot. When JWT_SECRET is unset or empty we generate a 48-byte
// random secret and persist it into <backend>/.env so it survives restarts
// (a fresh secret on every boot would invalidate every issued token each
// restart). The in-memory copy is used when persistence fails (read-only
// install). This behavior is documented in INSTALL.md ("JWT secret
// auto-provisioning").
//
// Behavior kept: NODE_ENV=test still throws on an empty JWT_SECRET so test
// suites stay deterministic (they rely on a fixed secret).
const generatedJwtSecret = { value: null, persisted: false };

function persistJwtSecret(secret) {
  try {
    const fs = require("fs");
    const path = require("path");
    const envPath = path.join(__dirname, "..", "..", ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      const lines = content.split(/\r?\n/);
      const i = lines.findIndex((l) => l.startsWith("JWT_SECRET="));
      if (i >= 0) {
        const existing = lines[i].slice("JWT_SECRET=".length).trim();
        if (existing) {
          // A real configured value is present — never overwrite it.
          return false;
        }
        lines[i] = `JWT_SECRET=${secret}`; // empty value: fill it in
      } else {
        lines.push(`JWT_SECRET=${secret}`);
      }
      const next = lines.join("\n");
      if (next !== content) fs.writeFileSync(envPath, next, "utf8");
    } else {
      fs.writeFileSync(
        envPath,
        `# Auto-created by MBR on first start (HAG-22).\nJWT_SECRET=${secret}\n`,
        "utf8",
      );
    }
    return true;
  } catch (err) {
    console.warn(
      `[jwt] could not persist auto-generated JWT_SECRET to .env (${err.message}); ` +
        "using the in-memory value — tokens will be re-issued on each restart",
    );
    return false;
  }
}

function getJwtSecret() {
  const explicit = String(process.env.JWT_SECRET ?? "");

  if (explicit.trim()) {
    return explicit.trim();
  }

  // Set-but-empty ("JWT_SECRET=") is operator-intentional: keep the legacy
  // throw so a misconfigured install fails loudly instead of silently
  // re-issuing secrets.
  if (explicit !== "" && explicit.trim() === "") {
    throw new Error("JWT_SECRET must be set in the environment.");
  }

  if (process.env.NODE_ENV === "test") {
    throw new Error("JWT_SECRET must be set in the environment.");
  }

  if (!generatedJwtSecret.value) {
    const crypto = require("crypto");
    const secret = crypto.randomBytes(48).toString("hex");
    generatedJwtSecret.value = secret;
    generatedJwtSecret.persisted = persistJwtSecret(secret);
    console.log(
      "[jwt] JWT_SECRET was empty — auto-generated a secret " +
        (generatedJwtSecret.persisted
          ? "and saved it to .env (change it before going live)."
          : "(in-memory only — set JWT_SECRET in .env before going live)."),
    );
  }

  return generatedJwtSecret.value;
}

function isLocalRequest(req) {
  const origin = String(req.get("origin") || "").trim();
  const host = String(req.get("host") || "").trim().toLowerCase();
  const forwardedFor = String(req.ip || "").trim().toLowerCase();

  return (
    isLocalDevelopmentOrigin(origin) ||
    host.startsWith("localhost:") ||
    host.startsWith("127.0.0.1:") ||
    forwardedFor === "::1" ||
    forwardedFor === "::ffff:127.0.0.1" ||
    forwardedFor === "127.0.0.1"
  );
}

const authRateLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) =>
    process.env.NODE_ENV === "test" ||
    String(process.env.AUTH_RATE_LIMIT_DISABLED || "").toLowerCase() === "true" ||
    isLocalRequest(req),
  message: {
    message: "Too many authentication attempts. Please try again later.",
  },
});

// HAG-17: dedicated limiter for the token routes (JWT issuance + the
// restaurant /api/token write surface). Reuses the local-request / test
// exemptions so dev and the test suite are never throttled, while external
// clients are kept to a separate, looser budget than the auth limiter.
const tokenRateLimiter = rateLimit({
  windowMs: Number(process.env.TOKEN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.TOKEN_RATE_LIMIT_MAX || 120),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) =>
    process.env.NODE_ENV === "test" ||
    String(process.env.AUTH_RATE_LIMIT_DISABLED || "").toLowerCase() === "true" ||
    isLocalRequest(req),
  message: {
    message: "Too many token requests. Please try again later.",
  },
});

module.exports = {
  authRateLimiter,
  tokenRateLimiter,
  getAllowedOrigins,
  getCorsOptions,
  getJwtSecret,
  isOriginAllowed,
};
