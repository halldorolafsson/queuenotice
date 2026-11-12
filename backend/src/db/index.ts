import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";

export interface Db {
  readonly kind: "pg" | "pglite";
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PgDb implements Db {
  readonly kind = "pg" as const;
  constructor(private pool: pg.Pool) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }
  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }
  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: Db = {
      kind: "pg",
      query: async <R>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[],
      exec: async (sql: string) => void (await client.query(sql)),
      transaction: (inner) => inner(tx),
      close: async () => {},
    };
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}

type PgliteLike = Pick<PGlite, "query" | "exec">;

class PgliteDb implements Db {
  readonly kind = "pglite" as const;
  constructor(private db: PGlite) {}

  private static wrap(conn: PgliteLike, owner: PGlite): Db {
    return {
      kind: "pglite",
      query: async <R>(sql: string, params: unknown[] = []) => (await conn.query<R>(sql, params)).rows,
      exec: async (sql: string) => void (await conn.exec(sql)),
      transaction: (inner) => owner.transaction((tx) => inner(PgliteDb.wrap(tx, owner))),
      close: async () => {},
    };
  }
  query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return PgliteDb.wrap(this.db, this.db).query<T>(sql, params);
  }
  exec(sql: string): Promise<void> {
    return PgliteDb.wrap(this.db, this.db).exec(sql);
  }
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(PgliteDb.wrap(tx, this.db)));
  }
  async close(): Promise<void> {
    await this.db.close();
  }
}

/** "pglite:memory", "pglite:<mappe>" eller en vanlig postgres-URL. */
export async function createDb(url: string, opts: { poolMax?: number } = {}): Promise<Db> {
  if (url.startsWith("pglite:")) {
    const location = url.slice("pglite:".length);
    if (location === "memory") {
      return new PgliteDb(await PGlite.create());
    }
    mkdirSync(location, { recursive: true });
    return new PgliteDb(await PGlite.create(location));
  }
  const pool = new pg.Pool({ connectionString: url, max: opts.poolMax ?? 5, idleTimeoutMillis: 30000 });
  return new PgDb(pool);
}
