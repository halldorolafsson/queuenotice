import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import type { Db } from "../db/index.js";
import { logger } from "../logger.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpProblem } from "../middleware/errors.js";
import * as authDb from "../services/auth.js";
import type { EmailSender } from "../services/notifier.js";
import { hashPassword, MAX_PASSWORD_LENGTH, passwordProblem, verifyAgainstDummy, verifyPassword } from "../services/passwords.js";
import { ensureUser } from "../services/repo.js";

const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(1).max(MAX_PASSWORD_LENGTH);
const token = z.string().min(20).max(100);

/** Teller mislykkede forsøk i minnet. Holder for én instans. */
class FailureLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  blocked(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, recent);
    return recent.length >= this.max;
  }
  fail(key: string): void {
    this.hits.set(key, [...(this.hits.get(key) ?? []), Date.now()]);
  }
  clear(key: string): void {
    this.hits.delete(key);
  }
}

const loginByAccount = new FailureLimiter(5, 15 * 60000);
const loginByIp = new FailureLimiter(20, 15 * 60000);
const forgotLimiter = new FailureLimiter(3, 60 * 60000);
const tokenLimiter = new FailureLimiter(10, 15 * 60000);

function checkPassword(pw: string, userEmail: string): void {
  const problem = passwordProblem(pw, userEmail);
  if (problem) throw new HttpProblem(400, problem);
}

async function startSession(db: Db, req: Request, res: Response, userId: string): Promise<void> {
  const { token: t, expiresAt } = await authDb.createSession(db, userId, req.header("user-agent") ?? null);
  await authDb.markLogin(db, userId);
  res.setHeader("Set-Cookie", authDb.sessionCookie(t, expiresAt));
}

/** Ruter som virker uten innlogging. */
export function publicAuthRoutes(db: Db, deps: { emailSender: EmailSender | null; canSendEmail: boolean }): Router {
  const r = Router();

  r.get("/auth/config", (_req, res) => {
    res.json({ mode: config.AUTH_MODE, canResetByEmail: deps.canSendEmail && !!deps.emailSender });
  });

  r.post("/auth/login", async (req, res) => {
    const body = z.object({ email, password }).parse(req.body);
    const accountKey = `${req.ip}|${body.email}`;
    if (loginByAccount.blocked(accountKey) || loginByIp.blocked(req.ip ?? "")) {
      throw new HttpProblem(429, "For mange mislykkede forsøk. Vent 15 minutter og prøv igjen.");
    }
    const user = await authDb.findUserByEmail(db, body.email);
    const ok = user?.passwordHash ? await verifyPassword(body.password, user.passwordHash) : await verifyAgainstDummy(body.password);
    if (!ok || !user) {
      loginByAccount.fail(accountKey);
      loginByIp.fail(req.ip ?? "");
      logger.warn({ ip: req.ip }, "Mislykket innlogging");
      throw new HttpProblem(401, "Feil e-post eller passord");
    }
    loginByAccount.clear(accountKey);
    await startSession(db, req, res, user.id);
    logger.info({ userId: user.id }, "Innlogget");
    res.json({ email: user.email, isAdmin: user.isAdmin });
  });

  r.post("/auth/logout", async (req, res) => {
    const t = authDb.parseCookies(req.header("cookie"))[authDb.SESSION_COOKIE];
    if (t) await authDb.deleteSession(db, t);
    res.setHeader("Set-Cookie", authDb.clearedSessionCookie());
    res.json({ ok: true });
  });

  r.post("/auth/forgot", async (req, res) => {
    const body = z.object({ email }).parse(req.body);
    const generic = {
      ok: true,
      message: "Hvis adressen finnes, er det sendt en lenke for å lage nytt passord. Lenken varer i 30 minutter.",
    };
    if (forgotLimiter.blocked(req.ip ?? "") || forgotLimiter.blocked(body.email)) return res.json(generic);
    forgotLimiter.fail(req.ip ?? "");
    forgotLimiter.fail(body.email);
    const user = await authDb.findUserByEmail(db, body.email);
    if (!user?.passwordHash || !deps.emailSender || !deps.canSendEmail) {
      logger.info({ found: !!user }, "Glemt passord: ingen e-post sendt");
      return res.json(generic);
    }
    const { link } = await authDb.createAuthToken(db, { kind: "reset", email: user.email });
    try {
      await deps.emailSender.send(
        user.email,
        "Nytt passord for Køvarsel",
        `Noen (forhåpentligvis du) ba om å lage nytt passord for Køvarsel.\n\nÅpne lenken innen 30 minutter:\n${link}\n\nHvis det ikke var deg, kan du se bort fra denne e-posten. Passordet ditt er ikke endret.`,
      );
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Kunne ikke sende e-post for nytt passord");
    }
    res.json(generic);
  });

  r.post("/auth/reset", async (req, res) => {
    const body = z.object({ token, password }).parse(req.body);
    if (tokenLimiter.blocked(req.ip ?? "")) throw new HttpProblem(429, "For mange forsøk. Vent litt.");
    const t = await authDb.findValidToken(db, "reset", body.token);
    const user = t ? await authDb.findUserByEmail(db, t.email) : null;
    if (!t || !user) {
      tokenLimiter.fail(req.ip ?? "");
      throw new HttpProblem(400, "Lenken er ugyldig eller utløpt. Be om en ny.");
    }
    checkPassword(body.password, user.email);
    if (!(await authDb.consumeToken(db, t.id))) throw new HttpProblem(400, "Lenken er allerede brukt");
    await authDb.setPassword(db, user.id, await hashPassword(body.password));
    await authDb.deleteAllSessions(db, user.id);
    logger.info({ userId: user.id }, "Passord tilbakestilt");
    res.json({ ok: true, email: user.email });
  });

  r.post("/auth/invitation/check", async (req, res) => {
    const body = z.object({ token }).parse(req.body);
    const t = await authDb.findValidToken(db, "invitation", body.token);
    if (!t) {
      tokenLimiter.fail(req.ip ?? "");
      throw new HttpProblem(404, "Invitasjonen er ugyldig eller utløpt");
    }
    res.json({ email: t.email });
  });

  r.post("/auth/invitation/accept", async (req, res) => {
    const body = z.object({ token, password }).parse(req.body);
    if (tokenLimiter.blocked(req.ip ?? "")) throw new HttpProblem(429, "For mange forsøk. Vent litt.");
    const t = await authDb.findValidToken(db, "invitation", body.token);
    if (!t) {
      tokenLimiter.fail(req.ip ?? "");
      throw new HttpProblem(400, "Invitasjonen er ugyldig eller utløpt");
    }
    checkPassword(body.password, t.email);
    if (!(await authDb.consumeToken(db, t.id))) throw new HttpProblem(400, "Invitasjonen er allerede brukt");
    const userId = await ensureUser(db, t.email);
    await authDb.setPassword(db, userId, await hashPassword(body.password));
    if (t.isAdmin) await authDb.setAdmin(db, userId, true);
    await authDb.deleteAllSessions(db, userId);
    await startSession(db, req, res, userId);
    logger.info({ userId }, "Invitasjon tatt i bruk");
    res.json({ email: t.email, isAdmin: t.isAdmin });
  });

  return r;
}

