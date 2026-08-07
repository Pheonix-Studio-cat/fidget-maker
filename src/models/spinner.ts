/**
 * Fidget-Spinner.
 *
 * Der Umriss entsteht aus Abstandsfunktionen: eine Scheibe in der Mitte,
 * je Arm eine Kapsel nach aussen und ein Kreis an der Spitze. Die weiche
 * Vereinigung legt die Hohlkehlen zwischen Nabe und Armen gleich mit an -
 * genau die Stellen, an denen ein Spinner sonst bricht.
 *
 * Ausgewuchtet ist er von selbst: alle Arme sind gleich, gleich schwer und
 * gleichmaessig verteilt.
 */

import { cylinderMesh } from '../geo/extrude.ts';
import { Mesh } from '../geo/mesh.ts';
import {
  contour,
  loopsToRegions,
  polygonInsetter,
  sdCapsule,
  sdCircle,
  smoothUnion,
  type Sdf,
} from '../geo/sdf2d.ts';
import {
  polyArea,
  polyBounds,
  regularPolygon,
  circle,
  type Poly,
} from '../geo/shapes2d.ts';
import { triangulateRegion } from '../geo/extrude.ts';
import { BEARINGS, MAGNETS, bearingById, magnetById, materialById, MATERIALS } from '../catalog/parts.ts';
import { chamferedPlate, roundPocketPoly, type Pocket } from './build.ts';
import {
  bool,
  gramFor,
  num,
  str,
  type BuildResult,
  type FidgetModel,
  type ParamDef,
  type Params,
} from './types.ts';

/** M8-Sechskantmutter - beliebtes Armgewicht aus dem Baumarkt. */
const M8_NUT = { acrossFlats: 13.0, height: 6.5, mass: 4.4 };

function movePoly(poly: Poly, dx: number, dy: number): Poly {
  return poly.map(([x, y]) => [x + dx, y + dy] as [number, number]);
}

const WEIGHTS = [
  { value: 'keine', label: 'Keine', help: 'Leichter Spinner, laeuft kuerzer, dafuer sofort fertig.' },
  { value: 'lager', label: 'Kugellager', help: 'Dieselben Lager wie in der Mitte - laufen frei mit und sehen gut aus.' },
  { value: 'muttern', label: 'M8-Muttern', help: 'Sechskantmuttern aus dem Baumarkt, je 4.4 g. Guenstigste Art, Masse nach aussen zu bringen.' },
  { value: 'magnete', label: 'Magnete', help: 'Scheibenmagnete - schwer und sie halten von selbst in der Tasche.' },
];

