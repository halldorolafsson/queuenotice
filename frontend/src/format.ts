const timeFmt = new Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Klokkeslett i dag, ellers dato og klokkeslett. Alltid norsk tid. */
export function when(iso: string | null | undefined): string {
  if (!iso) return "ukjent tid";
  const d = new Date(iso);
  return dayFmt.format(d) === dayFmt.format(new Date()) ? `kl. ${timeFmt.format(d)}` : dateTimeFmt.format(d);
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "aldri";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "nå nettopp";
  if (min < 60) return `${min} min siden`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} t siden` : when(iso);
}

export const DAY_NAMES = ["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"];

export function scheduleText(rules: Array<{ days: number[]; from: string; to: string }>): string {
  if (rules.length === 0) return "Hele døgnet, alle dager";
  return rules
    .map((r) => {
      const days = [...r.days].sort().map((d) => DAY_NAMES[d - 1]).join(" ");
      const time = r.from === r.to ? "hele døgnet" : `${r.from}–${r.to}`;
      return `${days} ${time}`;
    })
    .join(" · ");
}

const ROAD_PREFIX: Record<string, string> = { E: "E", R: "Rv. ", F: "Fv. ", K: "Kv. ", P: "Pv. " };

export function roadLabel(road: string): string {
  const m = road.match(/^([ERFKP])(\d+)$/);
  if (!m) return road;
  return `${ROAD_PREFIX[m[1]!] ?? ""}${m[2]}`;
}

export function roadsLabel(s: { roadNumber: string; roadNumbers?: string[] }): string {
  const roads = s.roadNumbers?.length ? s.roadNumbers : [s.roadNumber].filter(Boolean);
  return roads.map(roadLabel).join("/");
}
