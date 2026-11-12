import { Router } from "express";
import { z } from "zod";
import { config, enabledSources } from "../config.js";
import type { Db } from "../db/index.js";
import { SOURCE_DESCRIPTIONS, SOURCE_NAMES } from "../domain/format.js";
import { ALL_CATEGORIES, type Category } from "../domain/types.js";
import { HttpProblem } from "../middleware/errors.js";
import type { Notifier } from "../services/notifier.js";
import * as repo from "../services/repo.js";

const settingsSchema = z
  .object({
    pushEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    email: z.string().trim().email().max(200).nullable(),
    eventTypes: z.array(z.enum(ALL_CATEGORIES as [Category, ...Category[]])).max(ALL_CATEGORIES.length),
    delayThresholdMin: z.number().int().min(1).max(180),
    notifyOnResolved: z.boolean(),
    includeUnknownDirection: z.boolean(),
    disabledSources: z.array(z.string().max(30)).max(10).default([]),
  })
  .refine((s) => !s.emailEnabled || !!s.email, { message: "Oppgi e-postadresse for e-postvarsling", path: ["email"] });

/** Bare kjente push-tjenester, slik at serveren ikke kan brukes til å kontakte vilkårlige adresser. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /\.push\.apple\.com$/,
];

const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => {
      const url = new URL(u);
      return url.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(url.hostname));
    }, "Ukjent push-tjeneste"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});

export function settingsRoutes(db: Db, notifier: Notifier): Router {
  const r = Router();

  r.get("/settings", async (req, res) => {
    const settings = await repo.getSettings(db, req.user!.id);
    const pushDevices = await repo.countPushSubscriptions(db, req.user!.id);
    const sources = enabledSources().map((id) => ({
      id,
      name: SOURCE_NAMES[id] ?? id,
      description: SOURCE_DESCRIPTIONS[id] ?? "",
    }));
    res.json({ settings, pushDevices, notifyMode: notifier.mode, sources });
  });

  r.put("/settings", async (req, res) => {
    const s = settingsSchema.parse(req.body);
    const available = enabledSources();
    const disabled = [...new Set(s.disabledSources)];
    if (disabled.some((id) => !available.includes(id))) throw new HttpProblem(400, "Ukjent datakilde");
    if (available.every((id) => disabled.includes(id))) {
      throw new HttpProblem(400, "Minst én datakilde må være på");
    }
    await repo.saveSettings(db, req.user!.id, { ...s, email: s.email || null, disabledSources: disabled });
    res.json({ settings: await repo.getSettings(db, req.user!.id) });
  });

  r.get("/push/config", (_req, res) => {
    res.json({ publicKey: config.VAPID_PUBLIC_KEY ?? null, notifyMode: notifier.mode });
  });

  r.post("/push/subscribe", async (req, res) => {
    const sub = subscriptionSchema.parse(req.body);
    await repo.addPushSubscription(db, req.user!.id, {
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: req.header("user-agent")?.slice(0, 200) ?? null,
    });
    res.status(201).json({ ok: true });
  });

  r.post("/push/unsubscribe", async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await repo.removePushSubscription(db, req.user!.id, endpoint);
    res.json({ ok: true });
  });

  r.get("/notifications", async (req, res) => {
    res.json(await repo.listNotifications(db, req.user!.id, 50));
  });

  r.post("/notifications/test", async (req, res) => {
    const settings = await repo.getSettings(db, req.user!.id);
    if (!settings.pushEnabled && !settings.emailEnabled) {
      throw new HttpProblem(400, "Velg minst én varslingskanal først");
    }
    await notifier.send(
      {
        userId: req.user!.id,
        segmentId: null,
        itemKey: null,
        kind: "test",
        title: "Testvarsel fra Køvarsel",
        body: "Dette er et testvarsel. Hvis du ser det, fungerer varslingskanalen.",
        isDemo: false,
      },
      settings,
    );
    const [latest] = await repo.listNotifications(db, req.user!.id, 1);
    res.json({ result: latest });
  });

  return r;
}
