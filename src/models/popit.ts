/**
 * Pop-It mit Metall-Schnappkuppeln.
 *
 * Aufbau von unten nach oben:
 *   1. Grundplatte aus PLA mit einer Sacktasche pro Kuppel. Die Tasche ist
 *      genau so tief, dass der Scheitel der Kuppel buendig mit der
 *      Plattenoberseite abschliesst.
 *   2. Die Metallkuppel liegt mit ihrem Rand auf dem Taschenboden.
 *   3. Eine TPU-Membran deckt alles ab. Ihre Unterseite beruehrt die
 *      Kuppelscheitel, sodass ein Druck auf die Blase direkt durchschlaegt.
 *   4. Eine umlaufende Schnapplippe an der Grundplatte haelt die Membran.
 *
 * Alternativ ohne Kaufteile: im Modus "gedruckt" bekommt die Membran
 * bistabile Hohlkuppeln, die von selbst durchschnappen.
 */

import { extrudeRegion } from '../geo/extrude.ts';
import { domeCap, domeCapInnerBaseRadius, solidDome } from '../geo/revolve.ts';
import { circle, polyBounds, type Poly } from '../geo/shapes2d.ts';
import { METAL_DOMES, SOURCES, domeById, materialById } from '../catalog/parts.ts';
import { PACK_PATTERNS, packCircles, type PackPattern } from '../pack/packing.ts';
import { crossPocketPoly, plateWithPockets, ringWall, roundPocketPoly } from './build.ts';
import { SHAPE_OPTIONS, buildOutline, keyringHole, outlineInsetter } from './shapes.ts';
import {
  bool,
  gramFor,
  num,
  str,
  type BuildResult,
  type FidgetModel,
  type Params,
  type ParamDef,
} from './types.ts';

const BED = 256;

function movePoly(poly: Poly, dx: number, dy: number): Poly {
  return poly.map(([x, y]) => [x + dx, y + dy] as [number, number]);
}

