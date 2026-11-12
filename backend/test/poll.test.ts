import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { DEFAULT_SETTINGS } from "../src/domain/types.js";
import { Notifier } from "../src/services/notifier.js";
import { runPoll } from "../src/services/poll.js";
import * as repo from "../src/services/repo.js";
import { DemoSource } from "../src/traffic/demoSource.js";
import type { TrafficSource } from "../src/traffic/types.js";
import { e6OkstadRanheim } from "./helpers.js";

const silent = pino({ level: "silent" });

describe("innhenting og varsling ende til ende (demodata, PGlite i minnet)", () => {
  let db: Db;
  let userId: string;
  let clock: Date;
  let mode: "on" | "off" | "fail";
  const demo = new DemoSource();
  const source: TrafficSource = {
    id: "demo",
    name: "Demodata",
    isDemo: true,
    async fetchSnapshot(now) {
      if (mode === "fail") throw new Error("HTTP 503 fra test");
      if (mode === "off") return { events: [], travelTimes: [], fetchedAt: now };
      return demo.fetchSnapshot(now);
    },
  };

  const poll = () =>
    runPoll(
      {
        db,
        sources: [source],
        notifier: new Notifier(db, { mode: "dry-run", maxPerDay: 40, push: null, email: null }),
        logger: silent,
        staleAfterMin: 15,
        maxDirectionLookups: 5,
        now: () => clock,
      },
      "test",
    );
  const advance = (min: number) => (clock = new Date(clock.getTime() + min * 60000));

  beforeEach(async () => {
    db = await createDb("pglite:memory");
    await migrate(db);
    userId = await repo.ensureUser(db, "test@example.com");
    await repo.saveSettings(db, userId, { ...DEFAULT_SETTINGS, pushEnabled: true });
    const list = await repo.createList(db, userId, { name: "Til jobb", active: true, schedule: [] });
    const s = e6OkstadRanheim();
    await repo.createSegment(db, list.id, {
      ...s,
      startLat: s.geometry[0]![1],
      startLon: s.geometry[0]![0],
      endLat: s.geometry.at(-1)![1],
      endLon: s.geometry.at(-1)![0],
      geometryNote: null,
    });
    clock = new Date("2026-10-15T05:30:00Z");
    mode = "on";
  });

  it("varsler hver hendelse én gang, merket som demo, og sender ingenting ekte", async () => {
    const first = await poll();
    expect(first.actions.new).toBe(3);
    const log = await repo.listNotifications(db, userId);
    expect(log).toHaveLength(3);
    expect(log.every((n) => n.status === "dry_run" && n.channel === "push" && n.isDemo)).toBe(true);
    expect(log.every((n) => n.title.startsWith("[DEMO]"))).toBe(true);
    expect(log.some((n) => n.body.includes("beregnet fra målt reisetid"))).toBe(true);

    advance(5);
    const second = await poll();
    expect(second.actions).toEqual({ new: 0, update: 0, resolved: 0 });
    expect(await repo.listNotifications(db, userId)).toHaveLength(3);
  });

  it("kildefeil gir ikke avslutningsmeldinger, men vellykket tomt svar gjør det", async () => {
    await poll();
    advance(5);
    mode = "fail";
    const failed = await poll();
    expect(failed.sources.demo!.ok).toBe(false);
    expect(failed.actions.resolved).toBe(0);
    const [status] = await repo.getSourceStatuses(db);
    expect(status!.lastError).toContain("503");

    advance(5);
    mode = "off";
    const cleared = await poll();
    expect(cleared.actions.resolved).toBe(3);
    const log = await repo.listNotifications(db, userId);
    expect(log.filter((n) => n.kind === "resolved")).toHaveLength(3);
  });

  it("pauset liste gir ingen varsler", async () => {
    const [list] = await repo.getLists(db, userId);
    await repo.updateList(db, userId, list!.id, { active: false });
    const res = await poll();
    expect(res.actions.new).toBe(0);
    expect(await repo.listNotifications(db, userId)).toHaveLength(0);
  });

  it("parallelle innhentinger blokkeres av låsen", async () => {
    const [a, b] = await Promise.all([poll(), poll()]);
    expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);
  });

  it("kilde slått av av brukeren gir ingen varsler, og gamle varsler fjernes stille", async () => {
    await poll();
    expect((await repo.listNotifications(db, userId))).toHaveLength(3);
    const settings = await repo.getSettings(db, userId);
    await repo.saveSettings(db, userId, { ...settings, disabledSources: ["demo"] });
    advance(5);
    const res = await poll();
    expect(res.actions).toEqual({ new: 0, update: 0, resolved: 0 });
    expect(await repo.loadAlertStates(db, (await repo.getSegments(db, userId))[0]!.id)).toHaveLength(0);
  });

  it("kilde slått av av brukeren spørres ikke for brukerens strekninger", async () => {
    const seen: number[] = [];
    const spy: TrafficSource = {
      id: "demo",
      name: "Demodata",
      isDemo: true,
      async fetchSnapshot(now, ctx) {
        seen.push(ctx.monitored.length);
        return { events: [], travelTimes: [], fetchedAt: now };
      },
    };
    const settings = await repo.getSettings(db, userId);
    await repo.saveSettings(db, userId, { ...settings, disabledSources: ["demo"] });
    await runPoll(
      {
        db,
        sources: [spy],
        notifier: new Notifier(db, { mode: "dry-run", maxPerDay: 40, push: null, email: null }),
        logger: silent,
        staleAfterMin: 15,
        maxDirectionLookups: 5,
        now: () => clock,
      },
      "test",
    );
    expect(seen).toEqual([0]);
  });
});
