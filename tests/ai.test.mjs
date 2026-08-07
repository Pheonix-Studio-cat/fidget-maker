import test from 'node:test';
import assert from 'node:assert/strict';

import { MODELS, modelById } from '../src/models/index.ts';
import { buildDesignSchema, describeCatalog, findSchemaConflicts } from '../src/ai/schema.ts';
import { parseDesign } from '../src/ai/designer.ts';
import { heuristicDesign } from '../src/ai/heuristic.ts';

test('Kein Parametername hat in zwei Modellen unterschiedliche Typen', () => {
  const conflicts = findSchemaConflicts(MODELS);
  assert.deepEqual(
    conflicts,
    [],
    `Ein gemeinsames Schema ist nur moeglich, wenn gleiche Namen gleiche Typen haben: ${JSON.stringify(conflicts)}`,
  );
});

test('Das Schema deckt jeden Parameter jedes Modells ab', () => {
  const schema = buildDesignSchema(MODELS);
  const props = schema.properties.params.properties;
  for (const model of MODELS) {
    for (const def of model.params) {
      assert.ok(props[def.key], `${model.id}.${def.key} fehlt im Schema`);
      if (def.kind === 'select') {
        for (const opt of def.options) {
          assert.ok(
            props[def.key].enum.includes(opt.value),
            `${def.key}: Wert ${opt.value} fehlt in der Auswahlliste`,
          );
        }
      }
    }
  }
  assert.deepEqual(schema.properties.modelId.enum, MODELS.map((m) => m.id));
  assert.equal(schema.properties.params.additionalProperties, false);
});

test('Der Katalogtext nennt jedes Modell mit Bereichen', () => {
  const text = describeCatalog(MODELS);
  for (const model of MODELS) {
    assert.ok(text.includes(model.id), `${model.id} fehlt`);
    assert.ok(text.includes(model.name));
  }
  assert.match(text, /bis 250 mm/);
});

test('parseDesign begrenzt und saeubert, was die KI liefert', () => {
  const r = parseDesign(JSON.stringify({
    modelId: 'spinner',
    params: { arms: 99, armLength: 26, quatsch: 'weg', bearing: 'gibtsnicht' },
    name: 'Testspinner',
    reason: 'weil',
  }));
  assert.equal(r.modelId, 'spinner');
  assert.ok(r.params.arms <= 6, 'Armzahl muss begrenzt werden');
  assert.equal(r.params.quatsch, undefined, 'unbekannte Schluessel muessen weg');
  assert.equal(r.params.bearing, modelById('spinner').defaults.bearing, 'ungueltige Auswahl faellt zurueck');
  assert.equal(r.source, 'ki');
});

test('parseDesign faengt unbekannte Modelle und kaputtes JSON ab', () => {
  const r = parseDesign(JSON.stringify({ modelId: 'raumschiff', params: {}, name: 'x', reason: 'y' }));
  assert.ok(MODELS.some((m) => m.id === r.modelId), 'muss auf ein echtes Modell zurueckfallen');
  assert.throws(() => parseDesign('kein json'), /gueltiges JSON/);
  assert.throws(() => parseDesign('42'), /Struktur/);
});

test('Jedes Ergebnis der KI laesst sich sofort bauen', (t) => {
  for (const model of MODELS) {
    const r = parseDesign(JSON.stringify({ modelId: model.id, params: {}, name: 'x', reason: 'y' }));
    const result = modelById(r.modelId).build(r.params);
    t.diagnostic(`${model.id}: ${result.parts.length} Teile`);
    assert.ok(result.parts.length > 0);
  }
});

test('Stichwortsuche trifft das richtige Fidget', () => {
  const cases = [
    ['Ich will einen Spinner mit drei Armen', 'spinner'],
    ['ein Kreisel der lange laeuft', 'spinner'],
    ['Klicker mit Tastaturschaltern', 'clicker'],
    ['weicher Ball zum Kneten', 'stressball'],
    ['ein Schieber mit Magneten', 'slider'],
    ['Pop-It mit vielen Blasen', 'popit'],
  ];
  for (const [prompt, expected] of cases) {
    assert.equal(heuristicDesign(prompt).modelId, expected, `"${prompt}"`);
  }
});

test('Stichwortsuche liest Form, Farbe, Groesse und Sonderwuensche', () => {
  const herz = heuristicDesign('ein kleines Pop-It in Herzform, rot, fuer den Schluesselbund');
  assert.equal(herz.params.shape, 'herz');
  assert.equal(herz.params.keyring, true);
  assert.equal(herz.params.colorBase, '#c0392b');
  assert.ok(herz.params.width < modelById('popit').defaults.width, 'klein muss kleiner sein');

  const viele = heuristicDesign('Pop-It mit moeglichst vielen Blasen');
  assert.equal(viele.params.domeSize, 'd5');

  const ohne = heuristicDesign('ein Pop-It ohne Kaufteile, sofort druckbar');
  assert.equal(ohne.params.mechanik, 'gedruckt');

  const spinner = heuristicDesign('Spinner mit 5 Armen');
  assert.equal(spinner.params.arms, 5);

  // Zahlwoerter sind die natuerlichere Formulierung als Ziffern.
  assert.equal(heuristicDesign('ein Spinner mit vier Armen').params.arms, 4);
  assert.equal(heuristicDesign('Clicker mit drei Tasten').params.cols * heuristicDesign('Clicker mit drei Tasten').params.rows >= 3, true);
  // "sechseck" darf nicht als Zahl 6 gelesen werden
  assert.equal(heuristicDesign('Pop-It als Sechseck').params.shape, 'sechseck');

  const ball = heuristicDesign('sehr weicher Stressball mit Stacheln, 70 mm Durchmesser');
  assert.equal(ball.params.material, 'tpu85');
  assert.equal(ball.params.surface, 'stacheln');
  assert.equal(ball.params.diameter, 70);
});

test('Auch die Stichwortsuche liefert immer baubare Parameter', (t) => {
  const prompts = [
    'irgendwas',
    'Spinner',
    'riesiges Pop-It in Sternform, blau und gelb, ohne Kaufteile',
    'winziger Clicker mit 2 Tasten',
    'Slider der schwebt',
    'harter Ball',
  ];
  for (const prompt of prompts) {
    const r = heuristicDesign(prompt);
    const result = modelById(r.modelId).build(r.params);
    t.diagnostic(`"${prompt}" -> ${r.modelId}, ${result.parts.length} Teile`);
    assert.ok(result.parts.length > 0);
    assert.ok(r.reason.length > 10, 'die Begruendung darf nicht leer sein');
  }
});
