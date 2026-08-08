/**
 * KI-Entwurf: aus Beschreibung und Bildern wird eine Fidget-Konfiguration.
 *
 * Die Antwort wird ueber Structured Outputs an das Schema aus `schema.ts`
 * gebunden - damit kommt garantiert ein Objekt zurueck, das zu den Reglern
 * der Oberflaeche passt, statt Text, den man erst muehsam auseinandernehmen
 * muesste.
 *
 * Der Schluessel bleibt im Browser des Nutzers. Das ist fuer ein Werkzeug,
 * das jemand lokal betreibt, in Ordnung - fuer eine oeffentliche Seite waere
 * ein kleiner Server davor die richtige Loesung, weil der Schluessel sonst
 * im Browser jedes Besuchers liegt.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS, modelById } from '../models/index.ts';
import { normalizeParams, type Params } from '../models/types.ts';
import { heuristicDesign } from './heuristic.ts';
import { buildDesignSchema, describeCatalog } from './schema.ts';

export interface DesignResult {
  modelId: string;
  params: Params;
  name: string;
  reason: string;
  source: 'ki' | 'heuristik';
}

export interface DesignImage {
  /** Reiner Base64-Inhalt, ohne data:-Praefix. */
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

export interface DesignRequest {
  prompt: string;
  images?: DesignImage[];
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
}

/** Auswahl fuer die Oberflaeche. Ohne Schluessel greift die Stichwortsuche. */
export const AI_MODELS = [
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    help: 'Beste Entwuerfe, versteht auch knappe oder widerspruechliche Wuensche.',
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    help: 'Deutlich guenstiger und schneller, fuer die meisten Wuensche voellig ausreichend.',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    help: 'Am schnellsten und billigsten. Gut fuer einfache Vorgaben.',
  },
] as const;

const SYSTEM_PROMPT = `Du bist der Entwurfsassistent eines Generators fuer 3D-druckbare Fidgets.

Aus der Beschreibung - und, falls vorhanden, den mitgeschickten Bildern -
waehlst du eines der verfuegbaren Fidgets aus und stellst seine Parameter so
ein, dass das Ergebnis zum Wunsch passt und sich gut drucken laesst.

Halte dich an diese Punkte:
- Setze nur Parameter, die vom Vorgabewert abweichen sollen. Alles andere
  bleibt auf der Vorgabe; ein vollstaendig ausgefuelltes Objekt ist nicht noetig.
- Bleibe innerhalb der angegebenen Bereiche.
- Bilder liefern vor allem Form, Farbe und Groessenverhaeltnis. Ein
  abfotografiertes Fidget muss nicht exakt nachgebaut werden - uebernimm das,
  was sich mit den vorhandenen Parametern ausdruecken laesst.
- Wenn der Wunsch mehrdeutig ist, entscheide dich fuer die Auslegung, die
  zuverlaessig druckbar ist, und erklaere die Wahl in einem Satz.
- Antworte auf Deutsch, ohne Umlaute in Parameterwerten.

Verfuegbare Fidgets und ihre Parameter:

${describeCatalog(MODELS)}`;

/**
 * Entwirft ein Fidget. Ohne API-Schluessel - oder wenn der Aufruf scheitert -
 * wird auf die Stichwortsuche zurueckgefallen, damit die Oberflaeche nie
 * ohne Ergebnis dasteht.
 */
export async function designFidget(req: DesignRequest): Promise<DesignResult> {
  if (!req.apiKey) return heuristicDesign(req.prompt);

  const client = new Anthropic({
    apiKey: req.apiKey,
    // Der Schluessel gehoert dem Nutzer und liegt in seinem Browser.
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const image of req.images ?? []) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data },
    });
  }
  content.push({ type: 'text', text: req.prompt.trim() || 'Ueberrasche mich mit einem schoenen Fidget.' });

  const model = req.model ?? AI_MODELS[0].id;
  const params = {
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content }],
    output_config: { format: { type: 'json_schema', schema: buildDesignSchema(MODELS) } },
    // Wird die Anfrage von den Sicherheitsfiltern abgelehnt, laeuft sie
    // serverseitig auf einem Ausweichmodell weiter, statt hier zu enden.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };

  const response = await client.beta.messages.create(
    params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming,
    { signal: req.signal },
  );

  if (response.stop_reason === 'refusal') {
    throw new Error(
      'Die Anfrage wurde abgelehnt. Formuliere die Beschreibung anders oder entwirf ohne KI weiter.',
    );
  }

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) throw new Error('Die KI hat keine verwertbare Antwort geliefert.');

  return parseDesign(text);
}

/** Prueft die Antwort und bringt sie in die Form, die die Generatoren erwarten. */
export function parseDesign(text: string): DesignResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Die Antwort der KI war kein gueltiges JSON.');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Die Antwort der KI hatte nicht die erwartete Struktur.');
  }

  const obj = raw as Record<string, unknown>;
  const modelId = typeof obj.modelId === 'string' ? obj.modelId : '';
  const known = MODELS.some((m) => m.id === modelId);
  const model = modelById(known ? modelId : 'popit');
  const incoming = (typeof obj.params === 'object' && obj.params !== null ? obj.params : {}) as Params;

  return {
    modelId: model.id,
    // normalizeParams begrenzt Werte und wirft alles weg, was nicht zu
    // diesem Modell gehoert - die KI kann damit nichts Ungueltiges bauen.
    params: normalizeParams(model, incoming),
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : model.name,
    reason: typeof obj.reason === 'string' ? obj.reason : '',
    source: 'ki',
  };
}
