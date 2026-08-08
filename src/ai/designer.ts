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
import { normalizeParams, type FidgetModel, type Params } from '../models/types.ts';
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
  /**
   * Wie viele Parameter von der Vorgabe abweichen. Bleibt das 0, hat die KI
   * nichts eingestellt und das Ergebnis ist schlicht die Voreinstellung -
   * das soll die Oberflaeche sagen koennen, statt es zu verschweigen.
   */
  changed: number;
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
- Antworte auf Deutsch, ohne Umlaute in Parameterwerten.`;

/**
 * Systemprompt fuer Anthropic. Dort bindet das Schema die Antwort, deshalb
 * darf hier der vollstaendige Katalog stehen - Claude kommt damit zurecht.
 */
const SYSTEM_PROMPT = `${RULES}

Verfuegbare Fidgets und ihre Parameter:

${describeCatalog(MODELS)}`;

/** Nur fuer Tests: die Auswahlfrage des ersten Schritts. */
export const choosePrompt = () => CHOOSE_PROMPT;

const FALLBACK_PROMPT = 'Ueberrasche mich mit einem schoenen Fidget.';

/**
 * Kurzuebersicht fuer die Auswahl: eine Zeile pro Fidget. Mehr braucht es
 * fuer die Frage "welches davon?" nicht, und weniger Text heisst bei
 * kleinen Modellen deutlich zuverlaessigere Antworten.
 */
const OVERVIEW = MODELS.map((m) => `${m.id}: ${m.name} - ${m.tagline}`).join('\n');

const CHOOSE_PROMPT = `Du hilfst beim Auswaehlen eines 3D-druckbaren Fidgets.

Diese Fidgets gibt es:
${OVERVIEW}

Antworte mit genau einer Kennung aus der linken Spalte - ein einziges Wort,
keine Erklaerung, keine Satzzeichen. Passt nichts eindeutig, waehle das, was
dem Wunsch am naechsten kommt.`;

/**
 * Systemprompt fuer den zweiten Schritt: nur noch die Parameter des bereits
 * gewaehlten Fidgets, dazu ein ausgefuelltes Beispiel.
 *
 * Frueher standen hier alle fuenf Fidgets und obendrein das komplette
 * JSON-Schema - zusammen rund 5500 Token. Kleine offene Modelle gehen darin
 * unter und liefern dann leere oder erfundene Parameter. Jetzt sind es je
 * nach Fidget ein paar hundert Token, und das Beispiel zeigt die Form der
 * Antwort, statt sie zu beschreiben.
 */
export function paramPrompt(model: FidgetModel): string {
  const beispiel = exampleFor(model);
  return `${RULES}

Das Fidget steht schon fest: ${model.id} (${model.name}).
Stelle nur noch seine Parameter ein.

${describeCatalog([model])}

Antworte ausschliesslich mit einem JSON-Objekt in genau dieser Form - kein
Fliesstext davor oder danach, keine Code-Umrandung:

{"params": ${JSON.stringify(beispiel.params)}, "name": "${beispiel.name}", "reason": "${beispiel.reason}"}

