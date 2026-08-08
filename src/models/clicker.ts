/**
 * Clicker mit mechanischen Tastaturschaltern.
 *
 * Aufbau:
 *   1. Gehaeusewanne aus PLA. Innen ist Platz fuer die Schalterunterteile
 *      und die Pins; oben liegt eine umlaufende Auflageschulter.
 *   2. Halteplatte, exakt so dick, dass die Rasthaken des Schalters
 *      einschnappen (MX-Standard: 1.5 mm bei 14 x 14 mm Ausschnitt).
 *   3. Optional gedruckte Tastenkappen mit Kreuzaufnahme.
 *
 * Die Schalter werden nur eingerastet, nicht verloetet - drei Pins heisst
 * hier schlicht: keine seitlichen Fuehrungszapfen, der Ausschnitt bleibt
 * ein sauberes Quadrat.
 */

import { extrudeRegion } from '../geo/extrude.ts';
import { Mesh } from '../geo/mesh.ts';
import { polyBounds, roundedRect, scalePoly, type Poly } from '../geo/shapes2d.ts';
import { MX_STEM, SOURCES, SWITCHES, materialById, switchById } from '../catalog/parts.ts';
import { mxCrossPoly, plateWithPockets, ringWall, shellBox, squareHolePoly } from './build.ts';
import { keyringHole, outlineInsetter } from './shapes.ts';
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

function movePoly(poly: Poly, dx: number, dy: number): Poly {
  return poly.map(([x, y]) => [x + dx, y + dy] as [number, number]);
}

/** Mittelpunkte eines Schalterfelds, zentriert um den Ursprung. */
function switchGrid(cols: number, rows: number, spacing: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push([(c - (cols - 1) / 2) * spacing, (r - (rows - 1) / 2) * spacing]);
    }
  }
  return pts;
}

const params: ParamDef[] = [
  {
    kind: 'select', key: 'switchType', label: 'Schaltertyp', group: 'Schalter',
    options: SWITCHES.map((s) => ({ value: s.id, label: s.label, help: s.description })),
  },
  { kind: 'number', key: 'cols', label: 'Schalter nebeneinander', group: 'Schalter', min: 1, max: 8, step: 1 },
  { kind: 'number', key: 'rows', label: 'Schalter uebereinander', group: 'Schalter', min: 1, max: 8, step: 1 },
  {
    kind: 'number', key: 'spacing', label: 'Rastermass', group: 'Schalter',
    min: 16, max: 26, step: 0.05, unit: 'mm',
    help: '19.05 mm ist das Tastaturmass. Enger geht nur, solange sich die Tastenkappen nicht beruehren.',
  },
  {
    kind: 'number', key: 'plateHole', label: 'Ausschnittmass', group: 'Schalter',
    min: 13.4, max: 14.6, step: 0.05, unit: 'mm',
    help: 'Klemmt der Schalter, 0.1 mm groesser waehlen. Faellt er heraus, 0.1 mm kleiner.',
  },
  {
    kind: 'number', key: 'plateThickness', label: 'Plattenstaerke', group: 'Schalter',
    min: 1.2, max: 2.0, step: 0.05, unit: 'mm',
    help: 'Die Rasthaken greifen bei 1.5 mm. Abweichungen ueber 0.2 mm halten nicht mehr sicher.',
  },

  {
    kind: 'number', key: 'margin', label: 'Rand um das Schalterfeld', group: 'Gehaeuse',
    min: 3, max: 25, step: 0.5, unit: 'mm',
  },
  {
    kind: 'number', key: 'cornerRadius', label: 'Eckenradius', group: 'Gehaeuse',
    min: 0, max: 20, step: 0.5, unit: 'mm',
  },
  {
    kind: 'number', key: 'wallThickness', label: 'Wandstaerke', group: 'Gehaeuse',
    min: 1.2, max: 5, step: 0.1, unit: 'mm',
  },
  {
    kind: 'number', key: 'extraDepth', label: 'Zusaetzliche Bautiefe', group: 'Gehaeuse',
    min: 0, max: 20, step: 0.5, unit: 'mm',
    help: 'Zusaetzlicher Hohlraum unter den Schaltern - macht den Klang voller und gibt Platz fuer Kabel.',
  },
  {
    kind: 'number', key: 'fitClearance', label: 'Passungsspiel Platte', group: 'Gehaeuse',
    min: 0.05, max: 0.5, step: 0.05, unit: 'mm',
  },
  { kind: 'boolean', key: 'keyring', label: 'Loch fuer Schluesselring', group: 'Gehaeuse' },

  { kind: 'boolean', key: 'keycaps', label: 'Tastenkappen mitdrucken', group: 'Tastenkappen' },
  {
    kind: 'number', key: 'capHeight', label: 'Kappenhoehe', group: 'Tastenkappen',
    when: (p) => p.keycaps === true, min: 4, max: 14, step: 0.5, unit: 'mm',
  },
  {
    kind: 'number', key: 'capTaper', label: 'Verjuengung', group: 'Tastenkappen',
    when: (p) => p.keycaps === true, min: 0, max: 4, step: 0.1, unit: 'mm',
    help: 'Wie stark sich die Kappe nach oben verjuengt.',
  },
  {
    kind: 'number', key: 'stemClearance', label: 'Spiel der Kreuzaufnahme', group: 'Tastenkappen',
    when: (p) => p.keycaps === true, min: 0, max: 0.4, step: 0.05, unit: 'mm',
    help: 'Sitzt die Kappe zu stramm, hier 0.05 mm zugeben. Die Kreuzaufnahme ist die empfindlichste Passung am ganzen Teil.',
  },

  { kind: 'color', key: 'colorBody', label: 'Farbe Gehaeuse', group: 'Extras' },
  { kind: 'color', key: 'colorPlate', label: 'Farbe Platte', group: 'Extras' },
  { kind: 'color', key: 'colorCap', label: 'Farbe Tastenkappen', group: 'Extras' },
];

