/**
 * 2D-Umrisse in Millimetern. Ein Polygon ist eine offene Punktliste - der
 * Ringschluss vom letzten zum ersten Punkt ist implizit.
 */

import type { Vec2 } from './mesh.ts';

export type Poly = Vec2[];

/** Flaeche mit optionalen Loechern - die Eingabe fuer jede Extrusion. */
export interface Region {
  outline: Poly;
  holes: Poly[];
}

export function region(outline: Poly, holes: Poly[] = []): Region {
  return { outline, holes };
}

/** Segmentzahl fuer einen Kreis: fein genug fuer den Druck, sparsam genug fuers Netz. */
export function circleSegments(radius: number, quality = 1): number {
  const n = Math.ceil(Math.max(12, Math.min(96, radius * 6 * quality)));
  return n % 2 === 0 ? n : n + 1;
}

export function circle(radius: number, segments = circleSegments(radius), cx = 0, cy = 0): Poly {
  const pts: Poly = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
  }
  return pts;
}

export function ellipse(rx: number, ry: number, segments = circleSegments(Math.max(rx, ry))): Poly {
  const pts: Poly = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return pts;
}

export function rect(w: number, h: number): Poly {
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
}

export function roundedRect(w: number, h: number, radius: number, cornerSegments = 8): Poly {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2 - 0.001));
  if (r <= 0.001) return rect(w, h);
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  const pts: Poly = [];
  const corners: Vec2[] = [
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ];
  const startAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i <= cornerSegments; i++) {
      const a = startAngles[c] + (i / cornerSegments) * (Math.PI / 2);
      pts.push([corners[c][0] + Math.cos(a) * r, corners[c][1] + Math.sin(a) * r]);
    }
  }
  return pts;
}

export function regularPolygon(sides: number, radius: number, rotation = 0): Poly {
  const pts: Poly = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return pts;
}

export function star(points: number, rOuter: number, rInner: number, rotation = Math.PI / 2): Poly {
  const pts: Poly = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rotation + (i / (points * 2)) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

/** Herzform ueber die klassische Parameterkurve, skaliert auf die Zielbreite. */
export function heart(width: number, segments = 96): Poly {
  const raw: Poly = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y =
      13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push([x, y]);
  }
  const b = polyBounds(raw);
  const s = width / (b.maxX - b.minX);
  const cx = (b.maxX + b.minX) / 2;
  const cy = (b.maxY + b.minY) / 2;
  return raw.map(([x, y]) => [(x - cx) * s, (y - cy) * s] as Vec2);
}

/** Superellipse / "Squircle": n=2 ergibt eine Ellipse, n=4 ein weiches Quadrat. */
export function superellipse(w: number, h: number, n = 4, segments = 96): Poly {
  const pts: Poly = [];
  const a = w / 2;
  const b = h / 2;
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    pts.push([
      Math.sign(ct) * a * Math.abs(ct) ** (2 / n),
      Math.sign(st) * b * Math.abs(st) ** (2 / n),
    ]);
  }
  return pts;
}

/** Blumen-/Wellenumriss: Radius moduliert mit einer Sinuswelle. */
export function flower(petals: number, rOuter: number, depth = 0.18, segments = 160): Poly {
  const pts: Poly = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const r = rOuter * (1 - depth + depth * Math.cos(petals * t));
    pts.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  return pts;
}

/** Abgerundetes gleichseitiges Dreieck - beliebt als Spinner-Koerper. */
export function roundedPolygon(sides: number, radius: number, cornerRadius: number, rotation = Math.PI / 2, cornerSegments = 10): Poly {
  const cr = Math.min(cornerRadius, radius * 0.6);
  const inner = radius - cr / Math.cos(Math.PI / sides);
  const pts: Poly = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const cx = Math.cos(a) * inner;
    const cy = Math.sin(a) * inner;
    const halfSweep = Math.PI / 2 - Math.PI / sides;
    for (let k = 0; k <= cornerSegments; k++) {
      const t = a - halfSweep + (k / cornerSegments) * halfSweep * 2;
      pts.push([cx + Math.cos(t) * cr, cy + Math.sin(t) * cr]);
    }
  }
  return pts;
}

export interface PolyBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function polyBounds(poly: Poly): PolyBounds {
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
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Signierte Flaeche: positiv bei Gegenuhrzeigersinn. */
export function polyArea(poly: Poly): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]);
  }
  return s / 2;
}

export function ensureCCW(poly: Poly): Poly {
  return polyArea(poly) < 0 ? poly.slice().reverse() : poly;
}

