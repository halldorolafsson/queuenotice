import { config } from "../config.js";
import { distanceM } from "../domain/geo.js";
import { toNvdbRoadFilter } from "../domain/roads.js";
import type { LonLat } from "../domain/types.js";
import { fetchJson } from "./http.js";

/*
 * NVDB API Les v4 (Statens vegvesen). Åpent, men krever X-Client-header.
 * Brukes når en strekning velges og lagres, for å få vegens faktiske geometri.
 */

const headers = () => ({ "X-Client": config.NVDB_CLIENT_ID });

/** Europa-, riks- og fylkesveger. Kommunale og private veger gir for mange snarveier. */
const MAIN_ROADS = "EV,RV,FV";
/** Vegnumre ruten følger kortere enn dette (kryss, ramper) regnes ikke som del av strekningen. */
const MIN_ROAD_LENGTH_M = 300;

interface Vegsystemreferanse {
  vegsystem?: { vegkategori: string; nummer: number };
}
interface Posisjon {
  veglenkesekvens: { kortform: string };
  avstand: number;
  geometri?: { wkt?: string };
  vegsystemreferanse?: Vegsystemreferanse;
}
interface Rute {
  vegnettsrutesegmenter: Array<{ geometri?: { wkt?: string }; lengde?: number; vegsystemreferanse?: Vegsystemreferanse }>;
  metadata: { status: number; status_tekst: string; lengde: number };
}

/** NVDB returnerer "LINESTRING Z (lat lon z, ...)" når srid=4326. */
export function parseWktLatLon(wkt: string): LonLat[] {
  const body = wkt.slice(wkt.indexOf("(") + 1, wkt.lastIndexOf(")"));
  return body
    .split(",")
    .map((t) => t.trim().split(/\s+/).map(Number))
    .filter((n) => n.length >= 2 && n.every((x) => Number.isFinite(x)))
    .map((n) => [n[1]!, n[0]!] as LonLat);
}

/** Setter segmentene sammen og snur dem som peker feil vei. */
export function chainSegments(parts: LonLat[][]): LonLat[] {
  const line: LonLat[] = [];
  let added = 0;
  for (const part of parts) {
    if (part.length === 0) continue;
    added++;
    if (line.length === 0) {
      line.push(...part);
      continue;
    }
    const nearest = (p: LonLat) => Math.min(distanceM(p, part[0]!), distanceM(p, part[part.length - 1]!));
    // Første segment kan peke feil vei; da ligger neste segment nærmest starten.
    if (added === 2 && nearest(line[0]!) < nearest(line[line.length - 1]!)) line.reverse();
    const tail = line[line.length - 1]!;
    const forward = distanceM(tail, part[0]!) <= distanceM(tail, part[part.length - 1]!);
    const ordered = forward ? part : [...part].reverse();
    line.push(...(distanceM(tail, ordered[0]!) < 1 ? ordered.slice(1) : ordered));
  }
  return line;
}

/** "E6", "R706", "F704" eller null for kommunale/private veger. */
export function roadOf(ref: Vegsystemreferanse | undefined): string | null {
  const v = ref?.vegsystem;
  return v && ["E", "R", "F"].includes(v.vegkategori) ? `${v.vegkategori}${v.nummer}` : null;
}

/** Vegnumre ruten følger, lengste først. Korte biter i kryss tas ikke med. */
export function roadsAlong(rute: Rute): string[] {
  const length = new Map<string, number>();
  for (const seg of rute.vegnettsrutesegmenter) {
    const road = roadOf(seg.vegsystemreferanse);
    if (road) length.set(road, (length.get(road) ?? 0) + (seg.lengde ?? 0));
  }
  return [...length]
    .filter(([, m]) => m >= MIN_ROAD_LENGTH_M)
    .sort((a, b) => b[1] - a[1])
    .map(([road]) => road);
}

