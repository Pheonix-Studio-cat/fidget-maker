/** Registrierung aller Fidget-Generatoren. */

import { clickerModel } from './clicker.ts';
import { popitModel } from './popit.ts';
import { sliderModel } from './slider.ts';
import { spinnerModel } from './spinner.ts';
import { stressballModel } from './stressball.ts';
import type { FidgetModel } from './types.ts';

export const MODELS: FidgetModel[] = [popitModel, clickerModel, stressballModel, sliderModel, spinnerModel];

export function modelById(id: string): FidgetModel {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
