/**
 * Katalog der Kaufteile, um die herum konstruiert wird.
 *
 * Die Masse sind typische Herstellerangaben. Sie sind bewusst als Startwerte
 * gedacht: jeder Wert laesst sich in der Oberflaeche ueberschreiben, und bei
 * einer neuen Charge lohnt sich Nachmessen mit dem Messschieber.
 */

export interface MetalDome {
  id: string;
  /** Nenndurchmesser in mm - so heisst die Groesse auch beim Haendler. */
  diameter: number;
  /** Hoehe der Kuppel ueber der Auflageflaeche in mm. */
  height: number;
  /** Blechstaerke in mm. */
  thickness: number;
  /** Schaltweg bis zum Klick in mm. */
  travel: number;
  /** Schaltkraft in Gramm - bestimmt, wie "knackig" sich das Pop-It anfuehlt. */
  force: number;
  /**
   * Zusaetzlicher Platzbedarf des Kreuz-/Vierbein-Typs: die Beine stehen
   * ueber den Kuppelkreis hinaus. Bei runden Domes ist der Wert 0.
   */
  legOverhang: number;
}

/**
 * Metall-Schnappkuppeln ("Kreuzkuppel-Typ", 4-Bein). Groessen wie im
 * 100er-Sortiment ueblich.
 */
export const METAL_DOMES: MetalDome[] = [
  { id: 'd5', diameter: 5.0, height: 0.45, thickness: 0.06, travel: 0.2, force: 160, legOverhang: 0.8 },
  { id: 'd6', diameter: 6.0, height: 0.5, thickness: 0.06, travel: 0.22, force: 180, legOverhang: 0.9 },
  { id: 'd7', diameter: 7.0, height: 0.55, thickness: 0.07, travel: 0.25, force: 200, legOverhang: 1.0 },
  { id: 'd84', diameter: 8.4, height: 0.6, thickness: 0.07, travel: 0.28, force: 250, legOverhang: 1.1 },
  { id: 'd10', diameter: 10.0, height: 0.65, thickness: 0.08, travel: 0.3, force: 300, legOverhang: 1.2 },
  { id: 'd12', diameter: 12.0, height: 0.75, thickness: 0.08, travel: 0.32, force: 350, legOverhang: 1.3 },
  { id: 'd14', diameter: 14.0, height: 0.85, thickness: 0.1, travel: 0.35, force: 400, legOverhang: 1.5 },
];

export function domeById(id: string): MetalDome {
  return METAL_DOMES.find((d) => d.id === id) ?? METAL_DOMES[3];
}

export interface SwitchSpec {
  id: string;
  label: string;
  /** Quadratische Plattenoeffnung in mm (Standard MX: 14.0). */
  plateHole: number;
  /** Kantenlaenge des oberen Gehaeuses - darf nicht kollidieren. */
  topHousing: number;
  /** Kantenlaenge des unteren Gehaeuses. */
  bottomHousing: number;
  /** Dicke der Halteplatte, in die der Schalter einrastet. */
  plateThickness: number;
  /** Benoetigter Freiraum unter der Platte fuer Gehaeuse und Pins. */
  belowPlate: number;
  /** Rastermass fuer Schalterfelder (1u = 19.05 mm). */
  spacing: number;
  /** Pins: 3 = Mittelzapfen + 2 Kontakte, 5 = zusaetzliche Fuehrungszapfen. */
  pins: 3 | 5;
  description: string;
}

export const SWITCHES: SwitchSpec[] = [
  {
    id: 'mx3',
    label: 'MX 3-Pin (Blue Clicky)',
    plateHole: 14.0,
    topHousing: 15.6,
    bottomHousing: 13.98,
    plateThickness: 1.5,
    belowPlate: 6.0,
    spacing: 19.05,
    pins: 3,
    description:
      'Der Standard aus dem DIY-Set: klickt hoerbar und rastet in einer 14x14-mm-Platte ein. 3 Pins heisst, es gibt keine seitlichen Fuehrungszapfen - der Ausschnitt kann sauber quadratisch bleiben.',
  },
  {
    id: 'mx5',
    label: 'MX 5-Pin (PCB-Mount)',
    plateHole: 14.0,
    topHousing: 15.6,
    bottomHousing: 13.98,
    plateThickness: 1.5,
    belowPlate: 6.5,
    spacing: 19.05,
    pins: 5,
    description:
      'Wie oben, aber mit zwei zusaetzlichen Fuehrungszapfen. Braucht unter der Platte etwas mehr Luft.',
  },
  {
    id: 'choc',
    label: 'Kailh Choc (Low Profile)',
    plateHole: 13.8,
    topHousing: 15.0,
    bottomHousing: 13.8,
    plateThickness: 1.3,
    belowPlate: 3.2,
    spacing: 18.0,
    pins: 3,
    description: 'Flachbauender Schalter - ergibt ein deutlich duenneres Clicker-Gehaeuse.',
  },
];

export function switchById(id: string): SwitchSpec {
  return SWITCHES.find((s) => s.id === id) ?? SWITCHES[0];
}

/** MX-Kreuzstem: Masse des Zapfens am Schalter, in den die Tastenkappe greift. */
export const MX_STEM = {
  /** Laenge eines Kreuzarms. */
  armLength: 4.1,
  /** Breite eines Kreuzarms. */
  armWidth: 1.35,
  /** Einstecktiefe in der Tastenkappe. */
  depth: 3.8,
};

export interface Bearing {
  id: string;
  label: string;
  outer: number;
  inner: number;
  width: number;
  /** Gewicht in Gramm - geht in die Massenabschaetzung des Spinners ein. */
  mass: number;
}

