import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import type { Db } from "./db/index.js";
import { auth, requireClientHeader, securityHeaders, type AuthMode } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errors.js";
import { accountRoutes, publicAuthRoutes } from "./routes/auth.js";
import { listRoutes } from "./routes/lists.js";
import { miscRoutes } from "./routes/misc.js";
import { settingsRoutes } from "./routes/settings.js";
import type { EmailSender, Notifier } from "./services/notifier.js";

export function createApp(deps: {
  db: Db;
  notifier: Notifier;
  pollNow: () => Promise<unknown>;
  emailSender?: EmailSender | null;
  authMode?: AuthMode;
}) {
  const authMode = deps.authMode ?? config.AUTH_MODE;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(securityHeaders);

  // /healthz er reservert av Google Frontend i Cloud Run.
  app.get("/health", (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(express.json({ limit: "100kb" }));
  api.use(requireClientHeader);
  api.use(publicAuthRoutes(deps.db, { emailSender: deps.emailSender ?? null, canSendEmail: deps.notifier.mode === "live" }));
  api.use(auth(deps.db, authMode));
  api.use(accountRoutes(deps.db));
  api.use(listRoutes(deps.db));
  api.use(settingsRoutes(deps.db, deps.notifier));
  api.use(miscRoutes(deps.db, deps.pollNow));
  api.use((_req, res) => res.status(404).json({ error: "Ukjent API-adresse" }));
  app.use("/api", api);

  const staticDir = resolve(process.cwd(), config.STATIC_DIR);
  if (existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        setHeaders: (res, path) => {
          if (path.endsWith("sw.js") || path.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
        },
      }),
    );
  }

  app.use(errorHandler);
  return app;
}
