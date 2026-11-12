import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import { createDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { exportData, importData, TRANSFER_TABLES, type TransferExport } from "../services/transfer.js";

/*
 *   npm run transfer -- export --output backup/kovarsel-export.json     (leser DATABASE_URL)
 *   npm run transfer -- import --input backup/kovarsel-export.json      (prøvekjøring, ruller tilbake)
 *   npm run transfer -- import --input backup/kovarsel-export.json --commit
 */

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const db = await createDb(config.DATABASE_URL);
try {
  await migrate(db);
  const command = process.argv[2];
  if (command === "export") {
    const output = arg("--output") ?? "backup/kovarsel-export.json";
    if (existsSync(output)) throw new Error(`${output} finnes allerede; velg et nytt filnavn`);
    const data = await exportData(db);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(data, null, 1), { mode: 0o600 });
    for (const t of TRANSFER_TABLES) console.log(`${t}: ${data.tables[t]!.length} rader`);
    console.log(`Skrevet til ${output}. Filen inneholder passord-hasher og e-post: oppbevar den skjermet og slett den etter bruk.`);
  } else if (command === "import") {
    const input = arg("--input");
    if (!input) throw new Error("Oppgi --input <fil>");
    const commit = process.argv.includes("--commit");
    const counts = await importData(db, JSON.parse(readFileSync(input, "utf8")) as TransferExport, commit);
    for (const [t, n] of Object.entries(counts)) console.log(`${t}: ${n} rader importert og kontrollert`);
    console.log(commit ? "Import fullført og lagret." : "Prøvekjøring OK. Ingenting er lagret. Kjør med --commit for å lagre.");
  } else {
    console.log("Bruk: export --output <fil> | import --input <fil> [--commit]");
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
