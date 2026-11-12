import type { Db } from "../db/index.js";
import { evaluateAlerts } from "../domain/alertRules.js";
import { formatAlert } from "../domain/format.js";
import { matchEvent } from "../domain/matching.js";
import { isWithinSchedule, osloDateKey } from "../domain/schedule.js";
import type { Category } from "../domain/types.js";
import type { Logger } from "pino";
import type { MonitoredSegment, SourceContext, TrafficSource } from "../traffic/types.js";
import { analyzeSegment, candidatesFrom, polylineFor, userSources, type SegmentAnalysis } from "./analyze.js";
import type { Notifier } from "./notifier.js";
import { purgeExpired } from "./auth.js";
import * as repo from "./repo.js";

export interface PollDeps {
  db: Db;
  sources: TrafficSource[];
  notifier: Notifier;
  logger: Logger;
  staleAfterMin: number;
  maxDirectionLookups: number;
  now?: () => Date;
}

export interface PollSummary {
  skipped?: string;
  sources: Record<string, { ok: boolean; events?: number; travelTimes?: number; error?: string; ms: number }>;
  segments: number;
  actions: { new: number; update: number; resolved: number };
  directionLookups: number;
}

/**
 * Én runde: hent fra alle kilder, lagre, avgjør varsler og send dem.
 * Kjøres av planlegger (Cloud Run Job / lokal timer) eller "Oppdater nå".
 */
export async function runPoll(deps: PollDeps, trigger: string): Promise<PollSummary> {
  const { db, logger } = deps;
  const now = () => deps.now?.() ?? new Date();
  const summary: PollSummary = { sources: {}, segments: 0, actions: { new: 0, update: 0, resolved: 0 }, directionLookups: 0 };

  if (!(await repo.tryAcquirePollLock(db, now(), 240))) {
    logger.info({ trigger }, "Innhenting kjører allerede, hopper over");
    return { ...summary, skipped: "Innhenting kjører allerede" };
  }
  const runId = await repo.startPollRun(db, trigger);
  try {
    await fetchSources(deps, now, summary);
    await evaluateAll(deps, now, summary);
    await repo.purgeOldData(db, now());
    await purgeExpired(db);
    await repo.finishPollRun(db, runId, summary, null);
    logger.info({ trigger, summary }, "Innhenting fullført");
    return summary;
  } catch (err) {
    await repo.finishPollRun(db, runId, summary, (err as Error).message);
    logger.error({ trigger, err: (err as Error).message, stack: (err as Error).stack }, "Innhenting feilet");
    throw err;
  } finally {
    await repo.releasePollLock(db);
  }
}

async function buildContext(db: Db, now: Date): Promise<Omit<SourceContext, "usage">> {
  const monitored: MonitoredSegment[] = [];
  for (const userId of await repo.listUserIds(db)) {
    const lists = await repo.getLists(db, userId);
    const { disabledSources } = await repo.getSettings(db, userId);
    for (const segment of await repo.getSegments(db, userId)) {
      const list = lists.find((l) => l.id === segment.listId);
      if (!list) continue;
      monitored.push({
        segment,
        activeNow: list.active && segment.active && isWithinSchedule(list.schedule, now),
        hasSchedule: list.schedule.length > 0,
        disabledSources,
      });
    }
  }
  const measured = new Map((await repo.loadPresentTravelTimes(db)).map((t) => [t.id, t.measuredAt]));
  return { monitored, lastMeasured: (id) => measured.get(id) ?? null };
}

async function fetchSources(deps: PollDeps, now: () => Date, summary: PollSummary): Promise<void> {
  const base = await buildContext(deps.db, now());
  // Kildene hentes parallelt; én kildes feil stopper ikke de andre.
  await Promise.all(
    deps.sources.map(async (source) => {
      const started = Date.now();
      const ctx: SourceContext = {
        ...base,
        // Strekninger der brukeren har slått av kilden, spørres ikke (sparer betalte kall).
        monitored: base.monitored.filter((m) => !m.disabledSources.includes(source.id)),
        usage: {
          today: () => repo.apiUsage(deps.db, source.id, osloDateKey(now())),
          thisMonth: () => repo.apiUsage(deps.db, source.id, osloDateKey(now()).slice(0, 7)),
          record: (calls) => repo.recordApiUsage(deps.db, source.id, osloDateKey(now()), calls),
        },
      };
      try {
        const snap = await source.fetchSnapshot(now(), ctx);
        await repo.storeSnapshot(deps.db, source.id, snap);
        const ms = Date.now() - started;
        await repo.recordSourceSuccess(deps.db, source.id, source.isDemo, snap.fetchedAt, snap.events.length, ms);
        summary.sources[source.id] = { ok: true, events: snap.events.length, travelTimes: snap.travelTimes?.length ?? 0, ms };
      } catch (err) {
        const message = (err as Error).message;
        const ms = Date.now() - started;
        await repo.recordSourceFailure(deps.db, source.id, source.isDemo, now(), message);
        summary.sources[source.id] = { ok: false, error: message, ms };
        deps.logger.warn({ source: source.id, err: message, ms }, "Henting fra trafikkilde feilet");
      }
    }),
  );
}

