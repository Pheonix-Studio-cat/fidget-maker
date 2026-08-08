/**
 * Stressball: hohle Kugel aus TPU.
 *
 * Die Haerte kommt aus Wandstaerke und Shore-Haerte des Filaments, nicht aus
 * der Fuellung - innen ist der Ball leer. Ueber die Oeffnung am Pol
 * entweicht beim Druecken Luft; wer sie mit dem mitgenerierten Stopfen
 * verschliesst, bekommt einen deutlich pralleren Ball. Reis oder feiner
 * Sand durch dieselbe Oeffnung machen ihn schwer und knetbar.
 */

import { coneMesh, cylinderMesh } from '../geo/extrude.ts';
import { Mesh } from '../geo/mesh.ts';
import {
  bumpDisplace,
  diamondDisplace,
  texturedSphereShell,
  waveDisplace,
  type Displace,
} from '../geo/sphere.ts';
import { MATERIALS, materialById } from '../catalog/parts.ts';
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

const SURFACES = [
  { value: 'glatt', label: 'Glatt', help: 'Schlichte Kugel - druckt am schnellsten und am zuverlaessigsten.' },
  { value: 'noppen', label: 'Noppen', help: 'Halbkugeln auf der Oberflaeche. Griffig und angenehm in der Hand.' },
  { value: 'golf', label: 'Golfball-Dellen', help: 'Eingedrueckte Kuppen. Sieht gut aus und gibt guten Grip.' },
  { value: 'stacheln', label: 'Stacheln', help: 'Spitz zulaufende Noppen - der Igel unter den Stressbaellen.' },
  { value: 'wellen', label: 'Wellen', help: 'Weiche Rillen um die Kugel herum.' },
  { value: 'rauten', label: 'Rauten', help: 'Kreuzende Rillen, wie bei einem Golfschlaeger-Griff.' },
];

function displaceFor(style: string, amp: number, count: number): Displace | undefined {
  switch (style) {
    case 'noppen':
      return bumpDisplace(count, amp, 0.34, 1.6);
    case 'golf':
      return bumpDisplace(count, -amp, 0.32, 1.2);
    case 'stacheln':
      return bumpDisplace(count, amp * 2.2, 0.26, 3.2);
    case 'wellen':
      return waveDisplace(amp, 12, 14);
    case 'rauten':
      return diamondDisplace(amp, 16);
    default:
      return undefined;
  }
}

const params: ParamDef[] = [
  { kind: 'number', key: 'diameter', label: 'Durchmesser', group: 'Kugel', min: 30, max: 120, step: 1, unit: 'mm' },
  {
    kind: 'number', key: 'wall', label: 'Wandstaerke', group: 'Kugel',
    min: 0.8, max: 5, step: 0.1, unit: 'mm',
    help: 'Der wichtigste Regler fuer die Haerte. 1.2 mm sind weich, 2.5 mm geben deutlich Widerstand.',
  },
  {
    kind: 'select', key: 'material', label: 'Filament', group: 'Kugel',
    options: MATERIALS.filter((m) => m.flexible).map((m) => ({ value: m.id, label: m.label, help: m.notes })),
    help: 'Weicheres TPU gibt mehr nach. 85A braucht einen Direktextruder.',
  },
  {
    kind: 'number', key: 'flatBottom', label: 'Abflachung unten', group: 'Kugel',
    min: 0, max: 4, step: 0.1, unit: 'mm',
    help: 'Kleine Standflaeche fuer die erste Schicht. Ohne sie beruehrt die Kugel das Bett nur in einem Punkt und loest sich fast sicher.',
  },

  { kind: 'select', key: 'surface', label: 'Oberflaeche', group: 'Struktur', options: SURFACES },
  {
    kind: 'number', key: 'textureDepth', label: 'Strukturtiefe', group: 'Struktur',
    when: (p) => p.surface !== 'glatt', min: 0.3, max: 5, step: 0.1, unit: 'mm',
  },
  {
    kind: 'number', key: 'textureCount', label: 'Anzahl Noppen', group: 'Struktur',
    when: (p) => p.surface === 'noppen' || p.surface === 'golf' || p.surface === 'stacheln',
    min: 12, max: 300, step: 1,
  },

  {
    kind: 'number', key: 'holeDiameter', label: 'Oeffnung', group: 'Oeffnung',
    min: 0, max: 20, step: 0.5, unit: 'mm',
    help: '0 schliesst die Kugel ganz. Dann muss der Drucker die Decke frei ueberbruecken und die eingeschlossene Luft macht den Ball straff.',
  },
  {
    kind: 'boolean', key: 'plug', label: 'Stopfen mitdrucken', group: 'Oeffnung',
    when: (p) => (p.holeDiameter as number) > 2,
  },
  {
    kind: 'number', key: 'plugClearance', label: 'Spiel des Stopfens', group: 'Oeffnung',
    when: (p) => p.plug === true && (p.holeDiameter as number) > 2,
    min: 0, max: 0.5, step: 0.05, unit: 'mm',
    help: 'In TPU darf der Stopfen ruhig stramm sitzen - 0.1 mm Untermass halten besser als Uebermass.',
  },

  { kind: 'number', key: 'quality', label: 'Netzfeinheit', group: 'Extras', min: 32, max: 160, step: 8,
    help: 'Mehr Segmente ergeben eine rundere Kugel und eine groessere Datei.' },
  { kind: 'color', key: 'color', label: 'Farbe', group: 'Extras' },
];

