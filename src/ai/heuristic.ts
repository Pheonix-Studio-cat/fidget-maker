/**
 * Entwurf ohne KI.
 *
 * Wer keinen API-Schluessel hinterlegen will, bekommt trotzdem einen
 * brauchbaren Startpunkt: eine Stichwortsuche in der Beschreibung waehlt das
 * Fidget aus und setzt die naheliegenden Parameter. Das ist kein Ersatz fuer
 * die KI, deckt aber die haeufigen Wuensche ab und laeuft ohne Netz.
 */

import { modelById } from '../models/index.ts';
import { normalizeParams, type Params } from '../models/types.ts';
import type { DesignResult } from './designer.ts';

interface Rule {
  words: string[];
  apply: (p: Params) => void;
}

const MODEL_WORDS: { id: string; words: string[] }[] = [
  { id: 'spinner', words: ['spinner', 'kreisel', 'drehen', 'dreht', 'lager', 'rotier'] },
  { id: 'clicker', words: ['klick', 'clicker', 'schalter', 'switch', 'taste', 'tastatur', 'knopf'] },
  { id: 'stressball', words: ['ball', 'kugel', 'stress', 'kneten', 'knet', 'druecken', 'weich'] },
  { id: 'slider', words: ['slider', 'slyder', 'schieber', 'magnet', 'schiene', 'gleit'] },
  { id: 'popit', words: ['popit', 'pop it', 'pop-it', 'blase', 'blasen', 'noppen', 'dome', 'kuppel'] },
];

const SHAPE_WORDS: Record<string, string> = {
  herz: 'herz',
  heart: 'herz',
  stern: 'stern',
  star: 'stern',
  kreis: 'kreis',
  rund: 'kreis',
  circle: 'kreis',
  quadrat: 'squircle',
  rechteck: 'rechteck',
  sechseck: 'sechseck',
  hexagon: 'sechseck',
  achteck: 'achteck',
  dreieck: 'dreieck',
  blume: 'blume',
  flower: 'blume',
};

const COLOR_WORDS: Record<string, string> = {
  rot: '#c0392b',
  red: '#c0392b',
  blau: '#2f6f8f',
  blue: '#2f6f8f',
  gruen: '#3f8f5a',
  grün: '#3f8f5a',
  green: '#3f8f5a',
  gelb: '#e8c33d',
  yellow: '#e8c33d',
  orange: '#e8873d',
  lila: '#7d5ba6',
  violett: '#7d5ba6',
  purple: '#7d5ba6',
  rosa: '#e07a9c',
  pink: '#e07a9c',
  schwarz: '#2b2b2f',
  black: '#2b2b2f',
  weiss: '#eceff1',
  weiß: '#eceff1',
  white: '#eceff1',
  tuerkis: '#3aa8a0',
  türkis: '#3aa8a0',
};

