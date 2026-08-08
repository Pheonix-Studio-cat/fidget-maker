/**
 * Hohlkugeln mit strukturierter Oberflaeche.
 *
 * Dellen, Noppen und Wellen entstehen hier nicht durch Abziehen von
 * Koerpern, sondern indem der Aussenradius je Punkt verschoben wird. Das
 * Ergebnis ist immer geschlossen - eine Boolesche Differenz mit hundert
 * kleinen Kugeln waere weder robust noch schnell.
 *
 * Die Innenflaeche folgt Einbuchtungen nach innen mit, damit die Wand
 * nirgends duenner wird als vorgegeben.
 */

import { Mesh, type Vec3 } from './mesh.ts';

/** Verschiebung des Aussenradius in mm; positiv = nach aussen. */
export type Displace = (dx: number, dy: number, dz: number) => number;

export interface TexturedSphereOptions {
  radius: number;
  wall: number;
  /** Durchmesser der Oeffnung am oberen Pol (0 = geschlossen). */
  holeDiameter?: number;
  /** Hoehe der Abflachung an der Unterseite - gibt der Kugel Halt auf dem Bett. */
  flatBottom?: number;
  segments?: number;
  rings?: number;
  displace?: Displace;
}

interface Ring {
  /** Punkte des Rings; leer bei einem Pol. */
  pts: Vec3[];
  pole?: Vec3;
}

function ringAt(
  phi: number,
  radiusAt: (dx: number, dy: number, dz: number) => number,
  segments: number,
  clampZ?: number,
): Ring {
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  if (Math.abs(cp) < 1e-9) {
    const r = radiusAt(0, 0, Math.sign(sp) || 1);
    return { pts: [], pole: [0, 0, r * sp] };
  }
  const pts: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const dx = cp * Math.cos(a);
    const dy = cp * Math.sin(a);
    const r = radiusAt(dx, dy, sp);
    const z = clampZ != null ? Math.max(clampZ, r * sp) : r * sp;
    pts.push([r * dx, r * dy, z]);
  }
  return { pts };
}

/** Verbindet zwei Ringe zu einem Mantelstueck (Normalen nach aussen). */
function stitch(a: Ring, b: Ring, segments: number): Mesh {
  const m = new Mesh();
  if (a.pole && b.pole) return m;
  if (a.pole) {
    for (let i = 0; i < segments; i++) {
      m.addTriangle(a.pole, b.pts[(i + 1) % segments], b.pts[i]);
    }
    return m;
  }
  if (b.pole) {
    for (let i = 0; i < segments; i++) {
      m.addTriangle(a.pts[i], a.pts[(i + 1) % segments], b.pole);
    }
    return m;
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    m.addQuad(a.pts[i], a.pts[j], b.pts[j], b.pts[i]);
  }
  return m;
}

