/**
 * Umrisse aus vorzeichenbehafteten Abstandsfunktionen (SDF).
 *
 * Damit lassen sich Formen zusammensetzen, die als Polygon-Boolean muehsam
 * waeren: `smoothUnion` verschmilzt Spinner-Arme mit dem Mittelkoerper und
 * erzeugt die Hohlkehle dazwischen gleich mit. Am Ende zieht Marching Squares
 * die Nulllinie als geschlossenes Polygon heraus.
 *
 * Konvention: negativ = innen.
 */

import { EdgeIndex } from './edgeindex.ts';
import type { Vec2 } from './mesh.ts';
import type { Poly, Region } from './shapes2d.ts';

export type Sdf = (x: number, y: number) => number;

export function sdCircle(cx: number, cy: number, r: number): Sdf {
  return (x, y) => Math.hypot(x - cx, y - cy) - r;
}

export function sdRoundedBox(cx: number, cy: number, w: number, h: number, r: number): Sdf {
  const hw = Math.max(0, w / 2 - r);
  const hh = Math.max(0, h / 2 - r);
  return (x, y) => {
    const dx = Math.abs(x - cx) - hw;
    const dy = Math.abs(y - cy) - hh;
    const ax = Math.max(dx, 0);
    const ay = Math.max(dy, 0);
    return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
  };
}

/** Kapsel / Stadionform zwischen zwei Punkten - der klassische Spinner-Arm. */
export function sdCapsule(ax: number, ay: number, bx: number, by: number, r: number): Sdf {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  return (x, y) => {
    const px = x - ax;
    const py = y - ay;
    let t = (px * dx + py * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - dx * t, py - dy * t) - r;
  };
}

/** Regelmaessiges N-Eck mit abgerundeten Ecken. */
export function sdNgon(cx: number, cy: number, r: number, sides: number, corner = 0, rotation = 0): Sdf {
  const step = (Math.PI * 2) / sides;
  const apothem = Math.max(0.01, r - corner);
  return (x, y) => {
    const px = x - cx;
    const py = y - cy;
    let a = Math.atan2(py, px) - rotation;
    a = a - Math.floor(a / step + 0.5) * step;
    const d = Math.hypot(px, py);
    return d * Math.cos(a) - apothem * Math.cos(step / 2) - corner;
  };
}

export function sdStarSdf(cx: number, cy: number, rOuter: number, rInner: number, points: number, rotation = Math.PI / 2): Sdf {
  const step = (Math.PI * 2) / points;
  return (x, y) => {
    const px = x - cx;
    const py = y - cy;
    const d = Math.hypot(px, py);
    let a = Math.atan2(py, px) - rotation;
    a = a - Math.floor(a / step + 0.5) * step;
    // Abstand zur Zacke: Strecke von der Aussenspitze zur Innenkerbe
    const tipX = rOuter;
    const tipY = 0;
    const notchX = Math.cos(step / 2) * rInner;
    const notchY = Math.sin(step / 2) * rInner;
    const qx = Math.cos(a) * d;
    const qy = Math.abs(Math.sin(a) * d);
    const ex = notchX - tipX;
    const ey = notchY - tipY;
    let t = ((qx - tipX) * ex + (qy - tipY) * ey) / (ex * ex + ey * ey);
    t = Math.max(0, Math.min(1, t));
    const dist = Math.hypot(qx - (tipX + ex * t), qy - (tipY + ey * t));
    const side = (qx - tipX) * ey - (qy - tipY) * ex;
    return side > 0 ? -dist : dist;
  };
}

export function union(...fns: Sdf[]): Sdf {
  return (x, y) => {
    let m = Infinity;
    for (const f of fns) {
      const v = f(x, y);
      if (v < m) m = v;
    }
    return m;
  };
}

export function intersect(...fns: Sdf[]): Sdf {
  return (x, y) => {
    let m = -Infinity;
    for (const f of fns) {
      const v = f(x, y);
      if (v > m) m = v;
    }
    return m;
  };
}

export function subtract(base: Sdf, cut: Sdf): Sdf {
  return (x, y) => Math.max(base(x, y), -cut(x, y));
}

