/**
 * Pruefwerkzeuge fuer die erzeugten Netze. Ein Netz, das hier durchfaellt,
 * faellt auch im Slicer durch.
 */

const KEY_SCALE = 1e4;

function key(x, y, z) {
  return `${Math.round(x * KEY_SCALE)},${Math.round(y * KEY_SCALE)},${Math.round(z * KEY_SCALE)}`;
}

/**
 * Zaehlt gerichtete Kanten. In einem geschlossenen, konsistent orientierten
 * Netz kommt jede Kante genau einmal in jeder Richtung vor.
 */
export function edgeReport(mesh) {
  const p = mesh.positions;
  const counts = new Map();
  let degenerate = 0;

  for (let i = 0; i < p.length; i += 9) {
    const v = [
      key(p[i], p[i + 1], p[i + 2]),
      key(p[i + 3], p[i + 4], p[i + 5]),
      key(p[i + 6], p[i + 7], p[i + 8]),
    ];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) {
      degenerate++;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const a = v[k];
      const b = v[(k + 1) % 3];
      counts.set(`${a}|${b}`, (counts.get(`${a}|${b}`) ?? 0) + 1);
    }
  }

  let unmatched = 0;
  let overused = 0;
  for (const [e, n] of counts) {
    const [a, b] = e.split('|');
    const rev = counts.get(`${b}|${a}`) ?? 0;
    if (n !== 1) overused++;
    if (rev !== n) unmatched++;
  }

  return {
    triangles: mesh.triangleCount,
    degenerate,
    unmatched,
    overused,
    watertight: unmatched === 0 && overused === 0,
  };
}

export function assertSolid(t, mesh, name, { minVolume = 1 } = {}) {
  const report = edgeReport(mesh);
  const vol = mesh.volume();
  t.diagnostic(
    `${name}: ${report.triangles} Dreiecke, Volumen ${vol.toFixed(1)} mm3, ` +
      `offene Kanten ${report.unmatched}, degeneriert ${report.degenerate}`,
  );
  if (!report.watertight) {
    throw new Error(
      `${name} ist nicht wasserdicht: ${report.unmatched} unpaarige, ${report.overused} mehrfach genutzte Kanten`,
    );
  }
  if (report.degenerate > 0) {
    throw new Error(`${name} enthaelt ${report.degenerate} entartete Dreiecke`);
  }
  if (vol < minVolume) {
    throw new Error(`${name} hat unplausibles Volumen ${vol.toFixed(3)} mm3 (Normalen invertiert?)`);
  }
  return { report, vol };
}
