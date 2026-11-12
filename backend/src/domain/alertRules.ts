import type { DirectionMatch } from "./matching.js";
import type { Category, NotificationSettings, SegmentDirection } from "./types.js";

/** Noe som kan utløse varsel på en strekning: en hendelse eller en målt reisetid. */
export interface Candidate {
  key: string;
  source: string;
  kind: "event" | "travel_time";
  category: Category;
  severity: number;
  /** Målt (reisetid) eller oppgitt (hendelse) forsinkelse i minutter. */
  delayMin: number | null;
  /** Endres når innholdet i meldingen endres. */
  fingerprint: string;
  direction: DirectionMatch;
}

export interface AlertState {
  itemKey: string;
  source: string;
  notified: boolean;
  firstMatchedAt: Date;
  lastMatchedAt: Date;
  lastNotifiedAt: Date | null;
  lastCategory: Category | null;
  lastSeverity: number | null;
  lastDelayMin: number | null;
  lastFingerprint: string | null;
}

export interface AlertContext {
  now: Date;
  settings: NotificationSettings;
  segmentDirection: SegmentDirection;
  /** Både listen og strekningen er aktiv. */
  monitoringActive: boolean;
  /** Innenfor valgt tidsrom. */
  inWindow: boolean;
  /** Kilder med vellykket og fersk henting. Tilstand fra andre kilder røres ikke. */
  healthySources: Set<string>;
}

export interface AlertAction {
  type: "new" | "update" | "resolved";
  key: string;
  reason: string;
}

export interface AlertOutcome {
  actions: AlertAction[];
  upserts: AlertState[];
  deletes: string[];
}

export const RULES = {
  /** Minste tid mellom to oppdateringer om samme hendelse (unntatt opptrapping). */
  updateMinIntervalMin: 10,
  /** Endret meldingstekst alene gir ny melding tidligst etter så mange minutter. */
  textChangeMinIntervalMin: 30,
  /** Forsinkelsen må endres med minst så mange minutter ... */
  delayChangeAbsMin: 5,
  /** ... og med minst denne andelen av sist varslede forsinkelse. */
  delayChangeRel: 0.3,
  /** En åpen kø regnes som over først når forsinkelsen er under halve terskelen. */
  resolveBelowThresholdFactor: 0.5,
};

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60000;
}

function directionOk(c: Candidate, ctx: AlertContext): boolean {
  if (ctx.segmentDirection === "both") return true;
  if (c.direction === "opposite") return false;
  if (c.direction === "unknown") return ctx.settings.includeUnknownDirection;
  return true;
}

/** Om kandidaten i seg selv oppfyller brukerens valg (type, retning, terskel). */
export function isEligible(c: Candidate, ctx: AlertContext): boolean {
  if (!ctx.settings.eventTypes.includes(c.category)) return false;
  if (!directionOk(c, ctx)) return false;
  if (c.kind === "travel_time") return (c.delayMin ?? 0) >= ctx.settings.delayThresholdMin;
  // Stengt veg varsles uansett oppgitt forsinkelse.
  if (c.category !== "closure" && c.delayMin !== null && c.delayMin < ctx.settings.delayThresholdMin) return false;
  return true;
}

function significantChange(c: Candidate, s: AlertState, now: Date): string | null {
  const sinceLast = s.lastNotifiedAt ? minutesBetween(s.lastNotifiedAt, now) : Infinity;
  if (c.category === "closure" && s.lastCategory !== "closure") return "Vegen er nå meldt stengt";
  if (s.lastSeverity !== null && c.severity > s.lastSeverity) return "Alvorlighetsgraden har økt";
  if (sinceLast < RULES.updateMinIntervalMin) return null;
  if (c.delayMin !== null && s.lastDelayMin !== null) {
    const diff = Math.abs(c.delayMin - s.lastDelayMin);
    if (diff >= RULES.delayChangeAbsMin && diff >= RULES.delayChangeRel * s.lastDelayMin) {
      return c.delayMin > s.lastDelayMin ? "Forsinkelsen har økt" : "Forsinkelsen har gått ned";
    }
  }
  if (c.fingerprint !== s.lastFingerprint && sinceLast >= RULES.textChangeMinIntervalMin) {
    return "Meldingen er oppdatert";
  }
  return null;
}

function notifiedState(c: Candidate, prev: AlertState | undefined, now: Date): AlertState {
  return {
    itemKey: c.key,
    source: c.source,
    notified: true,
    firstMatchedAt: prev?.firstMatchedAt ?? now,
    lastMatchedAt: now,
    lastNotifiedAt: now,
    lastCategory: c.category,
    lastSeverity: c.severity,
    lastDelayMin: c.delayMin,
    lastFingerprint: c.fingerprint,
  };
}

/**
 * Avgjør hvilke varsler som skal sendes for én strekning, ut fra hva som er
 * funnet nå og hva brukeren allerede har fått beskjed om. Ren funksjon uten
 * sideeffekter, slik at reglene kan testes isolert.
 */
export function evaluateAlerts(
  candidates: Candidate[],
  states: AlertState[],
  ctx: AlertContext,
): AlertOutcome {
  const { now } = ctx;
  const mayNotify = ctx.monitoringActive && ctx.inWindow;
  const stateByKey = new Map(states.map((s) => [s.itemKey, s]));
  const outcome: AlertOutcome = { actions: [], upserts: [], deletes: [] };
  const keep = new Set<string>();

  for (const c of candidates) {
    const prev = stateByKey.get(c.key);
    if (!isEligible(c, ctx)) {
      const holdOpen =
        prev?.notified &&
        c.kind === "travel_time" &&
        directionOk(c, ctx) &&
        (c.delayMin ?? 0) >= ctx.settings.delayThresholdMin * RULES.resolveBelowThresholdFactor;
      if (holdOpen && prev) {
        keep.add(c.key);
        outcome.upserts.push({ ...prev, lastMatchedAt: now });
      }
      continue;
    }
    keep.add(c.key);

    if (!prev || !prev.notified) {
      if (mayNotify) {
        outcome.actions.push({ type: "new", key: c.key, reason: "Ny hendelse på strekningen" });
        outcome.upserts.push(notifiedState(c, prev, now));
      } else {
        outcome.upserts.push({
          itemKey: c.key,
          source: c.source,
          notified: false,
          firstMatchedAt: prev?.firstMatchedAt ?? now,
          lastMatchedAt: now,
          lastNotifiedAt: null,
          lastCategory: null,
          lastSeverity: null,
          lastDelayMin: null,
          lastFingerprint: null,
        });
      }
      continue;
    }

    const reason = mayNotify ? significantChange(c, prev, now) : null;
    if (reason) {
      outcome.actions.push({ type: "update", key: c.key, reason });
      outcome.upserts.push(notifiedState(c, prev, now));
    } else {
      outcome.upserts.push({ ...prev, lastMatchedAt: now });
    }
  }

  for (const s of states) {
    if (keep.has(s.itemKey)) continue;
    // Uten fersk data fra kilden vet vi ikke om hendelsen er over.
    if (!ctx.healthySources.has(s.source)) continue;
    if (s.notified && ctx.settings.notifyOnResolved && mayNotify) {
      outcome.actions.push({ type: "resolved", key: s.itemKey, reason: "Hendelsen er ikke lenger registrert" });
    }
    outcome.deletes.push(s.itemKey);
  }

  return outcome;
}
