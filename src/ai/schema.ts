/**
 * Uebersetzt die Parameter-Schemata der Generatoren in ein JSON-Schema fuer
 * die KI.
 *
 * Es gibt damit weiterhin nur eine Quelle der Wahrheit: was die Oberflaeche
 * an Reglern zeigt, ist genau das, was die KI einstellen darf. Kommt ein
 * Parameter dazu, kennt die KI ihn ohne weiteres Zutun.
 */

import { MODELS } from '../models/index.ts';
import type { FidgetModel, ParamDef } from '../models/types.ts';

/** JSON-Schema-Typ eines Parameters. */
function jsonTypeOf(def: ParamDef): { type: string; enum?: string[] } {
  switch (def.kind) {
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'select':
      return { type: 'string', enum: def.options.map((o) => o.value) };
    case 'color':
      return { type: 'string' };
  }
}

export interface SchemaConflict {
  key: string;
  models: string[];
}

/**
 * Findet Parameter, die in mehreren Modellen denselben Namen, aber
 * unterschiedliche Typen haben. Solche Kollisionen liessen sich nicht in ein
 * gemeinsames Schema giessen - der Test schlaegt dann fehl, bevor es jemand
 * in der Oberflaeche merkt.
 */
export function findSchemaConflicts(models: FidgetModel[] = MODELS): SchemaConflict[] {
  const seen = new Map<string, { kind: string; models: string[] }>();
  for (const model of models) {
    for (const def of model.params) {
      const entry = seen.get(def.key);
      if (!entry) {
        seen.set(def.key, { kind: def.kind, models: [model.id] });
      } else {
        entry.models.push(model.id);
        if (entry.kind !== def.kind) entry.kind = 'KONFLIKT';
      }
    }
  }
  return [...seen.entries()]
    .filter(([, v]) => v.kind === 'KONFLIKT')
    .map(([key, v]) => ({ key, models: v.models }));
}

/**
 * Gemeinsames Schema ueber alle Modelle. Die KI waehlt ein Modell und
 * liefert einen Satz Parameter; alles, was nicht zum gewaehlten Modell
 * gehoert, faellt in `normalizeParams` von selbst weg.
 */
export function buildDesignSchema(models: FidgetModel[] = MODELS): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const model of models) {
    for (const def of model.params) {
      if (properties[def.key]) {
        // Auswahllisten aus mehreren Modellen zusammenfuehren, damit kein
        // gueltiger Wert verlorengeht.
        const existing = properties[def.key] as { enum?: string[] };
        const next = jsonTypeOf(def);
        if (existing.enum && next.enum) {
          existing.enum = [...new Set([...existing.enum, ...next.enum])];
        }
        continue;
      }
      properties[def.key] = {
        ...jsonTypeOf(def),
        description: `${def.label}${'unit' in def && def.unit ? ` (${def.unit})` : ''}${def.help ? ' - ' + def.help : ''}`,
      };
    }
  }

  return {
    type: 'object',
    properties: {
      modelId: {
        type: 'string',
        enum: models.map((m) => m.id),
        description: 'Welche Art Fidget gebaut werden soll.',
      },
      params: {
        type: 'object',
        properties,
        additionalProperties: false,
        description:
          'Nur die Parameter setzen, die zum gewaehlten Fidget gehoeren und vom Wunsch abweichen sollen. Alles andere bleibt auf den Vorgabewerten.',
      },
      reason: {
        type: 'string',
        description: 'Ein bis drei Saetze auf Deutsch: was gebaut wurde und warum diese Wahl.',
      },
      name: {
        type: 'string',
        description: 'Kurzer Name fuer den Entwurf, hoechstens vier Woerter.',
      },
    },
    required: ['modelId', 'params', 'reason', 'name'],
    additionalProperties: false,
  };
}

/** Beschreibung aller Modelle und ihrer Parameter fuer den Systemprompt. */
export function describeCatalog(models: FidgetModel[] = MODELS): string {
  const lines: string[] = [];
  for (const model of models) {
    lines.push(`## ${model.id} - ${model.name}`);
    lines.push(model.description);
    lines.push(`Kaufteile: ${model.requires}`);
    lines.push('Parameter:');
    let group = '';
    for (const def of model.params) {
      if (def.group !== group) {
        group = def.group;
        lines.push(`  ${group}:`);
      }
      const range =
        def.kind === 'number'
          ? ` [${def.min} bis ${def.max}${def.unit ? ' ' + def.unit : ''}, Vorgabe ${model.defaults[def.key]}]`
          : def.kind === 'select'
            ? ` [${def.options.map((o) => o.value).join(' | ')}, Vorgabe ${model.defaults[def.key]}]`
            : def.kind === 'boolean'
              ? ` [true | false, Vorgabe ${model.defaults[def.key]}]`
              : ' [Farbe als #rrggbb]';
      lines.push(`    ${def.key}: ${def.label}${range}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