const params: ParamDef[] = [
  {
    kind: 'select', key: 'shape', label: 'Form', group: 'Form', options: SHAPE_OPTIONS,
    help: 'Der Umriss bestimmt, wie viele Blasen hineinpassen. Runde und sechseckige Formen nutzen die Flaeche am besten aus.',
  },
  { kind: 'number', key: 'width', label: 'Breite', group: 'Form', min: 40, max: 250, step: 1, unit: 'mm' },
  { kind: 'number', key: 'height', label: 'Hoehe', group: 'Form', min: 40, max: 250, step: 1, unit: 'mm' },

  {
    kind: 'select', key: 'mechanik', label: 'Klick-Mechanik', group: 'Blasen',
    options: [
      { value: 'metall', label: 'Metall-Schnappkuppeln', help: 'Echter, lauter Klick. Braucht die gekauften Kuppeln.' },
      { value: 'gedruckt', label: 'Gedruckte Hohlkuppeln', help: 'Ganz ohne Kaufteile: bistabile TPU-Kuppeln, die durchschnappen. Leiser und weicher.' },
    ],
  },
  {
    kind: 'select', key: 'domeSize', label: 'Kuppelgroesse', group: 'Blasen',
    when: (p) => p.mechanik === 'metall',
    options: METAL_DOMES.map((d) => ({
      value: d.id,
      label: `${d.diameter} mm`,
      help: `${d.force} g Schaltkraft, ${d.height} mm hoch`,
    })),
    help: 'Kleine Kuppeln ergeben mehr Blasen, grosse einen satteren Klick.',
  },
  {
    kind: 'select', key: 'pocketType', label: 'Taschenform', group: 'Blasen',
    when: (p) => p.mechanik === 'metall',
    options: [
      { value: 'kreuz', label: 'Kreuz (4 Beine)', help: 'Fuer den Kreuzkuppel-Typ: vier Nasen geben den Beinen Platz.' },
      { value: 'rund', label: 'Rund', help: 'Fuer Kuppeln ohne ueberstehende Beine.' },
    ],
  },
  {
    kind: 'number', key: 'bubbleDiameter', label: 'Blasendurchmesser', group: 'Blasen',
    when: (p) => p.mechanik === 'gedruckt', min: 8, max: 30, step: 0.5, unit: 'mm',
  },
  {
    kind: 'select', key: 'pattern', label: 'Anordnung', group: 'Blasen',
    options: PACK_PATTERNS.map((p) => ({ value: p.id, label: p.label, help: p.description })),
  },
  {
    kind: 'number', key: 'gapWall', label: 'Steg zwischen den Blasen', group: 'Blasen',
    min: 1, max: 8, step: 0.1, unit: 'mm',
    help: 'Weniger Steg heisst mehr Blasen. Unter 1.5 mm wird die Platte zwischen den Taschen fragil.',
  },
  {
    kind: 'number', key: 'maxDomes', label: 'Obergrenze Blasen', group: 'Blasen',
    min: 0, max: 600, step: 1,
    help: '0 heisst: so viele wie hineinpassen. Sonst fallen die aeussersten Blasen zuerst weg.',
  },
  {
    kind: 'number', key: 'bubbleHeight', label: 'Blasenhoehe', group: 'Blasen',
    min: 0.8, max: 8, step: 0.1, unit: 'mm',
  },

  {
    kind: 'number', key: 'floorThickness', label: 'Bodenstaerke', group: 'Aufbau',
    min: 0.8, max: 5, step: 0.1, unit: 'mm',
    help: 'Material unter dem Taschenboden. 1.2 mm reichen, damit sich die Platte nicht durchbiegt.',
  },
  {
    kind: 'number', key: 'domeClearance', label: 'Spiel in der Tasche', group: 'Aufbau',
    when: (p) => p.mechanik === 'metall', min: 0.05, max: 0.6, step: 0.05, unit: 'mm',
    help: 'Seitliches Spiel der Kuppel. 0.2 mm passen fuer die meisten Drucker.',
  },
  {
    kind: 'number', key: 'seatGap', label: 'Vorspannung', group: 'Aufbau',
    when: (p) => p.mechanik === 'metall', min: -0.2, max: 0.8, step: 0.05, unit: 'mm',
    help: 'Wie weit der Kuppelscheitel unter der Plattenoberseite liegt. 0 heisst buendig. Negative Werte spannen die Membran gegen die Kuppel vor - der Klick kommt frueher.',
  },
  {
    kind: 'number', key: 'membraneThickness', label: 'Membranstaerke', group: 'Aufbau',
    min: 0.4, max: 2.5, step: 0.1, unit: 'mm',
  },
  {
    kind: 'number', key: 'printedWall', label: 'Wandstaerke der Hohlkuppel', group: 'Aufbau',
    when: (p) => p.mechanik === 'gedruckt', min: 0.4, max: 1.6, step: 0.05, unit: 'mm',
    help: 'Duenner schnappt leichter, dicker haelt laenger. 0.8 mm sind ein guter Start.',
  },
  {
    kind: 'number', key: 'rimWall', label: 'Rahmenbreite', group: 'Aufbau',
    min: 1.2, max: 8, step: 0.1, unit: 'mm',
  },
  {
    kind: 'number', key: 'lipOverhang', label: 'Ueberstand der Schnapplippe', group: 'Aufbau',
    min: 0, max: 2.5, step: 0.1, unit: 'mm',
    help: '0 laesst die Lippe weg - die Membran wird dann geklebt. Ueber 1.2 mm wird der Ueberhang beim Drucken haesslich.',
  },
  {
    kind: 'number', key: 'fitClearance', label: 'Passungsspiel', group: 'Aufbau',
    min: 0.05, max: 0.6, step: 0.05, unit: 'mm',
    help: 'Luft zwischen Membranrand und Rahmen.',
  },

  { kind: 'boolean', key: 'keyring', label: 'Loch fuer Schluesselring', group: 'Extras' },
  {
    kind: 'number', key: 'keyringDiameter', label: 'Lochdurchmesser', group: 'Extras',
    when: (p) => p.keyring === true, min: 2, max: 10, step: 0.5, unit: 'mm',
  },
  { kind: 'color', key: 'colorBase', label: 'Farbe Grundplatte', group: 'Extras' },
  { kind: 'color', key: 'colorMembrane', label: 'Farbe Membran', group: 'Extras' },
];

const defaults: Params = {
  shape: 'squircle',
  width: 120,
  height: 90,
  mechanik: 'metall',
  domeSize: 'd84',
  pocketType: 'kreuz',
  bubbleDiameter: 14,
  pattern: 'hex',
  gapWall: 1.8,
  maxDomes: 0,
  bubbleHeight: 2.4,
  floorThickness: 1.2,
  domeClearance: 0.2,
  seatGap: 0,
  membraneThickness: 0.9,
  printedWall: 0.8,
  rimWall: 2.4,
  lipOverhang: 0.9,
  fitClearance: 0.2,
  keyring: false,
  keyringDiameter: 5,
  colorBase: '#2f6f8f',
  colorMembrane: '#e8735a',
};

