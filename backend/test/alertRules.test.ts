import { describe, expect, it } from "vitest";
import { evaluateAlerts, type AlertContext, type AlertState, type Candidate } from "../src/domain/alertRules.js";
import { DEFAULT_SETTINGS } from "../src/domain/types.js";

const t0 = new Date("2026-10-15T05:30:00Z");
const minutes = (n: number) => new Date(t0.getTime() + n * 60000);

function ctx(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    now: t0,
    settings: { ...DEFAULT_SETTINGS, eventTypes: ["closure", "queue", "accident", "obstruction", "restriction"] },
    segmentDirection: "forward",
    monitoringActive: true,
    inWindow: true,
    healthySources: new Set(["vegvesen"]),
    ...overrides,
  };
}

function cand(overrides: Partial<Candidate> = {}): Candidate {
  return {
    key: "ev:vegvesen:A",
    source: "vegvesen",
    kind: "event",
    category: "accident",
    severity: 2,
    delayMin: null,
    fingerprint: "accident|2|Ulykke",
    direction: "both",
    ...overrides,
  };
}

/** Kjører reglene i flere runder og fører tilstanden videre, slik pollen gjør. */
function run(rounds: Array<{ candidates: Candidate[]; ctx?: Partial<AlertContext> }>) {
  let states: AlertState[] = [];
  return rounds.map((round) => {
    const out = evaluateAlerts(round.candidates, states, ctx(round.ctx));
    const byKey = new Map(states.map((s) => [s.itemKey, s]));
    out.upserts.forEach((u) => byKey.set(u.itemKey, u));
    out.deletes.forEach((d) => byKey.delete(d));
    states = [...byKey.values()];
    return out.actions.map((a) => a.type);
  });
}

describe("nye hendelser og duplikater", () => {
  it("varsler én gang, ikke på nytt ved uendret hendelse", () => {
    expect(
      run([
        { candidates: [cand()] },
        { candidates: [cand()], ctx: { now: minutes(5) } },
        { candidates: [cand()], ctx: { now: minutes(60) } },
      ]),
    ).toEqual([["new"], [], []]);
  });

  it("varsler ikke valgt hendelsestype", () => {
    expect(run([{ candidates: [cand({ category: "roadworks" })] }])).toEqual([[]]);
  });

  it("varsler ikke hendelse i motsatt retning for enveis strekning", () => {
    expect(run([{ candidates: [cand({ direction: "opposite" })] }])).toEqual([[]]);
    expect(run([{ candidates: [cand({ direction: "opposite" })], ctx: { segmentDirection: "both" } }])).toEqual([["new"]]);
  });

  it("ukjent retning følger brukerens innstilling", () => {
    const off = { settings: { ...DEFAULT_SETTINGS, includeUnknownDirection: false } };
    expect(run([{ candidates: [cand({ direction: "unknown" })], ctx: off }])).toEqual([[]]);
    expect(run([{ candidates: [cand({ direction: "unknown" })] }])).toEqual([["new"]]);
  });
});

describe("forsinkelsesterskel", () => {
  const tt = (delayMin: number) =>
    cand({ key: "tt:vegvesen:tt:1", kind: "travel_time", category: "queue", severity: 0, delayMin, direction: "same", fingerprint: "tt" });

  it("målt forsinkelse under terskel varsles ikke", () => {
    expect(run([{ candidates: [tt(9)] }])).toEqual([[]]);
    expect(run([{ candidates: [tt(10)] }])).toEqual([["new"]]);
  });

  it("oppgitt forsinkelse under terskel varsles ikke, unntatt stengt veg", () => {
    expect(run([{ candidates: [cand({ category: "restriction", delayMin: 5 })] }])).toEqual([[]]);
    expect(run([{ candidates: [cand({ category: "closure", delayMin: 5 })] }])).toEqual([["new"]]);
  });

  it("hendelse uten oppgitt forsinkelse varsles etter type", () => {
    expect(run([{ candidates: [cand({ category: "obstruction", delayMin: null })] }])).toEqual([["new"]]);
  });

  it("kø regnes som over først under halve terskelen (unngår flimring)", () => {
    expect(
      run([
        { candidates: [tt(12)] },
        { candidates: [tt(7)], ctx: { now: minutes(5) } },
        { candidates: [tt(4)], ctx: { now: minutes(10) } },
      ]),
    ).toEqual([["new"], [], ["resolved"]]);
  });
});

