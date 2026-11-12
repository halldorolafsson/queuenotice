import { describe, expect, it } from "vitest";
import { eventActivity } from "../src/domain/events.js";
import { parseActivePeriods, parseSituationSimple, parseTravelTimeSimple, parseVegvesenTime, directionFromAffected, extractAffectedDirections } from "../src/traffic/vegvesenWfs.js";
import { fixture } from "./helpers.js";

// Testdataene er et utsnitt av ekte data fra Vegvesenets WFS hentet 2026-10-15.

describe("parseVegvesenTime", () => {
  it("tolker +0200-format", () => {
    expect(parseVegvesenTime("2026-10-15T19:41:26+0200")?.toISOString()).toBe("2026-10-15T17:41:26.000Z");
  });
  it("tåler tomme og ugyldige verdier", () => {
    expect(parseVegvesenTime(undefined)).toBeNull();
    expect(parseVegvesenTime("tull")).toBeNull();
  });
  it("tolker perioder", () => {
    const p = parseActivePeriods("[2026-10-15T22:00:00+0200,2026-10-16T06:00:00+0200][2026-10-16T22:00:00+0200,2026-10-17T06:00:00+0200]");
    expect(p).toHaveLength(2);
    expect(p[0]![0].toISOString()).toBe("2026-10-15T20:00:00.000Z");
  });
});

describe("parseSituationSimple", () => {
  const events = parseSituationSimple(fixture("situationSimple.json"));
  const byId = (id: string) => events.find((e) => e.sourceId === id)!;

  it("slår sammen poster til én hendelse per situasjon", () => {
    const ids = new Set(events.map((e) => e.sourceId));
    expect(ids.size).toBe(events.length);
    expect(byId("NPRA_HBT_08-10-2026.148821")).toBeDefined();
  });

  it("stengt veg vinner over vegarbeid og omkjøring", () => {
    const e = byId("NPRA_HBT_08-10-2026.148821");
    expect(e.category).toBe("closure");
    expect(e.secondaryTypes).toContain("roadClosed");
    expect(e.secondaryTypes).toContain("followDiversionSigns");
  });

  it("havarert kjøretøy blir hindring, ikke kø", () => {
    expect(byId("NPRA_HBT_15-10-2026.152726").category).toBe("obstruction");
  });

  it("normaliserer veinummer og beholder norsk tekst urørt", () => {
    const e = byId("NPRA_HBT_15-10-2026.152579");
    expect(e.roadNumbers).toEqual(["F714"]);
    expect(e.description).toContain("vegen er stengt");
  });

  it("periodiske stengninger er aktive bare i periodene", () => {
    // «gyldig mellom 22:00 og 06:00 tirsdag fra 13.10.2026 til 28.10.2026»
    const e = byId("NPRA_HBT_08-10-2026.148821");
    expect(e.activePeriods.length).toBeGreaterThan(0);
    expect(eventActivity(e, new Date("2026-10-15T21:00:00Z"))).toBe("planned"); // torsdag 23:00
    expect(eventActivity(e, new Date("2026-10-20T21:00:00Z"))).toBe("active"); // tirsdag 23:00
    expect(eventActivity(e, new Date("2026-10-21T02:00:00Z"))).toBe("active"); // onsdag 04:00
    expect(eventActivity(e, new Date("2026-10-28T06:00:00Z"))).toBe("expired");
  });

  it("utløpt hendelse regnes som utløpt", () => {
    const e = byId("NPRA_HBT_15-10-2026.152726");
    expect(eventActivity(e, new Date("2026-10-15T18:00:00Z"))).toBe("active");
    expect(eventActivity(e, new Date("2026-10-16T10:00:00Z"))).toBe("expired");
  });
});

describe("parseTravelTimeSimple", () => {
  const tts = parseTravelTimeSimple(fixture("travelTimeSimple.json"));

  it("skiller mellom manglende og målt reisetid", () => {
    const missing = tts.find((t) => t.name === "E6 Okstadbakken - E6 Sluppenrampene")!;
    const measured = tts.find((t) => t.name === "E6 Moholt - E6 Ranheim")!;
    expect(missing.delaySec).toBeNull();
    expect(missing.actualSec).toBeNull();
    expect(measured.actualSec).toBe(209);
    expect(measured.delaySec).toBe(-31);
  });
});

describe("kjøreretning fra full DATEX", () => {
  it("finner alertCAffectedDirection på alle nivå", () => {
    const doc = { a: [{ b: { alertCAffectedDirection: { value: "both" } } }, { alertCAffectedDirection: { value: "aligned" } }] };
    expect(extractAffectedDirections(doc)).toEqual(["both", "aligned"]);
  });
  it("tolker verdiene", () => {
    expect(directionFromAffected(["both", "aligned"])).toBe("both");
    expect(directionFromAffected(["aligned"])).toBe("one");
    expect(directionFromAffected([])).toBe("unknown");
  });
});