const defaults: Params = {
  switchType: 'mx3',
  cols: 2,
  rows: 1,
  spacing: 19.05,
  plateHole: 14.0,
  plateThickness: 1.5,
  margin: 6,
  cornerRadius: 4,
  wallThickness: 2.0,
  extraDepth: 2,
  fitClearance: 0.2,
  keyring: false,
  keycaps: true,
  capHeight: 8,
  capTaper: 1.6,
  stemClearance: 0.1,
  colorBody: '#3a3f4b',
  colorPlate: '#8d99ae',
  colorCap: '#2f6f8f',
};

/** Tastenkappe: Hohlschale mit Kreuzaufnahme im Inneren. */
function buildKeycap(
  size: number,
  height: number,
  taper: number,
  wall: number,
  stemClearance: number,
): Mesh {
  const sizeTop = Math.max(6, size - 2 * taper);
  const outerBottom = roundedRect(size, size, 1.2, 6);
  const outerTop = scalePoly(outerBottom, sizeTop / size);
  const innerBottom = scalePoly(outerBottom, (size - 2 * wall) / size);
  const innerTop = scalePoly(outerTop, (sizeTop - 2 * wall) / sizeTop);
  const ceiling = wall;

  // Nach unten offene Hohlschale: Aussenhaut, Decke, Hohlraum und Randring
  // in einem geschlossenen Koerper.
  const m = shellBox(outerBottom, outerTop, innerBottom, innerTop, height, ceiling);

  // Zapfenaufnahme: Zylinderstumpf mit Kreuzloch, sitzt an der Decke.
  const stemOuter = roundedRect(5.6, 5.6, 2.6, 10);
  const cross = mxCrossPoly(MX_STEM.armLength + stemClearance, MX_STEM.armWidth + stemClearance);
  const stemTop = height - ceiling + 0.05;
  const stemBottom = Math.max(0.6, stemTop - MX_STEM.depth);
  m.add(plateWithPockets(stemOuter, stemBottom, stemTop, [], [cross]));

  return m;
}

