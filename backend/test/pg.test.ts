import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb, type Db } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { DEFAULT_SETTINGS } from "../src/domain/types.js";
import * as authDb from "../src/services/auth.js";
import { Notifier } from "../src/services/notifier.js";
import { runPoll } from "../src/services/poll.js";
import * as repo from "../src/services/repo.js";
import { DemoSource } from "../src/traffic/demoSource.js";
import { e6OkstadRanheim } from "./helpers.js";

// Kjører databasekoden gjennom den vanlige pg-driveren, slik som mot Cloud SQL i drift.
describe("Postgres via pg-driveren (PGlite-socket)", () => {
  let pglite: PGlite;
  let server: PGLiteSocketServer;
  let db: Db;

  beforeAll(async () => {
    pglite = await PGlite.create();
    server = new PGLiteSocketServer({ db: pglite, port: 0, host: "127.0.0.1" });
    await server.start();
    db = await createDb(`postgresql://postgres@${server.getServerConn()}/postgres`, { poolMax: 1 });
    expect(db.kind).toBe("pg");
  });

  afterAll(async () => {
    await db.close();
    await server.stop();
    await pglite.close();
  });

  it("kjører alle migreringer, og ingen på nytt andre gang", async () => {
    expect((await migrate(db)).length).toBeGreaterThanOrEqual(3);
    expect(await migrate(db)).toEqual([]);
  });

  it("innhenting, lagring og varsling virker ende til ende", async () => {
    const userId = await repo.ensureUser(db, "pg@example.com");
    await repo.saveSettings(db, userId, { ...DEFAULT_SETTINGS, pushEnabled: true });
    const list = await repo.createList(db, userId, { name: "Til jobb", active: true, schedule: [{ days: [1, 2, 3, 4, 5], from: "06:00", to: "10:00" }] });
    const s = e6OkstadRanheim();
    await repo.createSegment(db, list.id, {
      ...s,
      startLat: s.geometry[0]![1],
      startLon: s.geometry[0]![0],
      endLat: s.geometry.at(-1)![1],
      endLon: s.geometry.at(-1)![0],
      geometryNote: null,
    });
    const deps = {
      db,
      sources: [new DemoSource()],
      notifier: new Notifier(db, { mode: "dry-run" as const, maxPerDay: 40, push: null, email: null }),
      logger: pino({ level: "silent" }),
      staleAfterMin: 15,
      maxDirectionLookups: 5,
      now: () => new Date("2026-10-16T05:30:00Z"),
    };
    expect((await runPoll(deps, "test")).actions.new).toBe(3);
    expect((await runPoll(deps, "test")).actions.new).toBe(0);
    const log = await repo.listNotifications(db, userId);
    expect(log).toHaveLength(3);
    expect(log[0]!.createdAt).toBeInstanceOf(Date);
    const [list2] = await repo.getLists(db, userId);
    expect(list2!.schedule[0]!.from).toBe("06:00");
  });

  it("innlogging og økter virker", async () => {
    const notifier = new Notifier(db, { mode: "dry-run", maxPerDay: 40, push: null, email: null });
    const app = createApp({ db, notifier, pollNow: async () => ({}), authMode: "password" });
    const inv = await authDb.createAuthToken(db, { kind: "invitation", email: "pgadmin@example.com", isAdmin: true });
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/invitation/accept")
      .set({ "x-kv-client": "web" })
      .send({ token: inv.link.split("/").pop(), password: "sterkt passord i sky" });
    expect(res.status).toBe(200);
    expect((await agent.get("/api/me")).body.isAdmin).toBe(true);
  });
});
