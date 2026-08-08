import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

import { MODELS, modelById } from '../src/models/index.ts';
import { meshToStl } from '../src/export/stl.ts';
import { buildThreeMf } from '../src/export/threemf.ts';
import { exportProject, layoutParts } from '../src/export/project.ts';
import { boxMesh } from '../src/geo/extrude.ts';

test('STL hat die vorgeschriebene Groesse und Dreieckszahl', () => {
  const mesh = boxMesh(10, 10, 10);
  const stl = meshToStl(mesh, 'Test');
  assert.equal(stl.length, 84 + 12 * 50, 'Kopf 84 Byte plus 50 Byte je Dreieck');
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  assert.equal(view.getUint32(80, true), 12);
});

test('STL-Normalen zeigen nach aussen', () => {
  const stl = meshToStl(boxMesh(10, 10, 10));
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  let outward = 0;
  for (let i = 0; i < 12; i++) {
    const off = 84 + i * 50;
    const n = [view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true)];
    // Schwerpunkt des Dreiecks relativ zur Wuerfelmitte (Wuerfel sitzt auf z=0)
    const c = [0, 0, 0];
    for (let v = 0; v < 3; v++) {
      c[0] += view.getFloat32(off + 12 + v * 12, true) / 3;
      c[1] += view.getFloat32(off + 16 + v * 12, true) / 3;
      c[2] += (view.getFloat32(off + 20 + v * 12, true) - 5) / 3;
    }
    if (n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > 0) outward++;
  }
  assert.equal(outward, 12, 'alle Normalen muessen vom Mittelpunkt weg zeigen');
});

test('3MF ist ein gueltiges ZIP mit den drei Pflichtdateien', () => {
  const data = buildThreeMf([{ name: 'Wuerfel', mesh: boxMesh(10, 10, 10) }], { title: 'Test' });
  const files = unzipSync(data);
  assert.ok(files['[Content_Types].xml'], 'Content-Types fehlt');
  assert.ok(files['_rels/.rels'], 'Beziehungsdatei fehlt');
  assert.ok(files['3D/3dmodel.model'], 'Modelldatei fehlt');

  const xml = strFromU8(files['3D/3dmodel.model']);
  assert.match(xml, /unit="millimeter"/, 'Einheit muss Millimeter sein');
  assert.match(xml, /<object id="1" type="model" name="Wuerfel">/);
  assert.match(xml, /<item objectid="1"/);
  // Ein Wuerfel hat 8 verschiedene Ecken und 12 Dreiecke
  assert.equal((xml.match(/<vertex /g) ?? []).length, 8, 'Ecken muessen zusammengefasst werden');
  assert.equal((xml.match(/<triangle /g) ?? []).length, 12);
});

test('3MF verweist nur auf gueltige Eckenindizes', () => {
  const model = modelById('spinner');
  const result = model.build(model.defaults);
  const data = buildThreeMf(result.parts.map((p) => ({ name: p.name, mesh: p.mesh })));
  const xml = strFromU8(unzipSync(data)['3D/3dmodel.model']);

  for (const objXml of xml.split('<object ').slice(1)) {
    const vertexCount = (objXml.match(/<vertex /g) ?? []).length;
    for (const m of objXml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)) {
      for (let k = 1; k <= 3; k++) {
        assert.ok(Number(m[k]) < vertexCount, `Index ${m[k]} liegt ausserhalb von ${vertexCount} Ecken`);
      }
    }
  }
});

test('Sonderzeichen in Namen werden escaped', () => {
  const data = buildThreeMf([{ name: 'A & B <c>', mesh: boxMesh(5, 5, 5) }]);
  const xml = strFromU8(unzipSync(data)['3D/3dmodel.model']);
  assert.match(xml, /name="A &amp; B &lt;c&gt;"/);
  assert.ok(!xml.includes('name="A & B'), 'rohes Kaufmanns-Und wuerde das XML zerstoeren');
});

