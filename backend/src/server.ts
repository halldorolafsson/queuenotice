import { createApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";
import { assertWebAuthConfig, config } from "./config.js";
import { startScheduler } from "./jobs/scheduler.js";
import { logger } from "./logger.js";
import { createEmailSender } from "./services/notifier.js";

assertWebAuthConfig();
const { db, notifier, poll } = await bootstrap();
const app = createApp({
  db,
  notifier,
  pollNow: () => poll("manual"),
  emailSender: config.NOTIFY_MODE === "live" ? createEmailSender() : null,
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "API lytter");
});

const stopScheduler = config.POLL_IN_PROCESS ? startScheduler(() => poll("scheduler"), config.POLL_INTERVAL_SECONDS) : () => {};

async function shutdown(signal: string) {
  logger.info({ signal }, "Avslutter");
  stopScheduler();
  server.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
