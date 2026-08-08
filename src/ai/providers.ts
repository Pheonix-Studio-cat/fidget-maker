/**
 * Wer den Entwurf rechnet.
 *
 * Alle Anbieter ausser Anthropic sprechen das OpenAI-Protokoll
 * (`POST /chat/completions`), deshalb reicht eine Beschreibung pro Anbieter -
 * Adresse, Modelle, wo es den Schluessel gibt - und ein gemeinsamer Aufruf in
 * `designer.ts`.
 *
 * Anthropic ist absichtlich `hidden`: der Code bleibt vollstaendig erhalten,
 * die Auswahl taucht nur nicht mehr in der Oberflaeche auf. Ein `hidden: false`
 * genuegt, um sie zurueckzuholen.
 */

export interface AiModel {
  /** Modellkennung so, wie der Anbieter sie erwartet. */
  id: string;
  label: string;
  help: string;
}

export interface AiProvider {
  id: string;
  label: string;
  /** Protokoll: 'openai' fuer alles OpenAI-kompatible, 'anthropic' fuer Claude. */
  api: 'openai' | 'anthropic';
  /** Basisadresse ohne abschliessenden Schraegstrich (nur bei api: 'openai'). */
  baseUrl?: string;
  models: AiModel[];
  /** Anfang des Schluessels - dient als Platzhalter im Eingabefeld. */
  keyPrefix: string;
  /** Wo man den Schluessel bekommt. */
  keyUrl: string;
  /** Ein Satz zu Kosten und Eigenheiten, wird unter dem Feld angezeigt. */
  note: string;
  /** Ob der Anbieter mitgeschickte Bilder auswerten kann. */
  vision: boolean;
  /** Ausgeblendet: waehlbar bleibt es nur ueber den gespeicherten Wert. */
  hidden?: boolean;
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter (Llama 3)',
    api: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyPrefix: 'sk-or-v1-...',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Die Modelle mit "(gratis)" kosten nichts, sind dafuer im Durchsatz begrenzt. Ohne Guthaben laeuft sonst nichts.',
    vision: true,
    models: [
      {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        label: 'Llama 3.3 70B (gratis)',
        help: 'Das grosse Llama, kostenlos. Erste Wahl - versteht auch knappe Wuensche.',
      },
      {
        id: 'meta-llama/llama-3.3-70b-instruct',
        label: 'Llama 3.3 70B (bezahlt)',
        help: 'Dasselbe Modell ohne Warteschlange. Kostet Bruchteile eines Cents pro Entwurf.',
      },
      {
        id: 'meta-llama/llama-3.2-11b-vision-instruct:free',
        label: 'Llama 3.2 11B Vision (gratis)',
        help: 'Kleiner, versteht aber Bilder. Nimm es, wenn du Fotos als Vorlage mitschickst.',
      },
      {
        id: 'meta-llama/llama-3.1-8b-instruct:free',
        label: 'Llama 3.1 8B (gratis)',
        help: 'Am schnellsten. Reicht fuer klare Vorgaben wie "Spinner mit vier Armen".',
      },
    ],
  },
  {
    id: 'groq',
    label: 'Groq (Llama 3)',
    api: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyPrefix: 'gsk_...',
    keyUrl: 'https://console.groq.com/keys',
    note: 'Kostenloses Kontingent, sehr schnell. Bilder wertet Groq hier nicht aus - die Beschreibung zaehlt.',
    vision: false,
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B',
        help: 'Die beste Wahl bei Groq. Antwortet meist in unter zwei Sekunden.',
      },
      {
        id: 'llama-3.1-8b-instant',
        label: 'Llama 3.1 8B',
        help: 'Noch schneller, versteht dafuer weniger. Gut fuer einfache Vorgaben.',
      },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    api: 'anthropic',
    keyPrefix: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: 'Die besten Entwuerfe, kostet aber pro Anfrage. Zurzeit ausgeblendet.',
    vision: true,
    hidden: true,
    models: [
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
    ],
  },
];

/** Anbieter, die in der Oberflaeche zur Wahl stehen. */
export function visibleProviders(): AiProvider[] {
  return AI_PROVIDERS.filter((p) => !p.hidden);
}

export function providerById(id: string): AiProvider {
  return AI_PROVIDERS.find((p) => p.id === id) ?? visibleProviders()[0] ?? AI_PROVIDERS[0];
}

/**
 * Der Anbieter, mit dem gestartet wird. Ein gespeicherter, inzwischen
 * ausgeblendeter Anbieter faellt auf den ersten sichtbaren zurueck - sonst
 * stuende im Auswahlfeld ein Eintrag, den es dort nicht mehr gibt.
 */
export function defaultProvider(stored?: string | null): AiProvider {
  if (stored) {
    const found = AI_PROVIDERS.find((p) => p.id === stored);
    if (found && !found.hidden) return found;
  }
  return visibleProviders()[0] ?? AI_PROVIDERS[0];
}