describe("oppdateringer ved vesentlig endring", () => {
  const tt = (delayMin: number) =>
    cand({ key: "tt:vegvesen:tt:1", kind: "travel_time", category: "queue", severity: 0, delayMin, direction: "same", fingerprint: "tt" });

  it("ny melding når forsinkelsen øker med minst 5 min og 30 %", () => {
    expect(
      run([
        { candidates: [tt(12)] },
        { candidates: [tt(15)], ctx: { now: minutes(15) } }, // +3 min: for lite
        { candidates: [tt(20)], ctx: { now: minutes(30) } }, // +8 min og 67 %: oppdatering
      ]),
    ).toEqual([["new"], [], ["update"]]);
  });

  it("forsinkelsesendring venter minst 10 minutter etter forrige melding", () => {
    expect(
      run([
        { candidates: [tt(12)] },
        { candidates: [tt(25)], ctx: { now: minutes(5) } },
        { candidates: [tt(25)], ctx: { now: minutes(11) } },
      ]),
    ).toEqual([["new"], [], ["update"]]);
  });

  it("opptrapping til stengt veg varsles straks", () => {
    expect(
      run([
        { candidates: [cand({ category: "accident" })] },
        { candidates: [cand({ category: "closure", fingerprint: "closure" })], ctx: { now: minutes(1) } },
      ]),
    ).toEqual([["new"], ["update"]]);
  });

  it("endret tekst alene gir ny melding først etter 30 minutter", () => {
    expect(
      run([
        { candidates: [cand()] },
        { candidates: [cand({ fingerprint: "ny tekst" })], ctx: { now: minutes(20) } },
        { candidates: [cand({ fingerprint: "ny tekst" })], ctx: { now: minutes(31) } },
        { candidates: [cand({ fingerprint: "ny tekst" })], ctx: { now: minutes(70) } },
      ]),
    ).toEqual([["new"], [], ["update"], []]);
  });
});

describe("avsluttede hendelser", () => {
  it("varsler når hendelsen er over hvis brukeren vil det", () => {
    expect(run([{ candidates: [cand()] }, { candidates: [], ctx: { now: minutes(30) } }])).toEqual([["new"], ["resolved"]]);
  });

  it("ingen melding om avslutning hvis brukeren har slått det av", () => {
    const off = { settings: { ...DEFAULT_SETTINGS, notifyOnResolved: false } };
    expect(run([{ candidates: [cand()], ctx: off }, { candidates: [], ctx: { ...off, now: minutes(30) } }])).toEqual([["new"], []]);
  });

  it("kildefeil tolkes ikke som at hendelsen er over", () => {
    expect(
      run([
        { candidates: [cand()] },
        { candidates: [], ctx: { now: minutes(5), healthySources: new Set() } },
        { candidates: [cand()], ctx: { now: minutes(10) } },
      ]),
    ).toEqual([["new"], [], []]);
  });

  it("aldri varslet hendelse gir ingen avslutningsmelding", () => {
    expect(
      run([
        { candidates: [cand()], ctx: { inWindow: false } },
        { candidates: [], ctx: { now: minutes(30) } },
      ]),
    ).toEqual([[], []]);
  });
});

describe("tidsrom og pause", () => {
  it("utenfor tidsrom: ingen melding, men varsler når tidsrommet starter", () => {
    expect(
      run([
        { candidates: [cand()], ctx: { inWindow: false } },
        { candidates: [cand()], ctx: { inWindow: false, now: minutes(30) } },
        { candidates: [cand()], ctx: { inWindow: true, now: minutes(60) } },
        { candidates: [cand()], ctx: { inWindow: true, now: minutes(65) } },
      ]),
    ).toEqual([[], [], ["new"], []]);
  });

  it("pauset overvåking sender ingenting, heller ikke avslutning", () => {
    expect(
      run([
        { candidates: [cand()] },
        { candidates: [cand({ category: "closure" })], ctx: { monitoringActive: false, now: minutes(15) } },
        { candidates: [], ctx: { monitoringActive: false, now: minutes(30) } },
      ]),
    ).toEqual([["new"], [], []]);
  });
});
