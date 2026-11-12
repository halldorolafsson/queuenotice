import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Category } from "../src/domain/types.js";
import { analyzeSegment } from "../src/services/analyze.js";
import { DemoSource } from "../src/traffic/demoSource.js";
import { e6OkstadRanheim } from "./helpers.js";

const now = new Date("2026-10-17T08:00:00Z");

async function analyze(eventTypes: Category[]) {
  const snap = await new DemoSource().fetchSnapshot(now);
  return analyzeSegment({
    segment: e6OkstadRanheim(),
    listActive: true,
    schedule: [],
    settings: { ...DEFAULT_SETTINGS, eventTypes },
    events: snap.events,
    travelTimes: snap.travelTimes ?? [],
    sourceStatuses: [{ source: "demo", lastAttemptAt: now, lastSuccessAt: now, lastError: null, lastErrorAt: null, consecutiveFailures: 0, lastItemCount: 2, isDemo: true }],
    enabledSources: ["demo"],
    now,
    staleAfterMin: 15,
  });
}

describe("typer brukeren følger", () => {
  it("merker meldinger etter valgte typer, men viser alle", async () => {
    const a = await analyze(["accident"]);
    expect(a.events).toHaveLength(2);
    expect(a.events.find((e) => e.event.category === "accident")?.followed).toBe(true);
    expect(a.events.find((e) => e.event.category === "queue")?.followed).toBe(false);
    expect(a.status).toBe("incident");
  });

  it("status bygger bare på fulgte typer; målt kø teller bare når kø er valgt", async () => {
    const a = await analyze(["closure"]);
    expect(a.events).toHaveLength(2);
    expect(a.events.every((e) => !e.followed)).toBe(true);
    expect(a.status).toBe("no_events");
  });

  it("målt forsinkelse over terskel gir hendelse når kø er valgt", async () => {
    expect((await analyze(["queue"])).status).toBe("incident");
  });
});
