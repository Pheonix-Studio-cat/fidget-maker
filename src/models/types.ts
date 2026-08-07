/**
 * Vertrag zwischen Generator, Oberflaeche und KI.
 *
 * Jedes Fidget beschreibt seine Parameter als Schema. Daraus baut die
 * Oberflaeche ihre Bedienelemente, und die KI bekommt dasselbe Schema als
 * Beschreibung dessen, was sie einstellen darf. Es gibt damit nur eine
 * Wahrheit ueber die Parameter eines Modells.
 */

import type { Mesh } from '../geo/mesh.ts';

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface ParamOption {
  value: string;
  label: string;
  help?: string;
}

interface ParamBase {
  key: string;
  label: string;
  help?: string;
  /** Abschnitt in der Oberflaeche. */
  group: string;
  /** Blendet den Parameter aus, wenn er in der aktuellen Konfiguration nichts bewirkt. */
  when?: (p: Params) => boolean;
}

export type ParamDef =
  | (ParamBase & { kind: 'number'; min: number; max: number; step: number; unit?: string })
  | (ParamBase & { kind: 'select'; options: ParamOption[] })
  | (ParamBase & { kind: 'boolean' })
  | (ParamBase & { kind: 'color' });

/** Ein druckbares Einzelteil. */
export interface Part {
  id: string;
  name: string;
  mesh: Mesh;
  /** Wie oft das Teil gedruckt werden muss. */
  copies: number;
  materialId: string;
  /** Vorschaufarbe im Viewer. */
  color: string;
  note?: string;
}

/** Zeile der Stueckliste - alles, was nicht gedruckt, sondern gekauft wird. */
export interface BomItem {
  label: string;
  qty: number;
  unit: string;
  note?: string;
  url?: string;
  /** Geschaetzte Kosten in CHF. */
  cost?: number;
}

export interface PausePoint {
  /** Hoehe ueber dem Druckbett in mm. */
  z: number;
  reason: string;
}

export interface PrintProfile {
  layerHeight: number;
  wallLoops: number;
  /** Fuelldichte in Prozent. */
  infill: number;
  infillPattern: string;
  supports: boolean;
  brim: boolean;
  notes: string[];
  /** Hoehen, auf denen der Druck fuer das Einlegen von Teilen anhalten sollte. */
  pauses: PausePoint[];
}

export interface Stat {
  label: string;
  value: string;
  hint?: string;
}

export interface BuildResult {
  parts: Part[];
  stats: Stat[];
  bom: BomItem[];
  /** Montageanleitung, Schritt fuer Schritt. */
  steps: string[];
  warnings: string[];
  profile: PrintProfile;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  params: Params;
}

export interface FidgetModel {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Kurzer Hinweis darauf, welche Kaufteile gebraucht werden. */
  requires: string;
  params: ParamDef[];
  defaults: Params;
  presets: Preset[];
  build(params: Params): BuildResult;
}

export function num(p: Params, key: string, fallback = 0): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(p: Params, key: string, fallback = ''): string {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
}

export function bool(p: Params, key: string, fallback = false): boolean {
  const v = p[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** Fuellt fehlende Werte aus den Vorgaben und wirft unbekannte Schluessel weg. */
export function normalizeParams(model: FidgetModel, input: Params): Params {
  const out: Params = { ...model.defaults };
  for (const def of model.params) {
    const v = input[def.key];
    if (v == null) continue;
    if (def.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) {
      out[def.key] = Math.min(def.max, Math.max(def.min, v));
    } else if (def.kind === 'select' && typeof v === 'string') {
      if (def.options.some((o) => o.value === v)) out[def.key] = v;
    } else if (def.kind === 'boolean' && typeof v === 'boolean') {
      out[def.key] = v;
    } else if (def.kind === 'color' && typeof v === 'string') {
      if (/^#[0-9a-fA-F]{6}$/.test(v)) out[def.key] = v;
    }
  }
  return out;
}

export function gramFor(volumeMm3: number, density: number): number {
  return (volumeMm3 / 1000) * density;
}