async function snap(lat: number, lon: number, filter: string): Promise<Posisjon | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    srid: "4326",
    vegsystemreferanse: filter,
    maks_antall: "1",
    maks_avstand: "200",
  });
  const res = await fetchJson<Posisjon[]>(`${config.NVDB_API_URL}/posisjon?${params}`, { headers: headers() });
  return res[0] ?? null;
}

/** Punktet på nærmeste europa-, riks- eller fylkesveg innen 200 m. */
export async function pointOnRoad(
  lat: number,
  lon: number,
): Promise<{ lat: number; lon: number; distanceM: number; road: string | null } | null> {
  const pos = await snap(lat, lon, MAIN_ROADS);
  const p = pos?.geometri?.wkt ? parseWktLatLon(pos.geometri.wkt)[0] : undefined;
  return pos && p ? { lat: p[1], lon: p[0], distanceM: Math.round(pos.avstand), road: roadOf(pos.vegsystemreferanse) } : null;
}

export interface RouteResult {
  geometry: LonLat[];
  source: "nvdb" | "straight";
  note: string | null;
  /** Vegnumre ruten følger, lengste først. Tom når ruten ikke ble funnet. */
  roads: string[];
}

async function rute(s: Posisjon, e: Posisjon, filter: string, omkrets: number): Promise<Rute> {
  const params = new URLSearchParams({
    start: s.veglenkesekvens.kortform,
    slutt: e.veglenkesekvens.kortform,
    srid: "4326",
    vegsystemreferanse: filter,
    omkrets: String(omkrets),
  });
  return fetchJson<Rute>(`${config.NVDB_API_URL}/beta/vegnett/rute?${params}`, { headers: headers(), timeoutMs: 60000 });
}

/**
 * Finner vegen mellom to punkt uten at brukeren oppgir veinummer. Ligger begge
 * punktene på samme veg, følges den vegen; ellers korteste vei på europa-, riks-
 * og fylkesveger. Faller tilbake til rett linje med forklaring ved feil.
 */
export async function routeBetween(start: LonLat, end: LonLat): Promise<RouteResult> {
  const straight = (note: string): RouteResult => ({ geometry: [start, end], source: "straight", note, roads: [] });
  try {
    const [s, e] = await Promise.all([snap(start[1], start[0], MAIN_ROADS), snap(end[1], end[0], MAIN_ROADS)]);
    if (!s || !e) {
      const which = !s && !e ? "start og slutt" : !s ? "start" : "slutt";
      return straight(`Fant ingen europa-, riks- eller fylkesveg innen 200 m fra ${which}. Flytt punktet nærmere vegen.`);
    }
    const omkrets = Math.min(15000, Math.max(1000, Math.round(distanceM(start, end) * 0.6)));
    const sRoad = roadOf(s.vegsystemreferanse);
    let r: Rute | null = null;
    if (sRoad && sRoad === roadOf(e.vegsystemreferanse)) {
      r = await rute(s, e, toNvdbRoadFilter(sRoad), omkrets);
      if (r.metadata.status !== 2000) r = null;
    }
    r ??= await rute(s, e, MAIN_ROADS, omkrets);
    if (r.metadata.status !== 2000) {
      return straight(`NVDB fant ingen sammenhengende rute (${r.metadata.status_tekst}). Bruker rett linje.`);
    }
    let line = chainSegments(r.vegnettsrutesegmenter.map((seg) => parseWktLatLon(seg.geometri?.wkt ?? "")));
    if (line.length > 1 && distanceM(line[0]!, start) > distanceM(line[line.length - 1]!, start)) {
      line = line.reverse();
    }
    if (line.length < 2) return straight("Tom rute fra NVDB. Bruker rett linje.");
    const roads = roadsAlong(r);
    return { geometry: line, source: "nvdb", note: null, roads: roads.length > 0 ? roads : [sRoad].filter((x): x is string => !!x) };
  } catch (err) {
    return straight(`NVDB utilgjengelig (${(err as Error).message}). Bruker rett linje.`);
  }
}
