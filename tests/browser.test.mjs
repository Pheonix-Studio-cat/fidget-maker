/**
 * Oberflaechentest im echten Browser.
 *
 * Geprueft wird der Weg, den auch ein Nutzer geht: Modell waehlen, Regler
 * bewegen, Voreinstellung laden, KI ohne Schluessel entwerfen lassen und am
 * Ende exportieren. Der Download wird ausgepackt und auf Inhalt geprueft -
 * ein Knopf, der eine kaputte Datei liefert, faellt hier auf.
 *
 * Voraussetzung: `npm run build && npx vite preview --port 4173` laeuft.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';
import { existsSync } from 'node:fs';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';

// In dieser Umgebung liegt Chromium bereits bereit; die Playwright-Version
// wuerde sonst einen eigenen Build nachladen wollen.
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

async function open() {
  const browser = await chromium.launch({
    executablePath: existsSync(EXECUTABLE) ? EXECUTABLE : undefined,
    // WebGL braucht im Container den Software-Rasterizer.
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(msg.text());
  });
  page.on('pageerror', (err) => problems.push(String(err)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !/wird berechnet/.test(document.querySelector('#status')?.textContent ?? ''), {
    timeout: 30000,
  });
  return { browser, page, problems };
}

test('Die App startet, baut das Pop-It und zeigt Kennzahlen', async () => {
  const { browser, page, problems } = await open();
  try {
    assert.equal(await page.locator('.tab').count(), 5, 'fuenf Fidgets in der Kopfzeile');
    await assert.doesNotReject(page.waitForSelector('.stat', { timeout: 10000 }));

    const stats = await page.locator('.stat__label').allTextContents();
    assert.ok(stats.includes('Blasen'), `Kennzahl "Blasen" fehlt: ${stats.join(', ')}`);

    const blasen = await page.locator('.stat', { hasText: 'Blasen' }).first().locator('.stat__value').textContent();
    assert.ok(Number(blasen) > 20, `zu wenige Blasen: ${blasen}`);

    // Der Viewer muss tatsaechlich etwas gezeichnet haben.
    const drawn = await page.evaluate(() => {
      const canvas = document.querySelector('#view');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      return { hasContext: !!gl, width: canvas.width, height: canvas.height };
    });
    assert.ok(drawn.hasContext, 'kein WebGL-Kontext');
    assert.ok(drawn.width > 100 && drawn.height > 100, 'Zeichenflaeche zu klein');

    assert.deepEqual(problems, [], `Fehler in der Browser-Konsole: ${problems.join(' | ')}`);
  } finally {
    await browser.close();
  }
});

test('Jedes Fidget laesst sich anwaehlen und baut Teile', async (t) => {
  const { browser, page, problems } = await open();
  try {
    for (const name of ['Clicker', 'Stressball', 'Magnet-Slider', 'Fidget-Spinner', 'Pop-It']) {
      await page.locator('.tab', { hasText: name }).click();
      await page.waitForFunction(
        () => !/wird berechnet/.test(document.querySelector('#status')?.textContent ?? ''),
        { timeout: 30000 },
      );
      const chips = await page.locator('.chip').count();
      const stats = await page.locator('.stat').count();
      t.diagnostic(`${name}: ${chips} Teile, ${stats} Kennzahlen`);
      assert.ok(chips >= 1, `${name} liefert keine Teile`);
      assert.ok(stats >= 3, `${name} liefert kaum Kennzahlen`);
    }
    assert.deepEqual(problems, [], `Fehler in der Konsole: ${problems.join(' | ')}`);
  } finally {
    await browser.close();
  }
});

test('Ein Regler veraendert das Ergebnis', async (t) => {
  const { browser, page } = await open();
  try {
    const value = () =>
      page.locator('.stat', { hasText: 'Blasen' }).first().locator('.stat__value').textContent();
    const before = Number(await value());

    // Breite hochschieben -> es muessen mehr Blasen hineinpassen.
    const slider = page.locator('.ctl--number', { hasText: 'Breite' }).first().locator('.ctl__slider');
    await slider.fill('200');
    await slider.dispatchEvent('input');
    await page.waitForFunction(
      (prev) => {
        const status = document.querySelector('#status')?.textContent ?? '';
        const now = document.querySelector('.stat .stat__value')?.textContent ?? '';
        return !/wird berechnet/.test(status) && Number(now) !== prev;
      },
      before,
      { timeout: 30000 },
    );

    const after = Number(await value());
    t.diagnostic(`Blasen ${before} -> ${after} bei 200 mm Breite`);
    assert.ok(after > before, 'eine breitere Platte muss mehr Blasen fassen');
  } finally {
    await browser.close();
  }
});

test('Voreinstellungen schalten die Konfiguration um', async (t) => {
  const { browser, page } = await open();
  try {
    await page.locator('.preset', { hasText: 'Ohne Kaufteile' }).click();
    await page.waitForFunction(
      () => !/wird berechnet/.test(document.querySelector('#status')?.textContent ?? ''),
      { timeout: 30000 },
    );
    // Ohne Kaufteile darf keine Stueckliste erscheinen.
    assert.ok(await page.locator('#bom-block').isHidden(), 'ohne Kaufteile darf nichts zu kaufen sein');

    await page.locator('.preset', { hasText: 'Klassisch gross' }).click();
    await page.waitForSelector('#bom-block:not([hidden])', { timeout: 30000 });
    const bom = await page.locator('.bom-item__head').first().textContent();
    t.diagnostic(`Stueckliste: ${bom}`);
    assert.match(bom, /Schnappkuppeln/);
  } finally {
    await browser.close();
  }
});

test('Der KI-Dialog entwirft auch ohne Schluessel', async (t) => {
  const { browser, page } = await open();
  try {
    await page.locator('#btn-ai').click();
    await page.locator('#ai-prompt').fill('ein Spinner mit vier Armen, der lange laeuft');
    await page.locator('#ai-go').click();

    await page.waitForFunction(
      () => document.querySelector('#ai')?.hasAttribute('hidden'),
      { timeout: 30000 },
    );
    await page.waitForFunction(
      () => !/wird berechnet/.test(document.querySelector('#status')?.textContent ?? ''),
      { timeout: 30000 },
    );

    const active = await page.locator('.tab[aria-current="true"]').textContent();
    t.diagnostic(`KI hat gewaehlt: ${active}`);
    assert.equal(active, 'Fidget-Spinner');

    const arms = await page
      .locator('.stat', { hasText: 'Arme' })
      .first()
      .locator('.stat__value')
      .textContent();
    assert.equal(arms.trim(), '4');
  } finally {
    await browser.close();
  }
});

test('Die Galerie zeigt gerenderte Vorschaubilder', async (t) => {
  const { browser, page } = await open();
  try {
    await page.locator('#btn-gallery').click();
    await page.waitForSelector('.card', { timeout: 10000 });
    assert.equal(await page.locator('.card').count(), 5);

    await page.waitForFunction(() => document.querySelectorAll('.card__image img').length === 5, {
      timeout: 90000,
    });
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll('.card__image img')].map((img) => img.src.length),
    );
    t.diagnostic(`Bildgroessen: ${sizes.map((s) => Math.round(s / 1024) + ' kB').join(', ')}`);
    for (const size of sizes) assert.ok(size > 2000, 'Vorschaubild ist verdaechtig klein');

    await page.locator('.card', { hasText: 'Stressball' }).click();
    await page.waitForFunction(
      () => !/wird berechnet/.test(document.querySelector('#status')?.textContent ?? ''),
      { timeout: 30000 },
    );
    assert.equal(await page.locator('.tab[aria-current="true"]').textContent(), 'Stressball');
  } finally {
    await browser.close();
  }
});

test('Der Export liefert ein Paket mit 3MF, STL und Anleitung', async (t) => {
  const { browser, page } = await open();
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.locator('#btn-export').click(),
    ]);

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
    const names = Object.keys(files);
    t.diagnostic(`${download.suggestedFilename()}: ${names.join(', ')}`);

    assert.ok(names.some((n) => n.endsWith('.3mf')), '3MF fehlt');
    assert.ok(names.some((n) => n.startsWith('STL/')), 'STL fehlt');
    assert.ok(names.includes('Anleitung.txt'), 'Anleitung fehlt');

    const inner = unzipSync(files[names.find((n) => n.endsWith('.3mf'))]);
    const xml = strFromU8(inner['3D/3dmodel.model']);
    assert.match(xml, /unit="millimeter"/);
    assert.ok((xml.match(/<item /g) ?? []).length >= 2, 'beide Teile muessen auf der Platte liegen');

    const anleitung = strFromU8(files['Anleitung.txt']);
    assert.match(anleitung, /MONTAGE/);
    assert.match(anleitung, /Metall-Schnappkuppeln/);
  } finally {
    await browser.close();
  }
});
