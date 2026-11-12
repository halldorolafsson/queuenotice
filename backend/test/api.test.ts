import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/traffic/nvdb.js", () => ({
  routeBetween: vi.fn(async (start: [number, number], end: [number, number]) => ({
    geometry: [start, end],
    source: "nvdb",
    note: null,
    roads: ["E6", "F704"],
  })),
  pointOnRoad: vi.fn(async (lat: number, lon: number) =>
    lat > 63.3 ? { lat: lat + 0.0001, lon, distanceM: 11, road: "E6" } : null,
  ),
}));

vi.mock("../src/traffic/geocode.js", () => ({
  searchPlaces: vi.fn(async () => []),
  nearestPlaceName: vi.fn(async () => ({ name: "Okstad", distanceM: 400 })),
}));

const { createApp } = await import("../src/app.js");
const { createDb } = await import("../src/db/index.js");
const { migrate } = await import("../src/db/migrate.js");
const { Notifier } = await import("../src/services/notifier.js");

describe("API", () => {
  let app: ReturnType<typeof createApp>;
  const client = { "x-kv-client": "web" };

  beforeAll(async () => {
    const db = await createDb("pglite:memory");
    await migrate(db);
    const notifier = new Notifier(db, { mode: "dry-run", maxPerDay: 40, push: null, email: null });
    app = createApp({ db, notifier, pollNow: async () => ({ ok: true }) });
  });

  it("krever klient-header på endrende kall (CSRF-vern)", async () => {
    const res = await request(app).post("/api/lists").send({ name: "X" });
    expect(res.status).toBe(403);
  });

  it("oppretter liste og strekning; vegnumre utledes fra ruten", async () => {
    const list = await request(app).post("/api/lists").set(client).send({ name: "Til jobb", schedule: [{ days: [1, 2, 3, 4, 5], from: "06:30", to: "09:00" }] });
    expect(list.status).toBe(201);

    const tooShort = await request(app)
      .post(`/api/lists/${list.body.id}/segments`)
      .set(client)
      .send({ start: { name: "A", lat: 63.3, lon: 10.3 }, end: { name: "B", lat: 63.3, lon: 10.3 }, direction: "forward" });
    expect(tooShort.status).toBe(400);

    const ok = await request(app)
      .post(`/api/lists/${list.body.id}/segments`)
      .set(client)
      .send({ start: { name: "Melhus", lat: 63.28, lon: 10.27 }, end: { name: "Tonstad", lat: 63.38, lon: 10.39 }, direction: "forward" });
    expect(ok.status).toBe(201);
    expect(ok.body.roadNumber).toBe("E6");
    expect(ok.body.roadNumbers).toEqual(["E6", "F704"]);
    expect(ok.body.geometrySource).toBe("nvdb");
    expect(ok.body.name).toBe("Melhus – Tonstad");

    const overview = await request(app).get("/api/overview");
    expect(overview.status).toBe(200);
    const seg = overview.body.lists[0].segments[0];
    expect(seg.status).toBe("no_data");
  });

  it("finner punkt i kartet og fester det til vegen", async () => {
    const on = await request(app).get("/api/places/at?lat=63.38&lon=10.39");
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ name: "Ved Okstad", description: "På E6", onRoad: true, lat: 63.3801 });

    const off = await request(app).get("/api/places/at?lat=63.2&lon=10.39");
    expect(off.body).toMatchObject({ onRoad: false, lat: 63.2 });
    expect(off.body.description).toContain("innen 200 m");

    expect((await request(app).get("/api/places/at?lat=40&lon=10")).status).toBe(400);
  });

  it("forhåndsviser strekning uten å lagre", async () => {
    const res = await request(app)
      .post("/api/segments/preview")
      .set(client)
      .send({ start: { lat: 63.28, lon: 10.27 }, end: { lat: 63.38, lon: 10.39 } });
    expect(res.status).toBe(200);
    expect(res.body.geometry).toHaveLength(2);
    expect(res.body.roads).toEqual(["E6", "F704"]);
    const bad = await request(app)
      .post("/api/segments/preview")
      .set(client)
      .send({ start: { lat: 63.28, lon: 10.27 }, end: { lat: 63.28, lon: 10.27 } });
    expect(bad.status).toBe(400);
  });

  it("avviser ugyldig tidsrom", async () => {
    const res = await request(app).post("/api/lists").set(client).send({ name: "X", schedule: [{ days: [1], from: "25:00", to: "09:00" }] });
    expect(res.status).toBe(400);
  });

  it("godtar bare kjente push-tjenester", async () => {
    const evil = await request(app)
      .post("/api/push/subscribe")
      .set(client)
      .send({ endpoint: "https://169.254.169.254/latest", keys: { p256dh: "x".repeat(20), auth: "y".repeat(16) } });
    expect(evil.status).toBe(400);
    const good = await request(app)
      .post("/api/push/subscribe")
      .set(client)
      .send({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "x".repeat(20), auth: "y".repeat(16) } });
    expect(good.status).toBe(201);
  });

  it("krever kanal for testvarsel og logger dry-run", async () => {
    const none = await request(app).post("/api/notifications/test").set(client).send({});
    expect(none.status).toBe(400);
    const settings = await request(app).get("/api/settings");
    await request(app).put("/api/settings").set(client).send({ ...settings.body.settings, pushEnabled: true });
    const res = await request(app).post("/api/notifications/test").set(client).send({});
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("dry_run");
  });

  it("krever e-postadresse når e-post er valgt", async () => {
    const settings = await request(app).get("/api/settings");
    const res = await request(app).put("/api/settings").set(client).send({ ...settings.body.settings, emailEnabled: true, email: null });
    expect(res.status).toBe(400);
  });

  it("viser tilgjengelige kilder og krever minst én på", async () => {
    const settings = await request(app).get("/api/settings");
    expect(settings.body.sources.map((s: { id: string }) => s.id)).toEqual(["vegvesen"]);
    expect(settings.body.sources[0].description).toContain("stengte veger");
    const none = await request(app).put("/api/settings").set(client).send({ ...settings.body.settings, disabledSources: ["vegvesen"] });
    expect(none.status).toBe(400);
    const unknown = await request(app).put("/api/settings").set(client).send({ ...settings.body.settings, disabledSources: ["politiet"] });
    expect(unknown.status).toBe(400);
  });
});