export function ensureCW(poly: Poly): Poly {
  return polyArea(poly) > 0 ? poly.slice().reverse() : poly;
}

export function pointInPolygon(poly: Poly, px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Kuerzester Abstand eines Punktes zum Polygonrand (immer positiv). */
export function distanceToEdges(poly: Poly, px: number, py: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j];
    const [x2, y2] = poly[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

/** Vorzeichenbehafteter Abstand: innen positiv, aussen negativ. */
export function signedDistance(poly: Poly, px: number, py: number): number {
  const d = distanceToEdges(poly, px, py);
  return pointInPolygon(poly, px, py) ? d : -d;
}

/**
 * Parallelverschiebung des Umrisses um `delta` (positiv = nach aussen).
 * Gehrungs-Methode mit Begrenzung; fuer Fasen und Randabstaende gedacht,
 * nicht als vollwertiger Clipper-Offset.
 */
export function offsetPolygon(poly: Poly, delta: number): Poly {
  if (delta === 0) return poly.slice();
  const src = ensureCCW(poly);
  const n = src.length;
  const out: Poly = [];
  const limit = Math.abs(delta) * 4;

  for (let i = 0; i < n; i++) {
    const p = src[i];
    const prev = src[(i - 1 + n) % n];
    const next = src[(i + 1) % n];

    const n1 = edgeNormal(prev, p);
    const n2 = edgeNormal(p, next);
    const denom = 1 + (n1[0] * n2[0] + n1[1] * n2[1]);

    let mx: number;
    let my: number;
    if (Math.abs(denom) < 1e-6) {
      mx = n1[0];
      my = n1[1];
    } else {
      mx = (n1[0] + n2[0]) / denom;
      my = (n1[1] + n2[1]) / denom;
    }
    let ox = mx * delta;
    let oy = my * delta;
    const l = Math.hypot(ox, oy);
    if (l > limit) {
      ox = (ox / l) * limit;
      oy = (oy / l) * limit;
    }
    out.push([p[0] + ox, p[1] + oy]);
  }
  return out;
}

/** Aussen-Normale einer Kante eines gegen den Uhrzeigersinn laufenden Polygons. */
function edgeNormal(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

export function translatePoly(poly: Poly, dx: number, dy: number): Poly {
  return poly.map(([x, y]) => [x + dx, y + dy] as Vec2);
}

export function rotatePoly(poly: Poly, rad: number): Poly {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return poly.map(([x, y]) => [x * c - y * s, x * s + y * c] as Vec2);
}

export function scalePoly(poly: Poly, sx: number, sy = sx): Poly {
  return poly.map(([x, y]) => [x * sx, y * sy] as Vec2);
}

/**
 * Verteilt `n` Punkte gleichmaessig nach Bogenlaenge auf einem geschlossenen
 * Linienzug. Damit lassen sich zwei verschieden fein aufgeloeste Umrisse -
 * etwa eine Kontur und ihr Innenversatz - miteinander verbinden.
 */
export function resampleClosed(poly: Poly, n: number): Poly {
  if (poly.length < 3 || n < 3) return poly;
  const m = poly.length;
  const lengths: number[] = new Array(m);
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % m];
    lengths[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    total += lengths[i];
  }
  if (total <= 0) return poly;

  const out: Poly = [];
  let seg = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (seg < m - 1 && acc + lengths[seg] < target) {
      acc += lengths[seg];
      seg++;
    }
    const t = lengths[seg] > 0 ? (target - acc) / lengths[seg] : 0;
    const a = poly[seg];
    const b = poly[(seg + 1) % m];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/**
 * Dreht die Punktliste so, dass sie beim Punkt mit dem kleinsten Winkel zum
 * Ursprung beginnt. Zwei so ausgerichtete Ringe lassen sich ohne Verdrehung
 * miteinander verbinden.
 */
export function alignStart(poly: Poly): Poly {
  if (poly.length < 3) return poly;
  let best = 0;
  let bestAngle = Infinity;
  for (let i = 0; i < poly.length; i++) {
    let a = Math.atan2(poly[i][1], poly[i][0]);
    if (a < 0) a += Math.PI * 2;
    if (a < bestAngle) {
      bestAngle = a;
      best = i;
    }
  }
  return [...poly.slice(best), ...poly.slice(0, best)];
}

/** Fuegt Punkte ein, bis keine Kante laenger als `maxLen` ist. */
export function resample(poly: Poly, maxLen: number): Poly {
  const out: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    out.push(a);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.floor(d / maxLen);
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