export function texturedSphereShell(opts: TexturedSphereOptions): Mesh {
  const R = opts.radius;
  const wall = Math.max(0.4, Math.min(opts.wall, R * 0.9));
  const Ri = R - wall;
  const rh = Math.max(0, (opts.holeDiameter ?? 0) / 2);
  const flat = Math.max(0, Math.min(opts.flatBottom ?? 0, wall * 0.95));
  const segments = opts.segments ?? 96;
  const rings = opts.rings ?? 64;
  const displace = opts.displace;

  // Am Rand der Bohrung und an der Abflachung wird die Struktur ausgeblendet,
  // damit die dortigen Masse exakt bleiben.
  const phiTopOuter = rh > 0 ? Math.acos(Math.min(0.999, rh / R)) : Math.PI / 2;
  const phiTopInner = rh > 0 ? Math.acos(Math.min(0.999, rh / Ri)) : Math.PI / 2;
  const phiBottom = flat > 0 ? -Math.asin(Math.min(0.999, (R - flat) / R)) : -Math.PI / 2;

  const fade = (phi: number): number => {
    let f = 1;
    const band = 0.3;
    if (phiTopOuter - phi < band) f = Math.min(f, Math.max(0, (phiTopOuter - phi) / band));
    if (phi - phiBottom < band) f = Math.min(f, Math.max(0, (phi - phiBottom) / band));
    return f * f * (3 - 2 * f);
  };

  const outerRadius = (phi: number) => (dx: number, dy: number, dz: number) =>
    displace ? R + displace(dx, dy, dz) * fade(phi) : R;
  // Die Innenflaeche folgt nur Einbuchtungen, nie Auswuechsen - so bleibt die
  // Wand ueberall mindestens `wall` stark.
  const innerRadius = (phi: number) => (dx: number, dy: number, dz: number) =>
    displace ? Math.min(R, R + displace(dx, dy, dz) * fade(phi)) - wall : Ri;

  const m = new Mesh();
  const zFlat = -(R - flat);

  // --- Aussenhaut --------------------------------------------------------
  const outer: Ring[] = [];
  for (let j = 0; j <= rings; j++) {
    const phi = phiBottom + (j / rings) * (phiTopOuter - phiBottom);
    outer.push(ringAt(phi, outerRadius(phi), segments, flat > 0 ? zFlat : undefined));
  }
  for (let j = 0; j < rings; j++) m.add(stitch(outer[j], outer[j + 1], segments));

  // --- Innenhaut ---------------------------------------------------------
  const inner: Ring[] = [];
  for (let j = 0; j <= rings; j++) {
    const phi = -Math.PI / 2 + (j / rings) * (phiTopInner + Math.PI / 2);
    inner.push(ringAt(phi, innerRadius(phi), segments));
  }
  const cavity = new Mesh();
  for (let j = 0; j < rings; j++) cavity.add(stitch(inner[j], inner[j + 1], segments));
  m.add(cavity.flip());

  // --- Abflachung unten --------------------------------------------------
  if (flat > 0) {
    const base = outer[0].pts;
    const center: Vec3 = [0, 0, zFlat];
    for (let i = 0; i < segments; i++) {
      m.addTriangle(center, base[(i + 1) % segments], base[i]);
    }
  }

  // --- Oeffnung oben -----------------------------------------------------
  if (rh > 0) {
    const o = outer[rings].pts;
    const i2 = inner[rings].pts;
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      // Bohrungswand: Normalen zeigen in die Bohrung hinein. Die Reihenfolge
      // muss zur gespiegelten Innenhaut passen - andersherum bleiben die
      // Raender beider Flaechen offen.
      m.addQuad(o[i], o[j], i2[j], i2[i]);
    }
  }

  return m;
}

/**
 * Streumuster gleichmaessig verteilter Richtungen auf der Kugel
 * (Fibonacci-Gitter) - Grundlage fuer Noppen, Dellen und Stacheln.
 */
export function sphereDirections(count: number): Vec3[] {
  const pts: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const z = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const a = i * golden;
    pts.push([Math.cos(a) * r, Math.sin(a) * r, z]);
  }
  return pts;
}

/**
 * Verschiebungsfunktion aus gestreuten Kuppen. `amplitude` positiv gibt
 * Noppen, negativ Dellen. `sharpness` steuert, wie spitz sie zulaufen.
 */
export function bumpDisplace(
  count: number,
  amplitude: number,
  angularRadius: number,
  sharpness = 1,
): Displace {
  const centers = sphereDirections(count);
  const cosR = Math.cos(angularRadius);
  return (dx, dy, dz) => {
    let best = 0;
    for (const c of centers) {
      const dot = dx * c[0] + dy * c[1] + dz * c[2];
      if (dot <= cosR) continue;
      // Auf 0..1 normierter Abstand zur Kuppenmitte
      const t = (dot - cosR) / (1 - cosR);
      const v = Math.pow(t, sharpness);
      if (v > best) best = v;
    }
    return best * amplitude;
  };
}

/** Wellenmuster ueber Laengen- und Breitengrad. */
export function waveDisplace(amplitude: number, meridians: number, parallels: number): Displace {
  return (dx, dy, dz) => {
    const lon = Math.atan2(dy, dx);
    const lat = Math.asin(Math.max(-1, Math.min(1, dz)));
    return amplitude * Math.sin(lon * meridians) * Math.cos(lat * parallels);
  };
}

/** Rautenmuster - kreuzende Rillen. */
export function diamondDisplace(amplitude: number, count: number): Displace {
  return (dx, dy, dz) => {
    const lon = Math.atan2(dy, dx);
    const lat = Math.asin(Math.max(-1, Math.min(1, dz)));
    const a = Math.cos((lon * count + lat * count) * 0.5);
    const b = Math.cos((lon * count - lat * count) * 0.5);
    return amplitude * 0.5 * (a * a + b * b - 1);
  };
}
