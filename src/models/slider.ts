/**
 * Magnet-Slider: ein Wagen laeuft in einer Schiene und rastet an den Enden
 * magnetisch ein.
 *
 * Der Kanal ist oben von zwei Lippen ueberdeckt, die den Wagen halten, und
 * an beiden Enden geschlossen - deshalb wird alles in einem Stueck gedruckt
 * und der Wagen nach dem Druck einmal losgebrochen. Ein Spalt von 0.3 mm
 * ringsum genuegt dafuer und laeuft trotzdem satt.
 *
 * Magnete sitzen in Sacktaschen: zwei in der Schiene an den Enden, einer im
 * Wagen. Je nach Polung zieht der Wagen in die Endlagen (Klick) oder wird
 * abgestossen und schwebt dazwischen.
 */

import { extrudeRegion } from '../geo/extrude.ts';
import { polyBounds, roundedRect, type Poly } from '../geo/shapes2d.ts';
import { MAGNETS, magnetById, materialById } from '../catalog/parts.ts';
import { plateWithPockets, ringWall, roundPocketPoly } from './build.ts';
import { keyringHole } from './shapes.ts';
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

const params: ParamDef[] = [
  { kind: 'number', key: 'length', label: 'Laenge', group: 'Schiene', min: 45, max: 200, step: 1, unit: 'mm' },
  { kind: 'number', key: 'width', label: 'Breite', group: 'Schiene', min: 14, max: 50, step: 0.5, unit: 'mm' },
  {
    kind: 'number', key: 'railWall', label: 'Seitenwand', group: 'Schiene',
    min: 1.2, max: 6, step: 0.1, unit: 'mm',
  },
  {
    kind: 'number', key: 'floorThickness', label: 'Bodenstaerke', group: 'Schiene',
    min: 1.0, max: 5, step: 0.1, unit: 'mm',
  },
  {
    kind: 'number', key: 'lipOverhang', label: 'Ueberstand der Haltelippe', group: 'Schiene',
    min: 0.6, max: 3, step: 0.1, unit: 'mm',
    help: 'Haelt den Wagen im Kanal. Ueber 1.5 mm haengt der Ueberhang beim Drucken durch.',
  },
  { kind: 'number', key: 'cornerRadius', label: 'Eckenradius', group: 'Schiene', min: 0, max: 20, step: 0.5, unit: 'mm' },

  {
    kind: 'number', key: 'carriageLength', label: 'Laenge des Wagens', group: 'Wagen',
    min: 10, max: 60, step: 0.5, unit: 'mm',
  },
  {
    kind: 'number', key: 'knobHeight', label: 'Hoehe des Griffs', group: 'Wagen',
    min: 0, max: 12, step: 0.5, unit: 'mm',
    help: 'Der Teil, der ueber die Schiene hinausragt und den man mit dem Daumen schiebt.',
  },
  {
    kind: 'number', key: 'clearance', label: 'Laufspiel', group: 'Wagen',
    min: 0.15, max: 0.6, step: 0.05, unit: 'mm',
    help: 'Zu wenig und der Wagen sitzt fest, zu viel und er klappert. 0.3 mm passen fuer die meisten Drucker.',
  },

  {
    kind: 'select', key: 'magnet', label: 'Magnetgroesse', group: 'Magnete',
    options: MAGNETS.filter((m) => m.shape === 'disc').map((m) => ({
      value: m.id, label: m.label, help: `${m.mass.toFixed(2)} g je Stueck`,
    })),
  },
  {
    kind: 'select', key: 'magnetMode', label: 'Wirkung', group: 'Magnete',
    options: [
      { value: 'anziehen', label: 'Einrasten an den Enden', help: 'Der Wagen wird in beide Endlagen gezogen und rastet hoerbar ein.' },
      { value: 'abstossen', label: 'Schweben in der Mitte', help: 'Beide Enden stossen ab - der Wagen findet von selbst die Mitte.' },
      { value: 'keine', label: 'Ohne Magnete', help: 'Laeuft frei von Anschlag zu Anschlag.' },
    ],
  },
  {
    kind: 'number', key: 'magnetClearance', label: 'Spiel der Magnettasche', group: 'Magnete',
    when: (p) => p.magnetMode !== 'keine', min: 0, max: 0.4, step: 0.05, unit: 'mm',
    help: 'Etwas Untermass laesst den Magneten klemmen. Mit Uebermass braucht es einen Tropfen Kleber.',
  },

  { kind: 'boolean', key: 'keyring', label: 'Loch fuer Schluesselring', group: 'Extras' },
  { kind: 'color', key: 'colorRail', label: 'Farbe Schiene', group: 'Extras' },
  { kind: 'color', key: 'colorCarriage', label: 'Farbe Wagen', group: 'Extras' },
];

