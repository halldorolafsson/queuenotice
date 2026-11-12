import type { ScheduleRule } from "./types.js";

export const TIME_ZONE = "Europe/Oslo";

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Ukedag (1 = mandag) og minutter etter midnatt i norsk tid. */
export function osloClock(date: Date): { weekday: number; minutes: number } {
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    weekday: WEEKDAYS[parts.weekday ?? ""] ?? 1,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function parseHHMM(value: string): number {
  const m = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw new Error(`Ugyldig klokkeslett: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Sant hvis tidspunktet er innenfor minst én regel. Tom regelliste betyr alltid.
 * Et tidsrom der "til" er før "fra" går over midnatt; ukedagen gjelder starten.
 * Like verdier for "fra" og "til" betyr hele døgnet.
 */
export function isWithinSchedule(rules: ScheduleRule[], now: Date): boolean {
  if (rules.length === 0) return true;
  const { weekday, minutes } = osloClock(now);
  const previousDay = weekday === 1 ? 7 : weekday - 1;
  return rules.some((rule) => {
    const from = parseHHMM(rule.from);
    const to = parseHHMM(rule.to);
    if (from === to) return rule.days.includes(weekday);
    if (from < to) return rule.days.includes(weekday) && minutes >= from && minutes < to;
    return (rule.days.includes(weekday) && minutes >= from) || (rule.days.includes(previousDay) && minutes < to);
  });
}

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Norsk dato som "YYYY-MM-DD". */
export function osloDateKey(date: Date): string {
  return dateKeyFormatter.format(date);
}

const displayFormatter = new Intl.DateTimeFormat("nb-NO", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatOslo(date: Date): string {
  return displayFormatter.format(date);
}