function build(p: Params): BuildResult {
  const warnings: string[] = [];
  const spec = switchById(str(p, 'switchType', 'mx3'));
  const cols = Math.max(1, Math.round(num(p, 'cols', 2)));
  const rows = Math.max(1, Math.round(num(p, 'rows', 1)));
  const spacing = num(p, 'spacing', spec.spacing);
  const holeSize = num(p, 'plateHole', spec.plateHole);
  const plateT = num(p, 'plateThickness', spec.plateThickness);
  const margin = num(p, 'margin', 6);
  const wall = num(p, 'wallThickness', 2);
  const extra = num(p, 'extraDepth', 2);
  const fit = num(p, 'fitClearance', 0.2);
  const corner = num(p, 'cornerRadius', 4);

  const centers = switchGrid(cols, rows, spacing);
  const fieldW = (cols - 1) * spacing + spec.topHousing;
  const fieldH = (rows - 1) * spacing + spec.topHousing;
  const plateW = fieldW + 2 * margin;
  const plateH = fieldH + 2 * margin;

  const plateOutline = roundedRect(plateW, plateH, corner, 10);
  const bodyOutline = roundedRect(plateW + 2 * wall + 2 * fit, plateH + 2 * wall + 2 * fit, corner + wall, 10);

  const keyring = bool(p, 'keyring', false);
  const ring = keyring ? keyringHole(bodyOutline, 5, wall + 6) : null;

  // --- Halteplatte -------------------------------------------------------
  const holes = centers.map(([x, y]) => movePoly(squareHolePoly(holeSize, 0.4), x, y));
  const plate = plateWithPockets(plateOutline, 0, plateT, [], holes);

  // --- Gehaeusewanne -----------------------------------------------------
  // Innen zwei Stufen: unten der Hohlraum, oben die Schulter, auf der die
  // Platte buendig aufliegt.
  const cavityDepth = spec.belowPlate + extra;
  const floorT = 1.6;
  const bodyHeight = floorT + cavityDepth + plateT;
  const inset = outlineInsetter(bodyOutline);
  const shoulderOpening = inset(wall + fit) ?? plateOutline;
  const cavityOpening = inset(wall + fit + 1.6) ?? plateOutline;

  const body = new Mesh();
  body.add(extrudeRegion({ outline: bodyOutline, holes: ring ? [ring.hole] : [] }, 0, floorT));
  body.add(ringWall(bodyOutline, cavityOpening, floorT - 0.05, floorT + cavityDepth));
  body.add(ringWall(bodyOutline, shoulderOpening, floorT + cavityDepth - 0.05, bodyHeight));

  // --- Tastenkappen ------------------------------------------------------
  const wantCaps = bool(p, 'keycaps', true);
  const capSize = Math.min(18.2, spacing - 0.85);
  const cap = wantCaps
    ? buildKeycap(capSize, num(p, 'capHeight', 8), num(p, 'capTaper', 1.6), 1.4, num(p, 'stemClearance', 0.1))
    : null;

  // --- Zahlen ------------------------------------------------------------
  const pla = materialById('pla');
  const count = cols * rows;
  const bodyGram = gramFor(body.volume(), pla.density);
  const plateGram = gramFor(plate.volume(), pla.density);
  const capGram = cap ? gramFor(cap.volume(), pla.density) * count : 0;
  const b = polyBounds(bodyOutline);
  const switchCost = (count / SOURCES.switches.quantity) * SOURCES.switches.price;

  if (Math.abs(plateT - spec.plateThickness) > 0.2) {
    warnings.push(
      `Die Platte weicht mehr als 0.2 mm von den ${spec.plateThickness} mm ab, fuer die die Rasthaken gemacht sind. Der Schalter haelt dann nur noch durch Klemmung.`,
    );
  }
  if (spacing < spec.topHousing + 0.5) {
    warnings.push(
      `Bei ${spacing} mm Rastermass beruehren sich die Schaltergehaeuse (${spec.topHousing} mm breit). Mindestens ${(spec.topHousing + 0.5).toFixed(2)} mm waehlen.`,
    );
  }
  if (wantCaps && capSize > spacing - 0.6) {
    warnings.push('Die Tastenkappen stossen aneinander. Rastermass vergroessern oder Kappen schmaler machen.');
  }
  if (holeSize > 14.3) {
    warnings.push('Ein Ausschnitt ueber 14.3 mm ist zu gross - der Schalter rastet nicht mehr ein und faellt durch.');
  }

  const parts = [
    {
      id: 'gehaeuse',
      name: 'Gehaeuse',
      mesh: body,
      copies: 1,
      materialId: 'pla',
      color: str(p, 'colorBody', '#3a3f4b'),
      note: 'Offene Seite nach oben drucken. Keine Stuetzen noetig.',
    },
    {
      id: 'platte',
      name: 'Halteplatte',
      mesh: plate,
      copies: 1,
      materialId: 'pla',
      color: str(p, 'colorPlate', '#8d99ae'),
      note: `Flach drucken. Die ${plateT} mm sind das Mass, an dem die Rasthaken greifen - hier nicht skalieren.`,
    },
  ];
  if (cap) {
    parts.push({
      id: 'tastenkappe',
      name: 'Tastenkappe',
      mesh: cap,
      copies: count,
      materialId: 'pla',
      color: str(p, 'colorCap', '#2f6f8f'),
      note: 'Mit der Oeffnung nach unten drucken, dann braucht die Kreuzaufnahme keine Stuetzen.',
    });
  }

  return {
    parts,
    stats: [
      { label: 'Schalter', value: `${count}`, hint: `${cols} x ${rows} im ${spacing}-mm-Raster` },
      { label: 'Abmessung', value: `${b.width.toFixed(0)} x ${b.height.toFixed(0)} x ${(bodyHeight + (cap ? num(p, 'capHeight', 8) : 0)).toFixed(1)} mm` },
      { label: 'Bauhoehe innen', value: `${cavityDepth.toFixed(1)} mm`, hint: `${spec.belowPlate} mm Schalter + ${extra} mm Zugabe` },
      { label: 'Filament', value: `${(bodyGram + plateGram + capGram).toFixed(0)} g`, hint: 'massiv gerechnet' },
      { label: 'Schalterkosten', value: `ca. ${switchCost.toFixed(2)} CHF`, hint: `${SOURCES.switches.price} CHF fuer ${SOURCES.switches.quantity} Stueck` },
    ],
    bom: [
      {
        label: `${spec.label}`,
        qty: count,
        unit: 'Stueck',
        url: SOURCES.switches.url,
        cost: switchCost,
        note: 'Blaue Clicky-Schalter klicken am lautesten. Braun ist leiser mit spuerbarem Druckpunkt.',
      },
    ],
    steps: [
      'Gehaeuse, Halteplatte und Tastenkappen drucken.',
      `Die ${count} Schalter von oben in die Ausschnitte der Platte druecken, bis die Rasthaken hoerbar einrasten. Die Pins zeigen nach unten.`,
      'Sitzt ein Schalter schief, wieder herausdruecken (Rasthaken mit einem kleinen Schraubendreher zusammendruecken) und neu ansetzen.',
      'Die bestueckte Platte von oben in das Gehaeuse legen - sie liegt auf der umlaufenden Schulter auf.',
      'Tastenkappen aufstecken. Sie gehen stramm; senkrecht und mit gleichmaessigem Druck aufsetzen.',
      'Die Platte haelt durch Klemmung. Wer sie dauerhaft fixieren will, gibt einen Tropfen Sekundenkleber in die Ecken der Schulter.',
    ],
    warnings,
    profile: {
      layerHeight: 0.2,
      wallLoops: 3,
      infill: 20,
      infillPattern: 'Gyroid',
      supports: false,
      brim: false,
      pauses: [],
      notes: [
        'Alles in PLA oder PETG, 0.2 mm Schichten.',
        'Halteplatte mit 4 Wandlinien und 40 % Fuellung drucken - die Stege zwischen den Ausschnitten tragen die Rastkraft.',
        'Tastenkappen: 0.12 mm Schichten sehen deutlich besser aus und die Kreuzaufnahme wird masshaltiger.',
        'Kein Stuetzmaterial noetig, solange die Kappen mit der Oeffnung nach unten liegen.',
      ],
    },
  };
}

