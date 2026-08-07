/**
 * Kreis-Packing: bringt so viele Domes, Magnete oder Schalter wie moeglich
 * in einen beliebigen Umriss.
 *
 * Der teure Teil ist der Test "passt der Kreis noch ganz hinein". Statt ihn
 * fuer jede Gitterlage neu gegen das Polygon zu rechnen, wird einmal ein
 * Abstandsfeld aufgebaut und danach nur noch interpoliert.
 */

import type { Vec2 } from '../geo/mesh.ts';
import {
  distanceToEdges,
  pointInPolygon,
  polyBounds,
  type Poly,
  type Region,
} from '../geo/shapes2d.ts';

/** Vorzeichenbehaftetes Abstandsfeld einer Region auf einem regelmaessigen Gitter. */
export class DistanceField {
  readonly minX: number;
  readonly minY: number;
  readonly cell: number;
  readonly nx: number;
  readonly ny: number;
  private readonly data: Float32Array;
  private readonly reg: Region;

  constructor(reg: Region, cell = 0.5) {
    this.reg = reg;
    const b = polyBounds(reg.outline);
    const pad = cell * 2;
    this.cell = cell;
    this.minX = b.minX - pad;
    this.minY = b.minY - pad;
    this.nx = Math.max(2, Math.ceil((b.width + pad * 2) / cell) + 1);
    this.ny = Math.max(2, Math.ceil((b.height + pad * 2) / cell) + 1);
    this.data = new Float32Array(this.nx * this.ny);

    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.minX + i * cell;
        const y = this.minY + j * cell;
        this.data[j * this.nx + i] = exactDistance(reg, x, y);
      }
    }
  }

  /** Bilinear interpolierter Abstand; ausserhalb des Gitters stark negativ. */
  sample(x: number, y: number): number {
    const fx = (x - this.minX) / this.cell;
    const fy = (y - this.minY) / this.cell;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.ny - 1) return -1e6;
    const tx = fx - i;
    const ty = fy - j;
    const d = this.data;
    const n = this.nx;
    const a = d[j * n + i];
    const b = d[j * n + i + 1];
    const c = d[(j + 1) * n + i];
    const e = d[(j + 1) * n + i + 1];
    return (
      a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + e * tx * ty
    );
  }

  /**
   * Passt ein Kreis mit Radius `clearance` um (x, y)?
   *
   * Die Interpolation kann sich um bis zu eine halbe Zellbreite irren. Nur im
   * Zweifelsband wird exakt nachgerechnet - das haelt die Schleife schnell und
   * das Ergebnis trotzdem korrekt.
   */
  fits(x: number, y: number, clearance: number): boolean {
    const d = this.sample(x, y);
    const band = this.cell;
    if (d > clearance + band) return true;
    if (d < clearance - band) return false;
    return exactDistance(this.reg, x, y) >= clearance;
  }
}

function exactDistance(reg: Region, x: number, y: number): number {
  let d = distanceToEdges(reg.outline, x, y);
  if (!pointInPolygon(reg.outline, x, y)) return -d;
  for (const hole of reg.holes) {
    const dh = distanceToEdges(hole, x, y);
    if (pointInPolygon(hole, x, y)) return -dh;
    if (dh < d) d = dh;
  }
  return d;
}

export type PackPattern = 'hex' | 'grid' | 'radial' | 'sunflower';

export const PACK_PATTERNS: { id: PackPattern; label: string; description: string }[] = [
  {
    id: 'hex',
    label: 'Wabe (dichteste Packung)',
    description: 'Versetzte Reihen im 60-Grad-Raster. Bringt bei gleicher Flaeche rund 15 % mehr Blasen unter als ein Schachbrett.',
  },
  {
    id: 'grid',
    label: 'Raster (Reihen und Spalten)',
    description: 'Klassisches Pop-It-Muster mit geraden Zeilen. Etwas weniger Blasen, dafuer sehr aufgeraeumt.',
  },
  {
    id: 'radial',
    label: 'Ringe',
    description: 'Konzentrische Kreise um die Mitte - passt zu runden und blumenfoermigen Umrissen.',
  },
  {
    id: 'sunflower',
    label: 'Sonnenblume',
    description: 'Spirale im goldenen Winkel. Sieht organisch aus und kommt der dichtesten Packung nahe.',
  },
];

