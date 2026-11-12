/** [lengdegrad, breddegrad] i WGS84, samme rekkefølge som GeoJSON. */
export type LonLat = [number, number];

export type Category =
  | "closure"
  | "queue"
  | "accident"
  | "obstruction"
  | "restriction"
  | "roadworks"
  | "conditions"
  | "other";

export const ALL_CATEGORIES: Category[] = [
  "closure",
  "queue",
  "accident",
  "obstruction",
  "restriction",
  "roadworks",
  "conditions",
  "other",
];

/** "one" betyr at kilden sier at bare én kjøreretning er berørt. */
export type EventDirection = "both" | "one" | "unknown";

export interface TrafficEvent {
  id: string;
  source: string;
  sourceId: string;
  version: string;
  category: Category;
  situationType: string | null;
  secondaryTypes: string[];
  /** 0 = ingen/ukjent, 1 = lav, 2 = middels, 3 = høy, 4 = høyest. */
  severity: number;
  title: string;
  description: string;
  roadNumbers: string[];
  /** Ett eller flere linjestykker. Et punkt lagres som linje med ett punkt. */
  lines: LonLat[][];
  direction: EventDirection;
  /** Forsinkelse oppgitt av kilden (estimat), ikke målt. */
  reportedDelayMin: number | null;
  startTime: Date | null;
  endTime: Date | null;
  activePeriods: Array<[Date, Date]>;
  sourceUpdatedAt: Date | null;
  isDemo: boolean;
}

export interface TravelTime {
  id: string;
  source: string;
  name: string;
  line: LonLat[];
  actualSec: number | null;
  expectedSec: number | null;
  delaySec: number | null;
  statusValue: string | null;
  measuredAt: Date | null;
  isDemo: boolean;
  /** "measured" = målt (Vegvesenet), "estimated" = modellberegnet (Google). Standard: measured. */
  kind?: "measured" | "estimated";
  /** Satt når reisetiden er beregnet for én bestemt strekning, ikke matchet geografisk. */
  segmentId?: string | null;
  segmentDirection?: "same" | "opposite" | null;
}

export type SegmentDirection = "forward" | "both";

export interface Segment {
  id: string;
  listId: string;
  name: string;
  roadNumber: string;
  /** Alle vegnumre strekningen følger. Mangler/tom: bruk roadNumber, eller bare geometri hvis den også er tom. */
  roadNumbers?: string[];
  startName: string;
  endName: string;
  direction: SegmentDirection;
  bufferM: number;
  geometry: LonLat[];
  geometrySource: "nvdb" | "straight";
  active: boolean;
}

export interface ScheduleRule {
  /** 1 = mandag ... 7 = søndag. */
  days: number[];
  /** "HH:MM" i Europe/Oslo. */
  from: string;
  to: string;
}

export interface NotificationSettings {
  pushEnabled: boolean;
  emailEnabled: boolean;
  email: string | null;
  eventTypes: Category[];
  delayThresholdMin: number;
  notifyOnResolved: boolean;
  includeUnknownDirection: boolean;
  /** Kilder brukeren har slått av. Kilder som ikke står her, brukes. */
  disabledSources: string[];
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  pushEnabled: false,
  emailEnabled: false,
  email: null,
  eventTypes: ["closure", "queue", "accident", "obstruction", "restriction"],
  delayThresholdMin: 10,
  notifyOnResolved: true,
  includeUnknownDirection: true,
  disabledSources: [],
};
