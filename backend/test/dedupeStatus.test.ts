import { describe, expect, it } from "vitest";
import { groupDuplicates } from "../src/domain/dedupe.js";
import { freshness, segmentStatus } from "../src/domain/status.js";
import type { TrafficEvent } from "../src/domain/types.js";

function ev(id: string, source: string, lonLat: [number, number], overrides: Partial<TrafficEvent> = {}): TrafficEvent {
  return {
    id, source, sourceId: id, version: "1", category: "accident", situationType: null, secondaryTypes: [], severity: 2,
    title: id, description: "", roadNumbers: ["E6"], lines: [[lonLat]], direction: "both", reportedDelayMin: null,
    startTime: new Date("2026-10-15T10:00:00Z"), endTime: null, activePeriods: [], sourceUpdatedAt: null, isDemo: false,
    ...overrides,
  };
}

describe("groupDuplicates", () => {
  it("slår sammen samme ulykke fra to kilder og foretrekker Vegvesenet", () => {
    const groups = groupDuplicates([ev("p", "politiet", [10.4, 63.4]), ev("v", "vegvesen", [10.401, 63.4005])]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.primary.source).toBe("vegvesen");
    expect(groups[0]!.duplicates.map((d) => d.source)).toEqual(["politiet"]);
  });

  it("slår aldri sammen meldinger fra samme kilde", () => {
    expect(groupDuplicates([ev("a", "vegvesen", [10.4, 63.4]), ev("b", "vegvesen", [10.4, 63.4])])).toHaveLength(2);
  });

  it("holder fra hverandre hendelser som er langt unna, på annen veg eller av ulik art", () => {
    expect(groupDuplicates([ev("a", "vegvesen", [10.4, 63.4]), ev("b", "politiet", [10.5, 63.4])])).toHaveLength(2);
    expect(groupDuplicates([ev("a", "vegvesen", [10.4, 63.4]), ev("b", "politiet", [10.4, 63.4], { roadNumbers: ["R706"] })])).toHaveLength(2);
    expect(groupDuplicates([ev("a", "vegvesen", [10.4, 63.4]), ev("b", "politiet", [10.4, 63.4], { category: "roadworks" })])).toHaveLength(2);
  });
});

describe("status", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const row = (successMinAgo: number | null, errorMinAgo: number | null = null) => ({
    source: "vegvesen",
    lastAttemptAt: now,
    lastSuccessAt: successMinAgo === null ? null : new Date(now.getTime() - successMinAgo * 60000),
    lastError: errorMinAgo === null ? null : "HTTP 500",
    lastErrorAt: errorMinAgo === null ? null : new Date(now.getTime() - errorMinAgo * 60000),
    consecutiveFailures: errorMinAgo === null ? 0 : 3,
    lastItemCount: 10,
    isDemo: false,
  });

  it("vurderer ferskhet", () => {
    expect(freshness(undefined, now, 15)).toBe("never");
    expect(freshness(row(5), now, 15)).toBe("fresh");
    expect(freshness(row(30), now, 15)).toBe("stale");
    expect(freshness(row(30, 1), now, 15)).toBe("error");
    expect(freshness(row(null, 1), now, 15)).toBe("error");
  });

  it("ingen hendelser vises bare med ferske data", () => {
    expect(segmentStatus({ paused: false, hasRelevantItems: false, sourceFreshness: ["fresh"] })).toBe("no_events");
    expect(segmentStatus({ paused: false, hasRelevantItems: false, sourceFreshness: ["stale"] })).toBe("stale");
    expect(segmentStatus({ paused: false, hasRelevantItems: false, sourceFreshness: ["error"] })).toBe("error");
    expect(segmentStatus({ paused: false, hasRelevantItems: false, sourceFreshness: ["never"] })).toBe("no_data");
  });

  it("pause går foran alt, registrerte hendelser vises selv med gamle data", () => {
    expect(segmentStatus({ paused: true, hasRelevantItems: true, sourceFreshness: ["fresh"] })).toBe("paused");
    expect(segmentStatus({ paused: false, hasRelevantItems: true, sourceFreshness: ["stale"] })).toBe("incident");
  });
});
