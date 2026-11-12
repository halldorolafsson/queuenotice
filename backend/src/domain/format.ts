import { CATEGORY_LABELS } from "./events.js";
import { displayRoadNumber } from "./roads.js";
import { formatOslo } from "./schedule.js";
import type { Category, SegmentDirection } from "./types.js";

export const SOURCE_NAMES: Record<string, string> = {
  vegvesen: "Statens vegvesen",
  google: "Google Maps",
  demo: "Demodata",
};

export const SOURCE_DESCRIPTIONS: Record<string, string> = {
  vegvesen:
    "Trafikkmeldinger om stengte veger, ulykker, vegarbeid og kolonnekjøring, og målte reisetider rundt Trondheim. Gratis.",
  google:
    "Estimert forsinkelse for hele strekningen ut fra Googles trafikkdata. Gir ikke meldinger om stengte veger eller ulykker. Betalt per kall over gratiskvoten.",
  demo: "Eksempeldata for testing. Ikke ekte trafikkinformasjon.",
};

export interface AlertMessageInput {
  kind: "new" | "update" | "resolved";
  reason: string;
  segment: { name: string; roadNumber: string; startName: string; endName: string; direction: SegmentDirection };
  item: {
    category: Category;
    /** Overstyrer kategorinavnet, f.eks. "Målt forsinkelse" for reisetider. */
    label?: string;
    title: string;
    description: string;
    delayMin: number | null;
    delayKind: "measured" | "estimated" | "reported" | null;
    source: string;
    updatedAt: Date | null;
    isDemo: boolean;
  };
}

export function formatAlert(input: AlertMessageInput): { title: string; body: string } {
  const { kind, reason, segment, item } = input;
  const label = item.label ?? CATEGORY_LABELS[item.category];
  const road = displayRoadNumber(segment.roadNumber);
  const prefix = item.isDemo ? "[DEMO] " : "";
  const title =
    kind === "resolved"
      ? `${prefix}Over: ${label} – ${segment.name}`
      : kind === "update"
        ? `${prefix}Oppdatert: ${label} – ${segment.name}`
        : `${prefix}${label} – ${segment.name}`;

  const direction =
    segment.direction === "both" ? "begge retninger" : `kjøreretning mot ${segment.endName}`;
  const lines = [
    `Strekning: ${[road, segment.startName].filter(Boolean).join(" ")} – ${segment.endName} (${direction})`,
    `Hendelse: ${label}. ${item.description.split("|").map((s) => s.trim()).filter(Boolean).join(" ")}`.trim(),
    `Sted: ${item.title}`,
  ];
  if (item.delayMin !== null && kind !== "resolved") {
    const how =
      item.delayKind === "measured"
        ? "beregnet fra målt reisetid"
        : item.delayKind === "estimated"
          ? "estimert av Google Maps"
          : "oppgitt av kilden";
    lines.push(`Forsinkelse: ca. ${item.delayMin} min (${how})`);
  }
  const source = SOURCE_NAMES[item.source] ?? item.source;
  lines.push(`Kilde: ${source}${item.updatedAt ? `, oppdatert ${formatOslo(item.updatedAt)}` : ""}`);
  if (kind !== "new") lines.push(reason);
  if (item.isDemo) lines.push("DEMODATA – ikke ekte trafikkinformasjon.");
  return { title, body: lines.join("\n") };
}
