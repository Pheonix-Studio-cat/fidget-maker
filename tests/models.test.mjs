import test from 'node:test';
import assert from 'node:assert/strict';

import { MODELS, modelById } from '../src/models/index.ts';
import { normalizeParams } from '../src/models/types.ts';
import { assertSolid, edgeReport } from './helpers.mjs';

/**
 * Teile duerfen aus mehreren sich ueberlappenden Volumen bestehen - der
 * Slicer vereinigt sie. Geprueft wird deshalb pro Teil, dass jedes Volumen
 * geschlossen ist (keine offenen Kanten) und Material vorhanden ist.
 */
function assertPart(t, part, label) {
  const report = edgeReport(part.mesh);
  const vol = part.mesh.volume();
  t.diagnostic(
    `${label}: ${report.triangles} Dreiecke, ${vol.toFixed(0)} mm3, offene Kanten ${report.unmatched}`,
  );
  assert.equal(report.unmatched, 0, `${label} hat ${report.unmatched} offene Kanten`);
  assert.equal(report.degenerate, 0, `${label} hat ${report.degenerate} entartete Dreiecke`);
  assert.ok(vol > 10, `${label} hat kaum Volumen (${vol.toFixed(2)} mm3)`);
  const b = part.mesh.bounds();
  assert.ok(b.size[0] > 0 && b.size[1] > 0 && b.size[2] > 0, `${label} ist flach`);
}

test('Jedes Modell baut mit seinen Vorgabewerten', (t) => {
  for (const model of MODELS) {
    const result = model.build(model.defaults);
    assert.ok(result.parts.length > 0, `${model.id} liefert keine Teile`);
    for (const part of result.parts) assertPart(t, part, `${model.id}/${part.id}`);
    assert.ok(result.stats.length > 0, `${model.id} liefert keine Kennzahlen`);
    assert.ok(result.steps.length > 0, `${model.id} liefert keine Anleitung`);
    assert.ok(result.profile.layerHeight > 0);
  }
});

test('Jede Voreinstellung jedes Modells baut sauber', (t) => {
  for (const model of MODELS) {
    for (const preset of model.presets) {
      const p = normalizeParams(model, preset.params);
      const result = model.build(p);
      for (const part of result.parts) assertPart(t, part, `${model.id}/${preset.id}/${part.id}`);
    }
  }
});

test('normalizeParams begrenzt Werte und wirft Unsinn weg', () => {
  const model = modelById('popit');
  const p = normalizeParams(model, {
    width: 999999,
    shape: 'gibtsnicht',
    gapWall: -5,
    unbekannt: 42,
    keyring: 'ja',
  });
  assert.ok(p.width <= 250, 'Breite muss begrenzt werden');
  assert.equal(p.shape, model.defaults.shape, 'unbekannte Form faellt auf die Vorgabe zurueck');
  assert.ok(p.gapWall >= 1, 'negativer Steg wird angehoben');
  assert.equal(p.unbekannt, undefined, 'unbekannte Schluessel werden verworfen');
  assert.equal(p.keyring, model.defaults.keyring, 'falscher Typ wird ignoriert');
});

test('Pop-It: mehr Blasen bei kleineren Kuppeln und knapperem Steg', (t) => {
  const model = modelById('popit');
  const gross = model.build(normalizeParams(model, { ...model.defaults, domeSize: 'd14', gapWall: 3 }));
  const klein = model.build(normalizeParams(model, { ...model.defaults, domeSize: 'd5', gapWall: 1.5 }));
  const n = (r) => Number(r.stats.find((s) => s.label === 'Blasen').value);
  t.diagnostic(`14 mm mit 3 mm Steg: ${n(gross)} Blasen, 5 mm mit 1.5 mm Steg: ${n(klein)} Blasen`);
  assert.ok(n(klein) > n(gross) * 3, 'kleine Kuppeln muessen deutlich mehr Blasen ergeben');
});

test('Pop-It: die Obergrenze wird eingehalten', () => {
  const model = modelById('popit');
  const r = model.build(normalizeParams(model, { ...model.defaults, maxDomes: 12 }));
  assert.equal(Number(r.stats.find((s) => s.label === 'Blasen').value), 12);
});

test('Pop-It: die Stueckliste zaehlt genau die verbauten Kuppeln', () => {
  const model = modelById('popit');
  const r = model.build(model.defaults);
  const blasen = Number(r.stats.find((s) => s.label === 'Blasen').value);
  const kuppeln = r.bom.find((b) => b.label.includes('Schnappkuppeln'));
  assert.ok(kuppeln, 'Stueckliste muss die Kuppeln enthalten');
  assert.equal(kuppeln.qty, blasen);
});

test('Pop-It: gedruckter Modus kommt ohne Kaufteile aus', (t) => {
  const model = modelById('popit');
  const r = model.build(normalizeParams(model, { ...model.defaults, mechanik: 'gedruckt' }));
  assert.equal(r.bom.length, 0, 'im gedruckten Modus darf nichts zu kaufen sein');
  for (const part of r.parts) assertPart(t, part, `popit/gedruckt/${part.id}`);
});

test('Zu kleine Platte meldet eine Warnung statt still nichts zu bauen', () => {
  const model = modelById('popit');
  // 30 mm Platte, 14-mm-Kuppel und 8 mm Rahmen: dafuer reicht der Platz nicht.
  // Bewusst ohne normalizeParams, weil die Oberflaeche 30 mm gar nicht erst
  // zulaesst - der Generator muss den Fall trotzdem sauber abfangen.
  const r = model.build({ ...model.defaults, width: 30, height: 30, domeSize: 'd14', rimWall: 8 });
  assert.equal(Number(r.stats.find((s) => s.label === 'Blasen').value), 0);
  assert.ok(r.warnings.some((w) => w.includes('keine einzige Blase')), 'fehlende Warnung');
});