const params: ParamDef[] = [
  { kind: 'number', key: 'arms', label: 'Anzahl Arme', group: 'Form', min: 2, max: 6, step: 1 },
  {
    kind: 'number', key: 'armLength', label: 'Armlaenge', group: 'Form',
    min: 12, max: 60, step: 0.5, unit: 'mm',
    help: 'Abstand von der Mitte zum Armzentrum. Laengere Arme bringen mehr Traegheit, machen den Spinner aber kopflastig.',
  },
  { kind: 'number', key: 'armRadius', label: 'Armradius', group: 'Form', min: 6, max: 26, step: 0.5, unit: 'mm' },
  {
    kind: 'number', key: 'waist', label: 'Stegbreite', group: 'Form',
    min: 3, max: 24, step: 0.5, unit: 'mm',
    help: 'Halbe Breite der Verbindung zwischen Nabe und Arm.',
  },
  {
    kind: 'number', key: 'blend', label: 'Hohlkehle', group: 'Form',
    min: 0, max: 20, step: 0.5, unit: 'mm',
    help: 'Wie weich Nabe und Arme ineinander uebergehen. Mehr heisst stabiler und angenehmer in der Hand.',
  },
  { kind: 'number', key: 'thickness', label: 'Dicke', group: 'Form', min: 4, max: 14, step: 0.2, unit: 'mm' },
  { kind: 'number', key: 'chamfer', label: 'Kantenbruch', group: 'Form', min: 0, max: 2.5, step: 0.1, unit: 'mm' },

  {
    kind: 'select', key: 'bearing', label: 'Mittleres Lager', group: 'Lager',
    options: BEARINGS.map((b) => ({ value: b.id, label: b.label, help: `${b.mass} g` })),
  },
  {
    kind: 'number', key: 'bearingFit', label: 'Presspassung', group: 'Lager',
    min: -0.3, max: 0.3, step: 0.05, unit: 'mm',
    help: 'Negativ heisst Untermass: das Lager wird eingepresst. Faellt es heraus, hier 0.05 mm abziehen.',
  },
  { kind: 'boolean', key: 'caps', label: 'Kappen mitdrucken', group: 'Lager' },
  {
    kind: 'number', key: 'capHeight', label: 'Kappenhoehe', group: 'Lager',
    when: (p) => p.caps === true, min: 1.5, max: 8, step: 0.5, unit: 'mm',
  },

  { kind: 'select', key: 'weightMode', label: 'Armgewichte', group: 'Gewichte', options: WEIGHTS },
  {
    kind: 'select', key: 'weightBearing', label: 'Lagertyp in den Armen', group: 'Gewichte',
    when: (p) => p.weightMode === 'lager',
    options: BEARINGS.map((b) => ({ value: b.id, label: b.label })),
  },
  {
    kind: 'select', key: 'weightMagnet', label: 'Magnetgroesse', group: 'Gewichte',
    when: (p) => p.weightMode === 'magnete',
    options: MAGNETS.filter((m) => m.shape === 'disc').map((m) => ({ value: m.id, label: m.label })),
  },
  {
    kind: 'number', key: 'weightFit', label: 'Spiel der Gewichtstasche', group: 'Gewichte',
    when: (p) => p.weightMode !== 'keine', min: -0.3, max: 0.4, step: 0.05, unit: 'mm',
  },

  {
    kind: 'select', key: 'decoration', label: 'Durchbrueche', group: 'Gestaltung',
    options: [
      { value: 'keine', label: 'Keine' },
      { value: 'ring', label: 'Ring um die Nabe', help: 'Kranz kleiner Loecher um das mittlere Lager.' },
      { value: 'arme', label: 'Loch je Arm', help: 'Ein grosses Loch in jedem Arm - spart Gewicht aussen.' },
      { value: 'beides', label: 'Beides' },
    ],
  },
  {
    kind: 'number', key: 'decorationSize', label: 'Groesse der Durchbrueche', group: 'Gestaltung',
    when: (p) => p.decoration !== 'keine', min: 2, max: 16, step: 0.5, unit: 'mm',
  },
  {
    kind: 'select', key: 'material', label: 'Filament', group: 'Gestaltung',
    options: MATERIALS.filter((m) => !m.flexible).map((m) => ({ value: m.id, label: m.label, help: m.notes })),
  },
  { kind: 'color', key: 'colorBody', label: 'Farbe Koerper', group: 'Gestaltung' },
  { kind: 'color', key: 'colorCap', label: 'Farbe Kappen', group: 'Gestaltung' },
];

const defaults: Params = {
  arms: 3,
  armLength: 26,
  armRadius: 13,
  waist: 8,
  blend: 7,
  thickness: 7.2,
  chamfer: 0.8,
  bearing: '608',
  bearingFit: -0.1,
  caps: true,
  capHeight: 3,
  weightMode: 'lager',
  weightBearing: '608',
  weightMagnet: 'm10x3',
  weightFit: -0.05,
  decoration: 'keine',
  decorationSize: 5,
  material: 'pla',
  colorBody: '#2f6f8f',
  colorCap: '#e8a33d',
};

/** Kappe fuer das mittlere Lager: Teller mit Zapfen, der in den Innenring greift. */
function buildCap(bearingInner: number, bearingOuter: number, height: number, bossDepth: number): Mesh {
  const m = new Mesh();
  const plateR = bearingOuter * 0.42;
  m.add(cylinderMesh(plateR, height, 64, 0));
  // Zapfen mit leichtem Untermass, damit er sich einpressen laesst.
  m.add(cylinderMesh(bearingInner / 2 - 0.1, bossDepth, 48, height - 0.05));
  return m;
}

