/**
 * Bauteile, die in mehreren Fidgets vorkommen: Platten mit Sacktaschen,
 * Schalen, Kreuzkonturen fuer Dome-Beine und MX-Zapfen.
 */

import { capMesh, extrudeRegion, loftPolys, trianglesToCap, wallMesh } from '../geo/extrude.ts';
import { triangulateFaces } from '../geo/robust.ts';
import { Mesh, type Vec2 } from '../geo/mesh.ts';
import { circle, ensureCCW, ensureCW, type Poly, type Region } from '../geo/shapes2d.ts';

export interface Pocket {
  poly: Poly;
  /** Tiefe in mm, gemessen von der Flaeche, in der die Tasche liegt. */
  depth: number;
  from: 'top' | 'bottom';
}

/**
 * Platte mit Sacktaschen und Durchbruechen - als ein einziger geschlossener
 * Koerper. Sacktaschen entstehen als Loch in der Deckflaeche plus einem
 * Boden weiter unten, nicht als Boolesche Differenz.
 *
 * Ober- und Unterseite werden gemeinsam geprueft zerlegt, damit beide
 * Deckflaechen und alle Waende auf exakt derselben Lochlage aufsetzen.
 */
export function plateWithPockets(
  outline: Poly,
  z0: number,
  z1: number,
  pockets: Pocket[] = [],
  through: Poly[] = [],
): Mesh {
  const m = new Mesh();
  const ring = ensureCCW(outline);

  const passages = through.filter((h) => h.length >= 3).map(ensureCW);
  const top = pockets.filter((p) => p.from === 'top' && p.poly.length >= 3);
  const bottom = pockets.filter((p) => p.from === 'bottom' && p.poly.length >= 3);

  // Gemeinsame Lochliste: erst die Durchbrueche, dann die Taschen von oben,
  // dann die von unten.
  const holes: Poly[] = [
    ...passages,
    ...top.map((p) => ensureCW(p.poly)),
    ...bottom.map((p) => ensureCW(p.poly)),
  ];
  const idxPassages = passages.map((_, i) => i);
  const idxTop = top.map((_, i) => passages.length + i);
  const idxBottom = bottom.map((_, i) => passages.length + top.length + i);

  const checked = triangulateFaces(holes, [
    { outline: ring, holeIndices: [...idxPassages, ...idxTop] },
    { outline: ring, holeIndices: [...idxPassages, ...idxBottom] },
  ]);

  m.add(trianglesToCap(checked.tris[0], z1, true));
  m.add(trianglesToCap(checked.tris[1], z0, false));
  m.add(wallMesh(ring, z0, z1));
  for (const i of idxPassages) m.add(wallMesh(checked.holes[i], z0, z1));

  top.forEach((p, k) => {
    const poly = checked.holes[idxTop[k]];
    const floor = Math.max(z0 + 0.01, z1 - p.depth);
    m.add(wallMesh(poly, floor, z1));
    m.add(capMesh({ outline: ensureCCW(poly), holes: [] }, floor, true));
  });
  bottom.forEach((p, k) => {
    const poly = checked.holes[idxBottom[k]];
    const ceil = Math.min(z1 - 0.01, z0 + p.depth);
    m.add(wallMesh(poly, z0, ceil));
    m.add(capMesh({ outline: ensureCCW(poly), holes: [] }, ceil, false));
  });
  return m;
}

/**
 * Hohlkoerper zwischen zwei Umrissen: aussen `outer`, innen `inner`, mit
 * geschlossener Decke. Basis fuer Tastenkappen und Gehaeuseschalen.
 */
export function shellBox(
  outerBottom: Poly,
  outerTop: Poly,
  innerBottom: Poly,
  innerTop: Poly,
  height: number,
  ceiling: number,
): Mesh {
  const m = new Mesh();
  const ob = ensureCCW(outerBottom);
  const ot = ensureCCW(outerTop);
  const ib = ensureCW(innerBottom);
  const it = ensureCW(innerTop);

  m.add(loftPolys(ob, 0, ot, height));
  m.add(capMesh({ outline: ot, holes: [] }, height, true));
  m.add(capMesh({ outline: ob, holes: [ib] }, 0, false));
  m.add(loftPolys(ib, 0, it, height - ceiling));
  m.add(capMesh({ outline: ensureCCW(innerTop), holes: [] }, height - ceiling, false));
  return m;
}

