/**
 * KI-Entwurf: aus Beschreibung und Bildern wird eine Fidget-Konfiguration.
 *
 * Zwei Wege fuehren zum selben Ergebnis:
 *
 * - Anbieter mit OpenAI-Protokoll (OpenRouter, Groq - dort laufen die
 *   Llama-Modelle). Das Schema geht als Text in den Systemprompt, die Antwort
 *   kommt als JSON-Objekt zurueck.
 * - Anthropic, ueber Structured Outputs. Zurzeit ausgeblendet, siehe
 *   `providers.ts`.
 *
 * Entscheidend ist in beiden Faellen nicht, wie brav das Modell antwortet,
 * sondern `parseDesign`: was dort herauskommt, ist immer eine baubare
 * Konfiguration - unbekannte Schluessel fliegen raus, Zahlen werden begrenzt.
 *
 * Der Schluessel bleibt im Browser des Nutzers. Das ist fuer ein Werkzeug,
 * das jemand fuer sich betreibt, in Ordnung - fuer eine oeffentliche Seite
 * waere ein kleiner Server davor die richtige Loesung.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS, modelById } from '../models/index.ts';
import { normalizeParams, type Params } from '../models/types.ts';
import { heuristicDesign } from './heuristic.ts';
import { buildDesignSchema, describeCatalog } from './schema.ts';
import { providerById, type AiProvider } from './providers.ts';

export {
  AI_PROVIDERS,
  defaultProvider,
  fetchModels,
  providerById,
  visibleProviders,
} from './providers.ts';
export type { AiModel, AiProvider } from './providers.ts';

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
  /** Anbieter-Kennung aus `providers.ts`. */
  provider?: string;
  /** Modellkennung beim Anbieter. */
  model?: string;
  signal?: AbortSignal;
}

const RULES = `Du bist der Entwurfsassistent eines Generators fuer 3D-druckbare Fidgets.

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

/** Systemprompt fuer Anthropic - dort haelt das Schema die Antwort in Form. */
const SYSTEM_PROMPT = RULES;

/**
 * Systemprompt fuer die OpenAI-kompatiblen Anbieter. Dort gibt es keine
 * garantierte Schema-Bindung, also steht das Schema im Text und die Regel,
 * ausschliesslich JSON zu liefern, direkt daneben.
 */
const OPENAI_SYSTEM_PROMPT = `${RULES}

Antworte ausschliesslich mit einem JSON-Objekt nach diesem Schema. Kein
Fliesstext davor oder danach, keine Code-Umrandung:

${JSON.stringify(buildDesignSchema(MODELS), null, 1)}`;

const FALLBACK_PROMPT = 'Ueberrasche mich mit einem schoenen Fidget.';

/**
 * Entwirft ein Fidget. Ohne API-Schluessel - oder wenn der Aufruf scheitert -
 * wird auf die Stichwortsuche zurueckgefallen, damit die Oberflaeche nie
 * ohne Ergebnis dasteht.
 */
export async function designFidget(req: DesignRequest): Promise<DesignResult> {
  if (!req.apiKey) return heuristicDesign(req.prompt);

  const provider = providerById(req.provider ?? '');
  const model = req.model?.trim() || provider.models[0].id;

  return provider.api === 'anthropic'
    ? designWithAnthropic(req, model)
    : designWithOpenAi(req, provider, model);
}

// --- OpenAI-Protokoll: OpenRouter, Groq ----------------------------------

async function designWithOpenAi(
  req: DesignRequest,
  provider: AiProvider,
  model: string,
): Promise<DesignResult> {
  const parts: unknown[] = [];
  if (provider.vision) {
    for (const image of req.images ?? []) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${image.mediaType};base64,${image.data}` },
      });
    }
  }
  parts.push({ type: 'text', text: req.prompt.trim() || FALLBACK_PROMPT });

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${req.apiKey}`,
      // OpenRouter zeigt den Titel in der Nutzungsuebersicht an. Der
      // Referer-Kopf laesst sich im Browser nicht setzen, deshalb nur der Titel.
      'x-title': 'Fidget Maker',
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: OPENAI_SYSTEM_PROMPT },
        { role: 'user', content: parts },
      ],
    }),
  });

  if (!response.ok) throw new Error(await describeHttpError(response, provider));

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (body.error?.message) throw new Error(`${provider.label}: ${body.error.message}`);

  const text = body.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('Die KI hat keine verwertbare Antwort geliefert.');

  return parseDesign(text);
}

/** Aus dem Fehlerkoerper einen Satz machen, mit dem der Nutzer etwas anfangen kann. */
async function describeHttpError(response: Response, provider: AiProvider): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string } | string };
    detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '');
  } catch {
    /* Fehlerkoerper war kein JSON - dann bleibt es beim Statuscode. */
  }

  if (response.status === 401 || response.status === 403) {
    return `${provider.label} hat den Schluessel abgelehnt. Stimmt er noch? Neu holen unter ${provider.keyUrl}`;
  }
  if (response.status === 402) {
    return `${provider.label} meldet zu wenig Guthaben. Waehle ein Modell mit "(gratis)" oder lade auf.`;
  }
  if (response.status === 404) {
    return `${provider.label} kennt dieses Modell nicht - die Kennung wurde vermutlich umbenannt. Druecke "Aktualisieren" neben der Modellauswahl, dann holt die App die aktuelle Liste beim Anbieter.`;
  }
  if (response.status === 429) {
    return `${provider.label} bremst gerade (zu viele Anfragen). Warte kurz oder nimm ein bezahltes Modell.`;
  }
  return `${provider.label} antwortet mit Fehler ${response.status}${detail ? `: ${detail}` : ''}`;
}

// --- Anthropic (ausgeblendet, aber funktionsfaehig) -----------------------

async function designWithAnthropic(req: DesignRequest, model: string): Promise<DesignResult> {
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
  content.push({ type: 'text', text: req.prompt.trim() || FALLBACK_PROMPT });

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

// --- Antwort auswerten ----------------------------------------------------

/**
 * Holt das JSON-Objekt aus der Antwort.
 *
 * Offene Modelle halten sich nicht immer an "nur JSON": mal steht eine
 * Code-Umrandung darum, mal ein einleitender Satz davor. Beides wird hier
 * abgeraeumt, statt die Anfrage daran scheitern zu lassen.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  if (body.startsWith('{')) return body;

  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first >= 0 && last > first) return body.slice(first, last + 1);

  return body;
}

/** Prueft die Antwort und bringt sie in die Form, die die Generatoren erwarten. */
export function parseDesign(text: string): DesignResult {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch {
    throw new Error('Die Antwort der KI war kein gueltiges JSON.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
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