test('Anordnung legt alles auf die Platte, ohne dass sich Teile ueberlappen', () => {
  for (const model of MODELS) {
    const result = model.build(model.defaults);
    const placed = layoutParts(result, { width: 250, gap: 6 });
    assert.ok(placed.length >= result.parts.length);

    const boxes = placed.map(({ part, offset }) => {
      const b = part.mesh.bounds();
      return {
        group: part.group ?? null,
        x0: b.min[0] + offset[0], x1: b.max[0] + offset[0],
        y0: b.min[1] + offset[1], y1: b.max[1] + offset[1],
        z0: b.min[2] + offset[2],
      };
    });

    // Auf dem Bett aufliegen muss jede Baugruppe, nicht jedes Einzelteil:
    // der Wagen des Sliders schwebt bestimmungsgemaess im Kanal.
    const lowestPerGroup = new Map();
    for (const box of boxes) {
      const key = box.group ?? boxes.indexOf(box);
      lowestPerGroup.set(key, Math.min(lowestPerGroup.get(key) ?? Infinity, box.z0));
    }
    for (const [key, z] of lowestPerGroup) {
      assert.ok(Math.abs(z) < 1e-6, `${model.id}/${key}: Baugruppe schwebt oder steckt im Bett (z=${z})`);
    }

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        // Teile derselben Gruppe duerfen und sollen sich ueberlappen.
        if (a.group && a.group === b.group) continue;
        const overlap = a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.y0 < b.y1 - 1e-6 && b.y0 < a.y1 - 1e-6;
        assert.ok(!overlap, `${model.id}: zwei Teile ueberlappen sich auf der Platte`);
      }
    }
  }
});

test('Gruppierte Teile behalten ihre Lage zueinander', () => {
  const model = modelById('slider');
  const result = model.build(model.defaults);
  const placed = layoutParts(result);
  const rail = placed.find((x) => x.part.id === 'schiene');
  const car = placed.find((x) => x.part.id === 'wagen');
  assert.deepEqual(rail.offset, car.offset, 'Schiene und Wagen brauchen dieselbe Verschiebung');

  // Der Wagen muss innerhalb der Schiene liegen
  const rb = rail.part.mesh.bounds();
  const cb = car.part.mesh.bounds();
  assert.ok(cb.min[0] > rb.min[0] && cb.max[0] < rb.max[0], 'Wagen ragt seitlich heraus');
  assert.ok(cb.min[2] > rb.min[2], 'Wagen muss ueber dem Schienenboden liegen');
});

test('Das Paket enthaelt 3MF, STLs und die Anleitung', () => {
  const model = modelById('popit');
  const result = model.build(model.defaults);
  const project = exportProject(model, result, model.defaults);
  const files = unzipSync(project.data);
  const names = Object.keys(files);

  assert.ok(names.some((n) => n.endsWith('.3mf')), '3MF fehlt');
  assert.ok(names.includes('Anleitung.txt'), 'Anleitung fehlt');
  assert.equal(names.filter((n) => n.startsWith('STL/')).length, result.parts.length);

  const txt = strFromU8(files['Anleitung.txt']);
  assert.match(txt, /KENNZAHLEN/);
  assert.match(txt, /MONTAGE/);
  assert.match(txt, /Blasen/);
  assert.match(txt, /Metall-Schnappkuppeln/);
  assert.match(txt, /aliexpress/i, 'Bezugsquelle muss in der Anleitung stehen');
});

test('Beim Slider liegen die gruppierten Teile in einer gemeinsamen STL', () => {
  const model = modelById('slider');
  const result = model.build(model.defaults);
  const files = unzipSync(exportProject(model, result, model.defaults).data);
  const stls = Object.keys(files).filter((n) => n.startsWith('STL/'));
  assert.equal(stls.length, 1, `erwartet eine gemeinsame Datei, gefunden: ${stls.join(', ')}`);
  assert.match(stls[0], /zusammen/);
});

test('Jedes Modell laesst sich vollstaendig exportieren', () => {
  for (const model of MODELS) {
    const result = model.build(model.defaults);
    const project = exportProject(model, result, model.defaults);
    assert.ok(project.data.length > 1000, `${model.id}: Paket ist verdaechtig klein`);
    const files = unzipSync(project.data);
    const modelXml = strFromU8(files[Object.keys(files).find((n) => n.endsWith('.3mf')) ? '3D/3dmodel.model' : ''] ?? new Uint8Array());
    // Die 3MF liegt als eigenes ZIP im Paket - sie wird separat geprueft.
    assert.ok(!modelXml, 'die 3MF ist ein eigenes Archiv im Paket');

    const inner = unzipSync(files[Object.keys(files).find((n) => n.endsWith('.3mf'))]);
    const xml = strFromU8(inner['3D/3dmodel.model']);
    assert.match(xml, /unit="millimeter"/);
    assert.ok((xml.match(/<item /g) ?? []).length > 0, `${model.id}: keine Objekte auf der Platte`);
  }
});
