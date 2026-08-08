import test from 'node:test';
import assert from 'node:assert/strict';

import { MODELS, modelById } from '../src/models/index.ts';
import { normalizeParams } from '../src/models/types.ts';
import { buildDesignSchema, describeCatalog, findSchemaConflicts } from '../src/ai/schema.ts';
import {
  AI_PROVIDERS,
  defaultProvider,
  choosePrompt,
  designFidget,
  exampleFor,
  fetchModels,
  paramPrompt,
  parseDesign,
  providerById,
  visibleProviders,
} from '../src/ai/designer.ts';
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
  assert.throws(() => parseDesign('[1, 2, 3]'), /Struktur/);
});

test('parseDesign vertraegt geschwaetzige Antworten offener Modelle', () => {
  const inhalt = { modelId: 'spinner', params: { arms: 4 }, name: 'Vierarmer', reason: 'weil' };

  // Llama & Co. verpacken die Antwort gern in eine Code-Umrandung ...
  const umrandet = parseDesign('```json\n' + JSON.stringify(inhalt) + '\n```');
  assert.equal(umrandet.modelId, 'spinner');
  assert.equal(umrandet.params.arms, 4);

  // ... oder stellen einen Satz davor und haengen einen hinten dran.
  const geschwaetzig = parseDesign(
    `Gerne! Hier ist dein Entwurf:\n${JSON.stringify(inhalt)}\nViel Spass beim Drucken.`,
  );
  assert.equal(geschwaetzig.modelId, 'spinner');
  assert.equal(geschwaetzig.name, 'Vierarmer');
});

