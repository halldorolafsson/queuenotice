import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb, type Db } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import * as authDb from "../src/services/auth.js";
import { Notifier } from "../src/services/notifier.js";
import { hashPassword, passwordProblem, verifyPassword } from "../src/services/passwords.js";

const H = { "x-kv-client": "web" };
const tokenFrom = (link: string) => link.split("/").pop()!;

describe("passord", () => {
  it("hasher og verifiserer med scrypt", async () => {
    const hash = await hashPassword("et langt og godt passord");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("et langt og godt passord", hash)).toBe(true);
    expect(await verifyPassword("feil passord her", hash)).toBe(false);
  });

  it("krever minst 12 tegn og ikke e-postnavnet", () => {
    expect(passwordProblem("kort", "a@b.no")).toMatch(/minst 12/);
    expect(passwordProblem("halldor-er-best-2026", "halldor@x.no")).toMatch(/e-post/);
    expect(passwordProblem("aaaaaaaaaaaaaaa", "a@b.no")).toMatch(/enkelt/);
    expect(passwordProblem("vinter i trondheim", "a@b.no")).toBeNull();
  });
});

describe("innlogging og brukere", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await createDb("pglite:memory");
    await migrate(db);
    const notifier = new Notifier(db, { mode: "dry-run", maxPerDay: 40, push: null, email: null });
    app = createApp({ db, notifier, pollNow: async () => ({}), authMode: "password" });
  });

  const agent = () => request.agent(app);

  it("krever innlogging", async () => {
    expect((await request(app).get("/api/lists")).status).toBe(401);
    expect((await request(app).get("/api/me")).status).toBe(401);
  });

  it("første administrator kommer inn via invitasjon, som bare kan brukes én gang", async () => {
    const inv = await authDb.createAuthToken(db, { kind: "invitation", email: "Admin@Example.com", isAdmin: true });
    const token = tokenFrom(inv.link);
    const a = agent();
    expect((await a.post("/api/auth/invitation/check").set(H).send({ token })).body.email).toBe("admin@example.com");
    expect((await a.post("/api/auth/invitation/accept").set(H).send({ token, password: "kort" })).status).toBe(400);
    const ok = await a.post("/api/auth/invitation/accept").set(H).send({ token, password: "fjellvann og kaffe" });
    expect(ok.status).toBe(200);
    expect(ok.headers["set-cookie"]?.[0]).toMatch(/kv_session=.*HttpOnly.*SameSite=Lax/);
    const me = await a.get("/api/me");
    expect(me.body).toMatchObject({ email: "admin@example.com", isAdmin: true });
    expect((await agent().post("/api/auth/invitation/accept").set(H).send({ token, password: "fjellvann og kaffe" })).status).toBe(400);
  });

  it("logger inn og ut, og avviser feil passord", async () => {
    const a = agent();
    expect((await a.post("/api/auth/login").set(H).send({ email: "admin@example.com", password: "feil passord!!" })).status).toBe(401);
    expect((await a.post("/api/auth/login").set(H).send({ email: "finnes.ikke@example.com", password: "feil passord!!" })).status).toBe(401);
    expect((await a.post("/api/auth/login").set(H).send({ email: "ADMIN@example.com", password: "fjellvann og kaffe" })).status).toBe(200);
    expect((await a.get("/api/lists")).status).toBe(200);
    await a.post("/api/auth/logout").set(H).send({});
    expect((await a.get("/api/lists")).status).toBe(401);
  });

  it("stenger etter fem mislykkede forsøk", async () => {
    const inv = await authDb.createAuthToken(db, { kind: "invitation", email: "laas@example.com" });
    await agent().post("/api/auth/invitation/accept").set(H).send({ token: tokenFrom(inv.link), password: "riktig passord 123" });
    const a = agent();
    for (let i = 0; i < 5; i++) {
      await a.post("/api/auth/login").set(H).send({ email: "laas@example.com", password: "galt passord 123" });
    }
    const blocked = await a.post("/api/auth/login").set(H).send({ email: "laas@example.com", password: "riktig passord 123" });
    expect(blocked.status).toBe(429);
  });

  it("endring av passord krever nåværende passord og logger ut andre enheter", async () => {
    const pc = agent();
    const phone = agent();
    await pc.post("/api/auth/login").set(H).send({ email: "admin@example.com", password: "fjellvann og kaffe" });
    await phone.post("/api/auth/login").set(H).send({ email: "admin@example.com", password: "fjellvann og kaffe" });

    const wrong = await pc.post("/api/account/password").set(H).send({ currentPassword: "gjett gjett gjett", newPassword: "nytt sterkt passord" });
    expect(wrong.status).toBe(400);
    const ok = await pc.post("/api/account/password").set(H).send({ currentPassword: "fjellvann og kaffe", newPassword: "nytt sterkt passord" });
    expect(ok.status).toBe(200);

    expect((await pc.get("/api/me")).status).toBe(200);
    expect((await phone.get("/api/me")).status).toBe(401);
    expect((await agent().post("/api/auth/login").set(H).send({ email: "admin@example.com", password: "fjellvann og kaffe" })).status).toBe(401);
  });

  it("administrator inviterer ny bruker; vanlig bruker ser ikke admin og ikke andres data", async () => {
    const adm = agent();
    await adm.post("/api/auth/login").set(H).send({ email: "admin@example.com", password: "nytt sterkt passord" });
    const list = await adm.post("/api/lists").set(H).send({ name: "Adminliste" });
    const inv = await adm.post("/api/admin/invitations").set(H).send({ email: "kari@example.com" });
    expect(inv.status).toBe(201);

    const kari = agent();
    await kari.post("/api/auth/invitation/accept").set(H).send({ token: tokenFrom(inv.body.link), password: "hemmelige ord for meg" });
    expect((await kari.get("/api/me")).body.isAdmin).toBe(false);
    expect((await kari.get("/api/admin/users")).status).toBe(403);
    expect((await kari.get("/api/lists")).status).toBe(200);
    expect((await kari.get("/api/lists")).body).toHaveLength(0);
    expect((await kari.patch(`/api/lists/${list.body.id}`).set(H).send({ name: "Kapret" })).status).toBe(404);

    const users = await adm.get("/api/admin/users");
    expect(users.body.users.map((u: { email: string }) => u.email)).toContain("kari@example.com");
  });

  it("lenke for nytt passord fra administrator virker én gang", async () => {
    const adm = agent();
    await adm.post("/api/auth/login").set(H).send({ email: "admin@example.com", password: "nytt sterkt passord" });
    const users = await adm.get("/api/admin/users");
    const kari = users.body.users.find((u: { email: string }) => u.email === "kari@example.com");
    const link = await adm.post(`/api/admin/users/${kari.id}/reset-link`).set(H).send({});
    const token = tokenFrom(link.body.link);
    expect(link.body.link).toContain("/#/tilbakestill/");

    expect((await agent().post("/api/auth/reset").set(H).send({ token, password: "glemte det gamle ordet" })).status).toBe(200);
    expect((await agent().post("/api/auth/reset").set(H).send({ token, password: "glemte det gamle ordet" })).status).toBe(400);
    expect((await agent().post("/api/auth/login").set(H).send({ email: "kari@example.com", password: "glemte det gamle ordet" })).status).toBe(200);
  });

  it("glemt passord gir samme svar uansett om brukeren finnes", async () => {
    const a = await agent().post("/api/auth/forgot").set(H).send({ email: "kari@example.com" });
    const b = await agent().post("/api/auth/forgot").set(H).send({ email: "ingen@example.com" });
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });

  it("administrator kan ikke slette eller degradere seg selv", async () => {
    const adm = agent();
    await adm.post("/api/auth/login").set(H).send({ email: "admin@example.com", password: "nytt sterkt passord" });
    const me = (await adm.get("/api/admin/users")).body.users.find((u: { email: string }) => u.email === "admin@example.com");
    expect((await adm.delete(`/api/admin/users/${me.id}`).set(H)).status).toBe(400);
    expect((await adm.patch(`/api/admin/users/${me.id}`).set(H).send({ isAdmin: false })).status).toBe(400);
  });
});
