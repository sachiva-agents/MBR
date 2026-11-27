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

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();

  if (!secret) {
    throw new Error("JWT_SECRET must be set in the environment.");
  }

  return secret;
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
