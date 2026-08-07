/**
 * Binaeres STL. Einheit ist wie ueblich stillschweigend Millimeter -
 * Bambu Studio, PrusaSlicer und Cura lesen es genauso.
 */

import { Mesh } from '../geo/mesh.ts';

export function meshToStl(mesh: Mesh, header = 'Fidget Maker'): Uint8Array {
  const count = mesh.triangleCount;
  const buf = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const text = new TextEncoder().encode(header.slice(0, 79));
  bytes.set(text, 0);
  view.setUint32(80, count, true);

  const p = mesh.positions;
  let off = 84;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    view.setFloat32(off, nx, true);
    view.setFloat32(off + 4, ny, true);
    view.setFloat32(off + 8, nz, true);
    view.setFloat32(off + 12, ax, true);
    view.setFloat32(off + 16, ay, true);
    view.setFloat32(off + 20, az, true);
    view.setFloat32(off + 24, bx, true);
    view.setFloat32(off + 28, by, true);
    view.setFloat32(off + 32, bz, true);
    view.setFloat32(off + 36, cx, true);
    view.setFloat32(off + 40, cy, true);
    view.setFloat32(off + 44, cz, true);
    view.setUint16(off + 48, 0, true);
    off += 50;
  }

  return bytes;
}
