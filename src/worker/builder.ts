/**
 * Rechenknecht im Hintergrund.
 *
 * Ein Pop-It mit 200 Blasen braucht einige hundert Millisekunden. Im
 * Hauptfaden wuerde das die Oberflaeche bei jedem Reglerzug einfrieren,
 * deshalb laeuft der ganze Aufbau hier. Zurueck geht nur, was die Anzeige
 * braucht: die Dreiecke als Float32Array (uebertragen, nicht kopiert) und
 * die Kennzahlen als Text.
 *
 * Der Export bleibt ebenfalls hier, weil dafuer die vollstaendigen Netze
 * gebraucht werden - die liegen nur in diesem Faden.
 */

import { MODELS, modelById } from '../models/index.ts';
import { normalizeParams, type BuildResult, type Params } from '../models/types.ts';
import { exportProject, type PlateOptions } from '../export/project.ts';

export interface PartPayload {
  id: string;
  name: string;
  copies: number;
  materialId: string;
  color: string;
  note?: string;
  group?: string;
  positions: Float32Array;
  triangles: number;
  /** Aussenmasse in mm. */
  size: [number, number, number];
  volume: number;
}

export type WorkerRequest =
  | { type: 'build'; requestId: number; modelId: string; params: Params }
  | { type: 'export'; requestId: number; plate?: PlateOptions };

export type WorkerResponse =
  | {
      type: 'built';
      requestId: number;
      modelId: string;
      params: Params;
      parts: PartPayload[];
      stats: BuildResult['stats'];
      bom: BuildResult['bom'];
      steps: string[];
      warnings: string[];
      profile: BuildResult['profile'];
      durationMs: number;
    }
  | { type: 'exported'; requestId: number; filename: string; data: Uint8Array }
  | { type: 'failed'; requestId: number; message: string };

interface Held {
  modelId: string;
  params: Params;
  result: BuildResult;
}

let held: Held | null = null;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'build') {
      const model = modelById(msg.modelId);
      const params = normalizeParams(model, msg.params);
      const started = performance.now();
      const result = model.build(params);
      held = { modelId: model.id, params, result };

      const parts: PartPayload[] = result.parts.map((part) => {
        const b = part.mesh.bounds();
        return {
          id: part.id,
          name: part.name,
          copies: part.copies,
          materialId: part.materialId,
          color: part.color,
          note: part.note,
          group: part.group,
          positions: Float32Array.from(part.mesh.positions),
          triangles: part.mesh.triangleCount,
          size: [b.size[0], b.size[1], b.size[2]],
          volume: part.mesh.volume(),
        };
      });

      const response: WorkerResponse = {
        type: 'built',
        requestId: msg.requestId,
        modelId: model.id,
        params,
        parts,
        stats: result.stats,
        bom: result.bom,
        steps: result.steps,
        warnings: result.warnings,
        profile: result.profile,
        durationMs: Math.round(performance.now() - started),
      };
      (self as unknown as Worker).postMessage(
        response,
        parts.map((p) => p.positions.buffer),
      );
      return;
    }

    if (msg.type === 'export') {
      if (!held) throw new Error('Es liegt noch kein gebautes Modell zum Exportieren vor.');
      const model = modelById(held.modelId);
      const file = exportProject(model, held.result, held.params, msg.plate ?? {});
      const response: WorkerResponse = {
        type: 'exported',
        requestId: msg.requestId,
        filename: file.filename,
        data: file.data,
      };
      (self as unknown as Worker).postMessage(response, [file.data.buffer]);
    }
  } catch (error) {
    const response: WorkerResponse = {
      type: 'failed',
      requestId: msg.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
};

// Beim Start einmal melden, welche Modelle es gibt - so muss die Oberflaeche
// die Generatoren nicht selbst laden.
export const MODEL_IDS = MODELS.map((m) => m.id);