function build(p: Params): BuildResult {
  const warnings: string[] = [];
  const shape = str(p, 'shape', 'squircle');
  const width = num(p, 'width', 120);
  const height = num(p, 'height', 90);
  const outline = buildOutline(shape, width, height);

  const metal = str(p, 'mechanik', 'metall') === 'metall';
  const dome = domeById(str(p, 'domeSize', 'd84'));
  const clearance = num(p, 'domeClearance', 0.2);
  const cross = str(p, 'pocketType', 'kreuz') === 'kreuz';
  const gapWall = num(p, 'gapWall', 1.8);
  const rimWall = num(p, 'rimWall', 2.4);
  const membraneT = num(p, 'membraneThickness', 0.9);
  const floorT = num(p, 'floorThickness', 1.2);
  const bubbleH = num(p, 'bubbleHeight', 2.4);
  const lipOverhang = num(p, 'lipOverhang', 0.9);
  const fit = num(p, 'fitClearance', 0.2);

  // Zellradius: so viel Platz braucht eine Blase inklusive Kuppelbeinen.
  const legWidth = Math.max(1.2, dome.diameter * 0.28);
  const pocketD = dome.diameter + 2 * clearance;
  const cellR = metal
    ? pocketD / 2 + (cross ? dome.legOverhang : 0)
    : num(p, 'bubbleDiameter', 14) / 2;
  const pitch = 2 * cellR + gapWall;
  const pocketDepth = dome.height + num(p, 'seatGap', 0);

  const keyring = bool(p, 'keyring', false);
  const keyringD = num(p, 'keyringDiameter', 5);
  const ringHole = keyring ? keyringHole(outline, keyringD, rimWall + keyringD) : null;
  const throughHoles: Poly[] = ringHole ? [ringHole.hole] : [];

  // Blasen duerfen den Rahmen und das Schluesselloch nicht beruehren.
  const edgeClearance = cellR + rimWall + 1.0;
  const packRegion = {
    outline,
    // Um das Schluesselloch bleibt ein Sperrkreis frei, damit dort keine
    // Blase halb ueber dem Loch landet.
    holes: ringHole
      ? [circle(keyringD / 2 + cellR + 1.5, 32, ringHole.center[0], ringHole.center[1])]
      : [],
  };
  const maxDomes = num(p, 'maxDomes', 0);
  const pack = packCircles(packRegion, {
    pitch,
    edgeClearance,
    pattern: str(p, 'pattern', 'hex') as PackPattern,
    maxCount: maxDomes > 0 ? maxDomes : undefined,
  });
  const count = pack.points.length;

  // --- Grundplatte -------------------------------------------------------
  const plateH = metal ? floorT + pocketDepth : floorT;
  const pocketPoly = metal
    ? cross
      ? crossPocketPoly(pocketD, dome.legOverhang, legWidth)
      : roundPocketPoly(pocketD)
    : circle(cellR, 40);

  const base = metal
    ? plateWithPockets(
        outline, 0, plateH,
        pack.points.map(([x, y]) => ({ poly: movePoly(pocketPoly, x, y), depth: pocketDepth, from: 'top' as const })),
        throughHoles,
      )
    : plateWithPockets(
        outline, 0, plateH, [],
        [...throughHoles, ...pack.points.map(([x, y]) => movePoly(pocketPoly, x, y))],
      );

  // Rahmen, Schnapplippe und Membranrand entstehen aus demselben Umriss -
  // ein gemeinsames Abstandsfeld reicht fuer alle drei.
  const inset = outlineInsetter(outline);
  const innerOpen = inset(rimWall);
  const lipOpen = lipOverhang > 0.05 ? inset(rimWall + lipOverhang) : null;
  if (!innerOpen) {
    warnings.push('Der Rahmen ist so breit, dass keine Oeffnung fuer die Membran uebrig bleibt.');
  } else {
    base.add(ringWall(outline, innerOpen, plateH - 0.05, plateH + membraneT));
    if (lipOpen) {
      base.add(ringWall(outline, lipOpen, plateH + membraneT - 0.05, plateH + membraneT + 0.8));
    }
  }

  // --- Membran -----------------------------------------------------------
  const membOutline = inset(rimWall + fit) ?? outline;
  const bubbleR = Math.max(1.5, cellR - 0.3);
  const printedWall = num(p, 'printedWall', 0.8);
  const membHoles: Poly[] = [];
  if (ringHole) membHoles.push(ringHole.hole);
  if (!metal) {
    const innerR = domeCapInnerBaseRadius(bubbleR, bubbleH, printedWall);
    for (const [x, y] of pack.points) membHoles.push(movePoly(circle(innerR, 40), x, y));
  }

  const membrane = extrudeRegion({ outline: membOutline, holes: membHoles }, 0, membraneT);
  const bubbleSegments = Math.max(20, Math.min(48, Math.round(bubbleR * 5)));
  for (const [x, y] of pack.points) {
    const bump = metal
      ? solidDome(bubbleR, bubbleH, bubbleSegments, 12)
      : domeCap(bubbleR, bubbleH, printedWall, bubbleSegments, 14);
    membrane.add(bump.translate(x, y, membraneT - 0.05));
  }

  // --- Zahlen ------------------------------------------------------------
  const pla = materialById('pla');
  const tpu = materialById('tpu95');
  const baseGram = gramFor(base.volume(), pla.density);
  const membGram = gramFor(membrane.volume(), tpu.density);
  const b = polyBounds(outline);
  const totalH = plateH + membraneT + bubbleH;

  const packs = Math.ceil(count / SOURCES.domes.quantity);
  const domeCost = metal ? packs * SOURCES.domes.price : 0;
  const filamentCost = ((baseGram / 1000) * pla.pricePerKg) + ((membGram / 1000) * tpu.pricePerKg);

  if (b.width > BED || b.height > BED) {
    warnings.push(
      `Die Platte ist ${b.width.toFixed(0)} x ${b.height.toFixed(0)} mm und passt damit nicht auf ein 256-mm-Bett. Verkleinere sie oder teile sie in zwei Haelften.`,
    );
  }
  if (metal && count > SOURCES.domes.quantity) {
    warnings.push(
      `Fuer ${count} Blasen brauchst du ${packs} Packungen Kuppeln (je ${SOURCES.domes.quantity} Stueck).`,
    );
  }
  if (gapWall < 1.5) {
    warnings.push('Der Steg zwischen den Taschen ist unter 1.5 mm - die Platte wird dort sehr duenn und kann brechen.');
  }
  if (metal && pocketDepth < 0.3) {
    warnings.push('Die Tasche ist flacher als 0.3 mm. Sie laesst sich mit 0.2-mm-Schichten kaum sauber drucken.');
  }
  if (lipOverhang > 1.2) {
    warnings.push('Ein Lippenueberstand ueber 1.2 mm haengt beim Drucken durch. 0.8 bis 1.0 mm halten genauso gut.');
  }
  if ((shape === 'stern' || shape === 'blume') && rimWall > 3) {
    warnings.push('Bei Stern- und Blumenformen kann ein breiter Rahmen die spitzen Ecken zulaufen lassen. Pruefe die Vorschau.');
  }
  if (count === 0) {
    warnings.push('Es passt keine einzige Blase hinein. Mach die Platte groesser oder die Kuppeln kleiner.');
  }

  return {
    parts: [
      {
        id: 'basis',
        name: 'Grundplatte',
        mesh: base,
        copies: 1,
        materialId: 'pla',
        color: str(p, 'colorBase', '#2f6f8f'),
        note: metal
          ? 'Steif drucken. Die Taschen zeigen nach oben und brauchen keine Stuetzen.'
          : 'Rahmen mit Durchbruechen - gibt der weichen Membran Halt.',
      },
      {
        id: 'membran',
        name: 'Membran',
        mesh: membrane,
        copies: 1,
        materialId: 'tpu95',
        color: str(p, 'colorMembrane', '#e8735a'),
        note: 'Flach mit den Blasen nach oben drucken. Langsam, ohne Stuetzen.',
      },
    ],
    stats: [
      { label: 'Blasen', value: String(count), hint: `Muster: ${pack.pattern}, ${pack.tried} Gitterlagen geprueft` },
      { label: 'Rastermass', value: `${pitch.toFixed(1)} mm`, hint: `Zelle ${(cellR * 2).toFixed(1)} mm + ${gapWall} mm Steg` },
      { label: 'Flaechennutzung', value: `${(pack.density * 100).toFixed(0)} %`, hint: 'Wabenmuster erreicht hoechstens 90.7 %' },
      { label: 'Abmessung', value: `${b.width.toFixed(0)} x ${b.height.toFixed(0)} x ${totalH.toFixed(1)} mm` },
      metal
        ? { label: 'Klickkraft', value: `${dome.force} g pro Blase`, hint: `Kuppel ${dome.diameter} mm, ${dome.travel} mm Schaltweg` }
        : { label: 'Kuppelwand', value: `${printedWall.toFixed(2)} mm`, hint: 'Duenner = leichteres Durchschnappen' },
      { label: 'Filament', value: `${(baseGram + membGram).toFixed(0)} g`, hint: `${baseGram.toFixed(0)} g PLA + ${membGram.toFixed(0)} g TPU, massiv gerechnet` },
      { label: 'Materialkosten', value: `ca. ${(domeCost + filamentCost).toFixed(2)} CHF` },
    ],
    bom: metal
      ? [
          {
            label: `Metall-Schnappkuppeln ${dome.diameter} mm${cross ? ' (Kreuztyp)' : ''}`,
            qty: count,
            unit: 'Stueck',
            note: `entspricht ${packs} Packung${packs > 1 ? 'en' : ''} a ${SOURCES.domes.quantity} Stueck`,
            url: SOURCES.domes.url,
            cost: domeCost,
          },
        ]
      : [],
    steps: metal
      ? [
          'Grundplatte und Membran drucken.',
          `Alle ${count} Kuppeln mit der Woelbung nach oben in die Taschen legen. Eine Pinzette hilft; die Beine rasten in den vier Nasen ein.`,
          'Pruefen, dass keine Kuppel schief liegt - sie muss von selbst flach im Boden sitzen.',
          'Die Membran mit den Blasen nach oben auflegen und unter die Schnapplippe druecken. In einer Ecke anfangen und rundherum arbeiten.',
          'Durchklicken. Klingt eine Blase dumpf, sitzt die Kuppel darunter verkantet.',
        ]
      : [
          'Rahmen und Membran drucken.',
          'Die Membran von oben in den Rahmen legen und unter die Schnapplippe druecken.',
          'Jede Kuppel einmal kraeftig durchdruecken - danach schnappt sie leichtgaengig hin und her.',
        ],
    warnings,
    profile: {
      layerHeight: 0.2,
      wallLoops: 3,
      infill: 20,
      infillPattern: 'Gyroid',
      supports: false,
      brim: true,
      pauses: [],
      notes: [
        'Grundplatte in PLA: 0.2 mm Schichten, 3 Wandlinien, 20 % Fuellung.',
        'Membran in TPU 95A: 0.2 mm Schichten, 100 % Fuellung, 20-25 mm/s, Luefter an.',
        'Beides ohne Stuetzen - alle Ueberhaenge sind kurze Bruecken.',
        'Brim hilft der TPU-Membran, sich an den Raendern nicht zu loesen.',
      ],
    },
  };
}

