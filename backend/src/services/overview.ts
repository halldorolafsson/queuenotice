import { config, enabledSources } from "../config.js";
import type { Db } from "../db/index.js";
import { CATEGORY_LABELS } from "../domain/events.js";
import { SOURCE_NAMES } from "../domain/format.js";
import { freshness } from "../domain/status.js";
import { analyzeSegment, userSources, type MatchedEvent } from "./analyze.js";
import * as repo from "./repo.js";

function eventJson(m: MatchedEvent) {
  const e = m.event;
  return {
    id: e.id,
    category: e.category,
    categoryLabel: CATEGORY_LABELS[e.category],
    title: e.title,
    description: e.description.split("|").map((s) => s.trim()).filter(Boolean),
    severity: e.severity,
    direction: m.match.direction,
    relevant: m.relevant,
    followed: m.followed,
    reportedDelayMin: e.reportedDelayMin,
    startTime: e.startTime,
    endTime: e.endTime,
    nextStart: m.nextStart,
    hasPeriods: e.activePeriods.length > 0,
    updatedAt: e.sourceUpdatedAt,
    source: e.source,
    sourceName: SOURCE_NAMES[e.source] ?? e.source,
    isDemo: e.isDemo,
    alsoReportedBy: m.alsoReportedBy.map((s) => SOURCE_NAMES[s] ?? s),
    positionKm: Math.round(m.match.fromChainageM / 100) / 10,
  };
}

export async function buildOverview(db: Db, userId: string, now = new Date()) {
  const [settings, lists, segments, events, travelTimes, statuses, lastPoll] = await Promise.all([
    repo.getSettings(db, userId),
    repo.getLists(db, userId),
    repo.getSegments(db, userId),
    repo.loadPresentEvents(db),
    repo.loadPresentTravelTimes(db),
    repo.getSourceStatuses(db),
    repo.lastPollRun(db),
  ]);
  const enabled = enabledSources();
  const mine = userSources(enabled, settings);

  return {
    generatedAt: now,
    notifyMode: config.NOTIFY_MODE,
    staleAfterMinutes: config.STALE_AFTER_MINUTES,
    lastPoll,
    sources: enabled.map((id) => {
      const s = statuses.find((r) => r.source === id);
      return {
        id,
        name: SOURCE_NAMES[id] ?? id,
        isDemo: id === "demo",
        disabledByUser: !mine.includes(id),
        freshness: freshness(s, now, config.STALE_AFTER_MINUTES),
        lastSuccessAt: s?.lastSuccessAt ?? null,
        lastAttemptAt: s?.lastAttemptAt ?? null,
        lastError: s?.lastError ?? null,
        consecutiveFailures: s?.consecutiveFailures ?? 0,
        itemCount: s?.lastItemCount ?? null,
      };
    }),
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      active: list.active,
      schedule: list.schedule,
      segments: segments
        .filter((s) => s.listId === list.id)
        .map((segment) => {
          const a = analyzeSegment({
            segment,
            listActive: list.active,
            schedule: list.schedule,
            settings,
            events,
            travelTimes,
            sourceStatuses: statuses,
            enabledSources: mine,
            now,
            staleAfterMin: config.STALE_AFTER_MINUTES,
          });
          return {
            id: segment.id,
            name: segment.name,
            roadNumber: segment.roadNumber,
            roadNumbers: segment.roadNumbers ?? [],
            startName: segment.startName,
            endName: segment.endName,
            direction: segment.direction,
            active: segment.active,
            geometrySource: segment.geometrySource,
            geometryNote: segment.geometryNote,
            status: a.status,
            inWindow: a.inWindow,
            measuredDelayMin: a.measuredDelayMin,
            measuredDelayIsDemo: a.measuredDelayIsDemo,
            estimatedDelayMin: a.estimatedDelayMin,
            usesDemoData: a.usesDemoData,
            events: a.events.filter((m) => m.activity === "active").map(eventJson),
            plannedEvents: a.events.filter((m) => m.activity === "planned").map(eventJson),
            travelTimes: a.travelTimes.map((t) => ({
              id: t.travelTime.id,
              name: t.travelTime.name,
              direction: t.match.direction,
              actualMin: t.travelTime.actualSec === null ? null : Math.round(t.travelTime.actualSec / 60),
              expectedMin: t.travelTime.expectedSec === null ? null : Math.round(t.travelTime.expectedSec / 60),
              delayMin: t.delayMin,
              statusValue: t.travelTime.statusValue,
              measuredAt: t.travelTime.measuredAt,
              fresh: t.fresh,
              source: t.travelTime.source,
              kind: t.travelTime.kind ?? "measured",
              isDemo: t.travelTime.isDemo,
            })),
          };
        }),
    })),
  };
}
