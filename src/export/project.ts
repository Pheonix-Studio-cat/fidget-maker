/**
 * Ausgabepaket fuer den Drucker.
 *
 * Es entstehen drei Dinge: eine 3MF-Datei mit allen Teilen fertig auf der
 * Platte angeordnet, dieselben Teile einzeln als STL, und eine Textdatei
 * mit Druckeinstellungen, Stueckliste und Montageanleitung. Damit laesst
 * sich der Druck ohne Rueckfrage an den Rechner starten.
 */

import { zipSync, strToU8 } from 'fflate';
import { Mesh } from '../geo/mesh.ts';
import { materialById } from '../catalog/parts.ts';
import type { BuildResult, FidgetModel, Params, Part } from '../models/types.ts';
import { meshToStl } from './stl.ts';
import { buildThreeMf, type ThreeMfObject } from './threemf.ts';

export interface PlateOptions {
  /** Nutzbare Breite der Druckplatte in mm. */
  width?: number;
  depth?: number;
  /** Abstand zwischen den Teilen in mm. */
  gap?: number;
}

export interface PlacedPart {
  part: Part;
  /** Laufende Nummer der Kopie, ab 1. */
  copy: number;
  offset: [number, number, number];
}

/**
 * Ordnet alle Teile nebeneinander an und bricht am Plattenrand um.
 *
 * Teile mit derselben `group` behalten ihre Lage zueinander - beim Slider
 * liegt der Wagen bereits in der Schiene und darf nicht verschoben werden.
 */
export function layoutParts(result: BuildResult, opts: PlateOptions = {}): PlacedPart[] {
  const plateW = opts.width ?? 250;
  const gap = opts.gap ?? 6;

  interface Unit {
    parts: Part[];
    width: number;
    depth: number;
    /** Verschiebung, die die Gruppe auf z=0 und in ihre eigene Mitte legt. */
    base: [number, number, number];
    copies: number;
  }

  const groups = new Map<string, Part[]>();
  for (const part of result.parts) {
    const key = part.group ?? `__${part.id}`;
    const list = groups.get(key);
    if (list) list.push(part);
    else groups.set(key, [part]);
  }

  const units: Unit[] = [];
  for (const parts of groups.values()) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const p of parts) {
      const b = p.mesh.bounds();
      minX = Math.min(minX, b.min[0]);
      minY = Math.min(minY, b.min[1]);
      minZ = Math.min(minZ, b.min[2]);
      maxX = Math.max(maxX, b.max[0]);
      maxY = Math.max(maxY, b.max[1]);
    }
    units.push({
      parts,
      width: maxX - minX,
      depth: maxY - minY,
      base: [-(minX + maxX) / 2, -(minY + maxY) / 2, -minZ],
      copies: Math.max(...parts.map((p) => p.copies)),
    });
  }

  const placed: PlacedPart[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowDepth = 0;

  const place = (unit: Unit, copy: number) => {
    if (cursorX > 0 && cursorX + unit.width > plateW) {
      cursorX = 0;
      cursorY += rowDepth + gap;
      rowDepth = 0;
    }
    const dx = cursorX + unit.width / 2;
    const dy = cursorY + unit.depth / 2;
    for (const part of unit.parts) {
      if (copy > part.copies) continue;
      placed.push({
        part,
        copy,
        offset: [unit.base[0] + dx, unit.base[1] + dy, unit.base[2]],
      });
    }
    cursorX += unit.width + gap;
    rowDepth = Math.max(rowDepth, unit.depth);
  };

  for (const unit of units) {
    for (let c = 1; c <= unit.copies; c++) place(unit, c);
  }

  // Alles gemeinsam auf die Plattenmitte schieben.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const item of placed) {
    const b = item.part.mesh.bounds();
    minX = Math.min(minX, b.min[0] + item.offset[0]);
    maxX = Math.max(maxX, b.max[0] + item.offset[0]);
    minY = Math.min(minY, b.min[1] + item.offset[1]);
    maxY = Math.max(maxY, b.max[1] + item.offset[1]);
  }
  const shiftX = -(minX + maxX) / 2;
  const shiftY = -(minY + maxY) / 2;
  for (const item of placed) {
    item.offset[0] += shiftX;
    item.offset[1] += shiftY;
  }

  return placed;
}

function safeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'teil';
}

/** Menschenlesbare Auflistung der eingestellten Werte. */
export function describeParams(model: FidgetModel, params: Params): string[] {
  const lines: string[] = [];
  let group = '';
  for (const def of model.params) {
    if (def.when && !def.when(params)) continue;
    const value = params[def.key];
    if (value == null) continue;
    if (def.group !== group) {
      group = def.group;
      lines.push(`  [${group}]`);
    }
    let shown: string;
    if (def.kind === 'select') {
      shown = def.options.find((o) => o.value === value)?.label ?? String(value);
    } else if (def.kind === 'boolean') {
      shown = value ? 'ja' : 'nein';
    } else if (def.kind === 'number') {
      shown = `${value}${def.unit ? ' ' + def.unit : ''}`;
    } else {
      shown = String(value);
    }
    lines.push(`    ${def.label}: ${shown}`);
  }
  return lines;
}

