import { distanceM } from "./geo.js";
import type { Category, LonLat, TrafficEvent } from "./types.js";

/** Lavere tall vinner når samme hendelse kommer fra flere kilder. */
export const SOURCE_PRIORITY: Record<string, number> = { vegvesen: 0, demo: 9 };

const MAX_DISTANCE_M = 500;

function points(e: TrafficEvent): LonLat[] {
  return e.lines.flat();
}

function closeTogether(a: TrafficEvent, b: TrafficEvent): boolean {
  const pa = points(a);
  const pb = points(b);
  // Grov, men tilstrekkelig: sjekk et utvalg punkter fra hver side.
  const step = (n: number) => Math.max(1, Math.floor(n / 25));
  for (let i = 0; i < pa.length; i += step(pa.length)) {
    for (let j = 0; j < pb.length; j += step(pb.length)) {
      if (distanceM(pa[i]!, pb[j]!) <= MAX_DISTANCE_M) return true;
    }
  }
  return false;
}

function compatible(a: Category, b: Category): boolean {
  if (a === b) return true;
  const incident = new Set<Category>(["accident", "obstruction", "queue", "closure"]);
  return incident.has(a) && incident.has(b);
}

function overlapsInTime(a: TrafficEvent, b: TrafficEvent): boolean {
  const aStart = a.startTime?.getTime() ?? -Infinity;
  const bStart = b.startTime?.getTime() ?? -Infinity;
  const aEnd = a.endTime?.getTime() ?? Infinity;
  const bEnd = b.endTime?.getTime() ?? Infinity;
  return aStart < bEnd && bStart < aEnd;
}

export interface EventGroup {
  primary: TrafficEvent;
  duplicates: TrafficEvent[];
}

/**
 * Slår sammen meldinger fra ulike kilder som trolig gjelder samme hendelse:
 * felles veinummer, under 500 m fra hverandre, overlappende tid og forenlig type.
 * Meldinger fra samme kilde slås aldri sammen; kilden har egne ID-er for det.
 */
export function groupDuplicates(events: TrafficEvent[]): EventGroup[] {
  const sorted = [...events].sort(
    (a, b) => (SOURCE_PRIORITY[a.source] ?? 5) - (SOURCE_PRIORITY[b.source] ?? 5),
  );
  const groups: EventGroup[] = [];
  for (const e of sorted) {
    const group = groups.find(
      (g) =>
        g.primary.source !== e.source &&
        !g.duplicates.some((d) => d.source === e.source) &&
        g.primary.roadNumbers.some((r) => e.roadNumbers.includes(r)) &&
        compatible(g.primary.category, e.category) &&
        overlapsInTime(g.primary, e) &&
        closeTogether(g.primary, e),
    );
    if (group) group.duplicates.push(e);
    else groups.push({ primary: e, duplicates: [] });
  }
  return groups;
}
