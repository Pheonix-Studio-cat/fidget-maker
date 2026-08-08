/**
 * Extrusion von 2D-Regionen zu druckbaren Volumenkoerpern.
 *
 * Alle Generatoren bauen ihre Teile daraus, statt Boolesche Operationen zu
 * verwenden: Taschen entstehen als Loecher in der Region, Absaetze durch
 * Stapeln mehrerer Scheiben mit unterschiedlichen Loechern.
 */

import { earcut } from './earcut.ts';
import { Mesh, type Vec2, type Vec3 } from './mesh.ts';
import { triangulateChecked, triangulateFaces } from './robust.ts';
import {
  ensureCCW,
  ensureCW,
  offsetPolygon,
  type Poly,
  type Region,
} from './shapes2d.ts';

/**
 * Ein einzelner Zerlegungsdurchlauf. Fuer den normalen Gebrauch ist
 * `triangulateRegion` gedacht - es prueft das Ergebnis zusaetzlich.
 */
export function triangulateOnce(reg: Region): Vec2[][] {
  const flat: number[] = [];
  const holeIndices: number[] = [];

  const outline = ensureCCW(reg.outline);
  for (const [x, y] of outline) flat.push(x, y);

  for (const hole of reg.holes) {
    if (hole.length < 3) continue;
    holeIndices.push(flat.length / 2);
    for (const [x, y] of ensureCW(hole)) flat.push(x, y);
  }

  const idx = earcut(flat, holeIndices.length ? holeIndices : undefined);
  const tris: Vec2[][] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a: Vec2 = [flat[idx[i] * 2], flat[idx[i] * 2 + 1]];
    const b: Vec2 = [flat[idx[i + 1] * 2], flat[idx[i + 1] * 2 + 1]];
    const c: Vec2 = [flat[idx[i + 2] * 2], flat[idx[i + 2] * 2 + 1]];
    // Beim Anbinden der Loecher legt earcut Bruecken an und dupliziert dabei
    // Punkte. Dreiecke, bei denen zwei Ecken aufeinanderfallen, sind wirklich
    // leer und koennen weg. Flaechenlose Dreiecke mit drei verschiedenen
    // Ecken muessen dagegen bleiben: ihre Kanten gehoeren zur Deckflaeche,
    // und ohne sie passt der Rand nicht mehr zu den Waenden.
    if (same(a, b) || same(b, c) || same(a, c)) continue;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    tris.push(cross > 0 ? [a, b, c] : [a, c, b]);
  }
  return tris;
}

function same(a: Vec2, b: Vec2): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Geprueft zerlegte Region. Loecher koennen dabei um wenige Mikrometer
 * verschoben werden - wer daraus auch Waende baut, muss `triangulateChecked`
 * direkt verwenden und die zurueckgegebene Region benutzen.
 */
export function triangulateRegion(reg: Region): Vec2[][] {
  return triangulateChecked(reg).tris;
}

/** Wandelt eine fertige Dreiecksliste in eine Deckflaeche bei z. */
export function trianglesToCap(tris: Vec2[][], z: number, facingUp: boolean): Mesh {
  const m = new Mesh();
  for (const [a, b, c] of tris) {
    if (facingUp) m.addTriangle([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z]);
    else m.addTriangle([a[0], a[1], z], [c[0], c[1], z], [b[0], b[1], z]);
  }
  return m;
}

/** Deckflaeche bei z, Normalen nach oben. */
export function capMesh(reg: Region, z: number, facingUp: boolean): Mesh {
  return trianglesToCap(triangulateRegion(reg), z, facingUp);
}

/** Senkrechte Wand entlang eines Polygonzugs. */
export function wallMesh(poly: Poly, z0: number, z1: number): Mesh {
  const m = new Mesh();
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const a: Vec3 = [p[0], p[1], z0];
    const b: Vec3 = [q[0], q[1], z0];
    const c: Vec3 = [q[0], q[1], z1];
    const d: Vec3 = [p[0], p[1], z1];
    m.addQuad(a, b, c, d);
  }
  return m;
}

export interface ExtrudeOptions {
  capTop?: boolean;
  capBottom?: boolean;
}