const defaults: Params = {
  diameter: 62,
  wall: 1.6,
  material: 'tpu95',
  flatBottom: 1.2,
  surface: 'noppen',
  textureDepth: 1.8,
  textureCount: 90,
  holeDiameter: 6,
  plug: true,
  plugClearance: 0.1,
  quality: 96,
  color: '#e8735a',
};

/** Kegeliger Stopfen mit Griffteller. */
function buildPlug(holeDiameter: number, wall: number, clearance: number): Mesh {
  const r = holeDiameter / 2 - clearance;
  const shaftLength = Math.max(2.5, wall + 2);
  const m = new Mesh();
  // Leicht kegelig, damit er sich einfaedeln laesst und dann klemmt.
  m.add(coneMesh(r * 0.86, r, shaftLength, 48, 0));
  // Griffteller oben
  m.add(cylinderMesh(r + 1.8, 1.6, 48, shaftLength - 0.05));
  return m;
}

function build(p: Params): BuildResult {
  const warnings: string[] = [];
  const d = num(p, 'diameter', 62);
  const R = d / 2;
  const wall = num(p, 'wall', 1.6);
  const mat = materialById(str(p, 'material', 'tpu95'));
  const flat = num(p, 'flatBottom', 1.2);
  const surface = str(p, 'surface', 'noppen');
  const amp = surface === 'glatt' ? 0 : num(p, 'textureDepth', 1.8);
  const count = Math.round(num(p, 'textureCount', 90));
  const hole = num(p, 'holeDiameter', 6);
  const segments = Math.round(num(p, 'quality', 96));
  const rings = Math.max(24, Math.round(segments * 0.7));

  const ball = texturedSphereShell({
    radius: R,
    wall,
    holeDiameter: hole,
    flatBottom: Math.min(flat, wall * 0.95),
    segments,
    rings,
    displace: displaceFor(surface, amp, count),
  });

  const wantPlug = bool(p, 'plug', true) && hole > 2;
  const plug = wantPlug ? buildPlug(hole, wall, num(p, 'plugClearance', 0.1)) : null;

  const gram = gramFor(ball.volume(), mat.density);
  const plugGram = plug ? gramFor(plug.volume(), mat.density) : 0;
  // Grober Haerte-Eindruck: die Steifigkeit einer Schale waechst ungefaehr
  // mit der dritten Potenz der Wandstaerke und faellt mit dem Radius.
  const stiffness = (wall / 1.5) ** 3 * (30 / R) * (mat.id === 'tpu85' ? 0.45 : 1);
  const feel =
    stiffness < 0.35 ? 'sehr weich' :
    stiffness < 0.8 ? 'weich' :
    stiffness < 1.6 ? 'mittel' :
    stiffness < 3 ? 'fest' : 'sehr fest';

  if (wall < mat.minWall) {
    warnings.push(`${wall} mm Wand liegt unter dem, was sich mit ${mat.label} sauber drucken laesst (${mat.minWall} mm).`);
  }
  if (hole === 0) {
    warnings.push('Ohne Oeffnung muss der Drucker die Decke ueber dem Hohlraum frei ueberbruecken. Das gelingt in TPU nur langsam und selten schoen - 4 bis 8 mm Oeffnung sind die sicherere Wahl.');
  }
  if (flat < 0.5) {
    warnings.push('Ohne Abflachung steht die Kugel auf einem Punkt. Ohne Brim loest sie sich mit hoher Wahrscheinlichkeit vom Bett.');
  }
  if (surface === 'stacheln' && amp > 3.5) {
    warnings.push('Sehr lange Stacheln neigen dazu, beim Drucken umzuklappen. Unter 3 mm bleiben sie stabil.');
  }
  if (d > 200) {
    warnings.push('Ueber 200 mm passt die Kugel auf kein uebliches Druckbett.');
  }

  const parts = [
    {
      id: 'ball',
      name: 'Stressball',
      mesh: ball,
      copies: 1,
      materialId: mat.id,
      color: str(p, 'color', '#e8735a'),
      note: 'Ohne Stuetzen drucken. Die Abflachung liegt unten auf dem Bett.',
    },
  ];
  if (plug) {
    parts.push({
      id: 'stopfen',
      name: 'Stopfen',
      mesh: plug,
      copies: 1,
      materialId: mat.id,
      color: str(p, 'color', '#e8735a'),
      note: 'Winziges Teil - am besten zusammen mit dem Ball auf dem Bett platzieren.',
    });
  }

  return {
    parts,
    stats: [
      { label: 'Durchmesser', value: `${d} mm` },
      { label: 'Griffgefuehl', value: feel, hint: `${wall} mm Wand in ${mat.label}` },
      { label: 'Hohlraum', value: `${(((4 / 3) * Math.PI * (R - wall) ** 3) / 1000).toFixed(0)} ml`, hint: 'so viel Reis oder Sand passt hinein' },
      { label: 'Filament', value: `${(gram + plugGram).toFixed(0)} g` },
      { label: 'Oberflaeche', value: SURFACES.find((s) => s.value === surface)?.label ?? surface },
      { label: 'Dreiecke', value: `${(ball.triangleCount / 1000).toFixed(0)}k`, hint: 'Netzfeinheit senken, falls der Slicer traege wird' },
    ],
    bom: [],
    steps: [
      'Ball drucken - langsam, 20 bis 25 mm/s, ohne Stuetzen.',
      hole > 0
        ? 'Optional durch die Oeffnung Reis, Sand oder Mehl einfuellen. Ein Blatt Papier als Trichter reicht.'
        : 'Der Ball ist geschlossen; die eingeschlossene Luft macht ihn straffer.',
      wantPlug
        ? 'Stopfen einsetzen. Er sitzt stramm und laesst sich zum Nachfuellen wieder herausziehen.'
        : 'Wer die Oeffnung dauerhaft schliessen will, klebt sie mit einem Tropfen Sekundenkleber und einem Stueck TPU-Rest zu.',
      'Vor dem ersten kraeftigen Druecken einmal langsam durchkneten - so setzen sich die Schichten.',
    ],
    warnings,
    profile: {
      layerHeight: 0.2,
      wallLoops: Math.max(2, Math.round(wall / 0.42)),
      infill: 0,
      infillPattern: 'keine',
      supports: false,
      brim: true,
      pauses: [],
      notes: [
        `${mat.label}: 20-25 mm/s, Retraktion moeglichst klein, Luefter an.`,
        'Fuellung auf 0 % - die Wandstaerke allein bestimmt die Haerte.',
        `${Math.max(2, Math.round(wall / 0.42))} Wandlinien ergeben zusammen etwa ${wall} mm Wand.`,
        'Brim mit 5 mm Breite, damit die kleine Standflaeche sicher haelt.',
        'Bei Stacheln oder tiefen Dellen die Aussenwand-Geschwindigkeit zusaetzlich halbieren.',
      ],
    },
  };
}

