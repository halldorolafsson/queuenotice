import { describe, expect, it } from "vitest";
import { Polyline } from "../src/domain/geo.js";
import { isDirectionRelevant, matchEvent, matchTravelTime } from "../src/domain/matching.js";
import type { LonLat, TrafficEvent, TravelTime } from "../src/domain/types.js";
import { parseSituationSimple, parseTravelTimeSimple } from "../src/traffic/vegvesenWfs.js";
import { roadsAlong } from "../src/traffic/nvdb.js";
import { e6OkstadRanheim, fixture } from "./helpers.js";

function event(overrides: Partial<TrafficEvent>): TrafficEvent {
  return {
    id: "test:1",
    source: "test",
    sourceId: "1",
    version: "1",
    category: "accident",
    situationType: "Accident",
    secondaryTypes: [],
    severity: 2,
    title: "Test",
    description: "",
    roadNumbers: ["E6"],
    lines: [],
    direction: "both",
    reportedDelayMin: null,
    startTime: null,
    endTime: null,
    activePeriods: [],
    sourceUpdatedAt: null,
    isDemo: false,
    ...overrides,
  };
}

describe("matching mot ekte E6-geometri (Okstadbakken → Ranheim)", () => {
  const segment = e6OkstadRanheim();
  const polyline = new Polyline(segment.geometry);
  const events = parseSituationSimple(fixture("situationSimple.json"));
  const tts = parseTravelTimeSimple(fixture("travelTimeSimple.json"));
  const ev = (id: string) => events.find((e) => e.sourceId === id)!;
  const tt = (name: string) => tts.find((t) => t.name === name)!;

  it("strekningen er omtrent 10,8 km", () => {
    expect(polyline.length).toBeGreaterThan(10_500);
    expect(polyline.length).toBeLessThan(11_100);
  });

  it("vegnumre utledes fra NVDB-ruten", () => {
    expect(roadsAlong(fixture("nvdbRoute_e6_okstad_ranheim.json"))).toEqual(["E6"]);
  });

  it("treffer Grillstadtunnelen nær slutten av strekningen", () => {
    const m = matchEvent(segment, polyline, ev("NPRA_HBT_08-10-2026.148821"));
    expect(m).not.toBeNull();
    expect(m!.fromChainageM).toBeGreaterThan(9000);
  });

  it("treffer ikke E6-hendelser andre steder (Løvåsmyra, Stavsjøfjellet)", () => {
    expect(matchEvent(segment, polyline, ev("NPRA_HBT_15-10-2026.152726"))).toBeNull();
    expect(matchEvent(segment, polyline, ev("NPRA_HBT_15-10-2026.152395"))).toBeNull();
  });

  it("treffer aldri hendelser på annet veinummer", () => {
    expect(matchEvent(segment, polyline, ev("NPRA_HBT_15-10-2026.152579"))).toBeNull();
  });

  it("veinummer alene gir ikke treff: samme veg, men utenfor korridoren", () => {
    const far = event({ lines: [[[10.2, 63.1]]] }); // E6 ved Støren-retning, langt unna
    expect(matchEvent(segment, polyline, far)).toBeNull();
  });

  it("en kryssende veg med annet nummer gir ikke treff selv om den er nær", () => {
    const crossing = event({ roadNumbers: ["R706"], lines: [segment.geometry.slice(100, 110)] });
    expect(matchEvent(segment, polyline, crossing)).toBeNull();
  });

  it("strekning som følger flere veger treffer meldinger på alle vegene", () => {
    const onBoth = { ...segment, roadNumbers: ["E6", "R706"] };
    const crossing = event({ roadNumbers: ["R706"], lines: [segment.geometry.slice(100, 110)] });
    expect(matchEvent(onBoth, polyline, crossing)).not.toBeNull();
  });

  it("strekning uten kjent veinummer matcher bare på geometri", () => {
    const noRoad = { ...segment, roadNumber: "", roadNumbers: [] };
    const crossing = event({ roadNumbers: ["R706"], lines: [segment.geometry.slice(100, 110)] });
    expect(matchEvent(noRoad, polyline, crossing)).not.toBeNull();
  });

  it("reisetid i samme retning gir treff, motsatt retning gir ikke treff for enveis", () => {
    expect(matchTravelTime(segment, polyline, tt("E6 Moholt - E6 Ranheim"))?.direction).toBe("same");
    expect(matchTravelTime(segment, polyline, tt("E6 Ranheim - E6 Moholt"))).toBeNull();
  });

  it("begge retninger tar med motsatt reisetid", () => {
    const both = e6OkstadRanheim({ direction: "both" });
    expect(matchTravelTime(both, polyline, tt("E6 Ranheim - E6 Moholt"))?.direction).toBe("opposite");
  });
});

