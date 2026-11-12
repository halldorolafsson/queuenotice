/**
 * Normaliserer veinummer til Vegvesenets korte form: E6, R706, F714, K3060.
 * Godtar varianter som "Ev6", "EV 6", "E 6", "rv. 706", "Fv714", "fylkesvei 714".
 */
export function normalizeRoadNumber(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/\./g, "").replace(/\s+/g, "");
  const m = s.match(/^(EV|E|RV|R|FV|F|KV|K|PV|P|RIKSVEI|RIKSVEG|FYLKESVEI|FYLKESVEG|EUROPAVEI|EUROPAVEG|KOMMUNALVEI|KOMMUNALVEG)?(\d{1,5})$/);
  if (!m) return null;
  const prefix = m[1] ?? "";
  const number = String(Number(m[2]));
  const category =
    prefix.startsWith("E") ? "E"
    : prefix.startsWith("R") ? "R"
    : prefix.startsWith("F") ? "F"
    : prefix.startsWith("K") ? "K"
    : prefix.startsWith("P") ? "P"
    : null;
  if (!category) return null;
  return `${category}${number}`;
}

/** NVDB bruker "EV6", "RV706", "FV714" i vegsystemreferanse-filteret. */
export function toNvdbRoadFilter(road: string): string {
  const m = road.match(/^([ERFKP])(\d+)$/);
  if (!m) return road;
  return `${m[1]}V${m[2]}`;
}

export function displayRoadNumber(road: string): string {
  const m = road.match(/^([ERFKP])(\d+)$/);
  if (!m) return road;
  const names: Record<string, string> = { E: "E", R: "Rv. ", F: "Fv. ", K: "Kv. ", P: "Pv. " };
  return `${names[m[1]!]}${m[2]}`;
}
