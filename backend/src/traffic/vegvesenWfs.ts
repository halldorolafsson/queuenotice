import { config } from "../config.js";
import { categorizeRecord, mostImportantCategory, severityFromDatex } from "../domain/events.js";
import { normalizeRoadNumber } from "../domain/roads.js";
import type { Category, EventDirection, LonLat, TrafficEvent, TravelTime } from "../domain/types.js";
import { fetchJson } from "./http.js";
import type { SourceSnapshot, TrafficSource } from "./types.js";

/*
 * Statens vegvesen DATEX II 3.1 via åpen WFS (GeoJSON). Krever ingen nøkkel.
 * Lisens: NLOD. Kilde skal oppgis, og norske meldinger skal ikke oversettes.
 * Dokumentasjon: git.vegvesen.no/projects/DATEX2/repos/datex2-spesifications/browse/3.1/wfs-wms
 */

interface Geometry {
  type: string;
  coordinates: unknown;
}
interface Feature<P> {
  geometry: Geometry | null;
  properties: P;
}
interface FeatureCollection<P> {
  features: Feature<P>[];
}

interface SituationSimpleProps {
  situationId: string;
  recordId: string;
  version?: number;
  isMainRecord?: boolean;
  situationType?: string;
  secondaryTypes?: string;
  severity?: string;
  roadNumber?: string;
  locationDescription?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  activePeriods?: string;
  impactDelayTime?: number;
  lastUpdateTime?: string;
}

interface TravelTimeSimpleProps {
  recordId: string;
  locationDescription?: string;
  actualTime?: number | null;
  expectedTime?: number | null;
  delayedTime?: number | null;
  trafficStatusValue?: string;
  missingData?: boolean;
  validAtTime?: string;
}

/** Vegvesenet bruker "+0200"; JavaScript krever "+02:00". */
export function parseVegvesenTime(value: string | undefined | null): Date | null {
  if (!value) return null;
  const iso = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseActivePeriods(value: string | undefined): Array<[Date, Date]> {
  if (!value) return [];
  const out: Array<[Date, Date]> = [];
  for (const m of value.matchAll(/\[([^,\]]+),([^\]]+)\]/g)) {
    const s = parseVegvesenTime(m[1]);
    const e = parseVegvesenTime(m[2]);
    if (s && e) out.push([s, e]);
  }
  return out;
}

function isLonLat(v: unknown): v is LonLat {
  return Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number";
}

export function geometryToLines(g: Geometry | null): LonLat[][] {
  if (!g) return [];
  const c = g.coordinates as unknown;
  const clean = (line: unknown[]): LonLat[] => line.filter(isLonLat).map(([lon, lat]) => [lon, lat]);
  switch (g.type) {
    case "Point":
      return isLonLat(c) ? [[[c[0], c[1]]]] : [];
    case "LineString":
    case "MultiPoint":
      return Array.isArray(c) ? [clean(c)] : [];
    case "MultiLineString":
      return Array.isArray(c) ? (c as unknown[][]).map(clean).filter((l) => l.length > 0) : [];
    default:
      return [];
  }
}

function maxDate(dates: Array<Date | null>): Date | null {
  const valid = dates.filter((d): d is Date => d !== null);
  return valid.length ? new Date(Math.max(...valid.map((d) => d.getTime()))) : null;
}
function minDate(dates: Array<Date | null>): Date | null {
  const valid = dates.filter((d): d is Date => d !== null);
  return valid.length ? new Date(Math.min(...valid.map((d) => d.getTime()))) : null;
}

/**
 * SituationSimple har én feature per situasjonspost. Vi slår sammen postene til
 * én hendelse per situasjon og velger den mest alvorlige kategorien.
 */