describe("retningsbestemt matching", () => {
  const line: LonLat[] = [[10.0, 63.0], [10.0, 63.1]]; // ca. 11 km nordover
  const segment = e6OkstadRanheim({ geometry: line });
  const polyline = new Polyline(line);
  const northbound: LonLat[] = [[10.0, 63.02], [10.0, 63.03]];

  it("enveis hendelse i samme retning", () => {
    const m = matchEvent(segment, polyline, event({ direction: "one", lines: [northbound] }));
    expect(m?.direction).toBe("same");
    expect(isDirectionRelevant(segment, m!, false)).toBe(true);
  });

  it("enveis hendelse i motsatt retning er ikke relevant for enveis overvåking", () => {
    const m = matchEvent(segment, polyline, event({ direction: "one", lines: [[...northbound].reverse()] }));
    expect(m?.direction).toBe("opposite");
    expect(isDirectionRelevant(segment, m!, true)).toBe(false);
    expect(isDirectionRelevant({ direction: "both" }, m!, true)).toBe(true);
  });

  it("punkt uten retning følger brukerens valg for ukjent retning", () => {
    const m = matchEvent(segment, polyline, event({ direction: "unknown", lines: [[[10.0005, 63.05]]] }));
    expect(m?.direction).toBe("unknown");
    expect(isDirectionRelevant(segment, m!, true)).toBe(true);
    expect(isDirectionRelevant(segment, m!, false)).toBe(false);
  });

  it("hendelse uten veinummer krever svært kort avstand", () => {
    const near = event({ roadNumbers: [], lines: [[[10.0005, 63.05]]] }); // ca. 25 m
    const nearish = event({ roadNumbers: [], lines: [[[10.003, 63.05]]] }); // ca. 150 m
    expect(matchEvent(segment, polyline, near)).not.toBeNull();
    expect(matchEvent(segment, polyline, nearish)).toBeNull();
  });

  it("hendelse like etter sluttpunktet treffer ikke", () => {
    expect(matchEvent(segment, polyline, event({ lines: [[[10.0, 63.11]]] }))).toBeNull();
  });

  it("lang hendelseslinje med få punkter treffer likevel (fortetting)", () => {
    const longLine: LonLat[] = [[10.0, 62.9], [10.0, 63.2]];
    expect(matchEvent(segment, polyline, event({ lines: [longLine] }))).not.toBeNull();
  });

  it("reisetid som bare overlapper litt gir ikke treff", () => {
    const tt: TravelTime = {
      id: "t", source: "test", name: "x", line: [[10.0, 63.095], [10.0, 63.2]],
      actualSec: 600, expectedSec: 300, delaySec: 300, statusValue: null, measuredAt: null, isDemo: false,
    };
    expect(matchTravelTime(segment, polyline, tt)).toBeNull();
  });

  it("reisetid som svinger av til en annen veg halvveis gir ikke treff", () => {
    const tt: TravelTime = {
      id: "t", source: "test", name: "x", line: [[10.0, 63.02], [10.0, 63.05], [10.1, 63.05]],
      actualSec: 600, expectedSec: 300, delaySec: 300, statusValue: null, measuredAt: null, isDemo: false,
    };
    expect(matchTravelTime(segment, polyline, tt)).toBeNull();
    const along: TravelTime = { ...tt, line: [[10.0, 63.02], [10.0, 63.05]] };
    expect(matchTravelTime(segment, polyline, along)?.direction).toBe("same");
  });
});
