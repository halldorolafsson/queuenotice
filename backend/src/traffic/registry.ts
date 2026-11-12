import { enabledSources } from "../config.js";
import { DemoSource } from "./demoSource.js";
import { createGoogleRoutesSource } from "./googleRoutes.js";
import type { TrafficSource } from "./types.js";
import { VegvesenWfsSource } from "./vegvesenWfs.js";

const factories: Record<string, () => TrafficSource> = {
  vegvesen: () => new VegvesenWfsSource(),
  google: createGoogleRoutesSource,
  demo: () => new DemoSource(),
};

export function createSources(ids: string[] = enabledSources()): TrafficSource[] {
  return ids.map((id) => {
    const factory = factories[id];
    if (!factory) throw new Error(`Ukjent trafikkilde i TRAFFIC_SOURCES: ${id}`);
    return factory();
  });
}
