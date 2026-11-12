import type { Candidate } from "../domain/alertRules.js";
import { groupDuplicates } from "../domain/dedupe.js";
import { eventActivity, nextPeriodStart, type Activity } from "../domain/events.js";
import { Polyline } from "../domain/geo.js";
import { isDirectionRelevant, matchEvent, matchTravelTime, type EventMatch, type TravelTimeMatch } from "../domain/matching.js";
import { isWithinSchedule } from "../domain/schedule.js";
import { freshness, segmentStatus, type Freshness, type SegmentStatus, type SourceStatusRow } from "../domain/status.js";
import type { NotificationSettings, ScheduleRule, Segment, TrafficEvent, TravelTime } from "../domain/types.js";

export interface MatchedEvent {
  event: TrafficEvent;
  match: EventMatch;
  activity: Activity;
  nextStart: Date | null;
  /** Gjelder kjøreretningen som overvåkes (eller retningen er ukjent). */
  relevant: boolean;
  /** Typen er valgt under «Hva skal varsles». */
  followed: boolean;
  alsoReportedBy: string[];
}

export interface MatchedTravelTime {
  travelTime: TravelTime;
  match: TravelTimeMatch;
  delayMin: number | null;
  fresh: boolean;
}

export interface SegmentAnalysis {
  status: SegmentStatus;
  paused: boolean;
  inWindow: boolean;
  events: MatchedEvent[];
  travelTimes: MatchedTravelTime[];
  /** Sum av målt forsinkelse i overvåket retning, når den kan beregnes. */
  measuredDelayMin: number | null;
  /** Sant hvis demodata inngår i den målte forsinkelsen. */
  measuredDelayIsDemo: boolean;
  /** Estimert forsinkelse fra Google Maps for hele strekningen, når den finnes. */
  estimatedDelayMin: number | null;
  sources: Array<{ source: string; freshness: Freshness }>;
  usesDemoData: boolean;
}

export interface AnalyzeInput {
  segment: Segment;
  listActive: boolean;
  schedule: ScheduleRule[];
  settings: NotificationSettings;
  events: TrafficEvent[];
  travelTimes: TravelTime[];
  sourceStatuses: SourceStatusRow[];
  enabledSources: string[];
  now: Date;
  staleAfterMin: number;
}

const polylineCache = new WeakMap<object, Polyline>();

/** Kildene som gjelder for brukeren: skrudd på på serveren og ikke slått av av brukeren. */
export function userSources(serverSources: string[], settings: Pick<NotificationSettings, "disabledSources">): string[] {
  return serverSources.filter((s) => !settings.disabledSources.includes(s));
}
export function polylineFor(segment: Segment): Polyline {
  let p = polylineCache.get(segment.geometry);
  if (!p) {
    p = new Polyline(segment.geometry);
    polylineCache.set(segment.geometry, p);
  }
  return p;
}

