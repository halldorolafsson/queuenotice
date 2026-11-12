import { bootstrap } from "../bootstrap.js";
import { logger } from "../logger.js";

// Kjører én innhenting og avslutter. Brukes av Cloud Run Job og "npm run poll".
const { db, poll } = await bootstrap();
let exitCode = 0;
try {
  const summary = await poll("job");
  const failed = Object.entries(summary.sources).filter(([, s]) => !s.ok);
  if (failed.length === Object.keys(summary.sources).length && failed.length > 0) exitCode = 1;
} catch (err) {
  logger.error({ err: (err as Error).message }, "Jobb feilet");
  exitCode = 1;
} finally {
  await db.close();
}
process.exit(exitCode);