/**
 * Umriss einer Kreuzkuppel-Tasche: Kreis mit vier rechteckigen Ausbuchtungen
 * fuer die Beine. Der runde Teil fuehrt die Kuppel seitlich, die Nasen geben
 * den Beinen Platz, ohne dass die Kuppel darin wandern kann.
 */
export function crossPocketPoly(
  diameter: number,
  legOverhang: number,
  legWidth: number,
  segments = 48,
): Poly {
  const r = diameter / 2;
  const R = r + legOverhang;
  const w = Math.min(legWidth, diameter * 0.8);
  const half = Math.min(w / 2, r * 0.95);
  const ha = Math.asin(half / r);
  const pts: Poly = [];
  const arcSteps = Math.max(4, Math.round(segments / 4));

  for (let k = 0; k < 4; k++) {
    const a0 = (k * Math.PI) / 2 + ha;
    const a1 = ((k + 1) * Math.PI) / 2 - ha;
    for (let i = 0; i <= arcSteps; i++) {
      const a = a0 + ((a1 - a0) * i) / arcSteps;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    // Bein des naechsten Arms: aus dem Kreis heraus und wieder zurueck.
    // Die beiden Fusspunkte am Kreis liefern bereits das Ende dieses Bogens
    // und der Anfang des naechsten - sie duerfen hier nicht noch einmal
    // gesetzt werden, sonst entstehen Kanten der Laenge null.
    const an = ((k + 1) * Math.PI) / 2;
    const c = Math.cos(an);
    const s = Math.sin(an);
    const local: Vec2[] = [
      [R, -half],
      [R, half],
    ];
    for (const [lx, ly] of local) pts.push([lx * c - ly * s, lx * s + ly * c]);
  }
  return pts;
}

/** Runde Tasche - fuer Domes ohne Beine und fuer Magnete. */
export function roundPocketPoly(diameter: number, segments = 40): Poly {
  return circle(diameter / 2, segments);
}

/**
 * Kreuzloch fuer einen MX-Zapfen (Plus-Form aus zwoelf Punkten).
 * `length` ist die Gesamtlaenge eines Arms, `width` seine Dicke.
 */
export function mxCrossPoly(length: number, width: number): Poly {
  const a = length / 2;
  const b = width / 2;
  return [
    [b, b], [a, b], [a, -b], [b, -b],
    [b, -a], [-b, -a], [-b, -b], [-a, -b],
    [-a, b], [-b, b], [-b, a], [b, a],
  ];
}

/** Quadratischer Schalterausschnitt mit leicht gebrochenen Ecken. */
export function squareHolePoly(size: number, cornerRelief = 0): Poly {
  const h = size / 2;
  if (cornerRelief <= 0) {
    return [[-h, -h], [h, -h], [h, h], [-h, h]];
  }
  const c = cornerRelief;
  return [
    [-h + c, -h], [h - c, -h], [h, -h + c], [h, h - c],
    [h - c, h], [-h + c, h], [-h, h - c], [-h, -h + c],
  ];
}

/** Verschiebt eine Region als Ganzes. */
export function moveRegion(reg: Region, dx: number, dy: number): Region {
  const mv = (p: Poly): Poly => p.map(([x, y]) => [x + dx, y + dy] as Vec2);
  return { outline: mv(reg.outline), holes: reg.holes.map(mv) };
}

/**
 * Ring mit rechteckigem Querschnitt - Gehaeusewand, Rahmen, Schnapplippe.
 * `inner` muss vollstaendig in `outer` liegen.
 */
export function ringWall(outer: Poly, inner: Poly, z0: number, z1: number): Mesh {
  return extrudeRegion({ outline: outer, holes: [inner] }, z0, z1);
}