export function buildInstructions(
  model: FidgetModel,
  result: BuildResult,
  params: Params,
  placed: PlacedPart[],
): string {
  const L: string[] = [];
  const rule = '='.repeat(64);

  L.push(rule);
  L.push(`FIDGET MAKER  -  ${model.name}`);
  L.push(rule);
  L.push('');
  L.push(model.tagline);
  L.push('');
  L.push(`Erstellt am ${new Date().toLocaleString('de-CH')}`);
  L.push('');

  L.push('KENNZAHLEN');
  for (const s of result.stats) {
    L.push(`  ${s.label}: ${s.value}${s.hint ? `   (${s.hint})` : ''}`);
  }
  L.push('');

  L.push('EINSTELLUNGEN');
  L.push(...describeParams(model, params));
  L.push('');

  L.push('TEILE');
  for (const part of result.parts) {
    const mat = materialById(part.materialId);
    L.push(`  ${part.copies} x ${part.name}  -  ${mat.label}`);
    if (part.note) L.push(`      ${part.note}`);
  }
  L.push('');
  L.push(`  Alle Teile liegen in der 3MF-Datei bereits nebeneinander auf der Platte`);
  L.push(`  (${placed.length} Objekte insgesamt).`);
  L.push('');

  if (result.bom.length > 0) {
    L.push('KAUFTEILE');
    for (const item of result.bom) {
      L.push(`  ${item.qty} ${item.unit}  ${item.label}`);
      if (item.note) L.push(`      ${item.note}`);
      if (item.cost) L.push(`      Kosten ca. ${item.cost.toFixed(2)} CHF`);
      if (item.url) L.push(`      ${item.url}`);
    }
    L.push('');
  }

  L.push('DRUCKEINSTELLUNGEN');
  const pr = result.profile;
  L.push(`  Schichthoehe: ${pr.layerHeight} mm`);
  L.push(`  Wandlinien: ${pr.wallLoops}`);
  L.push(`  Fuellung: ${pr.infill} % (${pr.infillPattern})`);
  L.push(`  Stuetzen: ${pr.supports ? 'ja' : 'nein'}`);
  L.push(`  Brim: ${pr.brim ? 'ja' : 'nein'}`);
  for (const n of pr.notes) L.push(`  - ${n}`);
  if (pr.pauses.length > 0) {
    L.push('');
    L.push('  DRUCK ANHALTEN');
    for (const p of pr.pauses) {
      L.push(`  - bei ${p.z.toFixed(2)} mm Hoehe: ${p.reason}`);
    }
    L.push('  In Bambu Studio: Rechtsklick auf die Schicht im Vorschaubalken,');
    L.push('  dann "Pause einfuegen".');
  }
  L.push('');

  L.push('MONTAGE');
  result.steps.forEach((s, i) => L.push(`  ${i + 1}. ${s}`));
  L.push('');

  if (result.warnings.length > 0) {
    L.push('ZU BEACHTEN');
    for (const w of result.warnings) L.push(`  ! ${w}`);
    L.push('');
  }

  L.push(rule);
  L.push('Massangaben in Millimetern. Die 3MF-Datei traegt die Einheit mit;');
  L.push('beim Oeffnen darf nicht skaliert werden.');
  L.push(rule);
  return L.join('\n');
}

export interface ProjectFile {
  filename: string;
  data: Uint8Array;
}

/** Schnuert das komplette Paket als ZIP. */
export function exportProject(
  model: FidgetModel,
  result: BuildResult,
  params: Params,
  plate: PlateOptions = {},
): ProjectFile {
  const placed = layoutParts(result, plate);
  const base = safeName(model.name);

  const objects: ThreeMfObject[] = placed.map((item) => ({
    name: item.part.copies > 1 ? `${item.part.name} ${item.copy}` : item.part.name,
    mesh: item.part.mesh,
    offset: item.offset,
  }));

  const files: Record<string, Uint8Array> = {
    [`${base}.3mf`]: buildThreeMf(objects, {
      title: model.name,
      designer: 'Fidget Maker',
      description: model.tagline,
    }),
    'Anleitung.txt': strToU8(buildInstructions(model, result, params, placed)),
  };

  for (const part of result.parts) {
    const mesh = new Mesh();
    mesh.add(part.mesh);
    if (!part.group) mesh.centerOnBed();
    files[`STL/${safeName(part.name)}.stl`] = meshToStl(mesh, `${model.name} - ${part.name}`);
  }

  // Teile einer Gruppe gehoeren in eine Datei, sonst geht ihre Lage
  // zueinander verloren - beim Slider laege der Wagen dann neben der Schiene.
  const groups = new Map<string, Part[]>();
  for (const part of result.parts) {
    if (!part.group) continue;
    const list = groups.get(part.group);
    if (list) list.push(part);
    else groups.set(part.group, [part]);
  }
  for (const [name, parts] of groups) {
    const combined = new Mesh();
    for (const p of parts) combined.add(p.mesh);
    combined.centerOnBed();
    files[`STL/${safeName(name)}_zusammen.stl`] = meshToStl(combined, `${model.name} - ${name}`);
    for (const p of parts) delete files[`STL/${safeName(p.name)}.stl`];
  }

  return {
    filename: `${base}.zip`,
    data: zipSync(files, { level: 6 }),
  };
}