/**
 * Weiche Vereinigung mit Mischradius k: statt einer scharfen Innenecke
 * entsteht eine Hohlkehle - genau das, was einen Spinner stabil und
 * angenehm in der Hand macht.
 *
 * Wichtig: k verrundet, es verbindet nicht. Ueber eine Luecke von mehr als
 * etwa k/4 hinweg wachsen zwei Formen nicht zusammen. Teile, die verbunden
 * sein sollen, muessen sich also ueberlappen - beim Spinner etwa ueber
 * Kapseln von der Mitte zu jeder Armspitze.
 */
export function smoothUnion(k: number, ...fns: Sdf[]): Sdf {
  if (k <= 0) return union(...fns);
  return (x, y) => {
    let d = fns[0](x, y);
    for (let i = 1; i < fns.length; i++) {
      const b = fns[i](x, y);
      const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - d)) / k));
      d = b * (1 - h) + d * h - k * h * (1 - h);
    }
    return d;
  };
}

export function offsetSdf(f: Sdf, delta: number): Sdf {
  return (x, y) => f(x, y) - delta;
}

export interface ContourOptions {
  /** Abtastweite in mm - kleiner ist genauer und langsamer. */
  cell?: number;
  /** Rand um die angegebene Ausdehnung. */
  padding?: number;
  /** Punkte zusammenfassen, die weniger als dieser Wert vom Linienzug abweichen. */
  simplify?: number;
  /** Glaettungsdurchlaeufe gegen die Treppchen des Abtastgitters. */
  smooth?: number;
}

/** Abgetastetes Feld - einmal berechnet, beliebig oft geschnitten. */
export interface SampledField {
  data: Float64Array;
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  cell: number;
}

/**
 * Tastet eine SDF auf einem Gitter ab. Wer mehrere Hoehenlinien derselben
 * Funktion braucht - etwa Rahmen, Schnapplippe und Membranrand aus einem
 * Umriss - tastet einmal ab und schneidet dann mehrfach.
 */
export function sampleField(
  f: Sdf,
  halfWidth: number,
  halfHeight: number,
  cell: number,
  padding = cell * 2,
): SampledField {
  const x0 = -halfWidth - padding;
  const y0 = -halfHeight - padding;
  const nx = Math.ceil((halfWidth + padding) * 2 / cell) + 1;
  const ny = Math.ceil((halfHeight + padding) * 2 / cell) + 1;
  const data = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      data[j * nx + i] = f(x0 + i * cell, y0 + j * cell);
    }
  }
  return { data, nx, ny, x0, y0, cell };
}

/**
 * Zieht alle geschlossenen Nulllinien einer SDF im Bereich
 * [-halfWidth, halfWidth] x [-halfHeight, halfHeight] heraus.
 * Das groesste Polygon steht an erster Stelle.
 */
export function contour(
  f: Sdf,
  halfWidth: number,
  halfHeight: number,
  opts: ContourOptions = {},
): Poly[] {
  const cell = opts.cell ?? 0.4;
  const field = sampleField(f, halfWidth, halfHeight, cell, opts.padding ?? cell * 2);
  return contourField(field, 0, opts);
}

