import type { EventDirection, Segment, TrafficEvent, TravelTime } from "../domain/types.js";

/** Et komplett øyeblikksbilde fra en kilde for hele overvåkingsområdet. */
export interface SourceSnapshot {
  events: TrafficEvent[];
  /** null betyr at kilden ikke leverer reisetider. */
  travelTimes: TravelTime[] | null;
  /** Sant når bare noen reisetider er oppdatert; de andre beholdes til de blir gamle. */
  partialTravelTimes?: boolean;
  fetchedAt: Date;
}

export interface MonitoredSegment {
  segment: Segment;
  /** Liste og strekning er aktive, og klokka er innenfor tidsrommet. */
  activeNow: boolean;
  hasSchedule: boolean;
  /** Kilder eieren av strekningen har slått av. */
  disabledSources: string[];
}

/** Det kilder som spør per strekning (Google Routes) trenger å vite. */
export interface SourceContext {
  monitored: MonitoredSegment[];
  lastMeasured(travelTimeId: string): Date | null;
  usage: {
    today(): Promise<number>;
    thisMonth(): Promise<number>;
    record(calls: number): Promise<void>;
  };
}

/**
 * Felles grensesnitt for alle trafikkilder. En ny kilde (f.eks. Politiet)
 * implementerer dette og registreres i registry.ts.
 */
export interface TrafficSource {
  readonly id: string;
  readonly name: string;
  readonly isDemo: boolean;
  fetchSnapshot(now: Date, ctx: SourceContext): Promise<SourceSnapshot>;
  /** Valgfritt: slå opp berørt kjøreretning for enkelthendelser. */
  lookupDirection?(sourceId: string): Promise<EventDirection>;
}