test('Jeder Anbieter ist vollstaendig beschrieben', () => {
  assert.ok(AI_PROVIDERS.length >= 2, 'es braucht mehr als einen Anbieter');
  for (const p of AI_PROVIDERS) {
    assert.ok(p.models.length > 0, `${p.id} hat keine Modelle`);
    assert.match(p.keyUrl, /^https:\/\//, `${p.id}: keine Bezugsquelle fuer den Schluessel`);
    assert.ok(p.note.length > 20, `${p.id}: der Hinweis ist zu duenn`);
    for (const m of p.models) {
      assert.ok(m.id && m.label && m.help.length > 10, `${p.id}/${m.id} ist unvollstaendig`);
    }
    if (p.api === 'openai') {
      assert.match(p.baseUrl ?? '', /^https:\/\//, `${p.id}: baseUrl fehlt`);
      assert.ok(!p.baseUrl.endsWith('/'), `${p.id}: baseUrl darf nicht auf / enden`);
    }
    assert.equal(providerById(p.id).id, p.id);
  }
});

test('Claude ist ausgeblendet, Llama steht vorne', () => {
  const sichtbar = visibleProviders();
  assert.ok(sichtbar.length > 0, 'irgendetwas muss waehlbar bleiben');
  assert.ok(
    !sichtbar.some((p) => p.id === 'anthropic'),
    'Anthropic soll nicht mehr in der Auswahl auftauchen',
  );

  // Ausgeblendet heisst nicht geloescht - der Code bleibt erreichbar.
  const claude = AI_PROVIDERS.find((p) => p.id === 'anthropic');
  assert.ok(claude, 'Anthropic muss im Katalog bleiben');
  assert.equal(claude.hidden, true);
  assert.ok(claude.models.some((m) => m.id === 'claude-opus-5'));

  // Voreinstellung ist Llama - auch wenn frueher Anthropic gespeichert war.
  assert.match(defaultProvider(null).label, /Llama/);
  assert.equal(defaultProvider('anthropic').id, sichtbar[0].id);
  assert.equal(defaultProvider('groq').id, 'groq');
});

test('Jedes Ergebnis der KI laesst sich sofort bauen', (t) => {
  for (const model of MODELS) {
    const r = parseDesign(JSON.stringify({ modelId: model.id, params: {}, name: 'x', reason: 'y' }));
    const result = modelById(r.modelId).build(r.params);
    t.diagnostic(`${model.id}: ${result.parts.length} Teile`);
    assert.ok(result.parts.length > 0);
  }
});

/**
 * Die echten Endpunkte lassen sich hier nicht aufrufen, der Aufbau der
 * Anfrage schon: Adresse, Kopfzeilen und Nachrichtenform sind das, was beim
 * Anbieterwechsel kaputtgeht.
 */
/**
 * Die Beispiele im Prompt sind das, woran sich kleine Modelle orientieren.
 * Ein erfundener Parameter oder Wert waere dort besonders schaedlich - er
 * wuerde zuverlaessig nachgeahmt und dann stillschweigend weggeworfen.
 */
test('Die Beispiele im Prompt bestehen aus echten Parametern', (t) => {
  for (const model of MODELS) {
    const beispiel = exampleFor(model);
    const bereinigt = normalizeParams(model, { ...model.defaults, ...beispiel.params });

    for (const [key, wert] of Object.entries(beispiel.params)) {
      const def = model.params.find((p) => p.key === key);
      assert.ok(def, `${model.id}: Parameter "${key}" gibt es nicht`);
      assert.deepEqual(
        bereinigt[key],
        wert,
        `${model.id}.${key}: der Beispielwert ${JSON.stringify(wert)} ueberlebt normalizeParams nicht`,
      );
    }

    // Und das Beispiel muss sich auch bauen lassen.
    const gebaut = model.build(bereinigt);
    t.diagnostic(`${model.id}: ${beispiel.name} -> ${gebaut.parts.length} Teile`);
    assert.ok(gebaut.parts.length > 0);
  }
});

test('Die Prompts sind klein genug fuer kleine Modelle', (t) => {
  const auswahl = choosePrompt();
  t.diagnostic(`Auswahl: ${auswahl.length} Zeichen`);
  assert.ok(auswahl.length < 900, `die Auswahlfrage ist mit ${auswahl.length} Zeichen zu lang`);
  for (const model of MODELS) {
    assert.match(auswahl, new RegExp(`\\b${model.id}\\b`), `${model.id} fehlt in der Auswahl`);
  }

  for (const model of MODELS) {
    const prompt = paramPrompt(model);
    t.diagnostic(`${model.id}: ${prompt.length} Zeichen`);
    // Frueher waren es rund 19500 Zeichen fuer alle Modelle zusammen.
    assert.ok(prompt.length < 6000, `${model.id}: ${prompt.length} Zeichen sind zu viel`);
    // Nur die Parameter dieses einen Fidgets duerfen darin stehen.
    for (const other of MODELS) {
      if (other.id === model.id) continue;
      assert.ok(!prompt.includes(`## ${other.id} -`), `${model.id}: ${other.id} steht mit drin`);
    }
  }
});

test('Der Entwurf laeuft in zwei kleinen Schritten', async () => {
  const echt = globalThis.fetch;
  const rufe = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    rufe.push({ url, init, body });
    // Schritt 1 fragt nach dem Fidget, Schritt 2 nach den Parametern.
    const antwort =
      rufe.length === 1
        ? 'Das waere am ehesten ein stressball.'
        : JSON.stringify({ params: { diameter: 70 }, name: 'Knautschball', reason: 'weich' });
    return new Response(JSON.stringify({ choices: [{ message: { content: antwort } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  let design;
  try {
    design = await designFidget({
      prompt: 'ein weicher Ball',
      apiKey: 'sk-or-v1-testschluessel',
      provider: 'openrouter',
      images: [{ data: 'AAAA', mediaType: 'image/png' }],
    });
  } finally {
    globalThis.fetch = echt;
  }

  assert.equal(rufe.length, 2, 'es sind genau zwei Anfragen');
  assert.equal(design.modelId, 'stressball');
  assert.equal(design.params.diameter, 70);
  assert.equal(design.name, 'Knautschball');
  assert.equal(design.source, 'ki');

  for (const ruf of rufe) {
    assert.equal(ruf.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(ruf.init.method, 'POST');
    assert.equal(ruf.init.headers.authorization, 'Bearer sk-or-v1-testschluessel');
    assert.equal(ruf.body.model, 'meta-llama/llama-3.3-70b-instruct:free');
    // Beide Schritte sehen den Wunsch und die Bilder.
    const user = ruf.body.messages[1].content;
    assert.equal(user.at(-1).text, 'ein weicher Ball');
    assert.ok(
      user.some((p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/png;base64,')),
      'Bilder muessen als data-URL mitgehen',
    );
  }

  // Schritt 1: kurze Auswahlfrage, knappe Antwort, kein JSON-Zwang.
  const auswahl = rufe[0].body;
  assert.ok(auswahl.messages[0].content.length < 900, 'die Auswahlfrage muss kurz sein');
  assert.ok(auswahl.max_tokens <= 32, 'ein Wort braucht keine 2000 Token');
  assert.equal(auswahl.response_format, undefined);

  // Schritt 2: nur die Parameter des gewaehlten Fidgets, mit Beispiel.
  const params = rufe[1].body;
  assert.equal(params.response_format.type, 'json_object');
  assert.match(params.messages[0].content, /## stressball/, 'der Stressball muss drinstehen');
  assert.ok(!params.messages[0].content.includes('## spinner -'), 'fremde Fidgets gehoeren nicht hinein');
  assert.match(params.messages[0].content, /"params":/, 'ein Beispiel muss die Form zeigen');
});

test('Groq bekommt keine Bilder geschickt', async () => {
  const echt = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"modelId":"popit","params":{}}' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    await designFidget({
      prompt: 'Pop-It',
      apiKey: 'gsk_test',
      provider: 'groq',
      images: [{ data: 'AAAA', mediaType: 'image/png' }],
    });
  } finally {
    globalThis.fetch = echt;
  }

  // Groq wertet die Bilder nicht aus - sie mitzuschicken waere nur Ballast.
  assert.ok(!body.messages[1].content.some((p) => p.type === 'image_url'));
});

test('Fehler des Anbieters kommen als lesbarer Satz an', async () => {
  const echt = globalThis.fetch;
  const faelle = [
    [401, /Schluessel abgelehnt/],
    [402, /Guthaben/],
    [404, /kennt dieses Modell nicht/],
    [429, /bremst/],
  ];

  try {
    for (const [status, muster] of faelle) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: { message: 'nope' } }), { status });
      await assert.rejects(
        designFidget({ prompt: 'x', apiKey: 'k', provider: 'openrouter' }),
        muster,
        `Status ${status}`,
      );
    }
  } finally {
    globalThis.fetch = echt;
  }
});

/**
 * Fest eingebaute Modellkennungen veralten - genau daran ist der erste
 * echte Versuch gescheitert. Deshalb holt die App die Liste beim Anbieter.
 */
test('Die Modellliste kommt vom Anbieter, gratis und gross zuerst', async () => {
  const echt = globalThis.fetch;
  let gesehen = null;
  globalThis.fetch = async (url, init) => {
    gesehen = { url, init };
    return new Response(
      JSON.stringify({
        data: [
          { id: 'openai/gpt-4o', name: 'GPT-4o' },
          { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B' },
          { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
          { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B' },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  let modelle;
  try {
    modelle = await fetchModels(providerById('openrouter'), 'sk-or-v1-test');
  } finally {
    globalThis.fetch = echt;
  }

  assert.equal(gesehen.url, 'https://openrouter.ai/api/v1/models');
  assert.equal(gesehen.init.headers.authorization, 'Bearer sk-or-v1-test');

  // Fremde Anbieter fliegen raus, sonst waere die Auswahl unbrauchbar.
  assert.ok(!modelle.some((m) => m.id.startsWith('openai/')), 'nur Llama gehoert in die Liste');

  // Gratis vor bezahlt, gross vor klein.
  assert.deepEqual(
    modelle.map((m) => m.id),
    [
      'meta-llama/llama-3.3-70b-instruct:free',
      'meta-llama/llama-3.1-8b-instruct:free',
      'meta-llama/llama-3.3-70b-instruct',
    ],
  );
  assert.match(modelle[0].label, /\(gratis\)$/);
  assert.match(modelle[0].help, /meta-llama\/llama-3\.3-70b-instruct:free/, 'die Kennung muss sichtbar sein');
});

test('Ohne Schluessel fragt OpenRouter trotzdem, Groq meldet sich', async () => {
  const echt = globalThis.fetch;
  try {
    // Ohne Schluessel darf kein leerer Authorization-Kopf mitgehen.
    let kopf = 'noch nicht gesehen';
    globalThis.fetch = async (_url, init) => {
      kopf = init.headers.authorization;
      return new Response(JSON.stringify({ data: [{ id: 'llama-3.3-70b-versatile' }] }), {
        status: 200,
      });
    };
    await fetchModels(providerById('openrouter'));
    assert.equal(kopf, undefined);

    // 401 wird zu einem Satz, der sagt, was fehlt.
    globalThis.fetch = async () => new Response('nope', { status: 401 });
    await assert.rejects(fetchModels(providerById('groq')), /gueltigen Schluessel/);

    globalThis.fetch = async () => new Response('nope', { status: 500 });
    await assert.rejects(fetchModels(providerById('groq')), /Fehler 500/);
  } finally {
    globalThis.fetch = echt;
  }
});

test('Ein Anbieter ohne Modellliste sagt das, statt zu raten', async () => {
  await assert.rejects(fetchModels(AI_PROVIDERS.find((p) => p.id === 'anthropic')), /keine Modellliste/);
});

test('Ohne Schluessel wird nichts verschickt', async () => {
  const echt = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Ohne Schluessel darf keine Anfrage rausgehen.');
  };
  try {
    const design = await designFidget({ prompt: 'Spinner mit vier Armen' });
    assert.equal(design.source, 'heuristik');
    assert.equal(design.modelId, 'spinner');
  } finally {
    globalThis.fetch = echt;
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
