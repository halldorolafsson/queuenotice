import type { Category, TrafficEvent } from "./types.js";

const CATEGORY_PRIORITY: Category[] = [
  "closure",
  "accident",
  "queue",
  "obstruction",
  "restriction",
  "roadworks",
  "conditions",
  "other",
];

const CLOSURE_TYPES = new Set(["roadClosed"]);
const RESTRICTION_TYPES = new Set([
  "carriagewayClosures",
  "intermittentShortTermClosures",
  "overnightClosures",
  "laneClosures",
  "narrowLanes",
  "singleAlternateLineTraffic",
  "temporaryTrafficLights",
  "trafficBeingManuallyDirected",
  "trafficHeld",
  "contraflow",
  "lanesDeviated",
  "convoyService",
]);
const QUEUE_TYPES = new Set(["queuingTraffic", "stationaryTraffic", "slowTraffic", "heavyTraffic", "trafficCongestion"]);
const OBSTRUCTION_TYPES = new Set(["brokenDownVehicle", "landslips", "rockfalls", "avalanches", "animalsOnTheRoad", "fallenTrees", "objectOnTheRoad", "flooding"]);

/** Kategori for én situasjonspost fra DATEX (situationType + undertyper). */
export function categorizeRecord(situationType: string | null, secondaryTypes: string[]): Category {
  if (secondaryTypes.some((t) => CLOSURE_TYPES.has(t))) return "closure";
  if (situationType === "Accident") return "accident";
  if (situationType === "AbnormalTraffic" || secondaryTypes.some((t) => QUEUE_TYPES.has(t))) return "queue";
  if (
    situationType?.endsWith("Obstruction") ||
    secondaryTypes.some((t) => OBSTRUCTION_TYPES.has(t))
  ) {
    return "obstruction";
  }
  if (secondaryTypes.some((t) => RESTRICTION_TYPES.has(t))) return "restriction";
  if (situationType === "MaintenanceWorks" || situationType === "ConstructionWorks" || secondaryTypes.includes("roadworks")) {
    return "roadworks";
  }
  if (
    situationType === "WeatherRelatedRoadConditions" ||
    situationType === "NonWeatherRelatedRoadConditions" ||
    situationType === "PoorEnvironmentConditions" ||
    situationType === "WinterDrivingManagement"
  ) {
    return "conditions";
  }
  return "other";
}

/** Velger den mest alvorlige kategorien når en situasjon har flere poster. */
export function mostImportantCategory(categories: Category[]): Category {
  for (const c of CATEGORY_PRIORITY) {
    if (categories.includes(c)) return c;
  }
  return "other";
}

export function severityFromDatex(value: string | null | undefined): number {
  switch (value) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "highest":
      return 4;
    default:
      return 0;
  }
}

export type Activity = "active" | "planned" | "expired";

/**
 * Om hendelsen gjelder nå. Hvis kilden har oppgitt konkrete perioder, brukes
 * de; ellers brukes start- og sluttid. Manglende sluttid betyr "inntil videre".
 */
export function eventActivity(event: Pick<TrafficEvent, "startTime" | "endTime" | "activePeriods">, now: Date): Activity {
  const t = now.getTime();
  if (event.endTime && event.endTime.getTime() <= t) return "expired";
  if (event.activePeriods.length > 0) {
    if (event.activePeriods.some(([s, e]) => s.getTime() <= t && t < e.getTime())) return "active";
    return event.activePeriods.some(([s]) => s.getTime() > t) ? "planned" : "expired";
  }
  if (event.startTime && event.startTime.getTime() > t) return "planned";
  return "active";
}

export function nextPeriodStart(event: Pick<TrafficEvent, "startTime" | "activePeriods">, now: Date): Date | null {
  const t = now.getTime();
  const upcoming = event.activePeriods.map(([s]) => s).filter((s) => s.getTime() > t);
  if (upcoming.length) return new Date(Math.min(...upcoming.map((d) => d.getTime())));
  return event.startTime && event.startTime.getTime() > t ? event.startTime : null;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  closure: "Stengt veg",
  queue: "Kø",
  accident: "Ulykke",
  obstruction: "Hindring i vegbanen",
  restriction: "Trafikkregulering",
  roadworks: "Vegarbeid",
  conditions: "Føreforhold",
  other: "Annen melding",
};
