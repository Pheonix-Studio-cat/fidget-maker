/**
 * Dreiecksnetz in Millimetern. Alle Generatoren bauen ihre Teile aus dieser
 * Klasse; Exporter und Viewer lesen ausschliesslich `positions`.
 */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface Bounds {
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
}

export class Mesh {
  /** Flaches Array: 9 Zahlen pro Dreieck (3 Ecken * xyz), CCW von aussen gesehen. */
  positions: number[] = [];

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  addTriangle(a: Vec3, b: Vec3, c: Vec3): void {
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  /** Viereck a-b-c-d (in Umlaufrichtung) als zwei Dreiecke. */
  addQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    this.addTriangle(a, b, c);
    this.addTriangle(a, c, d);
  }

  add(other: Mesh): this {
    for (let i = 0; i < other.positions.length; i++) this.positions.push(other.positions[i]);
    return this;
  }

  clone(): Mesh {
    const m = new Mesh();
    m.positions = this.positions.slice();
    return m;
  }

  translate(dx: number, dy: number, dz: number): this {
    const p = this.positions;
    for (let i = 0; i < p.length; i += 3) {
      p[i] += dx;
      p[i + 1] += dy;
      p[i + 2] += dz;
    }
    return this;
  }

  scale(sx: number, sy = sx, sz = sx): this {
    const p = this.positions;
    for (let i = 0; i < p.length; i += 3) {
      p[i] *= sx;
      p[i + 1] *= sy;
      p[i + 2] *= sz;
    }
    if (sx * sy * sz < 0) this.flip();
    return this;
  }

  rotateZ(rad: number): this {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const p = this.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      p[i] = x * c - y * s;
      p[i + 1] = x * s + y * c;
    }
    return this;
  }

  rotateX(rad: number): this {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const p = this.positions;
    for (let i = 0; i < p.length; i += 3) {
      const y = p[i + 1];
      const z = p[i + 2];
      p[i + 1] = y * c - z * s;
      p[i + 2] = y * s + z * c;
    }
    return this;
  }

  rotateY(rad: number): this {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const p = this.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const z = p[i + 2];
      p[i] = x * c + z * s;
      p[i + 2] = -x * s + z * c;
    }
    return this;
  }

  /** Dreht die Normalenrichtung aller Dreiecke um. */
  flip(): this {
    const p = this.positions;
    for (let i = 0; i < p.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const tmp = p[i + 3 + k];
        p[i + 3 + k] = p[i + 6 + k];
        p[i + 6 + k] = tmp;
      }
    }
    return this;
  }

  bounds(): Bounds {
    if (this.positions.length === 0) {
      return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
    }
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    const p = this.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    }
    const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const center: Vec3 = [
      (max[0] + min[0]) / 2,
      (max[1] + min[1]) / 2,
      (max[2] + min[2]) / 2,
    ];
    return { min, max, size, center };
  }

  /** Legt das Netz auf Z=0 und zentriert es in X/Y - so wird es gedruckt. */
  centerOnBed(): this {
    const b = this.bounds();
    return this.translate(-b.center[0], -b.center[1], -b.min[2]);
  }

  /**
   * Volumen in mm^3 ueber das Divergenztheorem. Negativ bedeutet, dass die
   * Normalen nach innen zeigen - dient als Plausibilitaetspruefung.
   */
  volume(): number {
    const p = this.positions;
    let v = 0;
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
      const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    return v;
  }
}

/** Fasst mehrere Netze zu einem zusammen. */
export function mergeMeshes(meshes: Mesh[]): Mesh {
  const out = new Mesh();
  for (const m of meshes) out.add(m);
  return out;
}
