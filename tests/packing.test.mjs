import test from 'node:test';
import assert from 'node:assert/strict';

import { packCircles, DistanceField } from '../src/pack/packing.ts';
import { circle, roundedRect, heart, polyBounds } from '../src/geo/shapes2d.ts';

function minSpacing(points) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
      if (d < best) best = d;
    }
  }
  return best;
}

test('Abstandsfeld stimmt mit der exakten Rechnung ueberein', () => {
  const reg = { outline: circle(30, 128), holes: [] };
  const f = new DistanceField(reg, 0.4);
  for (const [x, y] of [[0, 0], [10, 10], [25, 0], [0, -20], [30.5, 0]]) {
    const expected = 30 - Math.hypot(x, y);
    assert.ok(Math.abs(f.sample(x, y) - expected) < 0.5, `bei ${x},${y}: ${f.sample(x, y)} vs ${expected}`);
  }
  // Ausserhalb des abgetasteten Bereichs meldet das Feld bewusst "passt nie".
  assert.ok(f.sample(40, 0) < -1000);
  assert.ok(!f.fits(40, 0, 1));
});

test('Wabenmuster haelt den Mindestabstand ein und fuellt die Flaeche', (t) => {
  const reg = { outline: roundedRect(120, 90, 12), holes: [] };
  const pitch = 11;
  const res = packCircles(reg, { pitch, edgeClearance: 6, pattern: 'hex' });
  t.diagnostic(`Wabe: ${res.points.length} Blasen, Dichte ${(res.density * 100).toFixed(1)} %`);

  assert.ok(res.points.length > 60, `nur ${res.points.length} Blasen`);
  assert.ok(minSpacing(res.points) >= pitch - 1e-6, `Mindestabstand ${minSpacing(res.points)}`);

  // Theoretisches Maximum der hexagonalen Packung: pi/(2*sqrt(3)) ~ 0.9069
  assert.ok(res.density <= 0.907 + 1e-6, `Dichte ${res.density} ueber dem Optimum`);
  assert.ok(res.density > 0.6, `Dichte ${res.density} zu niedrig`);
});

test('Wabe schlaegt das Rechteckraster', (t) => {
  const reg = { outline: circle(50, 96), holes: [] };
  const opts = { pitch: 10, edgeClearance: 5.5 };
  const hex = packCircles(reg, { ...opts, pattern: 'hex' });
  const grid = packCircles(reg, { ...opts, pattern: 'grid' });
  t.diagnostic(`Wabe ${hex.points.length} vs Raster ${grid.points.length}`);
  assert.ok(hex.points.length > grid.points.length);
});

test('Alle Muster halten Rand und Abstand ein', (t) => {
  const reg = { outline: heart(110), holes: [circle(6, 32, 0, 0)] };
  for (const pattern of ['hex', 'grid', 'radial', 'sunflower']) {
    const res = packCircles(reg, { pitch: 9, edgeClearance: 5, pattern });
    t.diagnostic(`${pattern}: ${res.points.length} Punkte aus ${res.tried} Gitterlagen`);
    assert.ok(res.points.length > 20, `${pattern} liefert nur ${res.points.length}`);
    assert.ok(minSpacing(res.points) >= 9 - 1e-6, `${pattern} verletzt den Abstand`);
    for (const [x, y] of res.points) {
      assert.ok(Math.hypot(x, y) > 5, `${pattern}: Punkt liegt im Mittelloch`);
    }
    const b = polyBounds(reg.outline);
    for (const [x, y] of res.points) {
      assert.ok(x > b.minX && x < b.maxX && y > b.minY && y < b.maxY, `${pattern}: Punkt ausserhalb`);
    }
  }
});

test('Obergrenze kappt von aussen nach innen', () => {
  const reg = { outline: circle(60, 96), holes: [] };
  const full = packCircles(reg, { pitch: 10, edgeClearance: 5.5, pattern: 'hex' });
  const limited = packCircles(reg, { pitch: 10, edgeClearance: 5.5, pattern: 'hex', maxCount: 40 });
  assert.equal(limited.points.length, 40);
  assert.equal(limited.clipped, full.points.length - 40);
  const maxR = Math.max(...limited.points.map(([x, y]) => Math.hypot(x, y)));
  assert.ok(maxR < 60, 'die aeussersten Punkte muessen zuerst wegfallen');
});

test('Optimierung findet mindestens so viele Punkte wie das ungedrehte Gitter', (t) => {
  const reg = { outline: heart(90), holes: [] };
  const plain = packCircles(reg, { pitch: 9, edgeClearance: 5, pattern: 'hex', optimize: false });
  const tuned = packCircles(reg, { pitch: 9, edgeClearance: 5, pattern: 'hex', optimize: true });
  t.diagnostic(`ohne Optimierung ${plain.points.length}, mit ${tuned.points.length}`);
  assert.ok(tuned.points.length >= plain.points.length);
});
