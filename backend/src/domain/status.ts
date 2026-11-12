export type Freshness = "fresh" | "stale" | "error" | "never";

export interface SourceStatusRow {
  source: string;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  consecutiveFailures: number;
  lastItemCount: number | null;
  isDemo: boolean;
}

/**
 * fresh: siste vellykkede henting er nyere enn grensen.
 * error: siste forsøk feilet og vi har ikke ferske data.
 * stale: data finnes, men er for gamle.
 * never: aldri hentet.
 */
export function freshness(row: SourceStatusRow | undefined, now: Date, staleAfterMin: number): Freshness {
  if (!row || !row.lastSuccessAt) return row?.lastErrorAt ? "error" : "never";
  const ageMin = (now.getTime() - row.lastSuccessAt.getTime()) / 60000;
  if (ageMin <= staleAfterMin) return "fresh";
  const lastFailed = row.lastErrorAt && row.lastErrorAt.getTime() >= row.lastSuccessAt.getTime();
  return lastFailed ? "error" : "stale";
}

export type SegmentStatus = "paused" | "incident" | "no_events" | "stale" | "error" | "no_data";

/**
 * Status for én strekning. Rekkefølgen er viktig: registrerte hendelser vises
 * alltid, men "ingen hendelser" brukes bare når dataene er ferske.
 */
export function segmentStatus(input: {
  paused: boolean;
  hasRelevantItems: boolean;
  sourceFreshness: Freshness[];
}): SegmentStatus {
  if (input.paused) return "paused";
  if (input.hasRelevantItems) return "incident";
  const f = input.sourceFreshness;
  if (f.length === 0 || f.every((x) => x === "never")) return "no_data";
  if (f.some((x) => x === "fresh")) return "no_events";
  if (f.some((x) => x === "error")) return "error";
  return "stale";
}