/** Traegheitsmoment einer Flaeche um die Z-Achse, exakt ueber die Dreiecke. */
function polarMoment(tris: [number, number][][] | number[][][]): number {
  let sum = 0;
  for (const t of tris as number[][][]) {
    const [a, b, c] = t;
    const area =
      ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    // Mittelpunktsregel ueber die Kantenmitten ist fuer quadratische
    // Integranden exakt.
    const mids = [
      [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2],
      [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2],
    ];
    let acc = 0;
    for (const [x, y] of mids) acc += x * x + y * y;
    sum += (area / 3) * acc;
  }
  return sum;
}

function build(p: Params): BuildResult {
  const warnings: string[] = [];
  const arms = Math.max(2, Math.min(6, Math.round(num(p, 'arms', 3))));
  const armLength = num(p, 'armLength', 26);
  const armRadius = num(p, 'armRadius', 13);
  const waist = num(p, 'waist', 8);
  const blend = num(p, 'blend', 7);
  const thickness = num(p, 'thickness', 7.2);
  const chamfer = num(p, 'chamfer', 0.8);
  const bearing = bearingById(str(p, 'bearing', '608'));
  const fit = num(p, 'bearingFit', -0.1);
  const mat = materialById(str(p, 'material', 'pla'));

  // Nabe: gerade so gross, dass um das Lager genug Material bleibt.
  const hubRadius = bearing.outer / 2 + 2.6;

  const shapes: Sdf[] = [sdCircle(0, 0, hubRadius)];
  const armCenters: [number, number][] = [];
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * armLength;
    const y = Math.sin(a) * armLength;
    armCenters.push([x, y]);
    // Die Kapsel von der Mitte nach aussen sorgt dafuer, dass Arm und Nabe
    // wirklich zusammenhaengen - der Mischradius allein wuerde eine Luecke
    // nicht ueberbruecken.
    shapes.push(sdCapsule(0, 0, x, y, waist));
    shapes.push(sdCircle(x, y, armRadius));
  }
  const body = smoothUnion(blend, ...shapes);

  const reach = armLength + armRadius + blend + 4;
  const loops = contour(body, reach, reach, { cell: 0.35, simplify: 0.06, smooth: 2 });
  const regions = loopsToRegions(loops);

  if (regions.length === 0) {
    warnings.push('Aus diesen Werten entsteht kein zusammenhaengender Koerper.');
  }
  if (regions.length > 1) {
    warnings.push('Die Arme haengen nicht mit der Nabe zusammen. Stegbreite oder Hohlkehle erhoehen.');
  }
  const outline = regions[0]?.outline ?? circle(hubRadius, 64);

  // --- Loecher und Taschen ----------------------------------------------
  const through: Poly[] = [circle(bearing.outer / 2 + fit / 2, 96)];
  const pockets: Pocket[] = [];

  const weightMode = str(p, 'weightMode', 'lager');
  const weightFit = num(p, 'weightFit', -0.05);
  let weightMass = 0;
  let weightLabel = '';

  if (weightMode === 'lager') {
    const wb = bearingById(str(p, 'weightBearing', '608'));
    weightMass = wb.mass;
    weightLabel = wb.label;
    const d = wb.outer + weightFit;
    if (wb.width >= thickness - 0.8) {
      for (const [x, y] of armCenters) through.push(movePoly(circle(d / 2, 64), x, y));
    } else {
      for (const [x, y] of armCenters) {
        pockets.push({ poly: movePoly(circle(d / 2, 64), x, y), depth: wb.width + 0.2, from: 'bottom' });
      }
    }
    if (d / 2 > armRadius - 1.5) {
      warnings.push(`Das Armlager (${wb.outer} mm) laesst weniger als 1.5 mm Rand. Armradius auf mindestens ${(d / 2 + 1.5).toFixed(1)} mm erhoehen.`);
    }
  } else if (weightMode === 'muttern') {
    weightMass = M8_NUT.mass;
    weightLabel = 'M8-Sechskantmutter';
    // Umkreisradius aus der Schluesselweite
    const r = (M8_NUT.acrossFlats + weightFit) / Math.sqrt(3);
    for (const [x, y] of armCenters) {
      pockets.push({ poly: movePoly(regularPolygon(6, r, Math.PI / 6), x, y), depth: M8_NUT.height + 0.2, from: 'bottom' });
    }
    if (r > armRadius - 1.5) {
      warnings.push('Die M8-Mutter passt nicht in den Arm. Armradius erhoehen.');
    }
    if (M8_NUT.height + 0.2 > thickness - 1.0) {
      warnings.push(`Der Spinner muss mindestens ${(M8_NUT.height + 1.2).toFixed(1)} mm dick sein, damit die Mutter nicht durchfaellt.`);
    }
  } else if (weightMode === 'magnete') {
    const mg = magnetById(str(p, 'weightMagnet', 'm10x3'));
    weightMass = mg.mass;
    weightLabel = mg.label;
    for (const [x, y] of armCenters) {
      pockets.push({
        poly: movePoly(roundPocketPoly(mg.diameter + weightFit, 48), x, y),
        depth: mg.height + 0.2,
        from: 'bottom',
      });
    }
  }

  const deco = str(p, 'decoration', 'keine');
  const decoSize = num(p, 'decorationSize', 5);
  if (deco === 'ring' || deco === 'beides') {
    const ringR = hubRadius - decoSize / 2 - 1.4;
    const n = Math.max(4, Math.floor((Math.PI * 2 * ringR) / (decoSize + 2)));
    if (ringR > bearing.outer / 2 + decoSize / 2 + 0.8) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        through.push(movePoly(circle(decoSize / 2, 24), Math.cos(a) * ringR, Math.sin(a) * ringR));
      }
    } else {
      warnings.push('Fuer den Lochkranz ist zwischen Lager und Nabenrand zu wenig Platz.');
    }
  }
  if ((deco === 'arme' || deco === 'beides') && weightMode === 'keine') {
    for (const [x, y] of armCenters) through.push(movePoly(circle(decoSize / 2, 32), x, y));
  } else if (deco === 'arme' || deco === 'beides') {
    warnings.push('Die Arme sind bereits mit Gewichten belegt - dort passt kein zusaetzlicher Durchbruch.');
  }

  // --- Koerper -----------------------------------------------------------
  const inset = (() => {
    const f = polygonInsetter(outline, 0.35);
    return (delta: number) => f(delta).find((r) => polyArea(r) > 0) ?? null;
  })();

  const mesh = chamferedPlate(outline, inset, 0, thickness, {
    chamferTop: chamfer,
    chamferBottom: chamfer,
    pockets,
    through,
  });

  // --- Kappen ------------------------------------------------------------
  const wantCaps = bool(p, 'caps', true);
  const capH = num(p, 'capHeight', 3);
  const cap = wantCaps
    ? buildCap(bearing.inner, bearing.outer, capH, Math.max(1, bearing.width / 2 - 0.3))
    : null;

  // --- Physik ------------------------------------------------------------
  const b = polyBounds(outline);
  const volume = mesh.volume();
  const plasticMass = gramFor(volume, mat.density) / 1000; // kg

  // Traegheitsmoment des Kunststoffs: Flaechenmoment mal Dicke mal Dichte.
  const area = polarMoment(triangulateRegion({ outline, holes: through }));
  const density = mat.density * 1e-6; // g/mm3 -> kg/mm3 ist 1e-6 * 1e-3, hier g/mm3
  const inertiaPlastic = area * thickness * density * 1e-3 * 1e-6; // kg*m2
  const inertiaWeights =
    weightMode === 'keine'
      ? 0
      : arms * (weightMass / 1000) * (armLength / 1000) ** 2;
  const inertia = inertiaPlastic + inertiaWeights;
  const totalMass = plasticMass + (weightMode === 'keine' ? 0 : (arms * weightMass) / 1000) + bearing.mass / 1000;

  // Grobe Auslaufzeit: konstantes Bremsmoment eines handelsueblichen
  // Rillenkugellagers, kalibriert auf rund zwei Minuten fuer einen
  // gewoehnlichen 608-Spinner bei 3000 Umdrehungen pro Minute.
  const dragTorque = 6.5e-5;
  const omega0 = (3000 / 60) * Math.PI * 2;
  const spinSeconds = dragTorque > 0 ? (inertia * omega0) / dragTorque : 0;

  if (b.width > 256) warnings.push('Der Spinner ist breiter als 256 mm und passt nicht mehr aufs Bett.');
  if (thickness < bearing.width + 0.6) {
    warnings.push(`Bei ${thickness} mm Dicke steht das ${bearing.width} mm breite Lager ueber. Mindestens ${(bearing.width + 0.6).toFixed(1)} mm waehlen.`);
  }
  if (waist < 4) warnings.push('Ein Steg unter 4 mm bricht leicht. Stegbreite oder Hohlkehle erhoehen.');
  if (armLength - armRadius > hubRadius + 6 && blend < 4) {
    warnings.push('Ohne Hohlkehle entstehen scharfe Innenecken an der Nabe - genau dort reissen Spinner ueblicherweise.');
  }

  const parts = [
    {
      id: 'koerper',
      name: 'Spinner-Koerper',
      mesh,
      copies: 1,
      materialId: mat.id,
      color: str(p, 'colorBody', '#2f6f8f'),
      note: 'Flach drucken, keine Stuetzen. Die Gewichtstaschen zeigen nach unten und werden vom Drucker ueberbrueckt.',
    },
  ];
  if (cap) {
    parts.push({
      id: 'kappe',
      name: 'Lagerkappe',
      mesh: cap,
      copies: 2,
      materialId: mat.id,
      color: str(p, 'colorCap', '#e8a33d'),
      note: 'Zweimal drucken - je eine pro Seite. Mit dem Zapfen nach oben drucken.',
    });
  }

  const bom = [
    { label: `Kugellager ${bearing.label}`, qty: 1, unit: 'Stueck', note: 'Fuer laengeren Auslauf das Fett auswaschen und trocken laufen lassen.' },
  ];
  if (weightMode === 'lager') {
    bom.push({ label: `Kugellager ${weightLabel} als Armgewicht`, qty: arms, unit: 'Stueck', note: 'Werden nur eingepresst, nicht geschmiert.' });
  } else if (weightMode === 'muttern') {
    bom.push({ label: 'M8-Sechskantmutter', qty: arms, unit: 'Stueck', note: 'DIN 934, Schluesselweite 13 mm.' });
  } else if (weightMode === 'magnete') {
    bom.push({ label: `Neodym-Magnete ${weightLabel}`, qty: arms, unit: 'Stueck', note: 'Alle gleich herum einsetzen, sonst ziehen sie sich gegenseitig an.' });
  }

  return {
    parts,
    stats: [
      { label: 'Durchmesser', value: `${b.width.toFixed(0)} x ${b.height.toFixed(0)} mm` },
      { label: 'Gewicht', value: `${(totalMass * 1000).toFixed(0)} g`, hint: `${(plasticMass * 1000).toFixed(0)} g Kunststoff plus Lager und Gewichte` },
      { label: 'Traegheitsmoment', value: `${(inertia * 1e6).toFixed(0)} g cm2`, hint: 'Je hoeher, desto laenger laeuft er - das ist die verlaessliche Kennzahl' },
      { label: 'Auslauf (Schaetzung)', value: `ca. ${Math.round(spinSeconds)} s`, hint: 'Grobe Naeherung bei 3000 U/min. Der Lagerzustand aendert das leicht um den Faktor zwei' },
      { label: 'Arme', value: `${arms}`, hint: 'gleichmaessig verteilt, dadurch von sich aus ausgewuchtet' },
      { label: 'Armgewichte', value: weightMode === 'keine' ? 'keine' : `${arms} x ${weightLabel}` },
    ],
    bom,
    steps: [
      'Koerper und Kappen drucken.',
      `Das ${bearing.label} in die Mitte pressen. Es geht stramm - auf eine ebene Unterlage legen und gleichmaessig mit dem Daumen druecken, notfalls mit einer Schraubzwinge.`,
      ...(weightMode !== 'keine'
        ? [`Die ${arms} Armgewichte in die Taschen pressen. Sitzen sie zu locker, einen Tropfen Sekundenkleber verwenden.`]
        : []),
      wantCaps
        ? 'Die beiden Kappen von je einer Seite in den Innenring des Lagers druecken, bis sie anliegen. Sie duerfen den Aussenring nicht beruehren - sonst bremsen sie.'
        : 'Ohne Kappen den Spinner direkt am Innenring des Lagers halten.',
      'Laeuft er unruhig, sitzt meist ein Armgewicht nicht ganz auf Grund. Alle Taschen noch einmal pruefen.',
    ],
    warnings,
    profile: {
      layerHeight: 0.2,
      wallLoops: 4,
      infill: 40,
      infillPattern: 'Gyroid',
      supports: false,
      brim: false,
      pauses: [],
      notes: [
        'Vier Wandlinien und 40 % Fuellung: die Masse soll moeglichst weit aussen sitzen.',
        'Die Lagersitze nicht mit "Loecher ausgleichen" verkleinern - die Presspassung ist bereits eingerechnet.',
        'Kappen mit 0.12 mm Schichten drucken, dann sitzt der Zapfen genauer.',
        'PLA Silk sieht am Spinner besonders gut aus und ist mechanisch identisch zu normalem PLA.',
      ],
    },
  };
}

