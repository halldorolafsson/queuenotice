import { config } from "../config.js";
import { Polyline } from "../domain/geo.js";
import type { LonLat, Segment, TravelTime } from "../domain/types.js";
import { fetchJson } from "./http.js";
import type { MonitoredSegment, SourceContext, SourceSnapshot, TrafficSource } from "./types.js";

/*
 * Google Maps Platform Routes API (computeRoutes, TRAFFIC_AWARE).
 * Betalt: faktureres som «Routes: Compute Routes Pro». Gir estimert reisetid med
 * sanntidstrafikk (duration) og normal reisetid (staticDuration) for en rute.
 * Gir ikke hendelser som ulykker eller stengninger.
 */

export interface GoogleRoutesOptions {
  apiKey: string;
  url: string;
  minIntervalMin: number;
  maxPerDay: number;
  maxPerMonth: number;
  requireSchedule: boolean;
}

interface ComputeRoutesResponse {
  routes?: Array<{ distanceMeters?: number; duration?: string; staticDuration?: string }>;
}

const MAX_VIA_POINTS = 8;
/** Ruten regnes som avvikende når den er så mye lengre enn strekningen. */
const OFF_ROUTE_FACTOR = 1.25;

export class QuotaExceededError extends Error {}

function seconds(d: string | undefined): number | null {
  if (!d) return null;
  const m = d.match(/^(\d+(?:\.\d+)?)s$/);
  return m ? Math.round(Number(m[1])) : null;
}

const latLng = ([lon, lat]: LonLat) => ({ location: { latLng: { latitude: lat, longitude: lon } } });

/** Mellompunkter langs vegen slik at Google må følge strekningen, ikke en annen veg. */
export function viaPoints(geometry: LonLat[]): LonLat[] {
  if (geometry.length <= 2) return [];
  const line = new Polyline(geometry);
  const count = Math.min(MAX_VIA_POINTS, Math.floor(line.length / 3000));
  const out: LonLat[] = [];
  for (let i = 1; i <= count; i++) {
    const target = (line.length * i) / (count + 1);
    const idx = line.cumulative.findIndex((c) => c >= target);
    out.push(geometry[Math.max(0, idx)]!);
  }
  return out;
}