/** Zieht die Hoehenlinie `level` aus einem bereits abgetasteten Feld. */
export function contourField(
  field: SampledField,
  level = 0,
  opts: ContourOptions = {},
): Poly[] {
  const { data: grid, nx, ny, x0, y0, cell } = field;
  const segments: [Vec2, Vec2][] = [];
  const at = (i: number, j: number) => grid[j * nx + i] - level;

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v0 = at(i, j);
      const v1 = at(i + 1, j);
      const v2 = at(i + 1, j + 1);
      const v3 = at(i, j + 1);
      let code = 0;
      if (v0 < 0) code |= 1;
      if (v1 < 0) code |= 2;
      if (v2 < 0) code |= 4;
      if (v3 < 0) code |= 8;
      if (code === 0 || code === 15) continue;

      const px = x0 + i * cell;
      const py = y0 + j * cell;
      const bottom = (): Vec2 => [px + cell * frac(v0, v1), py];
      const right = (): Vec2 => [px + cell, py + cell * frac(v1, v2)];
      const top = (): Vec2 => [px + cell * frac(v3, v2), py + cell];
      const left = (): Vec2 => [px, py + cell * frac(v0, v3)];

      // Segmentrichtung so, dass das Innere (negativ) links liegt -
      // dadurch laufen die Umrisse spaeter gegen den Uhrzeigersinn.
      switch (code) {
        case 1: segments.push([bottom(), left()]); break;
        case 2: segments.push([right(), bottom()]); break;
        case 3: segments.push([right(), left()]); break;
        case 4: segments.push([top(), right()]); break;
        case 5: {
          const center = (v0 + v1 + v2 + v3) / 4;
          if (center < 0) {
            segments.push([top(), left()]);
            segments.push([bottom(), right()]);
          } else {
            segments.push([bottom(), left()]);
            segments.push([top(), right()]);
          }
          break;
        }
        case 6: segments.push([top(), bottom()]); break;
        case 7: segments.push([top(), left()]); break;
        case 8: segments.push([left(), top()]); break;
        case 9: segments.push([bottom(), top()]); break;
        case 10: {
          const center = (v0 + v1 + v2 + v3) / 4;
          if (center < 0) {
            segments.push([right(), top()]);
            segments.push([left(), bottom()]);
          } else {
            segments.push([right(), bottom()]);
            segments.push([left(), top()]);
          }
          break;
        }
        case 11: segments.push([right(), top()]); break;
        case 12: segments.push([left(), right()]); break;
        case 13: segments.push([bottom(), right()]); break;
        case 14: segments.push([left(), bottom()]); break;
      }
    }
  }

  let loops = assembleLoops(segments, cell);
  if (opts.smooth !== 0) {
    const passes = opts.smooth ?? 2;
    loops = loops.map((l) => smoothLoop(l, passes));
  }
  const tol = opts.simplify ?? cell * 0.25;
  if (tol > 0) loops = loops.map((l) => simplifyLoop(l, tol)).filter((l) => l.length >= 3);

  loops.sort((a, b) => Math.abs(areaOf(b)) - Math.abs(areaOf(a)));
  return loops;
}

/**
 * Verkleinert einen Umriss um `delta` nach innen - ueber das Abstandsfeld
 * statt ueber verschobene Kanten.
 *
 * Der einfache Parallelversatz (`offsetPolygon`) verschiebt jeden Eckpunkt
 * entlang seiner Winkelhalbierenden. Bei konkaven Stellen - der Kerbe eines
 * Herzens, den Innenwinkeln eines Sterns - ueberschlagen sich die
 * verschobenen Kanten und das Ergebnis ist kein gueltiges Polygon mehr.
 * Die Nulllinie des um `delta` angehobenen Abstandsfelds hat dieses Problem
 * nicht: sie ist immer ueberschneidungsfrei.
 *
 * Rueckgabe sind alle entstehenden Ringe, groesster zuerst. Bei schmalen
 * Formen kann der verkleinerte Umriss in mehrere Teile zerfallen oder ganz
 * verschwinden - dann ist die Liste kuerzer oder leer.
 */
export function insetPolygon(poly: Poly, delta: number, cell = 0.5): Poly[] {
  return polygonInsetter(poly, cell)(delta);
}

/**
 * Liefert eine Funktion, die denselben Umriss um beliebige Betraege nach
 * innen versetzt. Das Abstandsfeld wird nur beim ersten Aufruf berechnet -
 * fuer Rahmen, Lippe und Membranrand aus einem Umriss ist das der
 * Unterschied zwischen einmal und dreimal Rechenarbeit.
 */
export function polygonInsetter(poly: Poly, cell = 0.5): (delta: number) => Poly[] {
  let field: SampledField | null = null;
  return (delta: number) => {
    if (delta <= 0) return [poly];
    if (!field) {
      const b = polyBoundsOf(poly);
      const halfW = Math.max(Math.abs(b.minX), Math.abs(b.maxX)) + cell * 3;
      const halfH = Math.max(Math.abs(b.minY), Math.abs(b.maxY)) + cell * 3;
      const index = new EdgeIndex([poly]);
      field = sampleField(
        (x, y) => (pointInside(poly, x, y) ? -index.distance(x, y) : index.distance(x, y)),
        halfW,
        halfH,
        cell,
      );
    }
    // Innen ist das Feld negativ; die Hoehenlinie bei -delta liegt genau
    // `delta` innerhalb des Randes.
    return contourField(field, -delta, { cell, simplify: cell * 0.2, smooth: 1 });
  };
}

