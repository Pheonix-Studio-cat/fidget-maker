/**
 * Zusammenbau der Oberflaeche.
 *
 * Der Ablauf ist immer derselbe: Parameter aendern -> Auftrag an den
 * Hintergrundfaden -> Antwort in Viewer und Panels einspielen. Gerechnet
 * wird nie im Hauptfaden, damit die Regler auch bei einem Pop-It mit 200
 * Blasen fluessig bleiben.
 */

import { MODELS, modelById } from '../models/index.ts';
import { normalizeParams, type FidgetModel, type Params, type ParamValue } from '../models/types.ts';
import { materialById } from '../catalog/parts.ts';
import {
  defaultProvider,
  designFidget,
  fetchModels,
  providerById,
  visibleProviders,
  type AiModel,
  type AiProvider,
  type DesignImage,
} from '../ai/designer.ts';
import type { PartPayload, WorkerRequest, WorkerResponse } from '../worker/builder.ts';
import { renderControls } from './controls.ts';
import { Viewer } from './viewer.ts';

/** Schluessel liegen pro Anbieter, damit ein Wechsel den anderen nicht loescht. */
const KEY_STORAGE = 'fidget-maker.apiKey';
const PROVIDER_STORAGE = 'fidget-maker.aiProvider';
const MODEL_STORAGE = 'fidget-maker.aiModel';
const CUSTOM_MODEL_STORAGE = 'fidget-maker.aiModelCustom';

const MODEL_LIST_STORAGE = 'fidget-maker.aiModels';