export const spinnerModel: FidgetModel = {
  id: 'spinner',
  name: 'Fidget-Spinner',
  tagline: 'Frei gestaltbar, von zwei bis sechs Armen',
  description:
    'Nabe, Arme und Hohlkehlen entstehen aus einer gemeinsamen Formbeschreibung - Armzahl, Laenge, Radius, Stegbreite und Uebergangsradius sind frei waehlbar. Als Gewichte lassen sich Kugellager, M8-Muttern oder Magnete einlegen. Traegheitsmoment und geschaetzte Auslaufzeit werden gleich mitgerechnet.',
  requires: 'ein Kugellager fuer die Mitte, optional Gewichte',
  params,
  defaults,
  presets: [
    {
      id: 'klassisch',
      name: 'Klassischer Dreiarmer',
      description: 'Drei Arme mit 608-Lagern als Gewichte - die Standardbauform.',
      params: { ...defaults },
    },
    {
      id: 'zweiarm',
      name: 'Zweiarmer',
      description: 'Schlanke Form mit zwei Armen, laeuft ruhig und liegt flach in der Hand.',
      params: { ...defaults, arms: 2, armLength: 30, armRadius: 14, waist: 9, blend: 9 },
    },
    {
      id: 'schwer',
      name: 'Langlaeufer',
      description: 'Lange Arme mit Magneten aussen - hohes Traegheitsmoment, laenge Laufzeit.',
      params: { ...defaults, arms: 3, armLength: 34, armRadius: 15, thickness: 8, weightMode: 'magnete', weightMagnet: 'm12x2' },
    },
    {
      id: 'guenstig',
      name: 'Baumarkt-Version',
      description: 'M8-Muttern als Gewichte - kostet fast nichts und funktioniert genauso gut.',
      params: { ...defaults, weightMode: 'muttern', thickness: 8, armRadius: 11, armLength: 24 },
    },
    {
      id: 'filigran',
      name: 'Filigran',
      description: 'Vier Arme mit Lochkranz um die Nabe, ohne Zusatzgewichte.',
      params: { ...defaults, arms: 4, weightMode: 'keine', decoration: 'beides', decorationSize: 6, armRadius: 11, armLength: 27, blend: 9 },
    },
    {
      id: 'sechsarm',
      name: 'Sechsarmer',
      description: 'Blumenform mit sechs kurzen Armen.',
      params: { ...defaults, arms: 6, armLength: 24, armRadius: 9, waist: 6, blend: 6, weightMode: 'muttern' },
    },
  ],
  build,
};
