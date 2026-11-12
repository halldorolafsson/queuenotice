import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { DEFAULT_SETTINGS } from "../src/domain/types.js";
import * as authDb from "../src/services/auth.js";
import { hashPassword, verifyPassword } from "../src/services/passwords.js";
import * as repo from "../src/services/repo.js";
import { exportData, importData, type TransferExport } from "../src/services/transfer.js";
import { e6OkstadRanheim } from "./helpers.js";

describe("overføring mellom databaser", () => {
  it("flytter bruker, passord, lister og strekninger med samme ID-er", async () => {
    const source = await createDb("pglite:memory");
    await migrate(source);
    const userId = await repo.ensureUser(source, "flytt@example.com");
    await authDb.setPassword(source, userId, await hashPassword("passord som flyttes"));
    await repo.saveSettings(source, userId, { ...DEFAULT_SETTINGS, delayThresholdMin: 7 });
    const list = await repo.createList(source, userId, { name: "Til jobb", active: true, schedule: [{ days: [1], from: "07:00", to: "08:00" }] });
    const s = e6OkstadRanheim();
    const seg = await repo.createSegment(source, list.id, {
      ...s, startLat: 63.37, startLon: 10.37, endLat: 63.42, endLon: 10.51, geometryNote: null,
    });

    // Gjennom JSON, slik som via eksportfilen.
    const file = JSON.parse(JSON.stringify(await exportData(source))) as TransferExport;
    const target = await createDb("pglite:memory");
    await migrate(target);

    expect(await importData(target, file, false)).toMatchObject({ users: 1, watch_lists: 1, segments: 1 });
    expect(await repo.listUserIds(target)).toHaveLength(0); // prøvekjøring lagrer ingenting

    await importData(target, file, true);
    const user = await authDb.findUserByEmail(target, "flytt@example.com");
    expect(user?.id).toBe(userId);
    expect(await verifyPassword("passord som flyttes", user!.passwordHash!)).toBe(true);
    expect((await repo.getSettings(target, userId)).delayThresholdMin).toBe(7);
    expect((await repo.getLists(target, userId))[0]!.schedule[0]!.from).toBe("07:00");
    const moved = await repo.getSegment(target, userId, seg.id);
    expect(moved?.geometry.length).toBe(s.geometry.length);

    await expect(importData(target, file, true)).rejects.toThrow(/ikke tom/);
  });
});
