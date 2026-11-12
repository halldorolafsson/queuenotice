import { densify, Polyline } from "./geo.js";
import type { LonLat, Segment, TrafficEvent, TravelTime } from "./types.js";

export type DirectionMatch = "same" | "opposite" | "both" | "unknown";

export interface EventMatch {
  eventId: string;
  distanceM: number;
  /** Hvor langs strekningen hendelsen er, i meter fra startpunktet. */
  fromChainageM: number;
  toChainageM: number;
  direction: DirectionMatch;
}

export interface TravelTimeMatch {
  travelTimeId: string;
  overlapM: number;
  direction: "same" | "opposite";
}

const SAMPLE_STEP_M = 50;
const MIN_DIRECTION_DELTA_M = 30;
/** Uten veinummer på hendelsen kreves det at den ligger svært nær strekningen. */
const NO_ROAD_BUFFER_M = 75;
const MIN_TRAVEL_TIME_OVERLAP = 0.8;

interface Inside {
  chainage: number;
  distance: number;
}

function insidePoints(polyline: Polyline, points: LonLat[], buffer: number): Inside[] {
  const out: Inside[] = [];
  for (const p of points) {
    if (!polyline.nearBBox(p, buffer)) continue;
    const pr = polyline.project(p);
    if (pr.distance <= buffer) out.push(pr);
  }
  return out;
}

function directionFrom(inside: Inside[]): "same" | "opposite" | "unknown" {
  if (inside.length < 2) return "unknown";
  const delta = inside[inside.length - 1]!.chainage - inside[0]!.chainage;
  if (Math.abs(delta) < MIN_DIRECTION_DELTA_M) return "unknown";
  return delta > 0 ? "same" : "opposite";
}

/**
 * Finner ut om en hendelse ligger på strekningen.
 *
 * Krav: et felles veinummer (når begge oppgir det) og minst ett punkt innenfor
 * korridoren rundt strekningen. Retning avgjøres bare når kilden sier at én
 * retning er berørt; da antas linjens punktrekkefølge å følge kjøreretningen.
 */
export function matchEvent(segment: Segment, polyline: Polyline, event: TrafficEvent): EventMatch | null {
  const roads = segment.roadNumbers?.length ? segment.roadNumbers : segment.roadNumber ? [segment.roadNumber] : [];
  if (event.roadNumbers.length > 0 && roads.length > 0 && !event.roadNumbers.some((r) => roads.includes(r))) return null;
  const buffer = event.roadNumbers.length > 0 ? segment.bufferM : Math.min(segment.bufferM, NO_ROAD_BUFFER_M);

  let all: Inside[] = [];
  let direction: DirectionMatch = event.direction === "both" ? "both" : "unknown";
  for (const line of event.lines) {
    const inside = insidePoints(polyline, densify(line, SAMPLE_STEP_M), buffer);
    if (inside.length === 0) continue;
    all = all.concat(inside);
    if (event.direction === "one" && direction === "unknown") direction = directionFrom(inside);
  }
  if (all.length === 0) return null;

  const chainages = all.map((i) => i.chainage);
  return {
    eventId: event.id,
    distanceM: Math.round(Math.min(...all.map((i) => i.distance))),
    fromChainageM: Math.round(Math.min(...chainages)),
    toChainageM: Math.round(Math.max(...chainages)),
    direction,
  };
}

/**
 * En reisetidsstrekning teller når minst 80 % av den korteste av de to linjene
 * overlapper, slik at målinger som svinger av til andre veger ikke tas med.
 * Den må også gå i samme retning, med mindre begge retninger overvåkes.
 */
export function matchTravelTime(segment: Segment, polyline: Polyline, tt: TravelTime): TravelTimeMatch | null {
  if (tt.line.length < 2) return null;
  if (!tt.line.some((p) => polyline.nearBBox(p, segment.bufferM))) return null;
  const points = densify(tt.line, SAMPLE_STEP_M);
  const projected = points.map((p) => polyline.project(p));
  const ttLine = new Polyline(points);

  let overlap = 0;
  const inside: Inside[] = [];
  for (let i = 0; i < projected.length; i++) {
    const cur = projected[i]!;
    if (cur.distance > segment.bufferM) continue;
    inside.push(cur);
    const prev = projected[i - 1];
    if (prev && prev.distance <= segment.bufferM) {
      overlap += ttLine.cumulative[i]! - ttLine.cumulative[i - 1]!;
    }
  }
  if (overlap < 100 || overlap < MIN_TRAVEL_TIME_OVERLAP * Math.min(ttLine.length, polyline.length)) return null;

  const dir = directionFrom(inside);
  if (dir === "unknown") return null;
  if (segment.direction === "forward" && dir === "opposite") return null;
  return { travelTimeId: tt.id, overlapM: Math.round(overlap), direction: dir };
}

/** Om en treff skal regnes som relevant gitt strekningens retning og brukerens valg. */
export function isDirectionRelevant(
  segment: Pick<Segment, "direction">,
  match: Pick<EventMatch, "direction">,
  includeUnknown: boolean,
): boolean {
  if (segment.direction === "both") return true;
  if (match.direction === "opposite") return false;
  if (match.direction === "unknown") return includeUnknown;
  return true;
}