export interface PackOptions {
  /** Mindestabstand von Mittelpunkt zu Mittelpunkt in mm. */
  pitch: number;
  /** Mindestabstand vom Mittelpunkt zum Rand (und zu Loechern) in mm. */
  edgeClearance: number;
  pattern: PackPattern;
  /** Gitter drehen und verschieben, um die Ausbeute zu maximieren. */
  optimize?: boolean;
  /** Obergrenze, z. B. die Zahl vorhandener Domes. Die aeussersten fallen weg. */
  maxCount?: number;
  /** Aufloesung des Abstandsfelds; kleiner = genauer, aber langsamer. */
  fieldCell?: number;
}

export interface PackResult {
  points: Vec2[];
  pattern: PackPattern;
  /** Drehung des Gitters in Radiant. */
  rotation: number;
  offset: Vec2;
  /** Anteil der Umrissflaeche, den die Kreise bedecken. */
  density: number;
  /** Wie viele Gitterlagen ausprobiert wurden. */
  tried: number;
  /** Wie viele Punkte die Obergrenze gekappt hat. */
  clipped: number;
}

export function packCircles(reg: Region, opts: PackOptions): PackResult {
  const pitch = Math.max(0.5, opts.pitch);
  const clearance = Math.max(0, opts.edgeClearance);
  const field = new DistanceField(reg, opts.fieldCell ?? Math.min(0.6, pitch / 6));
  const b = polyBounds(reg.outline);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;

  const lattices = candidateLattices(opts.pattern, opts.optimize !== false);
  let best: { pts: Vec2[]; rot: number; off: Vec2 } = { pts: [], rot: 0, off: [0, 0] };
  let tried = 0;

  for (const { rot, off } of lattices) {
    tried++;
    const pts = generate(opts.pattern, b, pitch, rot, off, cx, cy, field, clearance);
    if (pts.length > best.pts.length) best = { pts, rot, off };
  }

  let points = best.pts;
  let clipped = 0;
  if (opts.maxCount != null && points.length > opts.maxCount) {
    clipped = points.length - opts.maxCount;
    points = points
      .slice()
      .sort((p, q) => dist2(p, cx, cy) - dist2(q, cx, cy))
      .slice(0, opts.maxCount);
  }

  // Stabile Reihenfolge: zeilenweise von unten nach oben.
  points.sort((p, q) => (Math.abs(p[1] - q[1]) > pitch * 0.4 ? p[1] - q[1] : p[0] - q[0]));

  const outlineArea = Math.abs(polygonArea(reg.outline));
  const circleArea = points.length * Math.PI * (pitch / 2) ** 2;

  return {
    points,
    pattern: opts.pattern,
    rotation: best.rot,
    offset: best.off,
    density: outlineArea > 0 ? circleArea / outlineArea : 0,
    tried,
    clipped,
  };
}

function dist2(p: Vec2, cx: number, cy: number): number {
  return (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
}

function polygonArea(poly: Poly): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return s / 2;
}

interface Lattice {
  rot: number;
  off: Vec2;
}

function candidateLattices(pattern: PackPattern, optimize: boolean): Lattice[] {
  if (!optimize) return [{ rot: 0, off: [0, 0] }];

  const out: Lattice[] = [];
  if (pattern === 'radial' || pattern === 'sunflower') {
    // Diese Muster haengen an der Mitte; nur die Drehung bringt etwas.
    for (let r = 0; r < 12; r++) out.push({ rot: (r / 12) * (Math.PI / 3), off: [0, 0] });
    return out;
  }

  const symmetry = pattern === 'hex' ? Math.PI / 3 : Math.PI / 2;
  const rotSteps = 12;
  const offSteps = 4;
  for (let r = 0; r < rotSteps; r++) {
    const rot = (r / rotSteps) * symmetry;
    for (let i = 0; i < offSteps; i++) {
      for (let j = 0; j < offSteps; j++) {
        out.push({ rot, off: [i / offSteps, j / offSteps] });
      }
    }
  }
  return out;
}

function generate(
  pattern: PackPattern,
  b: ReturnType<typeof polyBounds>,
  pitch: number,
  rot: number,
  off: Vec2,
  cx: number,
  cy: number,
  field: DistanceField,
  clearance: number,
): Vec2[] {
  switch (pattern) {
    case 'grid':
      return latticePoints(b, pitch, pitch, false, rot, off, cx, cy, field, clearance);
    case 'hex':
      return latticePoints(b, pitch, pitch * Math.sqrt(3) / 2, true, rot, off, cx, cy, field, clearance);
    case 'radial':
      return radialPoints(b, pitch, rot, cx, cy, field, clearance);
    case 'sunflower':
      return sunflowerPoints(b, pitch, rot, cx, cy, field, clearance);
  }
}