export const stressballModel: FidgetModel = {
  id: 'stressball',
  name: 'Stressball',
  tagline: 'Hohle TPU-Kugel zum Druecken',
  description:
    'Eine hohle Kugel aus flexiblem Filament. Wandstaerke und Shore-Haerte bestimmen, wie stark sie nachgibt; die Oberflaeche kann glatt, genoppt, mit Golfball-Dellen oder mit Stacheln versehen sein. Durch die Oeffnung am Pol laesst sich der Ball mit Reis oder Sand fuellen - dazu gibt es einen passenden Stopfen.',
  requires: 'nur flexibles Filament (TPU)',
  params,
  defaults,
  presets: [
    {
      id: 'standard',
      name: 'Genoppt, mittel',
      description: '62 mm mit 1.6 mm Wand und Noppen - guter Kompromiss aus Griff und Widerstand.',
      params: { ...defaults },
    },
    {
      id: 'sehrweich',
      name: 'Sehr weich',
      description: 'Duenne Wand in 85A - gibt schon bei leichtem Druck nach.',
      params: { ...defaults, material: 'tpu85', wall: 1.0, diameter: 65, surface: 'glatt', holeDiameter: 8 },
    },
    {
      id: 'golf',
      name: 'Golfball',
      description: 'Dellen statt Noppen, etwas fester.',
      params: { ...defaults, surface: 'golf', textureCount: 140, textureDepth: 1.4, wall: 2.0 },
    },
    {
      id: 'igel',
      name: 'Igel',
      description: 'Stacheln ringsum - auffaellig und ueberraschend angenehm.',
      params: { ...defaults, surface: 'stacheln', textureDepth: 2.2, textureCount: 70, wall: 1.4 },
    },
    {
      id: 'knetball',
      name: 'Knetball zum Fuellen',
      description: 'Grosse Oeffnung und weiche Wand - zum Fuellen mit Sand oder Mehl gedacht.',
      params: { ...defaults, diameter: 70, wall: 1.2, material: 'tpu85', holeDiameter: 14, surface: 'glatt', plug: true },
    },
  ],
  build,
};
