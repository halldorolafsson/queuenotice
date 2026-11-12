import { Router } from "express";
import { z } from "zod";
import { config, enabledSources } from "../config.js";
import type { Db } from "../db/index.js";
import { displayRoadNumber } from "../domain/roads.js";
import { HttpProblem } from "../middleware/errors.js";
import { rateLimit } from "../middleware/auth.js";
import { buildOverview } from "../services/overview.js";
import { nearestPlaceName, searchPlaces } from "../traffic/geocode.js";
import { pointOnRoad } from "../traffic/nvdb.js";

export function miscRoutes(db: Db, pollNow: () => Promise<unknown>): Router {
  const r = Router();

  r.get("/me", (req, res) => {
    res.json({
      email: req.user!.email,
      isAdmin: req.user!.isAdmin,
      authMode: config.AUTH_MODE,
      notifyMode: config.NOTIFY_MODE,
      sources: enabledSources(),
      demo: enabledSources().includes("demo"),
    });
  });

  r.get("/overview", async (req, res) => {
    res.json(await buildOverview(db, req.user!.id));
  });

  r.post("/poll", rateLimit("poll", 1, 60_000), async (_req, res) => {
    res.json(await pollNow());
  });

  r.get("/places", rateLimit("places", 30, 60_000), async (req, res) => {
    const q = z.string().trim().min(2).max(80).parse(req.query.q);
    try {
      res.json(await searchPlaces(q));
    } catch (err) {
      throw new HttpProblem(502, (err as Error).message);
    }
  });

  r.get("/places/at", rateLimit("places-at", 40, 60_000), async (req, res) => {
    const q = z
      .object({
        lat: z.coerce.number().min(57).max(72),
        lon: z.coerce.number().min(4).max(32),
      })
      .parse(req.query);
    let point = { lat: q.lat, lon: q.lon };
    let description: string;
    let onRoad: boolean | null = null;
    try {
      const snapped = await pointOnRoad(q.lat, q.lon);
      onRoad = snapped !== null;
      if (snapped) point = { lat: snapped.lat, lon: snapped.lon };
      description = !snapped
        ? "Ingen europa-, riks- eller fylkesveg innen 200 m"
        : snapped.road
          ? `På ${displayRoadNumber(snapped.road)}`
          : "På vegen";
    } catch {
      description = "Fant ikke vegdata akkurat nå";
    }
    const near = await nearestPlaceName(point.lat, point.lon).catch(() => null);
    const name = !near ? "Punkt i kartet" : near.distanceM <= 150 ? near.name : `Ved ${near.name}`;
    res.json({ name, description, lat: round6(point.lat), lon: round6(point.lon), onRoad });
  });

  return r;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