/** Ruter for innlogget bruker: egen konto og administrasjon. */
export function accountRoutes(db: Db): Router {
  const r = Router();

  r.post("/account/password", async (req, res) => {
    const body = z
      .object({ currentPassword: password, newPassword: password })
      .parse(req.body);
    const user = await authDb.findUserById(db, req.user!.id);
    if (!user?.passwordHash || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new HttpProblem(400, "Nåværende passord er feil");
    }
    if (body.currentPassword === body.newPassword) throw new HttpProblem(400, "Nytt passord må være forskjellig fra det gamle");
    checkPassword(body.newPassword, user.email);
    await authDb.setPassword(db, user.id, await hashPassword(body.newPassword));
    // Alle andre økter logges ut; denne enheten får ny økt.
    await authDb.deleteAllSessions(db, user.id);
    await startSession(db, req, res, user.id);
    logger.info({ userId: user.id }, "Passord endret");
    res.json({ ok: true });
  });

  r.post("/account/logout-all", async (req, res) => {
    await authDb.deleteAllSessions(db, req.user!.id);
    res.setHeader("Set-Cookie", authDb.clearedSessionCookie());
    res.json({ ok: true });
  });

  const admin = Router();

  admin.get("/users", async (_req, res) => {
    res.json({ users: await authDb.listUsers(db), invitations: await authDb.listPendingInvitations(db) });
  });

  admin.post("/invitations", async (req, res) => {
    const body = z.object({ email, isAdmin: z.boolean().default(false) }).parse(req.body);
    const existing = await authDb.findUserByEmail(db, body.email);
    if (existing?.passwordHash) throw new HttpProblem(409, "Brukeren finnes allerede. Lag heller en lenke for nytt passord.");
    const inv = await authDb.createAuthToken(db, { kind: "invitation", email: body.email, isAdmin: body.isAdmin, createdBy: req.user!.id });
    logger.info({ by: req.user!.id }, "Invitasjon laget");
    res.status(201).json({ link: inv.link, expiresAt: inv.expiresAt });
  });

  admin.delete("/invitations/:id", async (req, res) => {
    if (!(await authDb.revokeInvitation(db, z.string().uuid().parse(req.params.id)))) throw new HttpProblem(404, "Fant ikke invitasjonen");
    res.status(204).end();
  });

  admin.post("/users/:id/reset-link", async (req, res) => {
    const user = await authDb.findUserById(db, z.string().uuid().parse(req.params.id));
    if (!user) throw new HttpProblem(404, "Fant ikke brukeren");
    const t = await authDb.createAuthToken(db, { kind: "reset", email: user.email, createdBy: req.user!.id });
    logger.info({ by: req.user!.id, userId: user.id }, "Lenke for nytt passord laget av administrator");
    res.status(201).json({ link: t.link, expiresAt: t.expiresAt });
  });

  admin.patch("/users/:id", async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { isAdmin } = z.object({ isAdmin: z.boolean() }).parse(req.body);
    if (id === req.user!.id) throw new HttpProblem(400, "Du kan ikke endre din egen administratorrolle");
    await authDb.setAdmin(db, id, isAdmin);
    res.json({ ok: true });
  });

  admin.delete("/users/:id", async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    if (id === req.user!.id) throw new HttpProblem(400, "Du kan ikke slette deg selv");
    if (!(await authDb.deleteUser(db, id))) throw new HttpProblem(404, "Fant ikke brukeren");
    logger.info({ by: req.user!.id, userId: id }, "Bruker slettet");
    res.status(204).end();
  });

  r.use("/admin", requireAdmin, admin);
  return r;
}