const keyStorageFor = (provider: string) => `${KEY_STORAGE}.${provider}`;
const modelListStorageFor = (provider: string) => `${MODEL_LIST_STORAGE}.${provider}`;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} fehlt im HTML.`);
  return node as T;
}

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

/** Omit ueber eine Union hinweg, sonst verliert der Typ seinen Diskriminator. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Duenne Huelle um den Worker: haelt Auftragsnummern auseinander. */
class BuildService {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('../worker/builder.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const entry = this.pending.get(event.data.requestId);
      if (!entry) return;
      this.pending.delete(event.data.requestId);
      if (event.data.type === 'failed') entry.reject(new Error(event.data.message));
      else entry.resolve(event.data);
    };
    this.worker.onerror = (event) => {
      for (const entry of this.pending.values()) entry.reject(new Error(event.message));
      this.pending.clear();
    };
  }

  private send(request: DistributiveOmit<WorkerRequest, 'requestId'>): Promise<WorkerResponse> {
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ ...request, requestId } as WorkerRequest);
    });
  }

  async build(modelId: string, params: Params) {
    const res = await this.send({ type: 'build', modelId, params });
    if (res.type !== 'built') throw new Error('Unerwartete Antwort beim Bauen.');
    return res;
  }

  async exportProject() {
    const res = await this.send({ type: 'export' });
    if (res.type !== 'exported') throw new Error('Unerwartete Antwort beim Export.');
    return res;
  }
}

type Built = Extract<WorkerResponse, { type: 'built' }>;

export class App {
  private readonly service = new BuildService();
  private readonly viewer: Viewer;
  private model: FidgetModel = MODELS[0];
  private readonly paramsByModel = new Map<string, Params>();
  private buildToken = 0;
  private rebuildTimer = 0;
  private readonly hidden = new Set<string>();
  private readonly thumbnails = new Map<string, string>();
  private images: DesignImage[] = [];

  constructor() {
    this.viewer = new Viewer(byId<HTMLCanvasElement>('view'));
    for (const model of MODELS) this.paramsByModel.set(model.id, { ...model.defaults });

    this.buildTabs();
    this.wireStage();
    this.wireOverlays();
    this.wireAi();
    byId('btn-export').addEventListener('click', () => void this.exportProject());

    this.selectModel(MODELS[0].id);
  }

  // --- Kopfzeile ---------------------------------------------------------

  private buildTabs(): void {
    const tabs = byId('tabs');
    tabs.replaceChildren();
    for (const model of MODELS) {
      const tab = el('button', 'tab', model.name);
      tab.type = 'button';
      tab.dataset.model = model.id;
      tab.addEventListener('click', () => this.selectModel(model.id));
      tabs.append(tab);
    }
  }

  private markActiveTab(): void {
    for (const tab of byId('tabs').querySelectorAll<HTMLButtonElement>('.tab')) {
      tab.setAttribute('aria-current', String(tab.dataset.model === this.model.id));
    }
  }

  private selectModel(id: string): void {
    this.model = modelById(id);
    this.hidden.clear();
    this.markActiveTab();
    byId('model-name').textContent = this.model.name;
    byId('model-tagline').textContent = this.model.description;
    this.renderPresets();
    this.renderControlPanel();
    this.requestBuild(0);
  }

  private get params(): Params {
    return this.paramsByModel.get(this.model.id) ?? { ...this.model.defaults };
  }

  private setParams(next: Params): void {
    this.paramsByModel.set(this.model.id, next);
  }

  // --- Linke Spalte ------------------------------------------------------

  private renderPresets(): void {
    const host = byId('presets');
    host.replaceChildren();
    for (const preset of this.model.presets) {
      const button = el('button', 'preset', preset.name);
      button.type = 'button';
      button.title = preset.description;
      button.addEventListener('click', () => {
        this.setParams(normalizeParams(this.model, preset.params));
        this.renderControlPanel();
        this.requestBuild(0);
      });
      host.append(button);
    }
    const reset = el('button', 'preset', 'Zuruecksetzen');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.setParams({ ...this.model.defaults });
      this.renderControlPanel();
      this.requestBuild(0);
    });
    host.append(reset);
  }

  private renderControlPanel(): void {
    renderControls(byId('controls'), this.model, this.params, (key, value) => {
      this.onParamChange(key, value);
    });
  }

  private onParamChange(key: string, value: ParamValue): void {
    const next = { ...this.params, [key]: value };
    this.setParams(normalizeParams(this.model, next));

    // Manche Parameter blenden andere ein oder aus - dann muss das Panel neu
    // gezeichnet werden, sonst bleiben tote Regler stehen.
    const affectsVisibility = this.model.params.some((d) => d.when && d.key !== key);
    if (affectsVisibility) this.renderControlPanel();

    this.requestBuild(160);
  }

  // --- Buehne ------------------------------------------------------------

  private wireStage(): void {
    byId('btn-frame').addEventListener('click', () => this.viewer.frameAll());
    const explode = byId<HTMLInputElement>('explode');
    explode.addEventListener('input', () => this.viewer.setExplode(Number(explode.value)));
  }

  private renderPartToggles(parts: PartPayload[]): void {
    const host = byId('part-toggles');
    host.replaceChildren();
    for (const part of parts) {
      const chip = el('button', 'chip');
      chip.type = 'button';
      const visible = !this.hidden.has(part.id);
      chip.setAttribute('aria-pressed', String(visible));

      const dot = el('span', 'chip__dot');
      dot.style.background = part.color;
      chip.append(dot, document.createTextNode(part.copies > 1 ? `${part.name} x${part.copies}` : part.name));

      chip.addEventListener('click', () => {
        const nowVisible = this.hidden.has(part.id);
        if (nowVisible) this.hidden.delete(part.id);
        else this.hidden.add(part.id);
        chip.setAttribute('aria-pressed', String(nowVisible));
        this.viewer.setPartVisible(part.id, nowVisible);
      });
      host.append(chip);
    }
  }

  private setStatus(text: string, busy = false): void {
    const node = byId('status');
    node.textContent = text;
    node.dataset.busy = String(busy);
  }

  // --- Bauen -------------------------------------------------------------

  private requestBuild(delay: number): void {
    clearTimeout(this.rebuildTimer);
    // Sofort auf "rechnet" stellen, nicht erst wenn der Auftrag rausgeht:
    // sonst zeigt die Anzeige waehrend der Wartezeit noch das alte Ergebnis,
    // und alles, was auf sie schaut, liest veraltete Werte.
    this.setStatus('wird berechnet ...', true);
    this.rebuildTimer = window.setTimeout(() => void this.build(), delay);
  }

  private async build(): Promise<void> {
    const token = ++this.buildToken;
    this.setStatus('wird berechnet ...', true);
    try {
      const result = await this.service.build(this.model.id, this.params);
      if (token !== this.buildToken) return; // eine neuere Anfrage hat uebernommen
      this.applyResult(result);
    } catch (error) {
      if (token !== this.buildToken) return;
      this.setStatus(error instanceof Error ? error.message : 'Fehler beim Bauen');
    }
  }

  private applyResult(result: Built): void {
    this.viewer.setParts(result.parts);
    for (const id of this.hidden) this.viewer.setPartVisible(id, false);
    this.renderPartToggles(result.parts);
    this.renderStats(result);
    this.renderWarnings(result.warnings);
    this.renderBom(result);
    this.renderSteps(result);

    const triangles = result.parts.reduce((sum, p) => sum + p.triangles * p.copies, 0);
    this.setStatus(`${result.parts.length} Teile, ${(triangles / 1000).toFixed(0)}k Dreiecke, ${result.durationMs} ms`);
  }

  private renderStats(result: Built): void {
    const host = byId('stats');
    host.replaceChildren();
    for (const stat of result.stats) {
      const card = el('div', 'stat');
      const row = el('div', 'stat__row');
      row.append(el('span', 'stat__label', stat.label), el('span', 'stat__value', stat.value));
      card.append(row);
      if (stat.hint) card.append(el('p', 'stat__hint', stat.hint));
      host.append(card);
    }
  }

  private renderWarnings(warnings: string[]): void {
    const host = byId('warnings');
    host.replaceChildren();
    for (const warning of warnings) host.append(el('div', 'warning', warning));
  }

  private renderBom(result: Built): void {
    const block = byId('bom-block');
    const host = byId('bom');
    host.replaceChildren();
    block.hidden = result.bom.length === 0;

    for (const item of result.bom) {
      const row = el('div', 'bom-item');
      const head = el('div', 'bom-item__head');
      head.append(el('span', undefined, item.label), el('span', undefined, `${item.qty} ${item.unit}`));
      row.append(head);
      if (item.note) row.append(el('p', 'bom-item__note', item.note));
      if (item.cost) row.append(el('p', 'bom-item__note', `Kosten ca. ${item.cost.toFixed(2)} CHF`));
      if (item.url) {
        const link = el('a', undefined, 'Zur Bezugsquelle');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const wrap = el('p', 'bom-item__note');
        wrap.append(link);
        row.append(wrap);
      }
      host.append(row);
    }
  }

  private renderSteps(result: Built): void {
    const host = byId('steps');
    host.replaceChildren();

    const parts = el('p', 'ctl__hint');
    parts.textContent = result.parts
      .map((p) => `${p.copies} x ${p.name} (${materialById(p.materialId).label})`)
      .join(' · ');
    host.append(parts);

    const list = el('ol', 'steps');
    for (const step of result.steps) list.append(el('li', undefined, step));
    host.append(list);

    const profile = el('p', 'ctl__hint');
    profile.textContent = `Druck: ${result.profile.layerHeight} mm Schichten, ${result.profile.wallLoops} Wandlinien, ${result.profile.infill} % Fuellung, Stuetzen ${result.profile.supports ? 'ja' : 'nein'}.`;
    host.append(profile);
  }

  // --- Export ------------------------------------------------------------

  private async exportProject(): Promise<void> {
    const button = byId<HTMLButtonElement>('btn-export');
    button.disabled = true;
    this.setStatus('Export wird geschnuert ...', true);
    try {
      const file = await this.service.exportProject();
      const blob = new Blob([file.data as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = el('a');
      link.href = url;
      link.download = file.filename;
      // Der Link muss im Dokument haengen: ein Klick auf ein losgeloestes
      // Element loest in Chromium keinen Download aus.
      link.style.display = 'none';
      document.body.append(link);
      link.click();
      link.remove();
      // Erst nach dem Start freigeben - sonst bricht der Download ab.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.setStatus(`${file.filename} heruntergeladen`);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Export fehlgeschlagen');
    } finally {
      button.disabled = false;
    }
  }

  // --- Overlays ----------------------------------------------------------

  private wireOverlays(): void {
    for (const button of document.querySelectorAll<HTMLElement>('[data-close]')) {
      button.addEventListener('click', () => {
        byId(button.dataset.close!).hidden = true;
      });
    }
    for (const overlay of document.querySelectorAll<HTMLElement>('.overlay')) {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.hidden = true;
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      for (const overlay of document.querySelectorAll<HTMLElement>('.overlay')) overlay.hidden = true;
    });

    byId('btn-gallery').addEventListener('click', () => {
      byId('gallery').hidden = false;
      void this.fillGallery();
    });
  }

  /**
   * Galeriebilder werden aus der echten Geometrie gerendert, nicht gemalt -
   * so zeigt die Karte genau das, was der Generator liefert.
   */
  private async fillGallery(): Promise<void> {
    const grid = byId('gallery-grid');
    grid.replaceChildren();

    const cards = new Map<string, HTMLElement>();
    for (const model of MODELS) {
      const card = el('button', 'card');
      card.type = 'button';

      const image = el('div', 'card__image');
      const cached = this.thumbnails.get(model.id);
      if (cached) {
        const img = el('img');
        img.src = cached;
        img.alt = `Vorschau: ${model.name}`;
        image.append(img);
      } else {
        image.textContent = 'Vorschau wird gerendert ...';
      }
      card.append(image);

      const body = el('div', 'card__body');
      body.append(
        el('h3', 'card__title', model.name),
        el('p', 'card__tagline', model.tagline),
        el('p', 'card__text', model.description),
        el('p', 'card__requires', `Braucht: ${model.requires}`),
      );
      card.append(body);

      card.addEventListener('click', () => {
        byId('gallery').hidden = true;
        this.selectModel(model.id);
      });
      grid.append(card);
      cards.set(model.id, image);
    }

    if (this.thumbnails.size === MODELS.length) return;

    // Verstecktes Rendern in einem eigenen Zeichenbereich.
    const canvas = el('canvas');
    canvas.width = 480;
    canvas.height = 320;
    canvas.style.position = 'fixed';
    canvas.style.left = '-9999px';
    canvas.style.width = '480px';
    canvas.style.height = '320px';
    document.body.append(canvas);
    const shots = new Viewer(canvas);

    try {
      for (const model of MODELS) {
        if (this.thumbnails.has(model.id)) continue;
        const built = await this.service.build(model.id, model.defaults);
        shots.setParts(built.parts);
        const url = shots.snapshot(480, 320);
        this.thumbnails.set(model.id, url);

        const host = cards.get(model.id);
        if (host) {
          const img = el('img');
          img.src = url;
          img.alt = `Vorschau: ${model.name}`;
          host.replaceChildren(img);
        }
      }
    } finally {
      shots.dispose();
      canvas.remove();
      // Der Worker haelt jetzt das zuletzt gerenderte Galeriemodell -
      // der Export braucht aber das, was auf der Buehne steht.
      await this.build();
    }
  }

  // --- KI ----------------------------------------------------------------

  private wireAi(): void {
    this.migrateStoredKey();

    const providers = byId<HTMLSelectElement>('ai-provider');
    for (const entry of visibleProviders()) {
      const option = el('option');
      option.value = entry.id;
      option.textContent = entry.label;
      providers.append(option);
    }
    providers.value = defaultProvider(localStorage.getItem(PROVIDER_STORAGE)).id;
    providers.addEventListener('change', () => {
      localStorage.setItem(PROVIDER_STORAGE, providers.value);
      this.showProvider(providerById(providers.value));
    });

    const models = byId<HTMLSelectElement>('ai-model');
    models.addEventListener('change', () => {
      localStorage.setItem(MODEL_STORAGE, models.value);
      this.showModelHelp();
    });

    const key = byId<HTMLInputElement>('ai-key');
    key.addEventListener('change', () => {
      localStorage.setItem(keyStorageFor(providers.value), key.value.trim());
    });

    byId('ai-model-reload').addEventListener('click', () => void this.reloadModels());

    const custom = byId<HTMLInputElement>('ai-model-custom');
    custom.value = localStorage.getItem(CUSTOM_MODEL_STORAGE) ?? '';
    custom.addEventListener('change', () => {
      localStorage.setItem(CUSTOM_MODEL_STORAGE, custom.value.trim());
    });

    this.showProvider(providerById(providers.value));

    const files = byId<HTMLInputElement>('ai-images');
    files.addEventListener('change', () => void this.loadImages(files.files));

    byId('btn-ai').addEventListener('click', () => {
      byId('ai').hidden = false;
      byId<HTMLTextAreaElement>('ai-prompt').focus();
    });
    byId('ai-go').addEventListener('click', () => void this.runAi());
  }

  /**
   * Frueher lag genau ein Schluessel unter `fidget-maker.apiKey` - der war
   * immer der von Anthropic. Der wandert einmalig in das Anbieterfach, damit
   * er beim Umstieg auf Llama nicht verlorengeht.
   */
  private migrateStoredKey(): void {
    const legacy = localStorage.getItem(KEY_STORAGE);
    if (!legacy) return;
    if (!localStorage.getItem(keyStorageFor('anthropic'))) {
      localStorage.setItem(keyStorageFor('anthropic'), legacy);
    }
    localStorage.removeItem(KEY_STORAGE);
  }

  /**
   * Die zuletzt beim Anbieter abgeholte Modellliste. Sie schlaegt die
   * eingebaute, denn die veraltet - Anbieter benennen Modelle um.
   */
  private storedModels(provider: AiProvider): AiModel[] | null {
    const raw = localStorage.getItem(modelListStorageFor(provider.id));
    if (!raw) return null;
    try {
      const list = JSON.parse(raw) as AiModel[];
      return Array.isArray(list) && list.length > 0 ? list : null;
    } catch {
      return null;
    }
  }

  /** Modellliste, Schluesselfeld und Hinweise auf den Anbieter umstellen. */
  private showProvider(provider: AiProvider): void {
    const models = byId<HTMLSelectElement>('ai-model');
    models.replaceChildren();
    for (const entry of this.storedModels(provider) ?? provider.models) {
      const option = el('option');
      option.value = entry.id;
      option.textContent = entry.label;
      models.append(option);
    }

    // Ein gespeichertes Modell gilt nur, wenn es in dieser Liste vorkommt.
    const stored = localStorage.getItem(MODEL_STORAGE) ?? '';
    const angeboten = [...models.options].some((o) => o.value === stored);
    models.value = angeboten ? stored : (models.options[0]?.value ?? '');
    this.showModelHelp();

    byId('ai-provider-note').textContent = provider.note;

    const key = byId<HTMLInputElement>('ai-key');
    key.placeholder = provider.keyPrefix;
    key.value = localStorage.getItem(keyStorageFor(provider.id)) ?? '';

    const link = byId<HTMLAnchorElement>('ai-key-link');
    link.href = provider.keyUrl;
    link.textContent = provider.keyUrl.replace(/^https:\/\//, '');
  }

  private showModelHelp(): void {
    const provider = providerById(byId<HTMLSelectElement>('ai-provider').value);
    const chosen = byId<HTMLSelectElement>('ai-model').value;
    const liste = this.storedModels(provider) ?? provider.models;
    byId('ai-model-help').textContent = liste.find((m) => m.id === chosen)?.help ?? '';
  }

  /**
   * Die Modellliste beim Anbieter abholen.
   *
   * Fest eingebaute Kennungen veralten - dann laeuft man in ein "kennt das
   * Modell nicht". Ein Druck auf "Aktualisieren" holt, was es gerade gibt.
   */
  private async reloadModels(): Promise<void> {
    const button = byId<HTMLButtonElement>('ai-model-reload');
    const provider = providerById(byId<HTMLSelectElement>('ai-provider').value);
    const key = byId<HTMLInputElement>('ai-key').value.trim();

    button.disabled = true;
    this.setAiStatus(`Modelle von ${provider.label} werden geholt ...`);
    try {
      const models = await fetchModels(provider, key || undefined);
      localStorage.setItem(modelListStorageFor(provider.id), JSON.stringify(models));
      this.showProvider(provider);
      this.setAiStatus(
        `${models.length} Modelle von ${provider.label} geladen. Das oberste ist meist die beste Wahl.`,
        'ok',
      );
    } catch (error) {
      this.setAiStatus(
        `${error instanceof Error ? error.message : String(error)} Die eingebaute Liste bleibt bestehen.`,
        'error',
      );
    } finally {
      button.disabled = false;
    }
  }

  private async loadImages(list: FileList | null): Promise<void> {
    this.images = [];
    const host = byId('ai-thumbs');
    host.replaceChildren();
    if (!list) return;

    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    for (const file of [...list].slice(0, 4)) {
      if (!allowed.includes(file.type)) continue;
      const buffer = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const data = btoa(binary);
      this.images.push({ data, mediaType: file.type as DesignImage['mediaType'] });

      const img = el('img');
      img.src = `data:${file.type};base64,${data}`;
      img.alt = file.name;
      host.append(img);
    }
  }

  private setAiStatus(text: string, tone: 'info' | 'error' | 'ok' = 'info'): void {
    const node = byId('ai-status');
    node.textContent = text;
    node.dataset.tone = tone;
  }

  private async runAi(): Promise<void> {
    const button = byId<HTMLButtonElement>('ai-go');
    const prompt = byId<HTMLTextAreaElement>('ai-prompt').value;
    const apiKey = byId<HTMLInputElement>('ai-key').value.trim();
    const provider = providerById(byId<HTMLSelectElement>('ai-provider').value);
    // Eine eigene Kennung schlaegt die Auswahl - sonst kaeme man an ein
    // umbenanntes Modell nicht mehr heran.
    const custom = byId<HTMLInputElement>('ai-model-custom').value.trim();
    const aiModel = custom || byId<HTMLSelectElement>('ai-model').value;

    button.disabled = true;
    this.setAiStatus(
      apiKey
        ? `${provider.label} entwirft ...`
        : 'Ohne Schluessel: Stichwortsuche laeuft ...',
    );
    try {
      const design = await designFidget({
        prompt,
        images: this.images,
        apiKey: apiKey || undefined,
        provider: provider.id,
        model: aiModel,
      });

      this.selectModel(design.modelId);
      this.setParams(design.params);
      this.renderControlPanel();
      await this.build();

      // Wenn nichts von der Vorgabe abweicht, hat die KI faktisch nichts
      // getan. Das offen sagen, statt den Nutzer raten zu lassen, warum das
      // Ergebnis wie die Voreinstellung aussieht.
      if (design.source === 'ki' && design.changed === 0) {
        this.setAiStatus(
          `${provider.label} hat keine Werte gesetzt - das ist die unveraenderte Voreinstellung. Ein groesseres Modell (Llama 3.3 70B statt 8B) hilft hier am meisten.`,
          'error',
        );
      } else {
        this.setAiStatus(
          `${design.name}: ${design.reason} (${design.changed} Werte gesetzt)`,
          'ok',
        );
        byId('ai').hidden = true;
      }
      this.setStatus(`${design.name} - ${design.source === 'ki' ? 'von der KI entworfen' : 'ohne KI entworfen'}`);
    } catch (error) {
      this.setAiStatus(error instanceof Error ? error.message : 'Der Entwurf ist fehlgeschlagen.', 'error');
    } finally {
      button.disabled = false;
    }
  }
}