export const clickerModel: FidgetModel = {
  id: 'clicker',
  name: 'Clicker',
  tagline: 'Mechanische Tastaturschalter zum Dauerklicken',
  description:
    'Ein Gehaeuse mit Halteplatte fuer mechanische Schalter im 14-mm-Standardausschnitt. Blaue Clicky-Schalter geben den lautesten Klick. Rastermass, Anzahl und Bautiefe sind frei waehlbar, Tastenkappen mit Kreuzaufnahme werden auf Wunsch mitgeneriert.',
  requires: 'MX-kompatible Schalter, PLA',
  params,
  defaults,
  presets: [
    {
      id: 'duo',
      name: 'Zwei Schalter',
      description: 'Der Klassiker fuer die Hosentasche: zwei Schalter nebeneinander.',
      params: { ...defaults },
    },
    {
      id: 'einzeln',
      name: 'Einzelklicker',
      description: 'Ein Schalter, kleines Gehaeuse, mit Loch fuer den Schluesselring.',
      params: { ...defaults, cols: 1, rows: 1, margin: 4, cornerRadius: 5, keyring: true },
    },
    {
      id: 'sechserfeld',
      name: 'Sechserfeld',
      description: 'Drei mal zwei Schalter - genug zum Trommeln mit beiden Haenden.',
      params: { ...defaults, cols: 3, rows: 2, margin: 7, extraDepth: 4 },
    },
    {
      id: 'flach',
      name: 'Flach mit Choc',
      description: 'Low-Profile-Schalter im engeren Raster - passt in jede Tasche.',
      params: { ...defaults, switchType: 'choc', spacing: 18, cols: 2, rows: 2, extraDepth: 0, capHeight: 5, margin: 5 },
    },
  ],
  build,
};
