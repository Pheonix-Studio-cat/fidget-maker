/**
 * Gemeinsame Umrissformen. Pop-It, Clicker und Slider greifen auf dieselbe
 * Liste zu, damit die Formauswahl ueberall gleich heisst und gleich wirkt.
 */

import { insetPolygon, polygonInsetter } from '../geo/sdf2d.ts';
import {
  flower,
  polyArea,
  heart,
  polyBounds,
  regularPolygon,
  roundedPolygon,
  roundedRect,
  scalePoly,
  star,
  superellipse,
  type Poly,
} from '../geo/shapes2d.ts';
import type { ParamOption } from './types.ts';

export const SHAPE_OPTIONS: ParamOption[] = [
  { value: 'rechteck', label: 'Rechteck', help: 'Abgerundete Ecken, klassisch und platzsparend.' },
  { value: 'kreis', label: 'Kreis', help: 'Passt gut zu Ring- und Sonnenblumenmustern.' },
  { value: 'squircle', label: 'Squircle', help: 'Zwischen Kreis und Quadrat - viel Flaeche, weiche Kante.' },
  { value: 'sechseck', label: 'Sechseck', help: 'Fuegt sich nahtlos in das Wabenmuster ein.' },
  { value: 'achteck', label: 'Achteck', help: 'Kompakt mit acht Griffkanten.' },
  { value: 'dreieck', label: 'Dreieck', help: 'Abgerundetes gleichseitiges Dreieck.' },
  { value: 'herz', label: 'Herz', help: 'Beliebtes Geschenkformat.' },
  { value: 'stern', label: 'Stern', help: 'Sechs Zacken - weniger Blasen, dafuer auffaellig.' },
  { value: 'blume', label: 'Blume', help: 'Weiche Wellen am Rand.' },
];

export interface OutlineOptions {
  cornerRadius?: number;
  points?: number;
  innerRatio?: number;
  petals?: number;
}

/** Baut einen Umriss mit der geforderten Breite und Hoehe in mm. */
export function buildOutline(
  shape: string,
  width: number,
  height: number,
  opts: OutlineOptions = {},
): Poly {
  const w = Math.max(5, width);
  const h = Math.max(5, height);
  const r = Math.min(w, h) / 2;

  let poly: Poly;
  switch (shape) {
    case 'kreis':
      poly = superellipse(w, h, 2, 128);
      break;
    case 'squircle':
      poly = superellipse(w, h, 4, 128);
      break;
    case 'sechseck':
      poly = roundedPolygon(6, r, opts.cornerRadius ?? r * 0.12, Math.PI / 2);
      break;
    case 'achteck':
      poly = roundedPolygon(8, r, opts.cornerRadius ?? r * 0.12, Math.PI / 8);
      break;
    case 'dreieck':
      poly = roundedPolygon(3, r, opts.cornerRadius ?? r * 0.22, Math.PI / 2);
      break;
    case 'herz':
      poly = heart(w, 128);
      break;
    case 'stern':
      poly = star(opts.points ?? 6, r, r * (opts.innerRatio ?? 0.55));
      break;
    case 'blume':
      poly = flower(opts.petals ?? 8, r, 0.14, 180);
      break;
    case 'rechteck':
    default:
      poly = roundedRect(w, h, opts.cornerRadius ?? Math.min(w, h) * 0.12, 12);
      break;
  }

  return fitTo(poly, w, h);
}

/** Skaliert einen Umriss auf die gewuenschte Aussenabmessung. */
export function fitTo(poly: Poly, width: number, height: number): Poly {
  const b = polyBounds(poly);
  if (b.width <= 0 || b.height <= 0) return poly;
  const centered = poly.map(
    ([x, y]) => [x - (b.minX + b.maxX) / 2, y - (b.minY + b.maxY) / 2] as [number, number],
  );
  return scalePoly(centered, width / b.width, height / b.height);
}

/**
 * Verkleinerter Umriss fuer Rahmen, Wandungen und Deckel. Liefert den
 * groessten verbleibenden Ring oder null, wenn nichts uebrig bleibt.
 */
export function insetOutline(outline: Poly, delta: number): Poly | null {
  return pickLargest(insetPolygon(outline, delta));
}

/**
 * Wie `insetOutline`, aber fuer mehrere Betraege auf demselben Umriss -
 * das Abstandsfeld wird dabei nur einmal aufgebaut.
 */
export function outlineInsetter(outline: Poly): (delta: number) => Poly | null {
  const inset = polygonInsetter(outline);
  return (delta) => pickLargest(inset(delta));
}

function pickLargest(rings: Poly[]): Poly | null {
  return rings.find((r) => r.length >= 3 && polyArea(r) > 0) ?? null;
}

/** Ein Loch fuer Schluesselring oder Karabiner, am oberen Rand platziert. */
export function keyringHole(outline: Poly, diameter: number, inset: number): { hole: Poly; center: [number, number] } {
  const b = polyBounds(outline);
  const cy = b.maxY - inset;
  const cx = 0;
  return {
    hole: regularPolygon(24, diameter / 2).map(([x, y]) => [x + cx, y + cy] as [number, number]),
    center: [cx, cy],
  };
}