const defaults: Params = {
  length: 90,
  width: 24,
  railWall: 2.4,
  floorThickness: 1.6,
  lipOverhang: 1.2,
  cornerRadius: 6,
  carriageLength: 24,
  knobHeight: 4,
  clearance: 0.3,
  magnet: 'm6x3',
  magnetMode: 'anziehen',
  magnetClearance: 0.1,
  keyring: false,
  colorRail: '#3a3f4b',
  colorCarriage: '#e8a33d',
};

function build(p: Params): BuildResult {
  const warnings: string[] = [];
  const length = num(p, 'length', 90);
  const width = num(p, 'width', 24);
  const railWall = num(p, 'railWall', 2.4);
  const floorT = num(p, 'floorThickness', 1.6);
  const lip = num(p, 'lipOverhang', 1.2);
  const corner = num(p, 'cornerRadius', 6);
  const carLength = num(p, 'carriageLength', 24);
  const knob = num(p, 'knobHeight', 4);
  const gap = num(p, 'clearance', 0.3);
  const magnet = magnetById(str(p, 'magnet', 'm6x3'));
  const mode = str(p, 'magnetMode', 'anziehen');
  const magGap = num(p, 'magnetClearance', 0.1);
  const useMagnets = mode !== 'keine';

  // Der Kanal: innen so breit, dass der Wagen mit Spiel laeuft, und an
  // beiden Enden geschlossen - dadurch braucht es keine Endkappen.
  const channelW = width - 2 * railWall;
  const channelL = length - 2 * railWall;
  const carW = channelW - 2 * gap;
  const carH = magnet.height + 1.6;
  const railHeight = floorT + carH + gap;

  const railOutline = roundedRect(length, width, corner, 10);
  const channel = roundedRect(channelL, channelW, Math.max(0, corner - railWall), 10);
  const lipOpening = roundedRect(channelL - 2 * lip, channelW - 2 * lip, Math.max(0, corner - railWall - lip), 10);

  const ring = bool(p, 'keyring', false)
    ? keyringHole(railOutline, 5, railWall + 5)
    : null;

  // --- Schiene -----------------------------------------------------------
  // Magnete der Schiene liegen im Boden unter den Endlagen des Wagens.
  const endOffset = channelL / 2 - carLength / 2 - gap;
  const railMagnets = useMagnets
    ? [-endOffset, endOffset].map((x) => ({
        poly: movePoly(roundPocketPoly(magnet.diameter + 2 * magGap, 40), x, 0),
        depth: Math.min(magnet.height + 0.2, floorT + carH * 0.5),
        from: 'top' as const,
      }))
    : [];

  const rail = plateWithPockets(
    railOutline,
    0,
    floorT,
    railMagnets,
    ring ? [ring.hole] : [],
  );
  // Seitenwaende bis Kanalhoehe, darueber die einwaerts ragenden Haltelippen.
  rail.add(ringWall(railOutline, channel, floorT - 0.05, railHeight));
  rail.add(ringWall(railOutline, lipOpening, railHeight - 0.05, railHeight + 1.2));

  // --- Wagen -------------------------------------------------------------
  // Wird in der Schiene liegend mitgedruckt und nach dem Druck losgebrochen.
  const carOutline = roundedRect(carLength, carW, Math.min(3, carW / 3), 8);
  const carZ = floorT + gap;
  const carMagnet = useMagnets
    ? [{
        poly: roundPocketPoly(magnet.diameter + 2 * magGap, 40),
        depth: Math.min(magnet.height + 0.2, carH - 0.6),
        from: 'bottom' as const,
      }]
    : [];
  const carriage = plateWithPockets(carOutline, carZ, carZ + carH, carMagnet);

  if (knob > 0.1) {
    const knobOutline = roundedRect(
      Math.min(carLength - 2, channelL - 2 * lip - 2 * gap),
      Math.min(carW - 1, channelW - 2 * lip - 2 * gap),
      Math.min(3, carW / 3),
      8,
    );
    carriage.add(extrudeRegion({ outline: knobOutline, holes: [] }, carZ + carH - 0.05, railHeight + 1.2 + knob));
  }

  // --- Zahlen ------------------------------------------------------------
  const pla = materialById('pla');
  const railGram = gramFor(rail.volume(), pla.density);
  const carGram = gramFor(carriage.volume(), pla.density);
  const travel = channelL - carLength - 2 * gap;
  const b = polyBounds(railOutline);
  const magnetCount = useMagnets ? 3 : 0;

  // Die Magnettasche im Wagen oeffnet nach unten, die in der Schiene nach
  // oben - dazwischen bleibt nur das Laufspiel.
  const magnetGapMm = gap;

  if (carW < 6) {
    warnings.push('Der Wagen wird schmaler als 6 mm und damit sehr fragil. Schiene breiter oder Seitenwand duenner machen.');
  }
  if (travel < 5) {
    warnings.push(`Der Wagen kann nur ${travel.toFixed(1)} mm weit laufen. Schiene verlaengern oder Wagen kuerzen.`);
  }
  if (useMagnets && magnet.diameter > carW - 2) {
    warnings.push(`Der Magnet (${magnet.diameter} mm) passt nicht in den ${carW.toFixed(1)} mm breiten Wagen. Kleineren Magneten oder breitere Schiene waehlen.`);
  }
  if (useMagnets && magnet.height + 0.2 > floorT + carH * 0.5) {
    warnings.push('Die Magnettasche in der Schiene ist tiefer als der Boden erlaubt - erhoehe die Bodenstaerke.');
  }
  if (lip > 1.5) {
    warnings.push('Ein Lippenueberstand ueber 1.5 mm haengt beim Drucken sichtbar durch.');
  }
  if (gap < 0.2) {
    warnings.push('Unter 0.2 mm Laufspiel verschweisst der Wagen beim Drucken haeufig mit der Schiene.');
  }

  return {
    parts: [
      {
        id: 'schiene',
        name: 'Schiene mit Wagen',
        mesh: rail,
        copies: 1,
        materialId: 'pla',
        color: str(p, 'colorRail', '#3a3f4b'),
        group: 'Slider',
        note: 'Flach drucken. Der Wagen ist ein eigenes Teil in derselben Datei und wird mitgedruckt.',
      },
      {
        id: 'wagen',
        name: 'Wagen',
        mesh: carriage,
        copies: 1,
        materialId: 'pla',
        color: str(p, 'colorCarriage', '#e8a33d'),
        group: 'Slider',
        note: 'Liegt bereits an seinem Platz in der Schiene - nicht separat anordnen.',
      },
    ],
    stats: [
      { label: 'Abmessung', value: `${b.width.toFixed(0)} x ${b.height.toFixed(0)} x ${(railHeight + 1.2 + knob).toFixed(1)} mm` },
      { label: 'Schiebeweg', value: `${travel.toFixed(1)} mm` },
      { label: 'Wirkung', value: mode === 'anziehen' ? 'rastet an beiden Enden ein' : mode === 'abstossen' ? 'schwebt in der Mitte' : 'frei laufend' },
      { label: 'Laufspiel', value: `${gap} mm rundum` },
      useMagnets
        ? { label: 'Magnetspalt', value: `${magnetGapMm.toFixed(2)} mm`, hint: 'Abstand zwischen Wagen- und Schienenmagnet in der Endlage' }
        : { label: 'Magnete', value: 'keine' },
      { label: 'Filament', value: `${(railGram + carGram).toFixed(0)} g` },
    ],
    bom: useMagnets
      ? [{
          label: `Neodym-Magnete ${magnet.label}`,
          qty: magnetCount,
          unit: 'Stueck',
          note: mode === 'anziehen'
            ? 'Zwei in die Schiene, einer in den Wagen. Auf die Polung achten - siehe Montageanleitung.'
            : 'Zwei in die Schiene, einer in den Wagen, alle gleichpolig zueinander.',
        }]
      : [],
    steps: [
      'In einem Durchgang drucken. Schiene und Wagen liegen bereits richtig zueinander.',
      'Nach dem Abkuehlen den Wagen einmal kraeftig hin- und herschieben, bis er sich loest. Er kann anfangs leicht haften - das ist normal.',
      ...(useMagnets
        ? [
            'Die beiden Magnete in die Taschen an den Schienenenden druecken.',
            mode === 'anziehen'
              ? 'Den Wagenmagneten so einsetzen, dass er von den Schienenmagneten angezogen wird: Magnet an die Schienentasche halten, die anziehende Seite markieren und mit dieser Seite nach unten in den Wagen setzen.'
              : 'Den Wagenmagneten so einsetzen, dass er die Schienenmagnete abstoesst - also mit gleicher Polung nach unten.',
            'Sitzen die Magnete locker, einen Tropfen Sekundenkleber in die Tasche geben. Vorher die Wirkung pruefen, danach laesst sich nichts mehr drehen.',
          ]
        : []),
      'Fuehlt sich der Lauf rau an, die Kanten des Wagens einmal mit feinem Schleifpapier brechen.',
    ],
    warnings,
    profile: {
      layerHeight: 0.16,
      wallLoops: 3,
      infill: 25,
      infillPattern: 'Gyroid',
      supports: false,
      brim: false,
      pauses: [],
      notes: [
        'Duenne Schichten helfen: bei 0.16 mm trennen sich Wagen und Schiene deutlich leichter als bei 0.28 mm.',
        'Kein Stuetzmaterial - die Haltelippen sind kurze Ueberhaenge, die der Drucker ueberbrueckt.',
        'Wichtig: die Funktion "Spalt ueberbruecken" bzw. Elefantenfuss-Korrektur nicht uebertreiben, sonst verschweissen Wagen und Schiene.',
        'Die Magnete erst nach dem Druck einlegen - im Druckraum verlieren sie oberhalb von 80 Grad dauerhaft an Kraft.',
      ],
    },
  };
}