export function analyzeSegment(input: AnalyzeInput): SegmentAnalysis {
  const { segment, now, settings } = input;
  const polyline = polylineFor(segment);
  const paused = !input.listActive || !segment.active;
  const inWindow = isWithinSchedule(input.schedule, now);

  const fresh = new Map(
    input.enabledSources.map((s) => [
      s,
      freshness(input.sourceStatuses.find((r) => r.source === s), now, input.staleAfterMin),
    ]),
  );

  const matched: Array<{ event: TrafficEvent; match: EventMatch }> = [];
  for (const event of input.events) {
    if (!fresh.has(event.source)) continue;
    const match = matchEvent(segment, polyline, event);
    if (match) matched.push({ event, match });
  }
  const matchById = new Map(matched.map((m) => [m.event.id, m.match]));
  const events: MatchedEvent[] = [];
  for (const group of groupDuplicates(matched.map((m) => m.event))) {
    const e = group.primary;
    const activity = eventActivity(e, now);
    if (activity === "expired") continue;
    const match = matchById.get(e.id)!;
    events.push({
      event: e,
      match,
      activity,
      nextStart: activity === "planned" ? nextPeriodStart(e, now) : null,
      relevant: isDirectionRelevant(segment, match, true),
      followed: settings.eventTypes.includes(e.category),
      alsoReportedBy: group.duplicates.map((d) => d.source),
    });
  }
  events.sort((a, b) => a.match.fromChainageM - b.match.fromChainageM);

  const travelTimes: MatchedTravelTime[] = [];
  for (const tt of input.travelTimes) {
    if (!fresh.has(tt.source)) continue;
    let match: TravelTimeMatch | null;
    if (tt.segmentId) {
      // Beregnet for én bestemt strekning; brukes bare der.
      if (tt.segmentId !== segment.id || !tt.segmentDirection) continue;
      if (segment.direction === "forward" && tt.segmentDirection === "opposite") continue;
      match = { travelTimeId: tt.id, overlapM: Math.round(polyline.length), direction: tt.segmentDirection };
    } else {
      match = matchTravelTime(segment, polyline, tt);
    }
    if (!match) continue;
    const ageMin = tt.measuredAt ? (now.getTime() - tt.measuredAt.getTime()) / 60000 : Infinity;
    travelTimes.push({
      travelTime: tt,
      match,
      delayMin: tt.delaySec === null ? null : Math.round(tt.delaySec / 60),
      fresh: ageMin <= input.staleAfterMin,
    });
  }

  const forwardOf = (kind: "measured" | "estimated") =>
    travelTimes.filter(
      (t) => (t.travelTime.kind ?? "measured") === kind && t.match.direction === "same" && t.fresh && t.delayMin !== null,
    );
  const sumDelay = (list: MatchedTravelTime[]) => (list.length ? list.reduce((s, t) => s + Math.max(0, t.delayMin!), 0) : null);
  const forward = forwardOf("measured");
  const measuredDelayMin = sumDelay(forward);
  const estimatedDelayMin = sumDelay(forwardOf("estimated"));

  // Status bygger bare på typene brukeren følger; reisetider teller som «Kø og forsinkelse».
  const hasRelevantItems =
    events.some((e) => e.activity === "active" && e.relevant && e.followed) ||
    (settings.eventTypes.includes("queue") &&
      travelTimes.some((t) => t.fresh && (t.delayMin ?? 0) >= settings.delayThresholdMin));

  const sources = [...fresh].map(([source, f]) => ({ source, freshness: f }));
  return {
    status: segmentStatus({ paused, hasRelevantItems, sourceFreshness: sources.map((s) => s.freshness) }),
    paused,
    inWindow,
    events,
    travelTimes,
    measuredDelayMin,
    measuredDelayIsDemo: forward.some((t) => t.travelTime.isDemo),
    estimatedDelayMin,
    sources,
    usesDemoData: events.some((e) => e.event.isDemo) || travelTimes.some((t) => t.travelTime.isDemo),
  };
}

/** Gjør analysen om til varslingskandidater. Bare ferske kilder og aktive hendelser. */
export function candidatesFrom(analysis: SegmentAnalysis): Candidate[] {
  const freshSources = new Set(analysis.sources.filter((s) => s.freshness === "fresh").map((s) => s.source));
  const out: Candidate[] = [];
  for (const m of analysis.events) {
    if (m.activity !== "active" || !freshSources.has(m.event.source)) continue;
    out.push({
      key: `ev:${m.event.id}`,
      source: m.event.source,
      kind: "event",
      category: m.event.category,
      severity: m.event.severity,
      delayMin: m.event.reportedDelayMin,
      fingerprint: `${m.event.category}|${m.event.severity}|${m.event.description}`,
      direction: m.match.direction,
    });
  }
  for (const t of analysis.travelTimes) {
    if (!t.fresh || t.delayMin === null || !freshSources.has(t.travelTime.source)) continue;
    out.push({
      key: `tt:${t.travelTime.id}`,
      source: t.travelTime.source,
      kind: "travel_time",
      category: "queue",
      severity: 0,
      delayMin: t.delayMin,
      fingerprint: `tt|${t.travelTime.name}`,
      direction: t.match.direction,
    });
  }
  return out;
}