export const BEARINGS: Bearing[] = [
  { id: '608', label: '608 (22 x 8 x 7 mm)', outer: 22, inner: 8, width: 7, mass: 11.5 },
  { id: '688', label: '688 (16 x 8 x 5 mm)', outer: 16, inner: 8, width: 5, mass: 4.5 },
  { id: '626', label: '626 (19 x 6 x 6 mm)', outer: 19, inner: 6, width: 6, mass: 6.5 },
  { id: '6700', label: '6700 (15 x 10 x 4 mm)', outer: 15, inner: 10, width: 4, mass: 2.6 },
  { id: 'r188', label: 'R188 (12.7 x 6.35 x 4.76 mm)', outer: 12.7, inner: 6.35, width: 4.762, mass: 2.4 },
];

export function bearingById(id: string): Bearing {
  return BEARINGS.find((b) => b.id === id) ?? BEARINGS[0];
}

export interface MagnetSpec {
  id: string;
  label: string;
  shape: 'disc' | 'sphere' | 'block';
  diameter: number;
  /** Hoehe bei Scheiben und Quadern; bei Kugeln gleich dem Durchmesser. */
  height: number;
  /** Gewicht in Gramm (Neodym, Dichte ~7.5 g/cm3). */
  mass: number;
}

function discMagnet(d: number, h: number): MagnetSpec {
  const volume = Math.PI * (d / 2) ** 2 * h; // mm3
  return {
    id: `m${d}x${h}`.replace('.', '_'),
    label: `Scheibe ${d} x ${h} mm`,
    shape: 'disc',
    diameter: d,
    height: h,
    mass: (volume / 1000) * 7.5,
  };
}

function sphereMagnet(d: number): MagnetSpec {
  const volume = (4 / 3) * Math.PI * (d / 2) ** 3;
  return {
    id: `ms${d}`.replace('.', '_'),
    label: `Kugel ${d} mm`,
    shape: 'sphere',
    diameter: d,
    height: d,
    mass: (volume / 1000) * 7.5,
  };
}

export const MAGNETS: MagnetSpec[] = [
  discMagnet(3, 2),
  discMagnet(4, 2),
  discMagnet(5, 2),
  discMagnet(5, 3),
  discMagnet(6, 2),
  discMagnet(6, 3),
  discMagnet(8, 3),
  discMagnet(10, 2),
  discMagnet(10, 3),
  discMagnet(12, 2),
  sphereMagnet(5),
  sphereMagnet(8),
  sphereMagnet(12.7),
];

export function magnetById(id: string): MagnetSpec {
  return MAGNETS.find((m) => m.id === id) ?? MAGNETS[5];
}

export interface Material {
  id: string;
  label: string;
  /** Dichte in g/cm3 fuer die Gewichtsabschaetzung. */
  density: number;
  /** Typischer Duesendurchmesser-unabhaengiger Aufpreis pro kg in CHF. */
  pricePerKg: number;
  /** Empfohlene Wandstaerke-Untergrenze in mm. */
  minWall: number;
  flexible: boolean;
  notes: string;
}

export const MATERIALS: Material[] = [
  {
    id: 'pla',
    label: 'PLA',
    density: 1.24,
    pricePerKg: 22,
    minWall: 0.8,
    flexible: false,
    notes: 'Steif und masshaltig - die richtige Wahl fuer Grundplatten, Spinner-Koerper und Schalterplatten.',
  },
  {
    id: 'petg',
    label: 'PETG',
    density: 1.27,
    pricePerKg: 26,
    minWall: 1.0,
    flexible: false,
    notes: 'Zaeher als PLA und weniger sproede an duennen Clips. Etwas schwieriger sauber zu drucken.',
  },
  {
    id: 'abs',
    label: 'ABS / ASA',
    density: 1.04,
    pricePerKg: 28,
    minWall: 1.0,
    flexible: false,
    notes: 'Waermefest - sinnvoll, wenn das Fidget im Auto liegen soll. Braucht eine geschlossene Kammer.',
  },
  {
    id: 'tpu95',
    label: 'TPU 95A',
    density: 1.21,
    pricePerKg: 38,
    minWall: 0.8,
    flexible: true,
    notes: 'Der Allrounder unter den weichen Filamenten: fuer Pop-It-Membranen und feste Stressbaelle.',
  },
  {
    id: 'tpu85',
    label: 'TPU 85A',
    density: 1.16,
    pricePerKg: 45,
    minWall: 1.0,
    flexible: true,
    notes: 'Deutlich weicher, fast gummiartig. Ideal fuer Stressbaelle, aber nur mit Direktextruder und langsam druckbar.',
  },
  {
    id: 'silk',
    label: 'PLA Silk',
    density: 1.24,
    pricePerKg: 30,
    minWall: 0.8,
    flexible: false,
    notes: 'Glaenzende Oberflaeche. Mechanisch wie PLA, sieht bei Spinnern aber deutlich besser aus.',
  },
];

export function materialById(id: string): Material {
  return MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];
}

/** Herkunft der Kaufteile, die dieses Projekt ausgeloest haben. */
export const SOURCES = {
  domes: {
    label: 'Metall-Schnappkuppeln, 100 Stueck (5 / 6 / 7 / 8.4 / 10 / 12 / 14 mm)',
    price: 3.01,
    currency: 'CHF',
    quantity: 100,
    url: 'https://a.aliexpress.com/_EvOrf9y',
  },
  switches: {
    label: 'Blaue Clicky-Schalter, 3-Pin, DIY-Set',
    price: 18.24,
    currency: 'CHF',
    quantity: 40,
    url: 'https://a.aliexpress.com/_EI5oT9c',
  },
} as const;
