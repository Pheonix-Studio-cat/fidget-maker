import test from 'node:test';
import assert from 'node:assert/strict';

import { contour, loopsToRegions, sdCircle, sdRoundedBox, sdCapsule, smoothUnion, subtract, union } from '../src/geo/sdf2d.ts';
import { polyArea, polyBounds } from '../src/geo/shapes2d.ts';
import { extrudeRegion } from '../src/geo/extrude.ts';
import { assertSolid } from './helpers.mjs';

test('Kreis-SDF ergibt einen Umriss mit der richtigen Flaeche', () => {
  const loops = contour(sdCircle(0, 0, 20), 25, 25, { cell: 0.25 });
  assert.equal(loops.length, 1);
  const a = polyArea(loops[0]);
  const expected = Math.PI * 400;
  assert.ok(a > 0, 'Umriss muss gegen den Uhrzeigersinn laufen');
  assert.ok(Math.abs(a - expected) / expected < 0.01, `Flaeche ${a} vs ${expected}`);
});

test('Loch im Koerper wird als zweiter Ring erkannt', () => {
  const f = subtract(sdCircle(0, 0, 20), sdCircle(0, 0, 8));
  const loops = contour(f, 25, 25, { cell: 0.25 });
  assert.equal(loops.length, 2);
  assert.ok(polyArea(loops[0]) > 0, 'Aussenring gegen den Uhrzeigersinn');
  assert.ok(polyArea(loops[1]) < 0, 'Innenring im Uhrzeigersinn');
  const hole = Math.abs(polyArea(loops[1]));
  assert.ok(Math.abs(hole - Math.PI * 64) / (Math.PI * 64) < 0.02, `Lochflaeche ${hole}`);
});

test('Getrennte Formen bleiben getrennt, ueberlappende werden ein Ring', () => {
  const a = sdCircle(-30, 0, 10);
  const b = sdCircle(30, 0, 10);
  assert.equal(contour(union(a, b), 45, 15, { cell: 0.3 }).length, 2);

  // Eine Kapsel verbindet die beiden - erst dadurch entsteht ein Koerper.
  const bridged = smoothUnion(6, a, b, sdCapsule(-30, 0, 30, 0, 4));
  assert.equal(contour(bridged, 45, 25, { cell: 0.3 }).length, 1);
});

test('Der Mischradius verrundet, er ueberbrueckt keine Luecken', () => {
  const a = sdCircle(-11, 0, 10);
  const b = sdCircle(11, 0, 10);
  // Luecke 2 mm: k = 1 reicht nicht, k = 12 zieht die Formen zusammen.
  assert.equal(contour(smoothUnion(1, a, b), 30, 20, { cell: 0.2 }).length, 2);
  assert.equal(contour(smoothUnion(12, a, b), 30, 20, { cell: 0.2 }).length, 1);
});

test('Weiche Vereinigung fuegt Material hinzu, statt es zu entfernen', () => {
  const arms = [sdCircle(0, 0, 12), sdCapsule(0, 0, 40, 0, 9), sdCapsule(0, 0, -40, 0, 9)];
  const hard = contour(union(...arms), 60, 20, { cell: 0.25 })[0];
  const soft = contour(smoothUnion(6, ...arms), 60, 20, { cell: 0.25 })[0];
  assert.ok(polyArea(soft) > polyArea(hard), 'die Hohlkehle fuellt die Innenecke auf');
});

test('Spinner-Umriss aus Kapseln und Scheiben laesst sich extrudieren', (t) => {
  const arms = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * 32;
    const y = Math.sin(a) * 32;
    arms.push(sdCapsule(0, 0, x, y, 9), sdCircle(x, y, 12));
  }
  const body = smoothUnion(8, sdCircle(0, 0, 15), ...arms);
  const loops = contour(body, 50, 50, { cell: 0.3 });
  assert.equal(loops.length, 1, `${loops.length} statt einem Ring`);

  const regions = loopsToRegions(loops);
  assert.equal(regions.length, 1);
  const mesh = extrudeRegion(regions[0], 0, 7);
  assertSolid(t, mesh, 'Spinner-Umriss');

  // Die beiden unteren Arme sitzen bei +/-32*cos(30) = 27.7 mm, plus 12 mm
  // Armradius je Seite, plus etwas Zuwachs durch die Hohlkehle.
  const b = polyBounds(loops[0]);
  assert.ok(b.width > 79 && b.width < 84, `Breite ${b.width}`);
});

test('loopsToRegions ordnet Loecher der richtigen Aussenkontur zu', () => {
  const left = subtract(sdCircle(-30, 0, 20), sdCircle(-30, 0, 8));
  const right = sdCircle(30, 0, 12);
  const regions = loopsToRegions(contour(union(left, right), 55, 25, { cell: 0.3 }));
  assert.equal(regions.length, 2);
  const withHole = regions.find((r) => r.holes.length === 1);
  const solid = regions.find((r) => r.holes.length === 0);
  assert.ok(withHole && solid, 'genau eine Region traegt das Loch');
  assert.ok(polyBounds(withHole.outline).width > 38, 'das Loch gehoert zum grossen Ring');
});

test('Abgerundetes Rechteck trifft die vorgegebenen Masse', () => {
  const loops = contour(sdRoundedBox(0, 0, 60, 40, 8), 40, 30, { cell: 0.2 });
  const b = polyBounds(loops[0]);
  assert.ok(Math.abs(b.width - 60) < 0.4, `Breite ${b.width}`);
  assert.ok(Math.abs(b.height - 40) < 0.4, `Hoehe ${b.height}`);
});
