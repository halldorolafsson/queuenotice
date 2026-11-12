import { readFileSync } from "node:fs";
import { chainSegments, parseWktLatLon } from "../src/traffic/nvdb.js";
import type { Segment } from "../src/domain/types.js";

export const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

/** Ekte NVDB-geometri for E6 Okstadbakken → Ranheim (hentet 2026-10-15). */
export function e6OkstadRanheim(overrides: Partial<Segment> = {}): Segment {
  const route = fixture("nvdbRoute_e6_okstad_ranheim.json");
  const geometry = chainSegments(
    route.vegnettsrutesegmenter.map((s: { geometri: { wkt: string } }) => parseWktLatLon(s.geometri.wkt)),
  );
  return {
    id: "seg-1",
    listId: "list-1",
    name: "Okstadbakken – Ranheim",
    roadNumber: "E6",
    startName: "Okstadbakken",
    endName: "Ranheim",
    direction: "forward",
    bufferM: 300,
    geometry,
    geometrySource: "nvdb",
    active: true,
    ...overrides,
  };
}
