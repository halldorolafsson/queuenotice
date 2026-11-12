import type { Db } from "../db/index.js";
import { config } from "../config.js";
import { hashToken, newToken } from "./passwords.js";

/* Økter, brukere og engangslenker. Bare SHA-256 av tokener lagres i databasen. */

export const SESSION_COOKIE = "kv_session";

export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  is_admin: boolean;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function secureCookies(): boolean {
  return config.NODE_ENV === "production" || config.APP_BASE_URL.startsWith("https://");
}

export function sessionCookie(token: string, expiresAt: Date): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
    ...(secureCookies() ? ["Secure"] : []),
  ].join("; ");
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureCookies() ? "; Secure" : ""}`;
}

export async function createSession(db: Db, userId: string, userAgent: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.SESSION_DAYS * 24 * 3600 * 1000);
  await db.query("INSERT INTO sessions (id_hash, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)", [
    hashToken(token),
    userId,
    expiresAt,
    userAgent?.slice(0, 200) ?? null,
  ]);
  return { token, expiresAt };
}

/** Finner brukeren for en økt. Forlenger økten høyst én gang i timen. */
export async function userFromSession(db: Db, token: string): Promise<AuthUser | null> {
  const rows = await db.query<{ id: string; email: string; is_admin: boolean; last_seen_at: Date }>(
    `SELECT u.id, u.email, u.is_admin, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const r = rows[0];
  if (!r) return null;
  if (Date.now() - r.last_seen_at.getTime() > 3600 * 1000) {
    await db.query("UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id_hash = $1", [
      hashToken(token),
      new Date(Date.now() + config.SESSION_DAYS * 24 * 3600 * 1000),
    ]);
  }
  return { id: r.id, email: r.email, isAdmin: r.is_admin };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE id_hash = $1", [hashToken(token)]);
}

export async function deleteAllSessions(db: Db, userId: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

export async function purgeExpired(db: Db): Promise<void> {
  await db.query("DELETE FROM sessions WHERE expires_at < now()");
  await db.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'");
}

export async function findUserByEmail(db: Db, email: string) {
  const rows = await db.query<UserRow>("SELECT id, email, password_hash, is_admin FROM users WHERE email = $1", [
    email.trim().toLowerCase(),
  ]);
  const r = rows[0];
  return r ? { id: r.id, email: r.email, passwordHash: r.password_hash, isAdmin: r.is_admin } : null;
}

export async function findUserById(db: Db, id: string) {
  const rows = await db.query<UserRow>("SELECT id, email, password_hash, is_admin FROM users WHERE id = $1", [id]);
  const r = rows[0];
  return r ? { id: r.id, email: r.email, passwordHash: r.password_hash, isAdmin: r.is_admin } : null;
}

export async function setPassword(db: Db, userId: string, passwordHash: string): Promise<void> {
  await db.query("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1", [userId, passwordHash]);
}

export async function markLogin(db: Db, userId: string): Promise<void> {
  await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
}

// ---------- Engangslenker ----------

export type TokenKind = "invitation" | "reset";

const TTL_MINUTES: Record<TokenKind, number> = { invitation: 48 * 60, reset: 30 };

/** Lager ny lenke og ugyldiggjør tidligere ubrukte lenker av samme type for e-posten. */
export async function createAuthToken(
  db: Db,
  input: { kind: TokenKind; email: string; isAdmin?: boolean; createdBy?: string | null },
): Promise<{ token: string; expiresAt: Date; link: string }> {
  const email = input.email.trim().toLowerCase();
  const token = newToken();
  const expiresAt = new Date(Date.now() + TTL_MINUTES[input.kind] * 60000);
  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM auth_tokens WHERE email = $1 AND kind = $2 AND used_at IS NULL", [email, input.kind]);
    await tx.query(
      "INSERT INTO auth_tokens (token_hash, kind, email, is_admin, created_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [hashToken(token), input.kind, email, input.isAdmin ?? false, input.createdBy ?? null, expiresAt],
    );
  });
  const path = input.kind === "invitation" ? "invitasjon" : "tilbakestill";
  // Tokenet ligger etter # slik at det ikke havner i serverlogger.
  return { token, expiresAt, link: `${config.APP_BASE_URL.replace(/\/$/, "")}/#/${path}/${token}` };
}

export async function findValidToken(db: Db, kind: TokenKind, token: string) {
  const rows = await db.query<{ id: string; email: string; is_admin: boolean }>(
    `SELECT id, email, is_admin FROM auth_tokens
     WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(token), kind],
  );
  const r = rows[0];
  return r ? { id: r.id, email: r.email, isAdmin: r.is_admin } : null;
}

export async function consumeToken(db: Db, id: string): Promise<boolean> {
  const rows = await db.query("UPDATE auth_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id", [id]);
  return rows.length > 0;
}

// ---------- Administrasjon ----------

export async function listUsers(db: Db) {
  const rows = await db.query<{
    id: string;
    email: string;
    is_admin: boolean;
    has_password: boolean;
    created_at: Date;
    last_login_at: Date | null;
  }>(
    `SELECT id, email, is_admin, password_hash IS NOT NULL AS has_password, created_at, last_login_at
     FROM users ORDER BY created_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    isAdmin: r.is_admin,
    hasPassword: r.has_password,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  }));
}

export async function listPendingInvitations(db: Db) {
  const rows = await db.query<{ id: string; email: string; is_admin: boolean; expires_at: Date }>(
    `SELECT id, email, is_admin, expires_at FROM auth_tokens
     WHERE kind = 'invitation' AND used_at IS NULL AND expires_at > now() ORDER BY created_at`,
  );
  return rows.map((r) => ({ id: r.id, email: r.email, isAdmin: r.is_admin, expiresAt: r.expires_at }));
}

export async function revokeInvitation(db: Db, id: string): Promise<boolean> {
  const rows = await db.query("DELETE FROM auth_tokens WHERE id = $1 AND kind = 'invitation' AND used_at IS NULL RETURNING id", [id]);
  return rows.length > 0;
}

export async function countAdmins(db: Db): Promise<number> {
  const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE is_admin AND password_hash IS NOT NULL");
  return rows[0]?.n ?? 0;
}

export async function setAdmin(db: Db, userId: string, isAdmin: boolean): Promise<void> {
  await db.query("UPDATE users SET is_admin = $2 WHERE id = $1", [userId, isAdmin]);
}

export async function deleteUser(db: Db, userId: string): Promise<boolean> {
  const rows = await db.query("DELETE FROM users WHERE id = $1 RETURNING id", [userId]);
  return rows.length > 0;
}

export async function renameUser(db: Db, oldEmail: string, newEmail: string): Promise<boolean> {
  const rows = await db.query("UPDATE users SET email = $2 WHERE email = $1 RETURNING id", [
    oldEmail.trim().toLowerCase(),
    newEmail.trim().toLowerCase(),
  ]);
  return rows.length > 0;
}
