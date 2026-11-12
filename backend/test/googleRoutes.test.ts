import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type TravelTime } from "../src/domain/types.js";
import { analyzeSegment } from "../src/services/analyze.js";
import {
  buildRequest,
  dueRequests,
  GoogleRoutesSource,
  parseResponse,
  QuotaExceededError,
  travelTimeId,
} from "../src/traffic/googleRoutes.js";
import type { MonitoredSegment, SourceContext } from "../src/traffic/types.js";
import { e6OkstadRanheim } from "./helpers.js";

const now = new Date("2026-10-16T05:30:00Z");
const segment = e6OkstadRanheim({ id: "11111111-1111-1111-1111-111111111111" });
const monitored = (overrides: Partial<MonitoredSegment> = {}): MonitoredSegment => ({
  segment,
  activeNow: true,
  hasSchedule: true,
  disabledSources: [],
  ...overrides,
});

function ctx(opts: { today?: number; month?: number; last?: Record<string, Date> } = {}) {
  const recorded: number[] = [];
  const c: SourceContext = {
    monitored: [monitored()],
    lastMeasured: (id) => opts.last?.[id] ?? null,
    usage: {
      today: async () => opts.today ?? 0,
      thisMonth: async () => opts.month ?? 0,
      record: async (n) => void recorded.push(n),
    },
  };
  return { c, recorded };
}

const source = (overrides: Partial<ConstructorParameters<typeof GoogleRoutesSource>[0]> = {}) =>
  new GoogleRoutesSource({
    apiKey: "test-nokkel",
    url: "https://routes.example.test/compute",
    minIntervalMin: 10,
    maxPerDay: 150,
    maxPerMonth: 4500,
    requireSchedule: true,
    ...overrides,
  });

afterEach(() => vi.unstubAllGlobals());

describe("forespørsel og svar", () => {
  it("ber om trafikkbevisst rute med mellompunkter langs vegen", () => {
    const req = buildRequest(segment.geometry);
    expect(req.routingPreference).toBe("TRAFFIC_AWARE");
    expect(req.travelMode).toBe("DRIVE");
    expect(req.intermediates).toHaveLength(3); // 10,8 km / 3 km
    expect(req.intermediates.every((p) => p.via)).toBe(true);
    expect(req.origin.location.latLng.latitude).toBeCloseTo(segment.geometry[0]![1]);
  });

  it("rett linje gir ingen mellompunkter", () => {
    expect(buildRequest([[10, 63], [10.1, 63.1]]).intermediates).toHaveLength(0);
  });

  it("beregner forsinkelse som duration minus staticDuration", () => {
    const tt = parseResponse({ routes: [{ duration: "960s", staticDuration: "660s", distanceMeters: 10900 }] }, segment, "same", segment.geometry, now);
    expect(tt.delaySec).toBe(300);
    expect(tt.kind).toBe("estimated");
    expect(tt.segmentId).toBe(segment.id);
    expect(tt.id).toBe(travelTimeId(segment.id, "same"));
    expect(tt.name).toContain("Google Maps");
  });

  it("forkaster ruter som ikke følger strekningen", () => {
    const tt = parseResponse({ routes: [{ duration: "1500s", staticDuration: "900s", distanceMeters: 25000 }] }, segment, "same", segment.geometry, now);
    expect(tt.statusValue).toBe("off_route");
    expect(tt.delaySec).toBeNull();
  });

  it("tomt svar gir ingen rute", () => {
    const tt = parseResponse({}, segment, "same", segment.geometry, now);
    expect(tt.statusValue).toBe("no_route");
    expect(tt.actualSec).toBeNull();
  });
});

