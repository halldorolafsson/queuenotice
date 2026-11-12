import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().default(8080),
  LOG_LEVEL: z.string().default("info"),
  APP_BASE_URL: z.string().default("http://localhost:5173"),

  // "pglite:<mappe>" for lokal innebygd Postgres, eller postgres://... i drift.
  DATABASE_URL: z.string().default("pglite:./.data/pglite"),

  // password: egen innlogging med e-post og passord (standard).
  // iap: Google Identity-Aware Proxy. dev: alle er DEV_USER_EMAIL (bare tester/lokalt).
  AUTH_MODE: z.enum(["password", "iap", "dev"]).default("password"),
  DEV_USER_EMAIL: z.string().email().default("meg@localhost.test"),
  IAP_AUDIENCE: z.string().optional(),
  ALLOWED_EMAILS: z.string().default(""),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PASSWORD_HASH_COST: z.coerce.number().int().min(10).max(20).default(17),

  TRAFFIC_SOURCES: z.string().default("vegvesen"),
  VEGVESEN_WFS_URL: z.string().default("https://ogckart-sn1.atlas.vegvesen.no/datex_3_1/ows"),
  VEGVESEN_BBOX: z.string().default("8.5,62.2,14.5,65.5"),
  NVDB_API_URL: z.string().default("https://nvdbapiles.atlas.vegvesen.no/vegnett/api/v4"),
  NVDB_CLIENT_ID: z.string().default("queuenotice-personlig"),
  GEONORGE_URL: z.string().default("https://ws.geonorge.no"),
  HTTP_TIMEOUT_MS: z.coerce.number().int().default(20000),

  // Google Maps Routes API (betalt). Brukes bare når "google" står i TRAFFIC_SOURCES.
  GOOGLE_ROUTES_API_KEY: z.string().optional(),
  GOOGLE_ROUTES_URL: z.string().default("https://routes.googleapis.com/directions/v2:computeRoutes"),
  GOOGLE_ROUTES_MIN_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(10),
  GOOGLE_ROUTES_MAX_CALLS_PER_DAY: z.coerce.number().int().min(0).default(150),
  GOOGLE_ROUTES_MAX_CALLS_PER_MONTH: z.coerce.number().int().min(0).default(4500),
  GOOGLE_ROUTES_REQUIRE_SCHEDULE: bool.default(true),

  POLL_IN_PROCESS: bool.default(true),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(300),
  STALE_AFTER_MINUTES: z.coerce.number().int().default(15),
  MAX_DIRECTION_LOOKUPS_PER_POLL: z.coerce.number().int().default(20),

  NOTIFY_MODE: z.enum(["dry-run", "live"]).default("dry-run"),
  MAX_NOTIFICATIONS_PER_DAY: z.coerce.number().int().default(40),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  STATIC_DIR: z.string().default("../frontend/dist"),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
  );
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Ugyldig konfigurasjon: ${msg}`);
  }
  return parsed.data;
}

export const config = load();

/** Kalles bare av webserveren; jobber har ingen innlogging. */
export function assertWebAuthConfig(): void {
  if (config.AUTH_MODE === "iap" && !config.IAP_AUDIENCE) {
    throw new Error("AUTH_MODE=iap krever IAP_AUDIENCE");
  }
  if (config.NODE_ENV === "production" && config.AUTH_MODE === "dev") {
    throw new Error("AUTH_MODE=dev er ikke tillatt i produksjon");
  }
}

export const enabledSources = (): string[] =>
  config.TRAFFIC_SOURCES.split(",").map((s) => s.trim()).filter(Boolean);
