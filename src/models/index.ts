/** Registrierung aller Fidget-Generatoren. */

import { popitModel } from './popit.ts';
import type { FidgetModel } from './types.ts';

export const MODELS: FidgetModel[] = [popitModel];

export function modelById(id: string): FidgetModel {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
