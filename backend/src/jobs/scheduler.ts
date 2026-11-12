import { logger } from "../logger.js";

/**
 * Lokal tidsstyring for utvikling og enkel drift med én alltid-på instans.
 * I Cloud Run brukes heller Cloud Scheduler + Cloud Run Job (se pollOnce.ts).
 */
export function startScheduler(task: () => Promise<unknown>, intervalSeconds: number): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Planlagt innhenting feilet");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 2000);
  const timer = setInterval(tick, intervalSeconds * 1000);
  logger.info({ intervalSeconds }, "Lokal planlegger startet");
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
