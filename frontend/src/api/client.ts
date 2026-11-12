export type Category =
  | "closure"
  | "queue"
  | "accident"
  | "obstruction"
  | "restriction"
  | "roadworks"
  | "conditions"
  | "other";

export const CATEGORY_LABELS: Record<Category, string> = {
  closure: "Stengt veg",
  queue: "Kø og forsinkelse",
  accident: "Ulykke",
  obstruction: "Hindring i vegbanen",
  restriction: "Trafikkregulering (felt stengt, lysregulering, kolonne)",
  roadworks: "Vegarbeid",
  conditions: "Føreforhold",
  other: "Andre meldinger",
};

export interface ScheduleRule {
  days: number[];
  from: string;
  to: string;
}

export interface Place {
  name: string;
  description?: string;
  lat: number;
  lon: number;
  /** Satt når punktet er valgt i kartet: om det ble festet til en hovedveg. */
  onRoad?: boolean | null;
}

export interface RoutePreview {
  /** [lon, lat]-par langs vegen. */
  geometry: [number, number][];
  source: "nvdb" | "straight";
  note: string | null;
  /** Vegnumre ruten følger, lengste først. */
  roads: string[];
}

export interface SegmentSummary {
  id: string;
  listId: string;
  name: string;
  roadNumber: string;
  roadNumbers?: string[];
  startName: string;
  startLat: number;
  startLon: number;
  endName: string;
  endLat: number;
  endLon: number;
  direction: "forward" | "both";
  bufferM: number;
  geometrySource: "nvdb" | "straight";
  geometryNote: string | null;
  active: boolean;
}

export interface WatchList {
  id: string;
  name: string;
  active: boolean;
  schedule: ScheduleRule[];
  segments: SegmentSummary[];
}

export type Freshness = "fresh" | "stale" | "error" | "never";
export type SegmentStatus = "paused" | "incident" | "no_events" | "stale" | "error" | "no_data";

export interface OverviewEvent {
  id: string;
  category: Category;
  categoryLabel: string;
  title: string;
  description: string[];
  severity: number;
  direction: "same" | "opposite" | "both" | "unknown";
  relevant: boolean;
  followed: boolean;
  reportedDelayMin: number | null;
  startTime: string | null;
  endTime: string | null;
  nextStart: string | null;
  hasPeriods: boolean;
  updatedAt: string | null;
  source: string;
  sourceName: string;
  isDemo: boolean;
  alsoReportedBy: string[];
  positionKm: number;
}

export interface OverviewTravelTime {
  id: string;
  name: string;
  direction: "same" | "opposite";
  actualMin: number | null;
  expectedMin: number | null;
  delayMin: number | null;
  statusValue: string | null;
  measuredAt: string | null;
  fresh: boolean;
  isDemo: boolean;
  kind: "measured" | "estimated";
}

export interface OverviewSegment {
  id: string;
  name: string;
  roadNumber: string;
  roadNumbers: string[];
  startName: string;
  endName: string;
  direction: "forward" | "both";
  active: boolean;
  geometrySource: "nvdb" | "straight";
  geometryNote: string | null;
  status: SegmentStatus;
  inWindow: boolean;
  measuredDelayMin: number | null;
  measuredDelayIsDemo: boolean;
  estimatedDelayMin: number | null;
  usesDemoData: boolean;
  events: OverviewEvent[];
  plannedEvents: OverviewEvent[];
  travelTimes: OverviewTravelTime[];
}

export interface Overview {
  generatedAt: string;
  notifyMode: "dry-run" | "live";
  staleAfterMinutes: number;
  lastPoll: { startedAt: string; finishedAt: string | null; error: string | null } | null;
  sources: Array<{
    id: string;
    name: string;
    isDemo: boolean;
    disabledByUser: boolean;
    freshness: Freshness;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
    itemCount: number | null;
  }>;
  lists: Array<{ id: string; name: string; active: boolean; schedule: ScheduleRule[]; segments: OverviewSegment[] }>;
}

export interface NotificationSettings {
  pushEnabled: boolean;
  emailEnabled: boolean;
  email: string | null;
  eventTypes: Category[];
  delayThresholdMin: number;
  notifyOnResolved: boolean;
  includeUnknownDirection: boolean;
  disabledSources: string[];
}

export interface NotificationLogEntry {
  id: string;
  kind: "new" | "update" | "resolved" | "test";
  channel: "push" | "email" | "none";
  status: "dry_run" | "sent" | "failed" | "skipped";
  title: string;
  body: string;
  error: string | null;
  isDemo: boolean;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: Array<{ field: string; message: string }>) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "x-kv-client": "web", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/auth/")) {
    window.dispatchEvent(new Event("kv:unauthorized"));
  }
  if (!res.ok) {
    const details = (data as { details?: Array<{ field: string; message: string }> }).details;
    const message = (data as { error?: string }).error ?? `Feil ${res.status}`;
    throw new ApiError(details?.length ? `${message}: ${details.map((d) => d.message).join(", ")}` : message, res.status, details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => call<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => call<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => call<T>("PATCH", path, body),
  del: (path: string) => call<void>("DELETE", path),
};
