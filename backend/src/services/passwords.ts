import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { config } from "../config.js";

/*
 * Passord hashes med scrypt (innebygd i Node). Parametere etter OWASP:
 * N = 2^17, r = 8, p = 1. Lagret format: scrypt$<log2N>$<r>$<p>$<salt>$<hash>.
 */

const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

function derive(password: string, salt: Buffer, log2N: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** log2N;
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const log2N = config.PASSWORD_HASH_COST;
  const salt = randomBytes(16);
  const hash = await derive(password, salt, log2N, 8, 1);
  return `scrypt$${log2N}$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;
/** Brukes når e-posten ikke finnes, slik at svartiden ikke avslører hvilke brukere som finnes. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("dummy-passord-som-aldri-brukes");
  await verifyPassword(password, await dummyHash);
  return false;
}

export function passwordProblem(password: string, email: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Passordet må ha minst ${MIN_PASSWORD_LENGTH} tegn`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Passordet kan ha maks ${MAX_PASSWORD_LENGTH} tegn`;
  if (password.toLowerCase().includes(email.split("@")[0]!.toLowerCase()) && email.split("@")[0]!.length >= 4) {
    return "Passordet kan ikke inneholde e-postadressen";
  }
  if (/^(.)\1+$/.test(password)) return "Passordet er for enkelt";
  return null;
}

/** Tilfeldig token for informasjonskapsler og engangslenker. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