export const popitModel: FidgetModel = {
  id: 'popit',
  name: 'Pop-It',
  tagline: 'Blasen zum Durchdruecken - mit echtem Metall-Klick',
  description:
    'Eine Grundplatte mit einer Tasche pro Metall-Schnappkuppel und eine weiche TPU-Membran darueber. Der Generator rechnet aus, wie viele Kuppeln in deinen Umriss passen, und legt sie in der dichtesten Packung aus. Wer keine Kuppeln kaufen mag, waehlt gedruckte Hohlkuppeln - die schnappen ganz ohne Kaufteile.',
  requires: 'Metall-Schnappkuppeln (optional), PLA und TPU',
  params,
  defaults,
  presets: [
    {
      id: 'klassisch',
      name: 'Klassisch gross',
      description: '120 x 90 mm mit 8.4-mm-Kuppeln im Wabenmuster - viele Blasen, satter Klick.',
      params: { ...defaults },
    },
    {
      id: 'maximum',
      name: 'Maximale Blasenzahl',
      description: 'Kleinste Kuppeln und knapper Steg. Holt die hoechstmoegliche Zahl aus der Flaeche heraus.',
      params: { ...defaults, domeSize: 'd5', gapWall: 1.5, bubbleHeight: 1.6, width: 140, height: 100 },
    },
    {
      id: 'schluesselanhaenger',
      name: 'Schluesselanhaenger',
      description: 'Klein, rund und mit Loch - passt an den Rucksack.',
      params: { ...defaults, shape: 'kreis', width: 55, height: 55, domeSize: 'd6', keyring: true, gapWall: 1.6 },
    },
    {
      id: 'herz',
      name: 'Herz zum Verschenken',
      description: 'Herzform mit 10-mm-Kuppeln und hohen Blasen.',
      params: { ...defaults, shape: 'herz', width: 110, height: 100, domeSize: 'd10', bubbleHeight: 3.2, pattern: 'hex' },
    },
    {
      id: 'ohne-kaufteile',
      name: 'Ohne Kaufteile',
      description: 'Gedruckte Hohlkuppeln in TPU - sofort druckbar, nichts zu bestellen.',
      params: { ...defaults, mechanik: 'gedruckt', bubbleDiameter: 15, bubbleHeight: 3.5, printedWall: 0.8, gapWall: 2.2 },
    },
  ],
  build,
};
