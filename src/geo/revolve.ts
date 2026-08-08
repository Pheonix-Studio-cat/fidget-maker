/**
 * Rotationskoerper. Ein Profil ist ein geschlossener Linienzug in der
 * (r, z)-Halbebene; laeuft er gegen den Uhrzeigersinn, zeigen die Normalen
 * des erzeugten Koerpers nach aussen.
 */

import { Mesh, type Vec2, type Vec3 } from './mesh.ts';

export type Profile = Vec2[];

export function revolveProfile(profile: Profile, segments = 64): Mesh {
  const m = new Mesh();
  const n = profile.length;
  const ang = (j: number) => ((j % segments) / segments) * Math.PI * 2;

  for (let i = 0; i < n; i++) {
    const p = profile[i];
    const q = profile[(i + 1) % n];
    if (Math.abs(p[0]) < 1e-9 && Math.abs(q[0]) < 1e-9) continue;

    for (let j = 0; j < segments; j++) {
      const a0 = ang(j);
      const a1 = ang(j + 1);
      const pa: Vec3 = [p[0] * Math.cos(a0), p[0] * Math.sin(a0), p[1]];
      const pb: Vec3 = [p[0] * Math.cos(a1), p[0] * Math.sin(a1), p[1]];
      const qb: Vec3 = [q[0] * Math.cos(a1), q[0] * Math.sin(a1), q[1]];
      const qa: Vec3 = [q[0] * Math.cos(a0), q[0] * Math.sin(a0), q[1]];

      if (Math.abs(p[0]) < 1e-9) m.addTriangle(pa, qb, qa);
      else if (Math.abs(q[0]) < 1e-9) m.addTriangle(pa, pb, qa);
      else m.addQuad(pa, pb, qb, qa);
    }
  }
  return m;
}

export interface SphereShellOptions {
  /** Aussenradius in mm. */
  radius: number;
  /** Wandstaerke in mm. */
  wall: number;
  /** Durchmesser der Entlueftungs-/Fuelloeffnung am Pol (0 = geschlossen). */
  holeDiameter?: number;
  segments?: number;
  rings?: number;
}

/**
 * Hohlkugel mit optionaler Bohrung am oberen Pol - Basis fuer den Stressball.
 * Ohne Bohrung bleibt die Luft eingeschlossen, was den Ball praller macht,
 * aber beim Drucken einen ueberhaengenden Deckel erzwingt.
 */
export function sphereShell(opts: SphereShellOptions): Mesh {
  const { radius: R, wall } = opts;
  const rh = Math.max(0, (opts.holeDiameter ?? 0) / 2);
  const segments = opts.segments ?? 96;
  const rings = opts.rings ?? 72;
  const Ri = Math.max(0.2, R - wall);

  const profile: Profile = [];
  const phiOuterMax = rh > 0 ? Math.acos(Math.min(0.999, rh / R)) : Math.PI / 2;
  const phiInnerMax = rh > 0 ? Math.acos(Math.min(0.999, rh / Ri)) : Math.PI / 2;

  // Aussenhaut: Suedpol -> Aequator -> bis zur Bohrung
  for (let i = 0; i <= rings; i++) {
    const phi = -Math.PI / 2 + (i / rings) * (phiOuterMax + Math.PI / 2);
    profile.push([R * Math.cos(phi), R * Math.sin(phi)]);
  }
  // Die Bohrungswand entsteht implizit als Segment zwischen dem letzten
  // Aussen- und dem ersten Innenpunkt - beide liegen auf r = rh.
  // Innenhaut zurueck zum Suedpol
  for (let i = rings; i >= 0; i--) {
    const phi = -Math.PI / 2 + (i / rings) * (phiInnerMax + Math.PI / 2);
    profile.push([Ri * Math.cos(phi), Ri * Math.sin(phi)]);
  }

  return revolveProfile(profile, segments);
}

/**
 * Kugelkalotte als Schale (offene Unterseite wird durch einen Ring
 * geschlossen) - die Blase ueber einem Pop-It-Dome.
 */
export function domeCap(
  baseRadius: number,
  height: number,
  wall: number,
  segments = 48,
  rings = 16,
): Mesh {
  const h = Math.max(0.2, height);
  const a = Math.max(0.2, baseRadius);
  const R = (a * a + h * h) / (2 * h);
  const phiMax = Math.asin(Math.min(1, a / R));
  const zc = -Math.sqrt(Math.max(0, R * R - a * a));

  const Ri = Math.max(0.1, R - wall);
  const phiMaxI = Math.acos(Math.min(0.999, Math.max(-0.999, (-zc) / Ri)));

  const profile: Profile = [];
  // Aussenhaut von der Kante zum Scheitel
  for (let i = 0; i <= rings; i++) {
    const phi = phiMax - (i / rings) * phiMax;
    profile.push([R * Math.sin(phi), zc + R * Math.cos(phi)]);
  }
  // Innenhaut vom Scheitel zurueck zur Kante
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * phiMaxI;
    profile.push([Ri * Math.sin(phi), zc + Ri * Math.cos(phi)]);
  }
  return revolveProfile(profile, segments);
}

/**
 * Radius, mit dem die Innenflaeche einer Kuppelschale die Ebene z=0 trifft.
 * Damit laesst sich das Loch im Traegerblech passend zur Kuppel bemessen.
 */
export function domeCapInnerBaseRadius(baseRadius: number, height: number, wall: number): number {
  const h = Math.max(0.2, height);
  const a = Math.max(0.2, baseRadius);
  const R = (a * a + h * h) / (2 * h);
  const zc = -Math.sqrt(Math.max(0, R * R - a * a));
  const Ri = Math.max(0.1, R - wall);
  return Math.sqrt(Math.max(0, Ri * Ri - zc * zc));
}

/** Voller Kugelabschnitt (massiv) mit Basis bei z=0. */
export function solidDome(baseRadius: number, height: number, segments = 48, rings = 16): Mesh {
  const h = Math.max(0.05, height);
  const a = Math.max(0.05, baseRadius);
  const R = (a * a + h * h) / (2 * h);
  const zc = -Math.sqrt(Math.max(0, R * R - a * a));
  const phiMax = Math.asin(Math.min(1, a / R));

  const profile: Profile = [[0, 0]];
  for (let i = 0; i <= rings; i++) {
    const phi = phiMax - (i / rings) * phiMax;
    profile.push([R * Math.sin(phi), zc + R * Math.cos(phi)]);
  }
  return revolveProfile(profile, segments);
}

/** Torus um die Z-Achse - Griffringe und Wuelste. */
export function torus(majorRadius: number, minorRadius: number, segments = 64, tubeSegments = 24): Mesh {
  const profile: Profile = [];
  for (let i = 0; i < tubeSegments; i++) {
    const t = (i / tubeSegments) * Math.PI * 2;
    profile.push([majorRadius + Math.cos(t) * minorRadius, Math.sin(t) * minorRadius]);
  }
  return revolveProfile(profile, segments);
}