describe("kostnadskontroll", () => {
  const opts = { minIntervalMin: 10, requireSchedule: true };

  it("spør bare aktive strekninger innenfor tidsrommet", () => {
    expect(dueRequests([monitored({ activeNow: false })], { lastMeasured: () => null }, now, opts)).toHaveLength(0);
  });

  it("krever tidsrom som standard, slik at døgnkontinuerlig overvåking ikke blir dyr", () => {
    expect(dueRequests([monitored({ hasSchedule: false })], { lastMeasured: () => null }, now, opts)).toHaveLength(0);
    expect(dueRequests([monitored({ hasSchedule: false })], { lastMeasured: () => null }, now, { ...opts, requireSchedule: false })).toHaveLength(1);
  });

  it("respekterer minste intervall per strekning", () => {
    const last = (min: number) => () => new Date(now.getTime() - min * 60000);
    expect(dueRequests([monitored()], { lastMeasured: last(5) }, now, opts)).toHaveLength(0);
    expect(dueRequests([monitored()], { lastMeasured: last(10) }, now, opts)).toHaveLength(1);
  });

  it("begge retninger gir to kall", () => {
    const both = monitored({ segment: { ...segment, direction: "both" } });
    expect(dueRequests([both], { lastMeasured: () => null }, now, opts).map((d) => d.direction)).toEqual(["same", "opposite"]);
  });

  it("stopper med tydelig feil når dagskvoten er brukt opp, uten å kalle Google", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { c } = ctx({ today: 150 });
    await expect(source().fetchSnapshot(now, c)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("månedskvoten begrenser også", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { c } = ctx({ month: 4500 });
    await expect(source().fetchSnapshot(now, c)).rejects.toBeInstanceOf(QuotaExceededError);
  });
});

describe("kall mot Google", () => {
  it("sender nøkkel og feltmaske i header og teller kallet", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ routes: [{ duration: "900s", staticDuration: "660s", distanceMeters: 10800 }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { c, recorded } = ctx();
    const snap = await source().fetchSnapshot(now, c);
    expect(snap.partialTravelTimes).toBe(true);
    expect(snap.travelTimes).toHaveLength(1);
    expect(snap.travelTimes![0]!.delaySec).toBe(240);
    expect(recorded).toEqual([1]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe("POST");
    expect(headers["X-Goog-Api-Key"]).toBe("test-nokkel");
    expect(headers["X-Goog-FieldMask"]).toBe("routes.duration,routes.staticDuration,routes.distanceMeters");
  });

  it("feil fra Google (f.eks. API ikke aktivert) blir kildefeil med forklaring", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"message":"Routes API has not been used in project"}}', { status: 403 })),
    );
    const { c } = ctx();
    await expect(source().fetchSnapshot(now, c)).rejects.toThrow(/403.*Routes API has not been used/);
  });
});

describe("estimatet brukes bare på sin egen strekning", () => {
  const tt: TravelTime = {
    id: travelTimeId(segment.id, "same"), source: "google", name: "x", line: segment.geometry,
    actualSec: 1200, expectedSec: 600, delaySec: 600, statusValue: "ok", measuredAt: now, isDemo: false,
    kind: "estimated", segmentId: segment.id, segmentDirection: "same",
  };
  const input = {
    listActive: true, schedule: [], settings: DEFAULT_SETTINGS, events: [], travelTimes: [tt],
    sourceStatuses: [{ source: "google", lastAttemptAt: now, lastSuccessAt: now, lastError: null, lastErrorAt: null, consecutiveFailures: 0, lastItemCount: 0, isDemo: false }],
    enabledSources: ["google"], now, staleAfterMin: 15,
  };

  it("gir estimert forsinkelse og status for strekningen", () => {
    const a = analyzeSegment({ ...input, segment });
    expect(a.estimatedDelayMin).toBe(10);
    expect(a.measuredDelayMin).toBeNull();
    expect(a.status).toBe("incident");
  });

  it("påvirker ikke en annen strekning på samme veg", () => {
    const other = { ...segment, id: "22222222-2222-2222-2222-222222222222" };
    const a = analyzeSegment({ ...input, segment: other });
    expect(a.travelTimes).toHaveLength(0);
    expect(a.estimatedDelayMin).toBeNull();
  });
});
