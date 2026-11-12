import { config } from "../config.js";
import { logger } from "../logger.js";
import { createDb } from "./index.js";
import { migrate } from "./migrate.js";

const db = await createDb(config.DATABASE_URL);
try {
  const ran = await migrate(db);
  logger.info({ ran }, ran.length ? "Migreringer kjørt" : "Databasen er oppdatert");
} finally {
  await db.close();
}