"params" enthaelt nur die Parameter, die vom Vorgabewert abweichen sollen.
"name" ist ein kurzer Name fuer das Ergebnis, "reason" ein Satz zur Begruendung.`;
}

/**
 * Ein ausgefuelltes Beispiel pro Fidget. Fuer kleine Modelle ist ein Beispiel
 * das wirksamste Mittel ueberhaupt - es zeigt Form, Umfang und Tonfall der
 * Antwort in einem Zug.
 */
export function exampleFor(model: FidgetModel): { params: Params; name: string; reason: string } {
  switch (model.id) {
    case 'popit':
      return {
        params: { shape: 'herz', width: 80, height: 75, domeSize: 'd6', keyring: true },
        name: 'Herz-Popit',
        reason: 'Herzform in Anhaengergroesse, kleine Kuppeln fuer viele Blasen.',
      };
    case 'clicker':
      return {
        params: { cols: 3, rows: 1, keycaps: true },
        name: 'Dreier-Clicker',
        reason: 'Drei Tasten nebeneinander, mit Tastenkappen zum Draufdruecken.',
      };
    case 'stressball':
      return {
        params: { diameter: 70, material: 'tpu85', surface: 'noppen' },
        name: 'Weicher Noppenball',
        reason: 'Weiches TPU und Noppen fuer griffiges, nachgiebiges Kneten.',
      };
    case 'slider':
      return {
        params: { length: 90, magnetMode: 'anziehen', magnet: 'm6x3' },
        name: 'Taschen-Slider',
        reason: 'Kurze Schiene, der Wagen rastet an beiden Enden magnetisch ein.',
      };
    default:
      return {
        params: { arms: 4, armLength: 30, weightMode: 'lager' },
        name: 'Vierarm-Spinner',
        reason: 'Vier Arme mit Lagern aussen, laeuft dadurch lange nach.',
      };
  }
}

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

/**
 * Zwei kleine Fragen statt einer grossen.
 *
 * Erst "welches Fidget?" - dafuer genuegen fuenf Zeilen Uebersicht. Dann
 * "welche Parameter?" - dafuer zaehlen nur noch die des gewaehlten Fidgets.
 * Jeder Schritt sieht damit einen Bruchteil des frueheren Prompts, und beide
 * Fragen sind fuer sich genommen einfach. Auf einem 8B-Modell ist das der
 * Unterschied zwischen brauchbar und unbrauchbar.
 */
async function designWithOpenAi(
  req: DesignRequest,
  provider: AiProvider,
  model: string,
): Promise<DesignResult> {
  const wunsch = req.prompt.trim() || FALLBACK_PROMPT;
  const bilder: unknown[] = [];
  if (provider.vision) {
    for (const image of req.images ?? []) {
      bilder.push({
        type: 'image_url',
        image_url: { url: `data:${image.mediaType};base64,${image.data}` },
      });
    }
  }
  const frage = (text: string) => [...bilder, { type: 'text', text }];

  // Schritt 1: das Fidget waehlen.
  const gewaehlt = await chat(req, provider, model, {
    system: CHOOSE_PROMPT,
    content: frage(wunsch),
    maxTokens: 16,
  });
  const fidget = modelById(matchModelId(gewaehlt) ?? heuristicDesign(wunsch).modelId);

  // Schritt 2: die Parameter dieses einen Fidgets einstellen.
  const antwort = await chat(req, provider, model, {
    system: paramPrompt(fidget),
    content: frage(wunsch),
    maxTokens: 1024,
    json: true,
  });

  return parseDesign(antwort, fidget.id);
}

/**
 * Sucht in einer freien Antwort die Fidget-Kennung.
 *
 * Kleine Modelle antworten trotz klarer Ansage gern mit "Das waere ein
 * spinner." statt nur "spinner" - deshalb wird gesucht statt verglichen.
 */
function matchModelId(text: string): string | null {
  const lower = text.toLowerCase();
  for (const m of MODELS) {
    if (new RegExp(`\\b${m.id}\\b`).test(lower)) return m.id;
  }
  return null;
}

interface ChatOptions {
  system: string;
  content: unknown[];
  maxTokens: number;
  json?: boolean;
}

async function chat(
  req: DesignRequest,
  provider: AiProvider,
  model: string,
  options: ChatOptions,
): Promise<string> {
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
      // Niedrig, damit die Form der Antwort verlaesslich bleibt. Die
      // Gestaltungsfreiheit steckt in den Parametern, nicht im Wortlaut.
      temperature: 0.2,
      max_tokens: options.maxTokens,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.content },
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
  return text;
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

/**
 * Prueft die Antwort und bringt sie in die Form, die die Generatoren erwarten.
 *
 * `known` ist das im ersten Schritt gewaehlte Fidget. Ist es gesetzt, gilt
 * es - der zweite Schritt sollte das Fidget gar nicht mehr aendern.
 */
export function parseDesign(text: string, known?: string): DesignResult {
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
  const genannt = typeof obj.modelId === 'string' ? obj.modelId : '';
  const modelId = known ?? genannt;
  const model = modelById(MODELS.some((m) => m.id === modelId) ? modelId : 'popit');
  const incoming = (typeof obj.params === 'object' && obj.params !== null ? obj.params : {}) as Params;

  const params = normalizeParams(model, incoming);
  return {
    modelId: model.id,
    // normalizeParams begrenzt Werte und wirft alles weg, was nicht zu
    // diesem Modell gehoert - die KI kann damit nichts Ungueltiges bauen.
    params,
    changed: Object.keys(model.defaults).filter((k) => params[k] !== model.defaults[k]).length,
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : model.name,
    reason: typeof obj.reason === 'string' ? obj.reason : '',
    source: 'ki',
  };
}