export function buildRequest(geometry: LonLat[]) {
  return {
    origin: latLng(geometry[0]!),
    destination: latLng(geometry[geometry.length - 1]!),
    intermediates: viaPoints(geometry).map((p) => ({ ...latLng(p), via: true })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    languageCode: "nb",
    units: "METRIC",
  };
}

export function travelTimeId(segmentId: string, direction: "same" | "opposite"): string {
  return `google:tt:${segmentId}:${direction === "same" ? "fwd" : "rev"}`;
}

export function parseResponse(
  res: ComputeRoutesResponse,
  segment: Segment,
  direction: "same" | "opposite",
  geometry: LonLat[],
  now: Date,
): TravelTime {
  const route = res.routes?.[0];
  const expectedLength = new Polyline(geometry).length;
  const actual = seconds(route?.duration);
  const expected = seconds(route?.staticDuration);
  const offRoute = !!route?.distanceMeters && route.distanceMeters > expectedLength * OFF_ROUTE_FACTOR + 500;
  const valid = !!route && actual !== null && expected !== null && !offRoute;
  const from = direction === "same" ? segment.startName : segment.endName;
  const to = direction === "same" ? segment.endName : segment.startName;
  return {
    id: travelTimeId(segment.id, direction),
    source: "google",
    name: `${from} – ${to} (Google Maps)`,
    line: geometry,
    actualSec: valid ? actual : null,
    expectedSec: valid ? expected : null,
    delaySec: valid ? actual! - expected! : null,
    statusValue: !route ? "no_route" : offRoute ? "off_route" : "ok",
    measuredAt: now,
    isDemo: false,
    kind: "estimated",
    segmentId: segment.id,
    segmentDirection: direction,
  };
}

/** Hvilke strekninger og retninger som skal spørres nå, i prioritert rekkefølge. */
export function dueRequests(
  monitored: MonitoredSegment[],
  ctx: Pick<SourceContext, "lastMeasured">,
  now: Date,
  opts: Pick<GoogleRoutesOptions, "minIntervalMin" | "requireSchedule">,
): Array<{ segment: Segment; direction: "same" | "opposite" }> {
  const out: Array<{ segment: Segment; direction: "same" | "opposite"; last: number }> = [];
  for (const m of monitored) {
    if (!m.activeNow || m.segment.geometry.length < 2) continue;
    if (opts.requireSchedule && !m.hasSchedule) continue;
    const directions: Array<"same" | "opposite"> = m.segment.direction === "both" ? ["same", "opposite"] : ["same"];
    for (const direction of directions) {
      const last = ctx.lastMeasured(travelTimeId(m.segment.id, direction));
      if (last && now.getTime() - last.getTime() < opts.minIntervalMin * 60000 - 30000) continue;
      out.push({ segment: m.segment, direction, last: last?.getTime() ?? 0 });
    }
  }
  return out.sort((a, b) => a.last - b.last).map(({ segment, direction }) => ({ segment, direction }));
}

export class GoogleRoutesSource implements TrafficSource {
  readonly id = "google";
  readonly name = "Google Maps";
  readonly isDemo = false;

  constructor(private readonly opts: GoogleRoutesOptions) {}

  async fetchSnapshot(now: Date, ctx: SourceContext): Promise<SourceSnapshot> {
    const due = dueRequests(ctx.monitored, ctx, now, this.opts);
    const usedToday = await ctx.usage.today();
    const usedMonth = await ctx.usage.thisMonth();
    const allowed = Math.max(0, Math.min(this.opts.maxPerDay - usedToday, this.opts.maxPerMonth - usedMonth));
    if (due.length > 0 && allowed === 0) {
      throw new QuotaExceededError(
        `Kvoten for Google Routes er brukt opp (${usedToday}/${this.opts.maxPerDay} i dag, ${usedMonth}/${this.opts.maxPerMonth} denne måneden)`,
      );
    }

    const travelTimes: TravelTime[] = [];
    const errors: string[] = [];
    for (const { segment, direction } of due.slice(0, allowed)) {
      const geometry = direction === "same" ? segment.geometry : [...segment.geometry].reverse();
      // Telles før kallet, slik at feilede kall også regnes med i kvoten.
      await ctx.usage.record(1);
      try {
        const res = await fetchJson<ComputeRoutesResponse>(this.opts.url, {
          method: "POST",
          body: buildRequest(geometry),
          headers: {
            "X-Goog-Api-Key": this.opts.apiKey,
            "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
          },
          retries: 1,
        });
        travelTimes.push(parseResponse(res, segment, direction, geometry, now));
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    if (errors.length > 0 && travelTimes.length === 0) throw new Error(errors[0]);
    return { events: [], travelTimes, partialTravelTimes: true, fetchedAt: now };
  }
}

export function createGoogleRoutesSource(): GoogleRoutesSource {
  if (!config.GOOGLE_ROUTES_API_KEY) {
    throw new Error("TRAFFIC_SOURCES inneholder google, men GOOGLE_ROUTES_API_KEY mangler");
  }
  return new GoogleRoutesSource({
    apiKey: config.GOOGLE_ROUTES_API_KEY,
    url: config.GOOGLE_ROUTES_URL,
    minIntervalMin: config.GOOGLE_ROUTES_MIN_INTERVAL_MINUTES,
    maxPerDay: config.GOOGLE_ROUTES_MAX_CALLS_PER_DAY,
    maxPerMonth: config.GOOGLE_ROUTES_MAX_CALLS_PER_MONTH,
    requireSchedule: config.GOOGLE_ROUTES_REQUIRE_SCHEDULE,
  });
}