export const sliderModel: FidgetModel = {
  id: 'slider',
  name: 'Magnet-Slider',
  tagline: 'Wagen in der Schiene, der magnetisch einrastet',
  description:
    'Eine Schiene mit ueberdeckten Haltelippen und einem Wagen, der darin laeuft. Beides wird in einem Stueck gedruckt und nach dem Druck einmal losgebrochen. Magnete an den Schienenenden lassen den Wagen in die Endlagen einrasten - oder, umgekehrt gepolt, in der Mitte schweben.',
  requires: 'drei Scheibenmagnete (optional), PLA',
  params,
  defaults,
  presets: [
    {
      id: 'klassisch',
      name: 'Einrastend',
      description: '90 mm lang, rastet an beiden Enden mit spuerbarem Klick ein.',
      params: { ...defaults },
    },
    {
      id: 'schwebend',
      name: 'Schwebend',
      description: 'Gleiche Schiene, aber die Magnete stossen ab - der Wagen zentriert sich selbst.',
      params: { ...defaults, magnetMode: 'abstossen', magnet: 'm8x3' },
    },
    {
      id: 'taschenformat',
      name: 'Taschenformat',
      description: 'Kurz und schmal, mit Loch fuer den Schluesselring.',
      params: { ...defaults, length: 60, width: 18, carriageLength: 16, magnet: 'm5x2', keyring: true, cornerRadius: 5 },
    },
    {
      id: 'lang',
      name: 'Langer Weg',
      description: '150 mm Schiene mit kurzem Wagen - viel Strecke zum Schieben.',
      params: { ...defaults, length: 150, carriageLength: 20, knobHeight: 5, magnet: 'm8x3' },
    },
  ],
  build,
};
