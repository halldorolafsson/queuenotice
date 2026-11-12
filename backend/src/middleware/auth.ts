import type { NextFunction, Request, RequestHandler, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { config } from "../config.js";
import type { Db } from "../db/index.js";
import { logger } from "../logger.js";
import { findUserById, parseCookies, SESSION_COOKIE, userFromSession } from "../services/auth.js";
import { ensureUser } from "../services/repo.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; isAdmin: boolean };
      sessionToken?: string;
    }
  }
}

const iapClient = new OAuth2Client();

/** Verifiserer JWT-en som Identity-Aware Proxy legger på hver forespørsel. */
async function emailFromIap(req: Request): Promise<string | null> {
  const jwt = req.header("x-goog-iap-jwt-assertion");
  if (!jwt) return null;
  const keys = await iapClient.getIapPublicKeys();
  const ticket = await iapClient.verifySignedJwtWithCertsAsync(jwt, keys.pubkeys, config.IAP_AUDIENCE, [
    "https://cloud.google.com/iap",
  ]);
  return ticket.getPayload()?.email ?? null;
}

const allowed = config.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export type AuthMode = "password" | "iap" | "dev";

export function auth(db: Db, mode: AuthMode = config.AUTH_MODE): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (mode === "password") {
      const token = parseCookies(req.header("cookie"))[SESSION_COOKIE];
      const user = token ? await userFromSession(db, token) : null;
      if (!user) return res.status(401).json({ error: "Ikke innlogget" });
      req.user = user;
      req.sessionToken = token;
      return next();
    }

    let email: string | null;
    try {
      email = mode === "dev" ? config.DEV_USER_EMAIL : await emailFromIap(req);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Ugyldig IAP-token");
      email = null;
    }
    if (!email) return res.status(401).json({ error: "Ikke innlogget" });
    email = email.toLowerCase();
    if (allowed.length && !allowed.includes(email)) return res.status(403).json({ error: "Ingen tilgang" });

    const id = await ensureUser(db, email);
    const user = await findUserById(db, id);
    req.user = { id, email, isAdmin: mode === "dev" || !!user?.isAdmin };
    next();
  };
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "Krever administrator" });
  next();
};

/**
 * Enkel CSRF-beskyttelse: endrende kall må ha en egen header. Nettlesere kan
 * ikke sende den på tvers av domener uten CORS, som vi ikke tillater.
 */
export const requireClientHeader: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.header("x-kv-client") !== "web") return res.status(403).json({ error: "Mangler klient-header" });
  next();
};

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https://cache.kartverket.no; style-src 'self'; script-src 'self'; connect-src 'self'; " +
      "worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  next();
};

/** Enkel minnebasert begrensning per bruker. Holder for én instans. */
export function rateLimit(name: string, max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, number[]>();
  return (req, res, next) => {
    const key = `${name}:${req.user?.id ?? req.ip}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.setHeader("Retry-After", String(Math.ceil((windowMs - (now - recent[0]!)) / 1000)));
      return res.status(429).json({ error: "For mange forespørsler, prøv igjen litt senere" });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
