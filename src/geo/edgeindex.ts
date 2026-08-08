/**
 * Raeumlicher Index ueber Polygonkanten.
 *
 * Abstandsfelder brauchen sehr viele Abstandsabfragen. Ohne Index kostet
 * jede davon einen Durchlauf ueber saemtliche Kanten - bei einem Umriss mit
 * 128 Punkten und einem Feld mit 30 000 Stuetzstellen sind das Millionen
 * Rechenschritte. Der Index prueft nur die Zellen im Umkreis und hoert auf,
 * sobald keine naehere Kante mehr moeglich ist; das Ergebnis bleibt exakt.
 */

import type { Poly } from './shapes2d.ts';

export class EdgeIndex {
  private readonly cell: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly buckets: number[][];
  /** Kanten als flaches Array x1,y1,x2,y2. */
  private readonly edges: Float64Array;

  constructor(polys: Poly[]) {
    const segs: number[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let totalLen = 0;

    for (const poly of polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [x1, y1] = poly[j];
        const [x2, y2] = poly[i];
        segs.push(x1, y1, x2, y2);
        totalLen += Math.hypot(x2 - x1, y2 - y1);
        minX = Math.min(minX, x1, x2);
        minY = Math.min(minY, y1, y2);
        maxX = Math.max(maxX, x1, x2);
        maxY = Math.max(maxY, y1, y2);
      }
    }

    this.edges = Float64Array.from(segs);
    const count = segs.length / 4;
    // Zellgroesse etwa vier mittlere Kantenlaengen: genug, damit eine Kante
    // nur wenige Zellen belegt, und klein genug fuer wenige Treffer je Zelle.
    this.cell = Math.max(1, (totalLen / Math.max(1, count)) * 4);
    this.minX = minX - this.cell;
    this.minY = minY - this.cell;
    this.nx = Math.max(1, Math.ceil((maxX - minX) / this.cell) + 3);
    this.ny = Math.max(1, Math.ceil((maxY - minY) / this.cell) + 3);
    this.buckets = Array.from({ length: this.nx * this.ny }, () => [] as number[]);

    for (let e = 0; e < count; e++) {
      const x1 = this.edges[e * 4];
      const y1 = this.edges[e * 4 + 1];
      const x2 = this.edges[e * 4 + 2];
      const y2 = this.edges[e * 4 + 3];
      const i0 = this.col(Math.min(x1, x2));
      const i1 = this.col(Math.max(x1, x2));
      const j0 = this.row(Math.min(y1, y2));
      const j1 = this.row(Math.max(y1, y2));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) this.buckets[j * this.nx + i].push(e);
      }
    }
  }

  private col(x: number): number {
    return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cell)));
  }

  private row(y: number): number {
    return Math.max(0, Math.min(this.ny - 1, Math.floor((y - this.minY) / this.cell)));
  }

  /** Kuerzester Abstand zu irgendeiner Kante, immer positiv. */
  distance(px: number, py: number): number {
    const ci = this.col(px);
    const cj = this.row(py);
    let best = Infinity;

    const maxRing = Math.max(this.nx, this.ny);
    for (let ring = 0; ring <= maxRing; ring++) {
      // Sobald der naechste Ring weiter entfernt liegt als der bisher beste
      // Treffer, kann dort keine naehere Kante mehr auftauchen.
      if (best < (ring - 1) * this.cell) break;
      let touched = false;
      for (let j = cj - ring; j <= cj + ring; j++) {
        if (j < 0 || j >= this.ny) continue;
        for (let i = ci - ring; i <= ci + ring; i++) {
          if (i < 0 || i >= this.nx) continue;
          if (ring > 0 && Math.abs(i - ci) !== ring && Math.abs(j - cj) !== ring) continue;
          touched = true;
          for (const e of this.buckets[j * this.nx + i]) {
            const d = this.segmentDistance(e, px, py);
            if (d < best) best = d;
          }
        }
      }
      if (!touched && ring > maxRing) break;
    }
    return best;
  }

  private segmentDistance(e: number, px: number, py: number): number {
    const x1 = this.edges[e * 4];
    const y1 = this.edges[e * 4 + 1];
    const dx = this.edges[e * 4 + 2] - x1;
    const dy = this.edges[e * 4 + 3] - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
}