function has(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

/**
 * Zahlwoerter zu Ziffern. "Ein Spinner mit vier Armen" ist die natuerlichere
 * Formulierung als "mit 4 Armen" - ohne diese Uebersetzung ginge die Angabe
 * verloren. Wortgrenzen verhindern, dass "sechseck" als "6" gelesen wird.
 */
const NUMBER_WORDS: Record<string, number> = {
  zwei: 2, drei: 3, vier: 4, fuenf: 5, fünf: 5, sechs: 6, sieben: 7, acht: 8,
  neun: 9, zehn: 10, elf: 11, zwoelf: 12, zwölf: 12,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

function digitsForWords(text: string): string {
  return text.replace(
    /\b(zwei|drei|vier|fuenf|fünf|sechs|sieben|acht|neun|zehn|elf|zwoelf|zwölf|two|three|four|five|six|seven|eight)\b/g,
    (word) => String(NUMBER_WORDS[word]),
  );
}

/** Zieht die erste Zahl heraus, die von einem der Stichworte begleitet wird. */
function numberNear(text: string, words: string[]): number | null {
  for (const w of words) {
    const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:mm\\s*)?${w}|${w}\\D{0,12}(\\d+(?:[.,]\\d+)?)`, 'i');
    const m = text.match(re);
    if (m) {
      const raw = m[1] ?? m[2];
      const value = Number(raw.replace(',', '.'));
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function heuristicDesign(prompt: string): DesignResult {
  const text = digitsForWords(prompt.toLowerCase());

  const picked = MODEL_WORDS.find((m) => has(text, m.words));
  const model = modelById(picked?.id ?? 'popit');
  const params: Params = { ...model.defaults };
  const notes: string[] = [];

  // --- Groesse ------------------------------------------------------------
  const scale = has(text, ['mini', 'winzig', 'sehr klein'])
    ? 0.55
    : has(text, ['klein', 'kompakt', 'taschen'])
      ? 0.75
      : has(text, ['riesig', 'xxl', 'sehr gross', 'sehr groß'])
        ? 1.5
        : has(text, ['gross', 'groß', 'xl'])
          ? 1.25
          : 1;
  if (scale !== 1) {
    notes.push(scale < 1 ? 'kleiner als die Vorgabe' : 'groesser als die Vorgabe');
    for (const key of ['width', 'height', 'length', 'diameter', 'armLength']) {
      if (typeof params[key] === 'number') params[key] = Math.round((params[key] as number) * scale);
    }
  }

  const explicit = numberNear(text, ['mm', 'millimeter', 'breit', 'durchmesser', 'lang']);
  if (explicit && explicit >= 20 && explicit <= 250) {
    if (typeof params.diameter === 'number') params.diameter = explicit;
    else if (typeof params.width === 'number') {
      const ratio = typeof params.height === 'number' ? (params.height as number) / (params.width as number) : 1;
      params.width = explicit;
      if (typeof params.height === 'number') params.height = Math.round(explicit * ratio);
    } else if (typeof params.length === 'number') params.length = explicit;
    notes.push(`${explicit} mm uebernommen`);
  }

  // --- Form ---------------------------------------------------------------
  for (const [word, shape] of Object.entries(SHAPE_WORDS)) {
    if (text.includes(word) && 'shape' in params) {
      params.shape = shape;
      notes.push(`Form ${shape}`);
      break;
    }
  }

  // --- Farben -------------------------------------------------------------
  const colorKeys = model.params.filter((d) => d.kind === 'color').map((d) => d.key);
  const found: string[] = [];
  for (const [word, hex] of Object.entries(COLOR_WORDS)) {
    if (text.includes(word) && !found.includes(hex)) found.push(hex);
  }
  found.forEach((hex, i) => {
    if (colorKeys[i]) params[colorKeys[i]] = hex;
  });
  if (found.length) notes.push('Farben aus der Beschreibung');

  // --- Modellspezifische Feinheiten --------------------------------------
  const rules: Rule[] = [
    {
      words: ['ohne kaufteile', 'ohne teile', 'nichts kaufen', 'sofort', 'nur drucken'],
      apply: (p) => {
        if (model.id === 'popit') p.mechanik = 'gedruckt';
        if (model.id === 'slider') p.magnetMode = 'keine';
        if (model.id === 'spinner') p.weightMode = 'keine';
        notes.push('ohne Kaufteile');
      },
    },
    {
      words: ['laut', 'knallig', 'satter klick', 'kraeftig'],
      apply: (p) => {
        if (model.id === 'popit') p.domeSize = 'd12';
        if (model.id === 'clicker') p.switchType = 'mx3';
        notes.push('lauter Klick');
      },
    },
    {
      words: ['leise', 'still', 'unauffaellig'],
      apply: (p) => {
        if (model.id === 'popit') {
          p.mechanik = 'gedruckt';
          notes.push('leise gedruckte Kuppeln');
        }
        if (model.id === 'clicker') {
          p.switchType = 'choc';
          notes.push('flache, leisere Schalter');
        }
      },
    },
    {
      words: ['viele blasen', 'moeglichst viele', 'so viele wie', 'maximal'],
      apply: (p) => {
        if (model.id === 'popit') {
          p.domeSize = 'd5';
          p.gapWall = 1.5;
          p.pattern = 'hex';
          notes.push('auf maximale Blasenzahl gestellt');
        }
      },
    },
    {
      words: ['schluessel', 'schlüssel', 'anhaenger', 'anhänger', 'keychain', 'rucksack'],
      apply: (p) => {
        if ('keyring' in p) {
          p.keyring = true;
          notes.push('mit Loch fuer den Schluesselring');
        }
      },
    },
    {
      words: ['sehr weich', 'ganz weich', 'wabbel'],
      apply: (p) => {
        if (model.id === 'stressball') {
          p.material = 'tpu85';
          p.wall = 1.0;
          notes.push('sehr weich');
        }
      },
    },
    {
      words: ['fest', 'hart', 'straff'],
      apply: (p) => {
        if (model.id === 'stressball') {
          p.wall = 2.6;
          notes.push('feste Wand');
        }
      },
    },
    {
      words: ['stachel', 'igel', 'spitz'],
      apply: (p) => {
        if (model.id === 'stressball') {
          p.surface = 'stacheln';
          notes.push('mit Stacheln');
        }
      },
    },
    {
      words: ['golf', 'dellen'],
      apply: (p) => {
        if (model.id === 'stressball') {
          p.surface = 'golf';
          notes.push('Golfball-Dellen');
        }
      },
    },
    {
      words: ['schweb', 'abstossen', 'abstoßen', 'repuls'],
      apply: (p) => {
        if (model.id === 'slider') {
          p.magnetMode = 'abstossen';
          notes.push('schwebender Wagen');
        }
      },
    },
    {
      words: ['lange laufzeit', 'laeuft lange', 'läuft lange', 'schwer'],
      apply: (p) => {
        if (model.id === 'spinner') {
          p.weightMode = 'magnete';
          p.armLength = 34;
          notes.push('auf lange Laufzeit ausgelegt');
        }
      },
    },
  ];

  for (const rule of rules) if (has(text, rule.words)) rule.apply(params);

  // Armzahl beim Spinner: "3 arme", "vierarmig"
  if (model.id === 'spinner') {
    const arms = numberNear(text, ['arm', 'arme', 'fluegel', 'flügel']);
    if (arms && arms >= 2 && arms <= 6) {
      params.arms = Math.round(arms);
      notes.push(`${Math.round(arms)} Arme`);
    }
  }
  // Schalterzahl beim Clicker
  if (model.id === 'clicker') {
    const n = numberNear(text, ['schalter', 'taste', 'tasten', 'knopf', 'knoepfe']);
    if (n && n >= 1 && n <= 16) {
      const cols = Math.min(4, Math.ceil(Math.sqrt(n)));
      params.cols = cols;
      params.rows = Math.max(1, Math.round(n / cols));
      notes.push(`${n} Schalter`);
    }
  }

  return {
    modelId: model.id,
    params: normalizeParams(model, params),
    name: `${model.name} nach deiner Beschreibung`,
    reason:
      notes.length > 0
        ? `Ohne KI erstellt: ${model.name} gewaehlt, ${notes.join(', ')}. Fuer feinere Entwuerfe einen API-Schluessel hinterlegen.`
        : `Ohne KI erstellt: ${model.name} mit den Vorgabewerten. In der Beschreibung standen keine Stichworte, die etwas anderes nahegelegt haetten - fuer feinere Entwuerfe einen API-Schluessel hinterlegen.`,
    source: 'heuristik',
  };
}
