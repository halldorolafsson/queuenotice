import { config } from "./config.js";
import { createDb, type Db } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { logger } from "./logger.js";
import { createNotifier, type Notifier } from "./services/notifier.js";
import { runPoll } from "./services/poll.js";
import { createSources } from "./traffic/registry.js";

/** Felles oppsett for webserver og planlagt jobb. */
export async function bootstrap(): Promise<{ db: Db; notifier: Notifier; poll: (trigger: string) => ReturnType<typeof runPoll> }> {
  const db = await createDb(config.DATABASE_URL);
  // Lokalt kjøres migreringer automatisk. I drift kjøres de som eget steg.
  if (db.kind === "pglite") await migrate(db);
  const notifier = createNotifier(db);
  const sources = createSources();
  const poll = (trigger: string) =>
    runPoll(
      {
        db,
        sources,
        notifier,
        logger,
        staleAfterMin: config.STALE_AFTER_MINUTES,
        maxDirectionLookups: config.MAX_DIRECTION_LOOKUPS_PER_POLL,
      },
      trigger,
    );
  logger.info(
    { sources: sources.map((s) => s.id), notifyMode: config.NOTIFY_MODE, authMode: config.AUTH_MODE, db: db.kind },
    "Køvarsel startet",
  );
  return { db, notifier, poll };
}