function polyBoundsOf(poly: Poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInside(poly: Poly, px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j];
    const [x2, y2] = poly[i];
    if (y1 > py !== y2 > py && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/**
 * Ordnet die Ringe aus `contour` zu Regionen: Ringe gegen den Uhrzeigersinn
 * sind Aussenkonturen, Ringe im Uhrzeigersinn sind Loecher und werden der
 * kleinsten sie umschliessenden Aussenkontur zugeschlagen.
 */
export function loopsToRegions(loops: Poly[]): Region[] {
  const outers: { poly: Poly; area: number; holes: Poly[] }[] = [];
  const inners: Poly[] = [];

  for (const loop of loops) {
    const a = areaOf(loop);
    if (a > 0) outers.push({ poly: loop, area: a, holes: [] });
    else if (a < 0) inners.push(loop);
  }

  for (const hole of inners) {
    const p = hole[0];
    let best: (typeof outers)[number] | null = null;
    for (const o of outers) {
      if (!containsPoint(o.poly, p[0], p[1])) continue;
      if (!best || o.area < best.area) best = o;
    }
    if (best) best.holes.push(hole);
  }

  return outers.map((o) => ({ outline: o.poly, holes: o.holes }));
}

function containsPoint(poly: Poly, px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function frac(a: number, b: number): number {
  const d = a - b;
  if (Math.abs(d) < 1e-12) return 0.5;
  return Math.max(0, Math.min(1, a / d));
}

function assembleLoops(segments: [Vec2, Vec2][], cell: number): Poly[] {
  const q = 1 / (cell * 1e-3);
  const key = (p: Vec2) => `${Math.round(p[0] * q)},${Math.round(p[1] * q)}`;

  const outgoing = new Map<string, [Vec2, Vec2][]>();
  for (const s of segments) {
    const k = key(s[0]);
    const list = outgoing.get(k);
    if (list) list.push(s);
    else outgoing.set(k, [s]);
  }

  const used = new Set<[Vec2, Vec2]>();
  const loops: Poly[] = [];

  for (const seg of segments) {
    if (used.has(seg)) continue;
    const loop: Poly = [seg[0]];
    let current = seg;
    used.add(current);

    for (let guard = 0; guard < segments.length + 4; guard++) {
      loop.push(current[1]);
      const next: [Vec2, Vec2] | undefined = (outgoing.get(key(current[1])) ?? []).find((s) => !used.has(s));
      if (!next) break;
      used.add(next);
      current = next;
      if (key(current[1]) === key(loop[0])) break;
    }
    if (loop.length >= 4) {
      // Doppelten Endpunkt entfernen - der Ringschluss ist implizit.
      if (key(loop[loop.length - 1]) === key(loop[0])) loop.pop();
      loops.push(loop);
    }
  }
  return loops;
}

function smoothLoop(loop: Poly, passes: number): Poly {
  let pts = loop;
  for (let p = 0; p < passes; p++) {
    const out: Poly = new Array(pts.length);
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      out[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    }
    pts = out;
  }
  return pts;
}

/** Ramer-Douglas-Peucker auf einem geschlossenen Ring. */
function simplifyLoop(loop: Poly, tol: number): Poly {
  if (loop.length < 8) return loop;
  const closed = loop.concat([loop[0]]);
  const keep = new Uint8Array(closed.length);
  keep[0] = 1;
  keep[closed.length - 1] = 1;

  const stack: [number, number][] = [[0, closed.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointLineDistance(closed[i], closed[s], closed[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }

  const out: Poly = [];
  for (let i = 0; i < closed.length - 1; i++) if (keep[i]) out.push(closed[i]);
  return out;
}

function pointLineDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

function areaOf(poly: Poly): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return s / 2;
}
