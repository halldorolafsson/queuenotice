import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { distanceM } from "../domain/geo.js";
import { parseHHMM } from "../domain/schedule.js";
import type { LonLat } from "../domain/types.js";
import { HttpProblem } from "../middleware/errors.js";
import { rateLimit } from "../middleware/auth.js";
import * as repo from "../services/repo.js";
import { routeBetween } from "../traffic/nvdb.js";

const hhmm = z.string().refine((v) => {
  try {
    parseHHMM(v);
    return true;
  } catch {
    return false;
  }
}, "Klokkeslett må være på formen TT:MM");

const scheduleSchema = z
  .array(
    z.object({
      days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      from: hhmm,
      to: hhmm,
    }),
  )
  .max(10);

const listSchema = z.object({
  name: z.string().trim().min(1).max(80),
  active: z.boolean().default(true),
  schedule: scheduleSchema.default([]),
});

const placeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  lat: z.number().min(57).max(72),
  lon: z.number().min(4).max(32),
});

const segmentSchema = z.object({
  name: z.string().trim().max(120).optional(),
  start: placeSchema,
  end: placeSchema,
  direction: z.enum(["forward", "both"]),
  bufferM: z.number().int().min(50).max(2000).default(300),
  active: z.boolean().default(true),
});

const uuid = z.string().uuid();

const previewSchema = z.object({
  start: placeSchema.pick({ lat: true, lon: true }),
  end: placeSchema.pick({ lat: true, lon: true }),
});

function validateEnds(input: z.infer<typeof previewSchema>): { start: LonLat; end: LonLat } {
  const start: LonLat = [input.start.lon, input.start.lat];
  const end: LonLat = [input.end.lon, input.end.lat];
  const length = distanceM(start, end);
  if (length < 100) throw new HttpProblem(400, "Start og slutt må ligge minst 100 m fra hverandre");
  if (length > 150_000) throw new HttpProblem(400, "Strekningen kan ikke være lengre enn 150 km i luftlinje. Del den opp.");
  return { start, end };
}

export function listRoutes(db: Db): Router {
  const r = Router();

  r.post("/segments/preview", rateLimit("preview", 20, 60_000), async (req, res) => {
    const { start, end } = validateEnds(previewSchema.parse(req.body));
    res.json(await routeBetween(start, end));
  });

  r.get("/lists", async (req, res) => {
    const lists = await repo.getLists(db, req.user!.id);
    const segments = await repo.getSegments(db, req.user!.id);
    res.json(
      lists.map((l) => ({
        ...l,
        segments: segments.filter((s) => s.listId === l.id).map(({ geometry, ...rest }) => ({ ...rest, points: geometry.length })),
      })),
    );
  });

  r.post("/lists", async (req, res) => {
    const input = listSchema.parse(req.body);
    res.status(201).json(await repo.createList(db, req.user!.id, input));
  });

  r.patch("/lists/:id", async (req, res) => {
    const id = uuid.parse(req.params.id);
    const input = listSchema.partial().parse(req.body);
    const list = await repo.updateList(db, req.user!.id, id, input);
    if (!list) throw new HttpProblem(404, "Fant ikke listen");
    res.json(list);
  });

  r.delete("/lists/:id", async (req, res) => {
    const ok = await repo.deleteList(db, req.user!.id, uuid.parse(req.params.id));
    if (!ok) throw new HttpProblem(404, "Fant ikke listen");
    res.status(204).end();
  });

  async function prepareSegment(body: unknown, previous?: repo.SegmentRow): Promise<repo.SegmentInput> {
    const input = segmentSchema.parse(body);
    const { start, end } = validateEnds(input);

    const sameGeometry =
      previous &&
      previous.startLat === input.start.lat &&
      previous.startLon === input.start.lon &&
      previous.endLat === input.end.lat &&
      previous.endLon === input.end.lon;
    const route = sameGeometry
      ? {
          geometry: previous.geometry,
          source: previous.geometrySource,
          note: previous.geometryNote,
          roads: previous.roadNumbers?.length ? previous.roadNumbers : [previous.roadNumber].filter(Boolean),
        }
      : await routeBetween(start, end);

    return {
      name: input.name || `${input.start.name} – ${input.end.name}`,
      roadNumber: route.roads[0] ?? "",
      roadNumbers: route.roads,
      startName: input.start.name,
      startLat: input.start.lat,
      startLon: input.start.lon,
      endName: input.end.name,
      endLat: input.end.lat,
      endLon: input.end.lon,
      direction: input.direction,
      bufferM: input.bufferM,
      geometry: route.geometry,
      geometrySource: route.source,
      geometryNote: route.note,
      active: input.active,
    };
  }

  r.post("/lists/:id/segments", async (req, res) => {
    const listId = uuid.parse(req.params.id);
    if (!(await repo.getList(db, req.user!.id, listId))) throw new HttpProblem(404, "Fant ikke listen");
    const segment = await repo.createSegment(db, listId, await prepareSegment(req.body));
    res.status(201).json(segment);
  });

  r.put("/segments/:id", async (req, res) => {
    const existing = await repo.getSegment(db, req.user!.id, uuid.parse(req.params.id));
    if (!existing) throw new HttpProblem(404, "Fant ikke strekningen");
    res.json(await repo.updateSegment(db, existing.id, await prepareSegment(req.body, existing)));
  });

  r.patch("/segments/:id", async (req, res) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const existing = await repo.getSegment(db, req.user!.id, uuid.parse(req.params.id));
    if (!existing) throw new HttpProblem(404, "Fant ikke strekningen");
    await repo.setSegmentActive(db, existing.id, active);
    res.json({ ...existing, active });
  });

  r.delete("/segments/:id", async (req, res) => {
    const ok = await repo.deleteSegment(db, req.user!.id, uuid.parse(req.params.id));
    if (!ok) throw new HttpProblem(404, "Fant ikke strekningen");
    res.status(204).end();
  });

  return r;
}
