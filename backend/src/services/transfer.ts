import type { Db } from "../db/index.js";

/*
 * Flytter brukere, lister, strekninger og varslingsinnstillinger mellom databaser,
 * f.eks. fra lokal PGlite til Cloud SQL. ID-er og passord-hasher beholdes.
 * Push-abonnement, økter, trafikkdata og varslingslogg flyttes ikke.
 */

export const TRANSFER_TABLES = ["users", "watch_lists", "segments", "notification_settings"] as const;
const JSON_COLUMNS: Record<string, string[]> = {
  watch_lists: ["schedule"],
  segments: ["geometry", "road_numbers"],
  notification_settings: ["event_types"],
};

type Row = Record<string, unknown>;
export interface TransferExport {
  exportedAt: string;
  tables: Record<string, Row[]>;
}

export async function exportData(db: Db): Promise<TransferExport> {
  const tables: Record<string, Row[]> = {};
  for (const t of TRANSFER_TABLES) tables[t] = await db.query<Row>(`SELECT * FROM ${t}`);
  return { exportedAt: new Date().toISOString(), tables };
}

const count = async (db: Db, table: string) =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0]?.n ?? 0;

/** Importerer i én transaksjon. Uten commit rulles alt tilbake etter kontroll. */
export async function importData(db: Db, data: TransferExport, commit: boolean): Promise<Record<string, number>> {
  const rollback = new Error("PRØVEKJØRING");
  const counts: Record<string, number> = {};
  try {
    await db.transaction(async (tx) => {
      for (const t of TRANSFER_TABLES) {
        const n = await count(tx, t);
        if (n > 0) throw new Error(`Tabellen ${t} i måldatabasen er ikke tom (${n} rader). Import avbrutt.`);
      }
      for (const t of TRANSFER_TABLES) {
        const rows = data.tables[t] ?? [];
        for (const row of rows) {
          const cols = Object.keys(row);
          const values = cols.map((c) => (JSON_COLUMNS[t]?.includes(c) ? JSON.stringify(row[c]) : row[c]));
          await tx.query(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, values);
        }
        const n = await count(tx, t);
        if (n !== rows.length) throw new Error(`Kontroll feilet for ${t}: ${n} i databasen, ${rows.length} i filen`);
        counts[t] = n;
      }
      if (!commit) throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }
  return counts;
}