/** Gerade Extrusion einer Region von z0 nach z1. */
export function extrudeRegion(
  reg: Region,
  z0: number,
  z1: number,
  opts: ExtrudeOptions = {},
): Mesh {
  const { capTop = true, capBottom = true } = opts;
  const lo = Math.min(z0, z1);
  const hi = Math.max(z0, z1);
  const m = new Mesh();

  // Erst zerlegen, dann Waende bauen: die Pruefung kann Loecher minimal
  // verschieben, und die Waende muessen zur gleichen Lage passen.
  const checked = triangulateChecked({
    outline: ensureCCW(reg.outline),
    holes: reg.holes.filter((h) => h.length >= 3).map(ensureCW),
  });

  m.add(wallMesh(checked.region.outline, lo, hi));
  for (const hole of checked.region.holes) m.add(wallMesh(hole, lo, hi));

  if (capTop) m.add(trianglesToCap(checked.tris, hi, true));
  if (capBottom) m.add(trianglesToCap(checked.tris, lo, false));
  return m;
}

/** Mantelflaeche zwischen zwei Polygonen gleicher Punktzahl. */
export function loftPolys(a: Poly, za: number, b: Poly, zb: number): Mesh {
  const m = new Mesh();
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    m.addQuad(
      [a[i][0], a[i][1], za],
      [a[j][0], a[j][1], za],
      [b[j][0], b[j][1], zb],
      [b[i][0], b[i][1], zb],
    );
  }
  return m;
}

export interface SlabOptions {
  chamferBottom?: number;
  chamferTop?: number;
  /** Loecher werden nicht gefast - sie bleiben ueber die volle Hoehe zylindrisch. */
}

/**
 * Platte mit umlaufender Fase an Ober- und Unterkante. Die Unterkanten-Fase
 * ersetzt die Elefantenfuss-Korrektur und macht die Kante griffig.
 */
export function chamferedSlab(
  reg: Region,
  z0: number,
  z1: number,
  opts: SlabOptions = {},
): Mesh {
  const cb = Math.max(0, opts.chamferBottom ?? 0);
  const ct = Math.max(0, opts.chamferTop ?? 0);
  const height = z1 - z0;
  if (cb + ct >= height - 0.05 || (cb === 0 && ct === 0)) {
    return extrudeRegion(reg, z0, z1);
  }

  const outline = ensureCCW(reg.outline);
  const holes = reg.holes.filter((h) => h.length >= 3).map(ensureCW);
  const botOutline = cb > 0 ? offsetPolygon(outline, -cb) : outline;
  const topOutline = ct > 0 ? offsetPolygon(outline, -ct) : outline;

  // Beide Deckflaechen teilen sich denselben Lochsatz und muessen deshalb
  // gemeinsam geprueft werden.
  const all = holes.map((_, i) => i);
  const checked = triangulateFaces(holes, [
    { outline: botOutline, holeIndices: all },
    { outline: topOutline, holeIndices: all },
  ]);

  const m = new Mesh();
  m.add(trianglesToCap(checked.tris[0], z0, false));
  if (cb > 0) m.add(loftPolys(botOutline, z0, outline, z0 + cb));
  m.add(loftPolys(outline, z0 + cb, outline, z1 - ct));
  if (ct > 0) m.add(loftPolys(outline, z1 - ct, topOutline, z1));
  m.add(trianglesToCap(checked.tris[1], z1, true));

  for (const hole of checked.holes) m.add(wallMesh(hole, z0, z1));
  return m;
}

/** Achsparalleler Quader, zentriert in X/Y, Unterkante bei z0. */
export function boxMesh(w: number, d: number, h: number, z0 = 0): Mesh {
  return extrudeRegion(
    {
      outline: [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ],
      holes: [],
    },
    z0,
    z0 + h,
  );
}

/** Zylinder mit Achse in Z. */
export function cylinderMesh(radius: number, height: number, segments = 48, z0 = 0): Mesh {
  const poly: Poly = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    poly.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return extrudeRegion({ outline: poly, holes: [] }, z0, z0 + height);
}

/** Kegelstumpf mit Achse in Z - fuer Fasen an Bohrungen und Spitzen. */
export function coneMesh(r0: number, r1: number, height: number, segments = 48, z0 = 0): Mesh {
  const a: Poly = [];
  const b: Poly = [];
  for (let i = 0; i < segments; i++) {
    const ang = (i / segments) * Math.PI * 2;
    a.push([Math.cos(ang) * r0, Math.sin(ang) * r0]);
    b.push([Math.cos(ang) * r1, Math.sin(ang) * r1]);
  }
  const m = new Mesh();
  m.add(loftPolys(a, z0, b, z0 + height));
  if (r0 > 1e-6) m.add(capMesh({ outline: a, holes: [] }, z0, false));
  if (r1 > 1e-6) m.add(capMesh({ outline: b, holes: [] }, z0 + height, true));
  return m;
}
