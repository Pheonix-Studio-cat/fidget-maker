/**
 * Bedienelemente aus dem Parameter-Schema.
 *
 * Die Oberflaeche kennt keine Fidget-Details: sie liest das Schema des
 * gewaehlten Modells und baut daraus Regler, Auswahllisten und Schalter.
 * Ein neuer Parameter im Generator erscheint hier ohne weiteres Zutun.
 */

import type { FidgetModel, ParamDef, Params, ParamValue } from '../models/types.ts';

export type ChangeHandler = (key: string, value: ParamValue) => void;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildNumber(def: Extract<ParamDef, { kind: 'number' }>, value: number, onChange: ChangeHandler): HTMLElement {
  const row = el('div', 'ctl ctl--number');

  const head = el('div', 'ctl__head');
  head.append(el('label', 'ctl__label', def.label));
  const readout = el('input', 'ctl__value') as HTMLInputElement;
  readout.type = 'number';
  readout.min = String(def.min);
  readout.max = String(def.max);
  readout.step = String(def.step);
  readout.value = String(value);
  readout.setAttribute('aria-label', `${def.label} als Zahl`);
  head.append(readout);
  if (def.unit) head.append(el('span', 'ctl__unit', def.unit));
  row.append(head);

  const slider = el('input', 'ctl__slider') as HTMLInputElement;
  slider.type = 'range';
  slider.min = String(def.min);
  slider.max = String(def.max);
  slider.step = String(def.step);
  slider.value = String(value);
  slider.setAttribute('aria-label', def.label);
  row.append(slider);

  const clamp = (raw: number): number => Math.min(def.max, Math.max(def.min, raw));
  slider.addEventListener('input', () => {
    readout.value = slider.value;
    onChange(def.key, Number(slider.value));
  });
  readout.addEventListener('change', () => {
    const v = clamp(Number(readout.value));
    readout.value = String(v);
    slider.value = String(v);
    onChange(def.key, v);
  });

  return row;
}

function buildSelect(def: Extract<ParamDef, { kind: 'select' }>, value: string, onChange: ChangeHandler): HTMLElement {
  const row = el('div', 'ctl');
  row.append(el('label', 'ctl__label', def.label));

  const select = el('select', 'ctl__select') as HTMLSelectElement;
  for (const opt of def.options) {
    const option = el('option') as HTMLOptionElement;
    option.value = opt.value;
    option.textContent = opt.label;
    select.append(option);
  }
  select.value = value;
  row.append(select);

  const hint = el('p', 'ctl__hint');
  const setHint = (): void => {
    hint.textContent = def.options.find((o) => o.value === select.value)?.help ?? '';
    hint.hidden = !hint.textContent;
  };
  setHint();
  row.append(hint);

  select.addEventListener('change', () => {
    setHint();
    onChange(def.key, select.value);
  });
  return row;
}

function buildBoolean(def: Extract<ParamDef, { kind: 'boolean' }>, value: boolean, onChange: ChangeHandler): HTMLElement {
  const row = el('label', 'ctl ctl--switch');
  const input = el('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = value;
  row.append(input, el('span', 'ctl__label', def.label));
  input.addEventListener('change', () => onChange(def.key, input.checked));
  return row;
}

function buildColor(def: Extract<ParamDef, { kind: 'color' }>, value: string, onChange: ChangeHandler): HTMLElement {
  const row = el('label', 'ctl ctl--color');
  row.append(el('span', 'ctl__label', def.label));
  const input = el('input', 'ctl__colorpick') as HTMLInputElement;
  input.type = 'color';
  input.value = value;
  row.append(input);
  input.addEventListener('input', () => onChange(def.key, input.value));
  return row;
}

function buildControl(def: ParamDef, value: ParamValue, onChange: ChangeHandler): HTMLElement | null {
  switch (def.kind) {
    case 'number':
      return buildNumber(def, typeof value === 'number' ? value : def.min, onChange);
    case 'select':
      return buildSelect(def, typeof value === 'string' ? value : def.options[0].value, onChange);
    case 'boolean':
      return buildBoolean(def, value === true, onChange);
    case 'color':
      return buildColor(def, typeof value === 'string' ? value : '#888888', onChange);
    default:
      return null;
  }
}

/**
 * Baut das komplette Panel neu. Parameter, die in der aktuellen
 * Konfiguration nichts bewirken, werden weggelassen - eine Membranstaerke
 * ohne Membran waere nur Ballast.
 */
export function renderControls(
  container: HTMLElement,
  model: FidgetModel,
  params: Params,
  onChange: ChangeHandler,
): void {
  container.replaceChildren();

  const groups = new Map<string, ParamDef[]>();
  for (const def of model.params) {
    if (def.when && !def.when(params)) continue;
    const list = groups.get(def.group);
    if (list) list.push(def);
    else groups.set(def.group, [def]);
  }

  for (const [name, defs] of groups) {
    const section = el('details', 'group') as HTMLDetailsElement;
    section.open = true;
    section.append(el('summary', 'group__title', name));

    const body = el('div', 'group__body');
    for (const def of defs) {
      const control = buildControl(def, params[def.key], onChange);
      if (!control) continue;
      if (def.help && def.kind !== 'select') {
        const hint = el('p', 'ctl__hint', def.help);
        control.append(hint);
      }
      body.append(control);
    }
    section.append(body);
    container.append(section);
  }
}
