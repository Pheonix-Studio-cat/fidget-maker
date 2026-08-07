/**
 * Absicherung der Triangulierung.
 *
 * Ear-Clipping bindet Loecher ueber Bruecken an die Aussenkontur an. Trifft
 * ein Brueckenstrahl genau auf einen Eckpunkt eines Nachbarlochs, koennen
 * sich Dreiecke ueberlappen - die Deckflaeche ist dann nicht mehr dicht.
 * Genau das passiert bei Pop-It-Platten, weil dort hunderte identische
 * Kreuztaschen exakt gleich ausgerichtet im Raster liegen.
 *
 * Statt zu hoffen, dass es gutgeht, wird jedes Ergebnis ueber seine
 * Kantenbilanz geprueft. Faellt sie durch, werden die Loecher um wenige
 * Mikrometer verdreht und verschoben und es wird erneut zerlegt. Der Umriss
 * selbst bleibt dabei unangetastet, damit die Aussenmasse exakt bleiben.
 */

import { triangulateOnce } from './extrude.ts';
import type { Vec2 } from './mesh.ts';
import { ensureCCW, ensureCW, polyBounds, type Poly, type Region } from './shapes2d.ts';

const MAX_ATTEMPTS = 12;

function edgeKey(u: Vec2, v: Vec2): string {
  return `${u[0]},${u[1]}|${v[0]},${v[1]}`;
}

/**
 * Zaehlt, wie weit eine Dreiecksliste davon entfernt ist, die Flaeche sauber
 * zu zerlegen. 0 bedeutet fehlerfrei.
 *
 * Geprueft wird die Kantenbilanz: innen liegende Kanten muessen genau
 * zweimal vorkommen, einmal je Richtung. Kanten, die nur einmal vorkommen,
 * duerfen ausschliesslich auf dem Rand liegen - also auf dem Umriss oder auf
 * einem Lochrand. Damit fallen sowohl ueberlappende als auch fehlende
 * Dreiecke auf; ein reiner Flaechenvergleich wuerde beides uebersehen,
 * wenn es sich gegenseitig aufhebt.
 */
export function triangulationDefects(tris: Vec2[][], outline: Poly, holes: Poly[]): number {
  const count = new Map<string, number>();
  for (const [a, b, c] of tris) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [Vec2, Vec2][]) {
      const k = edgeKey(u, v);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }

  const expected = new Set<string>();
  const addRing = (ring: Poly) => {
    for (let i = 0; i < ring.length; i++) {
      expected.add(edgeKey(ring[i], ring[(i + 1) % ring.length]));
    }
  };
  addRing(ensureCCW(outline));
  for (const h of holes) if (h.length >= 3) addRing(ensureCW(h));

  let defects = 0;
  for (const [k, n] of count) {
    if (n > 1) {
      defects += n - 1;
      continue;
    }
    const [u, v] = k.split('|');
    const rev = count.get(`${v}|${u}`) ?? 0;
    if (rev === 1) continue;
    if (rev === 0 && expected.has(k)) continue;
    defects++;
  }
  for (const k of expected) if ((count.get(k) ?? 0) !== 1) defects++;

  return defects;
}

/**
 * Verschiebt und verdreht jedes Loch um einen winzigen, aber eindeutigen
 * Betrag. `seed` 0 laesst alles unveraendert.
 */
export function perturbHoles(holes: Poly[], seed: number): Poly[] {
  if (seed === 0) return holes;
  return holes.map((hole, i) => {
    const n = seed * 977 + i * 131 + 1;
    const angle = 0.0004 * seed * (((n * 2654435761) % 1000) / 1000 - 0.5) * 2;
    const dx = 4e-4 * (((n * 40503) % 997) / 997 - 0.5) * 2;
    const dy = 4e-4 * (((n * 22695477) % 991) / 991 - 0.5) * 2;
    const b = polyBounds(hole);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const co = Math.cos(angle);
    const si = Math.sin(angle);
    return hole.map(([x, y]) => {
      const px = x - cx;
      const py = y - cy;
      return [cx + px * co - py * si + dx, cy + px * si + py * co + dy] as Vec2;
    });
  });
}

/**
 * Eine zu zerlegende Flaeche: ein Umriss und die Auswahl der Loecher, die in
 * dieser Flaeche offen sind - angegeben als Indizes in die gemeinsame
 * Lochliste. So teilen sich Ober- und Unterseite einer Platte dieselben
 * Loecher, obwohl in jeder Flaeche andere davon sichtbar sind.
 */
export interface FaceSpec {
  outline: Poly;
  holeIndices: number[];
}

export interface CheckedFaces {
  /** Dreiecke je Flaeche, in derselben Reihenfolge wie die Eingabe. */
  tris: Vec2[][][];
  /** Die tatsaechlich verwendeten Loecher - Waende muessen sich darauf beziehen. */
  holes: Poly[];
  attempts: number;
  /** false, wenn auch nach allen Versuchen keine saubere Zerlegung gelang. */
  ok: boolean;
}

/**
 * Zerlegt mehrere Flaechen, die sich einen Lochsatz teilen, und stellt
 * sicher, dass jede Zerlegung ueberlappungsfrei ist.
 */
export function triangulateFaces(holes: Poly[], faces: FaceSpec[]): CheckedFaces {
  let best: { tris: Vec2[][][]; holes: Poly[]; dups: number } | null = null;

  for (let seed = 0; seed < MAX_ATTEMPTS; seed++) {
    const moved = perturbHoles(holes, seed);
    const tris = faces.map((f) =>
      triangulateOnce({ outline: f.outline, holes: f.holeIndices.map((i) => moved[i]) }),
    );
    const dups = faces.reduce(
      (s, f, i) => s + triangulationDefects(tris[i], f.outline, f.holeIndices.map((h) => moved[h])),
      0,
    );
    if (dups === 0) return { tris, holes: moved, attempts: seed + 1, ok: true };
    // Dreiecke und Lochlage gehoeren zusammen und muessen gemeinsam
    // aufgehoben werden - sonst passen spaeter die Waende nicht dazu.
    if (!best || dups < best.dups) best = { tris, holes: moved, dups };
  }

  return { tris: best!.tris, holes: best!.holes, attempts: MAX_ATTEMPTS, ok: false };
}

export interface CheckedTriangulation {
  tris: Vec2[][];
  /** Die tatsaechlich verwendete Region - Waende muessen sich darauf beziehen. */
  region: Region;
  attempts: number;
  ok: boolean;
}

/** Der haeufige Fall: eine einzelne Flaeche mit allen ihren Loechern. */
export function triangulateChecked(reg: Region): CheckedTriangulation {
  const all = reg.holes.map((_, i) => i);
  const r = triangulateFaces(reg.holes, [{ outline: reg.outline, holeIndices: all }]);
  return {
    tris: r.tris[0] ?? [],
    region: { outline: reg.outline, holes: r.holes },
    attempts: r.attempts,
    ok: r.ok,
  };
}
