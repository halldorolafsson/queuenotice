import type { TrafficEvent, TravelTime } from "../domain/types.js";
import type { SourceSnapshot, TrafficSource } from "./types.js";

/**
 * Faste eksempeldata langs E6 Okstadbakken–Ranheim i Trondheim.
 * Brukes til utvikling og demonstrasjon. Alt merkes isDemo = true og vises
 * med tydelig DEMO-merking i grensesnitt og varsler.
 */
export class DemoSource implements TrafficSource {
  readonly id = "demo";
  readonly name = "Demodata";
  readonly isDemo = true;

  async fetchSnapshot(now: Date): Promise<SourceSnapshot> {
    const start = new Date(now.getTime() - 25 * 60000);
    const end = new Date(now.getTime() + 90 * 60000);
    const base = {
      source: "demo",
      version: "demo-1",
      secondaryTypes: [] as string[],
      activePeriods: [] as Array<[Date, Date]>,
      startTime: start,
      endTime: end,
      sourceUpdatedAt: start,
      isDemo: true,
      roadNumbers: ["E6"],
    };
    const events: TrafficEvent[] = [
      {
        ...base,
        id: "demo:queue-moholt",
        sourceId: "queue-moholt",
        category: "queue",
        situationType: "AbnormalTraffic",
        secondaryTypes: ["queuingTraffic"],
        severity: 2,
        title: "DEMO: E6 Moholt i Trondheim, i retning mot Ranheim",
        description: "DEMO: Kø.|Eksempelmelding, ikke ekte trafikkdata.",
        lines: [[[10.42977, 63.40774], [10.43886, 63.40799], [10.44553, 63.41134]]],
        direction: "one",
        reportedDelayMin: 15,
      },
      {
        ...base,
        id: "demo:accident-sluppen",
        sourceId: "accident-sluppen",
        category: "accident",
        situationType: "Accident",
        severity: 3,
        title: "DEMO: E6 ved Sluppen i Trondheim",
        description: "DEMO: Trafikkulykke, ett felt stengt.|Eksempelmelding, ikke ekte trafikkdata.",
        lines: [[[10.3942, 63.39865]]],
        direction: "both",
        reportedDelayMin: null,
      },
    ];
    const travelTimes: TravelTime[] = [
      {
        id: "demo:tt:sluppen-moholt",
        source: "demo",
        name: "DEMO: E6 Sluppen - E6 Moholt",
        line: [[10.39957, 63.40112], [10.40736, 63.40241], [10.41747, 63.40579], [10.42977, 63.40774], [10.43886, 63.40799]],
        actualSec: 960,
        expectedSec: 120 + 60,
        delaySec: 960 - 180,
        statusValue: "congested",
        measuredAt: new Date(now.getTime() - 2 * 60000),
        isDemo: true,
      },
    ];
    return { events, travelTimes, fetchedAt: now };
  }
}
