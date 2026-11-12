import type { LonLat } from "./types.js";

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON_EQ = 111_320;

/** Lokal flat projeksjon i meter. God nok for strekninger på noen titalls km. */
export class LocalProjection {
  private readonly cosLat: number;
  constructor(private readonly refLat: number, private readonly refLon: number) {
    this.cosLat = Math.cos((refLat * Math.PI) / 180);
  }
  toXY([lon, lat]: LonLat): [number, number] {
    return [(lon - this.refLon) * M_PER_DEG_LON_EQ * this.cosLat, (lat - this.refLat) * M_PER_DEG_LAT];
  }
}

export interface Projected {
  /** Avstand i meter fra punktet til nærmeste punkt på linjen. */
  distance: number;
  /** Avstand i meter langs linjen fra første punkt til nærmeste punkt. */
  chainage: number;
}

export class Polyline {
  readonly xy: Array<[number, number]>;
  readonly cumulative: number[];
  readonly length: number;
  readonly projection: LocalProjection;

  constructor(readonly coords: LonLat[]) {
    if (coords.length === 0) throw new Error("Tom linje");
    const [lon0, lat0] = coords[0]!;
    this.projection = new LocalProjection(lat0, lon0);
    this.xy = coords.map((c) => this.projection.toXY(c));
    this.cumulative = [0];
    for (let i = 1; i < this.xy.length; i++) {
      const [x1, y1] = this.xy[i - 1]!;
      const [x2, y2] = this.xy[i]!;
      this.cumulative.push(this.cumulative[i - 1]! + Math.hypot(x2 - x1, y2 - y1));
    }
    this.length = this.cumulative[this.cumulative.length - 1]!;
    const xs = this.xy.map((p) => p[0]);
    const ys = this.xy.map((p) => p[1]);
    this.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  readonly bbox: [number, number, number, number];

  /** Rask grovsjekk før den dyrere projeksjonen. */
  nearBBox(point: LonLat, marginM: number): boolean {
    const [x, y] = this.projection.toXY(point);
    const [minX, minY, maxX, maxY] = this.bbox;
    return x >= minX - marginM && x <= maxX + marginM && y >= minY - marginM && y <= maxY + marginM;
  }

  project(point: LonLat): Projected {
    const [px, py] = this.projection.toXY(point);
    if (this.xy.length === 1) {
      const [x, y] = this.xy[0]!;
      return { distance: Math.hypot(px - x, py - y), chainage: 0 };
    }
    let best: Projected = { distance: Infinity, chainage: 0 };
    for (let i = 1; i < this.xy.length; i++) {
      const [x1, y1] = this.xy[i - 1]!;
      const [x2, y2] = this.xy[i]!;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
      const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
      if (d < best.distance) {
        best = { distance: d, chainage: this.cumulative[i - 1]! + t * Math.sqrt(len2) };
      }
    }
    return best;
  }
}

export function distanceM(a: LonLat, b: LonLat): number {
  const p = new LocalProjection(a[1], a[0]);
  const [x, y] = p.toXY(b);
  return Math.hypot(x, y);
}

/** Legger inn ekstra punkter slik at ingen kant er lengre enn maxStepM. */
export function densify(line: LonLat[], maxStepM: number): LonLat[] {
  if (line.length < 2) return line.slice();
  const out: LonLat[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const steps = Math.ceil(distanceM(a, b) / maxStepM);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