async function evaluateAll(deps: PollDeps, now: () => Date, summary: PollSummary): Promise<void> {
  const { db } = deps;
  const events = await repo.loadPresentEvents(db);
  const travelTimes = await repo.loadPresentTravelTimes(db);
  const statuses = await repo.getSourceStatuses(db);
  const enabled = deps.sources.map((s) => s.id);
  const sourceById = new Map(deps.sources.map((s) => [s.id, s]));
  const lookedUp = new Set<string>();

  for (const userId of await repo.listUserIds(db)) {
    const settings = await repo.getSettings(db, userId);
    const sourcesForUser = userSources(enabled, settings);
    const lists = await repo.getLists(db, userId);
    const segments = await repo.getSegments(db, userId);

    for (const segment of segments) {
      const list = lists.find((l) => l.id === segment.listId);
      if (!list) continue;
      summary.segments++;

      // Slå opp kjøreretning for nye/endrede hendelser som treffer strekningen.
      for (const event of events) {
        if (event.directionChecked || lookedUp.has(event.id) || !sourcesForUser.includes(event.source)) continue;
        const source = sourceById.get(event.source);
        if (!source?.lookupDirection || summary.directionLookups >= deps.maxDirectionLookups) continue;
        if (!matchEvent(segment, polylineFor(segment), event)) continue;
        lookedUp.add(event.id);
        summary.directionLookups++;
        try {
          event.direction = await source.lookupDirection(event.sourceId);
          event.directionChecked = true;
          await repo.saveDirection(db, event.id, event.version, event.direction);
        } catch (err) {
          deps.logger.warn({ event: event.id, err: (err as Error).message }, "Oppslag av kjøreretning feilet");
        }
      }

      const analysis = analyzeSegment({
        segment,
        listActive: list.active,
        schedule: list.schedule,
        settings,
        events,
        travelTimes,
        sourceStatuses: statuses,
        enabledSources: sourcesForUser,
        now: now(),
        staleAfterMin: deps.staleAfterMin,
      });
      const candidates = candidatesFrom(analysis);
      const allStates = await repo.loadAlertStates(db, segment.id);
      // Tilstand fra kilder som er slått av (på serveren eller av brukeren), fjernes stille.
      const states = allStates.filter((s) => sourcesForUser.includes(s.source));
      const outcome = evaluateAlerts(candidates, states, {
        now: now(),
        settings,
        segmentDirection: segment.direction,
        monitoringActive: !analysis.paused,
        inWindow: analysis.inWindow,
        healthySources: new Set(analysis.sources.filter((s) => s.freshness === "fresh").map((s) => s.source)),
      });
      outcome.deletes.push(...allStates.filter((s) => !sourcesForUser.includes(s.source)).map((s) => s.itemKey));

      for (const action of outcome.actions) {
        summary.actions[action.type]++;
        const msg = buildMessage(action, segment, analysis, states);
        await deps.notifier.send({ userId, segmentId: segment.id, itemKey: action.key, kind: action.type, ...msg }, settings);
      }
      await repo.applyAlertOutcome(db, segment.id, outcome);
    }
  }
}

function buildMessage(
  action: { type: "new" | "update" | "resolved"; key: string; reason: string },
  segment: repo.SegmentRow,
  analysis: SegmentAnalysis,
  states: Array<{ itemKey: string; lastCategory: Category | null }>,
): { title: string; body: string; isDemo: boolean } {
  const ev = analysis.events.find((e) => `ev:${e.event.id}` === action.key);
  const tt = analysis.travelTimes.find((t) => `tt:${t.travelTime.id}` === action.key);
  const base = { kind: action.type, reason: action.reason, segment };

  if (ev) {
    const r = formatAlert({
      ...base,
      item: {
        category: ev.event.category,
        title: ev.event.title,
        description: ev.event.description,
        delayMin: ev.event.reportedDelayMin,
        delayKind: ev.event.reportedDelayMin === null ? null : "reported",
        source: ev.event.source,
        updatedAt: ev.event.sourceUpdatedAt,
        isDemo: ev.event.isDemo,
      },
    });
    return { ...r, isDemo: ev.event.isDemo };
  }
  if (tt) {
    const r = formatAlert({
      ...base,
      item: {
        category: "queue",
        label: tt.travelTime.kind === "estimated" ? "Estimert forsinkelse" : "Målt forsinkelse",
        title: tt.travelTime.name,
        description: `Reisetid ${Math.round((tt.travelTime.actualSec ?? 0) / 60)} min, normalt ${Math.round((tt.travelTime.expectedSec ?? 0) / 60)} min.`,
        delayMin: tt.delayMin,
        delayKind: tt.travelTime.kind === "estimated" ? "estimated" : "measured",
        source: tt.travelTime.source,
        updatedAt: tt.travelTime.measuredAt,
        isDemo: tt.travelTime.isDemo,
      },
    });
    return { ...r, isDemo: tt.travelTime.isDemo };
  }
  // Hendelsen er borte fra kilden; vi har bare det som ble lagret i tilstanden.
  const state = states.find((s) => s.itemKey === action.key);
  // Nøkkelformat: "ev:<kilde>:<id>" eller "tt:<kilde>:tt:<id>".
  const source = action.key.split(":")[1] ?? "";
  const r = formatAlert({
    ...base,
    item: {
      category: (state?.lastCategory as Category | null) ?? "other",
      title: "Tidligere varslet hendelse",
      description: "Hendelsen er ikke lenger registrert hos kilden.",
      delayMin: null,
      delayKind: null,
      source,
      updatedAt: null,
      isDemo: source === "demo",
    },
  });
  return { ...r, isDemo: source === "demo" };
}