export function parseSituationSimple(fc: FeatureCollection<SituationSimpleProps>): TrafficEvent[] {
  const groups = new Map<string, Feature<SituationSimpleProps>[]>();
  for (const f of fc.features) {
    const id = f.properties?.situationId;
    if (!id) continue;
    const list = groups.get(id) ?? [];
    list.push(f);
    groups.set(id, list);
  }

  const events: TrafficEvent[] = [];
  for (const [situationId, records] of groups) {
    const main = records.find((r) => r.properties.isMainRecord) ?? records[0]!;
    const p = main.properties;
    const categories: Category[] = [];
    const secondary = new Set<string>();
    const roads = new Set<string>();
    const lineKeys = new Set<string>();
    const lines: LonLat[][] = [];
    const periodKeys = new Set<string>();
    const periods: Array<[Date, Date]> = [];
    let severity = 0;
    let delaySec: number | null = null;
    let version = 0;

    for (const r of records) {
      const rp = r.properties;
      const types = (rp.secondaryTypes ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      types.forEach((t) => secondary.add(t));
      categories.push(categorizeRecord(rp.situationType ?? null, types));
      severity = Math.max(severity, severityFromDatex(rp.severity));
      version = Math.max(version, rp.version ?? 0);
      const road = rp.roadNumber ? normalizeRoadNumber(rp.roadNumber) : null;
      if (road) roads.add(road);
      if (typeof rp.impactDelayTime === "number" && rp.impactDelayTime > 0) {
        delaySec = Math.max(delaySec ?? 0, rp.impactDelayTime);
      }
      for (const line of geometryToLines(r.geometry)) {
        const key = JSON.stringify(line);
        if (!lineKeys.has(key)) {
          lineKeys.add(key);
          lines.push(line);
        }
      }
      for (const period of parseActivePeriods(rp.activePeriods)) {
        const key = `${period[0].getTime()}-${period[1].getTime()}`;
        if (!periodKeys.has(key)) {
          periodKeys.add(key);
          periods.push(period);
        }
      }
    }
    if (lines.length === 0) continue;

    const updatedAt = maxDate(records.map((r) => parseVegvesenTime(r.properties.lastUpdateTime)));
    events.push({
      id: `vegvesen:${situationId}`,
      source: "vegvesen",
      sourceId: situationId,
      version: `${version}:${updatedAt?.toISOString() ?? ""}`,
      category: mostImportantCategory(categories),
      situationType: p.situationType ?? null,
      secondaryTypes: [...secondary],
      severity,
      title: p.locationDescription ?? "Ukjent sted",
      description: p.description ?? "",
      roadNumbers: [...roads],
      lines,
      direction: "unknown",
      reportedDelayMin: delaySec === null ? null : Math.round(delaySec / 60),
      startTime: minDate(records.map((r) => parseVegvesenTime(r.properties.startTime))),
      endTime: maxDate(records.map((r) => parseVegvesenTime(r.properties.endTime))),
      activePeriods: periods.sort((a, b) => a[0].getTime() - b[0].getTime()),
      sourceUpdatedAt: updatedAt,
      isDemo: false,
    });
  }
  return events;
}

export function parseTravelTimeSimple(fc: FeatureCollection<TravelTimeSimpleProps>): TravelTime[] {
  const out: TravelTime[] = [];
  for (const f of fc.features) {
    const p = f.properties;
    if (!p?.recordId) continue;
    const line = geometryToLines(f.geometry).flat();
    if (line.length < 2) continue;
    const hasData = !p.missingData && typeof p.actualTime === "number";
    out.push({
      id: `vegvesen:tt:${p.recordId}`,
      source: "vegvesen",
      name: p.locationDescription ?? `Reisetid ${p.recordId}`,
      line,
      actualSec: hasData ? p.actualTime! : null,
      expectedSec: typeof p.expectedTime === "number" ? p.expectedTime : null,
      delaySec: hasData && typeof p.delayedTime === "number" ? p.delayedTime : null,
      statusValue: p.trafficStatusValue ?? null,
      measuredAt: parseVegvesenTime(p.validAtTime),
      isDemo: false,
    });
  }
  return out;
}

/** Leter etter alertCAffectedDirection i full DATEX-struktur, uansett nivå. */
export function extractAffectedDirections(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => extractAffectedDirections(n, found));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "alertCAffectedDirection" && value && typeof value === "object" && "value" in value) {
        found.push(String((value as { value: unknown }).value));
      } else {
        extractAffectedDirections(value, found);
      }
    }
  }
  return found;
}

export function directionFromAffected(values: string[]): EventDirection {
  if (values.length === 0) return "unknown";
  if (values.includes("both")) return "both";
  if (values.every((v) => v === "aligned" || v === "opposite" || v === "positive" || v === "negative")) return "one";
  return "unknown";
}

const SAFE_ID = /^[A-Za-z0-9_.:-]+$/;

export class VegvesenWfsSource implements TrafficSource {
  readonly id = "vegvesen";
  readonly name = "Statens vegvesen";
  readonly isDemo = false;

  private url(typeName: string, extra: Record<string, string>): string {
    const params = new URLSearchParams({
      service: "WFS",
      version: "1.0.0",
      request: "GetFeature",
      outputFormat: "application/json",
      typeName: `datex_3_1:${typeName}`,
      ...extra,
    });
    return `${config.VEGVESEN_WFS_URL}?${params}`;
  }

  async fetchSnapshot(): Promise<SourceSnapshot> {
    const bbox = { bbox: config.VEGVESEN_BBOX };
    const [situations, travelTimes] = await Promise.all([
      fetchJson<FeatureCollection<SituationSimpleProps>>(this.url("SituationSimple", bbox)),
      fetchJson<FeatureCollection<TravelTimeSimpleProps>>(this.url("TravelTimeSimple", bbox)),
    ]);
    if (!Array.isArray(situations?.features) || !Array.isArray(travelTimes?.features)) {
      throw new Error("Uventet svar fra Vegvesenets WFS (mangler features)");
    }
    return {
      events: parseSituationSimple(situations),
      travelTimes: parseTravelTimeSimple(travelTimes),
      fetchedAt: new Date(),
    };
  }

  async lookupDirection(situationId: string): Promise<EventDirection> {
    if (!SAFE_ID.test(situationId)) return "unknown";
    const fc = await fetchJson<FeatureCollection<unknown>>(
      this.url("Situation", { CQL_FILTER: `recordId='${situationId}'` }),
      { retries: 1 },
    );
    return directionFromAffected(extractAffectedDirections(fc.features ?? []));
  }
}