function latticePoints(
  b: ReturnType<typeof polyBounds>,
  dx: number,
  dy: number,
  stagger: boolean,
  rot: number,
  off: Vec2,
  cx: number,
  cy: number,
  field: DistanceField,
  clearance: number,
): Vec2[] {
  const pts: Vec2[] = [];
  const reach = Math.hypot(b.width, b.height) / 2 + dx * 2;
  const cols = Math.ceil((reach * 2) / dx) + 2;
  const rows = Math.ceil((reach * 2) / dy) + 2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  for (let j = -rows; j <= rows; j++) {
    const ly = (j + off[1]) * dy;
    const shift = stagger && Math.abs(j % 2) === 1 ? dx / 2 : 0;
    for (let i = -cols; i <= cols; i++) {
      const lx = (i + off[0]) * dx + shift;
      const x = cx + lx * cos - ly * sin;
      const y = cy + lx * sin + ly * cos;
      if (x < b.minX - dx || x > b.maxX + dx || y < b.minY - dy || y > b.maxY + dy) continue;
      if (field.fits(x, y, clearance)) pts.push([x, y]);
    }
  }
  return pts;
}

function radialPoints(
  b: ReturnType<typeof polyBounds>,
  pitch: number,
  rot: number,
  cx: number,
  cy: number,
  field: DistanceField,
  clearance: number,
): Vec2[] {
  const pts: Vec2[] = [];
  if (field.fits(cx, cy, clearance)) pts.push([cx, cy]);

  // Ringabstand exakt `pitch`: damit liegen Punkte verschiedener Ringe schon
  // radial weit genug auseinander und muessen nicht nachtraeglich ausgeduennt
  // werden. Innerhalb eines Rings zaehlt die Sehne, nicht die Bogenlaenge -
  // sonst ruecken die Punkte bei kleinen Radien zu eng zusammen.
  const maxR = Math.hypot(b.width, b.height) / 2 + pitch;
  let ring = 0;
  for (let r = pitch; r <= maxR; r += pitch) {
    ring++;
    const n = Math.floor(Math.PI / Math.asin(Math.min(1, pitch / (2 * r))));
    if (n < 1) continue;
    const stagger = ring % 2 === 0 ? 0.5 / n : 0;
    for (let k = 0; k < n; k++) {
      const a = rot + (k / n + stagger) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (field.fits(x, y, clearance)) pts.push([x, y]);
    }
  }
  return pts;
}

function sunflowerPoints(
  b: ReturnType<typeof polyBounds>,
  pitch: number,
  rot: number,
  cx: number,
  cy: number,
  field: DistanceField,
  clearance: number,
): Vec2[] {
  const pts: Vec2[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const maxR = Math.hypot(b.width, b.height) / 2 + pitch;
  // Bei r(i) = c*sqrt(i) und goldenem Winkel liegt der kleinste Nachbarabstand
  // gemessen bei 1.657*c. Etwas konservativer gerechnet haelt die Spirale den
  // Mindestabstand von sich aus ein. Sie bleibt dabei rund ein Drittel duenner
  // besetzt als die Wabe - das ist der Preis fuer das organische Muster.
  const c = pitch / 1.65;
  const count = Math.ceil((maxR / c) ** 2);

  for (let i = 1; i <= count; i++) {
    const r = c * Math.sqrt(i);
    if (r > maxR) break;
    const a = rot + i * golden;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (field.fits(x, y, clearance)) pts.push([x, y]);
  }

  return enforceSpacing(pts, pitch);
}

/**
 * Entfernt Punkte, die naeher als `pitch` beieinander liegen. Gitter halten den
 * Abstand von sich aus ein, die Spirale nur naeherungsweise.
 */
function enforceSpacing(points: Vec2[], pitch: number): Vec2[] {
  const cell = pitch;
  const buckets = new Map<string, Vec2[]>();
  const kept: Vec2[] = [];
  const p2 = pitch * pitch - 1e-6;

  for (const p of points) {
    const bx = Math.floor(p[0] / cell);
    const by = Math.floor(p[1] / cell);
    let ok = true;
    outer: for (let i = -1; i <= 1 && ok; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = buckets.get(`${bx + i},${by + j}`);
        if (!list) continue;
        for (const q of list) {
          if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < p2) {
            ok = false;
            break outer;
          }
        }
      }
    }
    if (!ok) continue;
    kept.push(p);
    const key = `${bx},${by}`;
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  return kept;
}
