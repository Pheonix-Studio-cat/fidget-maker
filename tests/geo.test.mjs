import test from 'node:test';
import assert from 'node:assert/strict';

import { Mesh } from '../src/geo/mesh.ts';
import { boxMesh, cylinderMesh, chamferedSlab, extrudeRegion, triangulateRegion } from '../src/geo/extrude.ts';
import { sphereShell, solidDome, domeCap, torus } from '../src/geo/revolve.ts';
import { circle, roundedRect, heart, star, polyArea, offsetPolygon, pointInPolygon } from '../src/geo/shapes2d.ts';
import { assertSolid } from './helpers.mjs';

test('Quader ist wasserdicht und hat das erwartete Volumen', (t) => {
  const m = boxMesh(10, 20, 5);
  const { vol } = assertSolid(t, m, 'Quader');
  assert.ok(Math.abs(vol - 1000) < 1e-6, `Volumen ${vol}`);
});

test('Zylinder naehert sich pi*r^2*h an', (t) => {
  const m = cylinderMesh(10, 10, 256);
  const { vol } = assertSolid(t, m, 'Zylinder');
  assert.ok(Math.abs(vol - Math.PI * 100 * 10) / (Math.PI * 1000) < 0.001);
});

test('Platte mit Loechern bleibt geschlossen', (t) => {
  const holes = [];
  for (let x = -20; x <= 20; x += 10) {
    for (let y = -20; y <= 20; y += 10) {
      holes.push(circle(3, 24, x, y));
    }
  }
  const m = extrudeRegion({ outline: roundedRect(60, 60, 8), holes }, 0, 4);
  const { vol } = assertSolid(t, m, 'Lochplatte');
  const plateArea = 60 * 60 - (4 - Math.PI) * 8 ** 2;
  const expected = (plateArea - 25 * Math.PI * 3 ** 2) * 4;
  assert.ok(Math.abs(vol - expected) / expected < 0.01, `Volumen ${vol} vs ${expected}`);
});

test('Herz- und Sternumriss lassen sich extrudieren', (t) => {
  for (const [name, poly] of [
    ['Herz', heart(60)],
    ['Stern', star(6, 30, 14)],
  ]) {
    const m = extrudeRegion({ outline: poly, holes: [circle(4, 32)] }, 0, 3);
    assertSolid(t, m, name);
  }
});

test('Gefaste Platte bleibt geschlossen', (t) => {
  const m = chamferedSlab(
    { outline: roundedRect(50, 30, 6), holes: [circle(5, 32, 10, 0), circle(5, 32, -10, 0)] },
    0,
    6,
    { chamferBottom: 0.6, chamferTop: 1.2 },
  );
  assertSolid(t, m, 'Gefaste Platte');
});

test('Hohlkugel mit und ohne Bohrung', (t) => {
  const closed = sphereShell({ radius: 25, wall: 2, holeDiameter: 0, segments: 64, rings: 48 });
  const { vol } = assertSolid(t, closed, 'Hohlkugel geschlossen');
  const expected = (4 / 3) * Math.PI * (25 ** 3 - 23 ** 3);
  assert.ok(Math.abs(vol - expected) / expected < 0.01, `Volumen ${vol} vs ${expected}`);

  const bored = sphereShell({ radius: 25, wall: 2, holeDiameter: 4, segments: 64, rings: 48 });
  assertSolid(t, bored, 'Hohlkugel mit Bohrung');
  assert.ok(bored.volume() < vol, 'Bohrung muss Material entfernen');
});

test('Kuppeln und Torus sind geschlossen', (t) => {
  assertSolid(t, solidDome(6, 2.5, 64, 24), 'Massive Kuppel');
  assertSolid(t, domeCap(6, 2.5, 0.8, 64, 24), 'Kuppelschale');
  assertSolid(t, torus(20, 4, 96, 32), 'Torus');
});

test('Polygonhilfen rechnen richtig', () => {
  assert.ok(polyArea(circle(10, 128)) > 0, 'circle laeuft gegen den Uhrzeigersinn');
  const inner = offsetPolygon(circle(10, 64), -2);
  const r = Math.hypot(inner[0][0], inner[0][1]);
  assert.ok(Math.abs(r - 8) < 0.05, `Offset-Radius ${r}`);
  assert.ok(pointInPolygon(circle(10, 64), 0, 0));
  assert.ok(!pointInPolygon(circle(10, 64), 20, 0));
});

test('Triangulierung liefert nur linksdrehende Dreiecke', () => {
  const tris = triangulateRegion({ outline: roundedRect(40, 40, 5), holes: [circle(6, 32)] });
  assert.ok(tris.length > 10);
  for (const [a, b, c] of tris) {
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    assert.ok(cross > 0, 'Dreieck falsch orientiert');
  }
});

test('Mesh-Transformationen erhalten die Geschlossenheit', (t) => {
  const m = new Mesh().add(boxMesh(10, 10, 10));
  m.rotateZ(0.3).rotateX(0.2).translate(5, -3, 2);
  const { vol } = assertSolid(t, m, 'Transformierter Quader');
  assert.ok(Math.abs(vol - 1000) < 1e-6);
});
